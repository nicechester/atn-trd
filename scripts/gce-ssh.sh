#!/bin/bash
# SSH into the atn-trd VM

gcloud compute ssh atn-trd-vm \
  --zone=us-central1-a \
  --project=autonomous-trader-506715
