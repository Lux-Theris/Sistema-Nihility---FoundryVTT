import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, cssColor } from "../module/helpers/html.js";

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

test("cssColor: aceita hexadecimal, rgb/hsl e nome de cor", () => {
  for (const ok of ["#abc", "#abcd", "#a1b2c3", "#a1b2c3d4", "rgb(1, 2, 3)", "hsla(10, 50%, 50%, 0.5)", "rgb(10 20 30 / 50%)", "red", "transparent"]) {
    assert.equal(cssColor(ok, "X"), ok, ok);
  }
});

test("cssColor: recusa qualquer valor que escape do campo de cor", () => {
  for (const bad of ["red;background:url(x)", "#12", "#12345", "expression(alert(1))", "url(x)", "rgb(1,2,3);color:red", ""]) {
    assert.equal(cssColor(bad, "FALLBACK"), "FALLBACK", bad);
  }
});

test("cssColor: nulo e indefinido caem no fallback, sem virar a palavra 'null'", () => {
  assert.equal(cssColor(null, "FALLBACK"), "FALLBACK");
  assert.equal(cssColor(undefined, "FALLBACK"), "FALLBACK");
  assert.equal(cssColor(null), "");
});

test("cssColor: remove espaços das bordas de uma cor válida", () => {
  assert.equal(cssColor("  #a1b2c3 "), "#a1b2c3");
});
