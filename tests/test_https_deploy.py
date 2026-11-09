"""Deployment contract check; stdlib only. Use --head for RED baseline."""
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HEAD = "--head" in sys.argv
if HEAD:
    sys.argv.remove("--head")


def source(path):
    if HEAD:
        result = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=ROOT, capture_output=True, text=True)
        return result.stdout if result.returncode == 0 else ""
    return (ROOT / path).read_text()


class HttpsDeployment(unittest.TestCase):
    def test_edge_and_storage(self):
        compose = source("docker-compose.prod.yml")
        self.assertIn('image: caddy:2-alpine', compose)
        for value in ('"80:80"', '"443:443"', './Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config', 'aksara_data:/data'):
            self.assertIn(value, compose)
        self.assertNotIn('"3000:3000"', compose)
        self.assertNotIn('"8787:8787"', compose)
        self.assertIn('FRONTEND_ORIGINS: https://aksaranetra.rafifernanda.site', compose)
        self.assertNotIn('BACKEND_PUBLIC_URL', compose)

    def test_routing(self):
        caddy = source("Caddyfile")
        for value in ('aksaranetra.rafifernanda.site {', 'redir /api /api/ 308', 'handle_path /api/* {', 'reverse_proxy backend-api:8787', 'reverse_proxy frontend:3000'):
            self.assertIn(value, caddy)
        self.assertLess(caddy.index('handle_path'), caddy.index('reverse_proxy frontend'))

    def test_workflow(self):
        workflow = source(".github/workflows/deploy.yml")
        self.assertIn('NEXT_PUBLIC_AUDIT_API_URL: /api', workflow)
        self.assertNotIn('vars.NEXT_PUBLIC_AUDIT_API_URL', workflow)
        self.assertIn('--build-arg NEXT_PUBLIC_AUDIT_API_URL="$NEXT_PUBLIC_AUDIT_API_URL"', workflow)
        self.assertIn('gcloud compute scp docker-compose.prod.yml Caddyfile docker-compose.prod-ha.yml ', workflow)
        self.assertIn(':~/aksaranetra/ --project=${{ env.GCP_PROJECT }} --zone=', workflow)
        self.assertNotIn('chmod 666', workflow)
        self.assertIn('sudo -H docker login --username oauth2accesstoken --password-stdin', workflow)
        self.assertIn('sudo -H env GAR_LOCATION=', workflow)
        self.assertIn('if [ ! -f backend.env ]; then', workflow)
        self.assertIn('BACKEND_SECRET=$(openssl rand -hex 32)', workflow)
        self.assertNotIn('down -v', workflow)


if __name__ == "__main__":
    unittest.main()
