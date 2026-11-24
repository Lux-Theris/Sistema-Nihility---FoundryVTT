import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRelayOutcome, refuse, relayFailureMessage, createReplyRegistry, RELAY_REASONS } from "../module/helpers/gm-relay-rules.js";
import { escapeHtml } from "../module/helpers/html.js";
import { RELAY_ACTION_NAMES, missingRelayActions, unexpectedRelayActions } from "../module/core/relay-action-names.js";
import { validateRelayRegistration } from "../module/helpers/gm-relay-rules.js";

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

test("Relay: sucesso pode levar a referência do que o Mestre criou", () => {
  assert.deepEqual(normalizeRelayOutcome({ ok: true, value: { sceneId: "s", instanceId: "i" } }), { ok: true, reason: "", value: { sceneId: "s", instanceId: "i" } });
  // Recusa nunca leva valor.
  assert.deepEqual(normalizeRelayOutcome({ ok: false, reason: "x", value: 1 }), { ok: false, reason: "x" });
});

test("Relay: a lista de ações está congelada (43 nomes, sem repetição, em ordem)", () => {
  const expected = [
    "antimagicStructures", "applySkillEffects", "boardingAction", "boardingGroup", "boardingTeleport", "borrowedCooldown", "clearShieldLights", "createCharacter",
    "createStructure", "createSurface", "createZone", "cutBorrowLink", "damageStructure", "engageTractor",
    "ensureUploadFolder", "forcedMove", "listUploadFolder", "lootTake", "pileDrop", "pilesClear", "playerTrade", "playerTradeUndo",
    "regenerateSustainedShields", "registerCompendiumItem",
    "releaseSkillAnchors", "releaseTractor", "removeStructures", "removeZones", "rerollApply", "resistanceExposure",
    "resistanceXp", "setMovementDash", "setShieldLight", "shipDock", "shipLibrary", "shopBuy", "shopOrder", "shopSell", "shopTrade", "shopUndo", "skillUseXp", "soulXp", "spaceMove", "spaceRegion", "timePassedFor",
    "timeSyncRequest", "transformActor"
  ];
  assert.deepEqual([...RELAY_ACTION_NAMES], expected);
  assert.equal(RELAY_ACTION_NAMES.length, 47);
  assert.equal(new Set(RELAY_ACTION_NAMES).size, 47);
  assert.equal(Object.isFrozen(RELAY_ACTION_NAMES), true);
});

test("Relay: missingRelayActions e unexpectedRelayActions comparam com a lista", () => {
  assert.deepEqual(missingRelayActions(RELAY_ACTION_NAMES), []);
  assert.deepEqual(unexpectedRelayActions(RELAY_ACTION_NAMES), []);
  const partial = RELAY_ACTION_NAMES.filter(n => n !== "soulXp" && n !== "forcedMove");
  assert.deepEqual(missingRelayActions(new Set(partial)), ["forcedMove", "soulXp"]);
  assert.deepEqual(unexpectedRelayActions([...partial, "inventada", "inventada"]), ["inventada"]);
  assert.deepEqual(missingRelayActions([]), [...RELAY_ACTION_NAMES]);
});

test("Relay: registro recusa nome repetido e valor que não é função", () => {
  assert.deepEqual(validateRelayRegistration([], { a() {}, b: async () => {} }), []);
  assert.deepEqual(validateRelayRegistration(["a"], { a() {}, b() {} }), ['a ação "a" já está registrada']);
  assert.deepEqual(validateRelayRegistration([], { a: 1 }), ['a ação "a" não é uma função']);
  assert.equal(validateRelayRegistration(new Set(["a"]), { a: null }).length, 2);
  assert.deepEqual(validateRelayRegistration([], undefined), []);
});
