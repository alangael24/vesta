import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("zero-cost routes never call paid model APIs", async () => {
  const files = await Promise.all([
    readFile(new URL("app/api/v1/garments/zero-cost/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/avatar/zero-cost/route.ts", root), "utf8"),
    readFile(new URL("lib/zero-vision/core.ts", root), "utf8"),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /api\.openai\.com|gpt-image|\/v1\/responses|OpenAI/u);
  }
});

test("the existing avatar generator remains available as a user-friendly fallback", async () => {
  const [hub, existingGenerator] = await Promise.all([
    readFile(new URL("mobile/zero-vision/ZeroVisionHub.tsx", root), "utf8"),
    readFile(new URL("lib/avatar-generation.ts", root), "utf8"),
  ]);
  assert.match(hub, /onPaidAvatar/u);
  assert.match(hub, /Crear el avatar de otra forma/u);
  assert.doesNotMatch(hub, /Coste de modelo|SIN IA DE PAGO|fallback explícito/u);
  assert.match(existingGenerator, /gpt-image-2/u);
});

test("Cortex exposes the zero-cost scanner and refreshes private state after completion", async () => {
  const source = await readFile(new URL("mobile/cortex/App.tsx", root), "utf8");
  assert.match(source, /ZeroVisionHub/u);
  assert.match(source, /setZeroVisionOpen\(true\)/u);
  assert.match(source, /onChanged=\{\(\) => refresh\(true\)\}/u);
});

test("garment scans preserve subscription monetization while removing model cost", async () => {
  const source = await readFile(new URL("app/api/v1/garments/zero-cost/route.ts", root), "utf8");
  assert.match(source, /requireUsageCapacity\(identity\.ownerId, "wardrobe_addition", 1\)/u);
  assert.match(source, /recordConsumedUsage/u);
  assert.match(source, /modelCostUsd: 0/u);
});

test("the kernel bounds expensive work before touching multi-megapixel inputs", async () => {
  const source = await readFile(new URL("lib/zero-vision/core.ts", root), "utf8");
  assert.match(source, /resizeForWorking\(image, 640\)/u);
  assert.match(source, /const MAX_PIXELS = 8_000_000/u);
  assert.match(source, /upscaleSoftMask/u);
  assert.doesNotMatch(source, /featherMask\(cleanedOriginal\.mask/u);
});

test("a rejected or duplicate garment never consumes a wardrobe credit", async () => {
  const source = await readFile(new URL("app/api/v1/garments/zero-cost/route.ts", root), "utf8");
  const qualityGate = source.indexOf("if (!asset.accepted)");
  const duplicateGate = source.indexOf("if (duplicate)");
  const consumed = source.indexOf("await recordConsumedUsage");
  assert.ok(qualityGate >= 0 && qualityGate < consumed);
  assert.ok(duplicateGate >= 0 && duplicateGate < consumed);
});

test("zero-cost capture becomes the default cascade, not a hidden settings experiment", async () => {
  const source = await readFile(new URL("mobile/cortex/App.tsx", root), "utf8");
  assert.match(source, /zeroVisionTab/u);
  assert.match(source, /initialTab=\{zeroVisionTab\}/u);
  assert.match(source, /setZeroVisionTab\("garment"\);\s*setZeroVisionOpen\(true\)/u);
  assert.match(source, /setZeroVisionTab\("avatar"\);\s*setZeroVisionOpen\(true\)/u);
});
