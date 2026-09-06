#!/bin/bash
# View atn-trd service logs from local

gcloud compute ssh atn-trd-vm --zone=us-central1-a --project=autonomous-trader-506715 \
  --command="sudo journalctl -u atn-trd ${*:---tail=100 --no-pager}"
