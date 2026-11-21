import hashlib, unittest
from pathlib import Path
HERE = Path(__file__).parent

class Sums(unittest.TestCase):
    def test_every_listed_file_matches(self):
        # install.sh runs `sha256sum --strict -c SHA256SUMS`; any stale line blocks the whole install.
        for line in (HERE / "SHA256SUMS").read_text().splitlines():
            digest, name = line.split("  ", 1)
            self.assertEqual(hashlib.sha256((HERE / name).read_bytes()).hexdigest(), digest, name)

if __name__ == "__main__":
    unittest.main()
