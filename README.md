# Kopra Ko: offline copra + uling tracker (PWA) v1.3.2
Run locally: `python3 -m http.server 8765` → http://127.0.0.1:8765 (the service worker needs http/https).
Tests:
- `node --test tests/` (calc, store, validation, sync against a mock that mirrors the DB trigger)
- `bash tests/sql_test.sh` (local Postgres 17: trigger, clock skew, RLS, caps)
- `python3 tests/e2e.py` (headless Chromium at 390×844; needs the server running)
- `node staging/staging_test.js` (kept outside tests/ so `node --test tests/` never touches the network) (real Supabase staging; reads secrets from /home/box/.secrets and never prints them)

## Input limits (enforced in forms, backup import, and DB CHECK constraints)
| Field | Allowed |
|---|---|
| Raw coconut per batch | > 0 and ≤ 200,000 kg (about 50 truckloads) |
| Copra kg | 0 to raw kg |
| Buy price / Asarez price | > 0 and ≤ ₱100 per kg raw (today about ₱10) |
| Copra sell price, Settings copra price | > 0 and ≤ ₱200 per kg (today ₱44–56) |
| Kg sold per sale | > 0 and ≤ 200,000, and never more than on hand |
| Expense, gas | > 0 and ≤ ₱1,000,000 per entry |
| Bagol per burn | > 0 and ≤ 100,000 kg; uling 0 to bagol kg; uling price ≤ ₱200 |
| Margin | ₱0–5; merienda cap ₱0–5 per kg |
| Text fields | name/buyer 120 chars, note 200 chars |
Backup import is checked strictly: types, required fields, negatives, caps, valid dates, unique IDs, batch references, and sold ≤ made. Unknown fields are dropped. A bad file is rejected and nothing changes.

## v1.3 behaviour
- **Copra lifecycle per batch:** Still drying (no copra kg) → Not yet sold (copra entered; not counted as sold, valued only as *unrealized* at the Settings price) → Part sold → Complete. Use "Mark as sold" to record kg + actual price; partial sales are allowed. Realized profit uses the actual sale price. The Settings copra price is never changed by a sale.
- **Editing copra below the kg already sold** no longer blocks the edit. Example: sheet row 10 "hayag 9 oct" was 5,780 kg / 1,329 kg, but the real Hayag load is 3,143.5 / 723, so the row likely combined two loads. The extra sold kg moves to a "not assigned" sale at the same price, so no revenue is lost. A red card asks you to assign it to the right batch in Records. data.csv has no split, so none is invented.
- **Uling is one pool:** estimated bagol (bagol % × all raw kg) → burns (in kiln / done) → uling on hand → pool sales (`uling_sales`). Burns are not tied to batches.
- **Projections** for batches still drying:
  - Yield = 70% raw-weighted yield of the last 5 finished batches + 30% lifetime yield. The low–high range uses the worst and best batch yields.
  - Copra value uses the Settings price. Uling = raw × bagol % × pool uling yield × uling price.
  - Projected profit = copra value − buy cost − every bill linked to the batch, so bills lower it as they are logged.
  - Once actual copra is entered, the projection becomes a variance figure. Accuracy is back-tested: each finished batch is projected only from the batches before it, and the average miss % plus how many landed inside the range are shown on the dashboard.
- **Migration from v1.2 phones:** IndexedDB goes to version 2 (this only adds the `uling_sales` store). A one-time data step turns each v1.2 burn marked "sold" into status "done" plus one pool sale with the same kg and price. Nothing is deleted, and the step is safe to run twice. Importing a v1.2 backup applies the same step.

## Releasing
- Bump `APP_VERSION` in version.js on every release (semver). sw.js names its cache `kopra-<version>` and deletes old `kopra-*` caches.
- CNAME = copra.johnnybodegas.com (GitHub Pages). Do not deploy until QA gives GO.

## Cloud sync (v1: OFF by default)
- To turn it on, add `?sync=1` to the URL. This works **only for that page load**; it is not remembered. To keep it on, set localStorage `kopra_flags` to `sync` from the browser console.
- With sync off, batch numbers show without the device tag (e.g. `#11`). With sync on they show `#11-G3`, because numbers can clash across phones.

Setup:
1. Run supabase/schema.sql (idempotent).
2. **Disable open sign-ups** in Dashboard → Authentication → Sign In / Providers → turn off "Allow new users to sign up". Then create the two partners under Authentication → Users → Add user.
3. Run supabase/setup_team.sql and enter the URL, anon key and team_id on each phone.

How ordering works (no phone clock is trusted):
- Every accepted write gets a server `seq` (monotonic bigint sequence) and `updated_at = now()`.
- Each push carries `base_seq`, the version it was edited from. The trigger skips the write if the row has changed since (first to the server wins). Deletes are always accepted and are permanent.
- A skipped push is detected (missing from the returned rows). The app re-reads that row, applies the server copy, and logs a conflict that keeps the losing local copy.
- The pull cursor is the highest `seq` seen. Each pull re-reads the last 200 seq values to cover transactions that commit out of order; applying a row twice is harmless.
- A fresh, untouched phone adopts the cloud data instead of uploading a duplicate seed. Restore/reset deletes the current records and inserts the backup with new IDs.
- Tokens refresh on 401, and errors appear in the sync card.

## v1.3.1 fixes
- **Updates reach installed phones:** `sw.js` embeds `SW_VERSION` (must equal `APP_VERSION` in `version.js`; a unit test enforces it), so its bytes change every release. Pre-cache uses `cache:'reload'`. E2E test installs v1.2.0, serves v1.3.2, and checks the SW update, cache `kopra-1.3.1`, migration and offline use.
- **Uling pool never goes negative:** deleting or editing a burn so that uling made < uling sold is refused with a message (delete or reduce uling sales first).
- **Copra cut below sold kg:** the app asks for the corrected raw kg for that batch (or tick "Raw kg is already correct"). The split-off sale is kept as unassigned (`from_batch`), and that batch is **left out of yield / bid / projections** until the sale is assigned. The bid guide shows a note while this applies.
- Backup import: unassigned sales get the same caps; `from_batch` is checked.
- Migration writes the pool sale **before** changing the burn status (crash-safe, idempotent).
- Projection low–high range ignores the single best and worst yield when there are 5+ batches.
- DB: run `alter table sales add column if not exists from_batch uuid;` (in schema.sql) before turning sync on.

## v1.3.2 fixes
- **Unassigned copra sales are bound to a batch:** every unassigned sale must have a `from_batch` that points to a real, live batch, plus `lineage_copra` (the batch's copra kg when the sale was split off). For each batch, assigned + unassigned kg sold must be ≤ min(max(copra, lineage_copra), raw kg). The same rule (`Calc.lineageErrors`) is checked on **backup import** (the file is rejected) and **in the app** (an edit that breaks it is refused). Deleting a batch also deletes its unassigned sales.
- Hand-made backups for these tests are in `tests/fixtures/` (e.g. a 150,000 kg unassigned sale that would have added ₱6.9M of copra sales; now rejected).
- DB: `alter table sales add column if not exists lineage_copra numeric ...` (in schema.sql).
- `tests/e2e.py` starts its own server on :8765 if none is running. The −100 kg import test now picks a live batch.
