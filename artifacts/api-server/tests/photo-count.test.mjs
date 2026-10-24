import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { countPhotoObjects, PhotoCountError } from "../src/features/photo-count/photo-count.ts";

const photo = readFileSync(new URL("../../../docs/test-data/photo-count/snack-biscuits-39.jpg", import.meta.url));

test("counts all 39 packs whichever pack staff choose as the example", async () => {
  for (const exemplar of [
    { x: 65, y: 120, width: 167, height: 145 },
    { x: 713, y: 580, width: 150, height: 170 },
    { x: 30, y: 750, width: 170, height: 190 },
  ]) {
    const result = await countPhotoObjects(photo, exemplar);
    assert.equal(result.count, 39, JSON.stringify(exemplar));
    assert.equal(result.boxes.length, 39);
    assert.deepEqual([result.imageWidth, result.imageHeight], [1536, 1024]);
  }
});

test("rejects unreadable photos and tiny example boxes", async () => {
  await assert.rejects(countPhotoObjects(Buffer.from("not an image"), { x: 0, y: 0, width: 50, height: 50 }), PhotoCountError);
  await assert.rejects(countPhotoObjects(photo, { x: 10, y: 10, width: 4, height: 4 }), PhotoCountError);
});

test("a plain photo with nothing repeated finds only the example itself", async () => {
  const plain = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#b08a5a" } })
    .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 3, background: "#c01818" } }).png().toBuffer(), left: 50, top: 50 }])
    .jpeg().toBuffer();
  const result = await countPhotoObjects(plain, { x: 45, y: 45, width: 50, height: 50 });
  assert.equal(result.count, 1);
});
