#!/usr/bin/env bash
# Manual release only; no cloud provisioning. Requires separate quote + rollout approval.
set -euo pipefail
[[ ${GCP_PROJECT:-} == linear-ellipse-513814-b9 ]] || { echo 'Wrong/missing GCP_PROJECT' >&2; exit 64; }
[[ ${ROLLOUT_APPROVED:-} == linear-ellipse-513814-b9 ]] || { echo 'Rollout approval missing' >&2; exit 64; }
for var in BACKEND_IMAGE FRONTEND_IMAGE; do
    value=${!var:-}
    [[ $value =~ ^asia-southeast2-docker\.pkg\.dev/linear-ellipse-513814-b9/aksaranetra/[a-z-]+@sha256:[a-f0-9]{64}$ ]] || { echo "$var must pin approved project image digest" >&2; exit 64; }
done
for var in BACKEND_ENV_FILE SQL_CA_FILE; do
    value=${!var:-}
    [[ $value == /* && -f $value ]] || { echo "$var requires absolute file path" >&2; exit 64; }
done
[[ $(stat -c %a "$BACKEND_ENV_FILE") == 600 ]] || { echo 'Backend env permissions must be 600' >&2; exit 64; }
cd "$(dirname "$0")/../.."
case ${1:-} in
    migrate)
        # Operator must serialize this command across both nodes; never run concurrently.
        [[ ${MIGRATION_APPROVED:-0} == 1 ]] || { echo 'Migration approval missing' >&2; exit 64; }
        docker compose -f docker-compose.ha.yml run --rm --no-deps -e MIGRATION_APPROVED=1 backend-api migrate ;;
    up) docker compose -f docker-compose.ha.yml up -d --no-build --pull never ;;
    *) echo 'Usage: bash infra/ha/release.sh migrate|up' >&2; exit 64 ;;
esac
