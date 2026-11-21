#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-linear-ellipse-513814-b9}"
REGION="${GCP_REGION:-asia-southeast2}"
TF_DIR="${TF_DIR:-.}"
REQUIRED_APIS=(
  "monitoring.googleapis.com"
  "logging.googleapis.com"
  "compute.googleapis.com"
  "sqladmin.googleapis.com"
)

echo "[1/6] Validating CLI prerequisites..."
for bin in gcloud terraform; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: Required binary '${bin}' not found in PATH." >&2
    exit 1
  fi
done

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
  echo "ERROR: No active gcloud account. Run: gcloud auth login && gcloud auth application-default login" >&2
  exit 1
fi
echo "Authenticated as: ${ACTIVE_ACCOUNT} (Project: ${PROJECT_ID})"

echo "[2/6] Enabling required GCP observability APIs..."
gcloud services enable "${REQUIRED_APIS[@]}" --project="${PROJECT_ID}" --quiet

echo "[3/6] Checking Google Cloud Ops Agent status on Compute Engine nodes..."
for pair in "aksaranetra-vm:asia-southeast2-a" "aksaranetra-vm-b:asia-southeast2-b"; do
  vm="${pair%%:*}"
  zone="${pair##*:}"
  if ! gcloud compute instances describe "${vm}" --zone="${zone}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "WARN: Instance ${vm} (${zone}) not found or inaccessible."
  else
    echo "Verified VM present: ${vm} (${zone}). Ensure google-cloud-ops-agent is active for memory metrics."
  fi
done

if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
  echo "ERROR: ${TF_DIR}/terraform.tfvars missing. Create it with sysadmin_email and webhook_url." >&2
  exit 1
fi

echo "[4/6] Running Terraform init, format check, and validation..."
pushd "${TF_DIR}" >/dev/null
terraform init -upgrade
terraform fmt -check -recursive
terraform validate

echo "[5/6] Generating execution plan..."
terraform plan -out=monitoring.tfplan

read -r -p "Apply monitoring.tfplan to project ${PROJECT_ID}? [y/N]: " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted by user. Removing plan file."
  rm -f monitoring.tfplan
  popd >/dev/null
  exit 0
fi

echo "[6/6] Applying Terraform observability stack..."
terraform apply monitoring.tfplan
rm -f monitoring.tfplan
popd >/dev/null
echo "SUCCESS: AksaraNetra Cloud Monitoring stack deployed."
