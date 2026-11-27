/**
 * Drenar (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * "Tirar de alguém para pôr em mim", em três tipos, todos num só conceito:
 *  - **Drenar Vida**: o roubo de vida da 1.119.0 (`lifeSteal`, "Cura quem usa % do dano") só mudou de nome; as Skills
 *    salvas continuam iguais. Também vale num efeito de Vida na hora ou periódico (o dano por rodada).
 *  - **Drenar Mana**: o que sai da Mana do alvo entra na de quem usa (efeito "Recuperar Mana" negativo, ou periódico de
 *    Mana negativo, com a caixa "Drenar" marcada). Quem usa recebe só o que o alvo realmente perdeu.
 *  - **Drenar atributo, temporário**: o alvo perde X de um atributo e quem usa ganha X pelos mesmos N turnos. São dois
 *    Active Effects ligados por um `drainId`; quando um termina (Antimagia, Dissipar, fim da duração, a Skill Ativa
 *    desligando) o outro termina junto.
 */

/** Os atributos que se drenam (os de combate; o resto da lista de alvos não tem par ganho/perda). */
export const DRAIN_ATTRIBUTES = ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "perception", "precision"];

/** Vitais que se drenam na hora, e os periódicos. */
const INSTANT_VITALS = { heal: "life", restoreEnergy: "mana" };
const PERIODIC_VITALS = { hp: "life", energy: "mana" };

/**
 * O tipo de Drenar de uma entrada de efeito, ou null se ela não drena nada:
 * `life` / `mana` (na hora), `tick-life` / `tick-mana` (periódico), `attribute` (temporário).
 * Só conta com a caixa `drain` marcada e um valor negativo (o que o alvo perde).
 */
export function drainKindOf(entry) {
  if (!entry?.drain) return null;
  const amount = Number(entry.amount) || 0;
  if (!(amount < 0)) return null;
  if (entry.periodic && PERIODIC_VITALS[entry.target]) return `tick-${PERIODIC_VITALS[entry.target]}`;
  if (!entry.periodic && INSTANT_VITALS[entry.target]) return INSTANT_VITALS[entry.target];
  if (!entry.periodic && DRAIN_ATTRIBUTES.includes(entry.target)) return "attribute";
  return null;
}

/** A caixa "Drenar" faz sentido neste alvo? (a UI só a mostra onde sim) */
export function targetAcceptsDrain(target, periodic = false) {
  if (periodic) return Boolean(PERIODIC_VITALS[target]);
  return Boolean(INSTANT_VITALS[target]) || DRAIN_ATTRIBUTES.includes(target);
}

/** O que quem usa recebe: o que o alvo de fato perdeu (nunca mais, nunca negativo). */
export function drainGainAmount(lost) {
  return Math.max(0, Math.round(Number(lost) || 0));
}

/** O valor do ganho de quem usa num dreno de atributo: o mesmo X que o alvo perde (positivo). */
export function drainAttributeGain(amount) {
  return Math.max(0, Math.abs(Math.round(Number(amount) || 0)));
}

/**
 * Entrada de efeito do ganho de quem usa, a partir da perda do alvo: mesmo alvo, valor positivo, sem Condição,
 * sem periódico e sem as marcas do efeito original. Pura; quem cria o Active Effect é `skills/drain.js`.
 */
export function drainGainEntry(entry) {
  return {
    ...entry,
    amount: drainAttributeGain(entry.amount),
    conditionId: "",
    periodic: false,
    drain: false,
    piercesCondition: false,
    chance: 100,
    onlyIf: { kind: "", value: "", threshold: 50 }
  };
}

/** A frase curta de um efeito que drena, para a "Skill numa frase": "drena 5 de Força (quem usa ganha 5)". */
export function drainSentence(entry, { targetLabel = "", energyLabel = "Mana" } = {}) {
  const kind = drainKindOf(entry);
  const n = Math.abs(Math.round(Number(entry?.amount) || 0));
  switch (kind) {
    case "life": return `drena ${n} de Vida (quem usa recupera o que sair)`;
    case "mana": return `drena ${n} de ${energyLabel} (quem usa recupera o que sair)`;
    case "tick-life": return `drena ${n} de Vida por rodada (quem usa recupera)`;
    case "tick-mana": return `drena ${n} de ${energyLabel} por rodada (quem usa recupera)`;
    case "attribute": return `drena ${n} de ${targetLabel || entry.target} (quem usa ganha ${n} pelo mesmo tempo)`;
    default: return "";
  }
}

/** A linha do resultado no resumo: "Mana −8 no alvo, +8 em Kael". */
export function drainResultText({ kind, lost = 0, gained = 0, casterName = "", label = "" } = {}) {
  if (!(lost > 0)) return "";
  const what = label || (kind === "mana" || kind === "tick-mana" ? "Mana" : "Vida");
  return gained > 0 ? `Drenou ${lost} de ${what}: ${casterName} recupera ${gained}` : `Drenou ${lost} de ${what}, mas ${casterName} não recebeu nada (cheio ou bloqueado)`;
}

/**
 * Os Active Effects do dreno de atributo que ficam órfãos quando `removed` termina: os outros efeitos do mesmo `drainId`.
 * @param {Array<{id:string, drainId?:string}>} effects - efeitos candidatos (de quem usa e do alvo)
 * @param {{id:string, drainId?:string}} removed
 */
export function linkedDrainEffects(effects, removed) {
  const drainId = removed?.drainId;
  if (!drainId) return [];
  return (effects ?? []).filter(e => e.drainId === drainId && e.id !== removed.id);
}

/** Avisos do editor (lint): { code, level, text } por problema, sem o prefixo "Efeito N:". */
export function drainLint(entry) {
  if (!entry?.drain) return [];
  const out = [];
  if (!(Number(entry.amount) < 0)) out.push({ code: "drainPositive", level: "hard", text: "\"Drenar\" precisa de um valor negativo (o que o alvo perde): com valor positivo não drena nada." });
  else if (!drainKindOf(entry)) out.push({ code: "drainTarget", level: "hard", text: "\"Drenar\" só vale em Vida ou Mana (na hora ou periódico) e nos atributos de combate: neste alvo a caixa não faz nada." });
  return out;
}
