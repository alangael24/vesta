import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGarmentMetadata, parseGarmentTags } from "../lib/garment-metadata.ts";

test("normalizes editable garment metadata and removes duplicate tags", () => {
  assert.deepEqual(normalizeGarmentMetadata({
    name: "  Camiseta negra  ",
    category: "tops",
    color: " Negro ",
    secondaryColor: " Blanco ",
    tags: ["casual", " Casual ", "algodón"],
  }), {
    name: "Camiseta negra",
    category: "tops",
    color: "Negro",
    secondaryColor: "Blanco",
    tags: ["casual", "algodón"],
  });
});

test("rejects unsupported categories and invalid tag payloads", () => {
  assert.equal(normalizeGarmentMetadata({ name: "Prenda", category: "unknown", color: "Negro", tags: [] }), null);
  assert.equal(normalizeGarmentMetadata({ name: "Prenda", category: "tops", color: "Negro", tags: "casual" }), null);
});

test("parses stored tag JSON defensively", () => {
  assert.deepEqual(parseGarmentTags('["retro","verano"]'), ["retro", "verano"]);
  assert.deepEqual(parseGarmentTags("invalid"), []);
});
