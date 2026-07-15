import assert from "node:assert/strict";
import test from "node:test";
import { decode, encode } from "fast-png";
import { removeChroma } from "../lib/chroma.ts";

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
