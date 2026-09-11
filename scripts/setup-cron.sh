#!/bin/bash
# Set up daily database backup cron job

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CRON_ENTRY="0 2 * * * cd $PROJECT_DIR && ./scripts/backup-db.sh >> ~/atn-backup.log 2>&1"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "backup-db.sh"; then
  echo "Backup cron job already exists"
  crontab -l | grep "backup-db.sh"
  exit 0
fi

# Add cron entry
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "Cron job added:"
echo "$CRON_ENTRY"
