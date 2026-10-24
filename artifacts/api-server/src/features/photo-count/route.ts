import { Router, type IRouter } from "express";
import { getBackendUrl } from "../lib/python-backend";
import { isTrustedOrigin } from "../lib/trusted-origin";
import { countPhotoObjects, PhotoCountError, type Box } from "../lib/photo-count";
import { countOnRunpod, runpodConfigured } from "../lib/runpod-count";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 1_400_000; // The app downsizes photos before sending them.

// Suggests a quantity from a photo. Nothing is saved here: staff confirm the
// number, which is then submitted through the normal count route.
router.post("/vision/count", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!isTrustedOrigin(req)) { res.status(403).json({ error: "Untrusted request origin." }); return; }
  try {
    const session = await fetch(`${getBackendUrl()}/state`, {
      headers: { Cookie: req.get("cookie") || "" }, signal: AbortSignal.timeout(15000),
    });
    const state = await session.json() as { user?: { role?: string }; error?: string };
    if (!session.ok) { res.status(session.status).json({ error: state.error || "Session expired. Select your demo role again." }); return; }
    if (state.user?.role !== "staff" && state.user?.role !== "manager") {
      res.status(403).json({ error: "Permission required: Staff or Manager." }); return;
    }
  } catch (error) {
    req.log.error({ err: error }, "Inventory backend unavailable");
    res.status(503).json({ error: "Inventory backend unavailable. Please retry." }); return;
  }

  const { image, exemplar, label } = (req.body ?? {}) as { image?: unknown; exemplar?: Partial<Box>; label?: unknown };
  const productName = typeof label === "string" ? label.trim().slice(0, 80) : "";
  const base64 = typeof image === "string" ? image.replace(/^data:image\/(jpeg|png);base64,/, "") : "";
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) { res.status(400).json({ error: "Choose a JPG or PNG photo." }); return; }
  if (bytes.length > MAX_IMAGE_BYTES) { res.status(413).json({ error: "The photo is too large. Use a smaller photo." }); return; }
  const box = { x: Number(exemplar?.x), y: Number(exemplar?.y), width: Number(exemplar?.width), height: Number(exemplar?.height) };
  if (!Object.values(box).every(Number.isFinite)) { res.status(400).json({ error: "Draw a box around one item first." }); return; }

  const provider = runpodConfigured() ? "runpod" : "built-in";
  try {
    const result = provider === "runpod"
      ? await countOnRunpod(base64, box, productName)
      : { ...await countPhotoObjects(bytes, box), model: "template matching" };
    res.json({ ...result, provider });
  } catch (error) {
    if (error instanceof PhotoCountError) { res.status(422).json({ error: error.message }); return; }
    req.log.error({ err: error, provider, detail: (error as { detail?: string }).detail }, "Photo count failed");
    res.status(502).json({ error: provider === "runpod" ? `Photo counting service failed: ${(error as Error).message}` : "Photo counting failed. Retry or enter the count manually." });
  }
});

export default router;
