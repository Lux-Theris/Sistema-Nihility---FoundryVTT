/**
 * Nomeação (7a): as contas PURAS (testadas em test/naming.test.mjs). Sem Foundry, sem imports.
 *
 * Quem nomeia perde Mana máxima para sempre; essa Mana vira XP para as Skills do nomeado, que podem
 * subir vários níveis de uma vez. O XP que não cabe em nenhuma Skill (todas no teto) NUNCA se perde:
 * fica guardado no nomeado (flag `namingXpBank`) até o Mestre Evoluir uma Skill para recebê-lo.
 */

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** Custo = soma dos `total` dos atributos de combate do alvo × fator, arredondado. */
export function namingCost(attrTotals, factor = 1) {
  const sum = (Array.isArray(attrTotals) ? attrTotals : Object.values(attrTotals ?? {})).reduce((acc, value) => acc + Math.max(0, num(value)), 0);
  return Math.max(0, Math.round(sum * Math.max(0, num(factor, 1))));
}

/**
 * Mana máxima de quem nomeia < custo → falha (a Mana atual vai a 0 e quem nomeia cai Inconsciente;
 * nada mais muda). `energyMax` já é a máxima atual (com o que já perdeu antes).
 * @returns {{ok: boolean, cost: number, shortBy: number}}
 */
export function namingOutcome(energyMax, cost) {
  const max = Math.max(0, num(energyMax));
  const price = Math.max(0, num(cost));
  return max < price ? { ok: false, cost: price, shortBy: price - max } : { ok: true, cost: price, shortBy: 0 };
}

/** XP total da Nomeação: a Mana perdida × o fator. */
export function namingXpTotal(cost, xpFactor = 10) {
  return Math.max(0, Math.round(Math.max(0, num(cost)) * Math.max(0, num(xpFactor, 10))));
}

/** A parte do XP do nomeado que vai também a quem nomeou (arredondada para baixo). */
export function soulShare(gain, percent = 10) {
  return Math.max(0, Math.floor((Math.max(0, num(gain)) * Math.max(0, num(percent, 10))) / 100));
}

/**
 * XP ganho por uma escrita no Ator: só conta quando o nível é o mesmo e o XP subiu (um Level Up
 * zera o XP; um valor que desce é correção do Mestre).
 */
export function xpGainFromChange({ oldLevel, newLevel, oldXp, newXp }) {
  if (num(oldLevel, 1) !== num(newLevel, 1)) return 0;
  return Math.max(0, Math.floor(num(newXp) - num(oldXp)));
}

/** O nome novo, aparado; "" quando não serve. */
export function cleanNamingName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? text.slice(0, 80).trim() : text;
}

/** Por que esta ficha não pode ser nomeada (texto pt-BR), ou null. */
export function namingBlockReason({ isCharacter, isFormTemplate, isFormActor, alreadyNamed, sameAsNamer } = {}) {
  if (!isCharacter) return "só um Personagem (ou criatura) pode ser nomeado";
  if (isFormTemplate) return "um molde de forma não pode ser nomeado";
  if (isFormActor) return "a cópia temporária de uma forma não pode ser nomeada";
  if (sameAsNamer) return "ninguém nomeia a si mesmo";
  if (alreadyNamed) return "já foi nomeado";
  return null;
}

/**
 * Reparte `totalXp` entre as Skills que ainda podem subir, nível a nível pela curva (`xpForLevel`).
 *  - Divide igual (o resto de uma divisão vai uma unidade às primeiras).
 *  - Cada Skill sobe quantos níveis o XP pagar; ao chegar no teto (`cap`), o que sobra volta ao pool
 *    e é redistribuído às outras, até não caber em ninguém: isso é o `leftover` (vai ao banco).
 *  - Uma Skill já no teto, ou `blocked` (concedida por Item, Maestria evoluída), não recebe nada.
 * @param {Array<{id: string, level: number, xp?: number, blocked?: boolean, cap?: number}>} skills
 * @param {number} totalXp
 * @param {{xpForLevel: (level:number) => number}} options
 * @returns {{updates: Array<{id:string, level:number, xp:number, levelsGained:number, absorbed:number}>, leftover: number}}
 */
export function namingXpDistribution(skills, totalXp, { xpForLevel } = {}) {
  const need = level => Math.max(1, Math.round(num(typeof xpForLevel === "function" ? xpForLevel(level) : 100 * level, 100 * level)));
  const state = new Map();
  for (const skill of skills ?? []) {
    const level = Math.max(1, Math.floor(num(skill.level, 1)));
    const cap = Number.isFinite(Number(skill.cap)) && skill.cap != null ? Math.floor(Number(skill.cap)) : Infinity;
    state.set(skill.id, { id: skill.id, level, xp: Math.max(0, num(skill.xp)), startLevel: level, startXp: Math.max(0, num(skill.xp)), cap, blocked: Boolean(skill.blocked), absorbed: 0 });
  }
  let pool = Math.max(0, Math.floor(num(totalXp)));

  /** Põe `amount` na Skill; devolve o que sobrou por ela estar no teto. */
  const absorb = (s, amount) => {
    s.xp += amount;
    s.absorbed += amount;
    while (s.level < s.cap && s.xp >= need(s.level)) {
      s.xp -= need(s.level);
      s.level += 1;
    }
    if (s.level >= s.cap) {
      const overflow = s.xp;
      s.absorbed -= overflow;
      s.xp = 0;
      return overflow;
    }
    return 0;
  };

  const eligible = () => [...state.values()].filter(s => !s.blocked && s.level < s.cap);
  for (let guard = 0; pool > 0 && guard < 1000; guard++) {
    const list = eligible();
    if (!list.length) break;
    const base = Math.floor(pool / list.length);
    let extra = pool - base * list.length;
    pool = 0;
    for (const s of list) {
      const share = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      if (share > 0) pool += absorb(s, share);
    }
  }

  const updates = [...state.values()]
    .filter(s => s.level !== s.startLevel || s.xp !== s.startXp)
    .map(s => ({ id: s.id, level: s.level, xp: s.xp, levelsGained: s.level - s.startLevel, absorbed: Math.max(0, s.absorbed) }));
  return { updates, leftover: pool };
}

/** A frase de uma linha da prévia: "Bola de Fogo: nv 3 → 5". */
export function namingPreviewLine(name, update, before) {
  const from = num(before?.level, 1);
  return update.levelsGained > 0 ? `${name}: nv ${from} → ${update.level}` : `${name}: +${update.absorbed} XP`;
}
