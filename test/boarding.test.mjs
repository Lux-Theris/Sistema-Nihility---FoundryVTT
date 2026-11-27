import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  tokensTouching, dockVerdict, dockViaLabel, propulsionBonus, dragOutcome, dragDamage, addBoarder, removeBoarder, moveBoarder, roomLabel,
  actionAllowed, sabotageDamage, requestCardText, teleportVerdict, seededRng, moduleReadRows, DISABLE_ROUNDS, HACK_ROUNDS
} from "../module/starship/boarding-rules.js";

test("Acoplar: colados, e só com Raio Trator, Escudo 0 ou o Mestre liberando", () => {
  assert.equal(tokensTouching(0), true);
  assert.equal(tokensTouching(0.5), true);
  assert.equal(tokensTouching(1.2), false);
  const base = { sameScene: true, touching: true, targetShield: 200 };
  assert.deepEqual(dockVerdict({ ...base, tractor: true }), { ok: true, via: "tractor", reason: "", canAsk: false });
  assert.equal(dockVerdict({ ...base, targetShield: 0 }).via, "shield");
  const refused = dockVerdict(base);
  assert.equal(refused.ok, false);
  assert.equal(refused.canAsk, true);
  assert.match(refused.reason, /Raio Trator/);
  assert.equal(dockVerdict({ ...base, isGm: true }).via, "gm");
  // Veículo: só o Mestre libera, mesmo com o Escudo em 0
  assert.equal(dockVerdict({ ...base, targetShield: 0, anyVehicle: true }).ok, false);
  assert.equal(dockVerdict({ ...base, targetShield: 0, anyVehicle: true, isGm: true }).via, "gm");
  // fora de cena, longe ou já acoplada: nem o Mestre
  assert.equal(dockVerdict({ ...base, sameScene: false, isGm: true }).ok, false);
  assert.equal(dockVerdict({ ...base, touching: false, isGm: true }).ok, false);
  assert.match(dockVerdict({ ...base, selfDocked: "Vésper", isGm: true }).reason, /já está acoplada a Vésper/);
  assert.match(dockVerdict({ ...base, targetDocked: "Lâmina", isGm: true }).reason, /já está acoplado a Lâmina/);
  assert.equal(dockViaLabel("tractor"), "Raio Trator segurando");
  assert.equal(dockViaLabel("shield"), "Escudo do alvo em 0");
  assert.equal(dockViaLabel("gm"), "Mestre liberou");
  assert.equal(dockViaLabel(""), "");
});

test("Mover acoplada: diferença até 4 arrasta; 5 ou mais arranca pedaço de quem perdeu", () => {
  assert.equal(propulsionBonus(40), 2);
  assert.equal(propulsionBonus(19), 0);
  assert.equal(propulsionBonus(-5), 0);
  // os dois exemplos do mockup: 14 x 11 arrasta; 18 x 7 arranca de quem resistiu
  assert.deepEqual(dragOutcome({ mover: 14, resister: 11 }), { diff: 3, kind: "drag", loser: null });
  assert.deepEqual(dragOutcome({ mover: 18, resister: 7 }), { diff: 11, kind: "tear", loser: "resister" });
  assert.deepEqual(dragOutcome({ mover: 15, resister: 11 }), { diff: 4, kind: "drag", loser: null }, "4 ainda arrasta");
  assert.equal(dragOutcome({ mover: 16, resister: 11 }).kind, "tear", "5 já arranca");
  assert.equal(dragOutcome({ mover: 5, resister: 14 }).loser, "mover", "quem se move e perde por muito é quem se rasga");
  assert.equal(dragOutcome({ mover: 16, resister: 11, margin: 6 }).kind, "drag", "a margem é afinável");
  // dano: 2% do Casco por ponto (dono, 24/11: Casco 800, diferença 11 = 176) e o mesmo no Módulo do ponto
  assert.deepEqual(dragDamage({ diff: 11, cascoMax: 800, moduleHpMax: 200 }), { casco: 176, module: 44 });
  assert.deepEqual(dragDamage({ diff: -6, cascoMax: 0, hullMax: 300 }), { casco: 36, module: 0 }, "sem Casco usa a Integridade");
  assert.deepEqual(dragDamage({ diff: 5, cascoMax: 800, percentPerPoint: 2 }), { casco: 80, module: 0 });
});

test("Grupo de abordagem: um por personagem, sala e saída", () => {
  let list = addBoarder([], { actorUuid: "Actor.kaito", fromUuid: "Actor.fenix", source: "dock" });
  list = addBoarder(list, { actorUuid: "Actor.mira", fromUuid: "Actor.fenix", moduleId: "m1", source: "region", regionUuid: "Scene.s.Region.r" });
  assert.equal(list.length, 2);
  assert.equal(list[1].moduleId, "m1");
  // de novo o mesmo personagem: substitui, não duplica
  list = addBoarder(list, { actorUuid: "Actor.kaito", moduleId: "m2", source: "teleport" });
  assert.equal(list.length, 2);
  assert.equal(list.find(b => b.actorUuid === "Actor.kaito").source, "teleport");
  assert.equal(addBoarder(list, { actorUuid: "" }).length, 2, "sem uuid não entra");
  assert.equal(addBoarder([], { actorUuid: "A", source: "estranho" })[0].source, "dock");
  list = moveBoarder(list, "Actor.mira", "");
  assert.equal(list.find(b => b.actorUuid === "Actor.mira").moduleId, "");
  assert.equal(removeBoarder(list, "Actor.kaito").length, 1);
  assert.equal(removeBoarder(list, "Actor.ninguem").length, 2);
  assert.equal(roomLabel("m1", "Reator"), "Reator");
  assert.equal(roomLabel("", "Reator"), "Corredor");
  assert.equal(roomLabel("m1", ""), "Corredor");
});

test("Ações: Hackear é proibível pela sala; Sabotar é dano direto sem escala", () => {
  assert.deepEqual(actionAllowed("sabotage"), { ok: true, reason: "" });
  assert.equal(actionAllowed("voar").ok, false);
  assert.equal(actionAllowed("hack", { allowSabotage: true, allowDisable: true, allowHack: false }).ok, false);
  assert.match(actionAllowed("hack", { allowHack: false }).reason, /terminal/);
  assert.equal(actionAllowed("disable", { allowHack: false }).ok, true);
  assert.match(actionAllowed("sabotage", { allowSabotage: false }).reason, /Sabotar não é permitido/);
  // 2d6 rolou 9, Força ×1,5, arma +10%/+2
  assert.equal(sabotageDamage({ rolled: 9, scaling: 1.5, multiplier: 1.1, flat: 2 }), 17);
  assert.equal(sabotageDamage({ rolled: 0 }), 0);
  assert.equal(sabotageDamage({ rolled: 5, flat: -20 }), 0, "nunca negativo");
  assert.equal(DISABLE_ROUNDS, 3);
  assert.equal(HACK_ROUNDS, 5);
  assert.match(requestCardText({ kind: "hack", actorName: "Kaito", moduleName: "Escudos", shipName: "Vésper" }), /Kaito quer Hackear o Módulo Escudos de Vésper/);
  assert.match(requestCardText({ kind: "disable", actorName: "Kaito", moduleName: "Reator", shipName: "Vésper" }), /Desligar/);
  assert.match(requestCardText({ kind: "dock", actorName: "Piloto", shipName: "Vésper" }), /acoplar a Vésper/);
});

test("Abordar por teleporte: precisa ver o alvo; Interdição e Âncora bloqueiam", () => {
  const ok = { operating: true, distance: 80, range: 100, hasSensor: true, seen: true };
  assert.equal(teleportVerdict(ok).ok, true);
  assert.match(teleportVerdict({ ...ok, operating: false }).reason, /PEM/);
  assert.match(teleportVerdict({ ...ok, range: 0 }).reason, /alcance/);
  assert.match(teleportVerdict({ ...ok, distance: 150 }).reason, /fora do alcance/);
  assert.match(teleportVerdict({ ...ok, seen: false }).reason, /detectado no sensor/);
  assert.equal(teleportVerdict({ ...ok, hasSensor: false, seen: false }).ok, true, "sem sensor instalado, só o alcance conta");
  assert.match(teleportVerdict({ ...ok, interdicted: ["Vésper"] }).reason, /Interdição de Vésper/);
  assert.match(teleportVerdict({ ...ok, anchored: ["a Âncora \"Doca\""] }).reason, /Âncora/);
});

test("Leitura estável dos Módulos inimigos", () => {
  const modules = [
    { id: "a", name: "Reator", state: "online", hpPercent: 100 },
    { id: "b", name: "Propulsor", state: "damaged", hpPercent: 40 }
  ];
  const clean = moduleReadRows(modules, { quality: "clean", reachedStep3: true });
  assert.deepEqual(clean.map(r => r.read), ["operante", "danificado (40%)"]);
  assert.deepEqual(clean.map(r => r.tag), ["", ""]);
  const none = moduleReadRows(modules, { quality: "blocked", reachedStep3: false });
  assert.deepEqual(none.map(r => r.read), ["não lido", "não lido"]);
  assert.equal(moduleReadRows(modules, { quality: "clean", reachedStep3: false })[0].tag, "não lido", "sem o degrau 3 também");
  const blur = moduleReadRows(modules, { quality: "distorted", reachedStep3: true }, seededRng("x"));
  assert.ok(blur.every(r => r.tag === "pode estar errado"));
  // a mesma semente dá a mesma leitura
  const again = moduleReadRows(modules, { quality: "distorted", reachedStep3: true }, seededRng("x"));
  assert.deepEqual(blur, again);
  const rng = seededRng("abc");
  const values = [rng(), rng(), rng()];
  assert.ok(values.every(v => v >= 0 && v < 1));
  assert.notEqual(seededRng("abc")(), seededRng("abd")());
});

test("Validar Mundo: Região \"A bordo\" sem nave, com nave apagada ou com sala que não existe", async () => {
  const { aboardRegionIssues } = await import("../module/starship/boarding-rules.js");
  assert.equal(aboardRegionIssues({ shipUuid: "", shipExists: false }).length, 1);
  assert.match(aboardRegionIssues({ shipUuid: "Actor.x", shipExists: false })[0].message, /não existe mais/);
  assert.match(aboardRegionIssues({ shipUuid: "Actor.x", roomName: "Reator", roomFound: false })[0].message, /Módulo chamado "Reator"/);
  assert.equal(aboardRegionIssues({ shipUuid: "Actor.x", roomName: "", roomFound: false }).length, 0, "sem sala é corredor, sem problema");
  assert.equal(aboardRegionIssues({ shipUuid: "Actor.x", roomName: "Reator", roomFound: true }).length, 0);
});

test("removeDockBoarders: desacoplar tira só quem entrou por acoplagem", async () => {
  const { removeDockBoarders } = await import("../module/starship/boarding-rules.js");
  const list = [
    { actorUuid: "a", source: "dock" },
    { actorUuid: "b", source: "teleport" },
    { actorUuid: "c", source: "region" }
  ];
  const { kept, removed } = removeDockBoarders(list);
  assert.deepEqual(removed.map(b => b.actorUuid), ["a"]);
  assert.deepEqual(kept.map(b => b.actorUuid), ["b", "c"]);
  assert.deepEqual(removeDockBoarders(null), { kept: [], removed: [] });
});
