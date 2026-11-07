#!/usr/bin/env python3
"""Offline contracts only; no cloud, Docker, PHP, network or credentials."""
import os
from pathlib import Path
import subprocess
import tempfile
import yaml

root = Path(__file__).resolve().parents[2]
compose = yaml.safe_load((root / 'docker-compose.ha.yml').read_text())
urlmap = yaml.safe_load((root / 'infra/ha/url-map.yml').read_text())
assert set(compose['services']) == {'frontend', 'backend-api', 'backend-worker'}
for role in ('backend-api', 'backend-worker'):
    env = compose['services'][role]['environment']
    assert env['HA_MODE'] == '1' and env['RUN_MIGRATIONS'] == '0'
    assert env['DB_CONNECTION'] == 'pgsql'
assert urlmap['pathMatchers'][0]['pathRules'][0]['paths'] == ['/health', '/audits', '/audits/*']
for path in (root / 'infra/ha').glob('*.sh'):
    subprocess.run(['bash', '-n', str(path)], check=True)
entry = root / 'php-backend/docker/entrypoint.sh'
subprocess.run(['sh', '-n', str(entry)], check=True)
# Fresh minimal environment: do not inherit credentials or cloud configuration.
base = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent'}
render = root / 'infra/ha/render.sh'
for project in ('', 'other-project'):
    assert subprocess.run(['bash', str(render)], env={**base, 'GCP_PROJECT': project}, capture_output=True).returncode == 64
output = subprocess.check_output(['bash', str(render)], env={**base, 'GCP_PROJECT': 'linear-ellipse-513814-b9'}, text=True)
for line in output.splitlines():
    if line.startswith('gcloud '):
        assert '--project=linear-ellipse-513814-b9' in line
assert 'chmod 666' not in output
subprocess.run(['bash', '-n'], input=output, text=True, check=True)
assert subprocess.run(['bash', str(root / 'infra/ha/release.sh'), 'up'], env=base, capture_output=True).returncode == 64
# Exercise real shell control flow with fake php/supervisor; never run PHP or Docker.
with tempfile.TemporaryDirectory(prefix='ha-check-', dir=root) as tmp:
    tmp = Path(tmp)
    log = tmp / 'calls'
    for name in ('php', 'supervisord', 'mkdir'):
        stub = tmp / name
        stub.write_text('#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$TEST_LOG"\n')
        stub.chmod(0o700)
    script = tmp / 'entry.sh'
    script.write_text(entry.read_text().replace('cd /app/php-backend', 'cd "' + str(tmp) + '"'))
    def run(mode, extra):
        log.write_text('')
        result = subprocess.run(['sh', str(script), mode], env={**base, 'PATH': str(tmp) + ':/usr/bin:/bin', 'TEST_LOG': str(log), **extra}, capture_output=True)
        return result.returncode, log.read_text()
    code, calls = run('api', {'HA_MODE': '1', 'DB_CONNECTION': 'pgsql'})
    assert code == 0 and 'supervisord ' in calls and 'php artisan migrate' not in calls
    code, calls = run('api', {'HA_MODE': '1', 'DB_CONNECTION': 'pgsql', 'RUN_MIGRATIONS': '1'})
    assert code == 64 and not calls
    code, calls = run('api', {'HA_MODE': '1', 'DB_CONNECTION': 'sqlite'})
    assert code == 64 and not calls
    code, calls = run('api', {})
    assert code == 0 and 'php artisan migrate --force' in calls
    code, calls = run('api', {'RUN_MIGRATIONS': '0'})
    assert code == 0 and 'php ' not in calls
    code, calls = run('migrate', {'HA_MODE': '1', 'DB_CONNECTION': 'pgsql'})
    assert code == 64 and 'php ' not in calls
    code, calls = run('migrate', {'HA_MODE': '1', 'DB_CONNECTION': 'pgsql', 'MIGRATION_APPROVED': '1'})
    assert code == 0 and 'php artisan migrate --force' in calls
    code, calls = run('worker', {'HA_MODE': '1', 'DB_CONNECTION': 'pgsql'})
    assert code == 0 and 'php artisan audit:work' in calls and 'migrate' not in calls
print('PASS: YAML contracts, shell syntax, rendered project guards, release guard, 8 mocked entrypoint cases')
