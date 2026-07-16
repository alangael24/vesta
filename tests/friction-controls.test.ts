import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobileApp = readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");
const accountRoute = readFileSync(new URL("../app/api/v1/account/route.ts", import.meta.url), "utf8");
const avatarRoute = readFileSync(new URL("../app/api/v1/avatar/route.ts", import.meta.url), "utf8");
const outfitRoute = readFileSync(new URL("../app/api/v1/outfits/[outfitId]/generate/route.ts", import.meta.url), "utf8");
const reconstructionRoute = readFileSync(new URL("../app/api/v1/garments/[garmentId]/reconstruct/route.ts", import.meta.url), "utf8");

test("the mobile experience has no personal ChatGPT sign-in path", () => {
  assert.doesNotMatch(mobileApp, /from "\.\/codex-auth"/u);
  assert.doesNotMatch(mobileApp, /connectCodexExperiment|startExperimentalProcessing|startExperimentalReconstruction/u);
  assert.doesNotMatch(mobileApp, /Continuar con ChatGPT|Acceso para Apple Review/u);
});

test("blocking alerts are reserved for destructive confirmations", () => {
  assert.equal((mobileApp.match(/Alert\.alert\(/gu) || []).length, 4);
  assert.match(mobileApp, /Eliminar tu cuenta y todos tus datos/u);
  assert.match(mobileApp, /Eliminar prenda/u);
  assert.match(mobileApp, /Eliminar Look/u);
});

test("long-running image work is persisted before returning", () => {
  for (const route of [avatarRoute, outfitRoute, reconstructionRoute]) {
    assert.match(route, /waitUntil\(/u);
    assert.match(route, /status:\s*202/u);
  }
  assert.match(mobileApp, /Puedes cerrar la app/u);
});

test("account deletion removes private media and the owner record", () => {
  assert.match(accountRoute, /owners\/\$\{ownerId\}\//u);
  assert.match(accountRoute, /bucket\.delete/u);
  assert.match(accountRoute, /delete\(users\)\.where/u);
});

test("the closet uses four simple filters while preserving feminine garment types", () => {
  assert.match(mobileApp, /type ClosetFilter = "all" \| "clothing" \| "footwear" \| "accessories"/u);
  assert.match(mobileApp, /\{ id: "clothing", label: "Ropa" \}/u);
  assert.match(mobileApp, /Vestidos y enterizos/u);
  assert.match(mobileApp, /Faldas y pantalones/u);
  assert.match(mobileApp, /Bolsos y accesorios/u);
  assert.match(mobileApp, /fittingSlotsConflict/u);
});
