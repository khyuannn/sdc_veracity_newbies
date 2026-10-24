import sharp from "sharp";

// Counts repeated items in a photo from one staff-selected example box, using
// normalised template matching at a few scales. Pure Node + sharp, so it runs
// the same in VS Code and Replit deployments with no Python packages, GPU or
// API key. detector/count_objects.py is the same method for the RunPod worker.
// The result is a suggestion only; staff confirm the quantity in the app.

export interface Box { x: number; y: number; width: number; height: number }
export interface CountResult { count: number; boxes: (Box & { score: number })[]; imageWidth: number; imageHeight: number }

export class PhotoCountError extends Error {}

const MAX_SIDE = 400;          // Analyse a small copy; boxes are mapped back.
const SCALES = [0.9, 1, 1.1];  // Items slightly nearer or farther than the example.
const CANDIDATE_SCORE = 0.35;
const MATCH_SCORE = 0.6;       // Similarity needed to count an item.
const RELATIVE_SCORE = 0.78;   // ...and at least this share of the typical match.
const OVERLAP = 0.3;           // Boxes overlapping more than this are the same item.

async function grayscale(bytes: Buffer, width: number, height: number) {
  const data = await sharp(bytes).rotate().resize(width, height, { fit: "fill" }).grayscale().blur(0.6).raw().toBuffer();
  return Float32Array.from(data);
}

function iou(a: Box, b: Box) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

// Returns local maxima of the normalised cross-correlation of `template` over `image`.
function match(image: Float32Array, iw: number, ih: number, template: Float32Array, tw: number, th: number) {
  const n = tw * th;
  let mean = 0;
  for (const value of template) mean += value;
  mean /= n;
  const centred = template.map((value) => value - mean);
  let norm = 0;
  for (const value of centred) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return [];

  // Integral images give each window's sum and sum of squares in O(1).
  const sw = iw + 1;
  const sum = new Float64Array(sw * (ih + 1));
  const sq = new Float64Array(sw * (ih + 1));
  for (let y = 0; y < ih; y++) {
    let row = 0, rowSq = 0;
    for (let x = 0; x < iw; x++) {
      const v = image[y * iw + x];
      row += v; rowSq += v * v;
      sum[(y + 1) * sw + x + 1] = sum[y * sw + x + 1] + row;
      sq[(y + 1) * sw + x + 1] = sq[y * sw + x + 1] + rowSq;
    }
  }
  const rw = iw - tw + 1, rh = ih - th + 1;
  const scores = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const a = y * sw + x, b = y * sw + x + tw, c = (y + th) * sw + x, d = (y + th) * sw + x + tw;
      const s = sum[d] - sum[b] - sum[c] + sum[a];
      const variance = sq[d] - sq[b] - sq[c] + sq[a] - (s * s) / n;
      if (variance < 1e-3) continue;
      let dot = 0;
      for (let ty = 0; ty < th; ty++) {
        const offset = (y + ty) * iw + x, toffset = ty * tw;
        for (let tx = 0; tx < tw; tx++) dot += image[offset + tx] * centred[toffset + tx];
      }
      scores[y * rw + x] = dot / (Math.sqrt(variance) * norm);
    }
  }
  const peaks: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const score = scores[y * rw + x];
      if (score < CANDIDATE_SCORE) continue;
      let peak = true;
      for (let dy = -2; dy <= 2 && peak; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < rh && xx >= 0 && xx < rw && scores[yy * rw + xx] > score) { peak = false; break; }
        }
      }
      if (peak) peaks.push({ x, y, score });
    }
  }
  return peaks;
}

export async function countPhotoObjects(bytes: Buffer, exemplar: Box): Promise<CountResult> {
  let width: number, height: number;
  try {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  } catch {
    throw new PhotoCountError("The photo could not be read. Use a JPG or PNG.");
  }
  if (!width || !height) throw new PhotoCountError("The photo could not be read. Use a JPG or PNG.");
  const ex = Math.max(0, exemplar.x), ey = Math.max(0, exemplar.y);
  const ew = Math.min(exemplar.width, width - ex), eh = Math.min(exemplar.height, height - ey);
  if (!(ew >= 8 && eh >= 8)) throw new PhotoCountError("The example box is too small. Draw it around one whole item.");

  const base = Math.min(1, MAX_SIDE / Math.max(width, height));
  const bw = Math.round(width * base), bh = Math.round(height * base);
  const baseImage = await grayscale(bytes, bw, bh);
  const tx = Math.round(ex * base), ty = Math.round(ey * base);
  const tw = Math.min(bw - tx, Math.max(4, Math.round(ew * base)));
  const th = Math.min(bh - ty, Math.max(4, Math.round(eh * base)));
  const template = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) template.set(baseImage.subarray((ty + y) * bw + tx, (ty + y) * bw + tx + tw), y * tw);

  // Rescale the photo rather than the example: an item `factor` times the
  // example's size matches the fixed template in a photo scaled by 1/factor.
  const candidates: (Box & { score: number })[] = [];
  for (const factor of SCALES) {
    const iw = Math.round(bw / factor), ih = Math.round(bh / factor);
    if (iw < tw || ih < th) continue;
    const image = factor === 1 ? baseImage : await grayscale(bytes, iw, ih);
    const toOriginal = (bw / iw) / base;
    for (const peak of match(image, iw, ih, template, tw, th)) {
      candidates.push({ x: peak.x * toOriginal, y: peak.y * toOriginal, width: tw * toOriginal, height: th * toOriginal, score: peak.score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: (Box & { score: number })[] = [];
  for (const box of candidates) if (!kept.some((other) => iou(box, other) > OVERLAP)) kept.push(box);

  // Real items score close together; a weak look-alike scores well below
  // them, so also require a share of the typical matched score.
  const matched = kept.filter((box) => box.score >= MATCH_SCORE).map((box) => box.score).sort((a, b) => a - b);
  const typical = matched.length ? matched[Math.floor(matched.length / 2)] : 1;
  const threshold = Math.max(MATCH_SCORE, RELATIVE_SCORE * typical);
  const boxes = kept.filter((box) => box.score >= threshold).map((box) => ({
    x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height),
    score: Math.round(box.score * 1000) / 1000,
  }));
  boxes.sort((a, b) => Math.round(a.y / (eh / 2)) - Math.round(b.y / (eh / 2)) || a.x - b.x);
  return { count: boxes.length, boxes, imageWidth: width, imageHeight: height };
}
