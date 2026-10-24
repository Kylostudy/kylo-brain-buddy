"""Root-only encrypted provisioning; no credential or response logging."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def provision(env_path):
    if os.geteuid() != 0:
        raise RuntimeError('root_required')
    openssl = shutil.which('openssl')
    if not openssl:
        raise RuntimeError('encryption_tool_required')
    settings = {}
    for line in Path(env_path).read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            settings[key] = value.strip().strip('"').strip("'")
    origin = settings.get('BRAIN_URL', '').rstrip('/')
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or parsed.hostname != 'brain.kylosystems.com' or parsed.username or parsed.password or parsed.port or parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError('approved_origin_required')
    token = settings.get('WORKER_API_TOKEN')
    if not token or settings.get('WORKER_ID', 'worker-1') != 'worker-1':
        raise RuntimeError('approved_worker_required')
    root = Path('/etc/kylo-video-factory')
    if root.is_symlink():
        raise RuntimeError('unsafe_directory')
    root.mkdir(mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    os.chown(root, 0, 0)
    with tempfile.TemporaryDirectory(prefix='.provision-', dir=root) as directory:
        work = Path(directory)
        private, public = work / 'private.pem', work / 'public.pem'
        def run(*args):
            subprocess.run([openssl, *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        run('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(private))
        run('pkey', '-in', str(private), '-pubout', '-out', str(public))
        body = json.dumps({'workerId': 'worker-1', 'publicKey': public.read_text()}).encode()
        request = urllib.request.Request(origin + '/api/public/worker/video-factory-provision', data=body,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'kylo-factory-provision/1'})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            raw = response.read(8193)
        if len(raw) > 8192:
            raise RuntimeError('bounded_response_required')
        encrypted = base64.b64decode(json.loads(raw)['encrypted'], validate=True)
        cipher, target = work / 'cipher.bin', work / 'machine-secret'
        cipher.write_bytes(encrypted)
        run('pkeyutl', '-decrypt', '-inkey', str(private), '-in', str(cipher), '-out', str(target),
            '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256', '-pkeyopt', 'rsa_mgf1_md:sha256')
        if not target.read_bytes().strip():
            raise RuntimeError('configured_secret_required')
        os.chmod(target, 0o600)
        with target.open('rb') as handle:
            os.fsync(handle.fileno())
        os.replace(target, root / 'machine-secret')
        fd = os.open(root, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


if __name__ == '__main__':
    try:
        provision(sys.argv[1])
        print('VF: gépi titok védetten beállítva; gyártás nincs aktiválva')
    except Exception:
        print('VF: titok beállítása sikertelen; új publikálás vagy hostfeltétel ellenőrzése szükséges')
        sys.exit(1)