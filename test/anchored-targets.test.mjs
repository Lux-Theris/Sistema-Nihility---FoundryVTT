/**
 * Registro de alvos ancorados (Fase 5 da revisão de 2026-10-31): quem segura uma Skill Ativa anota
 * quem recebeu efeito dela, e desligar resolve só essa lista em vez de varrer o mundo.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  makeAnchor,
  recordAnchoredTarget,
  anchoredTargetsFor,
  forgetAnchoredTargets,
  ANCHORED_TARGETS_CAP
} from "../module/combat/effect-anchors.js";

const SKILL = "Actor.kael.Item.barreira";
const anchor = makeAnchor({ skillUuid: SKILL, skillId: "barreira", subSkillIndex: null });
const subAnchor = makeAnchor({ skillUuid: SKILL, skillId: "barreira", subSkillIndex: 1 });

test("Alvos ancorados: sem registro, quem solta varre o mundo (null)", () => {
  assert.equal(anchoredTargetsFor(undefined, anchor), null);
  assert.equal(anchoredTargetsFor([], anchor), null);
});

test("Alvos ancorados: anota sem duplicar e devolve lista nova", () => {
  const original = [];
  const first = recordAnchoredTarget(original, anchor, "Actor.ana");
  assert.equal(first.changed, true);
  assert.deepEqual(original, [], "não muta a lista recebida");
  assert.deepEqual(anchoredTargetsFor(first.records, anchor), ["Actor.ana"]);

  const again = recordAnchoredTarget(first.records, anchor, "Actor.ana");
  assert.equal(again.changed, false);

  const token = "Scene.s2.Token.drone.Actor.drone";
  const second = recordAnchoredTarget(again.records, anchor, token);
  assert.deepEqual(anchoredTargetsFor(second.records, anchor), ["Actor.ana", token]);
});

test("Alvos ancorados: cada Sub-Skill tem o seu registro", () => {
  let { records } = recordAnchoredTarget([], anchor, "Actor.ana");
  ({ records } = recordAnchoredTarget(records, subAnchor, "Actor.bia"));
  assert.deepEqual(anchoredTargetsFor(records, anchor), ["Actor.ana"]);
  assert.deepEqual(anchoredTargetsFor(records, subAnchor), ["Actor.bia"]);
});

test("Alvos ancorados: dois Drones (mesmo id de Skill) não se misturam — compara por uuid", () => {
  const droneA = makeAnchor({ skillUuid: "Scene.s.Token.a.Actor.d.Item.x", skillId: "x" });
  const droneB = makeAnchor({ skillUuid: "Scene.s.Token.b.Actor.d.Item.x", skillId: "x" });
  let { records } = recordAnchoredTarget([], droneA, "Actor.ana");
  ({ records } = recordAnchoredTarget(records, droneB, "Actor.bia"));
  assert.deepEqual(anchoredTargetsFor(records, droneA), ["Actor.ana"]);
  assert.deepEqual(anchoredTargetsFor(records, droneB), ["Actor.bia"]);
});

test("Alvos ancorados: esquecer tira só a Skill desligada", () => {
  let { records } = recordAnchoredTarget([], anchor, "Actor.ana");
  ({ records } = recordAnchoredTarget(records, subAnchor, "Actor.bia"));
  const forgotten = forgetAnchoredTargets(records, anchor);
  assert.equal(forgotten.changed, true);
  assert.equal(anchoredTargetsFor(forgotten.records, anchor), null);
  assert.deepEqual(anchoredTargetsFor(forgotten.records, subAnchor), ["Actor.bia"]);
  assert.equal(forgetAnchoredTargets(forgotten.records, anchor).changed, false);
});

test("Alvos ancorados: lista grande demais vira varredura, nunca perde alvo", () => {
  let records = [];
  for (let i = 0; i < ANCHORED_TARGETS_CAP; i++) ({ records } = recordAnchoredTarget(records, anchor, `Actor.a${i}`));
  assert.equal(anchoredTargetsFor(records, anchor).length, ANCHORED_TARGETS_CAP);
  const over = recordAnchoredTarget(records, anchor, "Actor.extra");
  assert.equal(over.changed, true);
  assert.equal(anchoredTargetsFor(over.records, anchor), null, "estourou: quem solta varre o mundo");
  // Depois de estourar, novas anotações não fazem nada (continua varrendo).
  assert.equal(recordAnchoredTarget(over.records, anchor, "Actor.mais").changed, false);
});

test("Alvos ancorados: entrada inválida não muda nada", () => {
  assert.equal(recordAnchoredTarget([], anchor, "").changed, false);
  assert.equal(recordAnchoredTarget([], anchor, null).changed, false);
  assert.equal(recordAnchoredTarget([], null, "Actor.ana").changed, false);
  assert.equal(recordAnchoredTarget("lixo", anchor, "Actor.ana").changed, true, "registro corrompido é tratado como vazio");
});
