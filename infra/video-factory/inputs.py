"""Data-only, bounded, checksum-verified recipe ingestion; never installs code."""
import base64
import os
from pathlib import Path
import uuid
from contract import validate_recipe
from storage import checksum, safe_path

CHUNK_BYTES = 256 * 1024


def readable_inputs(root, files):
    """Repair only verified recipe data, never archive or host ancestors."""
    root = Path(root)
    paths = []
    for media in files:
        target = safe_path(root, media["key"])
        if not target.is_file() or target.stat().st_size != media["bytes"] or checksum(target) != media["sha256"]:
            raise ValueError("media_checksum_failed")
        paths.append(target)
    # Verify the entire set before changing any permission.
    os.chmod(root, 0o755)
    for target in paths:
        current = target.parent
        while current != root:
            os.chmod(current, 0o755)
            current = current.parent
        os.chmod(target, 0o444)


class Inputs:
    def __init__(self, root, client, archive):
        self.root, self.client, self.archive = root, client, archive

    def prepare(self, manifest):
        validate_recipe(manifest)
        for completed in manifest.get("continuation", {}).get("completed", []):
            if not self.archive.verify(completed["receipt"]):
                raise ValueError("completed_archive_unverified")
        root = safe_path(self.root, manifest["recipe_id"] + "/" + manifest["version"])
        root.mkdir(parents=True, exist_ok=True)
        for media in manifest["files"]:
            target = safe_path(root, media["key"])
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.stat().st_size != media["bytes"] or checksum(target) != media["sha256"]:
                    raise ValueError("immutable_input_conflict")
                continue
            staging = target.parent / (".input-" + uuid.uuid4().hex)
            try:
                with staging.open("xb") as stream:
                    offset = 0
                    while offset < media["bytes"]:
                        response = self.client.request("assets", {"schema_version": 1,
                            "recipe_id": manifest["recipe_id"], "version": manifest["version"],
                            "key": media["key"], "offset": offset})
                        chunk = base64.b64decode(response.get("data_base64", ""), validate=True)
                        if response.get("offset") != offset or response.get("sha256") != media["sha256"] or not 0 < len(chunk) <= min(CHUNK_BYTES, media["bytes"] - offset):
                            raise ValueError("invalid_asset_chunk")
                        stream.write(chunk)
                        offset += len(chunk)
                    stream.flush()
                    os.fsync(stream.fileno())
                if checksum(staging) != media["sha256"]:
                    raise ValueError("media_checksum_failed")
                try:
                    os.link(staging, target)
                except FileExistsError:
                    if target.stat().st_size != media["bytes"] or checksum(target) != media["sha256"]:
                        raise ValueError("immutable_input_conflict")
                fd = os.open(target.parent, os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            finally:
                staging.unlink(missing_ok=True)
        readable_inputs(root, manifest["files"])