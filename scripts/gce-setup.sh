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
  --scopes=cloud-platform \
  --metadata=enable-oslogin=TRUE

echo "=== Creating firewall rule for port 8080 ==="
gcloud compute firewall-rules create allow-atn-trd-8080 \
  --project=$PROJECT_ID \
  --allow=tcp:8080 \
  --target-tags=http-server \
  --description="Allow atn-trd traffic on port 8080" 2>/dev/null || echo "Firewall rule already exists"

echo "=== Enabling IAP API ==="
gcloud services enable iap.googleapis.com --project=$PROJECT_ID

echo "=== Granting Cloud Build permissions ==="
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
# Compute Instance Admin for SSH
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1" --quiet
# OS Login for SSH access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/compute.osLogin" --quiet

echo "=== Waiting for VM to be ready ==="
sleep 30

echo "=== Configuring Docker auth on VM ==="
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="
  # Configure Docker auth in writable location (COS has read-only root)
  sudo mkdir -p /mnt/stateful_partition/.docker
  sudo HOME=/mnt/stateful_partition docker-credential-gcr configure-docker --registries=us-central1-docker.pkg.dev
  
  # Create data directory
  sudo mkdir -p /mnt/stateful_partition/data
  sudo chmod 777 /mnt/stateful_partition/data
"

echo "=== Setup complete ==="
echo ""
echo "VM external IP:"
gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
echo ""
echo "Next steps:"
echo "1. Create .env file on VM: ./scripts/gce-ssh.sh then 'sudo vi /mnt/stateful_partition/.env'"
echo "2. Deploy: ./scripts/gce-deploy.sh (or push to main for Cloud Build)"
