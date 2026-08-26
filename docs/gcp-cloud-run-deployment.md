# GCP Cloud Run Deployment Guide

This guide covers deploying atn-trd to Google Cloud Run with a scales-to-zero architecture.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Cloud          │────▶│  Cloud Run       │────▶│  Cloud Storage  │
│  Scheduler      │     │  (scales to 0)   │     │  (SQLite data)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
       │                         │
       │                         ▼
       │                ┌─────────────────┐
       │                │  Secret Manager │
       │                │  (API keys)     │
       │                └─────────────────┘
       │
       ▼
  3 scheduled jobs:
  - 9:30 AM ET: Fill orders at market open
  - 4:30 PM ET: Portfolio snapshot
  - 4:50 PM ET: Trading cycle
```

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Docker installed (for local testing)

## Step 1: Create GCP Project

```bash
# Set your project ID (must be globally unique)
export PROJECT_ID="atn-trd-prod"
export REGION="us-central1"

# Create project
gcloud projects create $PROJECT_ID --name="ATN Trading"

# Set as default
gcloud config set project $PROJECT_ID

# Link billing account (get ID from console or `gcloud billing accounts list`)
gcloud billing projects link $PROJECT_ID --billing-account=YOUR_BILLING_ACCOUNT_ID
```

## Step 2: Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com
```

## Step 3: Create Artifact Registry Repository

```bash
gcloud artifacts repositories create atn-trd \
  --repository-format=docker \
  --location=$REGION \
  --description="ATN Trading Docker images"
```

## Step 4: Create Cloud Storage Bucket for SQLite Data

```bash
# Create bucket for persistent data
export BUCKET_NAME="${PROJECT_ID}-data"
gcloud storage buckets create gs://$BUCKET_NAME --location=$REGION

# The SQLite database will be stored here via Cloud Run volume mount
```

## Step 5: Set Up Secrets in Secret Manager

```bash
# Create secrets for API keys
echo -n "your-gemini-api-key" | gcloud secrets create LLM_API_KEY --data-file=-
echo -n "your-finnhub-api-key" | gcloud secrets create FINNHUB_API_KEY --data-file=-

# Optional: Add more secrets as needed
# echo -n "your-openai-key" | gcloud secrets create OPENAI_API_KEY --data-file=-
```

## Step 6: Create Service Accounts

```bash
# Service account for Cloud Run
gcloud iam service-accounts create atn-trd-runner \
  --display-name="ATN Trading Runner"

# Service account for Cloud Scheduler
gcloud iam service-accounts create atn-trd-scheduler \
  --display-name="ATN Trading Scheduler"

# Grant Cloud Run service account access to secrets
gcloud secrets add-iam-policy-binding LLM_API_KEY \
  --member="serviceAccount:atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding FINNHUB_API_KEY \
  --member="serviceAccount:atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Grant Cloud Run service account access to storage bucket
gcloud storage buckets add-iam-policy-binding gs://$BUCKET_NAME \
  --member="serviceAccount:atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

## Step 7: Build and Push Docker Image

```bash
# Configure Docker for Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Build and push (from repo root)
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest
```

## Step 8: Deploy to Cloud Run

```bash
gcloud run deploy atn-trd \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest \
  --region=$REGION \
  --platform=managed \
  --service-account=atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com \
  --min-instances=0 \
  --max-instances=1 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=900 \
  --set-secrets="LLM_API_KEY=LLM_API_KEY:latest,FINNHUB_API_KEY=FINNHUB_API_KEY:latest" \
  --set-env-vars="NODE_ENV=production,ATN_DATA_DIR=/data" \
  --execution-environment=gen2 \
  --add-volume=name=data-volume,type=cloud-storage,bucket=$BUCKET_NAME \
  --add-volume-mount=volume=data-volume,mount-path=/data \
  --allow-unauthenticated

# Note: --allow-unauthenticated enables UI access. For trigger endpoints,
# we use OIDC authentication via Cloud Scheduler.

# Get the service URL
export SERVICE_URL=$(gcloud run services describe atn-trd --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"
```

## Step 9: Grant Scheduler Permission to Invoke Cloud Run

```bash
# Allow scheduler service account to invoke Cloud Run
gcloud run services add-iam-policy-binding atn-trd \
  --region=$REGION \
  --member="serviceAccount:atn-trd-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## Step 10: Create Cloud Scheduler Jobs

```bash
# 1. Market Open Fill Job - 9:30 AM ET (Mon-Fri)
gcloud scheduler jobs create http atn-market-open-fill \
  --location=$REGION \
  --schedule="30 9 * * 1-5" \
  --time-zone="America/New_York" \
  --uri="${SERVICE_URL}/api/trigger/market-open-fill" \
  --http-method=POST \
  --oidc-service-account-email=atn-trd-scheduler@${PROJECT_ID}.iam.gserviceaccount.com \
  --oidc-token-audience=$SERVICE_URL

# 2. Snapshot Job - 4:30 PM ET (Mon-Fri)
gcloud scheduler jobs create http atn-snapshot \
  --location=$REGION \
  --schedule="30 16 * * 1-5" \
  --time-zone="America/New_York" \
  --uri="${SERVICE_URL}/api/trigger/snapshot" \
  --http-method=POST \
  --oidc-service-account-email=atn-trd-scheduler@${PROJECT_ID}.iam.gserviceaccount.com \
  --oidc-token-audience=$SERVICE_URL

# 3. Trading Cycle Job - 4:50 PM ET (Mon-Fri)
gcloud scheduler jobs create http atn-trading-cycle \
  --location=$REGION \
  --schedule="50 16 * * 1-5" \
  --time-zone="America/New_York" \
  --uri="${SERVICE_URL}/api/trigger/trading-cycle" \
  --http-method=POST \
  --oidc-service-account-email=atn-trd-scheduler@${PROJECT_ID}.iam.gserviceaccount.com \
  --oidc-token-audience=$SERVICE_URL
```

## Step 11: Set Up GitHub Actions (Optional)

Create `.github/workflows/deploy.yml` for auto-deploy on push to main.

Required GitHub secrets:
- `GCP_PROJECT_ID`: Your project ID
- `GCP_SA_KEY`: Service account key JSON with Cloud Build and Cloud Run permissions

See `.github/workflows/deploy.yml` in this repo.

## Verification

```bash
# Test the service is running
curl $SERVICE_URL/api/health

# Manually trigger a job (for testing)
gcloud scheduler jobs run atn-trading-cycle --location=$REGION

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=atn-trd" --limit=50
```

## Cost Estimate

| Service | Estimated Monthly Cost |
|---------|----------------------|
| Cloud Run | $2-5 (scales to 0, ~15 min/day execution) |
| Cloud Scheduler | Free (3 jobs within free tier) |
| Cloud Storage | <$1 (SQLite DB ~10-50MB) |
| Secret Manager | Free (6 secrets within free tier) |
| Artifact Registry | <$1 (single image) |
| **Total** | **~$3-7/month** |

## Troubleshooting

### Cold Start Latency
First request after idle may take 5-10 seconds. This is normal for scales-to-zero.

### SQLite Locking with Cloud Storage
Cloud Storage FUSE mount may have latency. If you experience issues:
1. Consider Cloud SQL PostgreSQL (~$7-10/mo additional)
2. Or use Firestore (requires schema migration)

### Rate Limits
Gemini free tier: 15 RPM. The rate-limited LLM singleton handles this automatically with exponential backoff.

### Viewing Logs
```bash
# Real-time logs
gcloud run services logs tail atn-trd --region=$REGION

# Historical logs
gcloud logging read "resource.type=cloud_run_revision" --limit=100 --format="table(timestamp,textPayload)"
```

## Updating the Deployment

```bash
# Rebuild and push new image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest

# Deploy new revision
gcloud run deploy atn-trd \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/atn-trd/app:latest \
  --region=$REGION
```

Or use GitHub Actions for automatic deployment on push to main.
