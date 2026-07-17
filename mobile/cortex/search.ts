import {
  contextFitFor,
  outfitFeatureVector,
  readableColorFamily,
  semanticsFor,
  slotFor,
} from "./features";
import { pairCompatibility, slotsConflict } from "./graph";
import { createStyleProfile, profileCandidate, rotationScore } from "./learner";
import { createRandom, shuffle } from "./prng";
import type {
  CandidateScore,
  DayBrief,
  FeatureContribution,
  GarmentSlot,
  OutfitCandidate,
  StyleProfile,
  WardrobeItem,
} from "./types";

export type CandidateSearchOptions = {
  count?: number;
  beamWidth?: number;
  seed?: string | number;
  existingSignatures?: Iterable<string>;
  now?: Date;
  includeAlternatives?: boolean;
};

type BeamState = {
  garments: WardrobeItem[];
  partialScore: number;
};

type SlotDecision = {
  slot: GarmentSlot;
  required: boolean;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function garmentId(item: WardrobeItem) {
  return String(item.id);
}

export function signatureForGarments(garments: WardrobeItem[] | string[]) {
  const ids = garments.map((value) => typeof value === "string" ? value : garmentId(value));
  return [...new Set(ids)].sort().join("|");
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function jaccard(first: Iterable<string>, second: Iterable<string>) {
  const a = new Set(first);
  const b = new Set(second);
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function pairHarmony(garments: WardrobeItem[]) {
  const scores: number[] = [];
  for (let first = 0; first < garments.length; first += 1) {
    for (let second = first + 1; second < garments.length; second += 1) {
      scores.push(pairCompatibility(garments[first], garments[second]));
    }
  }
  return scores.length ? average(scores) : .55;
}

function compatibleWithState(item: WardrobeItem, garments: WardrobeItem[]) {
  if (garments.some((existing) => garmentId(existing) === garmentId(item))) return false;
  return !garments.some((existing) => slotsConflict(existing, item));
}

function statePartialScore(garments: WardrobeItem[], brief: DayBrief) {
  if (!garments.length) return 0;
  const harmony = pairHarmony(garments);
  const context = average(garments.map((item) => contextFitFor(item, brief.weather, brief.occasion, brief.direction)));
  const completeness = Math.min(1, garments.length / 4);
  const anchorCoverage = brief.anchorGarmentIds.length
    ? brief.anchorGarmentIds.filter((id) => garments.some((item) => garmentId(item) === id)).length / brief.anchorGarmentIds.length
    : 1;
  return harmony * .43 + context * .37 + completeness * .08 + anchorCoverage * .12;
}

function layoutSupportsAnchors(layout: SlotDecision[], anchors: WardrobeItem[]) {
  const allowed = new Set(layout.map((entry) => entry.slot));
  return anchors.every((item) => allowed.has(slotFor(item)) || slotFor(item) === "head" || slotFor(item) === "accessory");
}

function layoutsForBrief(brief: DayBrief): SlotDecision[][] {
  const outerRequired = brief.weather === "cold" || brief.weather === "rain";
  const accessoryRequired = brief.occasion === "event" || brief.occasion === "date";
  return [
    [
      { slot: "top", required: true },
      { slot: "bottom", required: true },
      { slot: "outer", required: outerRequired },
      { slot: "feet", required: true },
      { slot: "accessory", required: accessoryRequired },
      { slot: "head", required: false },
    ],
    [
      { slot: "one_piece", required: true },
      { slot: "outer", required: outerRequired },
      { slot: "feet", required: true },
      { slot: "accessory", required: accessoryRequired },
      { slot: "head", required: false },
    ],
  ];
}

function candidateChoices(slot: GarmentSlot, wardrobe: WardrobeItem[], state: WardrobeItem[], required: boolean, brief: DayBrief, random: () => number) {
  const candidates = wardrobe
    .filter((item) => slotFor(item) === slot)
    .filter((item) => compatibleWithState(item, state))
    .filter((item) => !brief.avoidGarmentIds.includes(garmentId(item)))
    .sort((first, second) => {
      const contextDelta = contextFitFor(second, brief.weather, brief.occasion, brief.direction) - contextFitFor(first, brief.weather, brief.occasion, brief.direction);
      if (Math.abs(contextDelta) > 1e-9) return contextDelta;
      return garmentId(first).localeCompare(garmentId(second));
    });
  const shuffled = shuffle(candidates.slice(0, 24), random);
  return required ? shuffled : [undefined, ...shuffled];
}

function completeForLayout(garments: WardrobeItem[], layout: SlotDecision[]) {
  const slots = new Set(garments.map(slotFor));
  return layout.filter((entry) => entry.required).every((entry) => slots.has(entry.slot));
}

function coreComplete(garments: WardrobeItem[]) {
  const slots = new Set(garments.map(slotFor));
  return slots.has("one_piece") || slots.has("top") && slots.has("bottom");
}

function directionWeights(direction: DayBrief["direction"]) {
  if (direction === "minimal") return { harmony: .24, context: .22, personal: .19, rotation: .12, novelty: .09, completeness: .08, confidence: .06 };
  if (direction === "relaxed") return { harmony: .2, context: .25, personal: .18, rotation: .12, novelty: .11, completeness: .08, confidence: .06 };
  if (direction === "polished") return { harmony: .23, context: .27, personal: .19, rotation: .08, novelty: .08, completeness: .09, confidence: .06 };
  return { harmony: .17, context: .2, personal: .18, rotation: .11, novelty: .2, completeness: .08, confidence: .06 };
}

function noveltyScore(signature: string, garmentIds: string[], profile: StyleProfile, existing: Set<string>) {
  if (profile.rejectedSignatures.includes(signature)) return 0;
  if (existing.has(signature)) return .08;
  const references = [...profile.savedSignatures, ...existing];
  if (!references.length) return 1;
  let closest = 0;
  for (const reference of references) closest = Math.max(closest, jaccard(garmentIds, reference.split("|")));
  return clamp(1 - closest * .82);
}

function scoreCandidate(garments: WardrobeItem[], brief: DayBrief, profile: StyleProfile, existing: Set<string>, seed: string, now: Date): { score: CandidateScore; features: number[] } {
  const garmentIds = garments.map(garmentId);
  const signature = signatureForGarments(garmentIds);
  const features = outfitFeatureVector(garments);
  const harmony = pairHarmony(garments);
  const context = average(garments.map((item) => contextFitFor(item, brief.weather, brief.occasion, brief.direction)));
  const preference = profileCandidate({ garments, features } as OutfitCandidate, profile, `${seed}:${signature}`);
  const personal = clamp((preference.combined + 1) / 2);
  const rotation = rotationScore(profile, garmentIds, now);
  const novelty = noveltyScore(signature, garmentIds, profile, existing);
  const slots = new Set(garments.map(slotFor));
  const completeness = clamp((coreComplete(garments) ? .68 : 0) + (slots.has("feet") ? .18 : 0) + (slots.has("outer") ? .08 : 0) + ([...slots].some((slot) => slot === "accessory" || slot === "head") ? .06 : 0));
  const confidence = average(garments.map((item) => clamp((item.confidence ?? 85) / 100)));
  const weights = directionWeights(brief.direction);
  const total = harmony * weights.harmony
    + context * weights.context
    + personal * weights.personal
    + rotation * weights.rotation
    + novelty * weights.novelty
    + completeness * weights.completeness
    + confidence * weights.confidence;
  return {
    score: {
      total,
      harmony,
      context,
      personal,
      rotation,
      novelty,
      completeness,
      confidence,
      uncertainty: preference.uncertainty,
    },
    features,
  };
}

function paletteName(garments: WardrobeItem[]) {
  const families = garments.map(readableColorFamily);
  const counts = new Map<string, number>();
  families.forEach((family) => counts.set(family, (counts.get(family) || 0) + 1));
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const first = sorted[0]?.[0] || "equilibrados";
  const second = sorted[1]?.[0];
  return second ? `${capitalize(first)} + ${second}` : `Tonos ${first}`;
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function signalsFor(garments: WardrobeItem[], brief: DayBrief, score: CandidateScore) {
  const signals: string[] = [];
  const semantics = garments.map(semanticsFor);
  if (score.harmony >= .8) signals.push("Paleta con armonía alta");
  if (score.context >= .78) signals.push(`Responde a ${brief.weather === "hot" ? "calor" : brief.weather === "cold" ? "frío" : brief.weather === "rain" ? "lluvia" : "clima templado"}`);
  if (score.rotation >= .7) signals.push("Recupera prendas fuera de rotación");
  if (score.novelty >= .72) signals.push("Combinación nueva dentro de tu estilo");
  if (semantics.some((entry) => entry.slot === "outer")) signals.push("Profundidad por capas");
  if (semantics.filter((entry) => entry.statement > .65).length === 1) signals.push("Un solo foco visual");
  if (brief.anchorGarmentIds.length) signals.push(`${brief.anchorGarmentIds.length} ${brief.anchorGarmentIds.length === 1 ? "ancla respetada" : "anclas respetadas"}`);
  if (score.personal >= .62) signals.push("Afinidad con tu historial");
  return signals.slice(0, 4);
}

function contributionsFor(score: CandidateScore): FeatureContribution[] {
  const entries: FeatureContribution[] = [
    { key: "harmony", label: "armonía de color y forma", value: score.harmony },
    { key: "context", label: "ocasión y clima", value: score.context },
    { key: "personal", label: "afinidad personal", value: score.personal },
    { key: "rotation", label: "rotación del armario", value: score.rotation },
    { key: "novelty", label: "novedad", value: score.novelty },
    { key: "completeness", label: "outfit completo", value: score.completeness },
  ];
  return entries.sort((a, b) => b.value - a.value).slice(0, 4);
}

function rationaleFor(garments: WardrobeItem[], brief: DayBrief, score: CandidateScore) {
  const top = contributionsFor(score).slice(0, 2).map((entry) => entry.label);
  const anchorNames = garments.filter((item) => brief.anchorGarmentIds.includes(garmentId(item))).map((item) => item.name);
  const anchorCopy = anchorNames.length ? ` Mantiene ${anchorNames.join(" y ")} como ${anchorNames.length === 1 ? "punto de partida" : "puntos de partida"}.` : "";
  return `${garments.map((item) => item.name).join(", ")}. Funciona principalmente por ${top.join(" y ")}.${anchorCopy}`;
}

function alternativeSwaps(candidate: WardrobeItem[], wardrobe: WardrobeItem[], brief: DayBrief, profile: StyleProfile, existing: Set<string>, seed: string, now: Date) {
  const base = scoreCandidate(candidate, brief, profile, existing, seed, now).score.total;
  const alternatives: OutfitCandidate["alternatives"] = [];
  for (const remove of candidate) {
    const slot = slotFor(remove);
    const remaining = candidate.filter((item) => garmentId(item) !== garmentId(remove));
    const replacements = wardrobe
      .filter((item) => slotFor(item) === slot && garmentId(item) !== garmentId(remove))
      .filter((item) => compatibleWithState(item, remaining))
      .filter((item) => !brief.avoidGarmentIds.includes(garmentId(item)))
      .map((item) => ({ item, score: scoreCandidate([...remaining, item], brief, profile, existing, seed, now).score.total }))
      .sort((a, b) => b.score - a.score || garmentId(a.item).localeCompare(garmentId(b.item)))
      .slice(0, 1);
    for (const replacement of replacements) {
      alternatives.push({
        removeGarmentId: garmentId(remove),
        addGarmentId: garmentId(replacement.item),
        delta: replacement.score - base,
        explanation: `${replacement.item.name} cambia ${remove.name} y ${replacement.score >= base ? "mantiene o mejora" : "sacrifica ligeramente"} la coherencia del look.`,
      });
    }
  }
  return alternatives.sort((a, b) => b.delta - a.delta).slice(0, 4);
}

function toCandidate(garments: WardrobeItem[], wardrobe: WardrobeItem[], brief: DayBrief, profile: StyleProfile, existing: Set<string>, seed: string, now: Date, includeAlternatives: boolean): OutfitCandidate {
  const signature = signatureForGarments(garments);
  const { score, features } = scoreCandidate(garments, brief, profile, existing, seed, now);
  return {
    id: `candidate-${signature.replace(/\|/gu, "-")}`,
    signature,
    garmentIds: garments.map(garmentId),
    garments,
    name: paletteName(garments),
    rationale: rationaleFor(garments, brief, score),
    signals: signalsFor(garments, brief, score),
    score,
    features,
    contributions: contributionsFor(score),
    alternatives: includeAlternatives ? alternativeSwaps(garments, wardrobe, brief, profile, existing, seed, now) : [],
  };
}

function mmrSelect(candidates: OutfitCandidate[], count: number, direction: DayBrief["direction"]) {
  const selected: OutfitCandidate[] = [];
  const remaining = [...candidates];
  const diversityWeight = direction === "bold" ? .28 : .2;
  while (selected.length < count && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const overlap = selected.length ? Math.max(...selected.map((entry) => jaccard(entry.garmentIds, candidate.garmentIds))) : 0;
      const value = candidate.score.total * (1 - diversityWeight) + (1 - overlap) * diversityWeight;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

export function generateOutfitCandidates(
  wardrobe: WardrobeItem[],
  brief: DayBrief,
  profile: StyleProfile = createStyleProfile(),
  options: CandidateSearchOptions = {},
) {
  const count = Math.max(1, Math.min(options.count ?? 12, 30));
  const beamWidth = Math.max(12, Math.min(options.beamWidth ?? 90, 320));
  const seed = String(options.seed ?? `${brief.date}:${brief.occasion}:${brief.weather}:${brief.direction}:${brief.anchorGarmentIds.join("|")}`);
  const random = createRandom(seed);
  const now = options.now || new Date();
  const existing = new Set(options.existingSignatures || []);
  const ready = wardrobe
    .filter((item) => item.imageKind === "cutout" && Boolean(item.imagePath || item.localImageUri))
    .filter((item) => !brief.avoidGarmentIds.includes(garmentId(item)));
  const byId = new Map(ready.map((item) => [garmentId(item), item]));
  const anchors = brief.anchorGarmentIds.map((id) => byId.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  if (anchors.some((item, index) => anchors.slice(index + 1).some((candidate) => slotsConflict(item, candidate)))) return [];
  const rawStates: BeamState[] = [];

  for (const layout of layoutsForBrief(brief)) {
    if (!layoutSupportsAnchors(layout, anchors)) continue;
    let states: BeamState[] = [{ garments: [...anchors], partialScore: statePartialScore(anchors, brief) }];
    for (const decision of layout) {
      if (states.every((state) => state.garments.some((item) => slotFor(item) === decision.slot))) continue;
      const next: BeamState[] = [];
      for (const state of states) {
        if (state.garments.some((item) => slotFor(item) === decision.slot)) {
          next.push(state);
          continue;
        }
        const choices = candidateChoices(decision.slot, ready, state.garments, decision.required, brief, random);
        if (!choices.length && decision.required) continue;
        for (const choice of choices) {
          const garments = choice ? [...state.garments, choice] : state.garments;
          next.push({ garments, partialScore: statePartialScore(garments, brief) });
        }
      }
      states = next
        .sort((a, b) => b.partialScore - a.partialScore || signatureForGarments(a.garments).localeCompare(signatureForGarments(b.garments)))
        .slice(0, beamWidth);
      if (!states.length) break;
    }
    rawStates.push(...states.filter((state) => completeForLayout(state.garments, layout)));
  }

  const unique = new Map<string, WardrobeItem[]>();
  for (const state of rawStates) {
    const signature = signatureForGarments(state.garments);
    if (!signature || existing.has(signature) || profile.rejectedSignatures.includes(signature)) continue;
    unique.set(signature, state.garments);
  }
  const candidates = [...unique.values()]
    .map((garments) => toCandidate(garments, ready, brief, profile, existing, seed, now, options.includeAlternatives !== false))
    .sort((a, b) => b.score.total - a.score.total || a.signature.localeCompare(b.signature));
  return mmrSelect(candidates, count, brief.direction);
}
