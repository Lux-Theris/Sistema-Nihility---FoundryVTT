/**
 * Sensores e furtividade de nave (F1) — as contas puras, sem Foundry. A afinação entra por parâmetro
 * (`tuning`, lida das opções do bloco `shipSensors` por `getSensorTuning`); aqui só há os padrões.
 *
 * Resumo da regra (números aprovados pelo dono em 24/11):
 *  - Assinatura (%) = base pelo Porte + energia (consumo ÷ geração × 20 no ativo, × 4 no passivo) + disparo
 *    + Skills; com Camuflagem ligada a base+energia é trocada pelo alvo da Camuflagem (o disparo e as Skills
 *    ainda somam por cima).
 *  - A vê B se distância ≤ alcance atual do sensor de A × Assinatura de B ÷ 100. O alcance atual leva o modo
 *    passivo (× 50%) e a Interferência da cena (corte em %).
 *  - Escanear: Resolução do sensor − Bloqueio de leitura do alvo ≥ 3 limpa, 0 a 2 distorcida, < 0 bloqueada.
 *  - Último contato: cinza onde foi visto, some em 5 rodadas.
 */

/** Assinatura base (%) por `rank` do Porte (0 Mini … 4 Capital). Médio (2) = 100. */
export const SIGNATURE_BY_RANK = [40, 70, 100, 140, 200];

/** Afinação padrão (as opções do bloco `shipSensors` sobrescrevem). */
export const SENSOR_DEFAULTS = Object.freeze({
  passiveFactor: 50,
  energyActive: 20,
  energyPassive: 4,
  lostRounds: 5,
  cleanMargin: 3
});

/** Os degraus do Escanear. */
export const SCAN_STEPS = Object.freeze([
  { step: 1, label: "Porte e classe" },
  { step: 2, label: "Escudo, Casco, Integridade" },
  { step: 3, label: "Módulos e estado" },
  { step: 4, label: "Armas e Penetração" },
  { step: 5, label: "Carga e tripulação" }
]);

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const tuned = tuning => ({ ...SENSOR_DEFAULTS, ...(tuning ?? {}) });

/* ------------------------------------------------------------------ Assinatura */

/** A Assinatura base (%) do Porte pelo `rank` (fora da tabela usa a ponta mais próxima). */
export function baseSignature(rank) {
  const i = Math.min(SIGNATURE_BY_RANK.length - 1, Math.max(0, Math.round(num(rank, 2))));
  return SIGNATURE_BY_RANK[i];
}

/**
 * O que o consumo de energia soma na Assinatura: `carga × teto`, com `carga` = consumo ÷ geração
 * disponível (0 a 1) e o teto 20 no modo ativo e 4 no passivo. Sem geração (0) e com consumo, a carga é 1.
 */
export function energyBonus({ consumption = 0, supply = 0, mode = "active", tuning } = {}) {
  const t = tuned(tuning);
  const used = Math.max(0, num(consumption));
  const available = Math.max(0, num(supply));
  const load = used <= 0 ? 0 : available <= 0 ? 1 : Math.min(1, used / available);
  const cap = mode === "passive" ? t.energyPassive : t.energyActive;
  return Math.round(load * cap);
}

/**
 * A Assinatura da nave e de onde ela vem.
 * @param {{rank?:number, consumption?:number, supply?:number, mode?:"active"|"passive", fire?:number, camouflage?:{active?:boolean, target?:number}|null, extra?:number, tuning?:object}} input
 * `fire` = soma da Assinatura do disparo de quem atirou na última rodada; `extra` = % de Skills ("Assinatura da nave").
 * @returns {{total:number, segments:Array<{id:string, label:string, why:string, value:number}>}}
 */
export function signatureBreakdown({ rank = 2, consumption = 0, supply = 0, mode = "active", fire = 0, camouflage = null, extra = 0, tuning } = {}) {
  const segments = [];
  const camo = camouflage?.active ? Math.max(0, num(camouflage.target)) : null;
  if (camo !== null) {
    segments.push({ id: "camouflage", label: "Camuflagem", why: "ligada: no lugar da base e do consumo", value: camo });
  } else {
    segments.push({ id: "base", label: "Porte", why: "base", value: baseSignature(rank) });
    const energy = energyBonus({ consumption, supply, mode, tuning });
    segments.push({
      id: "energy",
      label: "Consumo de Energia",
      why: mode === "passive" ? "sensor passivo, menos consumo" : "sensor ativo e sistemas",
      value: energy
    });
  }
  if (num(fire) > 0) segments.push({ id: "fire", label: "Disparo recente", why: "dura 1 rodada", value: Math.round(num(fire)) });
  if (num(extra) !== 0) segments.push({ id: "skill", label: "Efeito de Skill", why: "Assinatura da nave", value: Math.round(num(extra)) });
  const total = Math.max(0, segments.reduce((sum, s) => sum + s.value, 0));
  return { total, segments };
}

/**
 * O disparo anotado (`{amount, round, ts}`) ainda sobe a Assinatura? Em combate vale só na rodada em que foi dado;
 * fora dele, por alguns segundos (`persistMs`).
 */
export function fireSignatureActive(shot, { round = null, now = Date.now(), persistMs = 12000 } = {}) {
  if (!shot || !(num(shot.amount) > 0)) return false;
  if (round !== null && shot.round !== null && shot.round !== undefined) return shot.round === round;
  return now - num(shot.ts) < persistMs;
}

/* ------------------------------------------------------------------ Alcance e detecção */

/** O alcance do sensor agora: modo passivo e Interferência cortam; cego vale 0. */
export function sensorRangeNow({ range = 0, mode = "active", interference = 0, blind = false, tuning } = {}) {
  if (blind) return 0;
  const t = tuned(tuning);
  const modeFactor = mode === "passive" ? Math.max(0, t.passiveFactor) / 100 : 1;
  const cut = 1 - Math.min(100, Math.max(0, num(interference))) / 100;
  return Math.max(0, Math.round(num(range) * modeFactor * cut));
}

/** A Resolução do sensor agora: no passivo cai pelo mesmo fator do alcance (arredonda para baixo). */
export function sensorResolutionNow({ resolution = 0, mode = "active", tuning } = {}) {
  const t = tuned(tuning);
  const base = Math.min(10, Math.max(0, num(resolution)));
  return mode === "passive" ? Math.floor((base * Math.max(0, t.passiveFactor)) / 100) : Math.floor(base);
}

/** Até onde este sensor enxerga uma nave desta Assinatura (mesma unidade do alcance). */
export function detectLimit(rangeNow, signature) {
  return Math.round((Math.max(0, num(rangeNow)) * Math.max(0, num(signature))) / 100);
}

/** A vê B? `distance ≤ alcance × Assinatura`; alcance 0 (cego) nunca vê. */
export function detects({ distance, range, signature }) {
  if (!(num(range) > 0)) return false;
  return num(distance, Infinity) <= detectLimit(range, signature) + 1e-9;
}

/**
 * Por que o sensor está cego ("" = enxerga). `online`: o Módulo está ligado; `powered`: tem energia; `hp`: Vida do
 * Módulo; `techField`: a nave está dentro de um campo de Interferência; `interference`: corte da cena em %.
 */
export function sensorBlindReason({ online = true, powered = true, hp = 1, techField = false, interference = 0 } = {}) {
  if (!online) return "desligado ou sob PEM";
  if (num(hp) <= 0) return "destruído";
  if (!powered) return "sem energia";
  if (techField) return "dentro de um campo de Interferência";
  if (num(interference) >= 100) return "Interferência total da cena";
  return "";
}

/* ------------------------------------------------------------------ Escanear */

/** A camada mais forte de leitura do alvo: `layers` = `[{id, label, value, counts}]`; só as que contam entram. */
export function strongestBlock(layers) {
  let best = { id: "", label: "", value: 0 };
  for (const layer of layers ?? []) {
    if (layer?.counts === false) continue;
    const value = Math.max(0, num(layer?.value));
    if (value > best.value) best = { id: layer.id ?? "", label: layer.label ?? "", value };
  }
  return best;
}

/**
 * A qualidade da leitura: Resolução − Bloqueio. `margin` ≥ `cleanMargin` limpa; 0 até aí distorcida; < 0 bloqueada.
 * @returns {{quality:"clean"|"distorted"|"blocked", margin:number}}
 */
export function scanQuality(resolution, block, tuning) {
  const t = tuned(tuning);
  const margin = Math.round(num(resolution)) - Math.round(num(block));
  if (margin < 0) return { quality: "blocked", margin };
  return { quality: margin >= t.cleanMargin ? "clean" : "distorted", margin };
}

/** O maior degrau que a leitura alcança: bloqueada só o 1; o modo passivo no máximo o 2. */
export function scanMaxStep(quality, passive = false) {
  const base = quality === "blocked" ? 1 : 5;
  return passive ? Math.min(base, 2) : base;
}

/** Uma faixa `[min, max]` em volta do valor real (que cai dentro dela); alarga quanto menor a margem. */
export function bandOf(value, margin, rng = Math.random, tuning) {
  const t = tuned(tuning);
  const spread = Math.min(0.5, 0.15 + 0.1 * Math.max(0, t.cleanMargin - 1 - Math.max(0, num(margin))));
  const v = num(value);
  const lo = Math.max(0, Math.round(v * (1 - spread * (0.4 + 0.6 * rng()))));
  const hi = Math.round(v * (1 + spread * (0.4 + 0.6 * rng())));
  return [Math.min(lo, Math.round(v)), Math.max(hi, Math.round(v))];
}

const bandText = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/** Os estados que um Módulo pode mostrar numa leitura. */
export const MODULE_STATE_LABEL = Object.freeze({ online: "operante", offline: "desligado", damaged: "danificado", starved: "sem energia" });

/** Um estado errado e plausível para o Módulo de uma leitura distorcida. */
export function wrongModuleState(state, rng = Math.random) {
  const others = Object.keys(MODULE_STATE_LABEL).filter(key => key !== state);
  return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
}

/**
 * Monta a leitura em degraus a partir dos números reais.
 * @param {object} input
 * @param {"clean"|"distorted"|"blocked"} input.quality
 * @param {number} input.margin - Resolução − Bloqueio (alarga a faixa quando distorcida)
 * @param {boolean} [input.passive]
 * @param {object} input.real - `{sizeLabel, className, shield:{value,max}, casco:{value,max}, hullPercent, modules:[{name, state, hpPercent}], weapons:[{name, penetration}], cargo:{value,max}|null, crew}`
 * @param {boolean} [input.exact] - o Mestre vê sempre os números reais (e ainda é avisado da qualidade)
 * @returns {{quality:string, margin:number, maxStep:number, steps:Array<{step:number, label:string, state:"ok"|"band"|"blocked"|"unreached", lines:string[]}>}}
 */
export function buildScanReading({ quality, margin = 0, passive = false, real = {}, exact = false, rng = Math.random, tuning } = {}) {
  const maxStep = scanMaxStep(quality, passive);
  const blur = quality === "distorted" && !exact;
  const num2 = value => (blur ? bandText(bandOf(value, margin, rng, tuning)) : `${Math.round(num(value))}`);
  const approx = (a, b) => (blur ? `≈ ${num2(a)}` : `${Math.round(num(a))} / ${Math.round(num(b))}`);
  const steps = SCAN_STEPS.map(({ step, label }) => {
    if (step > maxStep && !exact) {
      return { step, label, state: quality === "blocked" ? "blocked" : "unreached", lines: [quality === "blocked" ? "bloqueado" : "além do alcance da leitura passiva"] };
    }
    const lines = [];
    if (step === 1) {
      lines.push([real.sizeLabel, real.className].filter(Boolean).join(" · ") || "Porte desconhecido");
    } else if (step === 2) {
      const shield = real.shield ?? { value: 0, max: 0 };
      const casco = real.casco ?? { value: 0, max: 0 };
      lines.push(`Escudo ${blur ? approx(shield.value) : approx(shield.value, shield.max)}`);
      lines.push(`Casco ${blur ? approx(casco.value) : approx(casco.value, casco.max)}`);
      lines.push(blur ? `Integridade ≈ ${bandText(bandOf(num(real.hullPercent), margin, rng, tuning).map(v => Math.min(100, v)))}%` : `Integridade ${Math.round(num(real.hullPercent))}%`);
    } else if (step === 3) {
      for (const m of real.modules ?? []) {
        const state = blur && rng() < 0.35 ? wrongModuleState(m.state, rng) : m.state;
        const text = state === "damaged" && !blur && m.hpPercent !== undefined ? `danificado (${Math.round(m.hpPercent)}%)` : MODULE_STATE_LABEL[state] ?? state;
        lines.push(`${m.name}: ${text}${blur ? " (pode estar errado)" : ""}`);
      }
      if (!lines.length) lines.push("Nenhum Módulo lido");
    } else if (step === 4) {
      const weapons = real.weapons ?? [];
      if (!weapons.length) lines.push("Sem armas");
      else if (blur) {
        lines.push(`${weapons.length} ${weapons.length === 1 ? "arma" : "armas"} (tipo não distinguido)`);
        const best = Math.max(...weapons.map(w => num(w.penetration)));
        lines.push(`Penetração ≈ ${bandText(bandOf(best, margin, rng, tuning))}`);
      } else {
        const groups = new Map();
        for (const w of weapons) {
          const key = `${w.name}|${num(w.penetration)}`;
          const group = groups.get(key) ?? { name: w.name, penetration: num(w.penetration), count: 0 };
          group.count += 1;
          groups.set(key, group);
        }
        for (const g of groups.values()) lines.push(`${g.count} × ${g.name} · Penetração ${g.penetration}`);
      }
    } else if (step === 5) {
      const cargo = real.cargo;
      if (cargo) lines.push(blur ? `Carga ≈ ${bandText(bandOf(cargo.value, margin, rng, tuning))}` : `Carga ${Math.round(num(cargo.value))} / ${Math.round(num(cargo.max))}`);
      const crew = num(real.crew);
      lines.push(blur ? `Tripulação ≈ ${bandText(bandOf(crew, margin, rng, tuning))}` : `Tripulação: ${Math.round(crew)}`);
    }
    return { step, label, state: blur && step > 1 ? "band" : "ok", lines };
  });
  return { quality, margin, maxStep, steps };
}

/**
 * A Resolução de uma Análise (Skill) contra uma nave: o nível da Skill mais a Percepção em passos (a mesma
 * unidade de `analysisAttrStep`), de 0 a 10.
 */
export function analysisResolution({ level = 0, perception = 0, step = 10 } = {}) {
  const s = Math.max(1, num(step, 10));
  return Math.min(10, Math.max(0, Math.round(num(level)) + Math.trunc(num(perception) / s)));
}

/* ------------------------------------------------------------------ Retrato da cena e último contato */

/**
 * Atualiza o retrato de UM observador: quem ele vê agora e os contatos perdidos (cinza).
 * @param {{seen?:Record<string,object>, last?:Record<string,object>}|null} prev - retrato anterior
 * @param {Record<string,{x:number,y:number,name:string,img?:string}>} now - quem é visto agora (por id de Token)
 * @param {{lostRounds?:number}} [options]
 * @returns {{seen:Record<string,object>, last:Record<string,object>}}
 */
export function nextPicture(prev, now, { lostRounds } = {}) {
  void lostRounds;
  const seen = {};
  for (const [id, info] of Object.entries(now ?? {})) seen[id] = { x: num(info.x), y: num(info.y), name: String(info.name ?? ""), img: String(info.img ?? "") };
  const last = {};
  for (const [id, entry] of Object.entries(prev?.last ?? {})) if (!(id in seen)) last[id] = { ...entry };
  for (const [id, info] of Object.entries(prev?.seen ?? {})) if (!(id in seen) && !(id in last)) last[id] = { ...info, age: 0 };
  return { seen, last };
}

/** Passa uma rodada: o contato perdido envelhece e some ao completar `lostRounds`. */
export function ageContacts(last, lostRounds = SENSOR_DEFAULTS.lostRounds) {
  const out = {};
  for (const [id, entry] of Object.entries(last ?? {})) {
    const age = num(entry.age) + 1;
    if (age < Math.max(1, lostRounds)) out[id] = { ...entry, age };
  }
  return out;
}

/** Duas fotos do retrato são iguais? (não regrava a cena à toa) */
export function samePicture(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/**
 * O Token de uma nave está escondido de ESTE usuário pelos sensores? Falso para o Mestre, para o dono, para o que o
 * Mestre marcou "sempre detectada", para quem não tem nave com sensor (`restricted` = falso) e enquanto o retrato
 * não existe. Senão é "escondido" quando nenhum observador do usuário o vê.
 * @param {{isGM?:boolean, isOwner?:boolean, alwaysDetected?:boolean, restricted:boolean, pictureReady:boolean, seenBy:boolean}} input
 */
export function shipHiddenBySensors({ isGM = false, isOwner = false, alwaysDetected = false, restricted = false, pictureReady = false, seenBy = false } = {}) {
  if (isGM || isOwner || alwaysDetected || !restricted || !pictureReady) return false;
  return !seenBy;
}

/** Texto curto de quando o contato perdido foi visto ("há 3 rodadas"). */
export function lastContactText(age) {
  const n = Math.max(0, Math.round(num(age)));
  return n <= 0 ? "agora há pouco" : `há ${n} ${n === 1 ? "rodada" : "rodadas"}`;
}

/** A frase do estado de um contato da lista (aba Sensores). */
export function contactStatus({ seen, lastAge = null }) {
  if (seen) return { tag: "detectado", cls: "o" };
  if (lastAge !== null && lastAge !== undefined) return { tag: `último contato ${lastContactText(lastAge)}`, cls: "" };
  return { tag: "perdido agora", cls: "g" };
}

/* ------------------------------------------------------------------ Validar Mundo */

/**
 * Problemas de um Módulo com as funções de Sensores (`system` do Módulo). Só lista; nada é corrigido.
 * @returns {Array<{where:string, message:string}>}
 */
export function moduleSensorIssues(system) {
  const issues = [];
  const functions = Array.isArray(system?.functions) ? system.functions : [];
  if (functions.includes("sensor")) {
    if (!(num(system.sensorRange) > 0)) issues.push({ where: "Função Sensor", message: "alcance 0: o sensor nunca vê nada" });
    if (!(num(system.sensorResolution) > 0)) issues.push({ where: "Função Sensor", message: "Resolução 0: o Escanear só lê limpo contra naves sem Bloqueio de leitura" });
    if (num(system.sensorPassiveConsumption) > num(system.powerConsumption)) issues.push({ where: "Função Sensor", message: "o consumo passivo é maior que o ativo (o modo passivo deveria gastar menos)" });
  }
  if (functions.includes("camouflage")) {
    if (!(num(system.camoSignature) > 0)) issues.push({ where: "Função Camuflagem", message: "Assinatura alvo 0%: a nave ficaria invisível a qualquer sensor" });
    if (!(num(system.powerConsumption) > 0)) issues.push({ where: "Função Camuflagem", message: "sem consumo de energia: a Camuflagem deveria gastar muito (em geral 60 por rodada)" });
  }
  if (functions.includes("scanBlock") && !(num(system.scanBlock) > 0)) issues.push({ where: "Função Bloqueio de varredura", message: "Bloqueio de leitura 0: o Módulo não bloqueia nada" });
  if (functions.includes("teleporter") && !(num(system.teleportRange) > 0)) issues.push({ where: "Função Teletransportador", message: "alcance 0: o teletransporte nunca alcança uma nave" });
  return issues;
}

/**
 * Problemas de uma nave/veículo ligados aos Sensores e à Abordagem.
 * @param {object} system - `system` do Ator
 * @param {{hasSensor?:boolean, dockExists?:boolean, boarderExists?:(uuid:string)=>boolean}} [info]
 */
export function shipSensorIssues(system, { hasSensor = false, dockExists = true, boarderExists = () => true } = {}) {
  const issues = [];
  if (system?.sensorMode === "passive" && !hasSensor) issues.push({ where: "Sensores", message: "está no modo passivo, mas não tem nenhum Módulo com função Sensor" });
  if (system?.alwaysDetected && !hasSensor) issues.push({ where: "Sensores", message: "marcada \"sempre detectada\" (só vale para quem tripula uma nave com sensor)" });
  const dock = system?.dock;
  if (dock?.withUuid && !dockExists) issues.push({ where: "Acoplagem", message: "acoplada a uma nave que não existe mais (o Mestre pode Desacoplar)" });
  for (const [i, boarder] of (system?.boarders ?? []).entries()) {
    if (boarder?.actorUuid && !boarderExists(boarder.actorUuid)) issues.push({ where: `Grupo de abordagem ${i + 1}`, message: "personagem a bordo que não existe mais (apagado)" });
  }
  return issues;
}
