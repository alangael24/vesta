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

const occasions = ["Diario", "Fin de semana", "Cena casual", "Trabajo flexible"];

export function suggestOutfits(
  garments: OutfitSuggestionGarment[],
  count = 3,
  existingSignatures = new Set<string>(),
): OutfitSuggestion[] {
  const tops = garments.filter((item) => item.category === "tops" || item.category === "one_piece");
  const bottoms = garments.filter((item) => item.category === "bottoms");
  const layers = garments.filter((item) => item.category === "layers");
  const footwear = garments.filter((item) => item.category === "footwear" || isFootwear(item));
  const headwear = garments.filter((item) => item.category === "accessories" && isHeadwear(item));
  const accessories = garments.filter((item) => item.category === "accessories" && !isHeadwear(item) && !isFootwear(item));

  if (!tops.length || !bottoms.length) return [];

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
          candidates.push({
            name: paletteName(top, bottom, layer),
            occasion,
            rationale: rationaleFor(top, bottom, layer, shoe, occasion),
            garmentIds,
            signature,
            score: baseScore + (layer ? compatibilityScore(layer.color, top.color) : 1) + garmentIds.length / 10,
          });
        }
        combinationIndex += 1;
      }
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
) {
  const pieces = [top.name, layer?.name, bottom.name, shoe?.name].filter(Boolean);
  return `${pieces.join(", ")}. La paleta mantiene el conjunto equilibrado y fácil de usar para ${occasion.toLowerCase()}.`;
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
