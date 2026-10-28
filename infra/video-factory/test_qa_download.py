"""Real local read-only server flow with synthetic bytes, never production media."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request


class QADownloadTests(unittest.TestCase):
    def test_protected_contact_download_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=root/'archive';qa=archive/'videos/versioned-factory/test/v1';qa.mkdir(parents=True)
            (qa/'video.contact.jpg').write_bytes(b'synthetic-contact-bytes')
            (root/'outside').write_bytes(b'private');(qa/'evil.contact.jpg').symlink_to(root/'outside')
            script=root/'server.cjs';shutil.copyfile(Path(__file__).parents[1]/'vault/fileserver/server.js',script)
            sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
            env={**os.environ,'WORKER_API_TOKEN':'synthetic-test-credential','ARCHIVE_ROOT':str(archive),'VAULT_ROOT':str(root/'vault'),'VAULT_FS_BIND':'127.0.0.1','VAULT_FS_PORT':str(port)}
            proc=subprocess.Popen(['node',str(script)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                origin=f'http://127.0.0.1:{port}'
                for _ in range(50):
                    try:urllib.request.urlopen(origin+'/health',timeout=1).close();break
                    except Exception:time.sleep(.05)
                path='/archive-file?path=videos/versioned-factory/test/v1/video.contact.jpg'
                with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(origin+path)
                self.assertEqual(cm.exception.code,401)
                request=urllib.request.Request(origin+path,headers={'authorization':'Bearer synthetic-test-credential'})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.headers['content-type'],'image/jpeg');self.assertEqual(response.read(),b'synthetic-contact-bytes')
                evil=urllib.request.Request(origin+'/archive-file?path=videos/versioned-factory/test/v1/evil.contact.jpg',headers={'authorization':'Bearer synthetic-test-credential'})
                with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(evil)
                self.assertEqual(cm.exception.code,400)
                self.assertEqual((qa/'video.contact.jpg').read_bytes(),b'synthetic-contact-bytes')
            finally:proc.terminate();proc.wait(timeout=5)


if __name__=='__main__':unittest.main()