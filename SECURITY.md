# Security and privacy

This repository is public so the app can be hosted for free on GitHub Pages. **It contains only program code.** No names, records, keys or passcodes belong here.

## Where information lives

| What | Where | Who can reach it |
|---|---|---|
| Accounts (email, first name, age, state, county/city) | Private Google Sheet in the owner's Drive | Signed-in members see only the people in their own councils; the owner sees the sheet |
| PINs | Never stored. Only a salted, peppered, 300-round HMAC-SHA256 hash | Nobody can read a PIN back |
| Council records, resolutions, check-ins | Same private sheet | Members of that council, and the owner |
| Private coach and advocate notes | Same sheet, marked private to one person | That person (and the parent whose phone a child uses), and the owner |
| AI key | Relay Script Properties | Only the owner's Google account |

## Protections

- **One-time email code** to create an account or reset a PIN (15 minutes, 5 tries, 4 codes per 30 minutes).
- **PIN lockout**: 5 wrong PINs locks that account for 15 minutes. Resetting a PIN signs out every other device.
- **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes, 30-day expiry, sign-out kills them.
- **Join codes**: 6 random characters, 7-day expiry, can be replaced at any time; 10 wrong tries per 15 minutes.
- **Membership checks on every request**: you can only read or act in councils you belong to, and only speak or sign as yourself or family members you added.
- **Rate limits**: per person (90 requests/minute, 40 AI requests/hour) and overall.
- **Sheet safety**: every value is written as plain text, so nothing typed can become a spreadsheet formula.
- **Strict content security policy**: the app can only talk to itself and Google Apps Script. No ads, trackers or outside scripts.
- **Children**: no accounts under 13. A parent adds them; they have no email or login of their own.
- **Audit log**: the Audit tab records actions (not content). Run `showAccessLog` in the editor.
- **Health check reveals nothing**: opening the relay URL only says whether it is running.

## What people should know (also shown at sign-up)

- Council text is sent to Anthropic's API to get AI answers.
- Live listening uses the browser's speech service (Google, in Chrome) to turn speech into text. No audio is saved.
- The app owner can see stored records.
- If a phone is lost: reset the PIN (signs out all devices).
