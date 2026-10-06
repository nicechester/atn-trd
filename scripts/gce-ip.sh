#!/bin/bash
# Get the external IP address of the atn-trd VM

gcloud compute instances describe atn-trd-vm \
  --zone=us-central1-a \
  --project=autonomous-trader-506715 \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
