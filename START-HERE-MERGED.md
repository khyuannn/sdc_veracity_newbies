# Veracity: photo counting + crate tracking

This is the merged version of your teammate's uploaded project, with the simulated RFID crate feature added. Use this version rather than applying the older RFID ZIP over the latest project.

## Run
1. Extract the ZIP and open `sdc_veracity_newbies-main` in VS Code.
2. Install: `pnpm install --frozen-lockfile`.
3. Run: `pnpm local`.
4. Open the address printed by the launcher. Use your existing working Node/Python setup (see README).

If merging into an existing project, keep your existing `.env`, deployment secrets, local database and evidence files. Do not delete or replace them. Restart both backend and frontend after merging. Replit uses its existing Project workflow; republish a deployment if required.

## Show the combined journey
1. Staff/Manager → Crates → Register crate. Choose an existing product and generate a demo tag ID.
2. Simulate RFID scan → view product, last recorded rack/location and crate journey.
3. Change the simulated reader location → scan again → see the location-review warning.
4. Confirm the whole-crate transfer → review the saved history and location grouping.
5. Check this product's stock → Count opens with the product already selected and its recorded crate locations visible.
6. Count from photo → upload, draw a box around one item, review the suggested detections, verify the quantity and coverage, then Use this count.
7. Submit the count through the existing workflow. Managers still control stock corrections.

There is no physical RFID reader connected. Reader observations are explicitly simulated or entered IDs. A crate's declared quantity is not a live stock count; count the complete relevant product scope.

## Your teammate's photo feature
The photo dialog, local image counter, RunPod connector and detector worker files are unchanged. No new service or secret is required for the crate feature. For remote photo inference keep the existing RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID secrets; without both, the teammate's built-in template-matching counter is used. See `docs/PHOTO_COUNT.md` for existing setup details.

## Checks completed
- 74 Python backend tests passed.
- 17 Node tests passed, including the 39-pack photo fixture tests.
- Three Chromium browser tests passed: count entry, crate reader/transfers, and crate → photo count → confirmation → saved count.
- Workspace TypeScript checks and frontend/API production builds passed. Existing sourcemap and bundle-size warnings remain.
- Browser tests use isolated temporary data and the built-in image counter; no live RunPod model invocation or physical Android/RFID device was tested.

More details: `docs/RFID-DEMO-GUIDE.md`. Source changes relative to your teammate's uploaded ZIP: `docs/RFID-CHANGES.patch`.
