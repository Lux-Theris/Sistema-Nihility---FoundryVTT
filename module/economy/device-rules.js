/**
 * Placas e programas (Lote 9) — a parte pura e testada. Quem lê e grava fichas é `economy/devices.js`.
 *
 * Uma PLACA é um Item Geral com `system.device.enabled`: tem encaixes, uma Reserva de energia própria
 * e aceita PROGRAMAS (Itens com `system.program.enabled`). Um programa ativo concede uma Habilidade que
 * paga o Custo da Reserva da placa, nunca da Mana; um passivo só dá os bônus do próprio Item enquanto a
 * placa funciona. Tudo aqui recebe os números (tuning) como parâmetro e não toca em Foundry.
 */

/** Natureza da placa: sempre tecnológica; tecnomágica também é mágica (a Antimagia a alcança). */
export const DEVICE_NATURES = ["tech", "technomagic"];
/** O que a placa aceita instalar. */
export const DEVICE_ACCEPTS = ["any", "invasion", "weapon"];
/** Estados da placa. */
export const DEVICE_STATES = ["normal", "off", "damaged"];
/** O que o programa exige do hospedeiro. */
export const PROGRAM_FITS = ["any", "weapon"];

/** Faixas do curto-circuito (d100): leve 1–60, grave 61–95, desastre 96–100 (opções do bloco "Placas e programas"). */
export const DEFAULT_SHORT_BANDS = { leveMax: 60, graveMax: 95 };
/** Chance (%) de cada placa dar curto quando um PEM atinge o dono. */
export const DEFAULT_CURTO_CHANCE_ON_EMP = 25;
/** Rodadas, fora de combate, que uma placa "off" demora para voltar. */
export const OFF_OUT_OF_COMBAT_ROUNDS = 3;

const int = (value, fallback = 0) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
};
const natural = (value, fallback = 0) => Math.max(0, int(value, fallback));

/** O `system.device` de uma placa nova: Descanso e Célula marcados, ação e infinita desligadas. */
export function defaultDevice({ enabled = false } = {}) {
  return {
    enabled: Boolean(enabled),
    nature: "tech",
    slots: 2,
    reserveMax: 50,
    reserve: 50,
    accepts: "any",
    rechargeRest: true,
    rechargeCell: true,
    rechargeAction: false,
    actionAmount: 10,
    infinite: false,
    state: "normal",
    offMode: "",
    offCombatId: "",
    offSince: 0,
    offRounds: OFF_OUT_OF_COMBAT_ROUNDS,
    programs: []
  };
}

/** Normaliza o que veio do documento (campos faltando, números fora da faixa). */
export function normalizeDevice(device = {}) {
  const base = defaultDevice();
  const d = { ...base, ...(device ?? {}) };
  d.enabled = Boolean(d.enabled);
  d.nature = DEVICE_NATURES.includes(d.nature) ? d.nature : "tech";
  d.slots = natural(d.slots, base.slots);
  d.reserveMax = natural(d.reserveMax, base.reserveMax);
  d.reserve = Math.min(d.reserveMax, natural(d.reserve, d.reserveMax));
  d.accepts = DEVICE_ACCEPTS.includes(d.accepts) ? d.accepts : "any";
  d.actionAmount = natural(d.actionAmount, base.actionAmount);
  d.state = DEVICE_STATES.includes(d.state) ? d.state : "normal";
  d.programs = Array.isArray(d.programs) ? d.programs : [];
  return d;
}

/** Reserva em números: `{max, current, percent, empty, full, infinite}`. Infinita conta como cheia. */
export function reserveState(device) {
  const d = normalizeDevice(device);
  const max = d.reserveMax;
  const current = d.infinite ? max : d.reserve;
  return {
    max,
    current,
    percent: max > 0 ? Math.round((current / max) * 100) : 0,
    empty: !d.infinite && current <= 0,
    full: d.infinite || current >= max,
    infinite: d.infinite
  };
}

/**
 * Quanto custa um uso, em Reserva: o `costPerUse` do programa quando for maior que 0; senão o Custo
 * da Habilidade que ele concede.
 */
export function programCost({ skillCost = 0, costPerUse = 0 } = {}) {
  const per = natural(costPerUse);
  return per > 0 ? per : natural(skillCost);
}

/**
 * Paga o Custo de um uso da Reserva da placa.
 * - Infinita ou Custo 0: de graça.
 * - Reserva basta: sai da Reserva, Mana 0.
 * - Falta Reserva: placa tecnológica bloqueia ("sem Reserva", nada se gasta); tecnomágica gasta o que
 *   resta da Reserva e paga a diferença em Mana (`manaCost`).
 * @returns {{ok:boolean, reserveAfter:number, manaCost:number, reason:string}} `reason`: "" | "free" | "infinite" | "reserve" | "mana" | "sem Reserva"
 */
export function payProgramCost({ cost = 0, reserve = 0, nature = "tech", infinite = false } = {}) {
  const amount = natural(cost);
  const have = natural(reserve);
  if (infinite) return { ok: true, reserveAfter: have, manaCost: 0, reason: "infinite" };
  if (amount <= 0) return { ok: true, reserveAfter: have, manaCost: 0, reason: "free" };
  if (have >= amount) return { ok: true, reserveAfter: have - amount, manaCost: 0, reason: "reserve" };
  if (nature === "technomagic") return { ok: true, reserveAfter: 0, manaCost: amount - have, reason: "mana" };
  return { ok: false, reserveAfter: have, manaCost: 0, reason: "sem Reserva" };
}

/** Descanso (curto ou completo) enche a Reserva das placas com "Descanso". */
export function restRecharge(device) {
  const d = normalizeDevice(device);
  if (!d.enabled || !d.rechargeRest || d.infinite) return { changed: false, reserve: d.reserve };
  return { changed: d.reserve < d.reserveMax, reserve: d.reserveMax };
}

/** Uma Célula de energia enche a Reserva inteira (só se a placa aceita Células e não está cheia). */
export function cellRecharge(device) {
  const d = normalizeDevice(device);
  if (!d.enabled) return { ok: false, reserve: d.reserve, reason: "não é uma placa" };
  if (d.infinite) return { ok: false, reserve: d.reserve, reason: "a Reserva é infinita" };
  if (!d.rechargeCell) return { ok: false, reserve: d.reserve, reason: "a placa não aceita Célula de energia" };
  if (d.reserve >= d.reserveMax) return { ok: false, reserve: d.reserve, reason: "a Reserva já está cheia" };
  return { ok: true, reserve: d.reserveMax, reason: "" };
}

/** Recarga por ação: só fora de combate, soma `actionAmount` (sem passar do máximo). */
export function actionRecharge(device, inCombat = false) {
  const d = normalizeDevice(device);
  if (!d.enabled) return { ok: false, reserve: d.reserve, reason: "não é uma placa" };
  if (d.infinite) return { ok: false, reserve: d.reserve, reason: "a Reserva é infinita" };
  if (!d.rechargeAction) return { ok: false, reserve: d.reserve, reason: "a placa não recarrega por ação" };
  if (inCombat) return { ok: false, reserve: d.reserve, reason: "só fora de combate" };
  if (d.reserve >= d.reserveMax) return { ok: false, reserve: d.reserve, reason: "a Reserva já está cheia" };
  return { ok: true, reserve: Math.min(d.reserveMax, d.reserve + d.actionAmount), reason: "" };
}

/** Encaixes que o programa ocupa (mínimo 1). */
export function programSlots(program) {
  return Math.max(1, natural(program?.slotsUsed, 1));
}

/** Encaixes livres da placa, dados os programas instalados (`{slotsUsed}` de cada um). */
export function slotsFree(device, installedPrograms = []) {
  const d = normalizeDevice(device);
  const used = (installedPrograms ?? []).reduce((sum, p) => sum + programSlots(p), 0);
  return Math.max(0, d.slots - used);
}

/**
 * O programa cabe na placa? Confere: é uma placa, é um programa, `accepts` da placa × o programa
 * (`invasion` pede `invasion.enabled`; `weapon` pede `fits: "weapon"`), `fits: "weapon"` do programa
 * pede que o hospedeiro seja arma, e há encaixes livres.
 * @param {object} program - o `system.program` do Item
 * @param {{hostIsWeapon?:boolean}} [host]
 * @returns {{ok:boolean, reason:string}}
 */
export function programFits(device, installedPrograms, program, { hostIsWeapon = false } = {}) {
  const d = normalizeDevice(device);
  if (!d.enabled) return { ok: false, reason: "este Item não é uma placa" };
  if (!program?.enabled) return { ok: false, reason: "este Item não é um programa" };
  if (d.accepts === "invasion" && !program.invasion?.enabled) return { ok: false, reason: "a placa só aceita programas de Invasão" };
  if (d.accepts === "weapon" && program.fits !== "weapon") return { ok: false, reason: "a placa só aceita programas de arma" };
  if (program.fits === "weapon" && !hostIsWeapon) return { ok: false, reason: "o programa só roda em arma" };
  const need = programSlots(program);
  const free = slotsFree(d, installedPrograms);
  if (need > free) return { ok: false, reason: `sem encaixe livre (precisa de ${need}, a placa tem ${free})` };
  return { ok: true, reason: "" };
}

/** A placa funciona agora? Ligada, em estado normal e o dono sem supressão tecnológica (PEM). */
export function deviceWorks(device, { techSuppressed = false } = {}) {
  const d = normalizeDevice(device);
  return d.enabled && d.state === "normal" && !techSuppressed;
}

/** Por que a placa não funciona (texto pt-BR), ou "" se funciona. */
export function deviceBlockReason(device, { techSuppressed = false } = {}) {
  const d = normalizeDevice(device);
  if (!d.enabled) return "este Item não é uma placa";
  if (techSuppressed) return "a tecnologia está suprimida (PEM)";
  if (d.state === "off") return "a placa está desligada (curto-circuito leve)";
  if (d.state === "damaged") return "a placa está danificada";
  return "";
}

/** A porcentagem da Reserva que um PEM de alcance `reach` drena: 5% por ponto de alcance, de 5% a 75% (a mesma fórmula da Nave). */
export function empDrainPercent(reach = 0) {
  return Math.min(75, Math.max(5, Math.round(Number(reach) || 0) * 5));
}

/** Drena a Reserva de uma placa atingida por um PEM de alcance `reach`: tira a % do MÁXIMO (arredonda para cima, pelo menos 1 se há Reserva). */
export function empReserveDrain(reserve, reach = 0, reserveMax = null) {
  const have = natural(reserve);
  const max = reserveMax === null || reserveMax === undefined ? have : natural(reserveMax);
  const percent = empDrainPercent(reach);
  const raw = Math.ceil((max * percent) / 100);
  const drained = have > 0 ? Math.min(have, Math.max(1, raw)) : 0;
  return { percent, drained, reserveAfter: have - drained };
}

/** Faixas do curto-circuito normalizadas: `leveMax` e `graveMax` em 0–100, grave nunca abaixo de leve. */
export function normalizeShortBands(bands = {}) {
  const clamp = v => Math.min(100, Math.max(0, int(v, 0)));
  const leveMax = clamp(bands?.leveMax ?? DEFAULT_SHORT_BANDS.leveMax);
  const graveMax = Math.max(leveMax, clamp(bands?.graveMax ?? DEFAULT_SHORT_BANDS.graveMax));
  return { leveMax, graveMax };
}

/**
 * O resultado de um d100 do curto-circuito. Leve → `off`; grave → `damaged`; desastre → `damaged` + dano
 * Elétrico em quem veste (se a placa for implante/prótese/parte do corpo; quem chama decide).
 * @returns {{severity:"leve"|"grave"|"desastre", state:"off"|"damaged", disaster:boolean}}
 */
export function rollShortCircuit(d100, bands = DEFAULT_SHORT_BANDS) {
  const { leveMax, graveMax } = normalizeShortBands(bands);
  const roll = Math.min(100, Math.max(1, int(d100, 1)));
  if (roll <= leveMax) return { severity: "leve", state: "off", disaster: false };
  if (roll <= graveMax) return { severity: "grave", state: "damaged", disaster: false };
  return { severity: "desastre", state: "damaged", disaster: true };
}

/** O PEM deu curto nesta placa? `d100 ≤ chance` (chance em %, 0–100). */
export function shortCircuitHit(d100, chancePercent = DEFAULT_CURTO_CHANCE_ON_EMP) {
  const chance = Math.min(100, Math.max(0, int(chancePercent, 0)));
  return int(d100, 101) <= chance;
}

/** A fórmula do dano Elétrico do desastre: `2d6 × Reserva máxima ÷ 6`, arredondada. Reserva 0 → "0". */
export function disasterDamageFormula(reserveMax) {
  const max = natural(reserveMax);
  if (max <= 0) return "0";
  return `round(2d6 * ${max} / 6)`;
}

/**
 * A placa "off" já voltou? Em combate (`offMode: "combat"`) volta quando o combate em que desligou
 * acabou; fora de combate (`"time"`) depois de `offRounds` rodadas do relógio do mundo.
 * @param {{state?:string, offMode?:string, offCombatId?:string, offSince?:number, offRounds?:number}} device
 * @param {{now?:number, roundSeconds?:number, liveCombatIds?:string[]}} ctx
 */
export function offExpired(device, { now = 0, roundSeconds = 6, liveCombatIds = [] } = {}) {
  const d = normalizeDevice(device);
  if (d.state !== "off") return false;
  if (d.offMode === "combat") return !(liveCombatIds ?? []).includes(d.offCombatId);
  const rounds = Math.max(1, natural(d.offRounds, OFF_OUT_OF_COMBAT_ROUNDS));
  const seconds = Math.max(1, Number(roundSeconds) || 6);
  return (Number(now) || 0) - (Number(d.offSince) || 0) >= rounds * seconds;
}

/** O Item é uma Célula de energia (consumível marcado)? */
export function isEnergyCell(system) {
  return Boolean(system?.consumable?.energyCell) && natural(system?.quantity, 1) > 0;
}

/** A chave que liga uma Skill concedida a uma placa e a um programa instalado (estável: placa + uid). */
export function deviceSourceKey(hostItemId, uid) {
  return `device:${hostItemId}:${uid}`;
}

/** Lê a chave de volta: `{hostItemId, hostRef, uid}` ou null (não é de placa). `hostRef` é o endereço da placa (ver `parseHostRef`). */
export function parseDeviceSourceKey(key) {
  const match = /^device:([^:]+):(.+)$/.exec(String(key ?? ""));
  return match ? { hostItemId: match[1], hostRef: match[1], uid: match[2] } : null;
}

/* ------------------------------------------------------------------ endereço da placa (hospedeiro) */

/** Separador do endereço de uma placa que mora num implante instalado (`<id da parte>~<uid do implante>`); o id de um Item nunca o tem. */
export const HOST_REF_SEP = "~";

/** O endereço de uma placa dentro da modificação `uid` da Parte do Corpo `partId`. */
export function modHostRef(partId, uid) {
  return `${partId}${HOST_REF_SEP}${uid}`;
}

/** O uid de uma modificação de Parte: o gravado ao instalar, ou `idxN` (peça antiga, sem uid; só vale enquanto a ordem da lista não muda). */
export function modUidOf(mod, index) {
  return String(mod?.uid || `idx${index}`);
}

/** Onde a modificação `uid` está na lista (-1 se saiu). */
export function findModIndex(mods, uid) {
  return (mods ?? []).findIndex((m, i) => modUidOf(m, i) === uid);
}

/**
 * Lê o endereço de uma placa: `{kind:"item", itemId}` (Item do Ator) ou `{kind:"mod", partId, modUid}` (placa
 * dentro de um implante/prótese instalado numa Parte do Corpo). Vazio → null.
 */
export function parseHostRef(ref) {
  const text = String(ref ?? "");
  if (!text) return null;
  const at = text.indexOf(HOST_REF_SEP);
  if (at > 0 && at < text.length - 1) return { kind: "mod", partId: text.slice(0, at), modUid: text.slice(at + 1) };
  return { kind: "item", itemId: text };
}

/* ------------------------------------------------------------------ o que a ficha mostra */

/** Pastilhas da Reserva (a barra de 10): `{on, total, pips:[bool]}`. Nunca zera enquanto houver Reserva; só enche com a Reserva cheia. */
export function reservePips(device, total = 10) {
  const state = reserveState(device);
  const count = Math.max(1, Math.min(Math.floor(Number(total) || 10), state.max || 1));
  let on = state.max > 0 ? Math.round((state.current / state.max) * count) : 0;
  if (state.current > 0 && on === 0) on = 1;
  if (state.current < state.max && on === count) on = count - 1;
  return { on, total: count, pips: Array.from({ length: count }, (_, i) => i < on) };
}

/**
 * As linhas dos encaixes de uma placa: cada programa instalado (com os encaixes que ocupa) e os encaixes livres.
 * @param {{uid:string, sourceItem?:object}[]} entries - `device.programs`
 */
export function slotLayout(device, entries = []) {
  const d = normalizeDevice(device);
  const programs = (entries ?? []).map(entry => ({
    uid: entry?.uid ?? "",
    name: entry?.sourceItem?.name || "Programa",
    slots: programSlots(entry?.sourceItem?.system?.program)
  }));
  const used = programs.reduce((sum, p) => sum + p.slots, 0);
  const free = Math.max(0, d.slots - used);
  return { programs, used, free, total: d.slots, freeSlots: Array.from({ length: free }, (_, i) => i), overfull: used > d.slots };
}

/**
 * As opções do menu "Recarregar ▾": só as que a placa permite e que valem agora. Sem nenhuma, `reason` diz por quê.
 * @returns {{options:{id:"cell"|"action", label:string}[], reason:string}}
 */
export function rechargeOptions(device, { cells = 0, inCombat = false } = {}) {
  const d = normalizeDevice(device);
  const options = [];
  if (!d.enabled) return { options, reason: "não é uma placa" };
  if (d.infinite) return { options, reason: "a Reserva é infinita" };
  if (d.reserve >= d.reserveMax) return { options, reason: "a Reserva já está cheia" };
  if (d.rechargeCell && natural(cells) > 0) options.push({ id: "cell", label: `Usar Célula de energia (${natural(cells)} no inventário)` });
  if (d.rechargeAction && !inCombat) options.push({ id: "action", label: `Fora de combate, uma ação (+${d.actionAmount})` });
  if (!options.length) {
    const hints = [];
    if (d.rechargeCell) hints.push("sem Célula de energia no inventário");
    if (d.rechargeAction && inCombat) hints.push("a recarga por ação é só fora de combate");
    if (!d.rechargeCell && !d.rechargeAction) hints.push("só o Descanso recarrega esta placa");
    return { options, reason: hints.join("; ") };
  }
  return { options, reason: "" };
}

/** O que o programa custa, em texto de etiqueta: "2 de Reserva", ou "sem custo" (Reserva infinita ou Custo 0). */
export function programCostTag({ cost = 0, infinite = false } = {}) {
  if (infinite || natural(cost) <= 0) return "sem custo";
  return `${natural(cost)} de Reserva`;
}

/**
 * A etiqueta de uma Habilidade de programa na aba Skills (e se o Usar fica desligado).
 * `device` = o `system.device` da placa (já com o estado vivo) e `suppressed` = o PEM sobre quem a leva.
 * @returns {{text:string, tone:"ok"|"warn"|"bad", disabled:boolean, reason:string}}
 */
export function skillDeviceStatus({ device, cost = 0, hostName = "", energyLabel = "Mana", suppressed = false } = {}) {
  const d = normalizeDevice(device);
  const host = hostName ? ` · ${hostName}` : "";
  if (suppressed) return { text: `placa suprimida (PEM)${host}`, tone: "bad", disabled: true, reason: "a tecnologia está suprimida (PEM)" };
  if (d.state === "off") return { text: `placa desligada${host}`, tone: "bad", disabled: true, reason: "a placa está desligada (curto-circuito leve)" };
  if (d.state === "damaged") return { text: `placa danificada${host}`, tone: "bad", disabled: true, reason: "a placa está danificada" };
  const pay = payProgramCost({ cost, reserve: d.reserve, nature: d.nature, infinite: d.infinite });
  if (!pay.ok) return { text: `sem Reserva (${natural(cost)})${host}`, tone: "bad", disabled: true, reason: `${hostName || "a placa"} está sem Reserva (precisa de ${natural(cost)}, tem ${d.reserve})` };
  if (pay.reason === "mana") return { text: `sem Reserva → ${pay.manaCost} ${energyLabel}${host}`, tone: "warn", disabled: false, reason: "" };
  return { text: `${programCostTag({ cost, infinite: d.infinite })}${host}`, tone: "ok", disabled: false, reason: "" };
}

/**
 * Um turno de manutenção (Habilidade Ativa de programa) pago pela Reserva da placa. Tecnológica sem Reserva
 * desliga a Skill (como Mana em 0); tecnomágica gasta o que resta e paga a diferença em energia, e desliga se
 * a energia também não cobre.
 * @returns {{reserve:number, energy:number, dropped:boolean, spentReserve:number, spentEnergy:number}}
 */
export function upkeepDeviceStep({ cost = 0, reserve = 0, nature = "tech", infinite = false, energy = 0 } = {}) {
  const have = natural(reserve);
  const pool = natural(energy);
  const pay = payProgramCost({ cost, reserve: have, nature, infinite });
  if (!pay.ok) return { reserve: have, energy: pool, dropped: true, spentReserve: 0, spentEnergy: 0 };
  if (pay.manaCost > pool) return { reserve: 0, energy: 0, dropped: true, spentReserve: have, spentEnergy: pool };
  return { reserve: pay.reserveAfter, energy: pool - pay.manaCost, dropped: false, spentReserve: have - pay.reserveAfter, spentEnergy: pay.manaCost };
}

/** "Reserva volta: Cyberdeck 6/6 · Rifle 4/4" para o Descanso; vazio se nenhuma placa recarrega. `hosts` = `[{name, device}]`. */
export function restReserveLine(hosts = []) {
  const parts = [];
  for (const host of hosts ?? []) {
    const d = normalizeDevice(host?.device);
    if (restRecharge(d).changed) parts.push(`${host.name} ${d.reserveMax}/${d.reserveMax}`);
  }
  return parts.length ? `Reserva volta: ${parts.join(" · ")}` : "";
}

/** Quem pode consertar: tem Skill com Engenharia. `skills` = o `system` de cada Skill do Ator. */
export function canRepairDevice(skills = []) {
  return (skills ?? []).some(s => s?.engineering === true);
}

/** A placa está pronta para um conserto (danificada)? */
export function needsRepair(device) {
  return normalizeDevice(device).state === "damaged";
}

/**
 * Problemas de uma placa para o Validar Mundo: programa instalado que a placa não aceita mais (o
 * `accepts` mudou), programas que não cabem nos encaixes e programa de arma numa placa que não é de arma.
 * @param {object} device - o `system.device`
 * @returns {string[]} frases pt-BR
 */
export function deviceProgramIssues(device, { hostIsWeapon = false } = {}) {
  const d = normalizeDevice(device);
  const out = [];
  let used = 0;
  for (const entry of d.programs) {
    const item = entry?.sourceItem;
    const program = item?.system?.program;
    const name = item?.name || "programa";
    if (!program?.enabled) {
      out.push(`${name}: o Item instalado não é mais um programa`);
      continue;
    }
    used += programSlots(program);
    if (d.accepts === "invasion" && !program.invasion?.enabled) out.push(`${name}: a placa só aceita programas de Invasão`);
    if (d.accepts === "weapon" && program.fits !== "weapon") out.push(`${name}: a placa só aceita programas de arma`);
    if (program.fits === "weapon" && !hostIsWeapon) out.push(`${name}: o programa só roda em arma e a placa não é uma`);
  }
  if (used > d.slots) out.push(`os programas ocupam ${used} encaixes e a placa tem ${d.slots}`);
  return out;
}
