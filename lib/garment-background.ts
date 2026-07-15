export type GarmentChroma = {
  name: string;
  rgb: [number, number, number];
};

export function chromaForGarment(color: string): GarmentChroma {
  const normalized = color.toLowerCase();
  if (/verde|green|oliva|olive|lima|lime/u.test(normalized)) {
    return { name: "electric magenta", rgb: [255, 0, 255] };
  }
  if (/magenta|fucsia|pink|rosa|morado|purple|violet/u.test(normalized)) {
    return { name: "electric cyan", rgb: [0, 255, 255] };
  }
  return { name: "electric green", rgb: [0, 255, 0] };
}
