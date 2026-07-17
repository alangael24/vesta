import assert from "node:assert/strict";
import test from "node:test";
import { signatureFor, suggestOutfits, summarizeWardrobe } from "../lib/outfit-suggestions.ts";

const wardrobe = [
  { id: "top-black", name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro", isBasic: true },
  { id: "top-blue", name: "Camiseta azul", category: "tops", type: "Camiseta", color: "Azul" },
  { id: "coat-black", name: "Abrigo negro", category: "layers", type: "Abrigo", color: "Negro", material: "Lana" },
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
    assert.ok(suggestion.score >= 62 && suggestion.score <= 98);
    assert.ok(suggestion.signals.length > 0);
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

test("builds a complete outfit around a dress without adding pants", () => {
  const feminineWardrobe = [
    { id: "dress-pink", name: "Vestido rosa", category: "one_piece", type: "Vestido", color: "Rosa" },
    { id: "heels-black", name: "Tacones negros", category: "footwear", type: "Zapatos", color: "Negro" },
    { id: "bag-black", name: "Bolso negro", category: "accessories", type: "Bolso", color: "Negro" },
    { id: "pants-black", name: "Pantalón negro", category: "bottoms", type: "Pantalón", color: "Negro" },
  ];
  const [suggestion] = suggestOutfits(feminineWardrobe, 1);
  assert.ok(suggestion.garmentIds.includes("dress-pink"));
  assert.ok(!suggestion.garmentIds.includes("pants-black"));
  assert.match(suggestion.rationale, /sin añadir pantalón/u);
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

test("honors an occasion, weather, mood, and anchor garment", () => {
  const [suggestion] = suggestOutfits(wardrobe, 1, new Set(), [], {
    occasion: "Trabajo",
    weather: "frío",
    mood: "pulido",
    seedGarmentIds: ["coat-black"],
  });

  assert.equal(suggestion.occasion, "Trabajo");
  assert.ok(suggestion.garmentIds.includes("coat-black"));
  assert.match(suggestion.rationale, /capa añade abrigo|líneas se sienten más estructuradas/u);
  assert.ok(suggestion.signals.includes("Parte de tu prenda ancla"));
});

test("includes the maximum compatible set of anchor garments", () => {
  const [suggestion] = suggestOutfits(wardrobe, 1, new Set(), [], {
    seedGarmentIds: ["top-blue", "pants-khaki"],
  });

  assert.ok(suggestion.garmentIds.includes("top-blue"));
  assert.ok(suggestion.garmentIds.includes("pants-khaki"));
});

test("varies recommendations without losing deterministic output", () => {
  const first = suggestOutfits(wardrobe, 6, new Set(), [], { variationSeed: 7 });
  const repeated = suggestOutfits(wardrobe, 6, new Set(), [], { variationSeed: 7 });
  const alternate = suggestOutfits(wardrobe, 6, new Set(), [], { variationSeed: 12 });

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first.map((item) => item.signature), alternate.map((item) => item.signature));
});

test("summarizes wardrobe potential and an actionable gap", () => {
  const insight = summarizeWardrobe(wardrobe);
  assert.equal(insight.total, wardrobe.length);
  assert.ok(insight.outfitPotential >= 4);
  assert.ok(insight.versatilityScore > 0);
  assert.match(insight.gap, /calzado/u);
  assert.equal(insight.mostVersatileGarmentIds.length, 3);
});
