# HA release artifacts — PROPOSED, NOT DEPLOYED

Only project `linear-ellipse-513814-b9`. No cloud commands executed. Production `.github/workflows/deploy.yml` unchanged; **do not merge/push main**: existing workflow still auto-deploys and contains unsafe Docker socket permissions. Replace that workflow only under separate rollout approval.

## Topology and approval gates

Two identical `e2-medium` VMs in `asia-southeast2-a` / `asia-southeast2-b`: 30 GB `pd-standard` HDD boot disk each; requested 3 GiB swap each (not physical RAM, not configured by these scripts). Each runs frontend, PHP API and one audit worker. Local `/data` is expendable scratch only. No SQLite/shared filesystem for durable HA state. Container limits leave host headroom but surviving-node browser workload must be measured. This does not prove capacity or availability.

Global external managed HTTPS LB routes `/health`, `/audits`, `/audits/*` to API port 8787; all other paths to frontend 3000. Firewall permits those ports only from Google's health-check/GFE ranges. No public VM addresses. No port 80 listener. No sticky sessions. Unmanaged zonal groups provide routing, **not automatic VM repair**.

Regional HA Cloud SQL PostgreSQL candidate: 1 vCPU / 3.75 GiB, 10 GiB SSD. Tier/edition/HA availability and Jakarta price **unverified**; no create command supplied. Approve full quote first: both VMs/disks, SQL primary/standby/backups/PITR/storage growth, LB/data processing/global IP, NAT/egress, private GCS/operations/retention, registry/logs/transfer. Budget alerts are not spending caps.

## Files and offline checks

`GCP_PROJECT=linear-ellipse-513814-b9 bash infra/ha/render.sh` only prints proposed commands. Never pipe its output into shell. Network/IAM/SQL prerequisite setup deliberately omitted until approval. No Terraform, downloads, installation or credential access needed for rendering/checks.

Run `/usr/bin/python3 infra/ha/check.py` (existing system PyYAML required), `bash -n infra/ha/*.sh`, `sh -n php-backend/docker/entrypoint.sh`. These are static/mocked checks, not Docker build, GCP schema validation, live health or failover tests.

## Backend interface gates — MUST finish before release

- `HA_MODE=1`, `RUN_MIGRATIONS=0`, `DB_CONNECTION=pgsql`; PDO PostgreSQL extension added to image. Existing API legacy startup still migrates when HA off, unless `RUN_MIGRATIONS=0`. HA rejects automatic migration flags. Explicit `migrate` command needs `MIGRATION_APPROVED=1`.
- Backend store must actually select PostgreSQL using `DB_*`; Laravel migration connection and job-store connection must agree. Baseline uses custom SQLite store; env alone cannot convert it. Verify `DB_SSLMODE=verify-full` and CA mapping in both implementations; certificate hostname must match `DB_HOST`. Client-certificate policy, if required, needs additional read-only mounts/config.
- Require transaction claims, per-attempt expiring leases, heartbeats, bounded retries, idle polling, token-fenced updates/completion and cancellation. Never requeue another node's healthy running jobs on startup. PostgreSQL advisory migration lock or **single external operator** must serialize migration; script does not create distributed lock.
- `ARTIFACT_STORE=gcs`, `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT` are proposed adapter interface, **not implemented here**. Private ADC-authenticated immutable attempt uploads, fenced manifest publication and authorized/expiring reads required. Local artifacts cannot serve HA across VMs. Do not launch replicas before this gate passes.
- `/health` must report readiness for shared SQL/schema and required artifact service; current shallow endpoint is insufficient proof. Do not send live traffic until readiness semantics verified. Bind trust-proxy behavior to known LB ingress; firewall must exclude arbitrary clients. Global rate limits must use shared state or explicitly document per-node limitation.
- Frontend images must be built with both public backend URL variables set to `https://aksaranetra.rafifernanda.site`; Next.js public env is build-time, not repaired by Compose runtime env.

## Manual release after cost + rollout approval

1. Approve quote, SQL tier/HA support, region, IAM, network/egress and backend gates. Dedicated VPC/subnet, Private Google Access, approved NAT, SQL private-service access, private SQL instance and DNS/TLS are prerequisites. No automatic API enablement here.
2. Approved VM setup must separately install Docker/Compose, create 3 GiB swap mode 600 and persist it, harden OS, enable logging/rotation, and preload approved image digests. Never make Docker socket world-writable. Restricted authorized deployment identity only. Private VMs need approved registry and Chromium audit egress. Treat arbitrary-URL audits as SSRF boundary; backend must block metadata/private destinations and redirects (attached VM identity is sensitive).
3. Attach `aksara-ha@linear-ellipse-513814-b9.iam.gserviceaccount.com`, granting only required registry read, SQL access, selected secret versions and private bucket object operations. No service-account keys. Approved secret delivery produces outside-git mode-600 backend env file on both VMs, readable by authorized Docker operator; CA file readable by UID 1000. Same `APP_KEY` and >=32-character `BACKEND_SECRET` across nodes. Never print env or run `docker compose config` into logs. Container env remains visible to Docker administrators.
4. Set `GCP_PROJECT`, `BACKEND_IMAGE`, `FRONTEND_IMAGE` to approved project digest refs, absolute `BACKEND_ENV_FILE`, absolute `SQL_CA_FILE`, and `ROLLOUT_APPROVED=linear-ellipse-513814-b9`. Quiesce legacy writers; take consistent backup and verify restore. On **one node only**, run `MIGRATION_APPROVED=1 bash infra/ha/release.sh migrate`. Existing SQLite data requires separately reviewed import; Laravel migration alone does not migrate rows/artifacts.
5. Run `bash infra/ha/release.sh up` one node at a time. It neither builds nor pulls. Check SQL TLS, readiness, durable submission and private old-artifact checksum. Add LB resources only after quote approval and separate review of rendered commands. Snapshot/backup rollback cannot discard acknowledged new writes; use compatible release/reverse migration instead.

## DNS / TLS checklist

- Confirm control of `aksaranetra.rafifernanda.site`; Cloudflare **DNS-only** initially. Point A to approved reserved global IP; remove conflicting AAAA/A records. Check CAA permits Google managed issuance; verify public authoritative resolution.
- Wait for managed certificate `ACTIVE`, backend health and HTTPS hostname/SNI validation. No claim of readiness from DNS propagation alone. Test direct HTTPS frontend, API, authorized artifact download and CORS exact origin. Do not enable Cloudflare proxy until TLS/origin behavior reviewed separately.
- Obtain explicit fault-injection approval. Lose node A then B; capture LB failure/detection, lease expiry/reclaim, new durable jobs, interrupted retry, stale-owner rejection and same old-artifact checksum. Test regional database failover separately. Record timestamps/digests/errors; no annual SLA inference.

## Teardown inventory (manual, destructive approval required)

Record IDs/owner/creation time before provisioning. Remove dependencies in order after export/retention decision: forwarding rule `aksara-ha-https`; target proxy `aksara-ha-https`; URL map `aksara-ha`; backend services `aksara-ha-api`, `aksara-ha-web`; health checks same names; certificate `aksara-ha-cert`; global address `aksara-ha-ip`; zonal groups and VMs `aksara-ha-a/b` plus boot disks/snapshots; firewall `aksara-ha-lb`. Revert domain records when safe.

Separately inventory approved Cloud SQL instance/replicas/backups/PITR, private GCS bucket `linear-ellipse-513814-b9-ha-artifacts` including versions/soft-deleted objects, registry images, log retention, secrets/versions, dedicated service account/IAM bindings, private-service peering/range, subnet/VPC/router/NAT and any enabled APIs. Names outside rendered commands remain **TBD**, not invented live IDs. Do not delete shared networks/identities/APIs. Stopped VMs still leave billable disks, SQL, LB/IP/NAT and storage. Verify billing inventory after approved deletion; retain evidence/exports securely.
