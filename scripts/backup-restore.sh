#!/bin/bash
# List and restore ATN database backups

# Load env vars if .env exists
if [ -f "$(dirname "$0")/../.env" ]; then
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

DB_PATH="${ATN_DB_PATH:-./data/atn.db}"
BACKUP_DIR="${ATN_BACKUP_DIR:-./backups}"
GCS_BUCKET="${ATN_GCS_BUCKET:-}"

usage() {
  echo "Usage: $0 <command> [options]"
  echo ""
  echo "Commands:"
  echo "  list [daily|weekly|monthly]  List backups (default: all)"
  echo "  restore <backup-name>        Restore from backup"
  echo ""
  echo "Examples:"
  echo "  $0 list"
  echo "  $0 list daily"
  echo "  $0 restore daily/atn_20260911_151358.db"
  echo "  $0 restore ./backups/atn_20260911_151358.db"
  exit 1
}

list_backups() {
  local filter="${1:-}"
  
  echo "=== Local backups ==="
  if [ -d "$BACKUP_DIR" ]; then
    ls -lh "$BACKUP_DIR"/*.db 2>/dev/null || echo "  (none)"
  else
    echo "  (none)"
  fi
  
  if [ -n "$GCS_BUCKET" ]; then
    echo ""
    echo "=== GCS backups ==="
    if [ -n "$filter" ]; then
      gcloud storage ls -l "gs://$GCS_BUCKET/$filter/" 2>/dev/null || echo "  (none)"
    else
      for tier in daily weekly monthly; do
        echo "[$tier]"
        gcloud storage ls -l "gs://$GCS_BUCKET/$tier/" 2>/dev/null || echo "  (none)"
      done
    fi
  fi
}

restore_backup() {
  local backup="$1"
  
  if [ -z "$backup" ]; then
    echo "Error: backup name required" >&2
    usage
  fi
  
  # Check if service is running
  if systemctl is-active --quiet atn-trd 2>/dev/null; then
    echo "Error: atn-trd service is running. Stop it first:" >&2
    echo "  sudo systemctl stop atn-trd" >&2
    exit 1
  fi
  
  local restore_file=""
  
  # Determine source (local or GCS)
  if [[ "$backup" == ./* ]] || [[ "$backup" == /* ]]; then
    # Local file path
    restore_file="$backup"
  elif [ -f "$BACKUP_DIR/$backup" ]; then
    # Local backup by name
    restore_file="$BACKUP_DIR/$backup"
  elif [ -n "$GCS_BUCKET" ]; then
    # Download from GCS
    echo "Downloading from GCS..."
    local tmp_file="/tmp/atn_restore_$$.db"
    gcloud storage cp "gs://$GCS_BUCKET/$backup" "$tmp_file" || exit 1
    restore_file="$tmp_file"
  else
    echo "Error: backup not found: $backup" >&2
    exit 1
  fi
  
  # Verify it's a valid SQLite file
  if ! sqlite3 "$restore_file" "SELECT 1 FROM schema_migrations LIMIT 1" &>/dev/null; then
    echo "Error: invalid database file" >&2
    exit 1
  fi
  
  # Backup current db before restore
  if [ -f "$DB_PATH" ]; then
    local pre_restore="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).db"
    mkdir -p "$BACKUP_DIR"
    cp "$DB_PATH" "$pre_restore"
    echo "Current db backed up to: $pre_restore"
  fi
  
  # Restore
  cp "$restore_file" "$DB_PATH"
  echo "Restored: $backup -> $DB_PATH"
  echo ""
  echo "Start the service:"
  echo "  sudo systemctl start atn-trd"
}

case "${1:-}" in
  list)
    list_backups "$2"
    ;;
  restore)
    restore_backup "$2"
    ;;
  *)
    usage
    ;;
esac
