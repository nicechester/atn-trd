#!/bin/bash
# SSH into the atn-trd VM

# Ensure correct project context
gcloud config set project autonomous-trader-506715 --quiet 2>/dev/null

gcloud compute ssh atn-trd-vm \
  --zone=us-central1-a \
  --project=autonomous-trader-506715
