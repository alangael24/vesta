import type {
  GarmentSlot,
  OccasionKind,
  OutfitCandidate,
  StyleDNA,
  StyleDirection,
  WardrobeItem,
  WeatherKind,
} from "./types";

export const GARMENT_FEATURE_DIMENSION = 32;
export const OUTFIT_FEATURE_DIMENSION = 24;

const slotOrder: GarmentSlot[] = ["head", "top", "outer", "one_piece", "bottom", "feet", "accessory"];
const colorFamilies = ["neutral", "earth", "warm", "cool", "jewel", "pastel"] as const;
export type ColorFamily = typeof colorFamilies[number];

export type ColorProfile = {
  family: ColorFamily;
  hue: number;
  saturation: number;
  lightness: number;
  warmth: number;
  isNeutral: boolean;
};

export type GarmentSemantics = {
  slot: GarmentSlot;
  color: ColorProfile;
  formality: number;
  warmth: number;
  texture: number;
  pattern: number;
  volume: number;
  sporty: number;
  feminine: number;
  masculine: number;
  statement: number;
  basic: number;
  material: {
    cotton: number;
    wool: number;
    denim: number;
    leather: number;
    synthetic: number;
    fluid: number;
  };
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function descriptorFor(item: WardrobeItem) {
  return [item.name, item.type, item.color, item.secondaryColor, item.material, item.description, ...(item.tags || [])]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

export function slotFor(item: WardrobeItem): GarmentSlot {
  const descriptor = descriptorFor(item);
  if (item.category === "one_piece" || /(vestido|dress|jumpsuit|enterizo|mono\b)/u.test(descriptor)) return "one_piece";
  if (item.category === "footwear" || /(zapato|tenis|sneaker|shoe|bota|boot|tacon|heel|sandalia|loafer|mocasin)/u.test(descriptor)) return "feet";
  if (item.category === "bottoms" || /(pantalon|pants|trouser|jean|falda|skirt|short|bermuda)/u.test(descriptor)) return "bottom";
  if (item.category === "layers" || /(abrigo|coat|chaqueta|jacket|blazer|cardigan|sobrecamisa|overshirt|parka|trench|chaleco|vest\b)/u.test(descriptor)) return "outer";
  if (item.category === "tops" || /(camisa|shirt|blusa|blouse|camiseta|tee|polo|jersey|sweater|top\b|sudadera|hoodie)/u.test(descriptor)) return "top";
  if (/(gorra|cap\b|sombrero|hat\b|beanie|bucket|boina)/u.test(descriptor)) return "head";
  return "accessory";
}

const namedColors: Array<{ pattern: RegExp; profile: ColorProfile }> = [
  { pattern: /(negro|black|carbon|charcoal|antracita)/u, profile: { family: "neutral", hue: 0, saturation: .05, lightness: .08, warmth: .5, isNeutral: true } },
  { pattern: /(blanco|white|marfil|ivory|crema|cream|crudo|off.?white)/u, profile: { family: "neutral", hue: .12, saturation: .08, lightness: .94, warmth: .58, isNeutral: true } },
  { pattern: /(gris|gray|grey|plata|silver)/u, profile: { family: "neutral", hue: .6, saturation: .04, lightness: .52, warmth: .45, isNeutral: true } },
  { pattern: /(marino|navy|azul oscuro|midnight)/u, profile: { family: "neutral", hue: .64, saturation: .48, lightness: .19, warmth: .28, isNeutral: true } },
  { pattern: /(beige|arena|sand|camel|caqui|khaki|taupe|avena|oat)/u, profile: { family: "earth", hue: .11, saturation: .34, lightness: .62, warmth: .78, isNeutral: false } },
  { pattern: /(marron|brown|cafe|chocolate|cacao|tan\b|cognac)/u, profile: { family: "earth", hue: .07, saturation: .48, lightness: .32, warmth: .86, isNeutral: false } },
  { pattern: /(oliva|olive|khaki green|verde militar|military green)/u, profile: { family: "earth", hue: .22, saturation: .38, lightness: .34, warmth: .62, isNeutral: false } },
  { pattern: /(oxido|rust|terracota|terracotta|cobre|copper)/u, profile: { family: "earth", hue: .04, saturation: .62, lightness: .43, warmth: .94, isNeutral: false } },
  { pattern: /(rojo|red|escarlata|scarlet|carmesi|crimson)/u, profile: { family: "warm", hue: 0, saturation: .75, lightness: .48, warmth: 1, isNeutral: false } },
  { pattern: /(naranja|orange|coral|mandarina|tangerine)/u, profile: { family: "warm", hue: .07, saturation: .78, lightness: .56, warmth: 1, isNeutral: false } },
  { pattern: /(amarillo|yellow|mostaza|mustard|oro|gold)/u, profile: { family: "warm", hue: .15, saturation: .72, lightness: .55, warmth: .9, isNeutral: false } },
  { pattern: /(rosa|pink|fucsia|fuchsia|magenta)/u, profile: { family: "warm", hue: .94, saturation: .7, lightness: .62, warmth: .82, isNeutral: false } },
  { pattern: /(azul|blue|celeste|sky|cobalto|cobalt|indigo)/u, profile: { family: "cool", hue: .62, saturation: .66, lightness: .47, warmth: .16, isNeutral: false } },
  { pattern: /(verde|green|esmeralda|emerald|menta|mint)/u, profile: { family: "cool", hue: .36, saturation: .54, lightness: .43, warmth: .24, isNeutral: false } },
  { pattern: /(morado|purple|violeta|violet|lila|lilac|lavanda|lavender)/u, profile: { family: "jewel", hue: .78, saturation: .57, lightness: .5, warmth: .38, isNeutral: false } },
  { pattern: /(borgona|burgundy|vino|wine|granate|maroon)/u, profile: { family: "jewel", hue: .97, saturation: .55, lightness: .28, warmth: .72, isNeutral: false } },
  { pattern: /(pastel|baby blue|palo de rosa|dusty|suave)/u, profile: { family: "pastel", hue: .58, saturation: .28, lightness: .76, warmth: .5, isNeutral: false } },
];

function hexColorProfile(value: string): ColorProfile | null {
  const match = value.match(/#([0-9a-f]{6})/iu);
  if (!match) return null;
  const red = Number.parseInt(match[1].slice(0, 2), 16) / 255;
  const green = Number.parseInt(match[1].slice(2, 4), 16) / 255;
  const blue = Number.parseInt(match[1].slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
    else if (max === green) hue = ((blue - red) / delta + 2) / 6;
    else hue = ((red - green) / delta + 4) / 6;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const warmth = clamp((Math.cos((hue - .08) * Math.PI * 2) + 1) / 2);
  const isNeutral = saturation < .12;
  let family: ColorFamily = "cool";
  if (isNeutral) family = "neutral";
  else if (hue < .12 || hue > .92) family = "warm";
  else if (hue < .24) family = "earth";
  else if (hue < .55) family = "cool";
  else if (hue < .72) family = "cool";
  else family = "jewel";
  if (lightness > .72 && saturation < .45) family = "pastel";
  return { family, hue, saturation, lightness, warmth, isNeutral };
}

export function colorProfileFor(value: string | null | undefined): ColorProfile {
  const normalized = (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
  const hex = hexColorProfile(normalized);
  if (hex) return hex;
  for (const entry of namedColors) {
    if (entry.pattern.test(normalized)) return entry.profile;
  }
  return { family: "neutral", hue: .1, saturation: .08, lightness: .52, warmth: .5, isNeutral: true };
}

function scorePattern(descriptor: string, positive: RegExp, negative?: RegExp, fallback = .35) {
  if (negative?.test(descriptor)) return .08;
  if (positive.test(descriptor)) return .84;
  return fallback;
}

export function semanticsFor(item: WardrobeItem): GarmentSemantics {
  const descriptor = descriptorFor(item);
  const slot = slotFor(item);
  const color = colorProfileFor(`${item.color || ""} ${item.secondaryColor || ""}`);
  let formality = .38;
  if (/(blazer|traje|suit|formal|sastre|tailored|oxford|vestir|dress shirt|tacon|heel|loafer|mocasin|gabardina|trench)/u.test(descriptor)) formality = .86;
  if (/(hoodie|sudadera|sport|deport|gym|jogger|cargo|tenis|sneaker|short|tee|camiseta)/u.test(descriptor)) formality = .18;
  if (/(polo|chino|cardigan|jersey|sweater|chaqueta|jacket|falda|skirt)/u.test(descriptor)) formality = Math.max(formality, .55);

  let warmth = .35;
  if (/(lana|wool|cashmere|merino|abrigo|coat|parka|puffer|acolchado|fleece|polar|tweed|franela|flannel)/u.test(descriptor)) warmth = .92;
  if (/(lino|linen|seda|silk|tirantes|tank|short|sandalia|mesh|malla)/u.test(descriptor)) warmth = .12;
  if (slot === "outer") warmth = Math.max(warmth, .64);

  const texture = scorePattern(descriptor, /(tejido|knit|punto|tweed|denim|cuero|leather|pana|corduroy|boucle|fleece|terciopelo|velvet|crochet)/u, /(liso|smooth|plain)/u, .3);
  const pattern = scorePattern(descriptor, /(rayas|striped|cuadros|plaid|print|estampado|floral|animal|logo|grafico|graphic|polka|dots)/u, /(liso|plain|solid)/u, .18);
  const volume = scorePattern(descriptor, /(oversize|oversized|wide|ancho|baggy|puffer|volumen|boxy|acampanado|flare)/u, /(slim|skinny|fitted|entallado|ajustado)/u, .46);
  const sporty = scorePattern(descriptor, /(sport|deport|gym|running|tenis|sneaker|hoodie|sudadera|jogger|track|jersey deportivo)/u, /(formal|sastre|tailored)/u, .2);
  const feminine = scorePattern(descriptor, /(vestido|dress|falda|skirt|blusa|blouse|tacon|heel|encaje|lace|satin|saten|floral)/u, undefined, .36);
  const masculine = scorePattern(descriptor, /(traje|suit|oxford|field jacket|cargo|workwear|mocasin|loafer|polo|corbata|tie)/u, undefined, .36);
  let statement = scorePattern(descriptor, /(bold|atrevido|statement|metallic|metalico|neon|brillo|sequin|lentejuela|graphic|estampado|animal|fucsia|magenta)/u, /(basico|basic|minimal|liso|plain)/u, .24);
  if (color.family === "warm" || color.family === "jewel") statement += .12 * color.saturation;
  const basic = item.isBasic ? .94 : scorePattern(descriptor, /(basico|basic|essential|esencial|plain|liso|camiseta blanca|camiseta negra|jean azul|chino)/u, /(statement|bold|estampado|graphic)/u, .42);

  const material = {
    cotton: /(algodon|cotton|poplin|popelina|pique)/u.test(descriptor) ? 1 : .08,
    wool: /(lana|wool|cashmere|merino|tweed)/u.test(descriptor) ? 1 : .04,
    denim: /(denim|mezclilla|jean)/u.test(descriptor) ? 1 : .03,
    leather: /(cuero|leather|gamuza|suede)/u.test(descriptor) ? 1 : .03,
    synthetic: /(polyester|poliester|nylon|acrylic|acrilico|elastane|elastano|technical|tecnico)/u.test(descriptor) ? 1 : .12,
    fluid: /(seda|silk|satin|saten|viscosa|rayon|chiffon|gasa|lino|linen)/u.test(descriptor) ? 1 : .08,
  };

  return {
    slot,
    color,
    formality: clamp(formality),
    warmth: clamp(warmth),
    texture: clamp(texture),
    pattern: clamp(pattern),
    volume: clamp(volume),
    sporty: clamp(sporty),
    feminine: clamp(feminine),
    masculine: clamp(masculine),
    statement: clamp(statement),
    basic: clamp(basic),
    material,
  };
}

export function garmentFeatureVector(item: WardrobeItem) {
  const semantics = semanticsFor(item);
  const vector = new Array<number>(GARMENT_FEATURE_DIMENSION).fill(0);
  vector[slotOrder.indexOf(semantics.slot)] = 1;
  vector[7 + colorFamilies.indexOf(semantics.color.family)] = 1;
  vector[13] = semantics.color.lightness < .32 ? 1 : 0;
  vector[14] = semantics.color.lightness >= .32 && semantics.color.lightness <= .7 ? 1 : 0;
  vector[15] = semantics.color.lightness > .7 ? 1 : 0;
  vector[16] = semantics.formality;
  vector[17] = semantics.warmth;
  vector[18] = semantics.texture;
  vector[19] = semantics.pattern;
  vector[20] = semantics.volume;
  vector[21] = semantics.sporty;
  vector[22] = semantics.feminine;
  vector[23] = semantics.masculine;
  vector[24] = semantics.statement;
  vector[25] = semantics.basic;
  vector[26] = semantics.material.cotton;
  vector[27] = semantics.material.wool;
  vector[28] = semantics.material.denim;
  vector[29] = semantics.material.leather;
  vector[30] = semantics.material.synthetic;
  vector[31] = semantics.material.fluid;
  return vector;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function circularHueDistance(first: number, second: number) {
  const delta = Math.abs(first - second);
  return Math.min(delta, 1 - delta);
}

export function colorHarmony(first: ColorProfile, second: ColorProfile) {
  if (first.isNeutral || second.isNeutral) return .88;
  const distance = circularHueDistance(first.hue, second.hue);
  const analogous = 1 - Math.min(1, distance / .18);
  const complementary = 1 - Math.min(1, Math.abs(distance - .5) / .18);
  const triadic = 1 - Math.min(1, Math.abs(distance - .333) / .14);
  const family = first.family === second.family ? .8 : 0;
  return clamp(Math.max(analogous * .86, complementary * .9, triadic * .78, family));
}

export function contextFitFor(item: WardrobeItem, weather: WeatherKind, occasion: OccasionKind, direction: StyleDirection) {
  const semantics = semanticsFor(item);
  const weatherTarget = weather === "hot" ? .1 : weather === "mild" ? .42 : weather === "cold" ? .82 : .68;
  let weatherFit = 1 - Math.abs(semantics.warmth - weatherTarget);
  if (weather === "rain" && /(cuero|leather|nylon|technical|tecnico|parka|trench|bota|boot)/u.test(descriptorFor(item))) weatherFit += .16;

  const occasionTarget = occasion === "event" ? .88 : occasion === "work" ? .72 : occasion === "date" ? .65 : occasion === "travel" ? .35 : occasion === "weekend" ? .28 : .38;
  const occasionFit = 1 - Math.abs(semantics.formality - occasionTarget);

  const directionFit = direction === "minimal"
    ? semantics.basic * .55 + (1 - semantics.pattern) * .25 + (1 - semantics.statement) * .2
    : direction === "relaxed"
      ? (1 - semantics.formality) * .35 + semantics.volume * .25 + semantics.sporty * .2 + semantics.texture * .2
      : direction === "polished"
        ? semantics.formality * .55 + (1 - semantics.sporty) * .2 + (1 - semantics.volume * .35) * .25
        : semantics.statement * .55 + semantics.pattern * .2 + semantics.texture * .15 + semantics.color.saturation * .1;

  return clamp(weatherFit * .38 + occasionFit * .36 + directionFit * .26);
}

export function outfitFeatureVector(garments: WardrobeItem[]) {
  const semantics = garments.map(semanticsFor);
  const vector = new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(0);
  if (!semantics.length) return vector;
  vector[0] = average(semantics.map((entry) => entry.formality));
  vector[1] = average(semantics.map((entry) => entry.warmth));
  vector[2] = average(semantics.map((entry) => entry.texture));
  vector[3] = average(semantics.map((entry) => entry.pattern));
  vector[4] = average(semantics.map((entry) => entry.volume));
  vector[5] = average(semantics.map((entry) => entry.sporty));
  vector[6] = average(semantics.map((entry) => entry.statement));
  vector[7] = average(semantics.map((entry) => entry.basic));
  for (let index = 0; index < colorFamilies.length; index += 1) {
    vector[8 + index] = semantics.filter((entry) => entry.color.family === colorFamilies[index]).length / semantics.length;
  }
  const hueDistances: number[] = [];
  const harmonies: number[] = [];
  for (let first = 0; first < semantics.length; first += 1) {
    for (let second = first + 1; second < semantics.length; second += 1) {
      hueDistances.push(circularHueDistance(semantics[first].color.hue, semantics[second].color.hue));
      harmonies.push(colorHarmony(semantics[first].color, semantics[second].color));
    }
  }
  vector[14] = harmonies.length ? average(harmonies) : .7;
  vector[15] = hueDistances.length ? average(hueDistances) : 0;
  vector[16] = semantics.some((entry) => entry.slot === "outer") ? 1 : 0;
  vector[17] = semantics.some((entry) => entry.slot === "feet") ? 1 : 0;
  vector[18] = semantics.filter((entry) => entry.slot === "accessory" || entry.slot === "head").length / Math.max(1, semantics.length);
  vector[19] = semantics.some((entry) => entry.slot === "one_piece") ? 1 : 0;
  vector[20] = new Set(semantics.map((entry) => entry.color.family)).size / colorFamilies.length;
  vector[21] = average(garments.map((item) => clamp((item.confidence ?? 85) / 100)));
  vector[22] = garments.filter((item) => item.sourceType === "internet").length / garments.length;
  vector[23] = garments.length / 6;
  return vector;
}

export function styleDNAFromVectors(vectors: number[][]): StyleDNA {
  const averageVector = new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(0);
  if (vectors.length) {
    for (const vector of vectors) {
      for (let index = 0; index < averageVector.length; index += 1) averageVector[index] += vector[index] || 0;
    }
    for (let index = 0; index < averageVector.length; index += 1) averageVector[index] /= vectors.length;
  }
  return {
    minimal: clamp(averageVector[7] * .55 + averageVector[8] * .25 + (1 - averageVector[3]) * .2),
    relaxed: clamp((1 - averageVector[0]) * .4 + averageVector[4] * .2 + averageVector[5] * .4),
    polished: clamp(averageVector[0] * .7 + (1 - averageVector[5]) * .3),
    bold: clamp(averageVector[6] * .55 + averageVector[3] * .2 + averageVector[20] * .25),
    warm: clamp(averageVector[9] * .55 + averageVector[10] * .45),
    cool: clamp(averageVector[11] * .65 + averageVector[12] * .35),
    tonal: clamp(1 - averageVector[15] * 2),
    layered: clamp(averageVector[16]),
  };
}

export function candidateFeatureVector(candidate: Pick<OutfitCandidate, "garments">) {
  return outfitFeatureVector(candidate.garments);
}

export function readableColorFamily(item: WardrobeItem) {
  const family = colorProfileFor(`${item.color || ""} ${item.secondaryColor || ""}`).family;
  if (family === "neutral") return "neutros";
  if (family === "earth") return "tierras";
  if (family === "warm") return "cálidos";
  if (family === "cool") return "fríos";
  if (family === "jewel") return "joya";
  return "pastel";
}
