#!/usr/bin/env python3
"""LYONS AI iMessage bridge for macOS (prototype).

Apple provides no iMessage API. This bridge runs on YOUR Mac, signed in to
your Apple ID, and:
  * reads ~/Library/Messages/chat.db READ-ONLY (requires Full Disk Access for
    the Python/Terminal app you run it with),
  * uploads only messages with handles that LYONS AI already knows as clients,
  * sends messages LYONS AI has queued after your approval, through the
    Messages app via AppleScript (requires Automation permission for Messages),
  * never resends after a crash: an interrupted send is reported as
    "outcome unknown" so you can check Messages yourself.

Standard library only. Configure with environment variables:
  LYONS_BASE_URL          e.g. https://agent.example.com (or http://127.0.0.1:8080 via SSH tunnel)
  LYONS_BRIDGE_SECRET     same value as MAC_BRIDGE_SECRET on the server
  LYONS_BRIDGE_DRY_RUN=1  read and upload, but never send (recommended first)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"
STATE_DIR = Path.home() / ".lyons-bridge"
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)

SEND_SCRIPT = """
on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set theService to 1st account whose service type = iMessage
    set theBuddy to participant theHandle of theService
    send theText to theBuddy
  end tell
end run
"""


# ---------- normalisation (mirrors src/clients/identity.ts) ----------
def normalize_phone(raw: str) -> str | None:
    plus = raw.strip().startswith("+")
    digits = re.sub(r"\D", "", raw)
    if plus and 10 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def normalize_email(raw: str) -> str | None:
    m = re.search(r"([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", raw.strip())
    if not m:
        return None
    local, domain = m.group(1).lower(), m.group(2).lower()
    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+")[0]
        domain = "gmail.com"
    return f"{local}@{domain}"


def normalize_handle(raw: str) -> str | None:
    return normalize_phone(raw) or normalize_email(raw)


# ---------- chat.db reading ----------
def apple_time(value: int | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    # macOS 10.13+ stores nanoseconds since 2001-01-01; older versions seconds.
    seconds = value / 1e9 if value > 1e11 else value
    return APPLE_EPOCH + timedelta(seconds=seconds)


def decode_attributed_body(blob: bytes | None) -> str | None:
    """Best-effort extraction of text from the NSAttributedString typedstream
    that newer macOS versions store instead of `text`. Heuristic, not a full
    typedstream parser."""
    if not blob:
        return None
    try:
        data = blob[blob.index(b"NSString") + len(b"NSString"):]
        data = data[data.index(b"\x2b") + 1:]
        length, start = data[0], 1
        if length == 0x81:
            length, start = int.from_bytes(data[1:3], "little"), 3
        elif length == 0x82:
            length, start = int.from_bytes(data[1:4], "little"), 4
        return data[start:start + length].decode("utf-8", errors="replace")
    except (ValueError, IndexError):
        return None


def read_new_messages(db_path: Path, after_rowid: int, allowed: set[str], limit: int = 500):
    """Returns (messages_for_known_handles, max_rowid_seen). Unknown handles are skipped."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = con.execute(
            """SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me, m.date, h.id
               FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
               WHERE m.ROWID > ? ORDER BY m.ROWID LIMIT ?""",
            (after_rowid, limit),
        ).fetchall()
    finally:
        con.close()
    out, max_rowid = [], after_rowid
    for rowid, guid, text, body, from_me, date, handle in rows:
        max_rowid = max(max_rowid, rowid)
        norm = normalize_handle(handle or "")
        if not norm or norm not in allowed:
            continue
        content = text if text else decode_attributed_body(body)
        if not content:
            continue
        out.append({
            "guid": guid,
            "handle": norm,
            "from_me": bool(from_me),
            "text": content[:10000],
            "sent_at": apple_time(date).isoformat(),
        })
    return out, max_rowid


# ---------- server API ----------
def sign(secret: str, ts: int, body: str) -> str:
    return hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()


class Api:
    def __init__(self, base: str, secret: str, opener=urllib.request.urlopen):
        self.base, self.secret, self.opener = base.rstrip("/"), secret, opener

    def call(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = json.dumps(payload) if payload is not None else ""
        ts = int(time.time())
        req = urllib.request.Request(
            self.base + path,
            data=body.encode() if payload is not None else None,
            method=method,
            headers={
                "content-type": "application/json",
                "x-lyons-timestamp": str(ts),
                "x-lyons-signature": sign(self.secret, ts, body),
            },
        )
        with self.opener(req, timeout=30) as res:
            return json.loads(res.read() or b"{}")


# ---------- state & sending ----------
def load_state(state_dir: Path) -> dict:
    p = state_dir / "state.json"
    return json.loads(p.read_text()) if p.exists() else {"last_rowid": None, "attempted": {}}


def save_state(state_dir: Path, state: dict) -> None:
    state_dir.mkdir(mode=0o700, exist_ok=True)
    tmp = state_dir / "state.json.tmp"
    tmp.write_text(json.dumps(state))
    tmp.replace(state_dir / "state.json")


def applescript_send(handle: str, text: str) -> None:
    subprocess.run(["osascript", "-e", SEND_SCRIPT, handle, text], check=True, capture_output=True, timeout=30)


def process_outbox(api: Api, state: dict, state_dir: Path, send=applescript_send, dry_run: bool = False) -> dict:
    stats = {"sent": 0, "failed": 0, "unknown": 0}
    # Anything attempted but never acknowledged (crash mid-send) is reported, not retried.
    for msg_id in list(state["attempted"].keys()):
        api.call("POST", "/bridge/imessage/ack", {"id": msg_id, "ok": False, "error": "outcome unknown after bridge restart - check Messages before resending"})
        del state["attempted"][msg_id]
        save_state(state_dir, state)
        stats["unknown"] += 1
    if dry_run:
        return stats
    for m in api.call("GET", "/bridge/imessage/outbox").get("messages", []):
        state["attempted"][m["id"]] = int(time.time())
        save_state(state_dir, state)  # journal BEFORE sending
        try:
            send(m["handle"], m["text"])
            api.call("POST", "/bridge/imessage/ack", {"id": m["id"], "ok": True})
            stats["sent"] += 1
        except Exception as e:  # noqa: BLE001 - report every failure to the server
            api.call("POST", "/bridge/imessage/ack", {"id": m["id"], "ok": False, "error": str(e)[:400]})
            stats["failed"] += 1
        del state["attempted"][m["id"]]
        save_state(state_dir, state)
    return stats


def run_once(api: Api, state: dict, state_dir: Path, db_path: Path = CHAT_DB, dry_run: bool = False, send=applescript_send) -> dict:
    allowed = {normalize_handle(h) for h in api.call("GET", "/bridge/imessage/handles").get("handles", [])}
    allowed.discard(None)
    if state.get("last_rowid") is None:
        # First run: start from now; history is not bulk-uploaded.
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        state["last_rowid"] = con.execute("SELECT coalesce(max(ROWID), 0) FROM message").fetchone()[0]
        con.close()
        save_state(state_dir, state)
    messages, max_rowid = read_new_messages(db_path, state["last_rowid"], allowed)
    uploaded = api.call("POST", "/bridge/imessage/inbound", {"messages": messages}) if messages else {"stored": 0, "ignored": 0}
    state["last_rowid"] = max_rowid
    save_state(state_dir, state)
    out = process_outbox(api, state, state_dir, send=send, dry_run=dry_run)
    return {"uploaded": uploaded, "outbox": out}


def main() -> int:
    base, secret = os.environ.get("LYONS_BASE_URL"), os.environ.get("LYONS_BRIDGE_SECRET")
    if not base or not secret:
        print("Set LYONS_BASE_URL and LYONS_BRIDGE_SECRET", file=sys.stderr)
        return 2
    if not os.access(CHAT_DB, os.R_OK):
        print("Cannot read chat.db: grant Full Disk Access to this app in System Settings > Privacy & Security.", file=sys.stderr)
        return 3
    dry = os.environ.get("LYONS_BRIDGE_DRY_RUN") == "1"
    api, state = Api(base, secret), load_state(STATE_DIR)
    while True:
        try:
            print(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), **run_once(api, state, STATE_DIR, dry_run=dry)}), flush=True)
        except Exception as e:  # noqa: BLE001 - keep the daemon alive; launchd also restarts it
            print(f"error: {e}", file=sys.stderr, flush=True)
        time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
