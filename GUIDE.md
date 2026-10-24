# Veracity project guide

Everything a teammate needs to run, demo, test and deploy Veracity, in one file.

Inventory discrepancy review with evidence attachments, human approval, saved
Decision Passports and AI-assisted photo counting. This is a **synthetic-data
prototype with demo role switching**, not production authentication.

Demo roles: **Staff** count stock, **Manager** imports records and decides cases,
**Owner** has read-only oversight. Pick a role on the login page.

- [Run locally in VS Code](#run-locally-in-vs-code)
- [Run on Replit and publish](#run-on-replit-and-publish)
- [How a count becomes a decision](#how-a-count-becomes-a-decision)
- [Count from photo (RunPod GPU)](#count-from-photo-runpod-gpu)
- [Demo walkthroughs and test data](#demo-walkthroughs-and-test-data)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Source layout](#source-layout)
- [Evidence cleanup tool (admins)](#evidence-cleanup-tool-admins)
- [Scope and limitations](#scope-and-limitations)
- [AI use declaration](#ai-use-declaration)

## Run locally in VS Code

Works on Windows, macOS and Linux. Requirements:

- Node.js **24 LTS**, pnpm **10** (`npm install --global pnpm@10`), Python **3.10+**.
- Any terminal, including PowerShell. Reopen VS Code after installing runtimes.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm local
```

Or press **Ctrl+Shift+B** (runs the same `pnpm local` from `.vscode/tasks.json`).
Wait for **Server listening**, then open **http://localhost:3000**.

- Always use `--frozen-lockfile`. A plain `pnpm install` rewrites `pnpm-lock.yaml`,
  which Replit needs unchanged; never commit lockfile changes made that way.
- Express starts its own private Python backend. **Do not run `python server.py`
  separately**; it lacks the upload routes and takes the API's port.
- Two terminals instead: `pnpm local:backend` and `pnpm local:frontend`
  (or `node local-dev/backend.mjs` / `node local-dev/frontend.mjs`).
  Still browse port 3000, not the internal Vite port.
- Stop with **Ctrl+C**. Restart the backend after backend changes; frontend edits
  hot-reload.
- If a build tool binary is missing for your OS, the launcher installs it into the
  ignored `local-dev/.native/` with npm, without touching the workspace or lockfile.

Optional launcher settings (set in the terminal): `LOCAL_WEB_PORT` (3000),
`LOCAL_API_PORT` (8000), `LOCAL_VITE_PORT` (5173), `LOCAL_DATA_DIR`
(`.veracity-local`), `PYTHON_EXECUTABLE`. Use the same values in both terminals.

### Local secrets: `.env.local`

`local-dev/backend.mjs` loads a Git-ignored `.env.local` from the repo root.
Variables already set in the terminal win. Use it for RunPod (see below):

```text
RUNPOD_API_KEY=rpa_...
RUNPOD_ENDPOINT_ID=...
```

Open it with `code .env.local` (VS Code search skips ignored files). Never put
real values in `.env.example`; it is committed and only lists variable names.

### Local data and evidence uploads

```text
.veracity-local/              (ignored by Git, excluded from Replit publishing)
├── veracity.sqlite3          inventory, cases, sessions, attachment metadata
└── evidence/
    ├── evidence-staging/     pending file bytes
    └── case-evidence/        verified immutable attachments
```

The local database starts empty; import sample CSVs as Manager in
**Inbox → Import records**. Data persists across restarts but **is not shared
through Git**: every teammate has their own. Local uploads use the same
permissions and validation as Replit (JPEG/PNG/PDF, nonempty, at most 10 MiB) and
never change stock or extract quantities. Local file storage is refused unless
`NODE_ENV=development`; Replit keeps using private App Storage and never falls
back to local disk.

## Run on Replit and publish

- Replit runs the frontend (`artifacts/veracity`) and API (`artifacts/api-server`)
  from their `.replit-artifact/artifact.toml` files. Do not add a root `dev` script.
  Workflow and storage details for Replit Agent are in `replit.md`.
- Put keys in **Tools → Secrets**, never in Environment variables: those are
  written in plain text into `.replit`, and GitHub then rejects the push.
- After changing Secrets or pulling code, **restart the API**; refreshing the
  browser is not enough. If no Stop/Run button is visible, run in the Shell
  `pkill -f "dist/index.mjs"`, wait ~20 s and refresh the Preview.
- The published `*.replit.app` site only changes after **Publish → Republish**.
- Code flows VS Code → GitHub → Replit (**Git → Pull**). Invited collaborators
  share one workspace and one set of Secrets; agree who edits where to avoid
  conflicts, and check `.replit` contains no `RUNPOD_` lines before pushing.

## How a count becomes a decision

1. **Trigger**: Staff or Manager submits a count (total quantity, or a +/-
   adjustment from recorded stock). The server reads the recorded quantity and
   refuses a second open case for the same product.
2. **Connected data**: all unposted movements for the product dated at or before
   the count are snapshotted. No subset is chosen to force a match.
3. **Decision**: signed quantities are summed. Normal approval needs an exact
   match with `counted − recorded`, eligible records and no conflict; otherwise
   the case is incomplete or conflicting. Rule results, rule version, evidence hash
   and explanation are stored.
4. **Approval**: only a Manager decides (approve, reject, request review or
   override), against the latest assessment version, inventory revision and
   evidence hash. Staff and Owner cannot decide.
5. **Outcome**: in one SQLite transaction (`BEGIN IMMEDIATE`), approval posts each
   eligible movement once, updates stock once, writes one ledger entry per case,
   closes the case and saves the Decision Passport and audit entry. Repeated or
   concurrent approvals cannot adjust stock twice.

An **override** records one explicit adjustment to the counted balance and marks
the remaining evidence unresolved, so it can never be applied again later.
**Refresh evidence & reassess** appends a new assessment (old versions are kept);
an older assessment can no longer be approved. Closed cases are read-only.

**Summary** page (Manager, Owner): Daily, Weekly, Monthly or Yearly, all in
**Asia/Kuala_Lumpur** time with Monday–Sunday weeks. Current periods update while
visible; past periods are saved on their **first view**. Opened cases use creation
time and closed cases use decision time.

## Count from photo (RunPod GPU)

Staff can let AI suggest the counted quantity from a photo. The AI only
suggests; staff confirm, and the normal rules and manager approval still apply.

1. **Count** → choose the product → **Count from photo** → take or choose a photo.
2. Drag a box around **just one** item (one pack, not the whole box).
3. **Count items**: detected items get green boxes. Tap a box to exclude a wrong
   one; type a higher number for missed items.
4. Tick *"This photo covers the whole counting area"* → **Use this count**. The
   quantity and a note (*"Counted from photo: AI detected 39."*) are filled in.
5. **Submit count** as usual.

The line under the result shows what counted it, for example
**`Counted by RunPod · owlv2 (name, cuda)`**:

| Shown | Meaning |
| --- | --- |
| `built-in counter · template matching` | No RunPod configured. Finds look-alikes of the example (Node + `sharp`). Good for neat rows of identical items, poor for mixed flavours. |
| `owlv2 (name, cuda)` | RunPod GPU worker found items by **product name** (OWLv2 open-vocabulary detector); the example sets size and shape. Best accuracy. |
| `owlv2 (example, …)` | The product name found nothing, so it matched the example's look only. Usually the **wrong product is selected**; the dialog warns about this. |
| `… cpu` | Running on a CPU endpoint: slow and may time out. Use a GPU endpoint. |

Measured on two test photos: built-in 39/39 packs but 3/13 mixed cans; OWLv2
39/39 packs and 12/13 cans. Results can vary by one or two, so staff review stays.
Photos are downsized in the browser and **not stored**.

### RunPod setup

Serverless is billed only while a photo is processed; with **Active workers 0** an
idle endpoint costs nothing. CPU or GPU is fixed when the endpoint is created.

1. RunPod → (team account) **Serverless → New Endpoint → GitHub repo**, branch
   `main` (only a team owner can connect GitHub).
   - Dockerfile path `artifacts/api-server/detector/Dockerfile`,
     build context `artifacts/api-server/detector`.
   - **GPU**, *Previous generation*, 16 GB and 24 GB ticked; Active workers **0**,
     Max workers **1**, idle timeout ~5 s, container disk **20 GB+**.
2. Wait for **Builds → Completed** (10–20 min). Merging changes to
   `artifacts/api-server/detector/` into `main` rebuilds automatically; the build
   runs `smoke_test.py`, so a missing package fails the build, not a staff request.
3. Copy the **Endpoint ID** and create an API key *for this endpoint*
   (keys generated on another endpoint get HTTP 403 here).
4. Set `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` in Replit Secrets and in your
   `.env.local`, then restart the API.

A cold GPU worker takes ~30–60 s; warm requests take ~1.5 s. Before a demo, count
one photo to warm it up. Share keys privately only; prefer one restricted key
per person so one can be revoked alone.

Code: `artifacts/veracity/src/features/photo-count/` (dialog),
`artifacts/api-server/src/features/photo-count/` (route `POST /api/vision/count`,
built-in counter, RunPod client), `artifacts/api-server/detector/` (GPU worker).

## Demo walkthroughs and test data

Data is never loaded automatically. Log in as **Manager → Inbox → Import records**.
Imports only add records; never re-import the same IDs. Import products before
movements.

### Sample data (`artifacts/veracity/public/examples/`)

Import `products.csv`, then `movements.csv` (keep `additional-evidence.csv` for later).

| Product | Recorded | Count | Result | Next step |
| --- | ---: | ---: | --- | --- |
| Mineral Water 500ml | 50 | 43 | Sales total −7, supported | Manager approves → stock 43 |
| Chocolate Biscuits | 40 | 33 | Only −3 sales, incomplete | Request review; import `additional-evidence.csv`; **Refresh evidence & reassess**; approve → 33 |
| Canned Coffee | 24 | 22 | Delivery/return conflict | Request review, override to 22 after checking, or reject and recount |

Counting coffee as 24 first shows a no-difference count (no case). Finish as
Owner to see Summary, Decision overview and read-only Passports.

### Evidence upload pack (`docs/test-data/evidence-pack/`)

Synthetic products A/B/C with `csv-records/` (import) and `upload-documents/`
(two PDFs and one illustration PNG for **Case documents**; not proof of damage).

1. Import `products.csv` and `movements.csv`. Submit a count of **33** for
   **Snack Biscuits B** (recorded 40) after 20 Oct 2026 08:30 MYT.
   Expected: shortage 7, explained 3, **4 unexplained**; normal approval blocked.
2. As Manager or the Staff creator, upload the three files to the open case.
   They stay after refresh; numbers and stock do not change.
3. Optional: import `additional-evidence.csv` (structured DR004 damage −4), then
   **Refresh evidence & reassess**: explained 7, unexplained 0, old assessment kept.
   Approve once → stock 33; approving again changes nothing.

On a shared instance let one person do the mutating steps, and never delete a
teammate's data to reset.

### Photo samples (`docs/test-data/photo-count/`)

`snack-biscuits-39.jpg` (39 packs; used by an automated test, do not move),
`coffee.jpg`, `spritzer.jpg`. Pick the matching product before counting.

## Tests

```bash
pnpm test                 # Python backend + API node tests
pnpm run typecheck
node --test artifacts/veracity/tests/evidence-upload.test.mjs
pnpm exec playwright install chromium   # once, outside Replit
pnpm test:e2e             # 12 browser tests
```

`pnpm test:e2e` starts its own loopback frontend, API, Python backend, temporary
SQLite database and evidence folder, removes them afterwards, refuses
`PLAYWRIGHT_BASE_URL`, and checks the demo database is unchanged. Never point
write tests at a demo instance. On Windows the e2e suite passes with Edge; the
Python suite's temp-file cleanup and the symlink test in
`artifacts/api-server/tests/test-isolation.test.mjs` only pass on Linux (Replit).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `pnpm: command not found` | `npm install --global pnpm@10`, reopen VS Code |
| Dependencies missing | `pnpm install --frozen-lockfile` in the repo root |
| Python not found | Install Python 3.10+, reopen VS Code (tries `python`, `py -3`, `python3`) or set `PYTHON_EXECUTABLE` |
| Port already used | Stop the old Node/Python process; don't mix startup styles |
| `Could not enter demo` / `Unexpected end of JSON input` | API not running: use `pnpm local`, wait for **Server listening**, open port 3000 |
| `Session expired` right after login | Port 8000 is taken by a standalone `python server.py`; stop it, start `node local-dev/backend.mjs` |
| `Untrusted request origin` | Open http://localhost:3000 (or the Vite port), not another host |
| Empty inventory | Import CSVs as Manager in **Inbox → Import records** |
| Upload rejected on a closed case | Use the latest assessment of an open case as Manager or its Staff creator |
| Photo count: `RunPod rejected the API key` / HTTP 403 | Key belongs to another endpoint; create one on this endpoint |
| Photo count: timeout | The running API still has old Secrets (often an old CPU endpoint): restart the API; republish |
| Photo count: `owlv2 (example, …)` and odd results | Wrong product selected for the photo |
| GitHub push rejected `GH013` | A key was committed (usually in `.replit`); move it to Secrets and undo that commit |
| `pnpm test:e2e`: browser executable missing | `pnpm exec playwright install chromium` |

## Source layout

| Path | Responsibility |
| --- | --- |
| `artifacts/veracity/src/components/screens/` | Frontend pages |
| `artifacts/veracity/src/components/reports/` | Summary picker, charts, metrics, follow-ups |
| `artifacts/veracity/src/components/veracity/`, `ui/` | Shared workflows, controls and UI primitives |
| `artifacts/veracity/src/features/photo-count/` | Count-from-photo dialog |
| `artifacts/veracity/src/hooks/`, `lib/` | Requests, state, dates, formatting |
| `artifacts/api-server/src/` | Express gateway, evidence file service, photo-count route |
| `artifacts/api-server/backend/` | Python/SQLite inventory, imports, assessments, decisions, reporting |
| `artifacts/api-server/detector/` | RunPod GPU worker (path fixed in the RunPod endpoint) |
| `lib/api-spec/` | OpenAPI contract and codegen; `lib/api-client-react/`, `lib/api-zod/` are generated, don't edit |
| `local-dev/` | VS Code launchers and local gateway |
| `tests/` | Isolated Playwright browser tests |
| `docs/test-data/` | Shareable CSVs, documents and photos |
| `artifacts/mockup-sandbox/` | Replit Canvas design tool; not the product |
| `replit.md`, `.agents/` | Read by Replit Agent; keep |

Storage tables: `products`, `movements`, `counts`, `cases` (JSON snapshots with
append-only versions), `sessions`, `ledger` (one per case), `audit`. Back up the
SQLite database with SQLite backup tooling, not by copying a live WAL file.

## Evidence cleanup tool (admins)

An offline, manual tool to reclaim unused evidence files from **cloud** App
Storage (refused for `VERACITY_STORAGE=local`). It is not a web feature and never
changes attachments, permissions or database records. A database backup is not a
backup of attachment bytes: list **every** active database (`--db`) and every
backup that may still be restored (`--backup`).

```bash
# 1. Preview only (writes a plan; deletes nothing)
python3 artifacts/api-server/backend/evidence_cleanup.py \
  --db /abs/current.sqlite3 --backup /abs/backup.sqlite3 \
  --retention-days 90 --backups-complete \
  --report generated-artifacts/evidence-cleanup/plan.json

# 2. Stop ALL services sharing the bucket, wait 16 min (signed upload URLs last
#    15 min), preview again to offline-plan.json, review it, then:
python3 artifacts/api-server/backend/evidence_cleanup.py \
  --db /abs/current.sqlite3 --backup /abs/backup.sqlite3 \
  --retention-days 90 --backups-complete \
  --apply generated-artifacts/evidence-cleanup/offline-plan.json \
  --offline-confirmation ALL-EVIDENCE-SERVICES-STOPPED \
  --confirm DELETE-EVIDENCE-<hash printed by the preview>
```

Retention defaults to 90 days (minimum 30). Attachments of any case, files
referenced by audit/ledger, and anything referenced by an active upload or any
backup are always kept. Plans expire after 24 hours; any read error aborts.
Deletions are generation-checked and logged to `<plan>.deletions.jsonl`. If a run
fails midway, keep the log and start again from a fresh preview. Never commit
reports or logs.

## Scope and limitations

Implemented: persistent local workflow, CSV connector, deterministic
investigation, manager decisions with override, evidence versioning, case
documents, read-only Passports, audit/ledger with concurrency controls, period
reports and AI photo-count suggestions.

Not implemented: live Orbyte API (CSV import only), production login (the role
selector is demo authentication), multi-business hosting, document authenticity
checks or extraction from uploaded PDFs/photos, automatic conflict resolution and
measured business impact. Use synthetic data only.

## AI use declaration

Review against the official event rules before submitting; no declaration
guarantees eligibility. Suggested wording:

> We used AI-assisted development tools to help interpret requirements, plan the
> workflow, generate and revise backend and frontend code, draft automated tests and
> write documentation. Our team reviewed, tested, modified and can explain the
> submitted implementation. Veracity's stock reconciliation uses deterministic
> rules and SQLite; it does not use a generative AI model to decide or approve
> stock corrections, and consequential changes need manager approval or a recorded
> override. The optional photo count uses a pretrained object detector (OWLv2) or
> template matching to *suggest* a quantity that staff must confirm. Example data is
> synthetic. Live Orbyte integration is proposed, not claimed.

Tool log (complete with what the team actually used):

| Tool | Use |
| --- | --- |
| ChatGPT | Backend generation, API integration, tests, documentation |
| Replit Agent | Workspace setup, features, fixes on Replit |
| Claude Code | Local VS Code setup, photo count and RunPod worker, tests, docs |
| Original frontend generator (`v0.app`) | Initial UI prototype; confirm and attribute |
| OWLv2 (Google, via Hugging Face) | Runtime photo-count suggestions on RunPod |

Do not claim measured time savings, real SME adoption, production security or
live integrations unless separately demonstrated. Every member should be able to
explain the five stages, why incomplete evidence cannot be approved normally,
what override does and why stock is never adjusted twice.
