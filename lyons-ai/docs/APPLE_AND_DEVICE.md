# Apple Devices & Storage: What's Possible

LYONS AI **cannot control your iPhone.** iOS doesn't allow outside software to operate the phone, read other apps' data, or act on your behalf. The table below lists what can and can't be done legitimately.

| Capability | Possible? | How | Notes |
|---|---|---|---|
| Remote-control the iPhone, tap through apps | ❌ No | — | iOS sandboxing; no legitimate route |
| Read or send iMessages | ✅ Via a Mac | Mac bridge reading `chat.db` and sending through Messages (`docs/COMMUNICATIONS.md`) | Needs an always-on Mac on your Apple ID. No official API; can break with macOS updates |
| Read iPhone SMS, call history, or voicemail directly | ❌ No | — | Not exposed to apps or servers |
| Trigger LYONS AI from the iPhone | ✅ Yes | **Apple Shortcuts**: "Get Contents of URL" to a signed n8n webhook, or simply message the Telegram bot | Personal automations (time of day, arrive/leave a place, CarPlay connect…). Many can run without asking; some actions still require confirmation |
| Create reminders and events on the iPhone | ✅ Yes | Via Google Calendar (already built), or iCloud Reminders through a Shortcut you run | |
| iCloud Photos / iCloud Drive via API | ❌ No public API | iCloud Drive files are reachable as normal files on a Mac that syncs them | CloudKit only covers an app's own data |
| Find duplicate files | ✅ Yes (built) | Mac storage scanner (`deploy/macos-bridge/lyons_storage_scan.py`) | Read-only scan; moving to Trash needs your approval per group |
| Find duplicate **photos** | ⚠️ Partly | Mac: open-source `osxphotos` (read-only) can list duplicates; you delete in the Photos app (Recently Deleted keeps them 30 days). iOS: a companion app using PhotoKit can find them, and iOS itself asks you to confirm every deletion | The scanner deliberately skips `*.photoslibrary`; editing it directly corrupts the library |
| Clean up contacts | ⚠️ Partly | Google Contacts API (read-only today); iCloud contacts via the Contacts app on a Mac | Merges and deletes only with your approval |
| iOS companion app | ✅ Possible later | Apple Developer Program ($99/yr), Swift app with App Intents (Siri/Shortcuts), PhotoKit with your permission, push notifications | Can't read other apps' data, iMessages or calls |
| Manage company iPhones (cleaners' devices) | ✅ For company-owned devices | Apple Business Manager + an MDM | Manages settings and apps; doesn't read personal content |

## Hardware
- **For iMessage and storage on the Mac:** a Mac that stays on. A **Mac mini** is ideal, at about $600 one-time. It should be:
  - signed in to your Apple ID with Messages enabled;
  - set never to sleep, with FileVault on;
  - running the bridge under launchd.
- **Your existing Mac also works**, but only while it's awake.
- **The VM** (Ubuntu) runs LYONS AI itself. Kali Linux is not recommended for hosting; keep it, if wanted, on a separate VM for testing your own systems' security.

## Storage assistant: how it works
1. Run `python3 lyons_storage_scan.py ~/Downloads ~/Documents ~/Desktop` on the Mac. It hashes files (size → first 64 KB → full SHA-256), so only byte-identical files count as duplicates. It also lists files over 500 MB. App bundles, `Library`, hidden folders and Photos libraries are skipped.
2. The report goes to LYONS AI. Ask "what's taking space on my Mac?" or check the Control Center → Storage recommendations.
3. To clean up, you approve one duplicate group at a time (`storage_trash_duplicates`, risk `destructive`). The approval prompt lists every path.
4. On its next run, the Mac re-hashes the kept copy and each extra copy, skips anything that changed since the scan, and moves the rest to the **Trash** through Finder, so "Put Back" works. Nothing is ever permanently deleted.

**Tested:** the scanner logic on Linux with real files (true-duplicate detection, near-duplicate rejection, Photos-library skip, re-hash safety). **Not yet tested on a Mac:** the Finder Trash call (`osascript`).
