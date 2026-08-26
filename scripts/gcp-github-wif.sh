#!/bin/bash
# Set up Workload Identity Federation for GitHub Actions

set -e

PROJECT_ID="autonomous-trader-506715"
PROJECT_NUMBER="620929102765"
GITHUB_REPO="nicechester/atn-trd"
RUNNER_SA="atn-trd-runner@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=== Creating Workload Identity Pool ==="
gcloud iam workload-identity-pools create "github" \
  --location="global" \
  --display-name="GitHub Actions" \
  2>/dev/null || echo "Pool already exists"

echo "=== Creating OIDC Provider ==="
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  2>/dev/null || echo "Provider already exists"

echo "=== Granting GitHub repo access to service account ==="
gcloud iam service-accounts add-iam-policy-binding $RUNNER_SA \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Add these GitHub secrets (Settings → Secrets → Actions):"
echo ""
echo "WIF_PROVIDER:"
echo "  projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-provider"
echo ""
echo "WIF_SERVICE_ACCOUNT:"
echo "  ${RUNNER_SA}"
