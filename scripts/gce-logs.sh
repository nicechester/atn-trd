#!/bin/bash
# View atn-trd service logs from local
# Usage: ./scripts/gce-logs.sh [-f] [-n 100] [other journalctl options]
# Examples:
#   ./scripts/gce-logs.sh -f          # follow logs
#   ./scripts/gce-logs.sh -n 50       # last 50 lines
#   ./scripts/gce-logs.sh --since "1 hour ago"

gcloud compute ssh atn-trd-vm --zone=us-central1-a --project=autonomous-trader-506715 \
  --command="sudo journalctl -u atn-trd --no-pager $*"
