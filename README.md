# Family Council

A phone-first app for settling disagreements at home fairly, from "whose turn is it for dishes" to sibling, parent-and-child and relationship conflicts.

- **AI guides**: Mother, Judge Grace, The Elder, Grandmother, Pastor, or The Mediator run the council.
- **A private advocate for each person**: like a lawyer's assistant. It helps you tell your side truthfully, names your strongest point and your weak spots, and only you see it.
- **Live listening**: with everyone's consent, the app listens, steps in out loud when voices rise or someone is name-calling, and coaches each person privately on how to carry themselves.
- **Talking stick**: tap a person to give them the floor. What's heard is credited to them.
- **Home vs. a real court**: side by side for every council, with the laws for each person's state, county and age, marked **Verify**, with links to official sources and a "For kids" explanation.
- **Signed resolutions**: specific promises (who, what, by when), signatures, one appeal, check-ins.
- **Accounts**: email + PIN, with a one-time email code. Under 13s are added by a parent and speak and sign on the parent's phone. Others join with a code like `ABC-123`.
- **Peace Points, streaks, levels and badges**: earned for speaking up, apologizing, inviting, resolving and keeping promises, never for "winning".
- **Safety**: anything that sounds like abuse, threats or self-harm stops the mediation and shows 911, 988, the DV hotline and Childhelp.

This repository holds program code only. See SECURITY.md.

## How it fits together

```
Phones (this app on GitHub Pages)
   │  signed-in requests (email + PIN session)
   ▼
Google Apps Script relay (relay/Code.gs, runs in the owner's Google account)
   ├── Google Sheet "Family Council - Private Data" (accounts, councils, records)
   ├── Gmail (one-time codes and invites, sent from the owner's account)
   └── Anthropic API (guides, advocate, coaching, rulings, court comparison)
```

## One-time setup

1. **Turn on GitHub Pages**: Settings → Pages → Deploy from a branch → `main`, `/ (root)` → Save. The app appears at `https://crispcleaninc-dot.github.io/family-council/`.
2. **Create the relay**: script.google.com (signed in as the account that should own the data) → New project → name it **Family Council Relay** → paste `relay/Code.gs` into `Code.gs` → Save.
3. **Script Properties** (Project Settings → Script Properties):
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Every family's AI use is billed to this key.
   - `APP_URL` = `https://crispcleaninc-dot.github.io/family-council/`
   - optional: `SUPPORT_EMAIL`, `AI_PER_HOUR` (default 40 per person per hour)
4. Run **`testSetup`** once and approve the permissions. The log shows the private sheet's link and an AI test reply.
5. **Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy.** Copy the `/exec` URL.
6. Put that URL in **`config.js`** (`RELAY_URL`) and commit. Everyone's app then connects on its own.
7. **CAIOCC**: register the `/exec` URL as the health check. Opening it returns `{"ok":true,...}` and nothing private.

Updating the relay later: Deploy → Manage deployments → edit → **New version** (the URL stays the same).

## Tests

```
node tests/backend.test.js   # 67 checks: accounts, lockouts, join codes, privacy of coach/advocate, rulings, points
node tests/ui.test.js        # 26 checks: two phones end to end, live listening with fake speech, signing, safety
node tests/dev-server.js     # run the whole app locally at http://localhost:8787 with a fake AI
```

The tests run the real `relay/Code.gs` against a stand-in for Google's services (`tests/mock-gas.js`).

## Notes

- Live listening needs Chrome (Android or computer) or Edge. iPhone Safari's speech support is limited; typing and dictation still work there.
- Not a court, a lawyer, or a therapist. Law information is general education and must be verified.
