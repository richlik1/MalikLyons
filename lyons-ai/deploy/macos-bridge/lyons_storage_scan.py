#!/usr/bin/env python3
"""LYONS AI storage scan for macOS (also runs on Linux for testing).

Finds duplicate files (same size → same first-64KB hash → same full SHA-256)
and very large files in folders you choose, uploads a report to LYONS AI, and
carries out ONLY owner-approved actions: moving extra copies to the Trash.
Before moving, it re-hashes both the kept copy and each extra copy; if anything
changed, that file is skipped. Nothing is ever permanently deleted.

Photos libraries (*.photoslibrary) and app bundles are skipped: they are
databases, and editing their contents directly corrupts them.

Usage:
  LYONS_BASE_URL=... LYONS_BRIDGE_SECRET=... python3 lyons_storage_scan.py ~/Downloads ~/Documents ~/Desktop
"""
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lyons_imessage_bridge import Api  # noqa: E402  (shared signed client)

SKIP_DIRS = {".Trash", "Library", ".git", "node_modules", ".cache"}
SKIP_SUFFIXES = (".photoslibrary", ".app", ".musiclibrary", ".tvlibrary", ".fcpbundle")
MIN_SIZE = 1024 * 1024  # ignore files under 1 MB
LARGE = 500 * 1024 * 1024


def _hash(path: Path, limit: int | None = None) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        if limit:
            h.update(f.read(limit))
        else:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
    return h.hexdigest()


def walk(roots: list[Path]):
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.endswith(SKIP_SUFFIXES) and not d.startswith(".")]
            for name in filenames:
                p = Path(dirpath) / name
                if name.startswith(".") or p.is_symlink():
                    continue
                try:
                    yield p, p.stat().st_size
                except OSError:
                    continue


def scan(roots: list[Path], min_size: int = MIN_SIZE) -> dict:
    by_size: dict[int, list[Path]] = {}
    files = total = 0
    large = []
    for p, size in walk(roots):
        files += 1
        total += size
        if size >= LARGE:
            large.append({"path": str(p), "size": size})
        if size >= min_size:
            by_size.setdefault(size, []).append(p)
    groups = []
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        by_head: dict[str, list[Path]] = {}
        for p in paths:
            by_head.setdefault(_hash(p, 65536), []).append(p)
        for same_head in by_head.values():
            if len(same_head) < 2:
                continue
            by_full: dict[str, list[Path]] = {}
            for p in same_head:
                by_full.setdefault(_hash(p), []).append(p)
            for digest, dupes in by_full.items():
                if len(dupes) > 1:
                    # Keep the oldest copy first.
                    dupes.sort(key=lambda x: (x.stat().st_mtime, str(x)))
                    groups.append({"hash": digest, "size": size, "paths": [str(x) for x in dupes][:50]})
    groups.sort(key=lambda g: g["size"] * (len(g["paths"]) - 1), reverse=True)
    return {
        "device": platform.node() or "mac",
        "summary": {
            "scanned_files": files,
            "scanned_bytes": total,
            "duplicate_groups": len(groups),
            "reclaimable_bytes": sum(g["size"] * (len(g["paths"]) - 1) for g in groups),
            "roots": [str(r) for r in roots],
        },
        "groups": groups[:2000],
        "large_files": sorted(large, key=lambda f: -f["size"])[:200],
    }


def move_to_trash(path: Path) -> None:
    if platform.system() == "Darwin":
        # Finder's delete moves to Trash and keeps "Put Back".
        subprocess.run(["osascript", "-e", 'on run argv\ntell application "Finder" to delete (POSIX file (item 1 of argv) as alias)\nend run', str(path)], check=True, capture_output=True, timeout=30)
    else:
        trash = Path.home() / ".local/share/Trash/files"
        trash.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), trash / path.name)


def execute_action(action: dict, mover=move_to_trash) -> dict:
    """Moves the extra copies to Trash only if they are still identical to the kept copy."""
    keep = Path(action["keep_path"])
    moved, skipped = [], []
    if not keep.exists() or _hash(keep) != action["group_hash"]:
        return {"id": action["id"], "moved": [], "skipped": [{"path": str(keep), "reason": "kept copy missing or changed; nothing moved"}]}
    for p in map(Path, action["trash_paths"]):
        try:
            if not p.exists():
                skipped.append({"path": str(p), "reason": "already gone"})
            elif _hash(p) != action["group_hash"]:
                skipped.append({"path": str(p), "reason": "contents changed since the scan"})
            else:
                mover(p)
                moved.append(str(p))
        except Exception as e:  # noqa: BLE001 - report per-file failures
            skipped.append({"path": str(p), "reason": str(e)[:200]})
    return {"id": action["id"], "moved": moved, "skipped": skipped}


def main(argv: list[str]) -> int:
    base, secret = os.environ.get("LYONS_BASE_URL"), os.environ.get("LYONS_BRIDGE_SECRET")
    roots = [Path(a).expanduser() for a in argv] or [Path.home() / d for d in ("Downloads", "Documents", "Desktop")]
    report = scan([r for r in roots if r.exists()])
    print(f"{report['summary']['duplicate_groups']} duplicate groups, {report['summary']['reclaimable_bytes'] / 1e9:.2f} GB reclaimable")
    if not base or not secret:
        print("LYONS_BASE_URL/LYONS_BRIDGE_SECRET not set: report not uploaded.")
        return 0
    api = Api(base, secret)
    print("uploaded report", api.call("POST", "/bridge/storage/report", report).get("id"))
    for action in api.call("GET", "/bridge/storage/actions").get("actions", []):
        result = execute_action(action)
        api.call("POST", "/bridge/storage/ack", result)
        print(f"action {action['id']}: moved {len(result['moved'])}, skipped {len(result['skipped'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
