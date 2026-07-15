import assert from "node:assert/strict";
import test from "node:test";
import { needsLegacyAvatarRestore } from "../lib/avatar-migration.ts";

const alanOwnerId = "usr_4c0a265c0937ec8b834616cc";

test("offers the bundled avatar only to the legacy owner with untouched avatar state", () => {
  assert.equal(needsLegacyAvatarRestore(alanOwnerId, null), true);
  assert.equal(needsLegacyAvatarRestore("usr_someone_else", null), false);
});

test("does not restore after an avatar exists or was deliberately deleted", () => {
  assert.equal(needsLegacyAvatarRestore(alanOwnerId, {
    avatarKey: "owners/alan/avatar/current.png",
    avatarVersion: "current",
    avatarUpdatedAt: "2026-07-15T00:00:00.000Z",
  }), false);
  assert.equal(needsLegacyAvatarRestore(alanOwnerId, {
    avatarKey: null,
    avatarVersion: null,
    avatarUpdatedAt: "2026-07-15T00:00:00.000Z",
  }), false);
});
