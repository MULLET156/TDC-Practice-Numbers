# Practice Numbers

The owner's view of how Toledo Dental Care is doing: production, collections, A/R and trends, straight from Open Dental. It's one module of the TDC Office suite and opens inside the Dental Dashboard at `/m/numbers/`. **Owners and admins only. It never changes anything in Open Dental.**

## What's on it

| Page | What you see |
|---|---|
| **At a glance** | Gross production, collections, net production, adjustments and write-offs, new patients and the collection rate, each compared with the period before and with last year (green arrow = good news, red = worth a look). Then the rest of this month: what's scheduled from tomorrow to month end, and "done plus scheduled" against all of last month. A 13-month production chart. |
| **Production** | By provider, by day (by week or month for long ranges) and by procedure code, plus a short list of codes you watch (crowns, implants…). |
| **Collections** | Patient and insurance payments, by provider, and the collection rate (collections ÷ net production). |
| **A/R** | Aging (0–30, 31–60, 61–90, over 90 days), outstanding claims by how long they've been out, and unsent claims. Lists with patient names open only when you tap a button, and are never saved. |

Every page has a date picker: **This month, Last month, Quarter, Year to date, Custom**. Every chart has a **Chart | Table** switch, prints its numbers on the chart (nothing hides behind hover on a tablet), and works on phones.

The Dashboard home gets one tile, **Production MTD**: month to date against last month to date. It shows no patients.

**Numbers come only from Open Dental**, through the office gateway. If the gateway doesn't answer a report yet, that card says **Not available yet** instead of showing a made-up number, and a blue note at the top lists what's missing. It fills in by itself once the gateway has it.

## Set it up on Windows (by hand, for trying it out)

You need **Node.js 20 or newer**. Open **Command Prompt** and type `node -v`; if it says v20 or higher you're set. If not, install the LTS version from [nodejs.org](https://nodejs.org).

1. **Get the code.** On GitHub, **Code → Download ZIP**, then right-click the zip → **Extract All**.
2. **Get the module's secret.** In the Dashboard: **Settings → Modules → Add a module**. Id `numbers`, address `http://127.0.0.1:3104`, leave Secret empty, click **Add module**. Copy the secret it shows (it's shown once).
3. **Get a gateway key for this module.** On the computer with the gateway, in the opendental-claude folder: `node gateway/cli.js new-key numbers`. It prints a key starting `odg_`. (For trying things on a laptop, the demo gateway's test key `odg_test_numbers_key_0004` works with `npm run dev` there. That one is fake data only.)
4. In the Practice Numbers folder, copy **.env.example** to **.env** and open it in Notepad. Fill in:
   - `MODULE_SECRET=` the secret from step 2
   - `GATEWAY_URL=` the gateway's address (the office gateway's tunnel address, or `http://127.0.0.1:8787` for the demo)
   - `GATEWAY_KEY=` the key from step 3
5. Double-click **start.cmd**. You should see `Practice Numbers 0.1.0 (design stage) listening on http://127.0.0.1:3104/`.
6. In the Dashboard, open **Practice Numbers** (or go to `/m/numbers/`).

Never put the secret or the key in GitHub, email or chat.

### Optional settings (in `.env`)

| Setting | What it does |
|---|---|
| `COUNT_CODES=D2740,D6058,D6065,D6010,D2950` | Procedure codes counted in "Procedures I watch" on the Production page |
| `PATIENT_LISTS=off` | Hides the A/R family and claims lists |
| `TDC_TZ=America/Los_Angeles` | The office's time zone (decides what "today" is) |

## Put it on Hostinger (design stage)

Practice Numbers runs as its **own** Hostinger Node.js app, built from this repo's `main` branch. Every merge to `main` redeploys it.

1. hPanel → **Websites → Add Website → Node.js web app → Import Git repository** → **MULLET156/TDC-Practice-Numbers**, branch **main**.
2. Build settings: Framework **Other**, Node **22**, Build command empty, Entry file **server.js**.
3. **Environment variables:**

   | Name | Value |
   |---|---|
   | `TDC_STAGE` | `design` |
   | `HOST` | `0.0.0.0` |
   | `GATEWAY_URL` | the office gateway's tunnel address, e.g. `https://od-gateway.toledodentalcare.com` |
   | `GATEWAY_KEY` | this module's own gateway key (`new-key numbers`) |
   | `MODULE_SECRET` | from the Dashboard (step 4 below) |
   | `TZ` | `America/Los_Angeles` |

   Don't set `PORT`; Hostinger sets it.
4. In the Dashboard: **Settings → Modules → Add a module**: id `numbers`, address = this app's `https://…hostingersite.com` address, Secret empty → **Add module**. Paste the secret it shows into `MODULE_SECRET` above, then redeploy.
5. Open `https://<this app>/health`. It should say `{"ok":true,"version":"0.1.0","contract":1}`.

**Safety built in:** every few minutes the module asks the gateway which stage it's in. If the gateway ever says `live` (the real database), the Hostinger copy stops showing numbers by itself and shows **Numbers are paused**. Nothing from Open Dental is ever written to disk; totals are kept in memory for 5 minutes, and patient lists aren't kept at all.

## Office server (live stage, later)

The same code. Set `TDC_STAGE=live`, `PORT=3104`, the office gateway's `GATEWAY_URL` (`http://127.0.0.1:8787`) and key. In the live stage it only listens on `127.0.0.1`, so only the Dashboard can reach it. The Installer will set it up as a Windows service.

## How to test

**The automatic tests** (made-up data only, never your database): in the folder, open Command Prompt and run `npm test`. Every line should end `ok`, and the summary says `fail 0`.

**By hand, after it's on Hostinger and added to the Dashboard:**

1. Log in to the Dashboard as an owner. Open **Practice Numbers**. You should see four big tabs: At a glance, Production, Collections, A/R.
2. **At a glance:** the number cards show this month so far, each with an arrow line "vs Oct 1 – 17" and "vs last year". Check one number against Open Dental (for example **Reports → Production and Income** for the same dates).
3. Tap **Last month**, then **Year to date**, then **Custom**, pick two dates and tap **Show**. The banner's dates and the "Compared with…" line should change each time.
4. On any chart, tap **Table**: the same numbers as a table. Tap **Chart** to go back. It remembers your choice.
5. **A/R:** tap **Families with a balance**. A list with names appears. Tap **Hide**, or leave the page, and it's gone.
6. **On a phone:** the tabs move to the bottom of the screen; charts turn into sideways bars.
7. **Dark mode:** tap the moon in the header. Everything should stay readable.
8. Log in as someone who is **not** an owner or admin: Practice Numbers shouldn't be in their apps, and its address says "Practice Numbers is for owners and admins".
9. **Dashboard tile:** the home page shows **Production MTD** with last month to date under it.

**Contract check (for agents):** with the module running, from the TDC-Dental-Dashboard folder:
```
node scripts\check-module.js http://127.0.0.1:3104 --env C:\path\to\TDC-Practice-Numbers\.env
```

## Next

- The demo gateway doesn't answer adjustments, write-offs, payments, procedure codes and A/R yet (opendental-claude issue #14). Through the real gateway on the demo database they should all work.
- A "collections by month" report, so the 13-month chart can show collections too without 26 separate gateway calls.
