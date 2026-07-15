import assert from "node:assert/strict";
import test from "node:test";
import { signatureFor, suggestOutfits } from "../lib/outfit-suggestions.ts";

const wardrobe = [
  { id: "top-black", name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro" },
  { id: "top-blue", name: "Camiseta azul", category: "tops", type: "Camiseta", color: "Azul" },
  { id: "coat-black", name: "Abrigo negro", category: "layers", type: "Abrigo", color: "Negro" },
  { id: "pants-black", name: "Pantalón negro", category: "bottoms", type: "Pantalón", color: "Negro" },
  { id: "pants-khaki", name: "Pantalón arena", category: "bottoms", type: "Pantalón", color: "Arena" },
  { id: "cap-black", name: "Gorra negra", category: "accessories", type: "Gorra", color: "Negro" },
];

test("creates complete, unique outfit suggestions", () => {
  const suggestions = suggestOutfits(wardrobe, 3);
  assert.equal(suggestions.length, 3);
  assert.equal(new Set(suggestions.map((item) => item.signature)).size, 3);
  for (const suggestion of suggestions) {
    assert.ok(suggestion.garmentIds.some((id) => id.startsWith("top-")));
    assert.ok(suggestion.garmentIds.some((id) => id.startsWith("pants-")));
  }
});

test("does not repeat saved combinations", () => {
  const first = suggestOutfits(wardrobe, 1)[0];
  const next = suggestOutfits(wardrobe, 3, new Set([signatureFor(first.garmentIds)]));
  assert.ok(next.every((item) => item.signature !== first.signature));
});

test("requires at least one top and one bottom", () => {
  assert.deepEqual(suggestOutfits(wardrobe.filter((item) => item.category !== "bottoms"), 3), []);
});

test("learns from photographed outfits while proposing a new combination", () => {
  const photographed = [wardrobe.find((item) => item.id === "top-blue")!, wardrobe.find((item) => item.id === "pants-khaki")!];
  const photographedSignature = signatureFor(photographed.map((item) => item.id));
  const [suggestion] = suggestOutfits(
    wardrobe,
    1,
    new Set([photographedSignature]),
    [{ source: "photo", garments: photographed }],
  );

  assert.ok(suggestion.garmentIds.includes("top-blue"));
  assert.ok(suggestion.garmentIds.includes("pants-khaki"));
  assert.notEqual(suggestion.signature, photographedSignature);
  assert.match(suggestion.rationale, /ya usaste en tus fotos/);
});
