import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  SIGNATURE_BY_RANK, baseSignature, energyBonus, signatureBreakdown, sensorRangeNow, sensorResolutionNow, detectLimit, detects,
  sensorBlindReason, strongestBlock, scanQuality, scanMaxStep, bandOf, buildScanReading, analysisResolution, nextPicture, ageContacts,
  samePicture, shipHiddenBySensors, lastContactText, contactStatus, wrongModuleState, fireSignatureActive, moduleSensorIssues, shipSensorIssues
} from "../module/starship/sensor-rules.js";

const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("Assinatura: base pelo Porte, energia no ativo e no passivo, disparo e Camuflagem", () => {
  assert.equal(SIGNATURE_BY_RANK.length, 5);
  assert.equal(baseSignature(2), 100);
  assert.equal(baseSignature(99), 200, "fora da tabela usa a ponta");
  assert.equal(baseSignature(-3), 40);
  // consumo no teto da geração = +20 ativo / +4 passivo; metade = metade
  assert.equal(energyBonus({ consumption: 400, supply: 400, mode: "active" }), 20);
  assert.equal(energyBonus({ consumption: 400, supply: 400, mode: "passive" }), 4);
  assert.equal(energyBonus({ consumption: 200, supply: 400, mode: "active" }), 10);
  assert.equal(energyBonus({ consumption: 900, supply: 400 }), 20, "acima do teto não passa de 20");
  assert.equal(energyBonus({ consumption: 0, supply: 400 }), 0);
  assert.equal(energyBonus({ consumption: 50, supply: 0 }), 20, "sem geração com consumo = carga cheia");
  // o exemplo do mockup: Médio 100 + 20 ativo, +50 disparo = 170
  assert.equal(signatureBreakdown({ rank: 2, consumption: 100, supply: 100, mode: "active" }).total, 120);
  assert.equal(signatureBreakdown({ rank: 2, consumption: 100, supply: 100, mode: "passive" }).total, 104);
  const fired = signatureBreakdown({ rank: 2, consumption: 100, supply: 100, mode: "active", fire: 50 });
  assert.equal(fired.total, 170);
  assert.deepEqual(fired.segments.map(s => s.id), ["base", "energy", "fire"]);
  // Camuflagem troca base e consumo pelo alvo; o disparo ainda soma
  const hidden = signatureBreakdown({ rank: 4, consumption: 999, supply: 100, camouflage: { active: true, target: 10 }, fire: 50 });
  assert.equal(hidden.total, 60);
  assert.deepEqual(hidden.segments.map(s => s.id), ["camouflage", "fire"]);
  assert.equal(signatureBreakdown({ rank: 2, camouflage: { active: false, target: 10 } }).total, 100);
  // Skill pode subir ou descer; nunca abaixo de 0
  assert.equal(signatureBreakdown({ rank: 2, extra: -150 }).total, 0);
  assert.equal(signatureBreakdown({ rank: 2, extra: 25 }).total, 125);
});

test("Detecção: alcance x Assinatura, modo passivo, Interferência e cegueira", () => {
  // exemplo do plano: sensor 1000 vê cargueiro a 150% a 1500, normal a 1000, camuflada (10%) só a 100
  assert.equal(detectLimit(1000, 150), 1500);
  assert.equal(detectLimit(1000, 100), 1000);
  assert.equal(detectLimit(1000, 10), 100);
  assert.equal(detects({ distance: 1500, range: 1000, signature: 150 }), true);
  assert.equal(detects({ distance: 1500.5, range: 1000, signature: 150 }), false);
  assert.equal(detects({ distance: 120, range: 1000, signature: 10 }), false);
  assert.equal(detects({ distance: 10, range: 0, signature: 500 }), false, "sensor cego não vê nada");
  // passivo = 50%; Interferência 40% corta 1000 para 600; 100% = cego
  assert.equal(sensorRangeNow({ range: 1000, mode: "passive" }), 500);
  assert.equal(sensorRangeNow({ range: 1000, interference: 40 }), 600);
  assert.equal(sensorRangeNow({ range: 1000, mode: "passive", interference: 40 }), 300);
  assert.equal(sensorRangeNow({ range: 1000, interference: 100 }), 0);
  assert.equal(sensorRangeNow({ range: 1000, blind: true }), 0);
  assert.equal(sensorRangeNow({ range: 1000, mode: "passive", tuning: { passiveFactor: 25 } }), 250, "afinação por parâmetro");
  assert.equal(sensorResolutionNow({ resolution: 6, mode: "passive" }), 3);
  assert.equal(sensorResolutionNow({ resolution: 6 }), 6);
  assert.equal(sensorResolutionNow({ resolution: 99 }), 10);
  assert.equal(sensorBlindReason({}), "");
  assert.match(sensorBlindReason({ online: false }), /PEM/);
  assert.match(sensorBlindReason({ powered: false }), /energia/);
  assert.match(sensorBlindReason({ techField: true }), /Interferência/);
  assert.match(sensorBlindReason({ interference: 100 }), /total/);
  assert.match(sensorBlindReason({ hp: 0 }), /destruído/);
});

test("Escanear: Resolução - Bloqueio decide limpa, distorcida ou bloqueada", () => {
  assert.deepEqual(scanQuality(6, 3), { quality: "clean", margin: 3 });
  assert.deepEqual(scanQuality(6, 4), { quality: "distorted", margin: 2 });
  assert.deepEqual(scanQuality(6, 6), { quality: "distorted", margin: 0 });
  assert.deepEqual(scanQuality(6, 8), { quality: "blocked", margin: -2 });
  assert.equal(scanQuality(6, 3, { cleanMargin: 4 }).quality, "distorted", "a margem é afinável");
  // a camada mais forte conta; Escudo só conta de pé
  const layers = [
    { id: "shield", label: "Escudo", value: 4, counts: false },
    { id: "armor", label: "Blindagem", value: 3, counts: true },
    { id: "scanBlock", label: "Bloqueio de varredura", value: 0, counts: true }
  ];
  assert.deepEqual(strongestBlock(layers), { id: "armor", label: "Blindagem", value: 3 });
  assert.equal(strongestBlock([]).value, 0);
  assert.equal(strongestBlock([{ id: "x", label: "X", value: 8 }, { id: "y", label: "Y", value: 5 }]).id, "x");
  assert.equal(scanMaxStep("clean"), 5);
  assert.equal(scanMaxStep("blocked"), 1);
  assert.equal(scanMaxStep("clean", true), 2, "passivo: no máximo o degrau 2");
  assert.equal(scanMaxStep("blocked", true), 1);
  assert.equal(analysisResolution({ level: 3, perception: 25, step: 10 }), 5);
  assert.equal(analysisResolution({ level: 30, perception: 50, step: 10 }), 10);
});

const REAL = {
  sizeLabel: "Médio",
  className: "Cargueiro",
  shield: { value: 0, max: 400 },
  casco: { value: 520, max: 600 },
  hullPercent: 87,
  modules: [
    { name: "Reator", state: "online", hpPercent: 100 },
    { name: "Propulsor", state: "damaged", hpPercent: 40 }
  ],
  weapons: [{ name: "Torreta de Pulso", penetration: 12 }, { name: "Torreta de Pulso", penetration: 12 }],
  cargo: { value: 38, max: 60 },
  crew: 9
};

test("Leitura limpa mostra os cinco degraus com os números reais", () => {
  const reading = buildScanReading({ quality: "clean", margin: 3, real: REAL });
  assert.equal(reading.maxStep, 5);
  assert.deepEqual(reading.steps.map(s => s.state), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(reading.steps[0].lines[0], "Médio · Cargueiro");
  assert.deepEqual(reading.steps[1].lines, ["Escudo 0 / 400", "Casco 520 / 600", "Integridade 87%"]);
  assert.equal(reading.steps[2].lines[1], "Propulsor: danificado (40%)");
  assert.deepEqual(reading.steps[3].lines, ["2 × Torreta de Pulso · Penetração 12"]);
  assert.deepEqual(reading.steps[4].lines, ["Carga 38 / 60", "Tripulação: 9"]);
});

test("Leitura distorcida dá faixas que contêm o valor real e pode errar um Módulo", () => {
  const reading = buildScanReading({ quality: "distorted", margin: 1, real: REAL, rng: seq(0.5, 0.5, 0.1) });
  assert.equal(reading.steps[1].state, "band");
  assert.match(reading.steps[1].lines[0], /^Escudo ≈ \d+(–\d+)?$/);
  assert.match(reading.steps[2].lines[0], /pode estar errado/);
  assert.match(reading.steps[3].lines[0], /2 armas \(tipo não distinguido\)/);
  assert.match(reading.steps[3].lines[1], /Penetração ≈/);
  // a faixa sempre contém o valor real
  for (const r of [0, 0.3, 0.9, 1]) {
    const [lo, hi] = bandOf(520, 1, () => r);
    assert.ok(lo <= 520 && hi >= 520, `faixa ${lo}-${hi}`);
  }
  assert.notEqual(wrongModuleState("online", () => 0), "online");
  // faixa mais larga com margem menor
  const [a1, b1] = bandOf(1000, 0, () => 1);
  const [a2, b2] = bandOf(1000, 2, () => 1);
  assert.ok(b1 - a1 > b2 - a2);
});

test("Leitura bloqueada só dá o degrau 1; o Mestre vê sempre os números reais", () => {
  const blocked = buildScanReading({ quality: "blocked", margin: -2, real: REAL });
  assert.equal(blocked.steps[0].state, "ok");
  assert.deepEqual(blocked.steps.slice(1).map(s => s.state), ["blocked", "blocked", "blocked", "blocked"]);
  assert.equal(blocked.steps[1].lines[0], "bloqueado");
  const gm = buildScanReading({ quality: "blocked", margin: -2, real: REAL, exact: true });
  assert.equal(gm.steps[1].lines[0], "Escudo 0 / 400");
  const passive = buildScanReading({ quality: "clean", margin: 5, passive: true, real: REAL });
  assert.equal(passive.maxStep, 2);
  assert.equal(passive.steps[2].state, "unreached");
});

test("Último contato: some do retrato, fica cinza e expira em 5 rodadas", () => {
  const t1 = nextPicture(null, { a: { x: 10, y: 20, name: "Lâmina" }, b: { x: 1, y: 1, name: "Vésper" } });
  assert.deepEqual(Object.keys(t1.seen).sort(), ["a", "b"]);
  assert.deepEqual(t1.last, {});
  // b sai do alcance: vira contato perdido na última posição vista
  const t2 = nextPicture(t1, { a: { x: 12, y: 22, name: "Lâmina" } });
  assert.deepEqual(Object.keys(t2.last), ["b"]);
  assert.equal(t2.last.b.x, 1);
  assert.equal(t2.last.b.age, 0);
  // continua perdido: o contato guardado não é recriado
  const t3 = nextPicture({ seen: t2.seen, last: { b: { ...t2.last.b, age: 2 } } }, { a: { x: 12, y: 22, name: "Lâmina" } });
  assert.equal(t3.last.b.age, 2);
  // voltou a ser visto: some dos perdidos
  assert.deepEqual(nextPicture(t3, { a: { x: 0, y: 0, name: "Lâmina" }, b: { x: 5, y: 5, name: "Vésper" } }).last, {});
  // envelhecimento
  let last = { b: { x: 1, y: 1, name: "Vésper", age: 0 } };
  for (let i = 1; i <= 4; i++) {
    last = ageContacts(last, 5);
    assert.equal(last.b.age, i);
  }
  assert.deepEqual(ageContacts(last, 5), {}, "na 5ª rodada some");
  assert.deepEqual(ageContacts(last, 3), {}, "a afinação vale");
  assert.equal(samePicture(t1, JSON.parse(JSON.stringify(t1))), true);
  assert.equal(samePicture(t1, t2), false);
  assert.equal(lastContactText(3), "há 3 rodadas");
  assert.equal(lastContactText(1), "há 1 rodada");
  assert.deepEqual(contactStatus({ seen: true }), { tag: "detectado", cls: "o" });
  assert.match(contactStatus({ seen: false, lastAge: 3 }).tag, /último contato há 3 rodadas/);
  assert.equal(contactStatus({ seen: false }).tag, "perdido agora");
});

test("Quem some do mapa: só jogadores tripulantes de nave com sensor", () => {
  const base = { restricted: true, pictureReady: true, seenBy: false };
  assert.equal(shipHiddenBySensors(base), true);
  assert.equal(shipHiddenBySensors({ ...base, seenBy: true }), false, "detectada aparece");
  assert.equal(shipHiddenBySensors({ ...base, isGM: true }), false, "o Mestre vê tudo");
  assert.equal(shipHiddenBySensors({ ...base, isOwner: true }), false, "a própria nave aparece");
  assert.equal(shipHiddenBySensors({ ...base, alwaysDetected: true }), false);
  assert.equal(shipHiddenBySensors({ ...base, restricted: false }), false, "personagem fora de nave vê tudo como hoje");
  assert.equal(shipHiddenBySensors({ ...base, pictureReady: false }), false, "sem retrato ainda, ninguém some");
});

test("Disparo: vale na rodada em que foi dado; fora de combate por alguns segundos", () => {
  const shot = { amount: 50, round: 3, ts: 1000 };
  assert.equal(fireSignatureActive(shot, { round: 3 }), true);
  assert.equal(fireSignatureActive(shot, { round: 4 }), false);
  assert.equal(fireSignatureActive({ amount: 50, round: null, ts: 1000 }, { round: null, now: 5000 }), true);
  assert.equal(fireSignatureActive({ amount: 50, round: null, ts: 1000 }, { round: null, now: 20000 }), false);
  assert.equal(fireSignatureActive({ amount: 0, round: 3, ts: 1 }, { round: 3 }), false);
  assert.equal(fireSignatureActive(null), false);
});

test("Validar Mundo: Módulos e naves com sensores incoerentes", () => {
  assert.deepEqual(moduleSensorIssues({ functions: [] }), []);
  const bad = moduleSensorIssues({ functions: ["sensor", "camouflage", "scanBlock", "teleporter"], sensorRange: 0, sensorResolution: 0, powerConsumption: 0, sensorPassiveConsumption: 5, camoSignature: 0, scanBlock: 0, teleportRange: 0 });
  assert.equal(bad.length, 7);
  assert.deepEqual(moduleSensorIssues({ functions: ["sensor"], sensorRange: 800, sensorResolution: 6, powerConsumption: 12, sensorPassiveConsumption: 4 }), []);
  assert.equal(shipSensorIssues({ sensorMode: "passive" }, { hasSensor: false }).length, 1);
  assert.equal(shipSensorIssues({ sensorMode: "passive" }, { hasSensor: true }).length, 0);
  assert.match(shipSensorIssues({ dock: { withUuid: "Actor.x" } }, { dockExists: false })[0].message, /não existe mais/);
  assert.equal(shipSensorIssues({ boarders: [{ actorUuid: "Actor.k" }] }, { boarderExists: () => false }).length, 1);
});
