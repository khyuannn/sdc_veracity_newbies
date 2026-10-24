import type { Box, CountResult } from "./photo-count";
import { PhotoCountError } from "./photo-count";

// Optional: when both are set (Replit Secrets or local environment), photo
// counting runs on the RunPod serverless worker in detector/ instead of in
// this process. Without them the built-in counter is used.
export function runpodConfigured() {
  return Boolean(process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID);
}

// Overridable only so tests can stand in a fake RunPod.
const API = process.env.RUNPOD_API_BASE || "https://api.runpod.ai/v2";
const DEADLINE_MS = 150_000; // Allows for a cold start of a GPU worker loading the model.

// A worker crash comes back as a JSON traceback. Staff see one short line;
// the full detail stays in `detail` for the server log.
export class RunpodJobError extends Error {
  readonly detail?: string;
  constructor(status: string | undefined, detail?: string) {
    let reason = "";
    try { reason = String((JSON.parse(detail ?? "") as { error_message?: string }).error_message ?? ""); }
    catch { reason = detail ?? ""; }
    reason = reason.trim().split("\n").find((line) => line.trim())?.trim().slice(0, 160) ?? "";
    super(`the worker ${status === "FAILED" || !status ? "failed" : `ended as ${status}`}${reason ? ` (${reason})` : ""}. Check the endpoint's Logs in RunPod.`);
    this.detail = detail;
  }
}

interface Job { id?: string; status?: string; output?: CountResult & { model?: string; error?: string }; error?: string }

async function call(path: string, init?: RequestInit): Promise<Job> {
  const response = await fetch(`${API}/${process.env.RUNPOD_ENDPOINT_ID}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(DEADLINE_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("RunPod rejected the API key. Check RUNPOD_API_KEY.");
  if (response.status === 404) throw new Error("RunPod endpoint not found. Check RUNPOD_ENDPOINT_ID.");
  if (!response.ok) throw new Error(`RunPod request failed (HTTP ${response.status}).`);
  return await response.json() as Job;
}

// `label` (the product name) lets the GPU worker's detector find every item of
// that kind, not only ones that look exactly like the example.
export async function countOnRunpod(imageBase64: string, exemplar: Box, label: string): Promise<CountResult & { model?: string }> {
  const started = Date.now();
  let job = await call("runsync", { method: "POST", body: JSON.stringify({ input: { image: imageBase64, exemplar, label } }) });
  // runsync returns early while a cold worker is still queued; poll until done.
  while (job.id && (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS")) {
    if (Date.now() - started > DEADLINE_MS) throw new Error("RunPod took too long. Retry in a moment.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    job = await call(`status/${job.id}`);
  }
  if (job.status !== "COMPLETED" || !job.output) throw new RunpodJobError(job.status, job.error);
  if (job.output.error) throw new PhotoCountError(job.output.error);
  return job.output;
}
