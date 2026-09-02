#!/usr/bin/env python3
"""Check market_regime table."""

import sqlite3

db = sqlite3.connect('data/atn.db')
db.row_factory = sqlite3.Row

rows = db.execute('''
    SELECT as_of_date, regime, vix_level, yield_curve_spread, breadth_pct, risk_score
    FROM market_regime ORDER BY as_of_date DESC LIMIT 20
''').fetchall()

if not rows:
    print('No regime data yet.')
else:
    print(f'{"Date":<12} {"Regime":<10} {"VIX":>8} {"Yield":>8} {"Breadth":>8} {"Risk":>6}')
    print('-' * 58)
    for r in rows:
        vix = f'{r["vix_level"]:.1f}' if r['vix_level'] else 'n/a'
        yld = f'{r["yield_curve_spread"]:.2f}' if r['yield_curve_spread'] else 'n/a'
        brd = f'{r["breadth_pct"]:.1%}' if r['breadth_pct'] else 'n/a'
        print(f'{r["as_of_date"]:<12} {r["regime"]:<10} {vix:>8} {yld:>8} {brd:>8} {r["risk_score"]:>6.2f}')

db.close()
