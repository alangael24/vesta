export type NativeGarment = {
  id: number | string;
  name: string;
  category: string;
  type: string;
  color?: string | null;
  secondaryColor?: string | null;
  material?: string | null;
  description?: string | null;
  tags?: string[];
  isBasic?: boolean | null;
  imagePath?: string | null;
  localImageUri?: string | null;
  imageKind?: string | null;
};

export type NativeOutfit = {
  id: string;
  name: string;
  occasion: string;
  note?: string | null;
  renderPath?: string | null;
  localRenderUri?: string | null;
  pieces: NativeGarment[];
};

export type NativeCalendarEntry = {
  outfitId: string;
  scheduledDate: string;
};

export type StudioDirection = "complete" | "polished" | "relaxed" | "layer" | "color_shift";
export type StylistWeather = "calor" | "templado" | "frío" | "lluvia";
export type StylistMood = "minimal" | "relajado" | "pulido" | "atrevido";

export type StylistBrief = {
  occasion: string;
  weather: StylistWeather;
  mood: StylistMood;
  seedGarmentIds: string[];
  variationSeed: number;
};

export type ClosetPulse = {
  readyGarments: number;
  totalGarments: number;
  realLooks: number;
  outfitPotential: number;
  coverageScore: number;
  dominantPalette: string;
  styleName: string;
  nextMove: string;
};

export type DirectedLookResult<T extends NativeGarment> = {
  items: T[];
  changed: boolean;
  label: string;
  explanation: string;
};

type Slot = "head" | "top" | "outer" | "legs" | "one_piece" | "feet" | "accessory";
type ColorFamily = "neutral" | "earth" | "cool" | "warm" | "bright";

const polishedWords = /(camisa|blusa|sastre|blazer|abrigo|trench|pantalón|pantalon|falda|vestido|loafer|mocas|tacón|tacon|botín|botin|lana|seda|satén|saten|structured|tailored)/iu;
const relaxedWords = /(camiseta|t-shirt|tee|denim|jean|sudadera|hoodie|short|tenis|sneaker|algodón|algodon|punto|knit|casual)/iu;
const warmWords = /(abrigo|chaqueta|jacket|suéter|sueter|jersey|lana|wool|cuero|leather|bota|botín|botin)/iu;
const lightWords = /(lino|linen|algodón|algodon|short|falda|vestido|camiseta|sandalia|sandal)/iu;

export function analyzeClosetPulse(
  garments: NativeGarment[],
  outfits: NativeOutfit[],
): ClosetPulse {
  const ready = garments.filter(isReadyGarment);
  const realLooks = outfits.filter((outfit) => Boolean(outfit.renderPath || outfit.localRenderUri)).length;
  const categories = new Set(ready.map((item) => slotFor(item)));
  const coreSlots: Slot[] = ["top", "legs", "outer", "feet"];
  const coverageScore = Math.round((coreSlots.filter((slot) => categories.has(slot)).length / coreSlots.length) * 100);

  const tops = ready.filter((item) => slotFor(item) === "top").length;
  const bottoms = ready.filter((item) => slotFor(item) === "legs").length;
  const onePieces = ready.filter((item) => slotFor(item) === "one_piece").length;
  const layers = ready.filter((item) => slotFor(item) === "outer").length;
  const footwear = ready.filter((item) => slotFor(item) === "feet").length;
  const accessories = ready.filter((item) => ["accessory", "head"].includes(slotFor(item))).length;
  const outfitPotential = Math.min(
    999,
    tops * bottoms * Math.max(1, layers + 1) * Math.max(1, footwear)
      + onePieces * Math.max(1, layers + 1) * Math.max(1, footwear)
      + Math.min(24, accessories * Math.max(1, tops + onePieces)),
  );

  const familyCounts = new Map<ColorFamily, number>();
  for (const garment of ready) {
    const family = colorFamily(garment.color);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  const dominant = Array.from(familyCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "neutral";

  return {
    readyGarments: ready.length,
    totalGarments: garments.length,
    realLooks,
    outfitPotential,
    coverageScore,
    dominantPalette: paletteLabel(dominant),
    styleName: styleNameFor(dominant, ready),
    nextMove: nextMoveFor({ tops, bottoms, onePieces, layers, footwear, realLooks, ready: ready.length }),
  };
}

export function featuredOutfitIdForToday(
  entries: NativeCalendarEntry[],
  outfits: NativeOutfit[],
  today: string,
): string | null {
  const scheduled = entries.find((entry) => entry.scheduledDate === today && outfits.some((outfit) => outfit.id === entry.outfitId));
  if (scheduled) return scheduled.outfitId;
  return outfits.find((outfit) => Boolean(outfit.renderPath || outfit.localRenderUri))?.id
    || outfits[0]?.id
    || null;
}

export function stylistBriefPayload(brief?: StylistBrief | null) {
  if (!brief) return { count: 3 };
  return {
    count: 3,
    occasion: cleanLabel(brief.occasion, 40),
    weather: brief.weather,
    mood: brief.mood,
    seedGarmentIds: Array.from(new Set(brief.seedGarmentIds.map(String))).slice(0, 2),
    variationSeed: Number.isFinite(brief.variationSeed) ? Math.trunc(brief.variationSeed) : 0,
  };
}

export function directStudioLook<T extends NativeGarment>(
  wardrobe: T[],
  selected: T[],
  direction: StudioDirection,
  seed = 0,
): DirectedLookResult<T> {
  const available = wardrobe.filter(isReadyGarment);
  const uniqueSelected = uniqueById(selected.filter((item) => available.some((candidate) => sameId(candidate, item))));
  if (!available.length) {
    return { items: uniqueSelected, changed: false, label: "Armario pendiente", explanation: "Prepara los recortes de tus prendas antes de dirigir un look." };
  }

  let next: T[];
  if (direction === "color_shift") {
    next = colorShift(available, uniqueSelected, seed);
  } else {
    next = buildDirectedLook(available, uniqueSelected, direction, seed);
  }

  next = uniqueById(next).slice(0, 6);
  const changed = signature(next) !== signature(uniqueSelected);
  const copy = directionCopy(direction, changed);
  return { items: next, changed, ...copy };
}

export function isReadyGarment(item: NativeGarment) {
  return Boolean((item.imagePath || item.localImageUri) && (!item.imageKind || item.imageKind === "cutout"));
}

function buildDirectedLook<T extends NativeGarment>(
  wardrobe: T[],
  selected: T[],
  direction: Exclude<StudioDirection, "color_shift">,
  seed: number,
) {
  const anchor = selected[0] || bestCandidate(wardrobe, [], direction, seed);
  const keep = anchor ? [anchor, ...selected.filter((item) => !sameId(item, anchor))] : [...selected];
  const result = normalizeConflicts(keep);
  const slots = new Set(result.map(slotFor));

  if (slots.has("one_piece")) {
    removeSlots(result, ["top", "legs"]);
  } else {
    if (!slots.has("top")) addBest(result, wardrobe, "top", direction, seed + 1);
    if (!slots.has("legs")) addBest(result, wardrobe, "legs", direction, seed + 2);
  }

  if (direction === "layer" || direction === "polished" || shouldAddLayer(result, direction)) {
    if (!result.some((item) => slotFor(item) === "outer")) addBest(result, wardrobe, "outer", direction, seed + 3);
    else if (direction === "layer") replaceSlot(result, wardrobe, "outer", direction, seed + 4);
  }

  if (!result.some((item) => slotFor(item) === "feet")) addBest(result, wardrobe, "feet", direction, seed + 5);
  if (direction === "polished" && !result.some((item) => slotFor(item) === "accessory")) addBest(result, wardrobe, "accessory", direction, seed + 6);
  if (direction === "relaxed" && result.length < 5 && seed % 2 === 0) addBest(result, wardrobe, "head", direction, seed + 7);

  if (direction === "polished") upgradeWeakest(result, wardrobe, direction, seed + 8, anchor);
  if (direction === "relaxed") upgradeWeakest(result, wardrobe, direction, seed + 9, anchor);

  return normalizeConflicts(result);
}

function colorShift<T extends NativeGarment>(wardrobe: T[], selected: T[], seed: number) {
  if (!selected.length) return buildDirectedLook(wardrobe, selected, "complete", seed);
  const replaceableSlots: Slot[] = ["legs", "top", "outer", "one_piece", "feet"];
  const current = normalizeConflicts(selected);
  for (const slot of rotate(replaceableSlots, seed)) {
    const currentItem = current.find((item) => slotFor(item) === slot);
    if (!currentItem) continue;
    const alternatives = wardrobe
      .filter((item) => slotFor(item) === slot && !sameId(item, currentItem))
      .filter((item) => colorFamily(item.color) !== colorFamily(currentItem.color))
      .map((item) => ({ item, score: candidateScore(item, current.filter((entry) => !sameId(entry, currentItem)), "complete") }))
      .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
    if (alternatives[0]) {
      return current.map((item) => sameId(item, currentItem) ? alternatives[0].item : item);
    }
  }
  return buildDirectedLook(wardrobe, current, "complete", seed + 1);
}

function upgradeWeakest<T extends NativeGarment>(
  result: T[],
  wardrobe: T[],
  direction: "polished" | "relaxed",
  seed: number,
  anchor?: T,
) {
  const candidates = result
    .filter((item) => !anchor || !sameId(item, anchor))
    .filter((item) => ["top", "legs", "outer", "feet"].includes(slotFor(item)))
    .map((item) => ({ item, score: directionPreference(item, direction) }))
    .sort((a, b) => a.score - b.score || String(a.item.id).localeCompare(String(b.item.id)));
  const weakest = candidates[0]?.item;
  if (!weakest) return;
  const slot = slotFor(weakest);
  const replacement = rankedCandidates(wardrobe, result.filter((item) => !sameId(item, weakest)), slot, direction, seed)
    .find((candidate) => !sameId(candidate, weakest));
  if (replacement && directionPreference(replacement, direction) > directionPreference(weakest, direction)) {
    const index = result.findIndex((item) => sameId(item, weakest));
    result[index] = replacement;
  }
}

function shouldAddLayer<T extends NativeGarment>(items: T[], direction: Exclude<StudioDirection, "color_shift">) {
  if (direction !== "complete") return false;
  const description = items.map(descriptor).join(" ");
  return items.length <= 3 && !/(short|sandalia|lino|linen|calor)/iu.test(description);
}

function addBest<T extends NativeGarment>(
  result: T[],
  wardrobe: T[],
  slot: Slot,
  direction: Exclude<StudioDirection, "color_shift">,
  seed: number,
) {
  const candidate = rankedCandidates(wardrobe, result, slot, direction, seed)[0];
  if (candidate) result.push(candidate);
}

function replaceSlot<T extends NativeGarment>(
  result: T[],
  wardrobe: T[],
  slot: Slot,
  direction: Exclude<StudioDirection, "color_shift">,
  seed: number,
) {
  const currentIndex = result.findIndex((item) => slotFor(item) === slot);
  const current = result[currentIndex];
  const candidate = rankedCandidates(wardrobe, result.filter((_, index) => index !== currentIndex), slot, direction, seed)
    .find((item) => !current || !sameId(item, current));
  if (candidate && currentIndex >= 0) result[currentIndex] = candidate;
  else if (candidate) result.push(candidate);
}

function rankedCandidates<T extends NativeGarment>(
  wardrobe: T[],
  selected: T[],
  slot: Slot,
  direction: Exclude<StudioDirection, "color_shift">,
  seed: number,
) {
  return wardrobe
    .filter((item) => slotFor(item) === slot)
    .filter((item) => !selected.some((entry) => sameId(entry, item)))
    .map((item) => ({ item, score: candidateScore(item, selected, direction) + seededTieBreak(item.id, seed) }))
    .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
    .map(({ item }) => item);
}

function bestCandidate<T extends NativeGarment>(
  wardrobe: T[],
  selected: T[],
  direction: Exclude<StudioDirection, "color_shift">,
  seed: number,
) {
  return wardrobe
    .map((item) => ({ item, score: candidateScore(item, selected, direction) + seededTieBreak(item.id, seed) }))
    .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))[0]?.item;
}

function candidateScore(
  candidate: NativeGarment,
  selected: NativeGarment[],
  direction: Exclude<StudioDirection, "color_shift">,
) {
  const compatibility = selected.length
    ? selected.reduce((total, item) => total + colorCompatibility(candidate.color, item.color), 0) / selected.length
    : 3;
  const directionBonus = directionPreference(candidate, direction);
  const basicBonus = candidate.isBasic ? 0.35 : 0;
  const repetitionPenalty = selected.some((item) => slotFor(item) === slotFor(candidate)) ? -2.5 : 0;
  return compatibility * 1.8 + directionBonus + basicBonus + repetitionPenalty;
}

function directionPreference(item: NativeGarment, direction: Exclude<StudioDirection, "color_shift">) {
  const text = descriptor(item);
  if (direction === "polished") return polishedWords.test(text) ? 5 : relaxedWords.test(text) ? -1 : 1.5;
  if (direction === "relaxed") return relaxedWords.test(text) ? 5 : polishedWords.test(text) ? -0.6 : 1.4;
  if (direction === "layer") return slotFor(item) === "outer" ? 6 + (warmWords.test(text) ? 1 : 0) : 1;
  return 2 + (item.isBasic ? 0.7 : 0);
}

function normalizeConflicts<T extends NativeGarment>(items: T[]) {
  const result: T[] = [];
  for (const item of items) {
    const incoming = slotFor(item);
    if (incoming === "accessory") {
      result.push(item);
      continue;
    }
    if (incoming === "one_piece") removeSlots(result, ["one_piece", "top", "legs"]);
    else if (["top", "legs"].includes(incoming)) removeSlots(result, [incoming, "one_piece"]);
    else removeSlots(result, [incoming]);
    result.push(item);
  }
  return uniqueById(result);
}

function removeSlots<T extends NativeGarment>(items: T[], slots: Slot[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (slots.includes(slotFor(items[index]))) items.splice(index, 1);
  }
}

function slotFor(item: NativeGarment): Slot {
  const text = descriptor(item);
  if (item.category === "footwear" || /(zapato|tenis|shoe|sneaker|bota|calzado|sandalia|loafer|mocas)/iu.test(text)) return "feet";
  if (/(gorra|cachucha|sombrero|beanie|bucket|\bcap\b|\bhat\b)/iu.test(text)) return "head";
  if (item.category === "bottoms") return "legs";
  if (item.category === "layers") return "outer";
  if (item.category === "one_piece") return "one_piece";
  if (item.category === "tops") return "top";
  return "accessory";
}

function colorCompatibility(first?: string | null, second?: string | null) {
  const a = colorFamily(first);
  const b = colorFamily(second);
  if (a === "neutral" || b === "neutral") return 5;
  if (a === b) return 4.4;
  if ((a === "earth" && b === "warm") || (a === "warm" && b === "earth")) return 4.2;
  if ((a === "earth" && b === "cool") || (a === "cool" && b === "earth")) return 3.4;
  if ((a === "bright" && b !== "bright") || (b === "bright" && a !== "bright")) return 3.2;
  return 2.4;
}

function colorFamily(value?: string | null): ColorFamily {
  const color = (value || "").toLowerCase();
  if (/negro|black|blanco|white|gris|gray|grey|crudo|crema|cream|marfil|navy|marino|beige|arena/u.test(color)) return "neutral";
  if (/café|cafe|brown|camel|khaki|caqui|oliva|olive|óxido|oxido|terracota/u.test(color)) return "earth";
  if (/azul|blue|verde|green|morado|purple|violet|índigo|indigo/u.test(color)) return "cool";
  if (/rojo|red|naranja|orange|amarillo|yellow|rosa|pink|magenta|vino|burgundy/u.test(color)) return "warm";
  return "bright";
}

function paletteLabel(family: ColorFamily) {
  if (family === "earth") return "Tonos tierra";
  if (family === "cool") return "Tonos fríos";
  if (family === "warm") return "Tonos cálidos";
  if (family === "bright") return "Color expresivo";
  return "Neutros versátiles";
}

function styleNameFor(family: ColorFamily, garments: NativeGarment[]) {
  const text = garments.map(descriptor).join(" ");
  if (polishedWords.test(text) && relaxedWords.test(text)) return "Editorial relajado";
  if (polishedWords.test(text)) return family === "neutral" ? "Minimalismo pulido" : "Clásico con color";
  if (relaxedWords.test(text)) return family === "earth" ? "Casual orgánico" : "Casual contemporáneo";
  if (family === "earth") return "Tierra moderna";
  if (family === "warm") return "Contraste cálido";
  if (family === "cool") return "Paleta urbana";
  return "Esenciales con intención";
}

function nextMoveFor(input: {
  tops: number;
  bottoms: number;
  onePieces: number;
  layers: number;
  footwear: number;
  realLooks: number;
  ready: number;
}) {
  if (input.ready < 2) return "Prepara dos prendas para desbloquear tu primer look real.";
  if (!input.onePieces && !input.tops) return "Añade una parte de arriba o un vestido para crear combinaciones completas.";
  if (!input.onePieces && !input.bottoms) return "Añade un pantalón o una falda para ampliar las combinaciones.";
  if (!input.footwear) return "Importa calzado: hará que los renders del avatar se sientan realmente terminados.";
  if (!input.layers) return "Una capa versátil multiplicará el armario para días frescos y looks más pulidos.";
  if (!input.realLooks) return "Tu armario ya está listo: dirige el primer look y llévalo a tu avatar.";
  return "Prueba una dirección distinta y guarda solo los looks que de verdad repetirías.";
}

function directionCopy(direction: StudioDirection, changed: boolean) {
  if (!changed) return { label: "Ya está resuelto", explanation: "No encontré una alternativa mejor con las prendas listas de tu armario." };
  if (direction === "polished") return { label: "Más pulido", explanation: "Conservé la prenda ancla y reforcé estructura, calzado y acabado." };
  if (direction === "relaxed") return { label: "Más relajado", explanation: "Conservé la idea del look y prioricé básicos, denim, punto o calzado casual." };
  if (direction === "layer") return { label: "Nueva capa", explanation: "Añadí o cambié la capa que mejor equilibra color y temperatura visual." };
  if (direction === "color_shift") return { label: "Otro color", explanation: "Cambié una pieza clave por otra familia de color sin romper la combinación." };
  return { label: "Outfit completado", explanation: "Rellené las categorías que faltaban y mantuve la selección como punto de partida." };
}

function descriptor(item: NativeGarment) {
  return `${item.name} ${item.type} ${item.material || ""} ${item.description || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
}

function uniqueById<T extends NativeGarment>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function sameId(first: NativeGarment, second: NativeGarment) {
  return String(first.id) === String(second.id);
}

function signature(items: NativeGarment[]) {
  return items.map((item) => String(item.id)).sort().join("|");
}

function seededTieBreak(id: NativeGarment["id"], seed: number) {
  const text = `${id}:${seed}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function rotate<T>(values: T[], seed: number) {
  if (!values.length) return values;
  const offset = Math.abs(Math.trunc(seed)) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function cleanLabel(value: string, maxLength: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}
