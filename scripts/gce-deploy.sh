#!/bin/bash
# Deploy atn-trd to Compute Engine VM
# Run this to update the running container

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
  docker pull ${IMAGE_REPO}:${IMAGE_TAG}
  docker stop atn-trd 2>/dev/null || true
  docker rm atn-trd 2>/dev/null || true
  docker run -d \
    --name atn-trd \
    --restart=unless-stopped \
    -p 8080:8080 \
    -v /mnt/stateful_partition/data:/data \
    --env-file /mnt/stateful_partition/.env \
    ${IMAGE_REPO}:${IMAGE_TAG}
  docker logs -f atn-trd --tail=20 &
  sleep 5
"

echo "=== Deploy complete ==="
echo "App running at: http://\$(gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)'):8080"
