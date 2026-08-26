#!/bin/bash
# GCP Cloud Run setup script for atn-trd
# Run this once to set up all infrastructure

set -e

PROJECT_ID="autonomous-trader-506715"
REGION="us-central1"
BUCKET_NAME="${PROJECT_ID}-data"

echo "=== Setting project ==="
gcloud config set project $PROJECT_ID

echo "=== Creating Artifact Registry ==="
gcloud artifacts repositories create atn-trd \
  --repository-format=docker \
  --location=$REGION \
  --description="ATN Trading Docker images" \
  2>/dev/null || echo "Artifact Registry already exists"

echo "=== Creating Cloud Storage bucket ==="
gcloud storage buckets create gs://$BUCKET_NAME --location=$REGION \
  2>/dev/null || echo "Bucket already exists"

echo "=== Creating secrets ==="
# Helper function to create secret if it doesn't exist
create_secret() {
  local name=$1
  local value=$2
  if gcloud secrets describe $name &>/dev/null; then
    echo "Secret $name already exists, updating..."
    echo -n "$value" | gcloud secrets versions add $name --data-file=-
  else
    echo "Creating secret $name..."
    echo -n "$value" | gcloud secrets create $name --data-file=-
  fi
}

create_secret "ATN_ENC_KEY" "04ad6b71d879f190c1c5041a0c82500ebd81558f52fb4e455ec02dde841339a2"
create_secret "FRED_API_KEY" "9f8ec31619a4a7265eb90c8e4cd294ed"
create_secret "FINNHUB_API_KEY" "da2s0r1r01qupvfajtugda2s0r1r01qupvfajtv0"
create_secret "ALPACA_API_KEY" "PKMQUW6RCTO6IISHEHD4FMI5AO"
create_secret "ALPACA_API_SECRET" "EPxiNpc7Ho95BP8ABpmStikqWK1BqVQVrqggG2h8vrZw"
create_secret "LLM_API_KEY" "AIzaSyCIdItF6NsLEaTqbgn44FbGxZ70axCbmLw"

# Auth passwords
create_secret "AUTH_PASSWORD_CHESTER" "${AUTH_PASSWORD_CHESTER:-changeme}"
create_secret "AUTH_PASSWORD_GUEST" "${AUTH_PASSWORD_GUEST:-guest}"

echo "=== Creating service accounts ==="
# Cloud Run service account
gcloud iam service-accounts create atn-trd-runner \
  --display-name="ATN Trading Runner" \
  2>/dev/null || echo "Service account atn-trd-runner already exists"

# Cloud Scheduler service account
gcloud iam service-accounts create atn-trd-scheduler \
  --display-name="ATN Trading Scheduler" \
  2>/dev/null || echo "Service account atn-trd-scheduler already exists"

echo "=== Granting permissions ==="
RUNNER_SA="atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant secret access
for secret in ATN_ENC_KEY FRED_API_KEY FINNHUB_API_KEY ALPACA_API_KEY ALPACA_API_SECRET LLM_API_KEY AUTH_PASSWORD_CHESTER AUTH_PASSWORD_GUEST; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$RUNNER_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

# Grant storage access
gcloud storage buckets add-iam-policy-binding gs://$BUCKET_NAME \
  --member="serviceAccount:$RUNNER_SA" \
  --role="roles/storage.objectAdmin" \
  --quiet

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Build and push Docker image: ./scripts/gcp-deploy.sh"
echo "2. Create Cloud Scheduler jobs: ./scripts/gcp-scheduler.sh"
