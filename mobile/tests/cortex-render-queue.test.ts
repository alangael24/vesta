import assert from "node:assert/strict";
import test from "node:test";
import { RenderCoordinator, emptyRenderQueue, enqueueRenderJob, normalizeRenderQueue, renderStageLabel } from "../cortex/renderQueue.ts";
import type { RenderQueueState } from "../cortex/types.ts";

class MemoryStorage {
  value: RenderQueueState | null = null;
  async read() { return this.value; }
  async write(value: RenderQueueState) { this.value = JSON.parse(JSON.stringify(value)); }
}

class MockTransport {
  ensures = 0;
  submits = 0;
  polls = 0;
  downloads = 0;
  failOnce = false;
  async ensureOutfit() { this.ensures += 1; return { outfitId: "outfit-1" }; }
  async submit() { this.submits += 1; if (this.failOnce) { this.failOnce = false; throw new Error("network"); } return { status: "running" }; }
  async poll() { this.polls += 1; return this.polls >= 2 ? { renderPath: "/render.png", status: "ready" } : { status: "rendering" }; }
  async download() { this.downloads += 1; return "file:///render.png"; }
}

test("queue deduplicates identical signature and quality", () => {
  const first = enqueueRenderJob(emptyRenderQueue(), ["b", "a"], "low");
  const second = enqueueRenderJob(first.state, ["a", "b"], "low");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.state.jobs.length, 1);
});

test("different qualities can coexist for the same look", () => {
  const low = enqueueRenderJob(emptyRenderQueue(), ["a", "b"], "low");
  const medium = enqueueRenderJob(low.state, ["a", "b"], "medium");
  assert.equal(medium.state.jobs.length, 2);
});

test("normalization converts interrupted transient stages back to queued", () => {
  const at = new Date().toISOString();
  const state = normalizeRenderQueue({ version: 1, updatedAt: at, jobs: [{ id: "1", signature: "a", garmentIds: ["a"], quality: "low", stage: "polling", attempts: 1, requestId: "r", createdAt: at, updatedAt: at }] });
  assert.equal(state.jobs[0].stage, "queued");
});

test("coordinator executes ensure, submit, poll and download", async () => {
  const storage = new MemoryStorage();
  const transport = new MockTransport();
  const coordinator = new RenderCoordinator(storage, transport, { pollIntervalMs: 1, maxPolls: 5 });
  await coordinator.initialize();
  await coordinator.enqueue(["a", "b"], "low");
  await coordinator.process();
  const job = coordinator.getState().jobs[0];
  assert.equal(job.stage, "ready");
  assert.equal(job.localRenderUri, "file:///render.png");
  assert.equal(transport.ensures, 1);
  assert.equal(transport.submits, 1);
  assert.equal(transport.polls, 2);
  assert.equal(transport.downloads, 1);
});

test("coordinator retries a transient failure without duplicating the outfit", async () => {
  const storage = new MemoryStorage();
  const transport = new MockTransport();
  transport.failOnce = true;
  const coordinator = new RenderCoordinator(storage, transport, { pollIntervalMs: 1, maxPolls: 5, maxAttempts: 3 });
  await coordinator.initialize();
  await coordinator.enqueue(["a", "b"], "low");
  await coordinator.process();
  const job = coordinator.getState().jobs[0];
  assert.equal(job.stage, "ready");
  assert.equal(transport.ensures, 1);
  assert.equal(transport.submits, 2);
});

test("stage labels describe real phases rather than fake percentages", () => {
  assert.match(renderStageLabel("polling", "low"), /identidad|vistiendo/u);
  assert.match(renderStageLabel("ready", "medium"), /editorial/u);
});
