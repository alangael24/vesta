import { readableColorFamily, slotFor } from "./features";
import { rotationScore } from "./learner";
import { createRandom, randomInt } from "./prng";
import { generateOutfitCandidates } from "./search";
import type {
  DayBrief,
  Outfit,
  OutfitCandidate,
  PlanMode,
  PlannedDay,
  StyleProfile,
  WardrobeItem,
  WeekPlan,
  WeekPlanStats,
} from "./types";

export type PlanProgress = {
  phase: "candidates" | "optimizing";
  completed: number;
  total: number;
  mode?: PlanMode;
  label: string;
};

export type PlanWeekOptions = {
  seed?: string | number;
  candidatesPerDay?: number;
  iterations?: number;
  beamWidth?: number;
  modes?: PlanMode[];
  lockedCandidates?: Record<string, OutfitCandidate>;
  existingOutfits?: Outfit[];
  now?: Date;
  yieldEvery?: number;
  onProgress?: (progress: PlanProgress) => void;
  shouldCancel?: () => boolean;
};

type PlanState = OutfitCandidate[];

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function garmentIds(candidate: OutfitCandidate) {
  return candidate.garmentIds;
}

function coreGarmentIds(candidate: OutfitCandidate) {
  return candidate.garments
    .filter((item) => ["top", "bottom", "one_piece"].includes(slotFor(item)))
    .map((item) => String(item.id));
}

function jaccard(first: string[], second: string[]) {
  const a = new Set(first);
  const b = new Set(second);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function modeWeights(mode: PlanMode) {
  if (mode === "expressive") return { daily: .58, diversity: .24, rotation: .08, cohesion: .1 };
  if (mode === "rotation") return { daily: .48, diversity: .16, rotation: .28, cohesion: .08 };
  return { daily: .62, diversity: .16, rotation: .12, cohesion: .1 };
}

function repeatedCorePenalty(state: PlanState) {
  let penalty = 0;
  for (let first = 0; first < state.length; first += 1) {
    const firstCore = coreGarmentIds(state[first]);
    for (let second = first + 1; second < state.length; second += 1) {
      const distance = second - first;
      const overlap = jaccard(firstCore, coreGarmentIds(state[second]));
      if (!overlap) continue;
      penalty += overlap * (distance === 1 ? .38 : distance === 2 ? .22 : .08);
    }
  }
  return penalty / Math.max(1, state.length);
}

function visualDiversity(state: PlanState) {
  if (state.length < 2) return 1;
  const pairScores: number[] = [];
  for (let first = 0; first < state.length; first += 1) {
    for (let second = first + 1; second < state.length; second += 1) {
      const overlap = jaccard(garmentIds(state[first]), garmentIds(state[second]));
      const paletteFirst = new Set(state[first].garments.map(readableColorFamily));
      const paletteSecond = new Set(state[second].garments.map(readableColorFamily));
      let paletteOverlap = 0;
      for (const value of paletteFirst) if (paletteSecond.has(value)) paletteOverlap += 1;
      const paletteUnion = new Set([...paletteFirst, ...paletteSecond]).size || 1;
      pairScores.push(clamp(1 - overlap * .65 - paletteOverlap / paletteUnion * .12));
    }
  }
  return pairScores.reduce((sum, value) => sum + value, 0) / pairScores.length;
}

function weekCohesion(state: PlanState) {
  const counts = new Map<string, number>();
  for (const candidate of state) for (const item of candidate.garments) counts.set(readableColorFamily(item), (counts.get(readableColorFamily(item)) || 0) + 1);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const dominantShare = Math.max(0, ...counts.values()) / total;
  const familyCount = counts.size;
  return clamp((1 - Math.abs(dominantShare - .38)) * .65 + (familyCount >= 3 && familyCount <= 5 ? .35 : .18));
}

function weekRotation(state: PlanState, profile: StyleProfile, now: Date) {
  const unique = [...new Set(state.flatMap((candidate) => candidate.garmentIds))];
  return rotationScore(profile, unique, now);
}

export function scoreWeek(state: PlanState, mode: PlanMode, profile: StyleProfile, now = new Date()) {
  if (!state.length) return -Infinity;
  const weights = modeWeights(mode);
  const daily = state.reduce((sum, candidate) => sum + candidate.score.total, 0) / state.length;
  const diversity = visualDiversity(state);
  const rotation = weekRotation(state, profile, now);
  const cohesion = weekCohesion(state);
  const repeatPenalty = repeatedCorePenalty(state);
  return daily * weights.daily + diversity * weights.diversity + rotation * weights.rotation + cohesion * weights.cohesion - repeatPenalty;
}

function initialState(candidateSets: OutfitCandidate[][], briefs: DayBrief[], locked: Record<string, OutfitCandidate>, mode: PlanMode, profile: StyleProfile, now: Date) {
  const state: OutfitCandidate[] = [];
  for (let index = 0; index < candidateSets.length; index += 1) {
    const lockedCandidate = locked[briefs[index].date];
    if (lockedCandidate) {
      state.push(lockedCandidate);
      continue;
    }
    const candidates = candidateSets[index];
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const next = [...state, candidate];
      const score = scoreWeek(next, mode, profile, now);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) state.push(best);
  }
  return state;
}

function optimizeState(
  initial: PlanState,
  candidateSets: OutfitCandidate[][],
  briefs: DayBrief[],
  locked: Record<string, OutfitCandidate>,
  mode: PlanMode,
  profile: StyleProfile,
  seed: string,
  iterations: number,
  now: Date,
) {
  const random = createRandom(seed);
  let current = [...initial];
  let currentScore = scoreWeek(current, mode, profile, now);
  let best = [...current];
  let bestScore = currentScore;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const temperature = Math.max(.012, .28 * (1 - iteration / iterations));
    const mutable = briefs.map((brief, index) => locked[brief.date] ? -1 : index).filter((index) => index >= 0);
    if (!mutable.length) break;
    const dayIndex = mutable[randomInt(random, 0, mutable.length)];
    const choices = candidateSets[dayIndex];
    if (choices.length < 2) continue;
    const replacement = choices[randomInt(random, 0, choices.length)];
    if (replacement.signature === current[dayIndex]?.signature) continue;
    const next = [...current];
    next[dayIndex] = replacement;
    const nextScore = scoreWeek(next, mode, profile, now);
    const delta = nextScore - currentScore;
    if (delta >= 0 || random() < Math.exp(delta / temperature)) {
      current = next;
      currentScore = nextScore;
      if (currentScore > bestScore) {
        best = [...current];
        bestScore = currentScore;
      }
    }
  }
  return { state: best, score: bestScore };
}

async function optimizeStateAsync(
  initial: PlanState,
  candidateSets: OutfitCandidate[][],
  briefs: DayBrief[],
  locked: Record<string, OutfitCandidate>,
  mode: PlanMode,
  profile: StyleProfile,
  seed: string,
  iterations: number,
  now: Date,
  options: Pick<PlanWeekOptions, "yieldEvery" | "onProgress" | "shouldCancel">,
) {
  const random = createRandom(seed);
  let current = [...initial];
  let currentScore = scoreWeek(current, mode, profile, now);
  let best = [...current];
  let bestScore = currentScore;
  const mutable = briefs.map((brief, index) => locked[brief.date] ? -1 : index).filter((index) => index >= 0);
  const yieldEvery = Math.max(20, options.yieldEvery ?? 90);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (options.shouldCancel?.()) return null;
    if (!mutable.length) break;
    const temperature = Math.max(.012, .28 * (1 - iteration / iterations));
    const dayIndex = mutable[randomInt(random, 0, mutable.length)];
    const choices = candidateSets[dayIndex];
    if (choices.length >= 2) {
      const replacement = choices[randomInt(random, 0, choices.length)];
      if (replacement.signature !== current[dayIndex]?.signature) {
        const next = [...current];
        next[dayIndex] = replacement;
        const nextScore = scoreWeek(next, mode, profile, now);
        const delta = nextScore - currentScore;
        if (delta >= 0 || random() < Math.exp(delta / temperature)) {
          current = next;
          currentScore = nextScore;
          if (currentScore > bestScore) {
            best = [...current];
            bestScore = currentScore;
          }
        }
      }
    }
    if ((iteration + 1) % yieldEvery === 0 || iteration + 1 === iterations) {
      options.onProgress?.({
        phase: "optimizing",
        completed: iteration + 1,
        total: iterations,
        mode,
        label: `Optimizando ${mode === "balanced" ? "equilibrio" : mode === "expressive" ? "expresión" : "rotación"} · ${Math.round((iteration + 1) / iterations * 100)}%`,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { state: best, score: bestScore };
}

function statsFor(state: PlanState, profile: StyleProfile): WeekPlanStats {
  const all = state.flatMap((candidate) => candidate.garmentIds);
  const unique = new Set(all);
  const coreCounts = new Map<string, number>();
  for (const candidate of state) for (const id of coreGarmentIds(candidate)) coreCounts.set(id, (coreCounts.get(id) || 0) + 1);
  const repeatedCorePieces = [...coreCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const underusedGarmentsRecovered = [...unique].filter((id) => (profile.wornGarmentCounts[id] || 0) <= 1).length;
  const colorFamilies = new Set(state.flatMap((candidate) => candidate.garments.map(readableColorFamily))).size;
  const renderedDays = state.filter((candidate) => candidate.garments.length > 0).length;
  return {
    score: 0,
    uniqueGarments: unique.size,
    repeatedCorePieces,
    underusedGarmentsRecovered,
    colorFamilies,
    renderedDays,
  };
}

function explanationFor(mode: PlanMode, stats: WeekPlanStats) {
  const modeCopy = mode === "expressive"
    ? "prioriza contraste, variedad y momentos visuales distintos"
    : mode === "rotation"
      ? "rescata prendas menos usadas y distribuye mejor el desgaste"
      : "equilibra contexto, coherencia y variedad";
  return `Este plan ${modeCopy}. Usa ${stats.uniqueGarments} prendas únicas, recupera ${stats.underusedGarmentsRecovered} piezas con poca rotación y limita las repeticiones centrales a ${stats.repeatedCorePieces}.`;
}

export function planWeek(
  wardrobe: WardrobeItem[],
  briefs: DayBrief[],
  profile: StyleProfile,
  options: PlanWeekOptions = {},
) {
  const now = options.now || new Date();
  const seed = String(options.seed ?? briefs.map((brief) => brief.date).join("|"));
  const existingSignatures = (options.existingOutfits || []).map((outfit) => outfit.pieces.map((item) => String(item.id)).sort().join("|"));
  const candidateSets = briefs.map((brief, index) => generateOutfitCandidates(wardrobe, brief, profile, {
    count: options.candidatesPerDay ?? 18,
    beamWidth: options.beamWidth ?? 120,
    seed: `${seed}:day:${index}`,
    existingSignatures,
    now,
    includeAlternatives: false,
  }));
  if (candidateSets.some((set) => !set.length)) return [];
  const locked = options.lockedCandidates || {};
  const modes = options.modes || ["balanced", "expressive", "rotation"];
  const plans: WeekPlan[] = [];
  for (const mode of modes) {
    const initial = initialState(candidateSets, briefs, locked, mode, profile, now);
    const optimized = optimizeState(initial, candidateSets, briefs, locked, mode, profile, `${seed}:${mode}`, options.iterations ?? 2600, now);
    const stats = statsFor(optimized.state, profile);
    stats.score = optimized.score;
    plans.push({
      id: `week-${mode}-${briefs[0]?.date || "plan"}`,
      createdAt: now.toISOString(),
      mode,
      days: optimized.state.map((candidate, index): PlannedDay => ({
        brief: briefs[index],
        candidate,
        locked: Boolean(locked[briefs[index].date] || briefs[index].locked),
      })),
      score: optimized.score,
      stats,
      explanation: explanationFor(mode, stats),
    });
  }
  return plans.sort((a, b) => b.score - a.score);
}

export async function planWeekAsync(
  wardrobe: WardrobeItem[],
  briefs: DayBrief[],
  profile: StyleProfile,
  options: PlanWeekOptions = {},
) {
  const now = options.now || new Date();
  const seed = String(options.seed ?? briefs.map((brief) => brief.date).join("|"));
  const existingSignatures = (options.existingOutfits || []).map((outfit) => outfit.pieces.map((item) => String(item.id)).sort().join("|"));
  const candidateSets: OutfitCandidate[][] = [];
  for (let index = 0; index < briefs.length; index += 1) {
    if (options.shouldCancel?.()) return [];
    candidateSets.push(generateOutfitCandidates(wardrobe, briefs[index], profile, {
      count: options.candidatesPerDay ?? 14,
      beamWidth: options.beamWidth ?? 84,
      seed: `${seed}:day:${index}`,
      existingSignatures,
      now,
      includeAlternatives: false,
    }));
    options.onProgress?.({
      phase: "candidates",
      completed: index + 1,
      total: briefs.length,
      label: `Explorando día ${index + 1} de ${briefs.length}`,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (candidateSets.some((set) => !set.length) || options.shouldCancel?.()) return [];
  const locked = options.lockedCandidates || {};
  const modes = options.modes || ["balanced", "expressive", "rotation"];
  const iterations = options.iterations ?? 1800;
  const plans: WeekPlan[] = [];
  for (const mode of modes) {
    if (options.shouldCancel?.()) return [];
    const initial = initialState(candidateSets, briefs, locked, mode, profile, now);
    const optimized = await optimizeStateAsync(initial, candidateSets, briefs, locked, mode, profile, `${seed}:${mode}`, iterations, now, options);
    if (!optimized) return [];
    const stats = statsFor(optimized.state, profile);
    stats.score = optimized.score;
    plans.push({
      id: `week-${mode}-${briefs[0]?.date || "plan"}`,
      createdAt: now.toISOString(),
      mode,
      days: optimized.state.map((candidate, index): PlannedDay => ({
        brief: briefs[index],
        candidate,
        locked: Boolean(locked[briefs[index].date] || briefs[index].locked),
      })),
      score: optimized.score,
      stats,
      explanation: explanationFor(mode, stats),
    });
  }
  return plans.sort((a, b) => b.score - a.score);
}

export function regeneratePlanDay(
  plan: WeekPlan,
  dayIndex: number,
  wardrobe: WardrobeItem[],
  profile: StyleProfile,
  seed: string | number = Date.now(),
) {
  if (!plan.days[dayIndex] || plan.days[dayIndex].locked) return plan;
  const currentSignatures = new Set(plan.days.map((day) => day.candidate.signature));
  const candidates = generateOutfitCandidates(wardrobe, plan.days[dayIndex].brief, profile, {
    count: 24,
    seed: `${seed}:${dayIndex}`,
    existingSignatures: currentSignatures,
    includeAlternatives: false,
  });
  if (!candidates.length) return plan;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const state = plan.days.map((day, index) => index === dayIndex ? candidate : day.candidate);
    const score = scoreWeek(state, plan.mode, profile);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const days = plan.days.map((day, index) => index === dayIndex ? { ...day, candidate: best, outfitId: null, renderPath: null, localRenderUri: null, renderJobId: null } : day);
  const stats = statsFor(days.map((day) => day.candidate), profile);
  stats.score = bestScore;
  return { ...plan, days, score: bestScore, stats, explanation: explanationFor(plan.mode, stats) };
}

export function togglePlanDayLock(plan: WeekPlan, dayIndex: number) {
  if (!plan.days[dayIndex]) return plan;
  return {
    ...plan,
    days: plan.days.map((day, index) => index === dayIndex ? { ...day, locked: !day.locked } : day),
  };
}
