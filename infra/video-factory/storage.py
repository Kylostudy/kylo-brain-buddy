"""Append-only local archive with verified receipts; no deletion operation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid
from contract import canonical, object_key


def checksum(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def safe_path(root, key, suffix=""):
    object_key(key)
    root = Path(root).resolve()
    path = root / (key + suffix)
    # Reject existing symlinks in every path component, including final file.
    current = root
    for part in path.relative_to(root).parts:
        current /= part
        if current.is_symlink():
            raise ValueError("symlink_not_allowed")
    if not path.resolve().is_relative_to(root):
        raise ValueError("path_outside_root")
    return path


class LocalArchive:
    kind = "local"

    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def exists(self, key):
        return safe_path(self.root, key, ".mp4").is_file()

    def read(self, key):
        return safe_path(self.root, key, ".mp4").open("rb")

    def verify(self, receipt):
        target = safe_path(self.root, receipt["object_key"], ".mp4")
        return target.stat().st_size == receipt["bytes"] and checksum(target) == receipt["sha256"]

    def save(self, key, source, media_receipt):
        target = safe_path(self.root, key, ".mp4")
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = checksum(source)
        size = Path(source).stat().st_size
        if target.exists():
            if checksum(target) != expected or target.stat().st_size != size:
                raise ValueError("archive_conflict")
        else:
            # Staging on the target mount allows atomic, no-clobber hard-link publication.
            staging = target.parent / (".staging-" + uuid.uuid4().hex)
            try:
                with open(source, "rb") as r, staging.open("xb") as w:
                    shutil.copyfileobj(r, w)
                    w.flush()
                    os.fsync(w.fileno())
                if checksum(staging) != expected:
                    raise ValueError("staging_checksum_failed")
                try:
                    os.link(staging, target)
                except FileExistsError:
                    if checksum(target) != expected:
                        raise ValueError("archive_conflict")
                fd = os.open(target.parent, os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            finally:
                # This is our unpublished temporary copy, never a final archive file.
                staging.unlink(missing_ok=True)
        receipt = {"schema_version": 1, "storage_type": self.kind, "object_key": key,
                   "sha256": expected, "bytes": size, "media": media_receipt}
        if not self.verify(receipt):
            raise ValueError("archive_readback_failed")
        return receipt

    def publication(self, receipt):
        # A caller must resolve this reference through the separate publishing bridge.
        return {"storage_type": self.kind, "object_key": receipt["object_key"], "sha256": receipt["sha256"]}

    def preview(self, receipt):
        # Never return an absolute host path or make a public URL.
        return {"video_id": receipt["object_key"], "requires_authenticated_stream": True}


class ExtensionRequiredArchive:
    def __init__(self, kind):
        if kind not in {"s3", "sftp"}:
            raise ValueError("unsupported_storage")
        self.kind = kind

    def __getattr__(self, name):
        if name in {"save", "exists", "read", "verify", "publication", "preview"}:
            raise RuntimeError("one_time_extension_required:" + self.kind)
        raise AttributeError(name)