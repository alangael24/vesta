import assert from "node:assert/strict";
import test from "node:test";
import { colorHarmony, colorProfileFor, contextFitFor, garmentFeatureVector, outfitFeatureVector, semanticsFor, slotFor } from "../cortex/features.ts";
import { analyzeWardrobe, buildCompatibilityGraph, pairCompatibility, slotsConflict } from "../cortex/graph.ts";
import { createStyleProfile, preferenceScore, preferenceUncertainty, rotationScore, updateStyleProfile } from "../cortex/learner.ts";
import { nextSevenDayBriefs } from "../cortex/logic.ts";
import { planWeek, regeneratePlanDay, scoreWeek, togglePlanDayLock } from "../cortex/planner.ts";
import { generateOutfitCandidates, signatureForGarments } from "../cortex/search.ts";
import type { OutfitCandidate, WardrobeItem } from "../cortex/types.ts";

const wardrobe: WardrobeItem[] = [
  ready("tee-black", "Camiseta negra", "tops", "Camiseta", "Negro", "Algodón", true),
  ready("shirt-white", "Oxford blanca", "tops", "Camisa Oxford", "Blanco", "Algodón"),
  ready("polo-navy", "Polo marino", "tops", "Polo", "Azul marino", "Piqué"),
  ready("blouse-pink", "Blusa rosa satinada", "tops", "Blusa", "Rosa", "Satén"),
  ready("trouser-black", "Pantalón sastre negro", "bottoms", "Pantalón", "Negro", "Lana"),
  ready("chino-sand", "Chino arena", "bottoms", "Chino", "Arena", "Algodón", true),
  ready("jean-blue", "Jean azul lavado", "bottoms", "Jeans", "Azul", "Denim"),
  ready("skirt-burgundy", "Falda borgoña", "bottoms", "Falda", "Borgoña", "Viscosa"),
  ready("blazer-charcoal", "Blazer carbón", "layers", "Blazer", "Gris carbón", "Lana"),
  ready("jacket-denim", "Chaqueta denim", "layers", "Chaqueta", "Índigo", "Denim"),
  ready("coat-camel", "Abrigo camel", "layers", "Abrigo", "Camel", "Lana"),
  ready("sneaker-white", "Tenis blancos", "footwear", "Tenis", "Blanco", "Cuero"),
  ready("loafer-black", "Mocasín negro", "footwear", "Mocasín", "Negro", "Cuero"),
  ready("boot-brown", "Bota café", "footwear", "Bota", "Café", "Cuero"),
  ready("bag-black", "Bolso negro", "accessories", "Bolso", "Negro", "Cuero"),
  ready("cap-olive", "Gorra oliva", "accessories", "Gorra", "Oliva", "Algodón"),
  ready("dress-red", "Vestido rojo", "one_piece", "Vestido", "Rojo", "Seda"),
];

function ready(id: string, name: string, category: WardrobeItem["category"], type: string, color: string, material: string, isBasic = false): WardrobeItem {
  return { id, name, category, type, color, material, isBasic, imageKind: "cutout", imagePath: `/garments/${id}.png`, confidence: 92 };
}

function candidateFrom(items: WardrobeItem[]): OutfitCandidate {
  const garmentIds = items.map((item) => String(item.id));
  return {
    id: "fixture",
    signature: signatureForGarments(items),
    garmentIds,
    garments: items,
    name: "Fixture",
    rationale: "Fixture",
    signals: [],
    score: { total: .7, harmony: .7, context: .7, personal: .5, rotation: .5, novelty: .5, completeness: 1, confidence: .9, uncertainty: .2 },
    features: outfitFeatureVector(items),
    contributions: [],
    alternatives: [],
  };
}

test("slot detection understands complete garments, shoes, headwear and layers", () => {
  assert.equal(slotFor(wardrobe.find((item) => item.id === "dress-red")!), "one_piece");
  assert.equal(slotFor(wardrobe.find((item) => item.id === "loafer-black")!), "feet");
  assert.equal(slotFor(wardrobe.find((item) => item.id === "cap-olive")!), "head");
  assert.equal(slotFor(wardrobe.find((item) => item.id === "coat-camel")!), "outer");
});

test("named and hexadecimal colors produce normalized profiles", () => {
  assert.equal(colorProfileFor("Azul marino").family, "neutral");
  assert.equal(colorProfileFor("Borgoña").family, "jewel");
  assert.equal(colorProfileFor("#FF0000").family, "warm");
  assert.ok(colorProfileFor("#FFFFFF").lightness > .9);
});

test("color harmony rewards neutrals and valid complements", () => {
  const black = colorProfileFor("negro");
  const pink = colorProfileFor("rosa");
  const blue = colorProfileFor("azul");
  const orange = colorProfileFor("naranja");
  assert.ok(colorHarmony(black, pink) > .8);
  assert.ok(colorHarmony(blue, orange) > .6);
});

test("garment vectors have a fixed dimension and finite values", () => {
  const vector = garmentFeatureVector(wardrobe[0]);
  assert.equal(vector.length, 32);
  assert.ok(vector.every(Number.isFinite));
});

test("semantics distinguish formal and sporty pieces", () => {
  const blazer = semanticsFor(wardrobe.find((item) => item.id === "blazer-charcoal")!);
  const sneaker = semanticsFor(wardrobe.find((item) => item.id === "sneaker-white")!);
  assert.ok(blazer.formality > sneaker.formality);
  assert.ok(sneaker.sporty > blazer.sporty);
});

test("context fit changes with weather, occasion and direction", () => {
  const coat = wardrobe.find((item) => item.id === "coat-camel")!;
  const cold = contextFitFor(coat, "cold", "work", "polished");
  const hot = contextFitFor(coat, "hot", "weekend", "relaxed");
  assert.ok(cold > hot);
});

test("slot conflicts prevent two tops while allowing accessories", () => {
  assert.equal(slotsConflict(wardrobe[0], wardrobe[1]), true);
  assert.equal(slotsConflict(wardrobe[0], wardrobe.find((item) => item.id === "bag-black")!), false);
});

test("pair compatibility is symmetric and bounded", () => {
  const first = wardrobe[0];
  const second = wardrobe[5];
  assert.equal(pairCompatibility(first, second), pairCompatibility(second, first));
  assert.ok(pairCompatibility(first, second) >= 0 && pairCompatibility(first, second) <= 1);
});

test("compatibility graph creates weighted edges without conflicting slots", () => {
  const graph = buildCompatibilityGraph(wardrobe);
  assert.ok(graph.edges.length > wardrobe.length);
  assert.ok(graph.edges.every((edge) => edge.weight >= .42));
});

test("wardrobe analysis identifies heroes, clusters, gaps and potential", () => {
  const analysis = analyzeWardrobe(wardrobe);
  assert.ok(analysis.heroes.length >= 3);
  assert.ok(analysis.communities.length >= 1);
  assert.ok(analysis.potentialOutfits > 100);
  assert.equal(analysis.coverage, 1);
  assert.equal(analysis.styleDNA.minimal >= 0 && analysis.styleDNA.minimal <= 1, true);
});

test("outfit search creates complete diverse candidates", () => {
  const brief = nextSevenDayBriefs(new Date(2026, 6, 20))[0];
  const candidates = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 10, seed: "complete" });
  assert.equal(candidates.length, 10);
  assert.equal(new Set(candidates.map((entry) => entry.signature)).size, 10);
  for (const candidate of candidates) {
    const slots = new Set(candidate.garments.map(slotFor));
    assert.ok(slots.has("one_piece") || slots.has("top") && slots.has("bottom"));
    assert.ok(slots.has("feet"));
  }
});

test("outfit search is deterministic for a fixed seed", () => {
  const brief = nextSevenDayBriefs(new Date(2026, 6, 20))[0];
  const first = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 8, seed: "deterministic" });
  const second = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 8, seed: "deterministic" });
  assert.deepEqual(first.map((entry) => entry.signature), second.map((entry) => entry.signature));
});

test("anchors are hard constraints, not ranking suggestions", () => {
  const brief = { ...nextSevenDayBriefs(new Date(2026, 6, 20))[0], anchorGarmentIds: ["polo-navy", "chino-sand"] };
  const candidates = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 6, seed: "anchors" });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((entry) => entry.garmentIds.includes("polo-navy") && entry.garmentIds.includes("chino-sand")));
});

test("conflicting anchors return no false solution", () => {
  const brief = { ...nextSevenDayBriefs(new Date(2026, 6, 20))[0], anchorGarmentIds: ["tee-black", "shirt-white"] };
  assert.deepEqual(generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 6, seed: "conflict" }), []);
});

test("avoid list is respected by every result", () => {
  const brief = { ...nextSevenDayBriefs(new Date(2026, 6, 20))[0], avoidGarmentIds: ["tee-black", "chino-sand", "sneaker-white"] };
  const candidates = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 6, seed: "avoid" });
  assert.ok(candidates.every((entry) => !entry.garmentIds.some((id) => brief.avoidGarmentIds.includes(id))));
});

test("existing and rejected signatures are excluded", () => {
  const brief = nextSevenDayBriefs(new Date(2026, 6, 20))[0];
  const first = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 1, seed: "exclude" })[0];
  const profile = { ...createStyleProfile(), rejectedSignatures: [first.signature] };
  const next = generateOutfitCandidates(wardrobe, brief, profile, { count: 6, seed: "exclude", existingSignatures: [first.signature] });
  assert.ok(next.every((entry) => entry.signature !== first.signature));
});

test("candidate explanations include contributions and counterfactual swaps", () => {
  const brief = nextSevenDayBriefs(new Date(2026, 6, 20))[0];
  const candidate = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 1, seed: "explain" })[0];
  assert.ok(candidate.rationale.length > 30);
  assert.ok(candidate.contributions.length >= 3);
  assert.ok(candidate.alternatives.length >= 1);
});

test("style profile learns positive and negative preferences", () => {
  const candidate = candidateFrom([wardrobe[1], wardrobe[4], wardrobe[12], wardrobe[14]]);
  const initial = createStyleProfile("2026-07-20T00:00:00.000Z");
  const before = preferenceScore(initial, candidate.features);
  const liked = updateStyleProfile(initial, { kind: "like", candidate, at: "2026-07-20T01:00:00.000Z" });
  const afterLike = preferenceScore(liked, candidate.features);
  const disliked = updateStyleProfile(liked, { kind: "dislike", candidate, at: "2026-07-20T02:00:00.000Z" });
  assert.ok(afterLike > before);
  assert.ok(preferenceScore(disliked, candidate.features) < afterLike);
});

test("wear feedback updates garment rotation memory", () => {
  const candidate = candidateFrom([wardrobe[0], wardrobe[5], wardrobe[11]]);
  const profile = updateStyleProfile(createStyleProfile(), { kind: "wear", candidate, at: "2026-07-20T00:00:00.000Z" });
  assert.equal(profile.wornGarmentCounts["tee-black"], 1);
  assert.equal(profile.lastWornAt["sneaker-white"], "2026-07-20T00:00:00.000Z");
});

test("uncertainty falls after repeated feedback on the same vector", () => {
  const candidate = candidateFrom([wardrobe[0], wardrobe[5], wardrobe[11]]);
  let profile = createStyleProfile();
  const before = preferenceUncertainty(profile, candidate.features);
  for (let index = 0; index < 10; index += 1) profile = updateStyleProfile(profile, { kind: "like", candidate, at: `2026-07-2${index}T00:00:00.000Z` });
  assert.ok(preferenceUncertainty(profile, candidate.features) < before);
});

test("rotation score favors pieces not worn recently", () => {
  const profile = createStyleProfile();
  profile.wornGarmentCounts["tee-black"] = 20;
  profile.lastWornAt["tee-black"] = "2026-07-19T00:00:00.000Z";
  const recent = rotationScore(profile, ["tee-black"], new Date("2026-07-20T00:00:00.000Z"));
  const fresh = rotationScore(profile, ["shirt-white"], new Date("2026-07-20T00:00:00.000Z"));
  assert.ok(fresh > recent);
});

test("weekly optimizer produces three valid modes", () => {
  const briefs = nextSevenDayBriefs(new Date(2026, 6, 20));
  const plans = planWeek(wardrobe, briefs, createStyleProfile(), { seed: "week", candidatesPerDay: 12, iterations: 900 });
  assert.equal(plans.length, 3);
  assert.deepEqual(new Set(plans.map((plan) => plan.mode)), new Set(["balanced", "expressive", "rotation"]));
  assert.ok(plans.every((plan) => plan.days.length === 7));
});

test("weekly optimizer reduces adjacent core repetition", () => {
  const briefs = nextSevenDayBriefs(new Date(2026, 6, 20));
  const [plan] = planWeek(wardrobe, briefs, createStyleProfile(), { seed: "repetition", candidatesPerDay: 15, iterations: 1400 });
  for (let index = 1; index < plan.days.length; index += 1) {
    const previous = new Set(plan.days[index - 1].candidate.garments.filter((item) => ["top", "bottom", "one_piece"].includes(slotFor(item))).map((item) => String(item.id)));
    const current = plan.days[index].candidate.garments.filter((item) => ["top", "bottom", "one_piece"].includes(slotFor(item))).map((item) => String(item.id));
    assert.ok(current.filter((id) => previous.has(id)).length <= 1);
  }
});

test("week scoring rewards better diversified plans", () => {
  const brief = nextSevenDayBriefs(new Date(2026, 6, 20))[0];
  const candidates = generateOutfitCandidates(wardrobe, brief, createStyleProfile(), { count: 8, seed: "week-score" });
  const repeated = new Array(7).fill(candidates[0]);
  const varied = candidates.slice(0, 7);
  assert.ok(scoreWeek(varied, "balanced", createStyleProfile()) > scoreWeek(repeated, "balanced", createStyleProfile()));
});

test("locked day stays immutable during regeneration", () => {
  const briefs = nextSevenDayBriefs(new Date(2026, 6, 20));
  const [plan] = planWeek(wardrobe, briefs, createStyleProfile(), { seed: "lock", candidatesPerDay: 10, iterations: 600 });
  const locked = togglePlanDayLock(plan, 2);
  const next = regeneratePlanDay(locked, 2, wardrobe, createStyleProfile(), "lock-regenerate");
  assert.equal(next.days[2].candidate.signature, locked.days[2].candidate.signature);
});

test("single-day regeneration leaves six days untouched", () => {
  const briefs = nextSevenDayBriefs(new Date(2026, 6, 20));
  const [plan] = planWeek(wardrobe, briefs, createStyleProfile(), { seed: "single", candidatesPerDay: 12, iterations: 700 });
  const next = regeneratePlanDay(plan, 3, wardrobe, createStyleProfile(), "single-new");
  assert.equal(next.days.filter((day, index) => index !== 3 && day.candidate.signature === plan.days[index].candidate.signature).length, 6);
});

test("cooperative weekly optimizer yields progress without changing constraints", async () => {
  const { planWeekAsync } = await import("../cortex/planner.ts");
  const progress: string[] = [];
  const plans = await planWeekAsync(wardrobe, nextSevenDayBriefs(new Date(2026, 6, 20)), createStyleProfile(), {
    seed: "async-week",
    candidatesPerDay: 8,
    beamWidth: 48,
    iterations: 180,
    yieldEvery: 30,
    onProgress: (entry) => progress.push(`${entry.phase}:${entry.completed}`),
  });
  assert.equal(plans.length, 3);
  assert.ok(progress.some((entry) => entry.startsWith("candidates:")));
  assert.ok(progress.some((entry) => entry.startsWith("optimizing:")));
  assert.ok(plans.every((plan) => plan.days.length === 7));
});

test("cooperative optimizer can be cancelled before committing a plan", async () => {
  const { planWeekAsync } = await import("../cortex/planner.ts");
  let cancelled = false;
  const plans = await planWeekAsync(wardrobe, nextSevenDayBriefs(new Date(2026, 6, 20)), createStyleProfile(), {
    seed: "cancel-week",
    candidatesPerDay: 6,
    beamWidth: 36,
    iterations: 120,
    onProgress: (entry) => { if (entry.phase === "candidates" && entry.completed >= 2) cancelled = true; },
    shouldCancel: () => cancelled,
  });
  assert.deepEqual(plans, []);
});
