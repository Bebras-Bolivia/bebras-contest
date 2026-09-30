import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedCorsOrigin } from "./cors";

test("CORS solo acepta los orígenes configurados", () => {
  const configured = "http://localhost:4321";
  assert.equal(allowedCorsOrigin("http://localhost:4321", configured), "http://localhost:4321");
  assert.equal(allowedCorsOrigin("http://127.0.0.1:4321", configured), "http://127.0.0.1:4321");
  assert.equal(allowedCorsOrigin("https://ataque.example", configured), null);
  assert.equal(allowedCorsOrigin("http://localhost:4322", configured), null);
  assert.equal(allowedCorsOrigin(undefined, configured), null);
});

test("sin orígenes configurados, como en producción, no se acepta ninguno", () => {
  assert.equal(allowedCorsOrigin("http://localhost:4321", ""), null);
  assert.equal(allowedCorsOrigin("http://localhost:4321", undefined), null);
});

test("se pueden configurar varios orígenes, con o sin barra final", () => {
  const configured = " https://bebras.example/ , http://localhost:4421";
  assert.equal(allowedCorsOrigin("https://bebras.example", configured), "https://bebras.example");
  assert.equal(allowedCorsOrigin("http://localhost:4421", configured), "http://localhost:4421");
});
