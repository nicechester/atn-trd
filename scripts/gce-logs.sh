#!/bin/bash
# View atn-trd container logs from local

gcloud compute ssh atn-trd-vm --zone=us-central1-a --project=autonomous-trader-506715 --command="docker logs atn-trd ${*:---tail=100}"
