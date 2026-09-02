#!/usr/bin/env python3
"""Check strategic plans and tranches in the database."""

import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "atn.db"

def main():
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Check strategic plans
    print("=== Strategic Plans ===")
    plans = conn.execute("""
        SELECT id, symbol, direction, status, target_shares, executed_shares,
               tranche_count, tranches_executed, min_days_between,
               entry_composite_score, conviction_at_creation, pause_reason,
               datetime(created_at/1000, 'unixepoch', 'localtime') as created,
               datetime(last_tranche_at/1000, 'unixepoch', 'localtime') as last_tranche,
               datetime(completed_at/1000, 'unixepoch', 'localtime') as completed
        FROM strategic_plans
        ORDER BY created_at DESC
        LIMIT 20
    """).fetchall()

    if not plans:
        print("No strategic plans found.")
    else:
        for p in plans:
            progress = f"{p['executed_shares']:.0f}/{p['target_shares']:.0f} shares ({p['tranches_executed']}/{p['tranche_count']} tranches)"
            print(f"\n{p['symbol']} [{p['direction']}] - {p['status']}")
            print(f"  Progress: {progress}")
            print(f"  Entry Score: {p['entry_composite_score']:.2f}" if p['entry_composite_score'] else "  Entry Score: N/A")
            print(f"  Created: {p['created']}")
            if p['last_tranche']:
                print(f"  Last Tranche: {p['last_tranche']}")
            if p['pause_reason']:
                print(f"  Pause Reason: {p['pause_reason']}")
            if p['completed']:
                print(f"  Completed: {p['completed']}")

    # Check recent tranches
    print("\n=== Recent Tranches ===")
    tranches = conn.execute("""
        SELECT t.id, t.plan_id, p.symbol, t.tranche_number, t.shares, t.price_cents,
               t.composite_score, t.regime,
               datetime(t.executed_at/1000, 'unixepoch', 'localtime') as executed
        FROM plan_tranches t
        JOIN strategic_plans p ON t.plan_id = p.id
        ORDER BY t.executed_at DESC
        LIMIT 10
    """).fetchall()

    if not tranches:
        print("No tranches found.")
    else:
        for t in tranches:
            price = t['price_cents'] / 100
            print(f"\n{t['symbol']} Tranche #{t['tranche_number']}")
            print(f"  Shares: {t['shares']:.0f} @ ${price:.2f}")
            print(f"  Regime: {t['regime']}")
            print(f"  Score: {t['composite_score']:.2f}" if t['composite_score'] else "  Score: N/A")
            print(f"  Executed: {t['executed']}")

    # Summary stats
    print("\n=== Summary ===")
    stats = conn.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) as paused,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled
        FROM strategic_plans
    """).fetchone()

    print(f"Total Plans: {stats['total']}")
    print(f"  Active: {stats['active']}, Paused: {stats['paused']}, Completed: {stats['completed']}, Cancelled: {stats['cancelled']}")

    tranche_count = conn.execute("SELECT COUNT(*) as cnt FROM plan_tranches").fetchone()['cnt']
    print(f"Total Tranches Executed: {tranche_count}")

    conn.close()

if __name__ == "__main__":
    main()
