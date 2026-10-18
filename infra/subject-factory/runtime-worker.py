#!/usr/bin/env python3
"""Narrow runtime correction for the approved factory; never edit its archive."""
from pathlib import Path

OLD = 'os.environ.get("KYLO_ARCHIVE_STAGING", str(target.parents[3] / "factory-staging"))'
NEW = '(os.environ.get("KYLO_ARCHIVE_STAGING") or str(target.parent.parent.parent / "factory-staging"))'


def corrected_source(source):
    # The old default was eagerly evaluated even with KYLO_ARCHIVE_STAGING set.
    # /archive/sl/file.mp4 has only three parents, so parents[3] raises IndexError(3).
    if source.count(OLD) != 1:
        raise ValueError("factory source differs from reviewed staging correction")
    return source.replace(OLD, NEW, 1)


def main():
    source_path = Path("/app/worker.py")
    source = corrected_source(source_path.read_text())
    print("Brain factory staging correction v1 enabled; existing archive files remain immutable", flush=True)
    namespace = {"__name__": "__main__", "__file__": str(source_path)}
    exec(compile(source, str(source_path), "exec"), namespace)


if __name__ == "__main__":
    main()