# Communications Hub, Client Relationships & Gmail Cleanup

## Unified client timeline
Each client has a record with known identifiers (emails, phones, company domains). Their timeline combines:

| Source | What's stored | How |
|---|---|---|
| Gmail (inbound and Sent) | Subject and snippet, direction, and whether it looks like a request | `clients_sync` (last 14 days by default). **Only mail involving a known client is stored.** |
| Google Calendar | Meetings with client attendees, with upcoming ones as obligations | `clients_sync` |
| Google Contacts | Adds phone numbers to clients whose email matches exactly | `clients_sync`. Contacts are never turned into clients automatically. |
| iMessage | Messages with known client handles | macOS bridge (below) |
| Phone | Receptionist call summaries | `docs/RECEPTIONIST.md` |
| StayOps | Planned: needs a StayOps API (`STAYOPS_INTEGRATION.md`) | — |
| LYONS AI outbound | Every draft and send, with status `draft → queued → sent → replied` | Automatic |

Ask "what's going on with Acme Rentals?" (`client_timeline`) or send `/followups` for unanswered client requests (over 24 h), the next 7 days of obligations, and sent messages with no reply after 3 days. The morning briefing includes this.

### Identity matching: confidence first
| Signal | Confidence | Result |
|---|---|---|
| Exact email already linked to one client | 1.0 | Linked automatically |
| Exact phone already linked | 0.95 | Linked automatically |
| Same company domain (not gmail.com etc.) | 0.6 | **Suggestion**: you confirm with `/identity <id> yes` |
| Same name | 0.5 (0.3 if similar) | Suggestion |
| Email and phone point to different clients, or two clients share a name | — | **Conflict**: never linked, you decide |

One identifier can belong to only one client. Caller ID and message handles can be spoofed, so matches are for organizing, not for proving who someone is. The receptionist never discloses client information to a caller.

## Sending: approval first, narrow automation later
- Replies are written as **Gmail drafts** first.
- `gmail_send_draft` and `imessage_send` are `external_communication`: each send shows you the exact recipient and text, and waits for approval.
- `gmail_send_draft` re-reads the draft and refuses to send if its real recipient or subject differs from what you approved.

**Automation policies** let one narrow kind of message skip per-message approval:
1. The agent proposes a policy with `comms_policy_propose`. The policy must list specific recipients (no wildcards, at most 25) and a daily cap of 1–20. It can also restrict the subject prefix and allowed hours.
2. **Only you can activate it**, with `/policy_activate <id>`. No AI tool can activate a policy.
3. Each automatic send is audited as `approval.by_policy`, linked to the policy, and counted against its cap. Revoke it any time with `/policy_revoke <id>`.

Example: "Confirm next-day turnovers to nicole@acmerentals.com, subject starting 'Turnover confirmed', max 3 a day, 8 am–6 pm."

## Gmail Intelligence & Cleanup

1. **Scan** (`/cleanup` or "clean up my inbox"). This step is read-only. Each message is classified as spam, promotions, newsletter, social, receipt, invoice, financial, legal, client, or other.
2. **Protected, never touched:** invoices, receipts, financial, legal, client mail, starred mail, mail with your own labels, and important non-bulk mail.
3. **Plan:** archive bulk mail older than 30 days by default. Trash only if you ask, and only promotions and social, never newsletters. The report shows counts by type and action, protected counts by reason, the biggest senders, unsubscribe suggestions, and recovery options.
4. **Apply** (approval required). The approval shows the exact counts, and the tool refuses to run if the plan's counts differ. Archived mail gets the label `LYONS/Cleanup-YYYY-MM-DD`. Trash stays recoverable in Gmail for 30 days.
5. **Revert** (`gmail_cleanup_revert`) moves everything back to the Inbox and out of Trash.
6. **Never:** permanent delete. The mailbox interface has no delete method.

**Unsubscribe** uses RFC 8058 one-click only, after approval:
- It never unsubscribes from spam, since that confirms your address to spammers.
- It never follows a URL that resolves to a private network.
- It checks that the sender you approved is the one being unsubscribed.
- Senders with only a web link or an email address are handed to you to finish manually.

> Requires the `gmail.modify` and `contacts.readonly` scopes. If your Google accounts were connected before this update, run `/connect_google business` (and `personal`) again.

## iMessage (macOS bridge)

**There is no official iMessage API.** The supported, honest route is a small bridge running on **your own Mac**, signed in to your Apple ID:

- **Reading:** it reads `~/Library/Messages/chat.db` read-only. You grant Full Disk Access to the app that runs it.
- **Privacy:** it first downloads the list of known client handles and uploads only those conversations. Personal chats never leave the Mac. The server also drops anything it can't match to a client.
- **Sending:** it sends approved messages through the Messages app (AppleScript; you grant Automation permission). Sends stop instantly when `communications` is paused or the kill switch is on.
- **Crash safety:** an interrupted send is reported as "outcome unknown" and is never resent automatically.
- **History:** the first run starts from "now". Old conversations aren't bulk-uploaded.

Setup (≈15 min):
1. Generate `MAC_BRIDGE_SECRET` (`openssl rand -hex 32`), add it to `.env` on the server, and restart.
2. Make the Mac able to reach the server **privately**: install Tailscale on both machines (recommended), or use an SSH tunnel. Only uncomment `/bridge/*` in the Caddyfile if neither is possible; requests are HMAC-signed either way.
3. Copy `deploy/macos-bridge/` to the Mac. Grant **Full Disk Access** to Terminal (or the Python you use) in System Settings → Privacy & Security.
4. Run it once with `LYONS_BRIDGE_DRY_RUN=1` (read and upload only, never send), and check the client messages appear.
5. Install the launchd agent (`com.lyons.imessage-bridge.plist`), then set `LYONS_BRIDGE_DRY_RUN` to `0` to allow sending. The first send triggers macOS's Automation permission prompt.

Limits:
- **chat.db format:** the text of newer messages is decoded heuristically, and Apple can change the database format in any macOS update.
- **Group chats** aren't handled.
- **SMS green-bubble sends** depend on Text Message Forwarding from your iPhone.
- **Untested on a Mac:** the bridge is tested against a synthetic database built with the same schema. It has not yet run against a real Mac.
