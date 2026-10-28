"""Tests for the macOS bridge using a synthetic chat.db (same tables/columns the
bridge reads) and a fake LYONS AI server. Run: python3 -I -m unittest test_bridge.py"""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lyons_imessage_bridge as b  # noqa: E402


def attributed_body(text: str) -> bytes:
    raw = text.encode()
    length = bytes([len(raw)]) if len(raw) < 0x80 else b"\x81" + len(raw).to_bytes(2, "little")
    return b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01\x2b" + length + raw + b"\x86\x84\x02iI"


def make_db(path: Path):
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, is_from_me INTEGER, date INTEGER, handle_id INTEGER);
      INSERT INTO handle VALUES (1, '+1 (313) 555-0101'), (2, '+13135550199'), (3, 'Client@Example.com');
    """)
    ns = 800_000_000 * 10**9  # 2026-05-09T06:13:20Z in Apple-epoch nanoseconds
    con.executemany("INSERT INTO message VALUES (?,?,?,?,?,?,?)", [
        (1, "g1", "Can you clean unit 4 Friday?", None, 0, ns, 1),
        (2, "g2", "Personal chat - must not upload", None, 0, ns, 2),
        (3, "g3", None, attributed_body("Yes, see you at 10"), 1, ns, 1),
        (4, "g4", "Invoice question?", None, 0, ns, 3),
    ])
    con.commit()
    con.close()


class FakeApi:
    def __init__(self, handles, outbox):
        self.handles, self.outbox, self.calls = handles, outbox, []

    def call(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path.endswith("/handles"):
            return {"handles": self.handles}
        if path.endswith("/outbox"):
            out, self.outbox = self.outbox, []
            return {"messages": out}
        if path.endswith("/inbound"):
            return {"stored": len(payload["messages"]), "ignored": 0}
        return {"ok": True}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "chat.db"
        make_db(self.db)
        self.state_dir = self.tmp / "state"

    def test_normalisation_matches_server(self):
        self.assertEqual(b.normalize_phone("(313) 555-0101"), "+13135550101")
        self.assertEqual(b.normalize_email("John.Doe+jobs@GoogleMail.com"), "john.doe@gmail.com")
        self.assertIsNone(b.normalize_phone("555-0101"))

    def test_decodes_attributed_body(self):
        self.assertEqual(b.decode_attributed_body(attributed_body("Yes, see you at 10")), "Yes, see you at 10")
        long = "x" * 300
        self.assertEqual(b.decode_attributed_body(attributed_body(long)), long)
        self.assertIsNone(b.decode_attributed_body(b"garbage"))

    def test_only_known_client_handles_are_read(self):
        msgs, max_rowid = b.read_new_messages(self.db, 0, {"+13135550101", "client@example.com"})
        self.assertEqual(max_rowid, 4)
        self.assertEqual([m["guid"] for m in msgs], ["g1", "g3", "g4"])
        self.assertNotIn("Personal chat", json.dumps(msgs))
        self.assertTrue(msgs[1]["from_me"])
        self.assertEqual(msgs[1]["text"], "Yes, see you at 10")
        self.assertTrue(msgs[0]["sent_at"].startswith("2026-05-09T06:13:20"))

    def test_first_run_starts_from_now_then_uploads_new(self):
        api = FakeApi(["+13135550101"], [])
        state = b.load_state(self.state_dir)
        r = b.run_once(api, state, self.state_dir, db_path=self.db, dry_run=True)
        self.assertEqual(r["uploaded"], {"stored": 0, "ignored": 0})  # history not bulk-uploaded
        con = sqlite3.connect(self.db)
        con.execute("INSERT INTO message VALUES (5, 'g5', 'New request?', NULL, 0, 0, 1)")
        con.commit()
        con.close()
        r = b.run_once(api, state, self.state_dir, db_path=self.db, dry_run=True)
        self.assertEqual(r["uploaded"]["stored"], 1)
        self.assertEqual(b.load_state(self.state_dir)["last_rowid"], 5)

    def test_sends_queued_messages_and_acks(self):
        sent = []
        api = FakeApi([], [{"id": "m1", "handle": "+13135550101", "text": "On our way"}])
        state = b.load_state(self.state_dir)
        stats = b.process_outbox(api, state, self.state_dir, send=lambda h, t: sent.append((h, t)))
        self.assertEqual(stats["sent"], 1)
        self.assertEqual(sent, [("+13135550101", "On our way")])
        self.assertIn(("POST", "/bridge/imessage/ack", {"id": "m1", "ok": True}), api.calls)
        self.assertEqual(b.load_state(self.state_dir)["attempted"], {})

    def test_failed_send_is_acked_as_failed(self):
        api = FakeApi([], [{"id": "m2", "handle": "+13135550101", "text": "x"}])

        def boom(h, t):
            raise RuntimeError("Messages not signed in")

        stats = b.process_outbox(api, b.load_state(self.state_dir), self.state_dir, send=boom)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(api.calls[-1][2]["ok"], False)

    def test_interrupted_send_is_reported_unknown_and_never_resent(self):
        state = {"last_rowid": 0, "attempted": {"m3": 1}}
        b.save_state(self.state_dir, state)
        sent = []
        api = FakeApi([], [])
        stats = b.process_outbox(api, b.load_state(self.state_dir), self.state_dir, send=lambda h, t: sent.append(h))
        self.assertEqual(stats["unknown"], 1)
        self.assertEqual(sent, [])
        self.assertIn("outcome unknown", api.calls[0][2]["error"])

    def test_dry_run_never_sends(self):
        api = FakeApi([], [{"id": "m4", "handle": "+13135550101", "text": "x"}])
        stats = b.process_outbox(api, b.load_state(self.state_dir), self.state_dir, send=lambda h, t: self.fail("sent in dry run"), dry_run=True)
        self.assertEqual(stats, {"sent": 0, "failed": 0, "unknown": 0})

    def test_signature_matches_server_algorithm(self):
        # Same vector as the TypeScript signWebhook(secret, ts, body) test.
        self.assertEqual(b.sign("s3cret", 1800000000, '{"a":1}'), __import__("hmac").new(b"s3cret", b'1800000000.{"a":1}', "sha256").hexdigest())


if __name__ == "__main__":
    unittest.main()
