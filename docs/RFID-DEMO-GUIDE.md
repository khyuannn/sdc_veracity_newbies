# Veracity crate tracking: demo guide

## What this version delivers
An Android-friendly web workflow for identifying crates, seeing their last recorded location, reviewing transfers and checking product stock. It has a simulated reader and keeps physical hardware claims separate from software functionality.

One tag identifies one crate containing one product type. The database links crate ID, tag, product and a quantity declared at registration. That quantity is historical: removing items does not update it automatically.

## Start the updated project
- Work from this ZIP's project root. Install dependencies with `pnpm install --frozen-lockfile`.
- Local VS Code: run `pnpm local` and use the local address printed by the launcher. Existing Python 3 and Node prerequisites still apply; see the main README.
- Replit: merge the changed source, restart the existing Project workflow, and republish if sharing a deployment.
- Keep your current environment secrets and database when merging. Do not overwrite your live `.veracity-local` directory with files from a downloaded archive if you have made newer entries.
- Restarting the Python backend creates the new `crate_scans` table automatically; existing products, crates, decisions and transfer records are preserved.
- No extra packages, GPU service, RunPod setup, tag purchase or reader are needed for simulation.
- Use the deployment link in an Android browser for the phone/tablet demo. The layout was checked in Chromium at phone width; no physical Android hardware was tested.

## A two-minute demonstration
1. Enter as Staff or Manager and open **Crates**.
2. Click **Register crate**. Use an existing product, **Generate demo ID**, declared quantity 12, and initial location Stockroom. Click **Save crate registration**.
3. In **Demo RFID reader**, select the newly registered tag. Set reader location to Stockroom and click **Simulate RFID scan**.
4. The system identifies the crate and displays product, last recorded location, original declared quantity and journey. Scan activity records a timestamp and the existing demo user's name, explicitly marked Simulated.
5. Change the simulated reader location to Rack B and simulate another scan. The system flags **Location review needed** because the record still says Stockroom. It does not move the crate or change stock automatically.
6. After verifying the intended move, enter Rack B under Destination, add a note and click **Confirm transfer**. The location grouping and journey update. The earlier observation retains its original context.
7. Click **Check this product's stock**. The existing Count page opens with the product selected. **Where else is this product?** lists its other registered crates/locations, helping staff check all relevant places before declaring a shortage.
8. Use the existing Count workflow to submit the verified product total. A crate declaration is never substituted for a physical count. Your teammate's Count from photo dialog remains integrated here: upload a photo, draw one example box, review detections and confirm the total before submitting.
9. Optional: select Unknown tag (demo), scan and show how an unregistered identifier is flagged without creating stock.
10. Show Owner mode: records remain visible; operational writes are disabled and rejected on the backend.

The app does not seed fictional products or crates automatically. To show several racks, explicitly register additional crates for products you already use.

## What is automated
- Tag-to-crate lookup and detail display.
- Recording scan source, stated reader location, actor and time.
- Comparing a scan's stated location with the record and flagging a mismatch for review.
- Grouping registered crates by last recorded location.
- Recording the confirmed transfer history and linking products to the existing count flow.

Crate movement confirmation and physical count verification remain human actions. A simulated observation is not proof of real location.

## Accurate presentation wording
"Veracity demonstrates an RFID-ready crate-tracking workflow using simulated reader input. It retrieves crate records, highlights location inconsistencies and connects recorded locations to stock investigation. Physical RFID integration is a future implementation step."

Do not present this as deployed physical IoT, automatic rack occupancy detection, automatic loose-item counting or theft detection. RFID tracking is not itself the application's AI model.

## Hardware path later
A compatible keyboard-output RFID reader can supply its tag ID to the expanded Enter an ID field, followed by Enter. That input is recorded as Entered ID, because the web application cannot prove whether it came from hardware or typing. Real equipment must use compatible tags and reader protocol, a consistent identifier format and a connection supported by the Android device. Serial/SDK-only readers and automatic gateways need a separate adapter. The reader location is supplied by the user in this prototype, not detected from the tablet.

No QR or NFC integration is required for this scope.

## Technical flow
- React/TypeScript frontend → existing Express proxy → Python rule/permission layer → SQLite.
- GET `/api/backend/crates` returns crate records and the latest 100 scan observations.
- POST to that route accepts action `register`, `scan` or `transfer` with a requestId.
- Scan sources are `simulated` and `entered_id`; the backend does not accept claims of verified hardware input.
- Crate scans store the recorded location and revision at the time of reading. Confirming a transfer resolves the old revision's location warning without rewriting that observation.
- Retrying the same request ID does not duplicate the action. Reusing it for different data is rejected. Conflicting transfers use revision checks.
- Scans and transfers do not enter the quantity-movement reconciliation table, avoiding incorrect additions or double counting.
- The role chooser remains demo access, not real per-employee authentication.

## Merge with your teammate
The included `docs/RFID-CHANGES.patch` contains source and test changes relative to the exact uploaded `sdc_veracity_newbies-main (1).zip`. Apply/review it on a branch; if files have changed, merge the relevant changes manually. Do not replace your teammate's Count file wholesale.

In CountView, the additions are the ProductCrateLocations import, a one-time product query selection effect and the product-location panel after selecting a product. Existing count calculations and submission calls remain unchanged. Your teammate's photo-count dialog, local template-matching counter, RunPod connection and detector worker files are preserved. The local counter works without RunPod; retain existing RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID secrets to use the remote provider. See docs/PHOTO_COUNT.md for the teammate's setup.

## Validation
- 74 Python backend tests passed, including scan persistence, permissions, no inventory side effects, unknown tags, repeat requests, mismatch flags and HTTP routing.
- Workspace TypeScript checks passed.
- Frontend and API production builds passed. Existing bundle-size/sourcemap warnings remain.
- Three Chromium browser tests cover the existing count-entry regression, the complete reader/register/transfer/count workflow and the combined crate-to-photo-count-to-submit workflow at desktop and phone widths, including unknown tags, persistence and read-only owner access.
- Browser tests use a temporary isolated database and local evidence storage. The demo-data snapshot was unchanged.
- The 17 existing Node tests include your teammate's photo-count fixtures; the combined browser test exercises the actual built-in image-processing endpoint. Remote RunPod inference was not called.
- Physical RFID/NFC devices and actual Android hardware were not tested.
