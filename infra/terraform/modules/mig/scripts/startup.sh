#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/aksaranetra-startup.log"
exec > >(tee -a "$${LOG_FILE}") 2>&1

echo "[$(date -Is)] Starting AksaraNetra VM bootstrap..."

export DEBIAN_FRONTEND=noninteractive
APP_DIR="/opt/aksaranetra"
AR_HOST="${region}-docker.pkg.dev"
AR_PREFIX="$${AR_HOST}/${project_id}/${artifact_registry_repo}"

# 1. Install base packages and Docker CE + Compose v2
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    jq

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "$${VERSION_CODENAME}")"
  echo "deb [arch=$${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y --no-install-recommends \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
fi

systemctl enable --now docker

# 2. Authenticate Docker against Google Artifact Registry
if command -v gcloud >/dev/null 2>&1; then
  gcloud auth configure-docker "$${AR_HOST}" --quiet
else
  ACCESS_TOKEN="$(curl -fsS -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
    | jq -r '.access_token')"
  echo "$${ACCESS_TOKEN}" | docker login -u oauth2accesstoken --password-stdin "https://$${AR_HOST}"
fi

# 3. Write production backend.env with strict permissions
mkdir -p "$${APP_DIR}"
cat <<'EOF_ENV' > "$${APP_DIR}/backend.env"
APP_NAME=AksaraNetra
APP_ENV=production
APP_DEBUG=false
APP_URL=https://${domain_name}
HOST=0.0.0.0
PORT=8787
FRONTEND_ORIGINS=*
BACKEND_SECRET=a8f4c2e6b1d3f5a7c9e0b2d4f6a8c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5
BACKEND_DATA_DIR=/data
TRUST_PROXY=1
AUDIT_TIMEOUT_MS=180000
RESULT_RETENTION_MS=604800000
CHROMIUM_LOW_RESOURCE_MODE=1

DB_CONNECTION=pgsql
DB_HOST=${db_host}
DB_PORT=5432
DB_DATABASE=${db_name}
DB_USERNAME=${db_user}
DB_PASSWORD=${db_password}
DB_SSLMODE=prefer

ARTIFACT_STORE=gcs
GCS_BUCKET=aksaranetra-artifacts-${project_id}
GOOGLE_CLOUD_PROJECT=${project_id}
EOF_ENV

chmod 600 "$${APP_DIR}/backend.env"

# 4. Write Docker Compose v2 stack manifest
cat <<EOF_COMPOSE > "$${APP_DIR}/docker-compose.yml"
services:
  backend-worker:
    image: $${AR_PREFIX}/backend:${image_tag}
    container_name: aksaranetra-backend-worker
    command: ["worker"]
    restart: unless-stopped
    env_file:
      - ./backend.env
    volumes:
      - aksara_data:/data
    shm_size: "1gb"
    networks:
      - aksaranetra-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  backend-api:
    image: $${AR_PREFIX}/backend:${image_tag}
    container_name: aksaranetra-backend-api
    command: ["api"]
    restart: unless-stopped
    env_file:
      - ./backend.env
    volumes:
      - aksara_data:/data
    ports:
      - "0.0.0.0:8787:8787"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8787/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - aksaranetra-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  frontend:
    image: $${AR_PREFIX}/frontend:${image_tag}
    container_name: aksaranetra-frontend
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_BACKEND_URL=/api
      - NEXT_PUBLIC_AUDIT_API_URL=/api
    ports:
      - "0.0.0.0:3000:3000"
    depends_on:
      - backend-api
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:3000/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - aksaranetra-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  aksara_data:
    driver: local

networks:
  aksaranetra-net:
    driver: bridge
EOF_COMPOSE

# 5. Pull and launch containers
cd "$${APP_DIR}"
docker compose pull
docker compose up -d --remove-orphans

echo "[$(date -Is)] AksaraNetra container stack deployed successfully."
