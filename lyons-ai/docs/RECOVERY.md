# Recovery Procedures

| Situation | Do this |
|---|---|
| **Something is going wrong right now** | Telegram `/pause`, or the Control Center **EMERGENCY STOP**. This halts every running task at its next step, blocks new tasks, webhooks, scheduled jobs, iMessage sends and storage actions, and puts the receptionist into voicemail-only mode. Hard stop: `docker compose stop lyons-ai`. |
| One module misbehaves | `/pause_module <name>` or the Pause button in the Control Center (`opportunities`, `gmail_cleanup`, `communications`, `receptionist`, `browser`, `device_storage`, `client_relationships`, `core_agent`). |
| An email/iMessage went out that shouldn't have | Check the audit trail: `/task <id>`, the Control Center action log, or `SELECT * FROM audit_log ORDER BY id DESC`. If it went out under an automation policy, `/policy_revoke <id>`. Messages can't be unsent: follow up personally. |
| An action shows **outcome unknown** | The system crashed mid-action and deliberately did not retry. Check the target (Gmail Sent, Messages, Calendar) by hand, then tell the agent what happened. |
| Gmail cleanup removed something you need | `gmail_cleanup_revert` for that plan ("revert cleanup plan abc123"), or in Gmail search `label:LYONS/Cleanup-YYYY-MM-DD` and move it back. Trashed mail is recoverable for 30 days in Gmail Trash. |
| Storage cleanup moved the wrong file | On the Mac, open Trash → right-click → **Put Back**. Each action's moved paths are in `storage_actions.result` and the audit log. |
| Wrong client match | `/identities` shows pending matches. For a wrong confirmed link: `DELETE FROM client_identities WHERE value = '<email/phone>'`, then re-sync. |
| Opportunity engine is noisy | `/pause_module opportunities`; lower `OPP_MAX_ALERTS_PER_DAY`; tap **Not for me** (it learns, within ±10 points). |
| Receptionist said something wrong | `/pause_module receptionist` (calls go to voicemail). Review the call transcript in the `calls` table and the safety-filter events, then tighten `receptionist.knowledge`. |
| Google token leaked or device lost | `/disconnect_google business` and `/disconnect_google personal` revoke the tokens. Also review third-party access at myaccount.google.com/permissions. |
| Mac bridge secret leaked | Change `MAC_BRIDGE_SECRET` in `.env`, run `docker compose up -d`, and update the plist on the Mac. |
| Control Center token leaked | Change `CONTROL_CENTER_TOKEN` and restart. Sessions are bound to the token, so every existing session is invalidated immediately. |
| Database lost or corrupted | Restore the latest backup (`docs/DEPLOYMENT.md` §5). Tasks resume from their stored transcripts; completed actions are not repeated. |
| Spend spike | `/status` shows today's spend. The daily cap blocks further model calls automatically. Lower `DAILY_SPEND_LIMIT_USD`, `OPP_DAILY_RESEARCH_BUDGET_USD`, or `RECEPTIONIST_MAX_TURNS`. |

Every sensitive action is in `audit_log`, which is append-only: a database trigger rejects edits and deletes.
