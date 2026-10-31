import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml } from "../module/helpers/html.js";

test("escapeHtml: escapa os cinco caracteres de HTML", () => {
  assert.equal(escapeHtml(`<b>Teste & "Cia" 'x'</b>`), "&lt;b&gt;Teste &amp; &quot;Cia&quot; &#39;x&#39;&lt;/b&gt;");
});

test("escapeHtml: nulo e indefinido viram texto vazio, números viram texto", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

test("escapeHtml: texto comum passa igual (acentos inclusive)", () => {
  assert.equal(escapeHtml("Kael — Lâmina Rúnica"), "Kael — Lâmina Rúnica");
});

