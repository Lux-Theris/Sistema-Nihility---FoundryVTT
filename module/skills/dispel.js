/**
 * Antimagia (prancha 8) e PEM (o espelho tecnológico): o efeito de Skill num alvo — corta na hora
 * os efeitos de Skill que alcança, desliga as Habilidades Ativas dele e aplica a Condição
 * "Suprimido (Antimagia)" / "Suprimido (Tecnologia)", que segura passivos, Resistências, itens e
 * implantes da natureza dela enquanto durar. Antimagia alcança o mágico (e o tecnomágico); o PEM o
 * tecnológico (e o tecnomágico); o analógico é imune aos dois. Uma só implementação, com `kind`.
 *
 * Alcance: o nível da Skill × a Regra da Mesa "alcance" (padrão 1,5 — nível 10 alcança até 15).
 * Efeito sem nível guardado (marcado à mão, de antes desta regra) conta como nível 0. Corta o que é
 * de Skill, bom ou ruim; Título, Espécie e partes naturais nunca (ver skillIsMagic/skillIsTech).
 *
 * Camada do tipo oposto protege (protectedFromKind): quem tem um Escudo só mágico não é alcançado
 * pelo PEM, e quem tem um Escudo só tecnológico não é alcançado pela Antimagia; o mesmo vale para
 * uma Estrutura do tipo oposto no caminho ou em volta (`structureKinds`, calculado por quem chama).
 *
 * PEM em corpo mecânico (Traço `mechanical`) também deixa o alvo Inconsciente enquanto a Supressão
 * tecnológica durar (incapacitation.js). PEM em Nave/Veículo derruba Módulos e drena a Bateria
 * (starship-power.js). Skills Raciais e passivos de origem não são suprimidos pelo PEM.
 */
import { effectRoundsUpdate, effectDurationRounds } from "../helpers/foundry-compat.js";
import { SYSTEM_ID, getActiveStatusConditions, getAntimagicReach } from "../core/config.js";
import { dispelledEffects, dissipatedEffects, skillNature, fieldSuppressionPlan, protectedFromKind } from "../core/magic-rules.js";
import { removeShieldPool, shieldPoolsOf } from "../combat/shield-pools.js";
import { collectActiveUpkeepSources, removeUpkeepLinkedEffects } from "./upkeep.js";
import { skillStateUpdate } from "./skill-state.js";
import { SUPPRESSION_FLAG, TECH_SUPPRESSION_FLAG, suppressionLevel, techSuppressionLevel } from "../core/suppression.js";
import { applyEmpShutdown, releaseEmpShutdown } from "../combat/incapacitation.js";
import { applyEmpToShip } from "../starship/starship-power.js";
import { sustainsOwnField } from "../structures/structures.js";

export { SUPPRESSION_FLAG, TECH_SUPPRESSION_FLAG, suppressionLevel, techSuppressionLevel };

/** Tudo que muda entre a Antimagia ("magic") e o PEM ("tech"). */
const KIND = {
  magic: {
    flag: SUPPRESSION_FLAG,
    fieldFlag: "antimagicField",
    isCondition: c => c.suppressesMagic,
    defaultLabel: "Suprimido (Antimagia)",
    defaultId: "antimagic-suppressed",
    word: "antimagia"
  },
  tech: {
    flag: TECH_SUPPRESSION_FLAG,
    fieldFlag: "interferenceField",
    isCondition: c => c.suppressesTech,
    defaultLabel: "Suprimido (Tecnologia)",
    defaultId: "tech-suppressed",
    word: "interferência"
  }
};

/** Nível alcançado por uma Antimagia/PEM de nível `level` (com o alcance da mesa). */
export function antimagicReachLevel(level) {
  return Math.floor((Math.max(0, Number(level) || 0) * getAntimagicReach()) + 1e-9);
}
export { antimagicReachLevel as empReachLevel };

/** Natureza e nível de uma Skill (ou Sub-Skill) para a supressão. */
function skillLevelNature(sys, actor) {
  return { ...skillNature(sys, actor), level: Math.max(0, Number(sys?.level) || 0) };
}

/** As camadas de Escudo do alvo com a natureza da Skill de cada uma (para protectedFromKind). */
function shieldKindsOf(target) {
  const out = [];
  for (const pool of shieldPoolsOf(target) ?? []) {
    const holder = pool.holderUuid ? fromUuidSync(pool.holderUuid) : null;
    const skill = holder?.items?.get(pool.skillId);
    if (!skill) continue;
    const sys = pool.subSkillIndex != null ? skill.system.subSkills?.[pool.subSkillIndex] ?? skill.system : skill.system;
    const { magic, tech } = skillLevelNature({ ...sys, tier: skill.system.tier }, holder);
    out.push({ magic, tech, value: Number(pool.value) || 0 });
  }
  return out;
}

/**
 * Aplica a Antimagia num alvo. Devolve as linhas do resumo para o chat.
 * @param {Actor} target
 * @param {{level:number, rounds?:number, reach?:number, field?:string, structureKinds?:object[]}} options -
 *   `level` = nível da Skill; `rounds` = supressão (0 = até tirar); `reach` = alcance direto (campo:
 *   o nível do campo, sem o multiplicador da mesa); `field` = id da Cena do campo: a Supressão é a
 *   do campo (sem prazo, sai quando o Token sai do campo — ver releaseFieldSuppression) e não mexe
 *   na de Skill; `structureKinds` = natureza das Estruturas que protegem o alvo.
 *   O resumo traz `changed` = quantas coisas acabaram de verdade.
 */
export function applyAntimagic(target, options = {}) {
  return applyDispel(target, "magic", options);
}

/** PEM: o espelho tecnológico da Antimagia (mesmas opções). */
export function applyEmp(target, options = {}) {
  return applyDispel(target, "tech", options);
}

async function applyDispel(target, kind, { level = 0, rounds = 0, reach: fixedReach = null, field = null, structureKinds = [] } = {}) {
  const config = KIND[kind];
  const reach = fixedReach !== null ? Math.max(0, Math.floor(Number(fixedReach) || 0)) : antimagicReachLevel(level);
  let changed = 0;
  const summary = [];
  // XP por uso (skill-xp.js): ganha pelo que desligou — cada efeito cortado, cada Habilidade Ativa
  // desligada e a Supressão contam o fixo; Escudo cortado conta pelo tamanho.
  const xp = [];
  summary.xp = xp;
  summary.changed = 0;

  // Camada do tipo oposto (Escudo ou Estrutura) segura tudo isto.
  if (protectedFromKind({ kind, shieldKinds: shieldKindsOf(target), structureKinds })) {
    summary.push(`${target.name} está protegido por uma camada ${kind === "tech" ? "mágica" : "tecnológica"}: ${config.word === "antimagia" ? "a antimagia" : "o PEM"} não o alcança`);
    return summary;
  }

  // PEM numa Nave/Veículo: Módulos caem e a Bateria é drenada.
  if (kind === "tech" && ["starship", "vehicle"].includes(target.type)) {
    const lines = await applyEmpToShip(target, { reach, rounds });
    summary.push(...lines);
    changed += lines.length;
    for (let i = 0; i < lines.length; i++) xp.push({ flat: true });
    summary.changed = changed;
    return summary;
  }

  // 1) Efeitos de Skill da natureza, de nível ≤ alcance (as supressões e as Condições do corpo ficam).
  const effects = target.effects.map(e => {
    const flags = e.flags?.[SYSTEM_ID] ?? {};
    return {
      id: e.id,
      name: e.name,
      level: Number(flags.sourceLevel) || 0,
      magic: Boolean(flags.magic),
      tech: Boolean(flags.tech),
      keep: flags[SUPPRESSION_FLAG] !== undefined || flags[TECH_SUPPRESSION_FLAG] !== undefined || flags.empShutdown !== undefined || Boolean(flags.bodyInjury)
    };
  });
  const cut = dispelledEffects(effects.filter(e => !e.keep), reach, kind === "tech" ? "tech" : "magic");
  if (cut.length) {
    await target.deleteEmbeddedDocuments("ActiveEffect", cut);
    changed += cut.length;
    for (let i = 0; i < cut.length; i++) xp.push({ flat: true });
    summary.push(`${effects.filter(e => cut.includes(e.id)).map(e => e.name).join(", ")} removido(s)`);
  }
  const natureKey = kind === "tech" ? "tech" : "magic";
  const kept = effects.filter(e => e[natureKey] && !e.keep && !cut.includes(e.id));
  if (kept.length) summary.push(`${kept.map(e => `${e.name} (nv ${e.level})`).join(", ")} resistiu(ram): nível maior`);

  // 2) Escudos de Skill da natureza de nível ≤ alcance.
  for (const pool of shieldPoolsOf(target) ?? []) {
    const holder = pool.holderUuid ? fromUuidSync(pool.holderUuid) : null;
    const skill = holder?.items?.get(pool.skillId);
    if (!skill) continue;
    const sys = pool.subSkillIndex != null ? skill.system.subSkills?.[pool.subSkillIndex] ?? skill.system : skill.system;
    const nature = skillLevelNature({ ...sys, tier: skill.system.tier }, holder);
    if (!nature[natureKey] || nature.level > reach) continue;
    const removed = await removeShieldPool(target, pool);
    if (removed) {
      changed++;
      summary.push(`Escudo de ${skill.name} (−${removed})`);
      xp.push({ value: removed, base: Number(target.system?.attributes?.hp?.max) || 1 });
    }
  }

  // 3) Habilidades Ativas da natureza do alvo, de nível ≤ alcance: desligam (religar paga de novo).
  if (target.type === "character") {
    const off = [];
    for (const source of collectActiveUpkeepSources(target)) {
      const sys = source.subSkillIndex != null ? source.skill.system.subSkills?.[source.subSkillIndex] : source.skill.system;
      const nature = skillLevelNature({ ...sys, tier: source.skill.system.tier }, target);
      if (!nature[natureKey] || nature.level > reach) continue;
      // A Antimagia nunca desliga a Skill que sustenta o próprio campo (1.118.0).
      if (sustainsOwnField(target, source.skill.id, source.subSkillIndex ?? null)) continue;
      await source.skill.update(skillStateUpdate(source.skill, source.subSkillIndex, { active: false }));
      await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
      off.push(source.label);
      changed++;
      xp.push({ flat: true });
    }
    if (off.length) summary.push(`${off.join(", ")} desligada(s)`);
  }

  // 4) Condição "Suprimido": renova ficando com o maior nível e a maior duração.
  const suppression = await applySuppression(target, kind, reach, rounds, { field });
  if (suppression) {
    summary.push(suppression);
    xp.push({ flat: true });
  }

  // 5) PEM em corpo mecânico: desliga (Inconsciente) enquanto a Supressão tecnológica durar.
  if (kind === "tech") {
    const shutdown = await applyEmpShutdown(target, { rounds, field: Boolean(field) });
    if (shutdown) {
      summary.push(shutdown);
      changed++;
      xp.push({ flat: true });
    }
  }
  summary.changed = changed;
  return summary;
}

/**
 * Dissipar (8d.2): o mesmo motor da Antimagia com outro modo. Termina só os Active Effects MÁGICOS do alvo
 * de nível ≤ o da Skill (alcance = o nível, sem o ×1,5), sem aplicar "Suprimido", sem desligar Skills Ativas
 * e sem tocar Escudos nem Estruturas. `scope`: "all" | "marks" | "condition" (+ `conditionId`).
 * O resumo traz `xp` (o fixo por efeito terminado) e `changed`.
 */
export async function applyDissipate(target, { level = 0, scope = "all", conditionId = "" } = {}) {
  const summary = [];
  const xp = [];
  summary.xp = xp;
  summary.changed = 0;
  const markIds = getActiveStatusConditions().filter(c => c.isMark).map(c => c.id);
  const effects = target.effects.map(e => {
    const flags = e.flags?.[SYSTEM_ID] ?? {};
    return {
      id: e.id,
      name: e.name,
      level: Number(flags.sourceLevel) || 0,
      magic: Boolean(flags.magic),
      conditionId: flags.conditionId || "",
      keep: flags[SUPPRESSION_FLAG] !== undefined || flags[TECH_SUPPRESSION_FLAG] !== undefined || flags.empShutdown !== undefined || Boolean(flags.bodyInjury)
    };
  });
  const candidates = effects.filter(e => !e.keep);
  const cut = dissipatedEffects(candidates, { level, scope, conditionId, markIds });
  if (cut.length) {
    await target.deleteEmbeddedDocuments("ActiveEffect", cut);
    for (let i = 0; i < cut.length; i++) xp.push({ flat: true });
    summary.push(`${effects.filter(e => cut.includes(e.id)).map(e => e.name).join(", ")} dissipado(s)`);
    summary.changed = cut.length;
  }
  // O que o escopo pegaria se o nível bastasse: resistiu.
  const reachable = new Set(dissipatedEffects(candidates, { level: Number.MAX_SAFE_INTEGER, scope, conditionId, markIds }));
  const resisted = candidates.filter(e => reachable.has(e.id) && !cut.includes(e.id));
  if (resisted.length) summary.push(`${resisted.map(e => `${e.name} (nv ${e.level})`).join(", ")} resistiu(ram): nível maior que ${Math.max(0, Math.floor(Number(level) || 0))}`);
  if (!cut.length && !resisted.length) summary.push(`nada mágico para dissipar em ${target.name}`);
  return summary;
}

/** Marca da Supressão que veio de um campo antimagia (e não de uma Skill). */
export const FIELD_SUPPRESSION_FLAG = "antimagicField";
/** O mesmo para um campo de interferência. */
export const TECH_FIELD_SUPPRESSION_FLAG = "interferenceField";

const isSuppression = (e, kind) => e.flags?.[SYSTEM_ID]?.[KIND[kind].flag] !== undefined;
const isFieldSuppression = (e, kind) => e.flags?.[SYSTEM_ID]?.[KIND[kind].fieldFlag] !== undefined;

/**
 * Tira a Supressão de campo do Ator (saiu do campo, ou o campo caiu). A de Skill nunca é tocada.
 * No campo de interferência, quem foi desligado por ele (corpo mecânico) acorda.
 */
export async function releaseFieldSuppression(actor, kind = "magic") {
  const ids = (actor?.effects ?? []).filter(e => isSuppression(e, kind) && isFieldSuppression(e, kind)).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if (kind === "tech") await releaseEmpShutdown(actor, { field: true });
  return ids.length;
}

async function applyFieldSuppression(target, kind, reach, sceneId) {
  const config = KIND[kind];
  const condition = getActiveStatusConditions().find(config.isCondition);
  const name = `${condition?.label ?? config.defaultLabel} · campo nv ${reach}`;
  const existing = target.effects.find(e => isSuppression(e, kind) && isFieldSuppression(e, kind));
  const plan = fieldSuppressionPlan({ fieldLevel: reach, existingLevel: existing ? Number(existing.flags[SYSTEM_ID][config.flag]) || 0 : null });
  if (plan === "update") {
    await existing.update({ [`flags.${SYSTEM_ID}.${config.flag}`]: reach, [`flags.${SYSTEM_ID}.sourceLevel`]: reach, [`flags.${SYSTEM_ID}.${config.fieldFlag}`]: { sceneId }, name });
    return `Suprimido pelo campo (nv ${reach})`;
  }
  if (plan !== "create") return "";
  await target.createEmbeddedDocuments("ActiveEffect", [
    {
      name,
      img: condition?.icon || "icons/svg/cancel.svg",
      statuses: condition ? [condition.id] : [],
      duration: {},
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: condition?.id ?? config.defaultId, [config.flag]: reach, [config.fieldFlag]: { sceneId }, sourceLevel: reach, magic: false, tech: false } }
    }
  ]);
  return `Suprimido pelo campo (nv ${reach}) enquanto estiver nele`;
}

async function applySuppression(target, kind, reach, rounds, { field = null } = {}) {
  if (field) return applyFieldSuppression(target, kind, reach, field);
  const config = KIND[kind];
  const condition = getActiveStatusConditions().find(config.isCondition);
  const existing = target.effects.find(e => isSuppression(e, kind) && !isFieldSuppression(e, kind));
  const duration = Math.max(0, Math.round(Number(rounds) || 0));
  if (existing) {
    const level = Math.max(Number(existing.flags[SYSTEM_ID][config.flag]) || 0, reach);
    const remaining = existing.duration?.remaining ?? null;
    const update = { [`flags.${SYSTEM_ID}.${config.flag}`]: level, name: `${condition?.label ?? config.defaultLabel} · nv ${level}` };
    if (duration === 0) Object.assign(update, effectRoundsUpdate(0));
    else if (effectDurationRounds(existing) && (remaining === null || duration > remaining)) {
      Object.assign(update, effectRoundsUpdate(duration, { combat: game.combat }));
    }
    await existing.update(update);
    return `Suprimido renovado (nv ${level})`;
  }
  await target.createEmbeddedDocuments("ActiveEffect", [
    {
      name: `${condition?.label ?? config.defaultLabel} · nv ${reach}`,
      img: condition?.icon || "icons/svg/cancel.svg",
      statuses: condition ? [condition.id] : [],
      duration: duration > 0 ? { rounds: duration } : {},
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: condition?.id ?? config.defaultId, [config.flag]: reach, sourceLevel: reach, magic: false, tech: false } }
    }
  ]);
  return `Suprimido nv ${reach}${duration > 0 ? ` (${duration} rodada(s))` : " (até o Mestre tirar)"}`;
}
