#!/usr/bin/env python3
"""Filter news CSV to last N years."""
import csv
import sys

csv.field_size_limit(sys.maxsize)

INPUT = "/Volumes/JetDrive/atn-trd/fnspid/news/nasdaq_exteral_data.csv"
OUTPUT = "/Volumes/JetDrive/atn-trd/fnspid/news/news_2y.csv"
CUTOFF = "2021-12-16"  # 2 years from max date 2023-12-16

with open(INPUT, "r", encoding="utf-8", errors="replace") as fin, \
     open(OUTPUT, "w", encoding="utf-8", newline="") as fout:
    reader = csv.DictReader(fin)
    writer = csv.DictWriter(fout, fieldnames=reader.fieldnames)
    writer.writeheader()
    
    kept = 0
    skipped = 0
    for i, row in enumerate(reader):
        date = row.get("Date", "")[:10]
        if date >= CUTOFF:
            writer.writerow(row)
            kept += 1
        else:
            skipped += 1
        
        if (i + 1) % 1_000_000 == 0:
            print(f"  {i+1:,} rows, kept {kept:,}, skipped {skipped:,}")

print(f"Done: {kept:,} rows kept, {skipped:,} skipped")
print(f"Output: {OUTPUT}")
