#!/usr/bin/env bash
# Prints proposed commands ONLY. Never invokes gcloud or reads credentials.
set -euo pipefail
readonly project=linear-ellipse-513814-b9
[[ ${GCP_PROJECT:-} == "$project" ]] || { echo "Set GCP_PROJECT=$project; other projects forbidden" >&2; exit 64; }
# Fixed names deliberately constrain scope; network/subnet prerequisites reviewed separately.
cat <<'COMMANDS'
# NOT APPROVED / NOT EXECUTED. Quote, IAM, network, SQL tier and backend gates apply.
# Every command explicitly targets linear-ellipse-513814-b9.
# Prerequisites: dedicated aksara-ha VPC, regional aksara-ha subnet, Private Google Access,
# approved egress/NAT, private-service access for SQL; attached least-privilege VM identity.
# SQL candidate: regional HA, PostgreSQL, 1 vCPU / 3.75 GiB, 10 GiB SSD.
# NO SQL creation command: tier support/price, PITR/backup and storage-growth costs unverified.
# Private regional bucket proposal; execute only after location/name/retention approval:
gcloud storage buckets create gs://linear-ellipse-513814-b9-ha-artifacts --project=linear-ellipse-513814-b9 --location=asia-southeast2 --uniform-bucket-level-access --public-access-prevention

# No startup script, downloads or package installation. Approved VM setup required later.
gcloud compute instances create aksara-ha-a --project=linear-ellipse-513814-b9 --zone=asia-southeast2-a --machine-type=e2-medium --boot-disk-size=30GB --boot-disk-type=pd-standard --image-family=debian-12 --image-project=debian-cloud --network=aksara-ha --subnet=aksara-ha --no-address --tags=aksara-ha --service-account=aksara-ha@linear-ellipse-513814-b9.iam.gserviceaccount.com --scopes=cloud-platform --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE --shielded-secure-boot
gcloud compute instances create aksara-ha-b --project=linear-ellipse-513814-b9 --zone=asia-southeast2-b --machine-type=e2-medium --boot-disk-size=30GB --boot-disk-type=pd-standard --image-family=debian-12 --image-project=debian-cloud --network=aksara-ha --subnet=aksara-ha --no-address --tags=aksara-ha --service-account=aksara-ha@linear-ellipse-513814-b9.iam.gserviceaccount.com --scopes=cloud-platform --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE --shielded-secure-boot
COMMANDS
for zone in a b; do
    printf 'gcloud compute instance-groups unmanaged create aksara-ha-%s --project=%s --zone=asia-southeast2-%s\n' "$zone" "$project" "$zone"
    printf 'gcloud compute instance-groups unmanaged add-instances aksara-ha-%s --instances=aksara-ha-%s --project=%s --zone=asia-southeast2-%s\n' "$zone" "$zone" "$project" "$zone"
    printf 'gcloud compute instance-groups unmanaged set-named-ports aksara-ha-%s --named-ports=frontend:3000,api:8787 --project=%s --zone=asia-southeast2-%s\n' "$zone" "$project" "$zone"
done
cat <<'COMMANDS'
gcloud compute firewall-rules create aksara-ha-lb --project=linear-ellipse-513814-b9 --network=aksara-ha --direction=INGRESS --action=ALLOW --rules=tcp:3000,tcp:8787 --source-ranges=35.191.0.0/16,130.211.0.0/22 --target-tags=aksara-ha
gcloud compute health-checks create http aksara-ha-api --project=linear-ellipse-513814-b9 --port=8787 --request-path=/health --check-interval=10s --timeout=5s --healthy-threshold=2 --unhealthy-threshold=3
gcloud compute health-checks create http aksara-ha-web --project=linear-ellipse-513814-b9 --port=3000 --request-path=/ --check-interval=10s --timeout=5s --healthy-threshold=2 --unhealthy-threshold=3
COMMANDS
for role in api web; do
    port=api; [[ $role == api ]] || port=frontend
    printf 'gcloud compute backend-services create aksara-ha-%s --project=%s --global --load-balancing-scheme=EXTERNAL_MANAGED --protocol=HTTP --port-name=%s --health-checks=aksara-ha-%s --timeout=60s\n' "$role" "$project" "$port" "$role"
    for zone in a b; do
        printf 'gcloud compute backend-services add-backend aksara-ha-%s --project=%s --global --instance-group=aksara-ha-%s --instance-group-zone=asia-southeast2-%s --balancing-mode=UTILIZATION --max-utilization=0.8\n' "$role" "$project" "$zone" "$zone"
    done
done
cat <<'COMMANDS'
# Run from repo root. URL map file intentionally contains fixed project resource URLs.
gcloud compute url-maps import aksara-ha --project=linear-ellipse-513814-b9 --global --source=infra/ha/url-map.yml
gcloud compute addresses create aksara-ha-ip --project=linear-ellipse-513814-b9 --global --ip-version=IPV4 --network-tier=PREMIUM
gcloud compute ssl-certificates create aksara-ha-cert --project=linear-ellipse-513814-b9 --global --domains=aksaranetra.rafifernanda.site
gcloud compute target-https-proxies create aksara-ha-https --project=linear-ellipse-513814-b9 --global --url-map=aksara-ha --ssl-certificates=aksara-ha-cert
gcloud compute forwarding-rules create aksara-ha-https --project=linear-ellipse-513814-b9 --global --load-balancing-scheme=EXTERNAL_MANAGED --network-tier=PREMIUM --address=aksara-ha-ip --target-https-proxy=aksara-ha-https --ports=443
# No port 80 listener. HTTP fails closed; add explicit HTTPS redirect only after approval.
COMMANDS
