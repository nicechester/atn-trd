#!/bin/bash
# Create Cloud Scheduler jobs for atn-trd

set -e

PROJECT_ID="autonomous-trader-506715"
REGION="us-central1"
SCHEDULER_SA="atn-trd-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

# Get service URL
SERVICE_URL=$(gcloud run services describe atn-trd --region=$REGION --format='value(status.url)')

if [ -z "$SERVICE_URL" ]; then
  echo "Error: Cloud Run service not found. Run gcp-deploy.sh first."
  exit 1
fi

echo "Service URL: $SERVICE_URL"

echo "=== Granting scheduler permission to invoke Cloud Run ==="
gcloud run services add-iam-policy-binding atn-trd \
  --region=$REGION \
  --member="serviceAccount:$SCHEDULER_SA" \
  --role="roles/run.invoker" \
  --quiet

echo "=== Creating/updating scheduler jobs ==="

# Helper to create or update job
create_job() {
  local name=$1
  local schedule=$2
  local endpoint=$3
  
  if gcloud scheduler jobs describe $name --location=$REGION &>/dev/null; then
    echo "Updating job: $name"
    gcloud scheduler jobs update http $name \
      --location=$REGION \
      --schedule="$schedule" \
      --time-zone="America/New_York" \
      --uri="${SERVICE_URL}${endpoint}" \
      --http-method=POST \
      --oidc-service-account-email=$SCHEDULER_SA \
      --oidc-token-audience=$SERVICE_URL \
      --quiet
  else
    echo "Creating job: $name"
    gcloud scheduler jobs create http $name \
      --location=$REGION \
      --schedule="$schedule" \
      --time-zone="America/New_York" \
      --uri="${SERVICE_URL}${endpoint}" \
      --http-method=POST \
      --oidc-service-account-email=$SCHEDULER_SA \
      --oidc-token-audience=$SERVICE_URL
  fi
}

# 1. Market Open Fill - 9:30 AM ET (Mon-Fri)
create_job "atn-market-open-fill" "30 9 * * 1-5" "/api/trigger/market-open-fill"

# 2. Snapshot - 4:30 PM ET (Mon-Fri)
create_job "atn-snapshot" "30 16 * * 1-5" "/api/trigger/snapshot"

# 3. Trading Cycle - 4:50 PM ET (Mon-Fri)
create_job "atn-trading-cycle" "50 16 * * 1-5" "/api/trigger/trading-cycle"

echo ""
echo "=== Scheduler setup complete ==="
echo ""
echo "Jobs created:"
gcloud scheduler jobs list --location=$REGION --filter="name~atn-"
echo ""
echo "To manually trigger a job:"
echo "  gcloud scheduler jobs run atn-trading-cycle --location=$REGION"
