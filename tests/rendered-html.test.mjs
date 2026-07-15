import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Vesta mobile app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Vesta — tu armario, mejor combinado/i);
  assert.match(html, /Colección de muestra/i);
  assert.match(html, /Armario/i);
  assert.match(html, /Importar fotos/i);
  assert.match(html, /manifest\.webmanifest/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);

  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Ver looks de muestra/i);
  assert.match(source, /Selección local · envío desactivado/i);
  assert.doesNotMatch(source, /6 prendas detectadas|4 looks nuevos listos|Usar fotos de ejemplo/i);
});
