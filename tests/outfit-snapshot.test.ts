import assert from "node:assert/strict";
import test from "node:test";
import { parsePiecesSnapshot, snapshotGarment } from "../lib/outfit-snapshot.ts";

test("stores a durable garment description without requiring the live garment", () => {
  const snapshot = snapshotGarment({
    id: "garment_1",
    name: "Sudadera roja",
    category: "layers",
    type: "sudadera",
    color: "rojo",
    material: null,
    description: "Adidas con cierre",
    confidence: 94,
  });
  assert.deepEqual(parsePiecesSnapshot(JSON.stringify([snapshot])), [snapshot]);
  assert.equal(snapshot.material, "Sin confirmar");
});

test("rejects malformed historical snapshots", () => {
  assert.equal(parsePiecesSnapshot("not-json"), null);
  assert.equal(parsePiecesSnapshot(JSON.stringify([{ id: "missing-fields" }])), null);
});
