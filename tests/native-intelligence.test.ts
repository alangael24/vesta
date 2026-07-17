import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeClosetPulse,
  directStudioLook,
  featuredOutfitIdForToday,
  stylistBriefPayload,
} from "../mobile/native-next/intelligence.ts";

const wardrobe = [
  { id: "tee", name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro", material: "Algodón", isBasic: true, imagePath: "/tee", imageKind: "cutout" },
  { id: "shirt", name: "Camisa blanca", category: "tops", type: "Camisa", color: "Blanco", material: "Oxford", imagePath: "/shirt", imageKind: "cutout" },
  { id: "jeans", name: "Jean lavado", category: "bottoms", type: "Jeans", color: "Azul", material: "Denim", imagePath: "/jeans", imageKind: "cutout" },
  { id: "trouser", name: "Pantalón sastre", category: "bottoms", type: "Pantalón", color: "Gris", material: "Lana", imagePath: "/trouser", imageKind: "cutout" },
  { id: "coat", name: "Abrigo camel", category: "layers", type: "Abrigo", color: "Camel", material: "Lana", imagePath: "/coat", imageKind: "cutout" },
  { id: "sneaker", name: "Tenis blancos", category: "footwear", type: "Tenis", color: "Blanco", imagePath: "/sneaker", imageKind: "cutout" },
  { id: "loafer", name: "Mocasín negro", category: "footwear", type: "Mocasín", color: "Negro", imagePath: "/loafer", imageKind: "cutout" },
  { id: "cap", name: "Gorra oliva", category: "accessories", type: "Gorra", color: "Oliva", imagePath: "/cap", imageKind: "cutout" },
];

test("completes a partial studio selection while keeping the anchor", () => {
  const result = directStudioLook(wardrobe, [wardrobe[0]], "complete", 3);
  assert.ok(result.changed);
  assert.ok(result.items.some((item) => item.id === "tee"));
  assert.ok(result.items.some((item) => item.category === "bottoms"));
  assert.ok(result.items.some((item) => item.category === "footwear"));
});

test("polished direction upgrades the supporting pieces", () => {
  const result = directStudioLook(wardrobe, [wardrobe[1]], "polished", 2);
  assert.ok(result.items.some((item) => item.id === "shirt"));
  assert.ok(result.items.some((item) => item.id === "trouser"));
  assert.ok(result.items.some((item) => item.id === "loafer"));
});

test("color shift replaces a key slot with another family", () => {
  const result = directStudioLook(wardrobe, [wardrobe[0], wardrobe[2], wardrobe[5]], "color_shift", 0);
  assert.ok(result.changed);
  assert.notDeepEqual(result.items.map((item) => item.id).sort(), ["jeans", "sneaker", "tee"].sort());
});

test("closet pulse foregrounds render readiness and potential", () => {
  const pulse = analyzeClosetPulse(wardrobe, [
    { id: "look-1", name: "Look", occasion: "Diario", renderPath: "/look", pieces: wardrobe.slice(0, 3) },
  ]);
  assert.equal(pulse.readyGarments, wardrobe.length);
  assert.equal(pulse.realLooks, 1);
  assert.ok(pulse.outfitPotential > 0);
  assert.ok(pulse.coverageScore >= 75);
});

test("today's scheduled outfit wins over the most recent render", () => {
  const outfits = [
    { id: "recent", name: "Reciente", occasion: "Cena", renderPath: "/recent", pieces: [] },
    { id: "today", name: "Hoy", occasion: "Trabajo", renderPath: "/today", pieces: [] },
  ];
  assert.equal(featuredOutfitIdForToday([{ outfitId: "today", scheduledDate: "2026-07-17" }], outfits, "2026-07-17"), "today");
});

test("stylist payload is bounded and API compatible", () => {
  assert.deepEqual(stylistBriefPayload({
    occasion: "  Cena importante  ",
    weather: "templado",
    mood: "pulido",
    seedGarmentIds: ["shirt", "coat", "extra"],
    variationSeed: 4.9,
  }), {
    count: 3,
    occasion: "Cena importante",
    weather: "templado",
    mood: "pulido",
    seedGarmentIds: ["shirt", "coat"],
    variationSeed: 4,
  });
});
