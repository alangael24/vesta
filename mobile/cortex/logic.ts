import { outfitFeatureVector } from "./features";
import type {
  DayBrief,
  NativeSnapshot,
  OccasionKind,
  Outfit,
  OutfitCandidate,
  PlannedDay,
  RenderJob,
  StyleDirection,
  WeatherKind,
  WeekPlan,
} from "./types";

export const occasionOptions: Array<{ id: OccasionKind; label: string }> = [
  { id: "daily", label: "Diario" },
  { id: "work", label: "Trabajo" },
  { id: "date", label: "Cita" },
  { id: "event", label: "Evento" },
  { id: "travel", label: "Viaje" },
  { id: "weekend", label: "Fin de semana" },
];

export const weatherOptions: Array<{ id: WeatherKind; label: string; icon: string }> = [
  { id: "hot", label: "Calor", icon: "☀" },
  { id: "mild", label: "Templado", icon: "◐" },
  { id: "cold", label: "Frío", icon: "❄" },
  { id: "rain", label: "Lluvia", icon: "⌁" },
];

export const directionOptions: Array<{ id: StyleDirection; label: string }> = [
  { id: "minimal", label: "Minimal" },
  { id: "relaxed", label: "Relajado" },
  { id: "polished", label: "Pulido" },
  { id: "bold", label: "Atrevido" },
];

const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const longWeekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, Math.max(0, month - 1), day || 1);
}

export function shortDateLabel(key: string) {
  const date = dateFromKey(key);
  return { weekday: weekdays[date.getDay()], day: date.getDate(), month: months[date.getMonth()].slice(0, 3) };
}

export function longDateLabel(key: string) {
  const date = dateFromKey(key);
  return `${longWeekdays[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`;
}

export function nextSevenDayBriefs(start = new Date()): DayBrief[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    return {
      date: dateKey(date),
      label: index === 0 ? "Hoy" : index === 1 ? "Mañana" : weekdays[date.getDay()],
      occasion: weekend ? "weekend" : "work",
      weather: "mild",
      direction: index % 3 === 0 ? "polished" : index % 3 === 1 ? "minimal" : "relaxed",
      temperatureC: null,
      rainProbability: null,
      anchorGarmentIds: [],
      avoidGarmentIds: [],
      locked: false,
    };
  });
}

export function updateDayBrief(briefs: DayBrief[], date: string, patch: Partial<DayBrief>) {
  return briefs.map((brief) => brief.date === date ? { ...brief, ...patch } : brief);
}

export function todayFromPlan(plan: WeekPlan | null, today = dateKey(new Date())) {
  return plan?.days.find((day) => day.brief.date === today) || plan?.days[0] || null;
}

export function findRenderJobForDay(day: PlannedDay | null, jobs: RenderJob[]) {
  if (!day) return null;
  if (day.renderJobId) return jobs.find((job) => job.id === day.renderJobId) || null;
  return jobs.find((job) => job.signature === day.candidate.signature && job.stage !== "cancelled") || null;
}

export function attachRenderJobs(plan: WeekPlan, jobs: RenderJob[]) {
  return {
    ...plan,
    days: plan.days.map((day) => {
      const job = jobs.find((entry) => entry.signature === day.candidate.signature && entry.stage !== "cancelled");
      return job ? {
        ...day,
        renderJobId: job.id,
        outfitId: job.outfitId || day.outfitId,
        renderPath: job.renderPath || day.renderPath,
        localRenderUri: job.localRenderUri || day.localRenderUri,
      } : day;
    }),
  };
}

export function candidateFromOutfit(outfit: Outfit): OutfitCandidate {
  const garmentIds = outfit.pieces.map((item) => String(item.id));
  const signature = [...garmentIds].sort().join("|");
  return {
    id: `saved-${outfit.id}`,
    signature,
    garmentIds,
    garments: outfit.pieces,
    name: outfit.name,
    rationale: outfit.note,
    signals: [outfit.occasion, outfit.renderPath || outfit.localRenderUri ? "Render AI listo" : "Combinación guardada"],
    score: {
      total: .72,
      harmony: .72,
      context: .72,
      personal: .72,
      rotation: .5,
      novelty: .5,
      completeness: 1,
      confidence: .85,
      uncertainty: 0,
    },
    features: outfitFeatureVector(outfit.pieces),
    contributions: [],
    alternatives: [],
  };
}

export function selectFallbackHero(snapshot: NativeSnapshot) {
  const today = dateKey(new Date());
  const scheduled = snapshot.calendar.find((entry) => entry.scheduledDate === today);
  if (scheduled) {
    const outfit = snapshot.outfits.find((entry) => entry.id === scheduled.outfitId);
    if (outfit) return outfit;
  }
  return [...snapshot.outfits]
    .sort((first, second) => Number(Boolean(second.localRenderUri || second.renderPath)) - Number(Boolean(first.localRenderUri || first.renderPath)))
    .find((outfit) => outfit.localRenderUri || outfit.renderPath) || snapshot.outfits[0] || null;
}

export function planModeLabel(mode: WeekPlan["mode"]) {
  if (mode === "expressive") return "Expresivo";
  if (mode === "rotation") return "Máxima rotación";
  return "Equilibrado";
}
