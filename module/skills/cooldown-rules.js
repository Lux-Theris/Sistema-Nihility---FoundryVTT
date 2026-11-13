/**
 * Recarga, Preparo e investir além da Mana (backlog H3 e C2) — a parte pura, testada em test/.
 *
 * Tudo conta em TURNOS DO DONO da Skill, só em combate (o gancho é o início do turno dele).
 *
 *  - **Recarga N:** depois de usada, a Skill fica bloqueada nos N turnos seguintes do dono e volta
 *    a poder ser usada no seguinte (usada na rodada 1 com recarga 1 → bloqueada na 2, livre na 3:
 *    um dano com recarga N cai a cada N+1 rodadas). O que se guarda é "turnos até poder usar"
 *    (`cooldownRemaining` = N + 1 logo após o uso), que cai 1 no começo de cada turno do dono.
 *  - **Sobrecarga:** investir mais de 2× o Custo (r = investido ÷ Custo > 2) soma recarga
 *    ⌈(r − 2)² × k⌉ (k nas Regras da Mesa) — uma Skill sem recarga ganha uma; uma com recarga cresce.
 *  - **Preparo N:** "fica pronta em N rodadas". O Custo todo é dividido em N partes, a 1ª paga ao
 *    começar e as outras no começo de cada turno de preparo; no turno seguinte à última parte a
 *    Skill dispara sem pagar de novo. Faltou Mana numa parte → a Skill falha (o pago se perde).
 *    (Custo 90, Preparo 3: 30 ao começar, 30 no turno 2, 30 no turno 3, dispara no 4º.)
 *  - **Investir além da Mana:** pode-se investir até 2× a Mana máxima; acima da Mana que se tem, o
 *    uso pede confirmação, e depois rola-se um d100 (o Mestre decide o bom/ruim) e a pessoa cai
 *    Inconsciente com a Mana em 0.
 */

const whole = value => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Razão a partir da qual o investimento passa a gerar recarga extra. */
export const OVERCHARGE_FREE_RATIO = 2;

/** Rodadas extras de recarga pela sobrecarga: ⌈(r − 2)² × k⌉ para r > 2, senão 0. */
export function overchargeExtraCooldown(ratio, factor = 1) {
  const r = Number(ratio);
  const k = Number(factor);
  if (!Number.isFinite(r) || !Number.isFinite(k) || k <= 0 || r <= OVERCHARGE_FREE_RATIO) return 0;
  return Math.ceil((r - OVERCHARGE_FREE_RATIO) ** 2 * k - 1e-9);
}

/** Recarga total de um uso: a da Skill mais a da sobrecarga. */
export function totalCooldown(base, ratio = 1, factor = 1) {
  return whole(base) + overchargeExtraCooldown(ratio, factor);
}

/** O que gravar em `cooldownRemaining` logo após o uso: N turnos bloqueada = N + 1 até poder usar. */
export function cooldownToStore(total) {
  const n = whole(total);
  return n > 0 ? n + 1 : 0;
}

/** Início de um turno do dono: a recarga anda 1. */
export function tickCooldown(stored) {
  return Math.max(0, whole(stored) - 1);
}

/** Pode usar? (`stored` > 0 = ainda em recarga). */
export function onCooldown(stored) {
  return whole(stored) > 0;
}

/** Quantas rodadas ainda faltam para a recarga acabar, para o texto ("recarga 2"). */
export function cooldownLabelTurns(stored) {
  return whole(stored);
}

/**
 * As N partes do Custo de um Preparo (soma exata = total; o resto da divisão vai para as primeiras).
 * Preparo 0 → uma parte só (paga na hora).
 */
export function preparationPayments(total, turns) {
  const parts = Math.max(1, whole(turns));
  const cost = whole(total);
  const base = Math.floor(cost / parts);
  const extra = cost - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * O que acontece no começo de um turno do dono com uma Skill em preparo.
 * `turnsLeft` conta os turnos do dono até disparar (na criação = Preparo N); `payments` são as
 * partes (a 1ª já foi paga ao começar); `paid` quantas já foram pagas.
 * @returns {{action: "pay", amount: number, turnsLeft: number, paid: number}|{action: "release", turnsLeft: 0, paid: number}}
 */
export function preparationStep({ turnsLeft, payments = [], paid = 1 } = {}) {
  const left = whole(turnsLeft) - 1;
  if (left <= 0 || paid >= payments.length) return { action: "release", turnsLeft: 0, paid };
  return { action: "pay", amount: whole(payments[paid]), turnsLeft: left, paid: paid + 1 };
}

/** Teto do que se pode investir: o dobro da Mana máxima. */
export function investCeiling(maxEnergy) {
  return Math.floor(Math.max(0, Number(maxEnergy) || 0) * 2);
}

/**
 * Ajusta o que a pessoa digitou ao que vale: nunca menos que o piso (o Custo, ou o mínimo da Mana
 * variável) nem mais que o teto (2× a Mana máxima). Piso maior que o teto → o teto vence.
 */
export function clampInvestment(invested, { floor = 0, maxEnergy = 0 } = {}) {
  const ceiling = investCeiling(maxEnergy);
  const n = Math.round(Number(invested));
  const value = Number.isFinite(n) ? n : floor;
  return Math.max(0, Math.min(ceiling, Math.max(whole(floor), value)));
}

/**
 * Passou da Mana que tem? `percent` = quanto além, em % da Mana atual (com a Mana em 0, da máxima,
 * para não dividir por zero): 100 de Mana, investiu 180 → "+80% além".
 * @returns {{over: boolean, excess: number, percent: number}}
 */
export function overdrawInfo({ invested = 0, current = 0, max = 0 } = {}) {
  const spend = Math.max(0, Number(invested) || 0);
  const have = Math.max(0, Number(current) || 0);
  const excess = Math.max(0, spend - have);
  if (!excess) return { over: false, excess: 0, percent: 0 };
  const base = have > 0 ? have : Math.max(1, Number(max) || 1);
  return { over: true, excess, percent: Math.round((excess / base) * 100) };
}

/** Texto do aviso de recarga ("X está em recarga (2 rodadas)."). */
export function cooldownMessage(label, stored) {
  const n = whole(stored);
  return `${label} está em recarga (${n} ${n === 1 ? "rodada" : "rodadas"}).`;
}

/* ------------------------------------------------------------------ Opções do uso, guardadas no Preparo */

const COPIED_OPTION_KEYS = ["structurePlacement", "zonePlacement", "rollOptions", "manaInvested", "viaMark"];

/**
 * As opções de um uso (alvos, área, posição, rolagem) como dados simples, para ficarem no flag do
 * Ator até o disparo. Alvos viram uuid; a forma da área (que vem como propriedade da lista de alvos)
 * e a origem ficam ao lado.
 */
export function packUseOptions(options = {}) {
  const out = {};
  if (options.targetActor?.uuid) out.targetUuid = options.targetActor.uuid;
  if (Array.isArray(options.targetActors)) {
    out.targetUuids = options.targetActors.map(a => a?.uuid).filter(Boolean);
    if (options.targetActors.area) out.area = options.targetActors.area;
    if (options.targetActors.origin) out.origin = options.targetActors.origin;
  }
  for (const key of COPIED_OPTION_KEYS) if (options[key] !== undefined && options[key] !== null) out[key] = options[key];
  return JSON.parse(JSON.stringify(out));
}

/**
 * O inverso de `packUseOptions`. `resolve(uuid)` devolve o Ator ou null. Alvo único que sumiu marca
 * `targetUuidMissing` (o disparo não tem em quem cair); alvos de área que sumiram só ficam de fora.
 */
export function unpackUseOptions(packed = {}, resolve = () => null) {
  const out = {};
  if (packed.targetUuid) {
    const actor = resolve(packed.targetUuid);
    if (actor) out.targetActor = actor;
    else out.targetUuidMissing = true;
  }
  if (Array.isArray(packed.targetUuids)) {
    const list = packed.targetUuids.map(uuid => resolve(uuid)).filter(Boolean);
    if (packed.area) list.area = packed.area;
    if (packed.origin) list.origin = packed.origin;
    out.targetActors = list;
  }
  for (const key of COPIED_OPTION_KEYS) if (packed[key] !== undefined) out[key] = packed[key];
  return out;
}
