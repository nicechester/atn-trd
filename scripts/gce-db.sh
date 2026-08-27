#!/bin/bash
# Query atn-trd SQLite database from local
# Usage: ./scripts/gce-db.sh "SELECT * FROM assessments LIMIT 5;"

if [ -z "$1" ]; then
  echo "Usage: $0 \"SQL query\""
  echo "Example: $0 \"SELECT COUNT(*) FROM assessments;\""
  exit 1
fi

gcloud compute ssh atn-trd-vm --zone=us-central1-a --project=autonomous-trader-506715 --command="docker exec atn-trd sqlite3 /app/data/atn.db '$1'"
