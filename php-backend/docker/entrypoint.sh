#!/bin/sh
set -eu
mode=${1:-api}
ha=${HA_MODE:-0}
case "$ha" in 0|1) ;; *) echo 'HA_MODE must be 0 or 1' >&2; exit 64 ;; esac
if [ "$ha" = 1 ]; then
    [ "${DB_CONNECTION:-}" = pgsql ] || { echo 'HA requires DB_CONNECTION=pgsql' >&2; exit 64; }
    [ "${RUN_MIGRATIONS:-0}" = 0 ] || { echo 'HA startup migrations forbidden; use migrate command' >&2; exit 64; }
fi
case "${RUN_MIGRATIONS:-1}" in 0|1) ;; *) echo 'RUN_MIGRATIONS must be 0 or 1' >&2; exit 64 ;; esac
cd /app/php-backend
[ -z "${BACKEND_DATA_DIR:-}" ] || mkdir -p "$BACKEND_DATA_DIR"
mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp
mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
case "$mode" in
    migrate)
        [ "${MIGRATION_APPROVED:-0}" = 1 ] || { echo 'Set MIGRATION_APPROVED=1 for one operator-controlled migration' >&2; exit 64; }
        exec php artisan migrate --force ;;
    api)
        if [ "$ha" = 0 ] && [ "${RUN_MIGRATIONS:-1}" = 1 ]; then php artisan migrate --force; fi
        exec supervisord -c /app/php-backend/docker/supervisord.conf ;;
    worker) exec php artisan audit:work ;;
    *) exec "$@" ;;
esac
