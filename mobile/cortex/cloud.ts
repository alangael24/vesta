import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import type { ImageSourcePropType } from "react-native";
import { normalizeStyleProfile } from "./learner";
import { emptyRenderQueue, type RenderQueueStorage, type RenderTransport } from "./renderQueue";
import type {
  CloudAvatar,
  CloudSession,
  NativeSnapshot,
  Outfit,
  RenderJob,
  RenderQueueState,
  StyleProfile,
  WardrobeItem,
  WeekPlan,
} from "./types";

const cloudKeys = {
  apiUrl: "vesta.api-url",
  dispatchToken: "vesta.dispatch-token",
  deviceToken: "vesta.device-token",
  deviceId: "vesta.device-id",
};

export async function readCloudSession(): Promise<CloudSession | null> {
  const [apiUrl, dispatchToken, deviceToken, deviceId] = await Promise.all([
    SecureStore.getItemAsync(cloudKeys.apiUrl),
    SecureStore.getItemAsync(cloudKeys.dispatchToken),
    SecureStore.getItemAsync(cloudKeys.deviceToken),
    SecureStore.getItemAsync(cloudKeys.deviceId),
  ]);
  if (!apiUrl || !dispatchToken || !deviceToken || !deviceId) return null;
  return { apiUrl: apiUrl.replace(/\/$/u, ""), dispatchToken, deviceToken, deviceId };
}

export async function cloudFetch(session: CloudSession, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("OAI-Sites-Authorization", `Bearer ${session.dispatchToken}`);
  headers.set("x-vesta-device-token", session.deviceToken);
  return fetch(`${session.apiUrl}${path}`, { ...init, headers });
}

export function privateImageSource(session: CloudSession | null, path?: string | null): ImageSourcePropType | null {
  if (!path) return null;
  if (/^(file|content):/u.test(path)) return { uri: path };
  if (!session) return null;
  return {
    uri: `${session.apiUrl}${path}`,
    headers: {
      "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
      "x-vesta-device-token": session.deviceToken,
    },
  };
}

export async function loadNativeSnapshot(session: CloudSession): Promise<NativeSnapshot> {
  const cached = await readSnapshotCache(session);
  const [wardrobeResult, outfitsResult, calendarResult, avatarResult, subscriptionResult] = await Promise.allSettled([
    cloudFetch(session, "/api/v1/wardrobe", { method: "GET" }),
    cloudFetch(session, "/api/v1/outfits", { method: "GET" }),
    cloudFetch(session, "/api/v1/calendar", { method: "GET" }),
    cloudFetch(session, "/api/v1/avatar", { method: "GET" }),
    cloudFetch(session, "/api/v1/subscription", { method: "GET" }),
  ]);
  const wardrobe = wardrobeResult.status === "fulfilled" && wardrobeResult.value.ok
    ? mapWardrobe((await wardrobeResult.value.json() as { garments?: unknown[] }).garments || [])
    : cached?.wardrobe || [];
  const outfits = outfitsResult.status === "fulfilled" && outfitsResult.value.ok
    ? mapOutfits((await outfitsResult.value.json() as { outfits?: unknown[] }).outfits || [])
    : cached?.outfits || [];
  const calendar = calendarResult.status === "fulfilled" && calendarResult.value.ok
    ? normalizeArray((await calendarResult.value.json() as { entries?: NativeSnapshot["calendar"] }).entries)
    : cached?.calendar || [];
  const avatarPayload = avatarResult.status === "fulfilled" && avatarResult.value.ok
    ? await avatarResult.value.json() as { avatar?: CloudAvatar | null }
    : null;
  const subscription = subscriptionResult.status === "fulfilled" && subscriptionResult.value.ok
    ? await subscriptionResult.value.json() as NativeSnapshot["subscription"]
    : cached?.subscription || null;
  const snapshot = await hydrateLocalMedia(session, {
    wardrobe,
    outfits,
    calendar: calendar as NativeSnapshot["calendar"],
    avatar: avatarPayload?.avatar || cached?.avatar || null,
    subscription,
    updatedAt: new Date().toISOString(),
  });
  await writeSnapshotCache(session, snapshot).catch(() => undefined);
  return snapshot;
}

export async function readSnapshotCache(session: CloudSession): Promise<NativeSnapshot | null> {
  const path = dataPath(session, "snapshot.json");
  if (path) {
    const value = await readJson<NativeSnapshot>(path);
    if (value && Array.isArray(value.wardrobe) && Array.isArray(value.outfits) && Array.isArray(value.calendar)) return hydrateLocalMedia(session, value);
  }
  return readLegacyCaches(session);
}

export async function loadStyleProfile(session: CloudSession) {
  const path = dataPath(session, "style-profile.json");
  return normalizeStyleProfile(path ? await readJson<StyleProfile>(path) : null);
}

export async function saveStyleProfile(session: CloudSession, profile: StyleProfile) {
  const path = dataPath(session, "style-profile.json");
  if (path) await writeJson(path, profile);
}

export async function loadWeekPlans(session: CloudSession) {
  const path = dataPath(session, "week-plans.json");
  const plans = path ? await readJson<WeekPlan[]>(path) : null;
  return Array.isArray(plans) ? plans : [];
}

export async function saveWeekPlans(session: CloudSession, plans: WeekPlan[]) {
  const path = dataPath(session, "week-plans.json");
  if (path) await writeJson(path, plans.slice(0, 12));
}

export function createRenderQueueStorage(session: CloudSession): RenderQueueStorage {
  const path = dataPath(session, "render-queue.json");
  return {
    async read() {
      return path ? await readJson<RenderQueueState>(path) : emptyRenderQueue();
    },
    async write(state) {
      if (path) await writeJson(path, state);
    },
  };
}

export function createRenderTransport(session: CloudSession): RenderTransport {
  return {
    async ensureOutfit(garmentIds, signature) {
      const response = await cloudFetch(session, "/api/v1/outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentIds,
          name: `Vesta Runway · ${signature.slice(0, 18)}`,
          occasion: "Planificado por Cortex",
          rationale: "Combinación optimizada en el dispositivo por Vesta Cortex.",
        }),
      });
      const payload = await response.json() as { selectedOutfitId?: string; error?: string };
      if (!response.ok || !payload.selectedOutfitId) throw new Error(payload.error || `outfit_save_${response.status}`);
      return { outfitId: payload.selectedOutfitId };
    },
    async submit(outfitId, quality, requestId, force) {
      const response = await cloudFetch(session, `/api/v1/outfits/${outfitId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, quality, force }),
      });
      const payload = await response.json() as { status?: string; renderPath?: string | null; error?: string };
      if (!response.ok && response.status !== 202) throw new Error(payload.error || `outfit_generate_${response.status}`);
      return payload;
    },
    async poll(outfitId) {
      const response = await cloudFetch(session, "/api/v1/outfits", { method: "GET" });
      if (!response.ok) throw new Error(`outfit_poll_${response.status}`);
      const payload = await response.json() as { outfits?: unknown[] };
      const outfit = mapOutfits(payload.outfits || []).find((entry) => entry.id === outfitId);
      return { renderPath: outfit?.renderPath || null, status: outfit?.status || "running" };
    },
    async download(renderPath, job) {
      if (!FileSystem.documentDirectory) throw new Error("render_storage_unavailable");
      const destination = `${FileSystem.documentDirectory}vesta-cortex-${safeId(session.deviceId)}-${safeId(job.id)}.png`;
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
      const result = await FileSystem.downloadAsync(`${session.apiUrl}${renderPath}`, destination, {
        headers: {
          "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
          "x-vesta-device-token": session.deviceToken,
        },
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      });
      if (result.status < 200 || result.status >= 300) throw new Error(`render_download_${result.status}`);
      return result.uri;
    },
  };
}

export async function saveCandidateOutfit(
  session: CloudSession,
  input: { garmentIds: string[]; name: string; occasion: string; rationale: string },
) {
  const response = await cloudFetch(session, "/api/v1/outfits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as { selectedOutfitId?: string; outfits?: unknown[]; error?: string };
  if (!response.ok || !payload.selectedOutfitId) throw new Error(payload.error || `outfit_save_${response.status}`);
  return { selectedOutfitId: payload.selectedOutfitId, outfits: payload.outfits ? mapOutfits(payload.outfits) : null };
}

export async function scheduleOutfit(session: CloudSession, outfitId: string, scheduledDate: string) {
  const response = await cloudFetch(session, "/api/v1/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outfitId, scheduledDate }),
  });
  const payload = await response.json() as { entries?: NativeSnapshot["calendar"]; error?: string };
  if (!response.ok) throw new Error(payload.error || `calendar_save_${response.status}`);
  return payload.entries || [];
}

export function mapWardrobe(values: unknown[]): WardrobeItem[] {
  return values.map((value) => {
    const item = value as Partial<WardrobeItem> & { id?: unknown; category?: unknown };
    return {
      ...item,
      id: String(item.id || ""),
      name: String(item.name || "Prenda"),
      category: categoryForUi(String(item.category || "accessories")),
      type: String(item.type || "Prenda"),
      color: String(item.color || "Sin confirmar"),
    } as WardrobeItem;
  }).filter((item) => Boolean(item.id));
}

export function mapOutfits(values: unknown[]): Outfit[] {
  return values.map((value) => {
    const outfit = value as Partial<Outfit> & { id?: unknown; pieces?: unknown[] };
    return {
      ...outfit,
      id: String(outfit.id || ""),
      name: String(outfit.name || "Look"),
      occasion: String(outfit.occasion || "Diario"),
      note: String(outfit.note || ""),
      pieces: mapWardrobe(outfit.pieces || []),
    } as Outfit;
  }).filter((outfit) => Boolean(outfit.id));
}

function categoryForUi(value: string): WardrobeItem["category"] {
  if (["tops", "layers", "bottoms", "footwear", "accessories", "one_piece"].includes(value)) return value;
  if (/(shoe|foot|calzado|zapato)/u.test(value)) return "footwear";
  if (/(dress|one|vestido|enterizo)/u.test(value)) return "one_piece";
  return "accessories";
}

async function hydrateLocalMedia(session: CloudSession, snapshot: NativeSnapshot): Promise<NativeSnapshot> {
  const prefix = safeId(session.deviceId);
  const wardrobe = await Promise.all(snapshot.wardrobe.map(async (item) => {
    const candidate = item.localImageUri || (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${prefix}-garment-${safeId(item.id)}.png` : null);
    return { ...item, localImageUri: await existingLocalPath(candidate) };
  }));
  const outfits = await Promise.all(snapshot.outfits.map(async (outfit) => {
    const candidate = outfit.localRenderUri || (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${prefix}-look-${safeId(outfit.id)}.png` : null);
    return { ...outfit, localRenderUri: await existingLocalPath(candidate) };
  }));
  const avatarCandidate = snapshot.avatar?.localUri || (snapshot.avatar && FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${prefix}-avatar.png` : null);
  const avatar = snapshot.avatar ? { ...snapshot.avatar, localUri: await existingLocalPath(avatarCandidate) } : null;
  return { ...snapshot, wardrobe, outfits, avatar };
}

async function readLegacyCaches(session: CloudSession): Promise<NativeSnapshot | null> {
  if (!FileSystem.documentDirectory) return null;
  const prefix = safeId(session.deviceId);
  const wardrobe = await readJson<WardrobeItem[]>(`${FileSystem.documentDirectory}vesta-${prefix}-wardrobe.json`) || [];
  const outfits = await readJson<Outfit[]>(`${FileSystem.documentDirectory}vesta-${prefix}-looks.json`) || [];
  const avatarPath = await existingLocalPath(`${FileSystem.documentDirectory}vesta-${prefix}-avatar.png`);
  if (!wardrobe.length && !outfits.length && !avatarPath) return null;
  return hydrateLocalMedia(session, {
    wardrobe: mapWardrobe(wardrobe),
    outfits: mapOutfits(outfits),
    calendar: [],
    avatar: avatarPath ? { mediaPath: "", version: "local-cache", localUri: avatarPath } : null,
    subscription: null,
    updatedAt: "legacy-cache",
  });
}

function dataPath(session: CloudSession, file: string) {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-cortex-${safeId(session.deviceId)}-${file}` : null;
}

function safeId(value: string | number) {
  return String(value).replace(/[^a-z0-9_-]/giu, "_");
}

function normalizeArray<T>(value: T[] | undefined | null) {
  return Array.isArray(value) ? value : [];
}

async function existingLocalPath(path: string | null | undefined) {
  if (!path) return null;
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  return info?.exists ? path : null;
}

async function readJson<T>(path: string): Promise<T | null> {
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists) return null;
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(path)) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown) {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
}

async function writeSnapshotCache(session: CloudSession, snapshot: NativeSnapshot) {
  const path = dataPath(session, "snapshot.json");
  if (path) await writeJson(path, snapshot);
}

export function localRenderSource(job: RenderJob | null | undefined) {
  return job?.localRenderUri ? { uri: job.localRenderUri } as ImageSourcePropType : null;
}
