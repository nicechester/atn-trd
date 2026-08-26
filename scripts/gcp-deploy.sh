#!/bin/bash
# Build and deploy to Cloud Run

set -e

PROJECT_ID="autonomous-trader-506715"
REGION="us-central1"
BUCKET_NAME="${PROJECT_ID}-data"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest"

echo "=== Configuring Docker for Artifact Registry ==="
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

echo "=== Building Docker image (linux/amd64) ==="
docker build --platform linux/amd64 -t $IMAGE .

echo "=== Pushing to Artifact Registry ==="
docker push $IMAGE

echo "=== Deploying to Cloud Run ==="
gcloud run deploy atn-trd \
  --image=$IMAGE \
  --region=$REGION \
  --platform=managed \
  --service-account=atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com \
  --min-instances=0 \
  --max-instances=1 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=900 \
  --set-secrets="ATN_ENC_KEY=ATN_ENC_KEY:latest,LLM_API_KEY=LLM_API_KEY:latest,FINNHUB_API_KEY=FINNHUB_API_KEY:latest,FRED_API_KEY=FRED_API_KEY:latest,ALPACA_API_KEY=ALPACA_API_KEY:latest,ALPACA_API_SECRET=ALPACA_API_SECRET:latest" \
  --set-env-vars="NODE_ENV=production,ATN_DATA_DIR=/data,LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/,LLM_MODEL=gemini-3.1-flash-lite" \
  --execution-environment=gen2 \
  --add-volume=name=data-volume,type=cloud-storage,bucket=$BUCKET_NAME \
  --add-volume-mount=volume=data-volume,mount-path=/data \
  --allow-unauthenticated

# Get service URL
SERVICE_URL=$(gcloud run services describe atn-trd --region=$REGION --format='value(status.url)')
echo ""
echo "=== Deployment complete ==="
echo "Service URL: $SERVICE_URL"
echo ""
echo "Test with: curl $SERVICE_URL/api/health"
