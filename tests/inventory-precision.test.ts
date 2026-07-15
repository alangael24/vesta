import assert from "node:assert/strict";
import test from "node:test";
import { isHighPrecisionCandidate, MIN_INVENTORY_CONFIDENCE } from "../lib/inventory-precision.ts";

test("inventory keeps only clear candidates at or above the conservative threshold", () => {
  assert.equal(MIN_INVENTORY_CONFIDENCE, 85);
  assert.equal(isHighPrecisionCandidate({ visibility: "clear", confidence: 95 }), true);
  assert.equal(isHighPrecisionCandidate({ visibility: "clear", confidence: 85 }), true);
  assert.equal(isHighPrecisionCandidate({ visibility: "clear", confidence: 84 }), false);
  assert.equal(isHighPrecisionCandidate({ visibility: "partial", confidence: 99 }), false);
  assert.equal(isHighPrecisionCandidate({ visibility: "held", confidence: 99 }), false);
});

test("the previous false positives are rejected while both real garments remain", () => {
  const previousRun = [
    { name: "Camiseta negra", visibility: "clear" as const, confidence: 95 },
    { name: "Chaqueta deportiva oscura", visibility: "clear" as const, confidence: 94 },
    { name: "Camiseta con emblema", visibility: "partial" as const, confidence: 78 },
    { name: "Bolso bandolera negro", visibility: "partial" as const, confidence: 82 },
  ];

  assert.deepEqual(
    previousRun.filter(isHighPrecisionCandidate).map((item) => item.name),
    ["Camiseta negra", "Chaqueta deportiva oscura"],
  );
});
