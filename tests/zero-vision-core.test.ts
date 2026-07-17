import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeAvatarPhoto,
  createGarmentCutout,
  dominantColorName,
  hammingDistanceHex,
  perceptualHash,
  segmentForeground,
  type RgbaImage,
} from "../lib/zero-vision/core.ts";

function image(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) data.set(color, pixel * 4);
  return { width, height, data };
}

function setPixel(value: RgbaImage, x: number, y: number, color: [number, number, number, number]) {
  value.data.set(color, (y * value.width + x) * 4);
}

function fillRect(value: RgbaImage, left: number, top: number, right: number, bottom: number, color: [number, number, number, number]) {
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) setPixel(value, x, y, color);
}

function fillCircle(value: RgbaImage, cx: number, cy: number, radius: number, color: [number, number, number, number]) {
  for (let y = cy - radius; y <= cy + radius; y += 1) for (let x = cx - radius; x <= cx + radius; x += 1) {
    if (x >= 0 && x < value.width && y >= 0 && y < value.height && Math.hypot(x - cx, y - cy) <= radius) setPixel(value, x, y, color);
  }
}

function shirt(background: [number, number, number, number], foreground: [number, number, number, number]) {
  const value = image(220, 220, background);
  fillRect(value, 70, 55, 150, 175, foreground);
  fillRect(value, 38, 65, 69, 105, foreground);
  fillRect(value, 151, 65, 182, 105, foreground);
  fillRect(value, 91, 43, 129, 64, foreground);
  return value;
}

test("plain-background segmentation removes a contrasting backdrop without a model", () => {
  const source = shirt([35, 88, 176, 255], [196, 42, 49, 255]);
  const result = segmentForeground(source, { mode: "plain" });
  assert.ok(result.metrics.score >= 80, JSON.stringify(result.metrics));
  assert.equal(result.mask[0], 0);
  assert.ok(result.mask[110 * source.width + 110] >= 240);
  assert.ok(result.metrics.transparentPixelRatio > 45);
  const cutout = createGarmentCutout(source, result);
  assert.equal(cutout.width, 1024);
  assert.equal(cutout.height, 1024);
  assert.equal(cutout.data[3], 0);
});

test("white garments survive when the guided background is chromatically distinct", () => {
  const source = shirt([25, 150, 85, 255], [242, 241, 235, 255]);
  const result = segmentForeground(source, { mode: "plain" });
  assert.ok(result.metrics.score >= 78, JSON.stringify(result.metrics));
  assert.ok(result.mask[110 * source.width + 110] >= 240);
  const color = dominantColorName(source, result.mask);
  assert.equal(color.name, "Blanco");
});

test("rectangle mode separates an object from a nonuniform photo without cloud AI", () => {
  const source = image(240, 180, [0, 0, 0, 255]);
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    const noise = ((x * 17 + y * 31) % 13) - 6;
    setPixel(source, x, y, [90 + Math.floor(x / 6) + noise, 94 + Math.floor(y / 9), 92 + noise, 255]);
  }
  fillRect(source, 72, 28, 168, 155, [34, 48, 132, 255]);
  fillRect(source, 48, 48, 71, 92, [34, 48, 132, 255]);
  fillRect(source, 169, 48, 192, 92, [34, 48, 132, 255]);
  const result = segmentForeground(source, {
    mode: "rectangle",
    rect: { x: 0.16, y: 0.08, width: 0.68, height: 0.84 },
    foregroundPoints: [{ x: 0.5, y: 0.5 }],
    backgroundPoints: [{ x: 0.2, y: 0.2 }],
  });
  assert.ok(result.metrics.score >= 55, JSON.stringify(result.metrics));
  assert.ok(result.mask[90 * source.width + 120] >= 200);
  assert.equal(result.mask[10 * source.width + 10], 0);
});

test("perceptual hashes are stable under small color changes", () => {
  const first = shirt([40, 90, 170, 255], [190, 40, 45, 255]);
  const second = shirt([42, 91, 168, 255], [194, 44, 48, 255]);
  const firstSegmentation = segmentForeground(first, { mode: "plain" });
  const secondSegmentation = segmentForeground(second, { mode: "plain" });
  const firstHash = perceptualHash(first, firstSegmentation.mask);
  const secondHash = perceptualHash(second, secondSegmentation.mask);
  assert.ok(hammingDistanceHex(firstHash, secondHash) <= 3, `${firstHash} ${secondHash}`);
});

test("a controlled full-body photo becomes a canonical white avatar", () => {
  const source = image(360, 600, [72, 126, 158, 255]);
  const person: [number, number, number, number] = [53, 45, 43, 255];
  fillCircle(source, 180, 66, 31, person);
  fillRect(source, 137, 98, 223, 315, person);
  fillRect(source, 102, 115, 136, 310, person);
  fillRect(source, 224, 115, 258, 310, person);
  fillRect(source, 145, 316, 176, 548, person);
  fillRect(source, 184, 316, 215, 548, person);
  fillRect(source, 133, 540, 176, 566, person);
  fillRect(source, 184, 540, 227, 566, person);
  const result = canonicalizeAvatarPhoto(source);
  assert.equal(result.image.width, 1024);
  assert.equal(result.image.height, 1536);
  assert.ok(result.accepted, JSON.stringify({ score: result.score, reasons: result.reasons }));
  assert.equal(result.image.data[0], 255);
  assert.equal(result.image.data[1], 255);
  assert.equal(result.image.data[2], 255);
  assert.equal(result.image.data[3], 255);
});

test("cropped full-body references are rejected instead of silently charging for fallback", () => {
  const source = image(240, 360, [200, 210, 220, 255]);
  fillRect(source, 70, 0, 170, 359, [35, 35, 38, 255]);
  const result = canonicalizeAvatarPhoto(source);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("body_clipped") || result.reasons.includes("foreground_touches_frame"));
});
