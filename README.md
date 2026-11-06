# Yashodhan Group | Sales Intelligence Dashboard

CRM sales intelligence for **Yashodhan Group**: classify pipeline risk and intent from sheet rows + call history, then action leads from a dense enterprise dashboard.

Project path: `D:\Projects\asa-scaliq-leads`

## Features

- Classification engine (Gone Dark, Not Picking Up, Mismarked NI, Stuck, High / Very High Intent)
- File-backed CRM store under `data/crm/`
- Synthetic seed dataset under `data/synthetic/`
- Next.js dashboard with 16 intelligence tabs, global filters, lead drawer, reviews/overrides
- CSV/XLSX import, call CSV import, report exports
- Google Sheets + Runo sync stubs (credentials server-side only)

## Quick start

```bash
cd D:\Projects\asa-scaliq-leads
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/dashboard`.

On first snapshot load (empty `data/crm/raw_rows.json`), the API auto-seeds synthetic CRM + call CSVs.

## Vercel deploy

Local `npm run build` succeeds. The App Router lives in **`src/app`** (not a root `app/` folder).

If Vercel fails with `Couldn't find any 'pages' or 'app' directory`:

1. Ensure this full repo (including `src/app`) is what Vercel builds — push `main` to the linked GitHub repo.
2. In Vercel → Project → Settings → General → **Root Directory**: leave **empty** (project root). Do not set it to a subfolder that lacks `src/app`.
3. Framework Preset: **Next.js**. `vercel.json` is already in the repo.

CRM writes on Vercel use `/tmp` (read-only app filesystem). Re-sync after cold starts if needed.

## Seed / import

- **Auto-seed**: `GET /api/crm/snapshot` when store is empty
- **Force seed**: `POST /api/crm/seed` or use **Data Health & Settings → Reload synthetic seed**
- **CRM import**: multipart `POST /api/crm/import` (CSV/XLSX)
- **Calls import**: multipart `POST /api/crm/import-calls` (CSV)

Synthetic files:

- `data/synthetic/yashodhan_crm_synthetic.csv`
- `data/synthetic/yashodhan_calls_synthetic.csv`

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run start` — serve production build
- `npm test` — Vitest classification / CRM unit tests

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/crm/snapshot` | Full snapshot (auto-seed if empty); optional `filters` JSON query |
| POST | `/api/crm/import` | CRM CSV/XLSX upload |
| POST | `/api/crm/import-calls` | Call CSV upload |
| POST | `/api/crm/seed` | Force synthetic reload |
| GET/POST | `/api/crm/sync` | Sheets sync status / stub sync |
| POST | `/api/crm/reviews` | Append manual review |
| POST | `/api/crm/overrides` | Append classification override |
| GET | `/api/crm/export?report=...` | CSV download |

## Published Google Sheet dataset

Primary live source (no API key required):

- HTML: https://docs.google.com/spreadsheets/d/e/2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW/pubhtml
- CSV (server fetch): same workbook via `/pub?output=csv`

Sync from **Data Health & Settings → Sync published Google Sheet**, or `POST /api/crm/sync` with `{ "mode": "published" }`.

Optional override: `GOOGLE_SHEETS_PUBLISHED_CSV_URL`

## Pending integrations

- **Google Sheets API** (private sheets): set server env only:
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - `GOOGLE_PRIVATE_KEY`
  - `GOOGLE_SHEETS_ID`
  - `GOOGLE_SHEETS_RANGE` (optional)
- **Runo API**: `src/lib/crm/runo.ts` stub. Set `RUNO_API_KEY` server-side when wiring live call sync. Until then, use the published sheet sync or call CSV import.

Never put Google/Runo credentials in frontend code.

## Notes

- Classifications come from `snapshot.classifications` (one source of truth).
- Overrides/reviews are additive — engine results are never deleted.
- Call-dependent rules surface **INSUFFICIENT CALL DATA** when coverage is missing.
- Booking opportunity tiers are transparent rule reasons, not AI probability scores.
