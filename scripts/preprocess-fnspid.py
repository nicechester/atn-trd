#!/usr/bin/env python3
"""
Preprocess FNSPID dataset for backtesting.

Converts raw CSV files into a queryable SQLite database with:
- Price data (OHLCV) indexed by symbol + date
- News sentiment (FinBERT scores) indexed by symbol + date

Usage:
    python scripts/preprocess-fnspid.py --years 5
    python scripts/preprocess-fnspid.py --years 5 --prices-only
    python scripts/preprocess-fnspid.py --years 5 --news-only
"""

import argparse
import csv
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from queue import Queue
from threading import Thread

csv.field_size_limit(sys.maxsize)

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification


# Default paths
DEFAULT_DATA_DIR = "/Volumes/JetDrive/atn-trd/fnspid"
DEFAULT_OUTPUT_DB = "fnspid.db"

# Processing settings
PRICE_BATCH_SIZE = 1000
NEWS_BATCH_SIZE = 500  # Optimal for MPS throughput
COMMIT_INTERVAL = 10000


def get_device():
    """Get the best available device."""
    if torch.backends.mps.is_available():
        return torch.device("mps")
    elif torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def create_schema(conn: sqlite3.Connection):
    """Create database schema."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS prices (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open_cents INTEGER,
            high_cents INTEGER,
            low_cents INTEGER,
            close_cents INTEGER,
            adj_close_cents INTEGER,
            volume INTEGER,
            PRIMARY KEY (symbol, date)
        );

        CREATE TABLE IF NOT EXISTS news_sentiment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            headline TEXT,
            sentiment_score REAL,
            sentiment_label TEXT,
            confidence REAL
        );

        CREATE INDEX IF NOT EXISTS idx_prices_symbol_date ON prices(symbol, date);
        CREATE INDEX IF NOT EXISTS idx_sentiment_symbol_date ON news_sentiment(symbol, date);
        
        CREATE TABLE IF NOT EXISTS preprocess_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()


def dollars_to_cents(value: str) -> int | None:
    """Convert dollar string to cents."""
    try:
        return int(float(value) * 100)
    except (ValueError, TypeError):
        return None


def parse_date(date_str: str) -> str | None:
    """Parse date string to YYYY-MM-DD format."""
    if not date_str:
        return None
    # Handle various formats
    date_str = date_str.strip()
    # "2023-12-28" or "2023-12-28 00:00:00+00:00"
    return date_str[:10] if len(date_str) >= 10 else None


def get_cutoff_date(years: int, from_date: str | None = None) -> str:
    """Get cutoff date for filtering.
    
    Args:
        years: Number of years to go back
        from_date: Reference date (YYYY-MM-DD). If None, uses today.
    """
    if from_date:
        ref = datetime.strptime(from_date, "%Y-%m-%d")
    else:
        ref = datetime.now()
    cutoff = ref - timedelta(days=years * 365)
    return cutoff.strftime("%Y-%m-%d")


class FinBERTScorer:
    """FinBERT sentiment scorer with MPS acceleration."""
    
    def __init__(self, device: torch.device):
        print("Loading FinBERT model...")
        self.tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        self.model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        self.model = self.model.to(device)
        self.model.eval()
        self.device = device
        self.id2label = self.model.config.id2label
        print(f"FinBERT loaded on {device}")
    
    def score_batch(self, texts: list[str]) -> list[dict]:
        """Score a batch of texts."""
        if not texts:
            return []
        
        # Filter out empty texts
        valid_indices = [i for i, t in enumerate(texts) if t and t.strip()]
        valid_texts = [texts[i] for i in valid_indices]
        
        if not valid_texts:
            return [{"label": "neutral", "confidence": 0.0, "score": 0.0} for _ in texts]
        
        inputs = self.tokenizer(
            valid_texts, 
            padding=True, 
            truncation=True, 
            max_length=512, 
            return_tensors="pt"
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)
            predictions = torch.argmax(probs, dim=-1)
        
        # Build results for valid texts
        valid_results = []
        for i, pred in enumerate(predictions.tolist()):
            label = self.id2label[pred]
            confidence = probs[i, pred].item()
            if label == "positive":
                score = confidence
            elif label == "negative":
                score = -confidence
            else:
                score = 0.0
            valid_results.append({"label": label, "confidence": confidence, "score": score})
        
        # Map back to original indices
        results = [{"label": "neutral", "confidence": 0.0, "score": 0.0} for _ in texts]
        for idx, result in zip(valid_indices, valid_results):
            results[idx] = result
        
        return results


def process_prices(conn: sqlite3.Connection, data_dir: Path, cutoff_date: str):
    """Process price CSV files."""
    price_dir = data_dir / "price" / "full_history"
    if not price_dir.exists():
        print(f"Price directory not found: {price_dir}")
        return
    
    csv_files = list(price_dir.glob("*.csv"))
    total_files = len(csv_files)
    print(f"\nProcessing {total_files} price files...")
    
    cursor = conn.cursor()
    total_rows = 0
    skipped_rows = 0
    start_time = time.perf_counter()
    
    for file_idx, csv_file in enumerate(csv_files):
        symbol = csv_file.stem.upper()
        batch = []
        
        try:
            with open(csv_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    date = parse_date(row.get("date", ""))
                    if not date:
                        skipped_rows += 1
                        continue
                    
                    batch.append((
                        symbol,
                        date,
                        dollars_to_cents(row.get("open")),
                        dollars_to_cents(row.get("high")),
                        dollars_to_cents(row.get("low")),
                        dollars_to_cents(row.get("close")),
                        dollars_to_cents(row.get("adj close")),
                        int(float(row.get("volume", 0) or 0)),
                    ))
                    
                    if len(batch) >= PRICE_BATCH_SIZE:
                        cursor.executemany(
                            "INSERT OR REPLACE INTO prices VALUES (?,?,?,?,?,?,?,?)",
                            batch
                        )
                        total_rows += len(batch)
                        batch = []
            
            # Insert remaining
            if batch:
                cursor.executemany(
                    "INSERT OR REPLACE INTO prices VALUES (?,?,?,?,?,?,?,?)",
                    batch
                )
                total_rows += len(batch)
            
            # Commit periodically
            if (file_idx + 1) % 100 == 0:
                conn.commit()
                elapsed = time.perf_counter() - start_time
                rate = (file_idx + 1) / elapsed
                eta = (total_files - file_idx - 1) / rate if rate > 0 else 0
                print(f"  [{file_idx + 1}/{total_files}] {symbol} - {total_rows:,} rows, ETA: {eta:.0f}s")
        
        except Exception as e:
            print(f"  Error processing {csv_file}: {e}")
    
    conn.commit()
    elapsed = time.perf_counter() - start_time
    print(f"Prices complete: {total_rows:,} rows in {elapsed:.1f}s ({skipped_rows:,} skipped)")


def process_news(conn: sqlite3.Connection, data_dir: Path, cutoff_date: str, end_date: str, scorer: FinBERTScorer):
    """Process news CSV with FinBERT, output daily aggregates per symbol."""
    # Try full file first, fall back to filtered 2y file
    news_file = data_dir / "news" / "nasdaq_exteral_data.csv"
    if not news_file.exists():
        news_file = data_dir / "news" / "news_2y.csv"
    if not news_file.exists():
        print(f"News file not found: {news_file}")
        return
    
    print(f"  Reading: {news_file.name}")
    print(f"  Date range: {cutoff_date} to {end_date}")
    
    # Load existing dates to skip
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT symbol || '|' || date FROM news_sentiment")
    existing_keys = set(row[0] for row in cursor.fetchall())
    print(f"  Existing records: {len(existing_keys):,} symbol/dates (will skip)")
    
    cursor = conn.cursor()
    print("\nProcessing news (concurrent I/O + GPU)...")
    start_time = time.perf_counter()
    
    daily_scores: dict[tuple[str, str], list[float]] = {}
    batch_queue: Queue = Queue(maxsize=4)  # Prefetch up to 4 batches
    done_reading = [False]
    row_count = [0]
    skipped = [0]
    
    def reader_thread():
        """Read CSV and queue batches."""
        batch_headlines = []
        batch_keys = []
        filtered = [0]
        skipped_existing = [0]
        with open(news_file, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row_count[0] += 1
                date = parse_date(row.get("Date", ""))
                if not date:
                    skipped[0] += 1
                    continue
                # Filter by date range
                if date < cutoff_date or date > end_date:
                    filtered[0] += 1
                    continue
                symbol = (row.get("Stock_symbol") or "").strip().upper()
                headline = (row.get("Article_title") or "").strip()
                if not symbol or not headline:
                    skipped[0] += 1
                    continue
                # Skip if already processed
                key = f"{symbol}|{date}"
                if key in existing_keys:
                    skipped_existing[0] += 1
                    continue
                batch_headlines.append(headline)
                batch_keys.append((symbol, date))
                if len(batch_headlines) >= NEWS_BATCH_SIZE:
                    batch_queue.put((batch_headlines, batch_keys))
                    batch_headlines = []
                    batch_keys = []
            if batch_headlines:
                batch_queue.put((batch_headlines, batch_keys))
        print(f"  Filtered out {filtered[0]:,} rows outside date range")
        print(f"  Skipped {skipped_existing[0]:,} rows with existing records")
        done_reading[0] = True
    
    # Start reader thread
    reader = Thread(target=reader_thread, daemon=True)
    reader.start()
    
    # Process batches from queue
    scored = 0
    while True:
        if done_reading[0] and batch_queue.empty():
            break
        try:
            batch_headlines, batch_keys = batch_queue.get(timeout=0.1)
        except:
            continue
        
        results = scorer.score_batch(batch_headlines)
        for key, r in zip(batch_keys, results):
            if key not in daily_scores:
                daily_scores[key] = []
            daily_scores[key].append(r["score"])
        
        scored += len(batch_headlines)
        if scored % 50000 < NEWS_BATCH_SIZE:
            elapsed = time.perf_counter() - start_time
            rate = scored / elapsed
            print(f"  {scored:,} headlines, {len(daily_scores):,} symbol/dates, {rate:.0f}/s")
    
    reader.join()
    total_headlines = sum(len(s) for s in daily_scores.values())
    print(f"  Scanned {row_count[0]:,} rows, {skipped[0]:,} skipped")
    print(f"  {total_headlines:,} headlines -> {len(daily_scores):,} daily aggregates")
    
    # Insert daily averages
    print("\nInserting daily averages...")
    insert_data = [
        (symbol, date, str(len(scores)), sum(scores) / len(scores))
        for (symbol, date), scores in daily_scores.items()
    ]
    cursor.executemany(
        "INSERT INTO news_sentiment (symbol, date, headline, sentiment_score, sentiment_label, confidence) VALUES (?,?,?,?,NULL,NULL)",
        insert_data
    )
    cursor.execute("INSERT OR REPLACE INTO preprocess_meta VALUES ('news_complete', 'true')")
    conn.commit()
    
    elapsed = time.perf_counter() - start_time
    print(f"News complete: {len(insert_data):,} daily rows in {elapsed/60:.1f}min")


def main():
    parser = argparse.ArgumentParser(description="Preprocess FNSPID dataset for backtesting")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="FNSPID data directory")
    parser.add_argument("--output", default=None, help="Output database path (default: <data-dir>/fnspid.db)")
    parser.add_argument("--years", type=int, default=5, help="Years of history to include")
    parser.add_argument("--end-date", default="2023-12-16", help="Reference end date for --years calculation (default: 2023-12-16, the FNSPID data end)")
    parser.add_argument("--prices-only", action="store_true", help="Process only price data")
    parser.add_argument("--news-only", action="store_true", help="Process only news data")
    args = parser.parse_args()
    
    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"Data directory not found: {data_dir}")
        sys.exit(1)
    
    output_db = Path(args.output) if args.output else data_dir / DEFAULT_OUTPUT_DB
    cutoff_date = get_cutoff_date(args.years, args.end_date)
    
    print(f"FNSPID Preprocessing")
    print(f"  Data dir: {data_dir}")
    print(f"  Output: {output_db}")
    print(f"  Date range: {cutoff_date} to {args.end_date} ({args.years} years)")
    
    # Setup device
    device = get_device()
    print(f"  Device: {device}")
    
    # Connect to database
    conn = sqlite3.connect(str(output_db))
    create_schema(conn)
    
    try:
        # Process prices
        if not args.news_only:
            process_prices(conn, data_dir, cutoff_date)
        
        # Process news
        if not args.prices_only:
            scorer = FinBERTScorer(device)
            # Warmup
            _ = scorer.score_batch(["Test headline for warmup"])
            process_news(conn, data_dir, cutoff_date, args.end_date, scorer)
        
        print("\nDone!")
        
        # Print stats
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM prices")
        price_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM news_sentiment")
        news_count = cursor.fetchone()[0]
        print(f"  Prices: {price_count:,} rows")
        print(f"  News: {news_count:,} rows")
        print(f"  Database size: {output_db.stat().st_size / 1024 / 1024:.1f} MB")
    
    finally:
        conn.close()


if __name__ == "__main__":
    main()
