#!/usr/bin/env python3
"""
Prefetch ALFRED vintage macro data from FRED API.

Fetches historical VIX and yield curve data for each trading day in the backtest range.
Stores in SQLite for fast point-in-time lookups during backtesting.

Usage:
    # Set FRED_API_KEY env var or pass --api-key
    python scripts/prefetch-alfred.py
    python scripts/prefetch-alfred.py --resume
    python scripts/prefetch-alfred.py --start-date 2020-01-01 --end-date 2020-12-31

Get a free FRED API key at: https://fred.stlouisfed.org/docs/api/api_key.html
"""

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
import json

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed, rely on env vars


# Default paths
DEFAULT_DATA_DIR = "/Volumes/JetDrive/atn-trd"
DEFAULT_OUTPUT_DB = "alfred/alfred.db"

# FRED API settings
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
DEFAULT_SERIES = ["VIXCLS", "T10Y2Y"]
RATE_LIMIT_DELAY = 0.6  # ~100 req/min to stay under FRED's 120/min limit


def create_schema(conn: sqlite3.Connection):
    """Create database schema."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS macro_vintage (
            series_id TEXT NOT NULL,
            vintage_date TEXT NOT NULL,
            observation_date TEXT NOT NULL,
            value REAL NOT NULL,
            realtime_start TEXT,
            realtime_end TEXT,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY (series_id, vintage_date)
        );

        CREATE INDEX IF NOT EXISTS idx_macro_vintage_series_date 
        ON macro_vintage(series_id, vintage_date);
        
        CREATE TABLE IF NOT EXISTS prefetch_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()


def generate_trading_days(start_date: str, end_date: str) -> list[str]:
    """Generate list of trading days (weekdays only)."""
    days = []
    current = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    while current <= end:
        # Skip weekends (0=Monday, 6=Sunday)
        if current.weekday() < 5:
            days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    
    return days


def fetch_vintage(api_key: str, series_id: str, vintage_date: str) -> dict | None:
    """Fetch a single vintage observation from FRED API."""
    url = (
        f"{FRED_BASE_URL}"
        f"?series_id={series_id}"
        f"&api_key={api_key}"
        f"&file_type=json"
        f"&realtime_start={vintage_date}"
        f"&realtime_end={vintage_date}"
        f"&sort_order=desc"
        f"&limit=1"
    )
    
    req = Request(url, headers={"Accept": "application/json"})
    
    try:
        with urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 429:
            raise Exception("FRED rate limit exceeded")
        raise Exception(f"FRED API error: {e.code} {e.reason}")
    except URLError as e:
        raise Exception(f"Network error: {e.reason}")
    
    observations = data.get("observations", [])
    if not observations:
        return None
    
    obs = observations[0]
    value_str = obs.get("value", "")
    
    # FRED uses "." for missing values
    if not value_str or value_str.strip() == ".":
        return None
    
    try:
        value = float(value_str)
    except ValueError:
        return None
    
    return {
        "observation_date": obs.get("date"),
        "value": value,
        "realtime_start": obs.get("realtime_start"),
        "realtime_end": obs.get("realtime_end"),
    }


def main():
    parser = argparse.ArgumentParser(description="Prefetch ALFRED vintage macro data from FRED")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="Base data directory")
    parser.add_argument("--output", default=None, help="Output database path")
    parser.add_argument("--api-key", default=None, help="FRED API key (or set FRED_API_KEY env)")
    parser.add_argument("--start-date", default="2011-01-01", help="Start date (default: 2011-01-01)")
    parser.add_argument("--end-date", default="2023-12-31", help="End date (default: 2023-12-31)")
    parser.add_argument("--series", default=",".join(DEFAULT_SERIES), help="Comma-separated series IDs")
    parser.add_argument("--resume", action="store_true", help="Skip already-fetched dates")
    args = parser.parse_args()
    
    # Get API key (loaded from .env if python-dotenv installed)
    api_key = args.api_key or os.environ.get("FRED_API_KEY")
    if not api_key:
        print("Error: FRED_API_KEY not found in .env or environment")
        print("Get a free key at: https://fred.stlouisfed.org/docs/api/api_key.html")
        sys.exit(1)
    
    # Setup paths
    data_dir = Path(args.data_dir)
    output_db = Path(args.output) if args.output else data_dir / DEFAULT_OUTPUT_DB
    output_db.parent.mkdir(parents=True, exist_ok=True)
    
    series_ids = [s.strip().upper() for s in args.series.split(",")]
    
    print("ALFRED Vintage Data Prefetch")
    print("=" * 40)
    print(f"  Series: {', '.join(series_ids)}")
    print(f"  Date range: {args.start_date} to {args.end_date}")
    print(f"  Output: {output_db}")
    print(f"  Resume mode: {args.resume}")
    print()
    
    # Connect to database
    conn = sqlite3.connect(str(output_db))
    create_schema(conn)
    cursor = conn.cursor()
    
    # Load existing dates if resuming
    existing_keys = set()
    if args.resume:
        cursor.execute("SELECT series_id || '|' || vintage_date FROM macro_vintage")
        existing_keys = set(row[0] for row in cursor.fetchall())
        print(f"  Existing records: {len(existing_keys):,} (will skip)")
        print()
    
    # Generate trading days
    trading_days = generate_trading_days(args.start_date, args.end_date)
    total_requests = len(trading_days) * len(series_ids)
    
    print(f"  Trading days: {len(trading_days):,}")
    print(f"  Total requests: {total_requests:,}")
    print(f"  Estimated time: {total_requests * RATE_LIMIT_DELAY / 60:.0f} minutes")
    print()
    
    # Fetch data
    completed = 0
    skipped = 0
    errors = 0
    null_values = 0
    start_time = time.perf_counter()
    
    try:
        for vintage_date in trading_days:
            for series_id in series_ids:
                key = f"{series_id}|{vintage_date}"
                
                # Skip if already fetched
                if key in existing_keys:
                    skipped += 1
                    completed += 1
                    continue
                
                try:
                    obs = fetch_vintage(api_key, series_id, vintage_date)
                    
                    if obs:
                        cursor.execute(
                            """INSERT OR REPLACE INTO macro_vintage 
                               (series_id, vintage_date, observation_date, value, 
                                realtime_start, realtime_end, fetched_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?)""",
                            (
                                series_id,
                                vintage_date,
                                obs["observation_date"],
                                obs["value"],
                                obs["realtime_start"],
                                obs["realtime_end"],
                                int(time.time() * 1000),
                            )
                        )
                    else:
                        null_values += 1
                    
                    completed += 1
                    
                    # Progress update every 100 requests
                    if completed % 100 == 0:
                        conn.commit()
                        elapsed = time.perf_counter() - start_time
                        pct = (completed / total_requests) * 100
                        rate = (completed - skipped) / elapsed if elapsed > 0 else 0
                        eta = (total_requests - completed) / rate / 60 if rate > 0 else 0
                        print(f"  [{completed:,}/{total_requests:,}] {pct:.1f}% - {series_id} @ {vintage_date} - ETA: {eta:.1f}min")
                    
                    # Rate limiting
                    time.sleep(RATE_LIMIT_DELAY)
                    
                except Exception as e:
                    errors += 1
                    print(f"  Error {series_id} @ {vintage_date}: {e}")
                    # Back off on errors
                    time.sleep(RATE_LIMIT_DELAY * 5)
        
        conn.commit()
        
    except KeyboardInterrupt:
        print("\n\nInterrupted! Saving progress...")
        conn.commit()
    
    finally:
        conn.close()
    
    elapsed = time.perf_counter() - start_time
    print()
    print("Complete!")
    print(f"  Fetched: {completed - skipped - null_values:,}")
    print(f"  Skipped (resume): {skipped:,}")
    print(f"  Null values: {null_values:,}")
    print(f"  Errors: {errors:,}")
    print(f"  Time: {elapsed / 60:.1f} minutes")
    print(f"  Output: {output_db}")


if __name__ == "__main__":
    main()
