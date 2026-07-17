import type { RenderJob, RenderQuality, RenderQueueState } from "./types";

export type RenderQueueStorage = {
  read(): Promise<RenderQueueState | null>;
  write(state: RenderQueueState): Promise<void>;
};

export type RenderTransport = {
  ensureOutfit(garmentIds: string[], signature: string): Promise<{ outfitId: string }>;
  submit(outfitId: string, quality: RenderQuality, requestId: string, force: boolean): Promise<{ renderPath?: string | null; status?: string }>;
  poll(outfitId: string): Promise<{ renderPath?: string | null; status?: string; error?: string | null }>;
  download(renderPath: string, job: RenderJob): Promise<string>;
};

export type RenderQueueListener = (state: RenderQueueState) => void;

function nowIso() {
  return new Date().toISOString();
}

function createId(signature: string, quality: RenderQuality) {
  const safe = signature.replace(/[^a-z0-9]+/giu, "-").slice(0, 48);
  return `render-${quality}-${safe}-${Date.now().toString(36)}`;
}

export function emptyRenderQueue(): RenderQueueState {
  return { version: 1, jobs: [], updatedAt: nowIso() };
}

export function normalizeRenderQueue(value: RenderQueueState | null | undefined): RenderQueueState {
  if (!value || value.version !== 1 || !Array.isArray(value.jobs)) return emptyRenderQueue();
  return {
    version: 1,
    jobs: value.jobs.map((job) => ({
      ...job,
      attempts: Math.max(0, job.attempts || 0),
      stage: job.stage === "polling" || job.stage === "submitting" || job.stage === "downloading" || job.stage === "ensuring_outfit"
        ? "queued"
        : job.stage,
      updatedAt: job.updatedAt || nowIso(),
    })),
    updatedAt: value.updatedAt || nowIso(),
  };
}

export function enqueueRenderJob(state: RenderQueueState, garmentIds: string[], quality: RenderQuality = "low") {
  const signature = [...new Set(garmentIds)].sort().join("|");
  if (!signature) return { state, job: null as RenderJob | null, created: false };
  const existing = state.jobs.find((job) => job.signature === signature && job.quality === quality && !["failed", "cancelled"].includes(job.stage));
  if (existing) return { state, job: existing, created: false };
  const at = nowIso();
  const id = createId(signature, quality);
  const job: RenderJob = {
    id,
    signature,
    garmentIds: signature.split("|"),
    quality,
    stage: "queued",
    attempts: 0,
    requestId: `${id}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: at,
    updatedAt: at,
  };
  const next = { ...state, jobs: [...state.jobs, job], updatedAt: at };
  return { state: next, job, created: true };
}

export function patchRenderJob(state: RenderQueueState, jobId: string, patch: Partial<RenderJob>) {
  const at = nowIso();
  return {
    ...state,
    jobs: state.jobs.map((job) => job.id === jobId ? { ...job, ...patch, updatedAt: at } : job),
    updatedAt: at,
  };
}

export function cancelRenderJob(state: RenderQueueState, jobId: string) {
  return patchRenderJob(state, jobId, { stage: "cancelled" });
}

export function retryRenderJob(state: RenderQueueState, jobId: string) {
  return patchRenderJob(state, jobId, { stage: "queued", error: null, attempts: 0, requestId: `${jobId}-${Date.now().toString(36)}` });
}

export function renderStageLabel(stage: RenderJob["stage"], quality: RenderQuality) {
  if (stage === "queued") return "En cola privada";
  if (stage === "ensuring_outfit") return "Fijando la combinación";
  if (stage === "submitting") return quality === "medium" ? "Abriendo sesión editorial" : "Iniciando prueba rápida";
  if (stage === "polling") return "Conservando identidad y vistiendo el avatar";
  if (stage === "downloading") return "Guardando el resultado en el dispositivo";
  if (stage === "ready") return quality === "medium" ? "Render editorial listo" : "Prueba lista";
  if (stage === "failed") return "Render pausado";
  return "Cancelado";
}

export class RenderCoordinator {
  private state: RenderQueueState = emptyRenderQueue();
  private running = false;
  private processingPromise: Promise<void> | null = null;
  private listeners = new Set<RenderQueueListener>();
  private stopped = false;
  private readonly storage: RenderQueueStorage;
  private readonly transport: RenderTransport;
  private readonly options: { pollIntervalMs?: number; maxPolls?: number; maxAttempts?: number };

  constructor(
    storage: RenderQueueStorage,
    transport: RenderTransport,
    options: { pollIntervalMs?: number; maxPolls?: number; maxAttempts?: number } = {},
  ) {
    this.storage = storage;
    this.transport = transport;
    this.options = options;
  }

  async initialize() {
    this.state = normalizeRenderQueue(await this.storage.read());
    await this.persist();
    this.emit();
    return this.state;
  }

  getState() {
    return this.state;
  }

  subscribe(listener: RenderQueueListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async enqueue(garmentIds: string[], quality: RenderQuality = "low") {
    const result = enqueueRenderJob(this.state, garmentIds, quality);
    this.state = result.state;
    await this.persist();
    this.emit();
    this.process().catch(() => undefined);
    return result.job;
  }

  async retry(jobId: string) {
    this.state = retryRenderJob(this.state, jobId);
    await this.persist();
    this.emit();
    this.process().catch(() => undefined);
  }

  async cancel(jobId: string) {
    this.state = cancelRenderJob(this.state, jobId);
    await this.persist();
    this.emit();
  }

  stop() {
    this.stopped = true;
  }

  resume() {
    this.stopped = false;
    this.process().catch(() => undefined);
  }

  process() {
    if (this.processingPromise) return this.processingPromise;
    if (this.stopped) return Promise.resolve();
    this.processingPromise = (async () => {
      this.running = true;
      try {
        while (!this.stopped) {
          const job = this.state.jobs.find((entry) => entry.stage === "queued");
          if (!job) break;
          await this.runJob(job);
        }
      } finally {
        this.running = false;
      }
    })().finally(() => {
      this.processingPromise = null;
    });
    return this.processingPromise;
  }

  private async runJob(source: RenderJob) {
    const maxAttempts = this.options.maxAttempts ?? 3;
    let job = this.state.jobs.find((entry) => entry.id === source.id);
    if (!job || job.stage !== "queued") return;
    try {
      this.update(job.id, { stage: "ensuring_outfit", attempts: job.attempts + 1, error: null });
      await this.flush();
      job = this.state.jobs.find((entry) => entry.id === source.id)!;
      const ensured = job.outfitId ? { outfitId: job.outfitId } : await this.transport.ensureOutfit(job.garmentIds, job.signature);
      this.update(job.id, { outfitId: ensured.outfitId, stage: "submitting" });
      await this.flush();
      job = this.state.jobs.find((entry) => entry.id === source.id)!;
      const submitted = await this.transport.submit(ensured.outfitId, job.quality, job.requestId, job.quality === "medium");
      let renderPath = submitted.renderPath || null;
      if (!renderPath) {
        this.update(job.id, { stage: "polling" });
        await this.flush();
        renderPath = await this.pollUntilReady(ensured.outfitId);
      }
      this.update(job.id, { stage: "downloading", renderPath });
      await this.flush();
      job = this.state.jobs.find((entry) => entry.id === source.id)!;
      const localRenderUri = await this.transport.download(renderPath, job);
      this.update(job.id, { stage: "ready", renderPath, localRenderUri, error: null });
      await this.flush();
    } catch (error) {
      const current = this.state.jobs.find((entry) => entry.id === source.id);
      if (!current) return;
      const detail = error instanceof Error ? error.message : "render_failed";
      const retryable = current.attempts < maxAttempts && !/moderation|avatar_required|subscription_required|cancelled/u.test(detail);
      this.update(current.id, {
        stage: retryable ? "queued" : "failed",
        error: detail,
      });
      await this.flush();
      if (retryable) await delay(Math.min(2200, 300 * 2 ** current.attempts));
    }
  }

  private async pollUntilReady(outfitId: string) {
    const maxPolls = this.options.maxPolls ?? 150;
    const interval = this.options.pollIntervalMs ?? 1300;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (this.stopped) throw new Error("render_cancelled");
      const result = await this.transport.poll(outfitId);
      if (result.error) throw new Error(result.error);
      if (result.renderPath) return result.renderPath;
      if (result.status === "failed") throw new Error("render_failed");
      await delay(attempt < 10 ? Math.min(interval, 900) : interval);
    }
    throw new Error("render_still_running");
  }

  private update(jobId: string, patch: Partial<RenderJob>) {
    this.state = patchRenderJob(this.state, jobId, patch);
    this.emit();
  }

  private async flush() {
    await this.persist();
    this.emit();
  }

  private async persist() {
    await this.storage.write(this.state);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
