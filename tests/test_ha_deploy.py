"""HA deploy contract and nested SSH shell regression; stdlib only."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HaDeploy(unittest.TestCase):
    def test_overlay(self):
        path = ROOT / 'docker-compose.prod-ha.yml'
        self.assertTrue(path.exists(), 'HA overlay missing')
        text = path.read_text()
        for service in ('backend-api', 'backend-worker'):
            block = text.split(f'  {service}:\n')[1].split('\n  backend-')[0].split('\nvolumes:')[0]
            for value in ('source: /etc/aksaranetra/server-ca.pem', 'target: /etc/aksaranetra/server-ca.pem', 'read_only: true', 'create_host_path: false'):
                self.assertIn(value, block)
        self.assertIn('  aksara_data:\n    name: aksaranetra_ha_scratch', text)
        self.assertNotIn('image:', text)
        self.assertNotIn('/home/', text)

    def test_nested_shell_selects_same_files(self):
        workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
        self.assertRegex(workflow, r'gcloud compute scp [^\n]*docker-compose.prod-ha.yml')
        self.assertIn('if sudo grep -qx \\"HA_MODE=1\\" backend.env; then', workflow)
        workflow = re.sub(r'^          ', '', workflow, flags=re.MULTILINE)
        outer = workflow[workflow.index('-- "bash -c '):].removeprefix('-- ')
        outer = re.sub(r'\$\{\{[^}]+\}\}', 'test', outer)
        remote = subprocess.check_output(['bash', '-c', 'printf %s ' + outer], text=True)
        for mode in ('HA_MODE=1', 'HA_MODE=0', 'HA_MODE=10', '#HA_MODE=1', 'XHA_MODE=1', ''):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                app = home / 'aksaranetra'
                app.mkdir()
                (app / 'backend.env').write_text(mode + '\n')
                bin_dir = home / 'bin'
                bin_dir.mkdir()
                for name, body in {
                    'sudo': 'test "$1" != -H || shift; exec "$@"',
                    'gcloud': 'printf token',
                    'docker': 'printf "%s\\n" "$*" >> "$HOME/docker.log"; cat >/dev/null',
                }.items():
                    file = bin_dir / name
                    file.write_text('#!/bin/sh\n' + body + '\n')
                    file.chmod(0o755)
                env = dict(os.environ, HOME=tmp, PATH=str(bin_dir) + ':' + os.environ['PATH'])
                subprocess.run(['bash', '-c', remote], env=env, check=True, capture_output=True, text=True)
                calls = (home / 'docker.log').read_text().splitlines()
                compose = [line for line in calls if line.startswith('compose ')]
                self.assertEqual(len(compose), 2)
                files = 'compose -f docker-compose.prod.yml'
                if mode == 'HA_MODE=1':
                    files += ' -f docker-compose.prod-ha.yml'
                self.assertEqual(compose, [files + ' pull', files + ' up -d --remove-orphans'])


if __name__ == '__main__':
    unittest.main()
