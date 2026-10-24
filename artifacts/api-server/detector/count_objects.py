"""Count repeated items in a photo from one staff-selected example.

Staff draw a box around one item; every similar-looking item in the photo is
found by normalised template matching at a few scales. No training data is
needed. The result is only a suggestion: staff confirm the quantity in the app.

This is the RunPod worker's copy of the method in
src/features/photo-count/photo-count.ts (which the app uses when RunPod is
not configured).
It can also be run locally for testing: JSON on stdin, JSON on stdout.
"""
import base64
import json
import sys

import cv2
import numpy as np

MAX_SIDE = 1024          # Analyse a downscaled copy; boxes are mapped back.
SCALES = (0.85, 0.92, 1.0, 1.08, 1.15)
CANDIDATE_SCORE = 0.35   # Local maxima kept for suppression.
MATCH_SCORE = 0.6        # Similarity needed to count an item.
RELATIVE_SCORE = 0.78    # ...and at least this share of the typical match.
OVERLAP = 0.3            # Boxes overlapping more than this are the same item.


class CountError(ValueError):
    pass


def count_objects(image_base64, exemplar, threshold=MATCH_SCORE):
    try:
        raw = base64.b64decode(image_base64.split(',', 1)[-1], validate=False)
    except (ValueError, TypeError) as error:
        raise CountError('The photo could not be read.') from error
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise CountError('The photo could not be read. Use a JPG or PNG.')
    height, width = image.shape[:2]
    try:
        x, y = float(exemplar['x']), float(exemplar['y'])
        w, h = float(exemplar['width']), float(exemplar['height'])
    except (KeyError, TypeError, ValueError) as error:
        raise CountError('Draw a box around one item first.') from error
    x, y = max(0.0, x), max(0.0, y)
    w, h = min(w, width - x), min(h, height - y)
    if w < 8 or h < 8:
        raise CountError('The example box is too small. Draw it around one whole item.')

    scale = min(1.0, MAX_SIDE / max(height, width))
    small = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    tx, ty = round(x * scale), round(y * scale)
    template = gray[ty:ty + max(8, round(h * scale)), tx:tx + max(8, round(w * scale))]

    boxes, scores = [], []
    for factor in SCALES:
        tw, th = round(template.shape[1] * factor), round(template.shape[0] * factor)
        if tw < 8 or th < 8 or tw > gray.shape[1] or th > gray.shape[0]:
            continue
        result = cv2.matchTemplate(gray, cv2.resize(template, (tw, th)), cv2.TM_CCOEFF_NORMED)
        # Local maxima only, so suppression handles a few hundred boxes, not millions.
        peaks = (result >= CANDIDATE_SCORE) & (result == cv2.dilate(result, np.ones((5, 5), np.uint8)))
        for py, px in zip(*np.nonzero(peaks)):
            boxes.append([int(px), int(py), tw, th])
            scores.append(float(result[py, px]))

    keep = np.array(cv2.dnn.NMSBoxes(boxes, scores, CANDIDATE_SCORE, OVERLAP) if boxes else []).flatten()
    # Real items score close together; a weak look-alike scores well below
    # them, so also require a share of the typical matched score.
    matched = sorted(scores[i] for i in keep if scores[i] >= threshold)
    typical = matched[len(matched) // 2] if matched else 1.0
    threshold = max(threshold, RELATIVE_SCORE * typical)
    found = []
    for index in keep:
        if scores[index] < threshold:
            continue
        bx, by, bw, bh = boxes[index]
        found.append({
            'x': round(bx / scale, 1), 'y': round(by / scale, 1),
            'width': round(bw / scale, 1), 'height': round(bh / scale, 1),
            'score': round(scores[index], 3),
        })
    found.sort(key=lambda box: (round(box['y'] / max(1.0, h * 0.5)), box['x']))
    return {'count': len(found), 'boxes': found, 'imageWidth': width, 'imageHeight': height}


def main():
    try:
        request = json.load(sys.stdin)
        result = count_objects(request.get('image', ''), request.get('exemplar') or {})
        json.dump(result, sys.stdout)
    except CountError as error:
        json.dump({'error': str(error)}, sys.stdout)
        sys.exit(2)


if __name__ == '__main__':
    main()
