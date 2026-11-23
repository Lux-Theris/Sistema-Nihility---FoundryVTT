/**
 * Deslocamento, geometria de Estruturas, luzes, ataque atravessando Estrutura e áreas de Skill.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  NIHILITY,
  movementAllowance,
  describeMovement,
  getMovementConfig,
  isStructureMechanic,
  migrateStructureTarget,
  normalizeLightConfig
} from "../module/core/config.js";
import {
  capPolyline,
  polylineLength,
  structureSegments,
  pointsAlongPolyline,
  segmentCrossing,
  firstStructureOnPath,
  splitStructureHit,
  pointInSegments,
  segmentsCross,
  distanceToSegments,
  touchesSegments,
  structureMaterial,
  structureManaPowered,
  structureLetsPass,
  structureRegenStep,
  antimagicStructureOutcome,
  areaTouchesStructure
} from "../module/structures/structure-geometry.js";
import {
  areaFromSkill,
  normalizeArea,
  areaContains,
  areaPolygon,
  tokenDocCenter,
  areaFromTemplateData,
  zoneDocumentData
} from "../module/combat/area-geometry.js";

/* -------------------------------------------- */
/*  Deslocamento por rodada                      */
/* -------------------------------------------- */

const MOVE_CFG = { base: 6, step: 10, cap: 18 };

test("deslocamento: base + 1 m a cada passo de Destreza permanente", () => {
  assert.equal(movementAllowance({ permanentDexterity: 0 }, MOVE_CFG).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: 9 }, MOVE_CFG).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: 10 }, MOVE_CFG).total, 7);
  assert.equal(movementAllowance({ permanentDexterity: 24 }, MOVE_CFG).total, 8);
  assert.equal(movementAllowance({ permanentDexterity: 30 }, MOVE_CFG).total, 9);
});

test("deslocamento: a Destreza permanente para no teto", () => {
  const atCap = movementAllowance({ permanentDexterity: 120 }, MOVE_CFG);
  assert.equal(atCap.total, 18);
  assert.equal(atCap.capped, true);
  assert.equal(movementAllowance({ permanentDexterity: 999 }, MOVE_CFG).total, 18);
  assert.equal(movementAllowance({ permanentDexterity: 30 }, MOVE_CFG).capped, false);
});

test("deslocamento: Destreza de Skill passa por cima do teto (exemplo do Mestre: 20 m, 200 de Destreza, +10 de Skill = 21 m)", () => {
  const cfg = { base: 14, step: 10, cap: 20 };
  assert.equal(movementAllowance({ permanentDexterity: 200 }, cfg).total, 20);
  const boosted = movementAllowance({ permanentDexterity: 200, skillDexterity: 10 }, cfg);
  assert.equal(boosted.total, 21);
  assert.equal(boosted.fromSkills, 1);
});

test("deslocamento: Skill que reduz Destreza reduz o deslocamento, sem passar de zero", () => {
  assert.equal(movementAllowance({ permanentDexterity: 24, skillDexterity: -10 }, MOVE_CFG).total, 7);
  // Menos que um passo não muda nada (e não vira -0).
  assert.equal(Object.is(movementAllowance({ permanentDexterity: 24, skillDexterity: -5 }, MOVE_CFG).fromSkills, 0), true);
  assert.equal(movementAllowance({ permanentDexterity: 0, skillDexterity: -500 }, MOVE_CFG).total, 0);
});

test("deslocamento: configuração absurda não quebra (passo zero, teto abaixo da base)", () => {
  assert.equal(movementAllowance({ permanentDexterity: 5 }, { base: 6, step: 0, cap: 18 }).total, 11);
  assert.equal(movementAllowance({ permanentDexterity: 500 }, { base: 6, step: 10, cap: 2 }).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: -20 }, MOVE_CFG).total, 6);
});

test("deslocamento: descrição da ficha diz de onde vem o número", () => {
  const text = describeMovement(movementAllowance({ permanentDexterity: 24, skillDexterity: 10 }, MOVE_CFG));
  assert.equal(text.total, 9);
  assert.match(text.title, /6 base \+ 2 de Destreza \+ 1 de Skills/);
  assert.equal(describeMovement(null), null);
});

test("deslocamento: sem settings registradas, a configuração cai nos padrões da tabela", () => {
  assert.deepEqual(getMovementConfig(), { base: 6, step: 10, cap: 18, gmIgnores: true });
});

test("deslocamento: efeito percentual vale sobre o total", () => {
  assert.equal(movementAllowance({ permanentDexterity: 24, percent: -50 }, MOVE_CFG).total, 4);
  assert.equal(movementAllowance({ permanentDexterity: 24, percent: -100 }, MOVE_CFG).total, 0);
});

/* -------------------------------------------- */
/*  Estruturas: geometria                        */
/* -------------------------------------------- */

test("estrutura: traçado livre para no comprimento máximo", () => {
  const capped = capPolyline([[0, 0], [100, 0], [100, 100]], 150);
  assert.deepEqual(capped, [[0, 0], [100, 0], [100, 50]]);
  assert.equal(polylineLength(capped), 150);
});

test("estrutura: linha usa só início e fim, cortada no tamanho", () => {
  assert.deepEqual(structureSegments("line", [[0, 0], [500, 0], [999, 999]], 200), [[0, 0, 200, 0]]);
});

test("estrutura: forma livre em L vira dois segmentos", () => {
  assert.deepEqual(structureSegments("free", [[0, 0], [100, 0], [100, 100]], 1000), [[0, 0, 100, 0], [100, 0, 100, 100]]);
});

test("estrutura: quadrado fecha 4 lados; círculo vira polígono fechado", () => {
  assert.equal(structureSegments("rect", [[0, 0]], 100).length, 4);
  const circle = structureSegments("circle", [[0, 0]], 100, 16);
  assert.equal(circle.length, 16);
  assert.deepEqual(circle[0].slice(0, 2), circle.at(-1).slice(2, 4));
});

test("estrutura: sem ponto ou tamanho, nenhuma parede", () => {
  assert.deepEqual(structureSegments("free", [[0, 0]], 100), []);
  assert.deepEqual(structureSegments("circle", [], 100), []);
  assert.deepEqual(structureSegments("line", [[0, 0], [10, 0]], 0), []);
});

test("Estrutura: é Mecânica ao Usar, e a forma de 1.37 (Tipo de Alvo) é convertida", () => {
  assert.equal(isStructureMechanic({ effectType: "structure" }), true);
  assert.equal(isStructureMechanic({ effectType: "damage", targetType: "structure" }), true);
  assert.equal(isStructureMechanic({ effectType: "damage", targetType: "targeted" }), false);
  const legacy = migrateStructureTarget({ effectType: "none", targetType: "structure", structureId: "stone-wall" });
  assert.deepEqual(legacy, { effectType: "structure", targetType: "targeted", structureId: "stone-wall" });
  assert.ok(!NIHILITY.SKILL_TARGET_TYPES.includes("structure"));
  assert.ok(NIHILITY.SKILL_EFFECT_TYPES.includes("structure"));
});

test("luz: sem 'enabled' não há luz; valores fora da faixa são limitados", () => {
  assert.equal(normalizeLightConfig(null), null);
  assert.equal(normalizeLightConfig({ enabled: false, color: "#ff0000" }), null);
  const light = normalizeLightConfig({ enabled: true, color: "vermelho", alpha: 3, dim: 4, bright: 9, speed: 50, intensity: -2, animation: "energy" });
  assert.deepEqual(light, { enabled: true, color: "#6ee7ff", alpha: 1, dim: 4, bright: 4, animation: "energy", speed: 10, intensity: 1 });
  // Raio 0 = automático: a luz forte não é cortada por um raio fraco que ainda não existe.
  assert.equal(normalizeLightConfig({ enabled: true, dim: 0, bright: 2 }).bright, 2);
});

test("luzes ao longo da parede: espalhadas por igual pelo comprimento", () => {
  assert.deepEqual(pointsAlongPolyline([[0, 0], [100, 0]], 2), [[25, 0], [75, 0]]);
  // Linha quebrada: o meio de 200 de comprimento cai na quina.
  assert.deepEqual(pointsAlongPolyline([[0, 0], [100, 0], [100, 100]], 1), [[100, 0]]);
  assert.deepEqual(pointsAlongPolyline([[5, 5]], 3), [[5, 5]]);
  assert.deepEqual(pointsAlongPolyline([], 3), []);
});

test("ataque atravessando Estrutura: acha a primeira no caminho", () => {
  assert.equal(segmentCrossing([0, 0], [100, 0], [50, -10, 50, 10]), 0.5);
  assert.equal(segmentCrossing([0, 0], [40, 0], [50, -10, 50, 10]), null); // para antes da parede
  assert.equal(segmentCrossing([0, 0], [100, 0], [0, 5, 100, 5]), null); // paralela
  const walls = [
    { id: "longe", segments: [[80, -10, 80, 10]] },
    { id: "perto", segments: [[30, -10, 30, 10]] }
  ];
  assert.deepEqual(firstStructureOnPath([0, 0], [100, 0], walls), { id: "perto", t: 0.3 });
  // Alvo e atacante dentro do mesmo quadrado: nada cruza.
  const box = { id: "caixa", segments: [[0, 0, 100, 0], [100, 0, 100, 100], [100, 100, 0, 100], [0, 100, 0, 0]] };
  assert.equal(firstStructureOnPath([20, 20], [80, 80], [box]), null);
  assert.equal(firstStructureOnPath([-50, 50], [50, 50], [box]).id, "caixa");
});

test("Estrutura segura até a capacidade e o resto passa", () => {
  assert.deepEqual(splitStructureHit(117, 60), { absorbed: 60, passed: 57 });
  assert.deepEqual(splitStructureHit(40, 60), { absorbed: 40, passed: 0 });
  assert.deepEqual(splitStructureHit(30, 0), { absorbed: 0, passed: 30 });
});

test("Geometria: ponto dentro de forma fechada e cruzamento de segmentos", () => {
  const square = [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]];
  assert.equal(pointInSegments([5, 5], square), true);
  assert.equal(pointInSegments([15, 5], square), false);
  assert.equal(segmentsCross([[-5, 5, 5, 5]], square), true);
  assert.equal(segmentsCross([[2, 2, 8, 8]], square), false);
});

test("Área de Skill: círculo, cone e linha decidem quem está dentro sem Measured Template", () => {
  const grid = { pxPerUnit: 50, cellPx: 100 }; // célula de 100 px = 2 m
  const circle = areaFromSkill({ areaShape: "circle", areaDistance: 4 }, { x: 0, y: 0 }, grid);
  assert.equal(circle.radius, 200, "4 m × 50 px/m");
  assert.ok(areaContains(circle, { x: 0, y: 0 }), "o centro do círculo conta");
  assert.ok(areaContains(circle, { x: 200, y: 0 }), "a borda conta");
  assert.ok(!areaContains(circle, { x: 150, y: 150 }), "fora do raio na diagonal");

  // Cone de 90° apontando para baixo (90° = sul, porque o y do canvas cresce para baixo).
  const cone = areaFromSkill({ areaShape: "cone", areaDistance: 6, areaAngle: 90 }, { x: 0, y: 0 }, { ...grid, direction: 90 });
  assert.ok(areaContains(cone, { x: 0, y: 200 }), "no eixo");
  assert.ok(areaContains(cone, { x: 100, y: 120 }), "dentro da abertura");
  assert.ok(!areaContains(cone, { x: 200, y: 100 }), "fora da abertura");
  assert.ok(!areaContains(cone, { x: 0, y: -100 }), "atrás de quem lança");
  assert.ok(!areaContains(cone, { x: 0, y: 0 }), "o vértice (quem lança) não é atingido");
  assert.ok(!areaContains(cone, { x: 0, y: 301 }), "além do alcance");

  // Cone atravessando o 0°: direção 350, abertura 60 → cobre de 320 a 20.
  const wrap = normalizeArea({ shape: "cone", x: 0, y: 0, radius: 100, angle: 60, direction: 350 });
  assert.ok(areaContains(wrap, { x: 50, y: 10 }), "ângulo 11° fica dentro de um cone que passa pelo 0°");

  // Linha para a direita, largura de uma célula (100 px), 8 m.
  const ray = areaFromSkill({ areaShape: "ray", areaDistance: 8 }, { x: 0, y: 0 }, grid);
  assert.equal(ray.width, 100);
  assert.ok(areaContains(ray, { x: 399, y: 49 }), "dentro do retângulo");
  assert.ok(!areaContains(ray, { x: 200, y: 60 }), "mais longe que meia largura do eixo");
  assert.ok(!areaContains(ray, { x: -10, y: 0 }), "atrás da origem");
  assert.ok(!areaContains(ray, { x: 401, y: 0 }), "além do comprimento");

  assert.throws(() => areaFromSkill({ areaShape: "" }, { x: 0, y: 0 }, grid), "Skill sem formato não vira área");
});

test("Área de Skill: normalização (payload do relay), polígono, Token e Zona por versão", () => {
  assert.equal(normalizeArea({ shape: "rect" }), null, "forma desconhecida é recusada");
  const wild = normalizeArea({ shape: "cone", x: "abc", y: 5e9, radius: -3, angle: 9999, direction: -90 });
  assert.deepEqual(wild, { shape: "cone", x: 0, y: 1e6, radius: 0, angle: 360, direction: 270, width: 0, elevation: 0 });

  const ray = normalizeArea({ shape: "ray", x: 0, y: 0, radius: 300, direction: 0, width: 100 });
  assert.deepEqual(areaPolygon(ray), [0, 50, 300, 50, 300, -50, 0, -50]);
  const cone = normalizeArea({ shape: "cone", x: 0, y: 0, radius: 100, angle: 90, direction: 0 });
  const pts = areaPolygon(cone);
  assert.deepEqual(pts.slice(0, 2), [0, 0], "o polígono do cone começa no vértice");
  for (let i = 2; i < pts.length; i += 2) {
    assert.ok(Math.abs(Math.hypot(pts[i], pts[i + 1]) - 100) < 0.05, "os pontos do arco ficam no raio");
  }

  assert.deepEqual(tokenDocCenter({ x: 100, y: 200, width: 2, height: 1 }, 100), { x: 200, y: 250 });

  // Zona salva na V13 antes desta versão (template em metros) volta para pixels.
  const legacy = areaFromTemplateData({ t: "ray", x: 0, y: 0, distance: 8, direction: 0, width: 2 }, 50);
  assert.deepEqual(legacy, { shape: "ray", x: 0, y: 0, radius: 400, angle: 0, direction: 0, width: 100, elevation: 0 });
  assert.equal(areaFromTemplateData({ t: "rect" }, 50), null);

  const flags = { x: 1 };
  const v14 = zoneDocumentData(cone, { generation: 14, pxPerUnit: 50, color: "#00ff00", name: "Névoa", flags, visibility: 2 });
  assert.equal(v14.documentName, "Region", "V14 não tem mais MeasuredTemplate");
  assert.equal(v14.data.shapes[0].type, "polygon", "cone vira polígono — a forma desenhada é a que o sistema testa");
  assert.equal(v14.data.flags, flags);
  const circleV14 = zoneDocumentData(normalizeArea({ shape: "circle", x: 10, y: 20, radius: 150 }), { generation: 14, pxPerUnit: 50 });
  assert.deepEqual(circleV14.data.shapes, [{ type: "circle", x: 10, y: 20, radius: 150 }]);
  const v13 = zoneDocumentData(ray, { generation: 13, pxPerUnit: 50, color: "#00ff00", flags });
  assert.equal(v13.documentName, "MeasuredTemplate");
  assert.deepEqual([v13.data.t, v13.data.distance, v13.data.width], ["ray", 6, 2], "de volta a metros na V13");
});

test("Estrutura: encostar na parede (distância do centro ao segmento)", () => {
  const wall = [[0, 0, 100, 0]];
  assert.equal(distanceToSegments([50, 30], wall), 30);
  assert.equal(distanceToSegments([-30, 40], wall), 50); // além da ponta
  assert.equal(distanceToSegments([1, 1], []), Infinity);
  assert.equal(touchesSegments([50, 30], 25, wall, 5), true);
  assert.equal(touchesSegments([50, 40], 25, wall, 5), false);
});

test("Estrutura: material e Vida-vem-da-Mana com valores antigos", () => {
  assert.equal(structureMaterial("physical", 0), "physical");
  assert.equal(structureMaterial(undefined, 0), "ethereal");
  assert.equal(structureMaterial(undefined, 60), "physical");
  assert.equal(structureManaPowered(false, 0, true), false);
  assert.equal(structureManaPowered(undefined, 0, true), true);
  assert.equal(structureManaPowered(undefined, 0, false), false);
  assert.equal(structureManaPowered(undefined, 30, true), false);
});

test("Estrutura: quem atravessa a barreira", () => {
  const base = { casterDisposition: 1, attackerDisposition: 1 };
  assert.equal(structureLetsPass({ material: "physical", isCaster: true, ...base }), false);
  assert.equal(structureLetsPass({ material: "ethereal", isCaster: true, ...base }), true);
  assert.equal(structureLetsPass({ material: "ethereal", isCaster: false, ...base }), true);
  assert.equal(structureLetsPass({ material: "ethereal", isCaster: false, casterDisposition: 1, attackerDisposition: -1 }), false);
  // Registro antigo sem disposição: só quem ergueu passa.
  assert.equal(structureLetsPass({ material: "ethereal", isCaster: false, attackerDisposition: 1 }), false);
  assert.equal(structureLetsPass({ material: "ethereal", isCaster: true, attackerDisposition: 1 }), true);
});

test("Estrutura: regeneração paga só se ferida e com energia, sem passar do teto", () => {
  assert.deepEqual(structureRegenStep({ hp: 10, hpMax: 60, regen: 20, cost: 5, energy: 9 }), { hp: 30, paid: 5 });
  assert.deepEqual(structureRegenStep({ hp: 50, hpMax: 60, regen: 20, cost: 5, energy: 9 }), { hp: 60, paid: 5 });
  assert.deepEqual(structureRegenStep({ hp: 60, hpMax: 60, regen: 20, cost: 5, energy: 9 }), { hp: 60, paid: 0 });
  assert.deepEqual(structureRegenStep({ hp: 10, hpMax: 60, regen: 20, cost: 5, energy: 4 }), { hp: 10, paid: 0 });
  assert.deepEqual(structureRegenStep({ hp: 10, hpMax: 60, regen: 0, cost: 5, energy: 9 }), { hp: 10, paid: 0 });
});

/* -------------------------------------------- */
/*  Antimagia contra Estruturas                  */
/* -------------------------------------------- */

test("Antimagia: o que acontece com cada Estrutura", () => {
  const base = { level: 3, reach: 5 };
  // Etérea mágica some; etérea só mantida por Skill também.
  assert.equal(antimagicStructureOutcome({ ...base, magic: true, material: "ethereal" }), "remove");
  assert.equal(antimagicStructureOutcome({ ...base, sustained: true, material: "ethereal" }), "remove");
  // Física mantida por Skill perde o sustento (Vida 1); a mágica solta também.
  assert.equal(antimagicStructureOutcome({ ...base, sustained: true, material: "physical" }), "unsupport");
  assert.equal(antimagicStructureOutcome({ ...base, magic: true, material: "physical" }), "remove", "física mágica erguida uma vez: some");
  assert.equal(antimagicStructureOutcome({ ...base, magic: true, sustained: true, material: "physical" }), "unsupport", "física mágica sustentada: Vida 1");
  // Matéria de verdade, sem magia nem Skill por trás: fica.
  assert.equal(antimagicStructureOutcome({ ...base, material: "physical" }), "keep");
  assert.equal(antimagicStructureOutcome({ ...base, material: "ethereal" }), "keep");
  // Barreira de Mana sempre some.
  assert.equal(antimagicStructureOutcome({ ...base, manaPowered: true, material: "physical" }), "remove");
  // Nível maior que o alcance resiste; igual não.
  assert.equal(antimagicStructureOutcome({ magic: true, material: "ethereal", level: 6, reach: 5 }), "keep");
  assert.equal(antimagicStructureOutcome({ magic: true, material: "ethereal", level: 5, reach: 5 }), "remove");
  assert.equal(antimagicStructureOutcome({ magic: true, material: "ethereal", reach: 1 }), "remove", "registro sem nível conta 0");
});

test("Antimagia: a área toca a Estrutura?", () => {
  const wall = [[100, 0, 100, 200]];
  const circleBox = [[0, 0, 300, 0], [300, 0, 300, 300], [300, 300, 0, 300], [0, 300, 0, 0]];
  const near = normalizeArea({ shape: "circle", x: 60, y: 100, radius: 50, angle: 0, direction: 0, width: 0 });
  const far = normalizeArea({ shape: "circle", x: -200, y: 100, radius: 50, angle: 0, direction: 0, width: 0 });
  assert.equal(areaTouchesStructure(near, wall), true);
  assert.equal(areaTouchesStructure(far, wall), false);
  // Linha que cruza o muro sem ter nenhum ponto do muro por perto do eixo.
  const ray = normalizeArea({ shape: "ray", x: 0, y: 100, radius: 400, angle: 0, direction: 0, width: 10 });
  assert.equal(areaTouchesStructure(ray, wall), true);
  // Dentro de uma forma fechada, sem encostar nas bordas: conta pela origem.
  const inside = normalizeArea({ shape: "circle", x: 150, y: 150, radius: 10, angle: 0, direction: 0, width: 0 });
  assert.equal(areaTouchesStructure(inside, circleBox, true), true);
  assert.equal(areaTouchesStructure(inside, circleBox, false), false);
});

/* -------------------------------------------- */
/*  Quem a área atinge (1.89.2)                  */
/* -------------------------------------------- */

test("areaAffectsTarget: todos, menos quem lançou, aliados, inimigos e mortos", async () => {
  const { areaAffectsTarget } = await import("../module/combat/area-geometry.js");
  const FRIEND = 1, HOSTILE = -1;
  const self = { isCaster: true, casterDisposition: FRIEND, disposition: FRIEND };
  const ally = { isCaster: false, casterDisposition: FRIEND, disposition: FRIEND };
  const foe = { isCaster: false, casterDisposition: FRIEND, disposition: HOSTILE };
  // Padrão (e Skill salva antes, sem o campo): todo mundo, inclusive quem lançou.
  for (const who of [self, ally, foe]) {
    assert.equal(areaAffectsTarget({ ...who }), true);
    assert.equal(areaAffectsTarget({ ...who, affects: "all" }), true);
  }
  assert.deepEqual([self, ally, foe].map(w => areaAffectsTarget({ ...w, affects: "notCaster" })), [false, true, true]);
  assert.deepEqual([self, ally, foe].map(w => areaAffectsTarget({ ...w, affects: "allies" })), [true, true, false]);
  assert.deepEqual([self, ally, foe].map(w => areaAffectsTarget({ ...w, affects: "enemies" })), [false, false, true]);
  // Morto nunca, em modo nenhum.
  for (const affects of ["all", "notCaster", "allies", "enemies"]) assert.equal(areaAffectsTarget({ ...foe, affects, dead: true }), false);
  // Sem saber o lado de quem lançou: aliados/inimigos viram "menos quem lançou".
  assert.equal(areaAffectsTarget({ isCaster: false, affects: "allies", casterDisposition: null, disposition: HOSTILE }), true);
  assert.equal(areaAffectsTarget({ isCaster: true, affects: "enemies", casterDisposition: null, disposition: FRIEND }), false);
  // Valor desconhecido = todos.
  assert.equal(areaAffectsTarget({ ...self, affects: "banana" }), true);
});

test("skillSummary diz quem a área atinge", async () => {
  const { skillSummary } = await import("../module/skills/skill-summary.js");
  const base = { effectType: "damage", damageFormula: "2d6", targetType: "zone", areaShape: "circle", areaDistance: 3, zoneRounds: 2 };
  assert.match(skillSummary({ ...base, areaAffects: "notCaster" }), /poupa você/);
  assert.match(skillSummary({ ...base, areaAffects: "allies" }), /só aliados/);
  assert.doesNotMatch(skillSummary({ ...base, areaAffects: "all" }), /poupa|só /);
});
