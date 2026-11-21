# AksaraNetra — GCP Regional MIG & Cloud SQL HA Terraform IaC

Production-ready, modular Terraform Infrastructure as Code (Google Provider `>= 5.0.0, < 6.0.0`) migrating **AksaraNetra** from 2 manually managed Compute Engine VMs (Unmanaged Instance Groups) to a resilient, private-network **Regional Managed Instance Group (Regional MIG)** behind a **Global External Application Load Balancer (ALB)** in `asia-southeast2` (Jakarta).

---

## 1. What This Infrastructure Does

| Layer | Module | Provisioned Architecture |
| :--- | :--- | :--- |
| **Network & Security** | `modules/vpc` | Custom VPC (`aksaranetra-vpc`), private subnet (`10.184.0.0/20`) with Private Google Access, `/16` Private Services Access (PSA) peering range for Cloud SQL, Cloud Router + Cloud NAT for outbound internet (zero public IPs on VMs), and strict firewall rules (LB/Health Checks `130.211.0.0/22`, `35.191.0.0/16` on TCP `80/3000/8787`; Cloud IAP SSH `35.235.240.0/20` on TCP `22`; internal subnet traffic). |
| **Managed Database** | `modules/cloud_sql` | Cloud SQL PostgreSQL 16 (`aksaranetra-pg16-ha`, `db-custom-1-3840`), Regional HA across `asia-southeast2-a` and `asia-southeast2-b`, 10 GB `PD_SSD` (autoresize up to 50 GB), Private IP only, `ENCRYPTED_ONLY` TLS, 7-day automated backups + Point-in-Time Recovery (PITR), database `aksaranetra`, and user `aksaranetra_user`. |
| **Compute & Autoscaling** | `modules/mig` | Least-privilege VM Service Account (`aksaranetra-mig-sa`), immutable Shielded Ubuntu 22.04 LTS Instance Template (`e2-medium`, `create_before_destroy = true`), Regional MIG (`aksaranetra-rmig`) balanced `EVEN` across zones `a` & `b`, auto-healing on HTTP `8787/health` (`initial_delay_sec = 300`), CPU autoscaler (`min = 2`, `max = 3`, target `70%`), and automated Docker CE + Compose v2 bootstrap (`scripts/startup.sh`) deploying Next.js (`3000`), PHP API (`8787`), and Playwright worker (`4000`). |
| **Global Edge & Routing** | `modules/alb` | Global Static IPv4 (`aksaranetra-alb-ip`), Google-Managed SSL Certificate (`aksaranetra.rafifernanda.site`), `EXTERNAL_MANAGED` HTTPS Load Balancer (port `443`) with path-based routing (`/api` & `/api/*` rewritten to `/` -> PHP API `:8787`; default `/*` -> Next.js `:3000`), and permanent HTTP (`80`) to HTTPS (`443`) 301 redirect. |

### Key GCP Provider v5.x Guardrails Built In
- **Regional MIG Rolling Update Safety (`modules/mig/main.tf`):** `max_surge_fixed = length(var.zones)` (`2`) with `max_unavailable_fixed = 0` satisfies GCP's Regional MIG rule requiring surge to be `0` or `>= number of zones`.
- **Deadlock-Free `terraform destroy` (`modules/vpc/main.tf` & `modules/cloud_sql/main.tf`):** `google_service_networking_connection` uses `deletion_policy = "ABANDON"` and Cloud SQL exposes configurable `db_deletion_protection` (default `false` for demo teardown; toggle `true` for permanent production) applied to both Terraform state and GCP API protection.
- **v5.x Schema Compliance:** Uses `ssl_mode = "ENCRYPTED_ONLY"` (replacing deprecated `require_ssl`) and derives managed SSL status cleanly from `expire_time` since v5.x omits `.status`.

---

## 2. Repository Structure

```text
.
├── .gitignore
├── README.md
├── versions.tf
├── variables.tf
├── terraform.tfvars.example
├── main.tf
├── outputs.tf
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── cloud_sql/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── mig/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── outputs.tf
    │   └── scripts/
    │       └── startup.sh
    └── alb/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

---

## 3. Root Outputs Reference

Run `terraform output` after `terraform apply` to inspect all exported infrastructure values:

| Output Name | Type | Description & Usage |
| :--- | :--- | :--- |
| `load_balancer_ip` | `string` | Global Static IPv4 address for Cloudflare DNS-Only (`Grey Cloud`) A record pointing `aksaranetra.rafifernanda.site`. |
| `cloud_sql_private_ip` | `string` | Private RFC1918 IPv4 address allocated on the VPC PSA peering network (auto-injected into `backend.env` as `DB_HOST`). |
| `cloud_sql_connection_name` | `string` | Cloud SQL instance connection identifier (`linear-ellipse-513814-b9:asia-southeast2:aksaranetra-pg16-ha`) for Cloud SQL Auth Proxy or diagnostics. |
| `mig_name` | `string` | Name of the Regional Managed Instance Group (`aksaranetra-rmig`). |
| `mig_target_size` | `number` | Current VM replica count managed by the Regional Autoscaler (`2`–`3`). |
| `ssl_certificate_status` | `object` | Map containing `certificate_id`, `certificate_name`, `domains`, `expire_time`, and `derived_status` (`ACTIVE` once `expire_time` populates, else `PROVISIONING_OR_PENDING_DNS`). |

---

## 4. Quickstart Deployment & Verification

### Step 1: Enable Required GCP APIs
```bash
gcloud config set project linear-ellipse-513814-b9

gcloud services enable \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  servicenetworking.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

### Step 2: Configure Variables & Apply
```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars and set a strong db_password (never commit terraform.tfvars)

terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

### Step 3: Cloudflare DNS-Only Cutover & SSL Check
```bash
terraform output load_balancer_ip
terraform output ssl_certificate_status

# Cloudflare DNS (rafifernanda.site):
# Type: A | Name: aksaranetra | Content: <load_balancer_ip> | Proxy: DNS only (Grey Cloud)

dig +short A aksaranetra.rafifernanda.site

gcloud compute ssl-certificates describe aksaranetra-managed-cert \
  --global \
  --format="table(name,managed.status,managed.domainStatus)"
```

### Step 4: Verify Runtime, Routing & IAP Access
```bash
curl -I http://aksaranetra.rafifernanda.site
curl -fsS -I https://aksaranetra.rafifernanda.site/
curl -fsS https://aksaranetra.rafifernanda.site/api/health

gcloud compute instance-groups managed list-instances aksaranetra-rmig \
  --region=asia-southeast2

gcloud compute ssh <INSTANCE_NAME> \
  --zone=asia-southeast2-a \
  --tunnel-through-iap \
  --command="sudo tail -n 50 /var/log/aksaranetra-startup.log && sudo docker ps"
```

### Step 5: Safe Teardown
```bash
# Ensure db_deletion_protection = false in terraform.tfvars
terraform destroy -auto-approve
```
