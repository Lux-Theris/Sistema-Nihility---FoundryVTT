/**
 * Efeitos: formato V13/V14, âncoras, explicação de números, bloqueio de cura, regeneração, Maldição, números flutuantes, Vida 0, Contágio, selos do Token e Fim do combate.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { buildAttributeRollFormula } from "../module/core/dice.js";
import {
  makeAnchor,
  sameAnchor,
  addAnchor,
  removeAnchor,
  effectAnchors,
  finiteRemaining,
  serializeFinite,
  anchorLifetime,
  durationRemaining,
  refreshFiniteRounds,
  PERMANENT
} from "../module/combat/effect-anchors.js";
import { explainAttribute, explainVital } from "../module/combat/stat-explain.js";
import {
  healBlockReduction,
  healBlockApplies,
  healBlockFactor,
  skillIsMagic,
  dispelledEffects,
  isSuppressedBy
} from "../module/core/magic-rules.js";
import { normalizeRegen, sumRegen, regenAmount } from "../module/core/regen-rules.js";
import { normalizeCurse, curseCostRound, curseScaled } from "../module/core/curse-rules.js";
import { VITAL_TRACKS, FLOAT_COLORS, vitalSnapshot, vitalDeltas } from "../module/combat/vital-deltas.js";
import {
  incapacitatingIds,
  isIncapacitatedBy,
  zeroHpOutcome,
  incapacitationTurn
} from "../module/combat/incapacitation-rules.js";
import { normalizeSpread, contagionChance, withinRadius, immuneByTrait } from "../module/combat/contagion-rules.js";
import { effectBadge } from "../module/combat/effect-badge-rules.js";
import { suggestCombatXp, splitXp, endCombatEffectChoice } from "../module/combat/end-combat-rules.js";

test("Active Effect: formato V13 e V14, e leitura dos dois", async () => {
  const { buildEffectChanges, readEffectChanges } = await import("../module/helpers/foundry-compat.js");
  const changes = [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: 3 }, { key: "x", mode: 5, value: "fire" }];
  assert.deepEqual(buildEffectChanges(changes, 13), { changes: [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: "3" }, { key: "x", mode: 5, value: "fire" }] });
  const v14 = buildEffectChanges(changes, 14);
  assert.deepEqual(v14.system.changes, [{ key: "system.attributes.combat.strength.buffDelta", type: "add", value: "3" }, { key: "x", type: "override", value: "fire" }]);
  assert.equal(v14.changes, undefined);
  assert.deepEqual(readEffectChanges(v14), [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: "3" }, { key: "x", mode: 5, value: "fire" }]);
  assert.deepEqual(readEffectChanges(buildEffectChanges(changes, 13)), readEffectChanges(v14));
  assert.deepEqual(readEffectChanges({ system: { changes: [{ key: "k", type: "multiply", value: "1.2" }] } }), [{ key: "k", mode: 1, value: "1.2" }]);
});

test("Âncoras de Skill Ativa: A e B seguram o mesmo efeito, desligar A não derruba B", () => {
  const a = makeAnchor({ skillUuid: "Actor.lux.Item.a", skillId: "a" });
  const b = makeAnchor({ skillUuid: "Actor.lux.Item.b", skillId: "b" });
  let anchors = addAnchor([], a);
  anchors = addAnchor(anchors, b);
  assert.equal(addAnchor(anchors, a).length, 2, "religar A não duplica");

  const afterA = removeAnchor(anchors, a);
  assert.equal(afterA.removed, true);
  assert.equal(anchorLifetime({ anchors: afterA.anchors }).alive, true, "B ainda segura");
  const afterB = removeAnchor(afterA.anchors, b);
  assert.equal(anchorLifetime({ anchors: afterB.anchors }).alive, false);
  assert.equal(removeAnchor(afterB.anchors, b).removed, false, "tirar de novo não faz nada");
});

test("Âncoras: Tokens não vinculados (mesmo id de Skill, uuids diferentes) são independentes", () => {
  const drone1 = makeAnchor({ skillUuid: "Scene.s.Token.t1.Actor.d.Item.x", skillId: "x" });
  const drone2 = makeAnchor({ skillUuid: "Scene.s.Token.t2.Actor.d.Item.x", skillId: "x" });
  assert.equal(sameAnchor(drone1, drone2), false);
  const { anchors, removed } = removeAnchor([drone1, drone2], drone1);
  assert.equal(removed, true);
  assert.deepEqual(anchors, [drone2]);
  // Sub-Skills da mesma Skill são âncoras diferentes.
  assert.equal(sameAnchor(makeAnchor({ skillUuid: "u", subSkillIndex: 0 }), makeAnchor({ skillUuid: "u", subSkillIndex: 1 })), false);
});

test("Âncoras: formato antigo (sem uuid / tiedToActive) continua sendo entendido", () => {
  const legacyPeriodic = { sourceSkillId: "a", sourceSubSkillIndex: null };
  assert.equal(sameAnchor(legacyPeriodic, makeAnchor({ skillUuid: "Actor.lux.Item.a", skillId: "a" })), true, "sem uuid compara por id");
  const flags = { tiedToActive: true, sourceSkillId: "a", sourceSubSkillIndex: null };
  const anchors = effectAnchors(flags, "Actor.lux.Item.a");
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].skillUuid, "Actor.lux.Item.a");
  assert.deepEqual(effectAnchors({ tiedToActive: false }), []);
  // Lista gravada (mesmo vazia) vence a flag antiga.
  assert.deepEqual(effectAnchors({ tiedToActive: true, sourceSkillId: "a", activeAnchors: [] }), []);
});

test("Âncoras: prazo finito corre em paralelo e volta quando a última Skill desliga", () => {
  const now = { round: 4, combatId: "c1" };
  // Buff comum de 3 rodadas aplicado na rodada 4 e depois ancorado por uma Skill Ativa.
  const finite = serializeFinite(3, now);
  assert.equal(finiteRemaining(finite, { round: 5, combatId: "c1" }), 2);
  assert.equal(finiteRemaining(finite, { round: 9, combatId: "c1" }), 0);
  assert.equal(finiteRemaining(finite, { round: 9, combatId: "outro" }), 3, "outro combate não conta tempo");
  assert.equal(finiteRemaining(serializeFinite(PERMANENT, now), now), PERMANENT);
  assert.equal(finiteRemaining(null, now), 0);

  const anchor = makeAnchor({ skillUuid: "u" });
  assert.deepEqual(anchorLifetime({ anchors: [anchor], finite: 2 }), { alive: true, untilOff: false, permanent: false });
  assert.deepEqual(anchorLifetime({ anchors: [anchor], finite: 0 }), { alive: true, untilOff: true, permanent: false });
  assert.equal(anchorLifetime({ anchors: [], finite: 2 }).alive, true, "Skill desligada, prazo finito ainda vale");
  assert.equal(anchorLifetime({ anchors: [], finite: 0 }).alive, false);
});

test("Âncoras: duração do Foundry e reaplicação com prazo (0 rodadas = permanente)", () => {
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, 4), 3);
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, 10), 0);
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, null), 5);
  assert.equal(durationRemaining({ rounds: null }, 4), PERMANENT);
  assert.equal(durationRemaining({}, null), PERMANENT);

  assert.equal(refreshFiniteRounds(2, 5), 5);
  assert.equal(refreshFiniteRounds(5, 2), 5, "renova, não soma nem encurta");
  assert.equal(refreshFiniteRounds(PERMANENT, 3), PERMANENT, "3 rodadas por cima de permanente não o torna finito");
  assert.equal(refreshFiniteRounds(3, 0), PERMANENT, "aplicação permanente vence o prazo");
});

test("Explicação de Atributo: mesmas contas da ficha (Total, Efetivo, Bônus, Pool)", () => {
  const ex = explainAttribute({
    points: 20,
    titles: [{ label: "Caçador Arcano", value: 7 }],
    buffs: [{ label: "Bênção", value: 10 }],
    buffActual: 10,
    conditionals: [{ label: "Fúria (Vida < 30%)", value: 3 }],
    items: [{ label: "Espada", value: 4 }]
  });
  assert.equal(ex.total, 27, "pontos + Título");
  assert.equal(ex.effectiveTotal, 40, "Total + buff + condicional");
  assert.equal(ex.bonus, 13);
  assert.equal(ex.diceCount, 2);
  assert.equal(ex.flat, 3);
  assert.equal(ex.itemBonus, 4);
  assert.equal(ex.formula, "2d20+7", "o mesmo que buildAttributeRollFormula(13, 4)");
  assert.equal(buildAttributeRollFormula(ex.bonus, ex.itemBonus), ex.formula);
});

test("Explicação de Atributo: diferença não identificada e prévia de pontos pendentes", () => {
  const ex = explainAttribute({ points: 9, buffs: [{ label: "Bênção", value: 2 }], buffActual: 5, pending: 3 });
  const unknown = ex.temporary.find(row => row.unknown);
  assert.equal(unknown.value, 3, "efeito de outro módulo vira linha própria");
  assert.equal(ex.effectiveTotal, 14, "a conta fecha com o buffDelta real");
  assert.equal(ex.previewBonus, Math.floor(17 / 3));
  assert.equal(explainAttribute({ points: 9 }).previewBonus, null);
});

test("Explicação de Vida/Mana: fórmula, piso, modificadores e mínimo", () => {
  const hp = explainVital({
    pair: [{ label: "Força", total: 12 }, { label: "Defesa", total: 10 }],
    multiplier: 10,
    floor: 50,
    permanent: [{ label: "Título", value: 50 }, { label: "Anel", value: -20 }],
    buffs: [{ label: "Vigor", value: 30 }],
    buffActual: 30,
    min: 1
  });
  assert.equal(hp.formulaValue, 1200);
  assert.equal(hp.floorApplied, false);
  assert.equal(hp.max, 1260);

  const low = explainVital({ pair: [{ total: 1 }, { total: 2 }], multiplier: 10, floor: 50, permanent: [{ value: -200 }], min: 1 });
  assert.equal(low.formulaValue, 20);
  assert.equal(low.floorApplied, true);
  assert.equal(low.base, 50);
  assert.equal(low.minApplied, true);
  assert.equal(low.max, 1);

  assert.deepEqual(explainVital({ enabled: false }), { enabled: false, max: 0 });
});

test("Bloqueio de cura: total até nível + ⅓; depois a redução cai em linha reta e zera no dobro do limite", () => {
  const reduction = lvl => Math.round(healBlockReduction(lvl, 9) * 1000) / 10;
  assert.equal(reduction(12), 100, "maldição 9 bloqueia até 12");
  assert.equal(reduction(13), 91.7);
  assert.equal(reduction(15), 75);
  assert.equal(reduction(18), 50);
  assert.equal(reduction(24), 0);
  assert.ok(healBlockReduction(13, 9) > healBlockReduction(15, 9), "nível 13 cura menos que 15");
  assert.equal(healBlockReduction(4, 3), 1, "maldição 3: cura nível 4 não passa");
  assert.equal(healBlockReduction(0, 1), 1, "Descanso/Título (nível 0) é sempre bloqueado");
  assert.equal(healBlockReduction(23.9, 9), 0, "abaixo de 1% passa inteira");
  assert.equal(healBlockReduction(18, 9, 3), 0.75, "a Regra da Mesa muda onde zera");
});

test("Bloqueio de cura: o que pega e o pior entre vários", () => {
  assert.equal(healBlockApplies("regen", "cura"), false);
  assert.equal(healBlockApplies("regen", "regeneracao"), true);
  assert.equal(healBlockApplies("all", "descanso"), true);
  assert.equal(healBlockApplies("all", "reparo"), false, "máquina não é cura");
  const blocks = [{ level: 9, kinds: "all" }, { level: 3, kinds: "regen" }];
  assert.equal(healBlockFactor(blocks, 15, "cura"), 0.25);
  assert.equal(healBlockFactor(blocks, 15, "reparo"), 1);
  assert.equal(healBlockFactor([], 1, "cura"), 1);
});

test("Antimagia: o que é mágico e o que ela alcança", () => {
  assert.equal(skillIsMagic({ tier: "normal", cost: 0 }), true, "Skill comprada (Resistência, passivo) é mágica");
  assert.equal(skillIsMagic({ tier: "normal", magicTag: "mundane" }), false);
  assert.equal(skillIsMagic({ tier: "racial", cost: 0 }), false, "Couro Grosso: corpo, não magia");
  assert.equal(skillIsMagic({ tier: "racial", cost: 10 }), true, "teleporte racial gasta Mana");
  assert.equal(skillIsMagic({ tier: "racial", magicTag: "magic" }), true);
  const effects = [{ id: "a", magic: true, level: 15 }, { id: "b", magic: true, level: 16 }, { id: "c", magic: false, level: 1 }, { id: "d", magic: true }];
  assert.deepEqual(dispelledEffects(effects, 15), ["a", "d"], "nível ≤ alcance; sem nível = 0; mundano fica");
  assert.equal(isSuppressedBy(15, 15), true);
  assert.equal(isSuppressedBy(16, 15), false);
  assert.equal(isSuppressedBy(1, null), false);
});

test("Regeneração por rodada: soma as fontes; Vida agrupada por tipo e nível", () => {
  assert.deepEqual(normalizeRegen({ energyPercent: "2", hpKind: "x" }), { energyPercent: 2, hpPercent: 0, hpKind: "cura" });
  const total = sumRegen([
    { label: "Natural", energyPercent: 5, level: 0 },
    { label: "Título: Arquimago", energyPercent: 3, level: 0 },
    { label: "Skill: Fluxo Arcano", energyPercent: 2, power: 1.2, level: 4 },
    { label: "Skill: Automatic HP Regeneration", hpPercent: 3, hpKind: "regeneracao", level: 6 },
    { label: "Título: Troll", hpPercent: 1, hpKind: "regeneracao", level: 0 }
  ]);
  assert.ok(Math.abs(total.energy - 10.4) < 1e-9);
  assert.deepEqual(total.hp, [{ kind: "regeneracao", level: 6, percent: 3 }, { kind: "regeneracao", level: 0, percent: 1 }]);
  assert.equal(total.rows.length, 5);
  assert.equal(regenAmount(240, 10.4), 25);
});

test("Maldição: custo sempre na Mana da vítima; sem Mana faz o que foi escolhido", () => {
  const base = { energyMax: 240, costPercent: 5 };
  assert.deepEqual(curseCostRound({ ...base, energy: 100, onUnpaid: "hp" }), { energy: 88, cost: 12, paid: true, missing: 0, hpLoss: 0, sleeping: false, factor: 1 });
  const hp = curseCostRound({ ...base, energy: 5, onUnpaid: "hp" });
  assert.equal(hp.energy, 0, "consome o que tem");
  assert.equal(hp.hpLoss, 7, "o que faltou sai da Vida");
  assert.equal(curseCostRound({ ...base, energy: 5, onUnpaid: "sleep" }).sleeping, true);
  assert.equal(curseCostRound({ ...base, energy: 50, onUnpaid: "sleep", sleeping: true }).sleeping, false, "acorda quando paga inteiro");
  const worse = curseCostRound({ ...base, energy: 0, onUnpaid: "worsen", factor: 2.9, worsenStep: 25, worsenCap: 3 });
  assert.equal(worse.factor, 3, "piora até o teto");
  assert.equal(curseCostRound({ ...base, energy: 50, onUnpaid: "worsen", factor: 2 }).factor, 2, "pagar de novo não desfaz a piora");
  const cont = curseCostRound({ ...base, energy: 0, onUnpaid: "continue" });
  assert.equal(cont.hpLoss + Number(cont.sleeping), 0);
  assert.equal(curseScaled(-20, 1.5), -30);
  assert.equal(normalizeCurse({ enabled: true, onUnpaid: "x" }).onUnpaid, "hp");
});

test("Números flutuantes: o golpe aparece como Escudo e Vida, de fora para dentro", () => {
  const tracks = VITAL_TRACKS.character;
  const before = vitalSnapshot({ attributes: { hp: { value: 100 }, shield: { value: 20 }, energy: { value: 50 } } }, tracks);
  const after = vitalSnapshot({ attributes: { hp: { value: 66 }, shield: { value: 0 }, energy: { value: 50 } } }, tracks);
  const deltas = vitalDeltas(before, after, tracks);
  assert.deepEqual(deltas.map(d => d.text), ["−20 Escudo", "−34"], "Escudo primeiro, Vida só com o número; Mana parada não aparece");
  assert.equal(deltas[1].fill, FLOAT_COLORS.damage);

  const heal = vitalDeltas({ hp: 66, energy: 50 }, { hp: 78, energy: 40 }, tracks, { labels: { energy: "Ki" } });
  assert.deepEqual(heal.map(d => [d.text, d.ownerOnly]), [["+12", false], ["−10 Ki", true]], "cura em verde; Mana com o rótulo da mesa e só para o dono");
  assert.equal(heal[0].fill, FLOAT_COLORS.heal);

  assert.deepEqual(vitalDeltas({}, { hp: 50 }, tracks), [], "ficha que ainda não tinha sido lida não inventa número");
  assert.deepEqual(vitalDeltas({ hp: 10.2 }, { hp: 10.4 }, tracks), [], "fração que arredonda para 0 não aparece");
});

test("Números flutuantes: Nave mostra Escudo, Casco e Integridade", () => {
  const tracks = VITAL_TRACKS.ship;
  const before = vitalSnapshot({ shields: { value: 30 }, casco: { value: 80 }, hull: { value: 100 } }, tracks);
  const after = vitalSnapshot({ shields: { value: 0 }, casco: { value: 55 }, hull: { value: 90 } }, tracks);
  assert.deepEqual(vitalDeltas(before, after, tracks).map(d => d.text), ["−30 Escudo", "−25 Casco", "−10 Integridade"]);
  assert.equal(vitalDeltas({ hull: 90 }, { hull: 100 }, tracks)[0].fill, FLOAT_COLORS.heal, "reparo em verde");
});

test("Vida 0: quem cai, quem morre, e quem está incapacitado", () => {
  const ids = incapacitatingIds([{ id: "fallen", incapacitates: true }, { id: "unconscious", incapacitates: true }, { id: "poison" }]);
  assert.deepEqual([...ids], ["fallen", "unconscious"]);
  assert.equal(isIncapacitatedBy([{ statuses: ["poison"] }, { statuses: ["fallen"] }], ids), true);
  assert.equal(isIncapacitatedBy([{ statuses: ["fallen"], disabled: true }], ids), false, "efeito desligado não conta");
  assert.equal(isIncapacitatedBy([{ statuses: ["dead"] }], ids, "dead"), true, "morto (Derrotado do core) também não age");
  assert.equal(zeroHpOutcome({ isPlayerCharacter: true }), "fall");
  assert.equal(zeroHpOutcome({ isPlayerCharacter: false, npcDies: true }), "die", "NPC morre direto");
  assert.equal(zeroHpOutcome({ isPlayerCharacter: false, npcDies: false }), "fall");
});

test("Caído: contador de morte; Inconsciente: perde 3 turnos e age no 4º", () => {
  let s = { kind: "fallen", rounds: 3 };
  const events = [];
  for (let i = 0; i < 4; i++) { const r = incapacitationTurn(s); s = r.state; events.push(r.event); }
  assert.deepEqual(events, ["none", "none", "death", "none"], "avisa uma vez, no 3º turno caído");
  assert.equal(incapacitationTurn({ kind: "fallen", rounds: 3, stabilized: true }).state.rounds, 3, "estabilizado: o contador para");
  let u = { kind: "unconscious", rounds: 3 };
  const wake = [];
  for (let i = 0; i < 4; i++) { const r = incapacitationTurn(u); u = r.state; wake.push(r.event); }
  assert.deepEqual(wake, ["none", "none", "none", "wake"]);
  assert.equal(incapacitationTurn({ kind: "unconscious", rounds: null }).event, "none", "marcado à mão: fica até o Mestre tirar");
});

test("Contágio: quem está no raio rola a chance; Traço imuniza; Resistência reduz", () => {
  assert.equal(normalizeSpread({ chance: 0, radius: 3 }), null, "sem chance não espalha");
  assert.equal(normalizeSpread({ chance: 30, radius: 0 }), null, "sem raio não espalha");
  assert.deepEqual(normalizeSpread({ chance: 140, radius: 2, immuneTraits: ["mechanical", ""] }), { chance: 100, radius: 2, immuneTraits: ["mechanical"] });
  assert.equal(contagionChance({ chance: 40 }), 40);
  assert.equal(contagionChance({ chance: 40, resistance: 0.5 }), 20, "Resistência 50% ao elemento corta metade da chance");
  assert.equal(contagionChance({ chance: 40, resistance: 1 }), 0, "Imunidade ao elemento");
  assert.equal(contagionChance({ chance: 40, immune: true }), 0);
  assert.equal(withinRadius({ x: 0, y: 0 }, { x: 150, y: 0 }, 3, 50), true, "150 px a 50 px/m = 3 m");
  assert.equal(withinRadius({ x: 0, y: 0 }, { x: 160, y: 0 }, 3, 50), false);
  assert.equal(immuneByTrait(["undead", "mechanical"], ["mechanical"]), true);
  assert.equal(immuneByTrait(["organic"], ["mechanical"]), false);
});

test("Número no ícone do Token: rodadas, ∞, irradiação, contador do Caído e nada sem prazo", () => {
  assert.deepEqual(effectBadge({ rounds: 3 }), { text: "3", tone: "time" }, "buff comum com duração do Foundry");
  assert.equal(effectBadge({ rounds: null }), null, "sem prazo: sem número");
  assert.deepEqual(effectBadge({ periodic: true, ticksRemaining: 2 }), { text: "2", tone: "time" });
  assert.deepEqual(effectBadge({ periodic: true, ticksRemaining: 0, anchored: true }), { text: "∞", tone: "anchor" }, "Veneno segurado por Skill Ativa");
  assert.deepEqual(effectBadge({ anchored: true, finite: Infinity }), { text: "∞", tone: "anchor" });
  assert.deepEqual(effectBadge({ anchored: true, finite: 2 }), { text: "2", tone: "time" }, "prazo finito correndo junto com a âncora");
  assert.deepEqual(effectBadge({ radiationLevel: 35 }), { text: "35", tone: "radiation" });
  assert.deepEqual(effectBadge({ incapacitation: { kind: "fallen", rounds: 2 } }), { text: "2", tone: "danger" });
  assert.equal(effectBadge({ incapacitation: { kind: "fallen", rounds: 2, stabilized: true } }), null, "estabilizado não conta");
  assert.equal(effectBadge({ incapacitation: { kind: "unconscious", rounds: null } }), null, "Inconsciente marcado à mão");
  assert.equal(effectBadge({ environment: true, periodic: true, anchored: true }), null, "perigo do Ambiente: enquanto estiver lá");
  assert.equal(effectBadge({ curse: true, rounds: 5 }), null);
});

test("Fim do combate: XP sugerida pelos derrotados, dividida, e quais efeitos entram na lista", () => {
  const xpFor = level => 100 * level;
  assert.equal(suggestCombatXp([4, 4, 4], { xpFor, percent: 25 }), 300, "3 Goblins nv 4 = 100 cada");
  assert.equal(suggestCombatXp([], { xpFor }), 0);
  assert.equal(suggestCombatXp([0], { xpFor, percent: 25 }), 25, "nível inválido conta como 1");
  assert.deepEqual(splitXp(300, 2), [150, 150]);
  assert.deepEqual(splitXp(100, 3), [34, 33, 33], "o resto vai para os primeiros");
  assert.deepEqual(splitXp(50, 0), []);
  assert.deepEqual(endCombatEffectChoice({ text: "2", tone: "time" }), { listed: true, checked: true });
  assert.deepEqual(endCombatEffectChoice({ text: "2", tone: "danger" }), { listed: true, checked: false }, "Caído: o Mestre decide");
  assert.deepEqual(endCombatEffectChoice({ text: "∞", tone: "anchor" }), { listed: false, checked: false }, "Skill Ativa ligada não entra");
  assert.deepEqual(endCombatEffectChoice({ text: "35", tone: "radiation" }), { listed: false, checked: false });
  assert.deepEqual(endCombatEffectChoice(null), { listed: false, checked: false });
});
