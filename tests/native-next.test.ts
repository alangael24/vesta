import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../mobile/App.tsx", import.meta.url), "utf8");
const experience = await readFile(new URL("../mobile/native-next/VestaNativeNext.tsx", import.meta.url), "utf8");
const intelligence = await readFile(new URL("../mobile/native-next/intelligence.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/v1/outfits/route.ts", import.meta.url), "utf8");

test("native home foregrounds the existing AI avatar and real renders", () => {
  assert.match(app, /VestaTodayHero/u);
  assert.match(experience, /RENDER AI REAL/u);
  assert.match(experience, /Tus looks merecen pantalla completa/u);
  assert.doesNotMatch(app, /VestaMirror/u);
});

test("studio directs and completes a look before rendering", () => {
  assert.match(app, /StudioDirector/u);
  assert.match(app, /directStudioLook/u);
  assert.match(app, /Vesta no simula con capas 2\.5D/u);
  assert.match(intelligence, /export function directStudioLook/u);
});

test("stylist brief reaches the real outfits API", () => {
  assert.match(app, /StylistBriefModal/u);
  assert.match(app, /stylistBriefPayload\(brief\)/u);
  assert.match(route, /parseOutfitContext/u);
  assert.match(route, /seedGarmentIds/u);
  assert.match(route, /variationSeed/u);
});

test("looks use an immersive editorial card instead of a two-column thumbnail grid", () => {
  assert.match(app, /EditorialLookCard/u);
  assert.doesNotMatch(app, /view === "looks"[\s\S]{0,500}numColumns=\{2\}/u);
});
