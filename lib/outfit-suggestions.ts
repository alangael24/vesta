export type OutfitSuggestionGarment = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string | null;
  description?: string | null;
  material?: string | null;
  isBasic?: boolean | null;
};

export type OutfitStyleReference = {
  source: "photo" | "saved_look";
  garments: OutfitSuggestionGarment[];
};

export type OutfitWeather = "calor" | "templado" | "frío" | "lluvia";
export type OutfitMood = "minimal" | "relajado" | "pulido" | "atrevido";

export type OutfitContext = {
  occasion?: string | null;
  weather?: OutfitWeather | null;
  mood?: OutfitMood | null;
  seedGarmentIds?: string[];
  avoidGarmentIds?: string[];
  variationSeed?: number;
};

export type OutfitSuggestion = {
  name: string;
  occasion: string;
  rationale: string;
  garmentIds: string[];
  signature: string;
  score: number;
  signals: string[];
};

export type WardrobeInsight = {
  total: number;
  outfitPotential: number;
  versatilityScore: number;
  coverageScore: number;
  dominantPalette: Array<{ family: string; count: number }>;
  gap: string;
  mostVersatileGarmentIds: string[];
};

type Candidate = OutfitSuggestion & {
  rawScore: number;
};

const defaultOccasions = ["Diario", "Fin de semana", "Cena casual", "Trabajo flexible"];
const coreCategories = ["tops", "bottoms", "layers", "footwear", "accessories"];

export function suggestOutfits(
  garments: OutfitSuggestionGarment[],
  count = 3,
  existingSignatures = new Set<string>(),
  styleReferences: OutfitStyleReference[] = [],
  context: OutfitContext = {},
): OutfitSuggestion[] {
  const available = garments.filter((item) => !context.avoidGarmentIds?.includes(item.id));
  const tops = available.filter((item) => item.category === "tops");
  const onePieces = available.filter((item) => item.category === "one_piece");
  const bottoms = available.filter((item) => item.category === "bottoms");
  const layers = available.filter((item) => item.category === "layers");
  const footwear = available.filter((item) => item.category === "footwear" || isFootwear(item));
  const headwear = available.filter((item) => item.category === "accessories" && isHeadwear(item));
  const accessories = available.filter((item) => item.category === "accessories" && !isHeadwear(item) && !isFootwear(item));

  if (!onePieces.length && (!tops.length || !bottoms.length)) return [];

  const candidates: Candidate[] = [];
  let combinationIndex = 0;

  for (const top of tops) {
    for (const bottom of bottoms) {
      const compatibleLayers = layers
        .map((layer) => ({ layer, score: compatibilityScore(layer.color, top.color) + compatibilityScore(layer.color, bottom.color) }))
        .sort((a, b) => b.score - a.score || a.layer.name.localeCompare(b.layer.name));
      const layerChoices: Array<OutfitSuggestionGarment | undefined> = [undefined, ...compatibleLayers.slice(0, 2).map(({ layer }) => layer)];

      for (const layer of layerChoices) {
        const selected = [top, ...(layer ? [layer] : []), bottom];
        const shoe = footwear.length ? footwear[combinationIndex % footwear.length] : undefined;
        const hat = headwear.length && combinationIndex % 2 === 0 ? headwear[combinationIndex % headwear.length] : undefined;
        const accessory = accessories.length && combinationIndex % 3 === 0 ? accessories[combinationIndex % accessories.length] : undefined;
        if (shoe) selected.push(shoe);
        if (hat) selected.push(hat);
        if (accessory) selected.push(accessory);

        pushCandidate(candidates, selected, { top, bottom, layer, shoe }, existingSignatures, styleReferences, context, combinationIndex);
        combinationIndex += 1;
      }
    }
  }

  for (const onePiece of onePieces) {
    const compatibleLayers = layers
      .map((layer) => ({ layer, score: compatibilityScore(layer.color, onePiece.color) }))
      .sort((a, b) => b.score - a.score || a.layer.name.localeCompare(b.layer.name));
    const layerChoices: Array<OutfitSuggestionGarment | undefined> = [undefined, ...compatibleLayers.slice(0, 2).map(({ layer }) => layer)];

    for (const layer of layerChoices) {
      const selected = [onePiece, ...(layer ? [layer] : [])];
      const shoe = footwear.length ? footwear[combinationIndex % footwear.length] : undefined;
      const hat = headwear.length && combinationIndex % 2 === 0 ? headwear[combinationIndex % headwear.length] : undefined;
      const accessory = accessories.length ? accessories[combinationIndex % accessories.length] : undefined;
      if (shoe) selected.push(shoe);
      if (hat) selected.push(hat);
      if (accessory) selected.push(accessory);

      pushOnePieceCandidate(candidates, selected, onePiece, layer, shoe, existingSignatures, styleReferences, context, combinationIndex);
      combinationIndex += 1;
    }
  }

  const anchorAwareCandidates = preferMaximumAnchorCoverage(candidates, context.seedGarmentIds);
  return selectDiverseCandidates(anchorAwareCandidates, count, context.variationSeed || 0)
    .map(({ rawScore: _rawScore, ...suggestion }) => suggestion);
}

export function signatureFor(garmentIds: string[]) {
  return [...garmentIds].sort().join("|");
}

export function summarizeWardrobe(garments: OutfitSuggestionGarment[]): WardrobeInsight {
  const paletteCounts = new Map<string, number>();
  for (const garment of garments) {
    const family = colorFamily(garment.color);
    paletteCounts.set(family, (paletteCounts.get(family) || 0) + 1);
  }

  const categories = new Set(garments.map((item) => item.category));
  const coverageScore = Math.round((coreCategories.filter((category) => categories.has(category)).length / coreCategories.length) * 100);
  const versatile = garments
    .map((garment) => ({ garment, score: versatilityScoreFor(garment, garments) }))
    .sort((a, b) => b.score - a.score || a.garment.name.localeCompare(b.garment.name));
  const averageVersatility = versatile.length
    ? versatile.reduce((total, item) => total + item.score, 0) / versatile.length
    : 0;

  const tops = garments.filter((item) => item.category === "tops").length;
  const bottoms = garments.filter((item) => item.category === "bottoms").length;
  const onePieces = garments.filter((item) => item.category === "one_piece").length;
  const layers = garments.filter((item) => item.category === "layers").length;
  const outfitPotential = Math.min(999, tops * bottoms * Math.max(1, layers + 1) + onePieces * Math.max(1, layers + 1));

  return {
    total: garments.length,
    outfitPotential,
    versatilityScore: garments.length ? Math.round(clamp(35 + averageVersatility * 7.5, 0, 100)) : 0,
    coverageScore,
    dominantPalette: Array.from(paletteCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([family, familyCount]) => ({ family, count: familyCount })),
    gap: wardrobeGap(categories),
    mostVersatileGarmentIds: versatile.slice(0, 3).map(({ garment }) => garment.id),
  };
}

function pushCandidate(
  candidates: Candidate[],
  selected: OutfitSuggestionGarment[],
  pieces: {
    top: OutfitSuggestionGarment;
    bottom: OutfitSuggestionGarment;
    layer?: OutfitSuggestionGarment;
    shoe?: OutfitSuggestionGarment;
  },
  existingSignatures: Set<string>,
  styleReferences: OutfitStyleReference[],
  context: OutfitContext,
  index: number,
) {
  const garmentIds = unique(selected.map((item) => item.id));
  const signature = signatureFor(garmentIds);
  if (existingSignatures.has(signature)) return;

  const affinity = personalStyleAffinity(selected, styleReferences);
  const occasion = context.occasion?.trim() || occasionFor(selected, index);
  const rawScore = compatibilityScore(pieces.top.color, pieces.bottom.color) * 1.45
    + (pieces.layer ? compatibilityScore(pieces.layer.color, pieces.top.color) * .8 : 1)
    + garmentIds.length * .25
    + affinity.score
    + contextualScore(selected, context)
    + anchorScore(garmentIds, context.seedGarmentIds);
  const signals = suggestionSignals(selected, context, affinity.matchedSource);

  candidates.push({
    name: paletteName(pieces.top, pieces.bottom, pieces.layer),
    occasion,
    rationale: rationaleFor(selected, occasion, context, affinity.matchedSource),
    garmentIds,
    signature,
    score: confidenceScore(rawScore, context),
    signals,
    rawScore,
  });
}

function pushOnePieceCandidate(
  candidates: Candidate[],
  selected: OutfitSuggestionGarment[],
  onePiece: OutfitSuggestionGarment,
  layer: OutfitSuggestionGarment | undefined,
  shoe: OutfitSuggestionGarment | undefined,
  existingSignatures: Set<string>,
  styleReferences: OutfitStyleReference[],
  context: OutfitContext,
  index: number,
) {
  const garmentIds = unique(selected.map((item) => item.id));
  const signature = signatureFor(garmentIds);
  if (existingSignatures.has(signature)) return;

  const affinity = personalStyleAffinity(selected, styleReferences);
  const occasion = context.occasion?.trim() || occasionFor(selected, index);
  const rawScore = 7
    + (layer ? compatibilityScore(layer.color, onePiece.color) : 1)
    + (shoe ? 1 : 0)
    + affinity.score
    + contextualScore(selected, context)
    + anchorScore(garmentIds, context.seedGarmentIds);
  const pieces = [onePiece.name, layer?.name, shoe?.name].filter(Boolean);
  const personal = personalReferenceSentence(affinity.matchedSource);
  const contextSentence = contextRationale(selected, context);

  candidates.push({
    name: `${capitalize(cleanColor(onePiece.color) || onePiece.type)} completo`,
    occasion,
    rationale: `${pieces.join(", ")}. La prenda completa crea una silueta limpia sin añadir pantalón.${contextSentence}${personal}`,
    garmentIds,
    signature,
    score: confidenceScore(rawScore, context),
    signals: suggestionSignals(selected, context, affinity.matchedSource),
    rawScore,
  });
}

function preferMaximumAnchorCoverage(candidates: Candidate[], seedGarmentIds: string[] | undefined) {
  if (!seedGarmentIds?.length || !candidates.length) return candidates;
  const coverage = candidates.map((candidate) => seedGarmentIds.filter((id) => candidate.garmentIds.includes(id)).length);
  const maximumCoverage = Math.max(...coverage);
  return maximumCoverage > 0 ? candidates.filter((_, index) => coverage[index] === maximumCoverage) : candidates;
}

function selectDiverseCandidates(candidates: Candidate[], count: number, variationSeed: number) {
  const target = Math.max(1, Math.min(count, 6));
  const pool = [...candidates];
  const selected: Candidate[] = [];

  while (pool.length && selected.length < target) {
    pool.sort((a, b) => {
      const aOverlap = selected.length ? Math.max(...selected.map((item) => overlapRatio(a.garmentIds, item.garmentIds))) : 0;
      const bOverlap = selected.length ? Math.max(...selected.map((item) => overlapRatio(b.garmentIds, item.garmentIds))) : 0;
      const aAdjusted = a.rawScore - aOverlap * 2.35 + seededJitter(a.signature, variationSeed);
      const bAdjusted = b.rawScore - bOverlap * 2.35 + seededJitter(b.signature, variationSeed);
      return bAdjusted - aAdjusted || a.signature.localeCompare(b.signature);
    });
    selected.push(pool.shift()!);
  }

  return selected;
}

function contextualScore(selected: OutfitSuggestionGarment[], context: OutfitContext) {
  let score = 0;
  const descriptor = selected.map((item) => `${item.name} ${item.type} ${item.material || ""}`).join(" ").toLowerCase();
  const colors = selected.map((item) => colorFamily(item.color));
  const hasLayer = selected.some((item) => item.category === "layers");
  const hasShort = /short|bermuda/u.test(descriptor);
  const hasPolishedPiece = /camisa|polo|oxford|blazer|abrigo|trouser|pantalón|pantalon|vestido/u.test(descriptor);
  const neutralShare = colors.filter((family) => family === "neutral").length / Math.max(1, colors.length);

  if (context.weather === "calor") score += (hasShort ? 2.5 : 0) + (!hasLayer ? 1.4 : -2.2) + (/lino|linen|algodón|algodon/u.test(descriptor) ? 1 : 0);
  if (context.weather === "frío") score += (hasLayer ? 3.2 : -1.4) + (/lana|merino|abrigo|jersey|chaqueta/u.test(descriptor) ? 1.6 : 0) - (hasShort ? 3 : 0);
  if (context.weather === "lluvia") score += (hasLayer ? 2.4 : -.7) + (/field|gabardina|chaqueta|bota/u.test(descriptor) ? 1.5 : 0);
  if (context.weather === "templado") score += hasLayer ? .9 : 1.1;

  if (context.mood === "minimal") score += neutralShare * 3.2 - Math.max(0, selected.length - 3) * .35;
  if (context.mood === "relajado") score += /camiseta|denim|jean|short|gorra/u.test(descriptor) ? 2.1 : 0;
  if (context.mood === "pulido") score += hasPolishedPiece ? 2.4 : -.4;
  if (context.mood === "atrevido") score += new Set(colors.filter((family) => family !== "neutral")).size * 1.1 + (colors.includes("warm") && colors.includes("cool") ? 1.5 : 0);

  const occasion = (context.occasion || "").toLowerCase();
  if (/trabajo|reunión|reunion|oficina/u.test(occasion)) score += hasPolishedPiece ? 2.5 : -.6;
  if (/cena|evento/u.test(occasion)) score += hasLayer || colors.includes("neutral") ? 1.6 : .4;
  if (/viaje/u.test(occasion)) score += hasLayer ? 1.4 : .5;
  if (/diario|fin de semana/u.test(occasion)) score += selected.some((item) => item.isBasic) ? 1.4 : .5;

  return score;
}

function anchorScore(garmentIds: string[], seedGarmentIds: string[] | undefined) {
  if (!seedGarmentIds?.length) return 0;
  const matches = seedGarmentIds.filter((id) => garmentIds.includes(id)).length;
  const misses = seedGarmentIds.length - matches;
  return matches * 9 - misses * 4;
}

function suggestionSignals(
  selected: OutfitSuggestionGarment[],
  context: OutfitContext,
  matchedSource?: OutfitStyleReference["source"],
) {
  const signals: string[] = [];
  const families = selected.map((item) => colorFamily(item.color));
  const neutrals = families.filter((family) => family === "neutral").length;
  if (neutrals >= Math.ceil(selected.length / 2)) signals.push("Base neutra versátil");
  else if (new Set(families).size <= 2) signals.push("Paleta cohesionada");
  else signals.push("Contraste intencional");

  if (selected.some((item) => item.category === "layers")) signals.push("Profundidad por capas");
  if (context.seedGarmentIds?.some((id) => selected.some((item) => item.id === id))) signals.push("Parte de tu prenda ancla");
  if (context.weather === "calor") signals.push("Pensado para calor");
  if (context.weather === "frío") signals.push("Protección térmica");
  if (context.weather === "lluvia") signals.push("Capa útil para lluvia");
  if (context.mood) signals.push(`Dirección ${context.mood}`);
  if (matchedSource === "photo") signals.push("Aprendido de tus fotos");
  if (matchedSource === "saved_look") signals.push("Afinado con tus guardados");
  return unique(signals).slice(0, 4);
}

function rationaleFor(
  selected: OutfitSuggestionGarment[],
  occasion: string,
  context: OutfitContext,
  matchedSource?: OutfitStyleReference["source"],
) {
  const pieces = selected.map((item) => item.name);
  const families = selected.map((item) => colorFamily(item.color));
  const palette = families.every((family) => family === "neutral")
    ? "La base neutra hace que el conjunto sea fácil de repetir"
    : new Set(families).size <= 2
      ? "La paleta se mantiene cohesionada sin verse plana"
      : "El contraste está equilibrado por una pieza neutra";
  return `${pieces.join(", ")}. ${palette} para ${occasion.toLowerCase()}.${contextRationale(selected, context)}${personalReferenceSentence(matchedSource)}`;
}

function contextRationale(selected: OutfitSuggestionGarment[], context: OutfitContext) {
  const sentences: string[] = [];
  const hasLayer = selected.some((item) => item.category === "layers");
  if (context.weather === "calor") sentences.push(hasLayer ? "La capa puede retirarse cuando suba la temperatura" : "La construcción ligera evita capas innecesarias");
  if (context.weather === "frío") sentences.push(hasLayer ? "La capa añade abrigo sin romper la proporción" : "Mantiene una silueta limpia para interiores templados");
  if (context.weather === "lluvia") sentences.push(hasLayer ? "La capa exterior hace el look más práctico" : "Funciona mejor bajo una chaqueta impermeable");
  if (context.mood === "minimal") sentences.push("La lectura visual es limpia y sin ruido");
  if (context.mood === "pulido") sentences.push("Las líneas se sienten más estructuradas");
  if (context.mood === "relajado") sentences.push("Las texturas mantienen el resultado cómodo");
  if (context.mood === "atrevido") sentences.push("El color aporta personalidad sin competir entre sí");
  return sentences.length ? ` ${sentences.join(". ")}.` : "";
}

function personalReferenceSentence(source?: OutfitStyleReference["source"]) {
  if (source === "photo") return " Retoma una fórmula de color y capas que ya usaste en tus fotos.";
  if (source === "saved_look") return " Sigue el estilo de los Looks que ya guardaste.";
  return "";
}

function personalStyleAffinity(selected: OutfitSuggestionGarment[], references: OutfitStyleReference[]) {
  let best = { score: 0, matchedSource: undefined as OutfitStyleReference["source"] | undefined };
  for (const reference of references) {
    if (reference.garments.length < 2) continue;
    const referenceSlots = new Set(reference.garments.map(styleSlot));
    const referenceColors = new Set(reference.garments.map((garment) => colorFamily(garment.color)));
    const exactIds = new Set(reference.garments.map((garment) => garment.id));
    const slotMatches = selected.filter((garment) => referenceSlots.has(styleSlot(garment))).length;
    const colorMatches = selected.filter((garment) => referenceColors.has(colorFamily(garment.color))).length;
    const exactMatches = selected.filter((garment) => exactIds.has(garment.id)).length;
    const layeringMatches = Number(
      reference.garments.some((garment) => styleSlot(garment) === "layer") === selected.some((garment) => styleSlot(garment) === "layer"),
    );
    const score = slotMatches * .35 + colorMatches * 1.05 + exactMatches * 3.2 + layeringMatches * .45;
    if (score > best.score) best = { score, matchedSource: reference.source };
  }
  return best;
}

function compatibilityScore(first: string | null, second: string | null) {
  const a = colorFamily(first);
  const b = colorFamily(second);
  if (a === "neutral" || b === "neutral") return 5;
  if (a === b) return 4;
  if ((a === "warm" && b === "earth") || (a === "earth" && b === "warm")) return 4;
  if ((a === "cool" && b === "earth") || (a === "earth" && b === "cool")) return 3;
  if ((a === "warm" && b === "cool") || (a === "cool" && b === "warm")) return 2.6;
  return 2;
}

function colorFamily(value: string | null) {
  const color = (value || "").toLowerCase();
  if (/negro|black|blanco|white|gris|gray|grey|crudo|crema|cream|marfil|navy|marino/u.test(color)) return "neutral";
  if (/café|cafe|brown|camel|arena|beige|khaki|caqui|oliva|olive|óxido|oxido|avena|cacao/u.test(color)) return "earth";
  if (/azul|blue|verde|green|morado|purple|violet|índigo|indigo/u.test(color)) return "cool";
  if (/rojo|red|naranja|orange|amarillo|yellow|rosa|pink|magenta/u.test(color)) return "warm";
  return "neutral";
}

function paletteName(top: OutfitSuggestionGarment, bottom: OutfitSuggestionGarment, layer?: OutfitSuggestionGarment) {
  const first = cleanColor(layer?.color || top.color) || layer?.type || top.type;
  const second = cleanColor(bottom.color) || bottom.type;
  return `${capitalize(first)} & ${second.toLowerCase()}`;
}

function styleSlot(item: OutfitSuggestionGarment) {
  if (item.category === "one_piece") return "one_piece";
  if (item.category === "tops") return "top";
  if (item.category === "bottoms") return "bottom";
  if (item.category === "layers") return "layer";
  if (isFootwear(item)) return "footwear";
  if (isHeadwear(item)) return "headwear";
  return "accessory";
}

function occasionFor(items: OutfitSuggestionGarment[], index: number) {
  const descriptor = items.map((item) => `${item.type} ${item.name}`).join(" ").toLowerCase();
  if (/vestir|dress|formal|abrigo|coat/u.test(descriptor)) return index % 2 ? "Cena" : "Trabajo";
  if (/sport|deport|sudadera|hoodie|tenis|sneaker/u.test(descriptor)) return "Diario";
  return defaultOccasions[index % defaultOccasions.length];
}

function confidenceScore(rawScore: number, context: OutfitContext) {
  const contextualBoost = context.weather || context.mood || context.occasion || context.seedGarmentIds?.length ? 2 : 0;
  return Math.round(clamp(50 + rawScore * 1.4 + contextualBoost, 62, 96));
}

function versatilityScoreFor(garment: OutfitSuggestionGarment, wardrobe: OutfitSuggestionGarment[]) {
  const compatible = wardrobe.filter((other) => other.id !== garment.id)
    .reduce((total, other) => total + compatibilityScore(garment.color, other.color), 0);
  const basicBoost = garment.isBasic ? 2 : 0;
  const neutralBoost = colorFamily(garment.color) === "neutral" ? 1.5 : 0;
  return wardrobe.length > 1 ? compatible / (wardrobe.length - 1) + basicBoost + neutralBoost : basicBoost + neutralBoost;
}

function wardrobeGap(categories: Set<string>) {
  if (!categories.has("footwear")) return "Añade calzado para cerrar looks completos.";
  if (!categories.has("layers")) return "Una capa exterior multiplicaría las combinaciones.";
  if (!categories.has("accessories")) return "Un accesorio versátil daría más identidad a tus looks.";
  if (!categories.has("one_piece")) return "Tu armario está bien cubierto; prueba una prenda completa para ampliar siluetas.";
  return "Cobertura equilibrada: prioriza reemplazar, no acumular.";
}

function isHeadwear(item: OutfitSuggestionGarment) {
  return /(gorra|cachucha|sombrero|beanie|bucket|\bcap\b|\bhat\b)/u.test(`${item.type} ${item.name}`.toLowerCase());
}

function isFootwear(item: OutfitSuggestionGarment) {
  return /(zapato|tenis|shoe|sneaker|bota|calzado)/u.test(`${item.type} ${item.name}`.toLowerCase());
}

function cleanColor(value: string | null) {
  const color = (value || "").trim();
  return /sin confirmar|unknown/u.test(color.toLowerCase()) ? "" : color;
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Look";
}

function overlapRatio(first: string[], second: string[]) {
  const a = new Set(first);
  const b = new Set(second);
  const overlap = Array.from(a).filter((id) => b.has(id)).length;
  const union = new Set([...a, ...b]).size;
  return union ? overlap / union : 0;
}

function seededJitter(signature: string, seed: number) {
  if (!seed) return 0;
  let hash = Math.abs(Math.trunc(seed)) || 1;
  for (const character of signature) hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  return (hash / 9973 - .5) * .55;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
