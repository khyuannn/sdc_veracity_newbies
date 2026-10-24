# Veracity

Veracity explains differences between physical stock counts and recorded inventory, supports evidence-based manager decisions, and preserves a read-only Decision Passport for each resolved case.

## Run & operate

Use the managed Replit workflows:
- `artifacts/veracity: web` — Vite/React frontend at `/`.
- `artifacts/api-server: API Server` — Express at `/api`; automatically starts and stops the existing Python backend on a private loopback port.
- The scaffolded mockup sandbox is optional and not needed to run Veracity.

Do not run a root `pnpm dev`. Managed workflows provide `PORT` and `BASE_PATH`.

The Replit **Run** button starts both managed application workflows in parallel.
On a fresh import, install the existing dependencies with
`pnpm install --frozen-lockfile`, then click **Run** and open the preview.
Choose Staff, Manager or Owner on the login screen to enter the demo.
The separate `test`, `typecheck` and `app-test` workflows are checks, not servers.
This workspace has private App Storage provisioned for evidence; a new import
must provision its own bucket rather than reuse a bucket ID from another workspace.

## Source and routes

- `artifacts/veracity/src/` — preserved imported screens, components, styles and state provider; wouter replaces Next routing.
- Other routes: `/inbox`, `/inbox/frames`, `/count`, `/account`, `/cases/:id`
  (including `?v=` assessment versions), `/history`, `/history/:id`, `/reports`.
- Entry routing: `/` always goes to `/login`, even with an existing session.
  `/login` never automatically redirects into the workspace; users select a role
  and click Log in. Protected deep links without a valid session also go to login,
  outside the app shell. A required role dropdown and Log in create the
  existing HttpOnly demo session; there is no email/password or real identity.
  There is no automatic Manager login, including on 401 or backend failures.
- Home routing after entry: Staff goes to `/work`, Manager to `/inbox`, Owner
  to `/reports`. The header menu's Change role calls `POST /api/backend/session/end`,
  revokes the session in SQLite and clears the cookie and client snapshot before
  returning to `/login`. Account is removed from both navigation layouts; old
  `/account` links redirect to the role's home. Failed exit keeps the
  current role and unsaved form. Unsaved count/import/evidence/reason work warns
  before role change (and browser unload); cancel preserves it.
  Brand links return home;
  ordinary reloads of explicit case, Passport or report links do not redirect.
  Expired sessions return to role selection; only known local deep links survive
  entry, with existing server-side role visibility still enforced.
- Login intentionally has no role-responsibility list, explanation panel or
  footer notice. Manager Inbox exposes Import records in a
  dialog, reusing the existing CSV import endpoint and role checks. Successful
  import clears the chosen file and shows confirmation; failure retains it for
  retry. While importing, closing and editing are blocked; unsaved CSV selections
  require confirmation before closing. Staff and Owner have no import entry.
- `/work` is the Staff-only personal work overview (existing current product
  coverage, own open cases and decided outcomes), not a task-assignment system.
- `/decisions` is the Owner-only decision overview presentation. It uses the
  same server-authorized state already available for History; manager visibility
  of decisions through History is unchanged. It has no mutation controls.
  Search covers product/ID/reason; action, decider and inclusive MYT decision-date
  filters are available. It highlights overrides, links to existing Passports,
  uses saved final stock, and shows missing final values as unavailable. Rejection
  shows zero correction, not a change to the physical count.
- `artifacts/veracity/public/` — original public assets and example CSVs.
- `artifacts/api-server/backend/` — original Python business logic, SQLite database and backend tests.
- `artifacts/api-server/src/routes/backend.ts` — replacement for the Next API proxy, preserving `/api/backend/*`, browser-origin checks and HttpOnly session cookies.
- `lib/api-spec/openapi.yaml` — transport contract. Domain payloads and validation remain owned by the imported backend and frontend domain types.
- `scripts/post-merge.sh` — configured in `.replit` to run dependency/setup steps after merges; keep this folder.
- `GUIDE.md` — the single project guide (run, Replit, workflow, photo count/RunPod, demos, tests, troubleshooting). `docs/test-data/` holds shareable CSVs, documents and photos.

## Persistence and scope decisions

The migration preserves Python and SQLite rather than replacing the existing database or rewriting inventory reconciliation rules. This minimizes behavioral regressions and retains the original transactional approval, evidence versioning, audit and permission logic. The scaffolded PostgreSQL library is unused by this app.

SQLite defaults to `artifacts/api-server/backend/veracity.sqlite3`; the original optional `VERACITY_DB` setting is preserved. Runtime databases, WAL files, test screenshots and traces are excluded from Git and deployment uploads. No database contents were included in the import.

This remains the original local MVP: demo sessions allow anyone to choose Staff, Manager or Owner. This is not real authentication. `VERACITY_DEMO_MODE=false` disables demo sessions but does not add authentication. Keep this limitation visible when discussing production use; production authentication and durable hosted database choices are separate work, not part of the preservation-only port.

## Case document evidence

For explicit Windows/macOS/Linux development without Replit services, see root
`README.md` and `node local-dev/start.mjs`. These additive launchers keep the same
frontend/Express/Python structure, use separate ignored `.veracity-local` test
state, and opt into authenticated development-only disk uploads. Replit workflows
do not opt into this mode; cloud App Storage behavior remains unchanged.

In default Replit mode, JPEG, PNG and PDF documents (10 MiB maximum each, optional description up to 1000 characters) are private App Storage objects. No file bytes are saved in SQLite, the frontend/public directory, Git, or a local upload folder in this mode. App Storage must be provisioned; missing configuration fails explicitly without a local fallback. The existing Python/SQLite store remains authoritative for case permissions, upload reservations, attachment metadata, immutable assessment snapshots and audit history. This is an intentional exception to the generic storage scaffold's new-auth/new-database setup: neither identity nor inventory persistence was replaced.

Only managers and the case's submitting staff member can upload to an open case; owners can only view. This is enforced through the existing HttpOnly cookie session forwarded to Python. Express has a per-process private capability for internal evidence calls; the generic backend proxy rejects those paths. There are no generic upload, public file, replacement or deletion routes. The demo switcher still lets anyone choose a role, so these controls do not make this MVP safe for real sensitive evidence or production use.

`/api/evidence/cases/:id/uploads` reserves an actor/case-scoped idempotent upload with a generated storage ID. The browser PUTs bytes directly to a short-lived private staging URL. Finalization checks actual stored size (not client MIME/size alone), decodes images with a pixel cap, parses PDFs, pins the stored generation, and preserves a create-only final object before linking it in a SQLite transaction. Upload URLs only address staging; reusing a URL cannot replace saved evidence. Failed verification never creates an attachment or upload audit entry. Transfer and finalize retries reuse the original ticket. Temporary staged bytes can exist for abandoned or invalid uploads; cleanup of abandoned objects is separate from user attachment deletion and must never remove linked final objects.

Every decision, rejection and review request checks the client-observed attachment revision. Decision dialogs freeze that revision at opening, even if background polling refreshes the page. New uploads do not change assessments or quantities. Assessment versions snapshot only document IDs already available at assessment creation; historical pages and historical file requests enforce that membership. Current cases and closed Decision Passports show saved documents, with uploads disabled after closure.

App Storage protects document bytes across service restarts; metadata retains the existing SQLite restart persistence and hosting limitations. No database or production deployment migration was performed.

## Weekly inventory reporting

Managers and read-only owners have a **Summary** navigation entry at `/reports`.
`GET /api/backend/reports/weekly?week=YYYY-MM-DD` requires their existing session;
staff cannot access the aggregate report. The optional week is a Monday from
2000 onwards, no later than this week. Calendar boundaries are Monday–Sunday in
`Asia/Kuala_Lumpur`, with an exclusive next-Monday cutoff. The current week
refreshes every 30 seconds while visible. The week selection is in the URL.

Counts submitted includes matching counts (which create no case), and products
counted deduplicates product IDs within the week. New cases use creation time;
closed cases use decision time even if opened earlier. Outstanding cases include
earlier weeks, reconstructed at the cutoff from assessments, review events and
decisions. Aged cases are open at least 7 days. Shortage/surplus figures sum initial
differences on new cases; repeated observations are not net stock movements,
confirmed losses or monetary valuations.

Closed-week summaries are reconstructed on first access and persisted as JSON
metadata in the existing SQLite `weekly_reports` table. They are not automatically
captured on Sunday. **Why:** the local MVP has no scheduler or real manager
identities; freezing on first read makes later viewing stable without pretending
historical stock values or scheduled delivery existed. Backdated changes after
that first read are intentionally not reflected. Current case links may show a
newer status than a saved summary. The current week's report is never frozen.
No email delivery, task assignment system, new database or mock data was added.
Development data includes earlier browser-test records; it is not business data.

## Tests

- `pnpm exec playwright test tests/demo-entry.spec.ts tests/import-entry.spec.ts`
  checks the simplified Login, removed Account navigation/legacy redirects,
  Manager-only modal import, product/movement payloads, error recovery, unsaved
  file close confirmation, busy-state protection and mobile sizing. Import POSTs
  in this focused test are intercepted, so it does not add inventory test data.

- `pnpm exec playwright test tests/demo-entry.spec.ts tests/role-homes.spec.ts tests/weekly-report.spec.ts`
  covers demo entry, role landing, role change/revocation, failed entry/exit,
  cancelled/accepted unsaved-work prompts, expiry, safe deep links and mobile.
  These tests do not create inventory or approval data.

- `pnpm exec playwright test tests/role-homes.spec.ts` — real-record role landing,
  session reloads, preserved direct links, read-only Owner navigation, Staff
  scoping and mobile layout; browser-only fixtures (no inventory writes) cover
  all decision types, exact timestamp ordering, MYT date boundaries, invalid
  ranges, decider/action/text filters, empty results and missing stock values.
- `pnpm exec playwright test tests/weekly-report.spec.ts` — reads existing development records (no synthetic products/counts), verifies report totals, prior-week query forwarding and frozen reloads, case links, mobile layout, staff/owner permissions and failure/retry. Historical GETs save the requested weekly snapshot.
- `pnpm test` — Python backend tests (temporary SQLite databases) plus file-content verification tests; includes permissions, transactional rollback, stale evidence/documents, idempotency, historical snapshots and HTTP sessions.
- `pnpm run typecheck` — full workspace check.
- `pnpm test:e2e` — Playwright starts a dedicated loopback gateway, API/Python backend, temporary SQLite DB and local evidence directory. It never targets the running walkthrough instance. `PLAYWRIGHT_BASE_URL` is rejected; all specs must import `test` from `tests/isolated-test.ts`, whose automatic fixture verifies the run identity before any test starts.
- Migration/evidence test records and files exist only in that temporary instance, which is removed on teardown. Read-only, WAL-consistent snapshots verify the demo database's business tables remain unchanged before/after the run; no user data is reset or cleaned. The suite covers CSV import, counts, approval, Passport, documents/retry/stale-review/roles/history and weekly reports. See README for standalone test prerequisites.
- Screenshots/traces go to ignored `generated-artifacts/`.
- Playwright uses the Replit-provided Chromium when present; elsewhere install its browser with `pnpm exec playwright install chromium`.
- Registered validation commands: `test`, `typecheck`, `app-test`.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate shared transport helpers after API contract changes. The original frontend state provider intentionally remains in use.
