/**
 * Configuração de cenas por pasta (H20): leitura única com herança e cópia "do Foundry".
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCfg, legacyOwn, sceneOwn, folderChain, resolveField, resolveAll, resolvedValues, folderSubtreeIds,
  scenesWithOwn, diffOwn, fieldValueText, ownBannerText, folderConfigIssues, fieldDefault, SCENE_FIELD_KEYS
} from "../module/environment/scene-config-rules.js";
import { planCopy, copyConfirmLines, SCENE_COPY_FIELDS } from "../module/environment/scene-copy-rules.js";
import { validateTimeSetup } from "../module/world/world-validator.js";

const folders = new Map([
  ["root", { id: "root", name: "Estação Kalis", parentId: null, cfg: { lineId: "futuro", manaDensity: 0.5, radiation: 3 } }],
  ["deck", { id: "deck", name: "Convés", parentId: "root", cfg: { manaDensity: 2, hazards: [] } }],
  ["loose", { id: "loose", name: "Solto", parentId: null, cfg: {} }]
]);

test("Cena e pasta: valor próprio, pasta mais próxima, pastas acima e padrão", () => {
  const chain = folderChain("deck", folders);
  assert.deepEqual(chain.map(f => f.id), ["deck", "root"]);
  // próprio ganha
  assert.deepEqual(resolveField("manaDensity", { own: { manaDensity: 9 }, chain }), { value: 9, source: "own", from: null });
  // a pasta mais próxima manda; hazards [] da subpasta é valor (não "sem valor")
  assert.deepEqual(resolveField("manaDensity", { own: {}, chain }), { value: 2, source: "folder", from: { id: "deck", name: "Convés" } });
  assert.equal(resolveField("hazards", { own: {}, chain }).source, "folder");
  // o que a subpasta não define vem da de cima
  assert.deepEqual(resolveField("lineId", { own: {}, chain }), { value: "futuro", source: "folder", from: { id: "root", name: "Estação Kalis" } });
  // sem nada: padrão
  const none = resolveField("network", { own: {}, chain });
  assert.deepEqual(none, { value: false, source: "default", from: null });
  assert.equal(resolveAll({ own: {}, chain: [] }).lineId.value, "main");
  assert.deepEqual(resolvedValues({ own: { radiation: 0 }, chain }).radiation, 0, "0 próprio vence a pasta");
});

test("Cadeia de pastas: ciclo e pasta que sumiu não travam", () => {
  const loop = new Map([["a", { id: "a", name: "A", parentId: "b", cfg: {} }], ["b", { id: "b", name: "B", parentId: "a", cfg: {} }]]);
  assert.deepEqual(folderChain("a", loop).map(f => f.id), ["a", "b"]);
  assert.deepEqual(folderChain("zzz", folders), []);
  assert.deepEqual(folderChain(null, folders), []);
});

test("Valores gravados: só chaves conhecidas e válidas; 0, false e [] são valores", () => {
  assert.deepEqual(normalizeCfg({ radiation: 0, network: false, hazards: [], lixo: 1, manaDensity: "", lineId: "  " }), { radiation: 0, network: false, hazards: [] });
  assert.deepEqual(normalizeCfg({ manaDensity: "1.5", hazards: [{ conditionId: "x" }, { conditionId: "" }] }).manaDensity, 1.5);
  assert.equal(normalizeCfg({ hazards: [{ conditionId: "x" }, {}] }).hazards.length, 1);
  assert.deepEqual(normalizeCfg(null), {});
});

test("Flags antigas: só o que não é o vazio de antes conta como valor próprio", () => {
  assert.deepEqual(legacyOwn({ lineId: "main", network: false }, { hazards: [], manaDensity: null, radiation: 0, clockDarkness: false, fxPlaying: [] }), {});
  assert.deepEqual(
    legacyOwn({ lineId: "passado", network: true }, { hazards: [{ conditionId: "vacuum" }], manaDensity: 0, radiation: 4, clockDarkness: true }),
    { lineId: "passado", network: true, hazards: [{ conditionId: "vacuum", immuneTraits: [], fx: "", fxParticle: "", fxFilter: "", fxColor: "" }], manaDensity: 0, radiation: 4, clockDarkness: true }
  );
  // o sceneCfg novo manda sobre a flag antiga
  assert.equal(sceneOwn({ radiation: 0 }, null, { radiation: 7 }).radiation, 0);
  assert.equal(sceneOwn({}, null, { radiation: 7 }).radiation, 7);
});

test("Subpastas, resumo de cenas com valor próprio e diferença de gravação", () => {
  const list = [...folders.values()];
  assert.deepEqual([...folderSubtreeIds("root", list)].sort(), ["deck", "root"]);
  assert.deepEqual([...folderSubtreeIds("loose", list)], ["loose"]);
  const rows = scenesWithOwn([
    { id: "1", name: "Zeta", own: { radiation: 1 } },
    { id: "2", name: "Alfa", own: { lineId: "x", network: true } },
    { id: "3", name: "Beta", own: {} }
  ]);
  assert.deepEqual(rows.map(r => r.name), ["Alfa", "Zeta"]);
  assert.deepEqual(rows[0].fields, ["lineId", "network"]);
  const diff = diffOwn({ radiation: 1, network: true }, { radiation: 2, lineId: "x" });
  assert.deepEqual(diff, { set: { radiation: 2, lineId: "x" }, remove: ["network"] });
  assert.deepEqual(diffOwn({ hazards: [] }, { hazards: [] }), { set: {}, remove: [] });
});

test("Textos curtos, padrões e aviso do Validar Mundo", () => {
  assert.equal(fieldValueText("manaDensity", 2), "Mana ×2");
  assert.equal(fieldValueText("lineId", "p1", { lineName: "Passado" }), "linha Passado");
  assert.equal(fieldValueText("hazards", [{}, {}]), "2 perigo(s)");
  assert.equal(ownBannerText(0), "");
  assert.equal(ownBannerText(1), "1 campo com valor próprio");
  assert.equal(ownBannerText(3), "3 campos com valor próprio");
  assert.deepEqual(fieldDefault("hazards"), []);
  assert.notEqual(fieldDefault("hazards"), fieldDefault("hazards"), "cada chamada devolve uma lista nova");
  assert.equal(SCENE_FIELD_KEYS.length, 7);
  assert.equal(folderConfigIssues([{ name: "Kalis", cfg: { lineId: "morta" } }, { name: "Ok", cfg: { lineId: "main" } }], ["futuro"]).length, 1);
  const issues = validateTimeSetup({ timelines: [{ id: "futuro", name: "F", rate: 1 }], folders: [{ name: "Kalis", lineId: "morta" }, { name: "Ok", lineId: "futuro" }] });
  assert.equal(issues.length, 1);
  assert.match(issues[0].where, /Pasta de cenas "Kalis"/);
});

test("Cópia do Foundry: o que muda em cada cena, por versão do Foundry", () => {
  const v14 = { tokenVision: true, grid: { distance: 1.5, units: "m" }, environment: { darknessLevel: 0, globalLight: { enabled: false } }, fog: { mode: 1 }, playlist: null };
  const v14b = { ...v14, tokenVision: false, environment: { darknessLevel: 0.5, globalLight: { enabled: true } } };
  const scenes = [{ id: "a", name: "A", source: v14 }, { id: "b", name: "B", source: v14b }];
  const plan = planCopy(scenes, { tokenVision: true, globalLight: true, darkness: 0.5 }, 14);
  const byKey = Object.fromEntries(plan.fields.map(f => [f.key, f]));
  assert.deepEqual([byKey.tokenVision.changes, byKey.tokenVision.same], [1, 1]);
  assert.deepEqual([byKey.globalLight.changes, byKey.globalLight.same], [1, 1]);
  assert.deepEqual([byKey.darkness.changes, byKey.darkness.same], [1, 1]);
  const a = plan.updates.find(u => u.id === "a").update;
  assert.equal(a["environment.darknessLevel"], 0.5);
  assert.equal(a["environment.cycle"], false, "V14: o ciclo do núcleo não pode mandar na escuridão");
  assert.ok(!("tokenVision" in a), "o que já está igual não é reescrito");
  assert.deepEqual(plan.updates.find(u => u.id === "b").update, { tokenVision: true }, "a cena B só muda a Visão de Token");

  // V13: nomes antigos
  const v13 = { tokenVision: true, darkness: 0, fog: { exploration: true }, playlist: "", environment: { globalLight: { enabled: false } }, grid: { distance: 5, units: "ft" } };
  const p13 = planCopy([{ id: "c", name: "C", source: v13 }], { darkness: 0.8, fog: false, gridScale: { distance: 1.5, units: "m" }, playlist: "pl1" }, 13);
  const u = p13.updates[0].update;
  assert.equal(u.darkness, 0.8);
  assert.equal(u["fog.exploration"], false);
  assert.equal(u["grid.distance"], 1.5);
  assert.equal(u["grid.units"], "m");
  assert.equal(u.playlist, "pl1");
  assert.ok(!("environment.cycle" in u));
  // V14: névoa pelo modo
  assert.equal(planCopy([{ id: "d", name: "D", source: { fog: { mode: 0 } } }], { fog: true }, 14).updates[0].update["fog.mode"], 1);
  // sem marcar nada, nada muda; campo desconhecido é ignorado
  assert.equal(planCopy(scenes, {}, 14).updates.length, 0);
  assert.equal(planCopy(scenes, { inventado: 1 }, 14).fields.length, 0);
  assert.equal(SCENE_COPY_FIELDS.length, 6);
});

test("Cópia do Foundry: texto da confirmação", () => {
  const plan = { fields: [{ label: "Visão de Token", changes: 3, same: 1 }, { label: "Luz global", changes: 0, same: 4 }] };
  assert.deepEqual(copyConfirmLines(plan, 4), ["Visão de Token: sobrescreve 3 de 4 cena(s)", "Luz global: nenhuma cena muda (as 4 já estão assim)"]);
});
