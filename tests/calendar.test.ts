import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const collectionRoute = readFileSync(new URL("../app/api/v1/calendar/route.ts", import.meta.url), "utf8");
const entryRoute = readFileSync(new URL("../app/api/v1/calendar/[entryId]/route.ts", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");

test("calendar entries belong to an owner and cascade with their outfit", () => {
  assert.match(schema, /scheduled_outfits/u);
  assert.match(schema, /outfitId:.*references\(\(\) => outfits\.id, \{ onDelete: "cascade" \}\)/u);
  assert.match(schema, /scheduled_outfits_owner_outfit_date_unique/u);
});

test("calendar API validates ownership and real calendar dates", () => {
  assert.match(collectionRoute, /eq\(outfits\.ownerId, identity\.ownerId\)/u);
  assert.match(collectionRoute, /isCalendarDate\(scheduledDate\)/u);
  assert.match(entryRoute, /eq\(scheduledOutfits\.ownerId, identity\.ownerId\)/u);
});

test("mobile exposes scheduling from Looks and a calendar view", () => {
  assert.match(mobile, /Agregar al calendario/u);
  assert.match(mobile, /view === "calendar"/u);
  assert.match(mobile, /No consume una generación adicional/u);
});
