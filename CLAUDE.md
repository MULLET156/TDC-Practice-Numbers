# Practice Numbers — notes for agents

Read the shared plan first: **MULLET156/TDC-Office-Plan** (README, PLAN, CONTRACT, DESIGN, SITE-OUTLINE, STATUS) and the kickoff `prompts/6-practice-numbers.md`. Follow CONTRACT.md exactly; propose changes as an issue there titled `Contract change: ...`.

Module id `numbers`, port 3104, accent Bronze. **Read only. Owner and admin only.**

## Rules
- Node.js 20+ built-ins only. No npm dependencies.
- Pull `main` and check open PRs first. Short branch → PR → **merge it yourself** when CI is green (Windows and Linux) and `scripts/check-module.js` (in TDC-Dental-Dashboard) passes. Merging `main` redeploys the Hostinger app: check its `/health` right after and revert at once if it broke. Contract changes need Ryan's OK first.
- Open Dental only through the gateway with this module's key, using `vendor/opendental-core/` (never edit it; update with `node scripts/sync-core.js <version>`). Need a report? Open `Report request: <name>` in opendental-claude.
- **Real numbers only** (Ryan, 2026-11-17): no sample or made-up numbers on the pages. A report the gateway doesn't answer shows "Not available yet". Tests use invented data only.
- Open Dental data stays in memory (5-minute cache for totals); patient lists (`/api/list/*`) are never cached, never logged, and only load after a tap. No patient names on totals pages or the tile.
- No patient data in code, tests, issues, logs or screenshots. Never print or commit secrets.
- Follow DESIGN.md; use the shared `.tdc-*` classes. `public/numbers.css` holds only what the kit lacks (number cards, charts), with `--tdc-*` colours only.
- README and PR descriptions in plain language, Windows first, with "How to test". Update only the Practice Numbers row in TDC-Office-Plan/STATUS.md.

## Map
- `server.js` — reads `.env`, builds the gateway client, starts the app.
- `lib/app.js` — routes, signature + role check, stage guard (every 5 min), tile, manifest, logs.
- `lib/data.js` — every report call, the in-memory cache, totals and comparisons.
- `lib/periods.js` — date ranges and what each is compared with. `lib/pages.js` — HTML. `lib/charts.js` — SVG charts. `lib/fmt.js` — money, %, arrows.
- `public/numbers.js` — Chart/Table switch, range picker, patient lists. `public/numbers.css`.
- `test/` — `node --test` with a made-up gateway (`test/helpers.js`).
