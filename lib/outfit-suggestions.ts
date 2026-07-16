export type OutfitSuggestionGarment = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string | null;
  description?: string | null;
};

export type OutfitSuggestion = {
  name: string;
  occasion: string;
  rationale: string;
  garmentIds: string[];
  signature: string;
};

export type OutfitStyleReference = {
  source: "photo" | "saved_look";
  garments: OutfitSuggestionGarment[];
};

const occasions = ["Diario", "Fin de semana", "Cena casual", "Trabajo flexible"];

export function suggestOutfits(
  garments: OutfitSuggestionGarment[],
  count = 3,
  existingSignatures = new Set<string>(),
  styleReferences: OutfitStyleReference[] = [],
): OutfitSuggestion[] {
  const tops = garments.filter((item) => item.category === "tops");
  const onePieces = garments.filter((item) => item.category === "one_piece");
  const bottoms = garments.filter((item) => item.category === "bottoms");
  const layers = garments.filter((item) => item.category === "layers");
  const footwear = garments.filter((item) => item.category === "footwear" || isFootwear(item));
  const headwear = garments.filter((item) => item.category === "accessories" && isHeadwear(item));
  const accessories = garments.filter((item) => item.category === "accessories" && !isHeadwear(item) && !isFootwear(item));

  if (!onePieces.length && (!tops.length || !bottoms.length)) return [];

  const candidates: Array<OutfitSuggestion & { score: number }> = [];
  let combinationIndex = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      const baseScore = compatibilityScore(top.color, bottom.color);
      const compatibleLayers = layers
        .map((layer) => ({ layer, score: compatibilityScore(layer.color, top.color) + compatibilityScore(layer.color, bottom.color) }))
        .sort((a, b) => b.score - a.score || a.layer.name.localeCompare(b.layer.name));
      const layerChoices: Array<OutfitSuggestionGarment | undefined> = [undefined];
      if (compatibleLayers.length) layerChoices.push(compatibleLayers[combinationIndex % compatibleLayers.length].layer);

      for (const layer of layerChoices) {
        const selected = [top, ...(layer ? [layer] : []), bottom];
        const shoe = footwear.length ? footwear[combinationIndex % footwear.length] : undefined;
        const hat = headwear.length && combinationIndex % 2 === 0 ? headwear[combinationIndex % headwear.length] : undefined;
        const accessory = accessories.length && combinationIndex % 3 === 0 ? accessories[combinationIndex % accessories.length] : undefined;
        if (shoe) selected.push(shoe);
        if (hat) selected.push(hat);
        if (accessory) selected.push(accessory);

        const garmentIds = unique(selected.map((item) => item.id));
        const signature = signatureFor(garmentIds);
        if (!existingSignatures.has(signature)) {
          const occasion = occasionFor(selected, combinationIndex);
          const affinity = personalStyleAffinity(selected, styleReferences);
          candidates.push({
            name: paletteName(top, bottom, layer),
            occasion,
            rationale: rationaleFor(top, bottom, layer, shoe, occasion, affinity.matchedSource),
            garmentIds,
            signature,
            score: baseScore + (layer ? compatibilityScore(layer.color, top.color) : 1) + garmentIds.length / 10 + affinity.score,
          });
        }
        combinationIndex += 1;
      }
    }
  }

  for (const onePiece of onePieces) {
    const compatibleLayers = layers
      .map((layer) => ({ layer, score: compatibilityScore(layer.color, onePiece.color) }))
      .sort((a, b) => b.score - a.score || a.layer.name.localeCompare(b.layer.name));
    const layerChoices: Array<OutfitSuggestionGarment | undefined> = [undefined];
    if (compatibleLayers.length) layerChoices.push(compatibleLayers[combinationIndex % compatibleLayers.length].layer);

    for (const layer of layerChoices) {
      const selected = [onePiece, ...(layer ? [layer] : [])];
      const shoe = footwear.length ? footwear[combinationIndex % footwear.length] : undefined;
      const hat = headwear.length && combinationIndex % 2 === 0 ? headwear[combinationIndex % headwear.length] : undefined;
      const accessory = accessories.length ? accessories[combinationIndex % accessories.length] : undefined;
      if (shoe) selected.push(shoe);
      if (hat) selected.push(hat);
      if (accessory) selected.push(accessory);

      const garmentIds = unique(selected.map((item) => item.id));
      const signature = signatureFor(garmentIds);
      if (!existingSignatures.has(signature)) {
        const occasion = occasionFor(selected, combinationIndex);
        const affinity = personalStyleAffinity(selected, styleReferences);
        const pieces = [onePiece.name, layer?.name, shoe?.name, accessory?.name].filter(Boolean);
        candidates.push({
          name: `${capitalize(cleanColor(onePiece.color) || onePiece.type)} completo`,
          occasion,
          rationale: `${pieces.join(", ")}. La prenda completa crea una silueta limpia sin añadir pantalón.${affinity.matchedSource === "photo" ? " Retoma una fórmula que ya usaste en tus fotos." : affinity.matchedSource === "saved_look" ? " Sigue el estilo de los Looks que ya guardaste." : ""}`,
          garmentIds,
          signature,
          score: 6 + (layer ? compatibilityScore(layer.color, onePiece.color) : 1) + garmentIds.length / 10 + affinity.score,
        });
      }
      combinationIndex += 1;
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature))
    .slice(0, Math.max(1, Math.min(count, 6)))
    .map(({ score: _score, ...suggestion }) => suggestion);
}

export function signatureFor(garmentIds: string[]) {
  return [...garmentIds].sort().join("|");
}

function compatibilityScore(first: string | null, second: string | null) {
  const a = colorFamily(first);
  const b = colorFamily(second);
  if (a === "neutral" || b === "neutral") return 5;
  if (a === b) return 4;
  if ((a === "warm" && b === "earth") || (a === "earth" && b === "warm")) return 4;
  if ((a === "cool" && b === "earth") || (a === "earth" && b === "cool")) return 3;
  return 2;
}

function colorFamily(value: string | null) {
  const color = (value || "").toLowerCase();
  if (/negro|black|blanco|white|gris|gray|grey|crudo|crema|cream|marfil|navy|marino/u.test(color)) return "neutral";
  if (/café|cafe|brown|camel|arena|beige|khaki|caqui|oliva|olive|óxido|oxido/u.test(color)) return "earth";
  if (/azul|blue|verde|green|morado|purple|violet/u.test(color)) return "cool";
  if (/rojo|red|naranja|orange|amarillo|yellow|rosa|pink|magenta/u.test(color)) return "warm";
  return "neutral";
}

function paletteName(top: OutfitSuggestionGarment, bottom: OutfitSuggestionGarment, layer?: OutfitSuggestionGarment) {
  const first = cleanColor(layer?.color || top.color) || layer?.type || top.type;
  const second = cleanColor(bottom.color) || bottom.type;
  return `${capitalize(first)} & ${second.toLowerCase()}`;
}

function rationaleFor(
  top: OutfitSuggestionGarment,
  bottom: OutfitSuggestionGarment,
  layer: OutfitSuggestionGarment | undefined,
  shoe: OutfitSuggestionGarment | undefined,
  occasion: string,
  matchedSource?: OutfitStyleReference["source"],
) {
  const pieces = [top.name, layer?.name, bottom.name, shoe?.name].filter(Boolean);
  const personal = matchedSource === "photo"
    ? " Retoma una fórmula de color y capas que ya usaste en tus fotos."
    : matchedSource === "saved_look"
      ? " Sigue el estilo de los Looks que ya guardaste."
      : "";
  return `${pieces.join(", ")}. La paleta mantiene el conjunto equilibrado y fácil de usar para ${occasion.toLowerCase()}.${personal}`;
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
    const score = slotMatches * .35 + colorMatches * 1.05 + exactMatches * 1.8 + layeringMatches * .45;
    if (score > best.score) best = { score, matchedSource: reference.source };
  }
  return best;
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
  return occasions[index % occasions.length];
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

function unique(values: string[]) {
  return Array.from(new Set(values));
}
