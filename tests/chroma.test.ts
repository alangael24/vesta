import assert from "node:assert/strict";
import test from "node:test";
import { decode, encode } from "fast-png";
import { encode as encodeJpeg } from "jpeg-js";
import { removeChroma } from "../lib/chroma.ts";
import { chromaForGarment } from "../lib/garment-background.ts";
import { removeLightBackground } from "../lib/light-background.ts";

test("chroma removal creates a transparent RGBA PNG and preserves the garment", () => {
  const width = 10;
  const height = 10;
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    const foreground = (pixel % width) < 5 && Math.floor(pixel / width) < 5;
    rgb[offset] = foreground ? 190 : 0;
    rgb[offset + 1] = foreground ? 45 : 255;
    rgb[offset + 2] = foreground ? 30 : 0;
  }
  const input = encode({ width, height, data: rgb, channels: 3, depth: 8 });
  const result = removeChroma(input, [0, 255, 0]);
  const decoded = decode(result.png);

  assert.equal(decoded.channels, 4);
  assert.equal(result.stats.transparentPixelRatio, 75);
  assert.equal(result.stats.foregroundPixelRatio, 25);
  assert.equal(decoded.data[3], 255, "foreground pixel remains opaque");
  assert.equal(decoded.data[(width * height - 1) * 4 + 3], 0, "chroma background becomes transparent");
});

test("chroma color avoids the observed garment color", () => {
  assert.deepEqual(chromaForGarment("verde oliva").rgb, [255, 0, 255]);
  assert.deepEqual(chromaForGarment("rosa fuerte").rgb, [0, 255, 255]);
  assert.deepEqual(chromaForGarment("negro").rgb, [0, 255, 0]);
  assert.deepEqual(chromaForGarment("blanco").rgb, [0, 255, 0]);
});

test("edge-connected white removal makes a retailer image transparent without AI", () => {
  const width = 12;
  const height = 12;
  const rgb = new Uint8Array(width * height * 3).fill(250);
  for (let y = 3; y < 9; y += 1) {
    for (let x = 3; x < 9; x += 1) {
      const offset = (y * width + x) * 3;
      rgb[offset] = 35;
      rgb[offset + 1] = 45;
      rgb[offset + 2] = 55;
    }
  }
  const result = removeLightBackground(encode({ width, height, data: rgb, channels: 3, depth: 8 }), "image/png");
  assert.ok(result?.applied);
  const output = decode(result.png);
  assert.equal(output.data[3], 0, "the outside white background becomes transparent");
  assert.equal(output.data[(5 * width + 5) * 4 + 3], 255, "the garment remains opaque");
  assert.equal(result.stats.transparentPixelRatio, 75);
});

test("white details enclosed by a garment are preserved", () => {
  const width = 12;
  const height = 12;
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 252;
    rgba[offset + 1] = 250;
    rgba[offset + 2] = 246;
    rgba[offset + 3] = 255;
  }
  for (let y = 2; y < 10; y += 1) {
    for (let x = 2; x < 10; x += 1) {
      const offset = (y * width + x) * 4;
      const whiteLogo = x >= 5 && x <= 6 && y >= 5 && y <= 6;
      rgba[offset] = whiteLogo ? 255 : 20;
      rgba[offset + 1] = whiteLogo ? 255 : 25;
      rgba[offset + 2] = whiteLogo ? 255 : 30;
    }
  }
  const result = removeLightBackground(encode({ width, height, data: rgba, channels: 4, depth: 8 }), "image/png");
  assert.ok(result?.applied);
  const output = decode(result.png);
  assert.equal(output.data[(5 * width + 5) * 4 + 3], 255, "an enclosed white logo is not erased");
});

test("an off-white garment on a white background remains opaque", () => {
  const width = 16;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 3; y < 13; y += 1) {
    for (let x = 3; x < 13; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 238;
      rgba[offset + 1] = 235;
      rgba[offset + 2] = 231;
    }
  }
  const result = removeLightBackground(encode({ width, height, data: rgba, channels: 4, depth: 8 }), "image/png");
  assert.ok(result?.applied);
  const output = decode(result.png);
  assert.equal(output.data[3], 0, "the pure-white background becomes transparent");
  assert.equal(output.data[(8 * width + 8) * 4 + 3], 255, "the off-white garment remains opaque");
});

test("a textured white garment is reconstructed instead of feathering through its body", () => {
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 14; y < 56; y += 1) {
    const sleeveExpansion = y < 26 ? 10 : 0;
    for (let x = 18 - sleeveExpansion; x < 46 + sleeveExpansion; x += 1) {
      const offset = (y * width + x) * 4;
      const textileShade = (x + y) % 3 === 0 ? 246 : 252;
      rgba[offset] = textileShade;
      rgba[offset + 1] = textileShade;
      rgba[offset + 2] = textileShade;
    }
  }
  for (let y = 28; y < 36; y += 1) {
    for (let x = 28; x < 36; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 25;
      rgba[offset + 1] = 30;
      rgba[offset + 2] = 35;
    }
  }

  const result = removeLightBackground(encode({ width, height, data: rgba, channels: 4, depth: 8 }), "image/png");
  assert.ok(result?.applied);
  const output = decode(result.png);
  assert.equal(output.data[3], 0, "the surrounding white background is removed");
  assert.equal(output.data[(48 * width + 32) * 4 + 3], 255, "subtle white textile remains fully opaque");
  assert.equal(result.stats.edgePixelRatio, 0, "destructive semi-transparent regions are eliminated");
});

test("JPEG retailer references use the same deterministic background removal", () => {
  const width = 16;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 4; y < 12; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 170;
      rgba[offset + 1] = 25;
      rgba[offset + 2] = 30;
    }
  }
  const jpeg = encodeJpeg({ width, height, data: rgba }, 95).data;
  const result = removeLightBackground(new Uint8Array(jpeg), "image/jpeg");
  assert.ok(result?.applied);
  assert.ok((result?.stats.transparentPixelRatio || 0) >= 70);
});
