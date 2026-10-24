import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyPlan, classify, validatePlan, digest } from "../tools/evidence-cleanup-core.mjs";

const now = Date.parse("2026-10-22T00:00:00Z");
const key = `case-evidence/${"a".repeat(32)}`;
const old = { generation: "10000000000000001", size: "32",
  timeCreated: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z" };
const config = { protected: {}, retentionDays: 90, backupsComplete: true, inventory: "test-inventory" };
const plan = () => ({ version: 1, scope: "private-scope", createdAt: new Date(now).toISOString(),
  retentionDays: 90, backupsComplete: true, inventory: config.inventory, objects: [{ key, ...old }] });

test("retention uses both creation and update; missing metadata and arbitrary paths never qualify", () => {
  assert.equal(classify(key, old, {}, 90, now), "candidate");
  assert.equal(classify(key, old, { [key]: ["attachment-reference"] }, 90, now), "attachment-reference");
  assert.equal(classify(key, { ...old, updated: new Date(now).toISOString() }, {}, 90, now), "within-retention");
  assert.equal(classify(key, { ...old, timeCreated: "invalid" }, {}, 90, now), "invalid-metadata");
  assert.equal(classify(key, { ...old, generation: undefined }, {}, 90, now), "invalid-metadata");
  for (const path of ["public/test", "../case-evidence/test", `case-evidence/${"a".repeat(32)}/other`]) {
    assert.equal(classify(path, old, {}, 90, now), "outside-scope");
  }
});

test("apply deletes only planned orphan with exact generation precondition", async () => {
  const removed = [], events = [];
  await applyPlan(plan(), config, { scope: "private-scope", metadata: async () => old,
    remove: async (...args) => removed.push(args) }, e => events.push(e), now);
  assert.deepEqual(removed, [[key, old.generation]]);
  assert.deepEqual(events.map(e => e.result), ["delete-requested", "deleted"]);
});

test("new live or backup reference, changed object and missing object block deletion", async () => {
  for (const reason of ["attachment-reference", "retryable-upload", "backup-reference", "historical-reference"]) {
    const events = [];
    await applyPlan(plan(), { ...config, protected: { [key]: [reason] } },
      { scope: "private-scope", metadata: async () => old, remove: async () => assert.fail("protected deletion") },
      e => events.push(e), now);
    assert.equal(events[0].reason, reason);
  }
  for (const metadata of [null, { ...old, generation: "2" }, { ...old, updated: new Date(now).toISOString() }]) {
    await applyPlan(plan(), config, { scope: "private-scope", metadata: async () => metadata,
      remove: async () => assert.fail("changed deletion") }, () => {}, now);
  }
});

test("invalid scope, backup inventory, retention, stale plan and duplicate candidates fail closed", () => {
  for (const delta of [
    { scope: "another-bucket" }, { inventory: "different-backup-list" }, { backupsComplete: false },
    { retentionDays: 0 }, { createdAt: "2020-01-01T00:00:00Z" },
    { objects: [{ key: "../public/test", ...old }] }, { objects: [...plan().objects, ...plan().objects] },
  ]) {
    assert.throws(() => validatePlan({ ...plan(), ...delta }, "private-scope", config, now));
  }
});

test("concurrent overwrite precondition failure aborts without claiming success or continuing", async () => {
  const events = [];
  await assert.rejects(applyPlan(plan(), config, { scope: "private-scope", metadata: async () => old,
    remove: async () => { throw Object.assign(new Error("changed"), { code: 412 }); } },
  e => events.push(e), now));
  assert.deepEqual(events.map(e => e.result), ["delete-requested"]);
});

test("audit failure prevents deletion", async () => {
  await assert.rejects(applyPlan(plan(), config, { scope: "private-scope", metadata: async () => old,
    remove: async () => assert.fail("must audit first") }, async () => { throw new Error("disk full"); }, now));
});

test("offline worker dry-run, exact confirmation and durable delete log using fake cloud only", () => {
  const directory = mkdtempSync(join(tmpdir(), "evidence-cleanup-"));
  try {
    const fixture = join(directory, "cloud.json");
    const report = join(directory, "plan.json");
    const protectedKey = `case-evidence/${"b".repeat(32)}`;
    const recentKey = `evidence-staging/${"c".repeat(32)}`;
    writeFileSync(fixture, JSON.stringify({ [key]: old, [protectedKey]: old,
      [recentKey]: { ...old, updated: new Date().toISOString() } }));
    const worker = fileURLToPath(new URL("../tools/evidence-cleanup.mjs", import.meta.url));
    // A file:// URL, not a path: --experimental-loader rejects bare Windows paths (C:\...).
    const loader = new URL("./fixtures/evidence-cleanup-loader.mjs", import.meta.url).href;
    const run = input => spawnSync(process.execPath, ["--experimental-loader", loader, worker], {
      input: JSON.stringify(input), encoding: "utf8", env: {
        ...process.env, VERACITY_STORAGE: "replit", CLEANUP_FIXTURE: fixture,
      },
    });
    const base = { ...config, protected: { [protectedKey]: ["backup-reference"] } };
    const preview = run({ ...base, report });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(existsSync(fixture + ".deleted"), false);
    const raw = readFileSync(report, "utf8");
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.objects.map(e => e.key), [key]);
    assert.equal(parsed.excluded.length, 2);
    assert.equal(raw.includes("test-only-private-bucket"), false);
    assert.equal(run({ ...base, report }).status, 1, "no report overwrite");
    assert.equal(run({ ...base, apply: report, confirm: "DELETE-EVIDENCE-wrong" }).status, 1);
    assert.equal(existsSync(fixture + ".deleted"), false);
    assert.equal(existsSync(report + ".deletions.jsonl"), false);
    const result = run({ ...base, apply: report, confirm: `DELETE-EVIDENCE-${digest(raw)}` });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(fixture + ".deleted", "utf8")), {
      key, options: { ifGenerationMatch: old.generation },
    });
    const events = readFileSync(report + ".deletions.jsonl", "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.map(e => e.result ?? e.event), ["started", "delete-requested", "deleted", "completed"]);
    assert.equal(run({ ...base, apply: report, confirm: `DELETE-EVIDENCE-${digest(raw)}` }).status, 1, "never overwrite delete audit");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
