import { OUTFIT_FEATURE_DIMENSION } from "./features";
import { createRandom, randomNormal } from "./prng";
import type { OutfitCandidate, StyleFeedback, StyleProfile } from "./types";

const rewardByKind = {
  like: 1,
  dislike: -1,
  save: .7,
  wear: 1.45,
  skip: -.45,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createStyleProfile(now = new Date().toISOString()): StyleProfile {
  return {
    version: 1,
    weights: new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(0),
    precision: new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(1),
    actionCount: 0,
    wornGarmentCounts: {},
    lastWornAt: {},
    savedSignatures: [],
    rejectedSignatures: [],
    updatedAt: now,
  };
}

export function normalizeStyleProfile(value: Partial<StyleProfile> | null | undefined) {
  const fallback = createStyleProfile();
  if (!value || value.version !== 1) return fallback;
  return {
    ...fallback,
    ...value,
    weights: new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(0).map((_, index) => Number(value.weights?.[index] || 0)),
    precision: new Array<number>(OUTFIT_FEATURE_DIMENSION).fill(1).map((_, index) => Math.max(.1, Number(value.precision?.[index] || 1))),
    wornGarmentCounts: { ...(value.wornGarmentCounts || {}) },
    lastWornAt: { ...(value.lastWornAt || {}) },
    savedSignatures: [...new Set(value.savedSignatures || [])].slice(-800),
    rejectedSignatures: [...new Set(value.rejectedSignatures || [])].slice(-800),
  } satisfies StyleProfile;
}

function dot(first: number[], second: number[]) {
  let result = 0;
  const size = Math.max(first.length, second.length);
  for (let index = 0; index < size; index += 1) result += (first[index] || 0) * (second[index] || 0);
  return result;
}

export function preferenceScore(profile: StyleProfile, features: number[]) {
  return Math.tanh(dot(profile.weights, features) / Math.max(1, Math.sqrt(features.length)));
}

export function preferenceUncertainty(profile: StyleProfile, features: number[]) {
  let variance = 0;
  for (let index = 0; index < OUTFIT_FEATURE_DIMENSION; index += 1) {
    const feature = features[index] || 0;
    variance += feature * feature / Math.max(.1, profile.precision[index] || 1);
  }
  return Math.sqrt(variance) / Math.max(1, Math.sqrt(features.length));
}

export function sampledPreferenceScore(profile: StyleProfile, features: number[], seed: string | number) {
  const random = createRandom(seed);
  const sampledWeights = profile.weights.map((weight, index) => {
    const standardDeviation = 1 / Math.sqrt(Math.max(.1, profile.precision[index] || 1));
    return weight + randomNormal(random) * standardDeviation * .32;
  });
  return Math.tanh(dot(sampledWeights, features) / Math.max(1, Math.sqrt(features.length)));
}

function appendUnique(values: string[], value: string, limit = 800) {
  return [...values.filter((entry) => entry !== value), value].slice(-limit);
}

export function updateStyleProfile(profile: StyleProfile, feedback: StyleFeedback) {
  const current = normalizeStyleProfile(profile);
  const reward = rewardByKind[feedback.kind];
  const features = feedback.candidate.features;
  const prediction = preferenceScore(current, features);
  const error = reward - prediction;
  const actionScale = 1 / Math.sqrt(1 + current.actionCount * .035);
  const learningRate = .42 * actionScale;
  const regularization = .004;
  const weights = current.weights.map((weight, index) => {
    const feature = features[index] || 0;
    const adaptive = learningRate / Math.sqrt(current.precision[index] || 1);
    return clamp(weight + adaptive * error * feature - regularization * weight, -4, 4);
  });
  const precision = current.precision.map((value, index) => {
    const feature = features[index] || 0;
    return clamp(value + feature * feature * (.35 + Math.abs(reward) * .25), .1, 400);
  });
  const wornGarmentCounts = { ...current.wornGarmentCounts };
  const lastWornAt = { ...current.lastWornAt };
  if (feedback.kind === "wear") {
    for (const garmentId of feedback.candidate.garmentIds) {
      wornGarmentCounts[garmentId] = (wornGarmentCounts[garmentId] || 0) + 1;
      lastWornAt[garmentId] = feedback.at;
    }
  }
  let savedSignatures = current.savedSignatures;
  let rejectedSignatures = current.rejectedSignatures;
  if (feedback.kind === "save" || feedback.kind === "like" || feedback.kind === "wear") {
    savedSignatures = appendUnique(savedSignatures, feedback.candidate.signature);
    rejectedSignatures = rejectedSignatures.filter((signature) => signature !== feedback.candidate.signature);
  }
  if (feedback.kind === "dislike" || feedback.kind === "skip") {
    rejectedSignatures = appendUnique(rejectedSignatures, feedback.candidate.signature);
    savedSignatures = savedSignatures.filter((signature) => signature !== feedback.candidate.signature);
  }
  return {
    ...current,
    weights,
    precision,
    actionCount: current.actionCount + 1,
    wornGarmentCounts,
    lastWornAt,
    savedSignatures,
    rejectedSignatures,
    updatedAt: feedback.at,
  } satisfies StyleProfile;
}

export function rotationScore(profile: StyleProfile, garmentIds: string[], now = new Date()) {
  if (!garmentIds.length) return 0;
  const scores = garmentIds.map((garmentId) => {
    const count = profile.wornGarmentCounts[garmentId] || 0;
    const last = profile.lastWornAt[garmentId] ? new Date(profile.lastWornAt[garmentId]).getTime() : 0;
    const days = last ? Math.max(0, (now.getTime() - last) / 86_400_000) : 60;
    const freshness = Math.min(1, days / 18);
    const underuse = 1 / Math.sqrt(1 + count);
    return freshness * .6 + underuse * .4;
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function profileCandidate(candidate: OutfitCandidate, profile: StyleProfile, seed: string) {
  const personal = preferenceScore(profile, candidate.features);
  const uncertainty = preferenceUncertainty(profile, candidate.features);
  const exploration = sampledPreferenceScore(profile, candidate.features, seed);
  return {
    personal,
    uncertainty,
    exploration,
    combined: personal * .72 + exploration * .28 + uncertainty * .08,
  };
}
