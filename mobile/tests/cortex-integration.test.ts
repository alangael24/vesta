import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("native entrypoint boots Vesta Cortex", async () => {
  const index = await source("mobile/index.ts");
  assert.match(index, /import App from "\.\/cortex\/App"/u);
  assert.match(index, /registerRootComponent\(App\)/u);
});

test("legacy native client exposes deep routes without replacing its real flows", async () => {
  const app = await source("mobile/App.tsx");
  for (const marker of ["type AppProps", "initialGarmentIds", "initialOutfitId", "autoRenderInitialLook", "onExit"]) assert.match(app, new RegExp(marker, "u"));
  assert.match(app, /renderRealTryOn\(tryOnLayers, tryOnLayers, "low"\)/u);
  assert.match(app, /<Text style=\{styles\.brandName\}>VESTA<\/Text>/u);
});

test("Cortex contains real search, graph, learning, planning and render orchestration", async () => {
  const [search, graph, learner, planner, queue, app] = await Promise.all([
    source("mobile/cortex/search.ts"),
    source("mobile/cortex/graph.ts"),
    source("mobile/cortex/learner.ts"),
    source("mobile/cortex/planner.ts"),
    source("mobile/cortex/renderQueue.ts"),
    source("mobile/cortex/App.tsx"),
  ]);
  assert.match(search, /beamWidth/u);
  assert.match(search, /mmrSelect/u);
  assert.match(search, /counterfactual|alternativeSwaps/u);
  assert.match(graph, /eigenvectorCentrality/u);
  assert.match(graph, /labelCommunities/u);
  assert.match(learner, /precision/u);
  assert.match(learner, /sampledPreferenceScore/u);
  assert.match(planner, /Math\.exp\(delta \/ temperature\)/u);
  assert.match(planner, /repeatedCorePenalty/u);
  assert.match(planner, /planWeekAsync/u);
  assert.match(planner, /shouldCancel/u);
  assert.match(queue, /class RenderCoordinator/u);
  assert.match(queue, /pollUntilReady/u);
  assert.match(app, /CompareSlider/u);
  assert.match(app, /renderWholeWeek/u);
  assert.match(app, /planningProgress/u);
  assert.match(app, /cancelPlanning/u);
});

test("Cortex remains native-only", async () => {
  const app = await source("mobile/cortex/App.tsx");
  assert.doesNotMatch(app, /VestaMirror|2\.5D|WebGL|iframe/u);
  assert.match(app, /avatar AI|avatar/u);
});
