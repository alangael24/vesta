import {
  colorHarmony,
  outfitFeatureVector,
  readableColorFamily,
  semanticsFor,
  slotFor,
  styleDNAFromVectors,
} from "./features";
import type {
  Outfit,
  WardrobeAnalysis,
  WardrobeGraphEdge,
  WardrobeGraphNode,
  WardrobeItem,
} from "./types";

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function idFor(item: WardrobeItem) {
  return String(item.id);
}

export function slotsConflict(first: WardrobeItem, second: WardrobeItem) {
  const a = slotFor(first);
  const b = slotFor(second);
  if (a === "accessory" || b === "accessory") return false;
  if (a === "head" || b === "head") return a === b;
  if (a === "one_piece") return b === "one_piece" || b === "top" || b === "bottom";
  if (b === "one_piece") return a === "top" || a === "bottom";
  return a === b;
}

export function pairCompatibility(first: WardrobeItem, second: WardrobeItem) {
  if (idFor(first) === idFor(second)) return 0;
  if (slotsConflict(first, second)) return .04;
  const a = semanticsFor(first);
  const b = semanticsFor(second);
  const color = colorHarmony(a.color, b.color);
  const formality = 1 - Math.abs(a.formality - b.formality);
  const sporty = 1 - Math.abs(a.sporty - b.sporty);
  const volumeBalance = a.slot === "top" && b.slot === "bottom" || b.slot === "top" && a.slot === "bottom"
    ? 1 - Math.abs((a.volume + b.volume) - 1) * .65
    : 1 - Math.abs(a.volume - b.volume) * .5;
  const texture = a.texture > .72 && b.texture > .72 ? .62 : .92;
  const pattern = a.pattern > .62 && b.pattern > .62 ? .42 : 1;
  const layer = a.slot === "outer" || b.slot === "outer"
    ? 1 - Math.max(0, Math.abs(a.warmth - b.warmth) - .52)
    : .9;
  const confidence = ((first.confidence ?? 86) + (second.confidence ?? 86)) / 200;
  return clamp(color * .31 + formality * .18 + sporty * .08 + volumeBalance * .13 + texture * .08 + pattern * .1 + layer * .07 + confidence * .05);
}

export function buildCompatibilityGraph(wardrobe: WardrobeItem[], threshold = .42) {
  const ready = wardrobe.filter((item) => item.imageKind === "cutout" && Boolean(item.imagePath || item.localImageUri));
  const edges: WardrobeGraphEdge[] = [];
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>();
  for (const item of ready) adjacency.set(idFor(item), []);
  for (let first = 0; first < ready.length; first += 1) {
    for (let second = first + 1; second < ready.length; second += 1) {
      const weight = pairCompatibility(ready[first], ready[second]);
      if (weight < threshold) continue;
      const a = idFor(ready[first]);
      const b = idFor(ready[second]);
      edges.push({ a, b, weight });
      adjacency.get(a)?.push({ id: b, weight });
      adjacency.get(b)?.push({ id: a, weight });
    }
  }
  return { ready, edges, adjacency };
}

function weightedDegree(adjacency: Map<string, Array<{ id: string; weight: number }>>, id: string) {
  return (adjacency.get(id) || []).reduce((sum, edge) => sum + edge.weight, 0);
}

function eigenvectorCentrality(adjacency: Map<string, Array<{ id: string; weight: number }>>, iterations = 30) {
  const ids = [...adjacency.keys()];
  let scores = new Map(ids.map((id) => [id, ids.length ? 1 / Math.sqrt(ids.length) : 0]));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Map<string, number>();
    let norm = 0;
    for (const id of ids) {
      const score = (adjacency.get(id) || []).reduce((sum, edge) => sum + edge.weight * (scores.get(edge.id) || 0), 0);
      next.set(id, score);
      norm += score * score;
    }
    norm = Math.sqrt(norm) || 1;
    scores = new Map(ids.map((id) => [id, (next.get(id) || 0) / norm]));
  }
  return scores;
}

function labelCommunities(adjacency: Map<string, Array<{ id: string; weight: number }>>) {
  const ids = [...adjacency.keys()].sort();
  const labels = new Map(ids.map((id, index) => [id, index]));
  for (let iteration = 0; iteration < 18; iteration += 1) {
    let changed = false;
    for (const id of ids) {
      const totals = new Map<number, number>();
      for (const edge of adjacency.get(id) || []) {
        const label = labels.get(edge.id)!;
        totals.set(label, (totals.get(label) || 0) + edge.weight);
      }
      const current = labels.get(id)!;
      let bestLabel = current;
      let bestScore = totals.get(current) || 0;
      for (const [label, score] of [...totals.entries()].sort((a, b) => a[0] - b[0])) {
        if (score > bestScore + 1e-9) {
          bestLabel = label;
          bestScore = score;
        }
      }
      if (bestLabel !== current) {
        labels.set(id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const normalized = new Map<number, number>();
  let next = 0;
  for (const label of [...new Set(labels.values())].sort((a, b) => a - b)) normalized.set(label, next++);
  return new Map([...labels].map(([id, label]) => [id, normalized.get(label)!]));
}

function cosineSimilarity(first: number[], second: number[]) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const a = first[index] || 0;
    const b = second[index] || 0;
    dot += a * b;
    aNorm += a * a;
    bNorm += b * b;
  }
  return aNorm && bNorm ? dot / Math.sqrt(aNorm * bNorm) : 0;
}

function redundancyFor(item: WardrobeItem, wardrobe: WardrobeItem[]) {
  const source = semanticsFor(item);
  let best = 0;
  for (const candidate of wardrobe) {
    if (idFor(candidate) === idFor(item) || slotFor(candidate) !== source.slot) continue;
    const target = semanticsFor(candidate);
    const vectorA = [source.formality, source.warmth, source.texture, source.pattern, source.volume, source.sporty, source.statement, source.basic, source.color.hue, source.color.saturation, source.color.lightness];
    const vectorB = [target.formality, target.warmth, target.texture, target.pattern, target.volume, target.sporty, target.statement, target.basic, target.color.hue, target.color.saturation, target.color.lightness];
    best = Math.max(best, cosineSimilarity(vectorA, vectorB));
  }
  return clamp((best - .72) / .28);
}

function communityLabel(items: WardrobeItem[]) {
  const slots = new Map<string, number>();
  const colors = new Map<string, number>();
  for (const item of items) {
    const slot = slotFor(item);
    slots.set(slot, (slots.get(slot) || 0) + 1);
    const color = readableColorFamily(item);
    colors.set(color, (colors.get(color) || 0) + 1);
  }
  const topSlot = [...slots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "prendas";
  const topColor = [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "mixtos";
  const slotLabel: Record<string, string> = {
    top: "tops",
    outer: "capas",
    bottom: "partes inferiores",
    feet: "calzado",
    one_piece: "prendas completas",
    head: "accesorios de cabeza",
    accessory: "accesorios",
  };
  return `${slotLabel[topSlot] || topSlot} · ${topColor}`;
}

function potentialOutfitCount(wardrobe: WardrobeItem[]) {
  const counts = new Map<string, number>();
  for (const item of wardrobe) counts.set(slotFor(item), (counts.get(slotFor(item)) || 0) + 1);
  const topBottom = (counts.get("top") || 0) * (counts.get("bottom") || 0);
  const onePiece = counts.get("one_piece") || 0;
  const bases = topBottom + onePiece;
  const outerMultiplier = Math.max(1, Math.min(4, (counts.get("outer") || 0) + 1));
  const shoeMultiplier = Math.max(1, Math.min(4, counts.get("feet") || 0));
  const accessoryMultiplier = Math.max(1, Math.min(3, Math.floor(((counts.get("accessory") || 0) + (counts.get("head") || 0)) / 2) + 1));
  return Math.min(9999, bases * outerMultiplier * shoeMultiplier * accessoryMultiplier);
}

function wardrobeGaps(wardrobe: WardrobeItem[]) {
  const slots = new Set(wardrobe.map(slotFor));
  const gaps: string[] = [];
  if (!slots.has("top") && !slots.has("one_piece")) gaps.push("Falta una base superior o una prenda completa lista para construir outfits.");
  if (!slots.has("bottom") && !slots.has("one_piece")) gaps.push("Falta una parte inferior lista para cerrar combinaciones completas.");
  if (!slots.has("feet")) gaps.push("Añadir calzado permite evaluar el outfit completo y mejora el render del avatar.");
  if (!slots.has("outer")) gaps.push("Una capa versátil ampliaría clima, profundidad y ocasiones disponibles.");
  const families = new Set(wardrobe.map(readableColorFamily));
  if (families.size <= 1 && wardrobe.length >= 5) gaps.push("La paleta es muy concentrada; un acento compatible aumentaría diversidad sin romper coherencia.");
  if (!gaps.length) gaps.push("La estructura esencial está cubierta; el siguiente salto proviene de usar más prendas olvidadas, no de comprar más.");
  return gaps;
}

export function analyzeWardrobe(wardrobe: WardrobeItem[], outfits: Outfit[] = []): WardrobeAnalysis {
  const { ready, edges, adjacency } = buildCompatibilityGraph(wardrobe);
  const centrality = eigenvectorCentrality(adjacency);
  const communities = labelCommunities(adjacency);
  const maxDegree = Math.max(1, ...ready.map((item) => weightedDegree(adjacency, idFor(item))));
  const maxCentrality = Math.max(1e-9, ...centrality.values());
  const nodes: WardrobeGraphNode[] = ready.map((item) => {
    const id = idFor(item);
    const degree = weightedDegree(adjacency, id);
    const normalizedCentrality = (centrality.get(id) || 0) / maxCentrality;
    const redundancy = redundancyFor(item, ready);
    const versatility = clamp(degree / maxDegree * .62 + normalizedCentrality * .26 + (1 - redundancy) * .12);
    return {
      garmentId: id,
      weightedDegree: degree,
      centrality: normalizedCentrality,
      community: communities.get(id) || 0,
      redundancy,
      versatility,
    };
  });
  const paletteCounts = new Map<string, number>();
  for (const item of ready) {
    const family = readableColorFamily(item);
    paletteCounts.set(family, (paletteCounts.get(family) || 0) + 1);
  }
  const palette = [...paletteCounts.entries()]
    .map(([family, count]) => ({ family, count, share: ready.length ? count / ready.length : 0 }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  const grouped = new Map<number, WardrobeItem[]>();
  for (const item of ready) {
    const community = communities.get(idFor(item)) || 0;
    grouped.set(community, [...(grouped.get(community) || []), item]);
  }
  const communityList = [...grouped.entries()]
    .map(([id, items]) => ({ id, garmentIds: items.map(idFor), label: communityLabel(items) }))
    .sort((a, b) => b.garmentIds.length - a.garmentIds.length);
  const heroes = [...nodes].sort((a, b) => b.versatility - a.versatility).slice(0, 5);
  const orphans = [...nodes].sort((a, b) => a.weightedDegree - b.weightedDegree || b.redundancy - a.redundancy).slice(0, Math.min(4, nodes.length));
  const redundantClusters: Array<{ garmentIds: string[]; explanation: string }> = [];
  const visited = new Set<string>();
  for (const item of ready) {
    const id = idFor(item);
    if (visited.has(id)) continue;
    const semantics = semanticsFor(item);
    const similar = ready.filter((candidate) => {
      if (idFor(candidate) === id || slotFor(candidate) !== semantics.slot) return false;
      const target = semanticsFor(candidate);
      return colorHarmony(semantics.color, target.color) > .82
        && Math.abs(semantics.formality - target.formality) < .18
        && Math.abs(semantics.volume - target.volume) < .2
        && Math.abs(semantics.pattern - target.pattern) < .24;
    });
    if (!similar.length) continue;
    const ids = [id, ...similar.map(idFor)].filter((value) => !visited.has(value));
    if (ids.length < 2) continue;
    ids.forEach((value) => visited.add(value));
    redundantClusters.push({ garmentIds: ids, explanation: `${ids.length} prendas ocupan un rol visual muy parecido; conviene diferenciarlas por ocasión o rotación.` });
  }
  const outfitVectors = outfits.filter((outfit) => outfit.pieces.length).map((outfit) => outfitFeatureVector(outfit.pieces));
  const wardrobeVectors = ready.map((item) => outfitFeatureVector([item]));
  const required: Array<"top" | "bottom" | "feet"> = ["top", "bottom", "feet"];
  const availableSlots = new Set(ready.map(slotFor));
  const covered = required.filter((slot) => availableSlots.has(slot) || ((slot === "top" || slot === "bottom") && availableSlots.has("one_piece"))).length;
  return {
    nodes,
    edges,
    palette,
    communities: communityList,
    heroes,
    orphans,
    redundantClusters,
    gaps: wardrobeGaps(ready),
    potentialOutfits: potentialOutfitCount(ready),
    coverage: required.length ? covered / required.length : 0,
    styleDNA: styleDNAFromVectors(outfitVectors.length ? outfitVectors : wardrobeVectors),
  };
}
