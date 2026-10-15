"""Run: python3 -I -m unittest discover -s deploy/macos-bridge -p 'test_*.py'"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lyons_storage_scan as s  # noqa: E402


class StorageScanTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        big = os.urandom(2 * 1024 * 1024)
        (self.root / "a").mkdir()
        (self.root / "b").mkdir()
        (self.root / "a" / "photo.jpg").write_bytes(big)
        time.sleep(0.01)
        (self.root / "b" / "photo copy.jpg").write_bytes(big)
        # Same size, same first 64 KB, different tail: NOT a duplicate.
        (self.root / "b" / "similar.jpg").write_bytes(big[:-1] + bytes([big[-1] ^ 1]))
        (self.root / "tiny1.txt").write_text("x")
        (self.root / "tiny2.txt").write_text("x")
        lib = self.root / "Photos Library.photoslibrary"
        lib.mkdir()
        (lib / "inside.jpg").write_bytes(big)

    def test_finds_true_duplicates_only_and_skips_libraries(self):
        r = s.scan([self.root])
        self.assertEqual(r["summary"]["duplicate_groups"], 1)
        g = r["groups"][0]
        self.assertEqual([Path(p).name for p in g["paths"]], ["photo.jpg", "photo copy.jpg"])  # oldest kept first
        self.assertEqual(r["summary"]["reclaimable_bytes"], 2 * 1024 * 1024)
        self.assertNotIn("photoslibrary", str(r["groups"]))

    def test_action_moves_only_unchanged_copies(self):
        g = s.scan([self.root])["groups"][0]
        moved = []
        res = s.execute_action({"id": "x", "group_hash": g["hash"], "keep_path": g["paths"][0], "trash_paths": g["paths"][1:]}, mover=moved.append)
        self.assertEqual(len(res["moved"]), 1)
        self.assertEqual(res["skipped"], [])

    def test_action_skips_files_changed_since_scan(self):
        g = s.scan([self.root])["groups"][0]
        Path(g["paths"][1]).write_bytes(b"changed")
        moved = []
        res = s.execute_action({"id": "x", "group_hash": g["hash"], "keep_path": g["paths"][0], "trash_paths": g["paths"][1:]}, mover=moved.append)
        self.assertEqual(moved, [])
        self.assertIn("changed", res["skipped"][0]["reason"])

    def test_action_refuses_when_kept_copy_changed(self):
        g = s.scan([self.root])["groups"][0]
        Path(g["paths"][0]).write_bytes(b"changed")
        moved = []
        res = s.execute_action({"id": "x", "group_hash": g["hash"], "keep_path": g["paths"][0], "trash_paths": g["paths"][1:]}, mover=moved.append)
        self.assertEqual(moved, [])
        self.assertIn("nothing moved", res["skipped"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
