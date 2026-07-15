import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build contains the deployable Worker, private bindings, and migrations", async () => {
  const worker = await stat(new URL("dist/server/index.js", root));
  assert.ok(worker.size > 0);

  const hosting = JSON.parse(await readFile(new URL("dist/.openai/hosting.json", root), "utf8"));
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "MEDIA");

  const migration = await readFile(new URL("dist/.openai/drizzle/0000_common_hex.sql", root), "utf8");
  for (const table of ["users", "devices", "import_batches", "source_photos", "processing_jobs", "garments", "outfits"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``), `missing table ${table}`);
  }

  const processingMigration = await readFile(new URL("dist/.openai/drizzle/0001_strong_franklin_storm.sql", root), "utf8");
  for (const column of ["processing_mode", "processing_approved_at", "normalized_key", "input_tokens", "output_tokens"]) {
    assert.ok(processingMigration.includes(column), `missing processing column ${column}`);
  }
  const reconstructionMigration = await readFile(new URL("dist/.openai/drizzle/0002_left_brood.sql", root), "utf8");
  for (const column of ["garment_id", "duplicate_of_id", "dedup_confidence", "reconstruction_model", "transparent_pixel_ratio", "qa_status", "qa_json"]) {
    assert.ok(reconstructionMigration.includes(column), `missing reconstruction column ${column}`);
  }
});

test("web panel and native client expose the real privacy workflow", async () => {
  const [webSource, mobileSource, layoutSource] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("mobile/App.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.match(layoutSource, /Vesta — tu armario, mejor combinado/i);
  assert.match(webSource, /Colección de muestra/i);
  assert.match(webSource, /No necesitas emparejar nada/i);
  assert.match(webSource, /R2 privado/i);
  assert.doesNotMatch(webSource, /6 prendas detectadas|4 looks nuevos listos|Usar fotos de ejemplo/i);

  assert.match(mobileSource, /launchImageLibraryAsync/);
  assert.match(mobileSource, /SecureStore\.setItemAsync/);
  assert.match(mobileSource, /Subir a mi nube privada/i);
  assert.match(mobileSource, /OAI-Sites-Authorization/);
  assert.match(mobileSource, /acknowledgesOpenAIRetention: true/);
  assert.match(mobileSource, /api\/v1\/wardrobe/);

  const [processorSource, uploadSource, dedupSource, reconstructionSource, chromaSource] = await Promise.all([
    readFile(new URL("lib/inventory.ts", root), "utf8"),
    readFile(new URL("app/api/v1/batches/[batchId]/photos/[photoId]/route.ts", root), "utf8"),
    readFile(new URL("lib/deduplication.ts", root), "utf8"),
    readFile(new URL("lib/reconstruction.ts", root), "utf8"),
    readFile(new URL("lib/chroma.ts", root), "utf8"),
  ]);
  assert.match(processorSource, /store: false/);
  assert.match(processorSource, /gpt-5\.6-luna/);
  assert.match(processorSource, /gpt-5\.6/);
  assert.match(uploadSource, /status: "waiting_review"/);
  assert.match(dedupSource, /confidence < 95/);
  assert.match(reconstructionSource, /gpt-image-2/);
  assert.match(reconstructionSource, /store: false/);
  assert.match(chromaSource, /transparentPixelRatio/);
  assert.match(mobileSource, /Crear PNG transparente/);
});
