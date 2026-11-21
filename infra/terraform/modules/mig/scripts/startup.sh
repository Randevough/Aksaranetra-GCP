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
APP_ENV=production
APP_DEBUG=false
APP_URL=https://${domain_name}
FRONTEND_URL=https://${domain_name}
API_BASE_URL=https://${domain_name}/api

DB_CONNECTION=pgsql
DB_HOST=${db_host}
DB_PORT=5432
DB_DATABASE=${db_name}
DB_USERNAME=${db_user}
DB_PASSWORD=${db_password}
DB_SSLMODE=require

PLAYWRIGHT_WORKER_URL=http://playwright-worker:4000
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://${domain_name}/api
EOF_ENV

chmod 600 "$${APP_DIR}/backend.env"

# 4. Write Docker Compose v2 stack manifest
cat <<EOF_COMPOSE > "$${APP_DIR}/docker-compose.yml"
services:
  playwright-worker:
    image: $${AR_PREFIX}/playwright-worker:${image_tag}
    container_name: aksaranetra-playwright-worker
    restart: unless-stopped
    env_file:
      - ./backend.env
    shm_size: "1gb"
    networks:
      - aksaranetra-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  api:
    image: $${AR_PREFIX}/api:${image_tag}
    container_name: aksaranetra-api
    restart: unless-stopped
    env_file:
      - ./backend.env
    ports:
      - "0.0.0.0:8787:8787"
    depends_on:
      - playwright-worker
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
    env_file:
      - ./backend.env
    ports:
      - "0.0.0.0:3000:3000"
    depends_on:
      - api
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

networks:
  aksaranetra-net:
    driver: bridge
EOF_COMPOSE

# 5. Pull and launch containers
cd "$${APP_DIR}"
docker compose pull
docker compose up -d --remove-orphans

echo "[$(date -Is)] AksaraNetra container stack deployed successfully."
