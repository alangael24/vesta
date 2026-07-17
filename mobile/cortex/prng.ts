export type RandomSource = () => number;

export function hashString(value: string) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seed: string | number): RandomSource {
  let state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random: RandomSource, min: number, maxExclusive: number) {
  return Math.floor(random() * Math.max(0, maxExclusive - min)) + min;
}

export function randomNormal(random: RandomSource) {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

export function shuffle<T>(values: T[], random: RandomSource) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(random, 0, index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function weightedChoice<T>(values: T[], weights: number[], random: RandomSource) {
  if (!values.length || values.length !== weights.length) return undefined;
  const normalized = weights.map((weight) => Math.max(0, Number.isFinite(weight) ? weight : 0));
  const total = normalized.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return values[randomInt(random, 0, values.length)];
  let target = random() * total;
  for (let index = 0; index < values.length; index += 1) {
    target -= normalized[index];
    if (target <= 0) return values[index];
  }
  return values[values.length - 1];
}
