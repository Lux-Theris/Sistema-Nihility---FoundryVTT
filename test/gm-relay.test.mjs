import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRelayOutcome, refuse, relayFailureMessage, createReplyRegistry, RELAY_REASONS } from "../module/helpers/gm-relay-rules.js";
import { escapeHtml } from "../module/helpers/html.js";

test("Relay: o que o handler devolve vira {ok, reason}", () => {
  assert.deepEqual(normalizeRelayOutcome(undefined), { ok: true, reason: "" });
  assert.deepEqual(normalizeRelayOutcome(null), { ok: true, reason: "" });
  assert.deepEqual(normalizeRelayOutcome(true), { ok: true, reason: "" });
  // Valor qualquer (força do Raio Trator) = sucesso.
  assert.deepEqual(normalizeRelayOutcome(0.4), { ok: true, reason: "" });
  assert.deepEqual(normalizeRelayOutcome(false), { ok: false, reason: "refused" });
  assert.deepEqual(normalizeRelayOutcome(refuse("a cena não existe mais")), { ok: false, reason: "a cena não existe mais" });
  assert.deepEqual(normalizeRelayOutcome({ ok: false }), { ok: false, reason: "refused" });
  assert.deepEqual(normalizeRelayOutcome({ ok: true, reason: "ignorado" }), { ok: true, reason: "" });
});

test("Relay: aviso para quem pediu", () => {
  assert.equal(relayFailureMessage({ ok: true, reason: "" }, "erguer a Barreira"), null);
  assert.equal(relayFailureMessage(null, "x"), null);
  assert.equal(relayFailureMessage({ ok: false, reason: RELAY_REASONS.noGm }, "erguer a Barreira"), "Nenhum Mestre conectado: não deu para erguer a Barreira.");
  assert.match(relayFailureMessage({ ok: false, reason: RELAY_REASONS.timeout }, "correr"), /não respondeu a tempo ao pedido para correr/);
  assert.equal(relayFailureMessage({ ok: false, reason: RELAY_REASONS.permission }, "correr"), "Não deu para correr: você não controla quem fez isso.");
  // Motivo em texto passa como veio.
  assert.equal(relayFailureMessage({ ok: false, reason: "não é o turno deste personagem" }, "correr"), "Não deu para correr: não é o turno deste personagem.");
});

test("Relay: resposta casa com o pedido pelo id; sem resposta, timeout", async () => {
  const timers = [];
  const registry = createReplyRegistry({
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: id => {
      timers[id].cleared = true;
    }
  });

  const first = registry.wait("a", 5000);
  const second = registry.wait("b", 5000);
  assert.equal(registry.size, 2);

  // Resposta de um id que ninguém espera é ignorada.
  assert.equal(registry.resolve("zzz", { ok: true }), false);

  assert.equal(registry.resolve("a", { ok: false, reason: "permission" }), true);
  assert.deepEqual(await first, { ok: false, reason: "permission" });
  assert.equal(timers[0].cleared, true);
  // Segunda resposta para o mesmo id: já foi entregue.
  assert.equal(registry.resolve("a", { ok: true }), false);

  // "b" não respondeu: o timer dispara.
  timers[1].fn();
  assert.deepEqual(await second, { ok: false, reason: "timeout" });
  assert.equal(registry.size, 0);
  assert.equal(timers[1].ms, 5000);
});

test("escapeHtml: nomes com HTML viram texto", () => {
  assert.equal(escapeHtml(`<b>Teste & "Cia"</b>`), "&lt;b&gt;Teste &amp; &quot;Cia&quot;&lt;/b&gt;");
  assert.equal(escapeHtml("D'Arc"), "D&#39;Arc");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(42), "42");
});
