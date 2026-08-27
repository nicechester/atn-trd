#!/bin/bash
# Deploy atn-trd to Compute Engine VM
# Run this to manually update the running container (or push to main for Cloud Build)

set -e

PROJECT_ID="autonomous-trader-506715"
ZONE="us-central1-a"
VM_NAME="atn-trd-vm"
IMAGE_REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/atn-trd/app"
IMAGE_TAG="${1:-latest}"

echo "=== Building image ==="
docker build -t ${IMAGE_REPO}:${IMAGE_TAG} .

echo "=== Pushing image ==="
docker push ${IMAGE_REPO}:${IMAGE_TAG}

echo "=== Deploying to VM ==="
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="
  sudo docker --config /mnt/stateful_partition/.docker pull ${IMAGE_REPO}:${IMAGE_TAG}
  sudo docker stop atn-trd 2>/dev/null || true
  sudo docker rm atn-trd 2>/dev/null || true
  sudo docker run -d \
    --name atn-trd \
    --restart=unless-stopped \
    -p 8080:8080 \
    -v /mnt/stateful_partition/data:/app/data \
    --env-file /mnt/stateful_partition/.env \
    ${IMAGE_REPO}:${IMAGE_TAG}
  echo '=== Container started ==='
  sudo docker ps
"

VM_IP=$(gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo ""
echo "=== Deploy complete ==="
echo "App running at: http://${VM_IP}:8080"
