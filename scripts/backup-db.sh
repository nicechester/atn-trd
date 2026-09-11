#!/bin/bash
# Backup ATN database with local + GCS rotation

# Load env vars if .env exists
if [ -f "$(dirname "$0")/../.env" ]; then
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

DB_PATH="${ATN_DB_PATH:-./data/atn.db}"
BACKUP_DIR="${ATN_BACKUP_DIR:-./backups}"
KEEP_DAYS="${ATN_BACKUP_KEEP_DAYS:-7}"
GCS_BUCKET="${ATN_GCS_BUCKET:-}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)
BACKUP_FILE="$BACKUP_DIR/atn_$TIMESTAMP.db"

# Use sqlite3 .backup for safe hot backup
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

if [ $? -ne 0 ]; then
  echo "Backup failed" >&2
  exit 1
fi

echo "Local backup created: $BACKUP_FILE"

# Remove local backups older than KEEP_DAYS
find "$BACKUP_DIR" -name "atn_*.db" -mtime +$KEEP_DAYS -delete

# Upload to GCS if bucket is configured
if [ -n "$GCS_BUCKET" ] && command -v gsutil &> /dev/null; then
  # Daily backup (kept for 7 days via lifecycle policy)
  gsutil cp "$BACKUP_FILE" "gs://$GCS_BUCKET/daily/"
  
  # Weekly backup on Sunday
  if [ "$DAY_OF_WEEK" -eq 7 ]; then
    gsutil cp "$BACKUP_FILE" "gs://$GCS_BUCKET/weekly/"
    echo "Weekly backup uploaded"
  fi
  
  # Monthly backup on 1st
  if [ "$DAY_OF_MONTH" -eq "01" ]; then
    gsutil cp "$BACKUP_FILE" "gs://$GCS_BUCKET/monthly/"
    echo "Monthly backup uploaded"
  fi
  
  echo "GCS upload complete"
fi
