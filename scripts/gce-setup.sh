#!/bin/bash
# Compute Engine setup for atn-trd
# Run this once to create and configure the VM

set -e

PROJECT_ID="autonomous-trader-506715"
ZONE="us-central1-a"
VM_NAME="atn-trd-vm"
IMAGE_REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/atn-trd/app"

echo "=== Creating VM ==="
gcloud compute instances create $VM_NAME \
  --project=$PROJECT_ID \
  --zone=$ZONE \
  --machine-type=e2-micro \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --tags=http-server,https-server \
  --scopes=cloud-platform

echo "=== Creating firewall rule for port 8080 ==="
gcloud compute firewall-rules create allow-atn-trd-8080 \
  --project=$PROJECT_ID \
  --allow=tcp:8080 \
  --target-tags=http-server \
  --description="Allow atn-trd traffic on port 8080" 2>/dev/null || echo "Firewall rule already exists"

echo "=== Waiting for VM to be ready ==="
sleep 30

echo "=== Configuring Docker auth on VM ==="
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="
  docker-credential-gcr configure-docker --registries=us-central1-docker.pkg.dev
  sudo mkdir -p /mnt/stateful_partition/data
  sudo chmod 777 /mnt/stateful_partition/data
"

echo "=== Setup complete ==="
echo ""
echo "VM external IP:"
gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
echo ""
echo "Next steps:"
echo "1. Build and push image: docker build -t ${IMAGE_REPO}:latest . && docker push ${IMAGE_REPO}:latest"
echo "2. Deploy: ./scripts/gce-deploy.sh"
