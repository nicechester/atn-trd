#!/bin/bash
# Deploy atn-trd to Compute Engine VM
# Pulls latest code and restarts the service

set -e

PROJECT_ID="autonomous-trader-506715"
ZONE="us-central1-a"
VM_NAME="atn-trd-vm"

echo "=== Deploying to VM ==="
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="
  cd ~/atn-trd
  git pull
  npm install --omit=dev
  sudo systemctl restart atn-trd
  echo '=== Service restarted ==='
  sudo systemctl status atn-trd --no-pager
"

VM_IP=$(gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo ""
echo "=== Deploy complete ==="
echo "App running at: http://${VM_IP}:8080"
