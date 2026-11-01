/**
 * Avisos no editor de Skill (backlog L8; canvas "Editor de Skill Assistido", prancha 1): o
 * Validar Mundo para UMA Skill, na hora. Puro e testado (test/skill-assist.test.mjs) — os
 * catálogos e o "é uma fórmula válida?" chegam em `ctx`.
 *
 * Nunca impede de salvar: cada aviso diz o que provavelmente não era a intenção.
 * `level`: "hard" (não faz nada / não se aplica) ou "soft" (confira).
 * `tab`: "general" | "mechanic" — onde o campo mora na ficha. `effect`: índice do card, ou null.
 */
import { MEU_SISTEMA } from "../core/config/constants.js";

/** Alvos em que "Periódico" funciona (o mesmo do editor). */
export const PERIODIC_TARGETS = ["hp", "energy", "shipCasco", "shipHull"];

/** Alvos que agem na hora e não ficam "para sempre" sem duração. */
const INSTANT_TARGETS = ["heal", "restoreEnergy", "shield", "antimagic", "shipShieldRestore", "shipCasco", "shipHull", "shipDamageReduction"];

/** Alvos em que o valor não importa (liga/desliga, troca de elemento, Antimagia pelo nível). */
const VALUELESS_TARGETS = ["weaponElement", "bodyElement", "weaponMagic", "weaponAbsolute", "antimagic"];

const groupTargets = actor => new Set(MEU_SISTEMA.EFFECT_TARGET_GROUPS.filter(g => g.actor === actor).flatMap(g => g.targets));

/**
 * @param {object} mech - a Skill (ou Sub-Skill) no formato do schema
 * @param {object} [ctx]
 * @param {Set<string>|string[]} [ctx.conditions] - ids do catálogo de Condições
 * @param {Set<string>|string[]} [ctx.elements] - ids dos Tipos de Dano
 * @param {Set<string>|string[]} [ctx.structures] - ids do catálogo de Estruturas
 * @param {"character"|"ship"|null} [ctx.actorType] - quem tem a Skill (null = sem ficha)
 * @param {number|null} [ctx.energyMax] - Mana/Bateria máxima de quem tem a Skill
 * @param {(formula: string) => boolean} [ctx.validFormula]
 * @param {string} [ctx.energyLabel]
 * @returns {Array<{code: string, level: "hard"|"soft", tab: string, effect: number|null, text: string}>}
 */
export function lintSkill(mech, ctx = {}) {
  const out = [];
  const m = mech ?? {};
  const has = (list, id) => (list instanceof Set ? list.has(id) : Array.isArray(list) ? list.includes(id) : true);
  const energy = ctx.energyLabel || "Mana";
  const push = (code, level, tab, text, effect = null) => out.push({ code, level, tab, effect, text });
  const effects = Array.isArray(m.effects) ? m.effects : [];
  const effectType = m.effectType ?? "none";
  const structure = effectType === "structure" || m.targetType === "structure";
  const usesTarget = effectType === "damage" || effectType === "temporary";
  const isArea = usesTarget && (m.targetType === "emission" || m.targetType === "zone");
  const active = Boolean(m.hasUpkeep);

  // --- Custo e ativação (aba Geral)
  if (!active && Number(m.upkeepCost) > 0) push("upkeepNotActive", "hard", "general", `Custo por rodada (${m.upkeepCost}) só vale em Habilidade Ativa: esta não é, então ele nunca é cobrado.`);
  if (active && !(Number(m.upkeepCost) > 0)) push("activeFree", "soft", "general", "Habilidade Ativa sem Custo por rodada: fica ligada de graça para sempre.");
  if (ctx.energyMax != null && Number(m.cost) > 0 && Number(m.cost) > Number(ctx.energyMax)) {
    push("costOverPool", "hard", "general", `Custa ${m.cost} e quem tem a Skill só tem ${ctx.energyMax} de ${energy} máxima: nunca dá para usar.`);
  }

  // --- Mecânica
  if (usesTarget && isArea && !(Number(m.areaDistance) > 0)) push("areaZero", "hard", "mechanic", `${m.targetType === "zone" ? "Zona" : "Área"} com distância 0: ninguém fica dentro.`);
  if (usesTarget && m.targetType === "zone" && !active && !(Number(m.zoneRounds) > 0)) push("zoneRounds", "hard", "mechanic", "Zona sem rodadas: some antes de bater em alguém.");

  if (effectType === "damage") {
    const formula = String(m.damageFormula ?? "").trim();
    if (!formula) push("noFormula", "hard", "mechanic", "Mecânica Dano sem Fórmula de Dano: usar não rola nada.");
    else if (ctx.validFormula && !ctx.validFormula(formula)) push("badFormula", "hard", "mechanic", `Fórmula "${formula}" não é uma rolagem válida: o uso vai falhar.`);
    if (m.isAbsoluteDamage && m.isMagicDamage) push("absoluteMagic", "soft", "mechanic", "Dano Absoluto com Dano Mágico: o Absoluto já ignora a Defesa Mágica, então o Mágico não muda nada (só a Antimagia).");
    for (const id of m.damageElements ?? []) {
      if (ctx.elements && !has(ctx.elements, id)) push("unknownElement", "hard", "mechanic", `Elemento "${id}" não existe mais no catálogo de Tipos de Dano.`);
    }
  }

  if (structure) {
    if (!m.structureId) push("noStructure", "hard", "mechanic", "Mecânica Estrutura sem Estrutura escolhida: usar não ergue nada.");
    else if (ctx.structures && !has(ctx.structures, m.structureId)) push("unknownStructure", "hard", "mechanic", `Estrutura "${m.structureId}" não existe mais no catálogo.`);
  }

  if (effectType === "temporary") {
    if (!effects.length) push("noEffects", "hard", "mechanic", "Mecânica Efeito sem nenhum Efeito: usar não faz nada.");
    const shipOnly = groupTargets("ship");
    const characterOnly = groupTargets("character");
    effects.forEach((e, i) => {
      const n = `Efeito ${i + 1}`;
      const target = e?.target ?? "";
      if (e?.periodic && !PERIODIC_TARGETS.includes(target)) push("periodicTarget", "hard", "mechanic", `${n}: Periódico só funciona em Vida ou ${energy} (ou Casco/Integridade de Nave). Este vira um efeito comum.`, i);
      if ((Number(e?.shieldRegen) > 0 || Number(e?.shieldCap) > 0) && target === "shield" && !active) push("sustainedNotActive", "hard", "mechanic", `${n}: Escudo mantido (regeneração/teto) só vale em Habilidade Ativa.`, i);
      if (!Number(e?.amount) && !e?.conditionId && !VALUELESS_TARGETS.includes(target)) push("zeroEffect", "hard", "mechanic", `${n}: valor 0 e sem Condição — não muda nada.`, i);
      if (e?.conditionId && ctx.conditions && !has(ctx.conditions, e.conditionId)) push("unknownCondition", "hard", "mechanic", `${n}: a Condição "${e.conditionId}" não existe mais no catálogo.`, i);
      for (const id of e?.damageElements ?? []) {
        if (ctx.elements && !has(ctx.elements, id)) push("unknownElement", "hard", "mechanic", `${n}: elemento "${id}" não existe mais no catálogo.`, i);
      }
      if (["weaponElement", "bodyElement"].includes(target) && e?.elementId && ctx.elements && !has(ctx.elements, e.elementId)) push("unknownElement", "hard", "mechanic", `${n}: elemento "${e.elementId}" não existe mais no catálogo.`, i);
      // Um tripulante pode mirar a Nave com efeito de Nave; só "Si mesmo" é certeza de que não pega.
      if (m.targetType === "self" && ctx.actorType === "character" && shipOnly.has(target)) push("shipOnSelf", "hard", "mechanic", `${n}: efeito de Nave numa Skill "Si mesmo" de Personagem — cai no próprio personagem e não faz nada.`, i);
      if (m.targetType === "self" && ctx.actorType === "ship" && characterOnly.has(target)) push("characterOnSelf", "hard", "mechanic", `${n}: efeito de Personagem numa Skill "Si mesmo" de Nave — não se aplica a uma Nave.`, i);
      const lasting = !e?.periodic && !INSTANT_TARGETS.includes(target) && !(Number(e?.durationRounds) > 0);
      if (lasting && !active && (Number(e?.amount) || e?.conditionId)) push("forever", "soft", "mechanic", `${n}: sem duração numa Skill que não é Ativa — fica no alvo para sempre (até alguém tirar). Era isso?`, i);
    });
  }
  return out;
}

/** Contagem por aba e lista por card (para o número na aba e a linha embaixo do card). */
export function lintIndex(items) {
  const byTab = {};
  const byEffect = {};
  for (const item of items ?? []) {
    byTab[item.tab] = (byTab[item.tab] ?? 0) + 1;
    if (item.effect != null) (byEffect[item.effect] ??= []).push(item);
  }
  return { byTab, byEffect };
}
