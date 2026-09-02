#!/usr/bin/env python3
"""Check signal_snapshots table."""

import sqlite3

db = sqlite3.connect('data/atn.db')
db.row_factory = sqlite3.Row

rows = db.execute('''
    SELECT symbol, snapshot_date, sentiment_score, composite_score, composite_ewma
    FROM signal_snapshots ORDER BY snapshot_date DESC LIMIT 20
''').fetchall()

if not rows:
    print('No signals collected yet.')
else:
    print(f'{"Symbol":<8} {"Date":<12} {"Sentiment":>10} {"Composite":>10} {"EWMA":>10}')
    print('-' * 54)
    for r in rows:
        sent = f'{r["sentiment_score"]:.2f}' if r['sentiment_score'] else 'n/a'
        comp = f'{r["composite_score"]:.2f}' if r['composite_score'] else 'n/a'
        ewma = f'{r["composite_ewma"]:.2f}' if r['composite_ewma'] else 'n/a'
        print(f'{r["symbol"]:<8} {r["snapshot_date"]:<12} {sent:>10} {comp:>10} {ewma:>10}')

db.close()
