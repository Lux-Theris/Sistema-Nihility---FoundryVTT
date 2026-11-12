/**
 * Antimagia (prancha 8): o efeito de Skill "Antimagia" num alvo — corta na hora os efeitos mágicos
 * de Skill que alcança, desliga as Habilidades Ativas mágicas dele e aplica a Condição "Suprimido
 * (Antimagia)", que segura passivos, Resistências, itens e implantes mágicos enquanto durar.
 *
 * Alcance: o nível da Antimagia × a Regra da Mesa "alcance" (padrão 1,5 — nível 10 alcança até 15).
 * Efeito sem nível guardado (marcado à mão, de antes desta regra) conta como nível 0. Corta o que é
 * de Skill, bom ou ruim; Título, Espécie e partes naturais nunca (ver skillIsMagic e a marca Mágico).
 */
import { SYSTEM_ID, getActiveStatusConditions, getAntimagicReach } from "../core/config.js";
import { dispelledEffects, skillIsMagic, fieldSuppressionPlan } from "../core/magic-rules.js";
import { removeShieldPool, shieldPoolsOf } from "../combat/shield-pools.js";
import { collectActiveUpkeepSources, removeUpkeepLinkedEffects } from "./upkeep.js";
import { skillStateUpdate } from "./skill-state.js";
import { SUPPRESSION_FLAG, suppressionLevel } from "../core/suppression.js";

export { SUPPRESSION_FLAG, suppressionLevel };

/** Nível alcançado por uma Antimagia de nível `level` (com o alcance da mesa). */
export function antimagicReachLevel(level) {
  return Math.floor((Math.max(0, Number(level) || 0) * getAntimagicReach()) + 1e-9);
}

/** Nível e magia de uma Skill (ou Sub-Skill) para a supressão. */
function skillMagicLevel(sys) {
  return { magic: skillIsMagic(sys), level: Math.max(0, Number(sys?.level) || 0) };
}

/**
 * Aplica a Antimagia num alvo. Devolve as linhas do resumo para o chat.
 * @param {Actor} target
 * @param {{level:number, rounds?:number, reach?:number, field?:string}} options - `level` = nível da Skill;
 *   `rounds` = supressão (0 = até tirar); `reach` = alcance direto (campo antimagia: o nível do campo,
 *   sem o multiplicador da mesa); `field` = id da Cena do campo: a Supressão é a do campo (sem prazo,
 *   sai quando o Token sai do campo — ver releaseFieldSuppression) e não mexe na de Skill.
 *   O resumo traz `changed` = quantas coisas acabaram de verdade.
 */
export async function applyAntimagic(target, { level = 0, rounds = 0, reach: fixedReach = null, field = null } = {}) {
  const reach = fixedReach !== null ? Math.max(0, Math.floor(Number(fixedReach) || 0)) : antimagicReachLevel(level);
  let changed = 0;
  const summary = [];
  // XP por uso (skill-xp.js): a Antimagia ganha pelo que desligou — cada efeito cortado, cada
  // Habilidade Ativa desligada e a Supressão contam o fixo; Escudo cortado conta pelo tamanho.
  const xp = [];

  // 1) Efeitos mágicos de Skill de nível ≤ alcance (a supressão e as Condições do corpo ficam).
  const effects = target.effects.map(e => {
    const flags = e.flags?.[SYSTEM_ID] ?? {};
    return { id: e.id, name: e.name, level: Number(flags.sourceLevel) || 0, magic: Boolean(flags.magic), keep: flags[SUPPRESSION_FLAG] !== undefined || Boolean(flags.bodyInjury) };
  });
  const cut = dispelledEffects(effects.filter(e => !e.keep), reach);
  if (cut.length) {
    await target.deleteEmbeddedDocuments("ActiveEffect", cut);
    changed += cut.length;
    for (let i = 0; i < cut.length; i++) xp.push({ flat: true });
    summary.push(`${effects.filter(e => cut.includes(e.id)).map(e => e.name).join(", ")} removido(s)`);
  }
  const kept = effects.filter(e => e.magic && !e.keep && !cut.includes(e.id));
  if (kept.length) summary.push(`${kept.map(e => `${e.name} (nv ${e.level})`).join(", ")} resistiu(ram): nível maior`);

  // 2) Escudos de Skill mágica de nível ≤ alcance.
  for (const pool of shieldPoolsOf(target) ?? []) {
    const holder = pool.holderUuid ? fromUuidSync(pool.holderUuid) : null;
    const skill = holder?.items?.get(pool.skillId);
    if (!skill) continue;
    const sys = pool.subSkillIndex != null ? skill.system.subSkills?.[pool.subSkillIndex] ?? skill.system : skill.system;
    const { magic, level: lvl } = skillMagicLevel({ ...sys, tier: skill.system.tier });
    if (!magic || lvl > reach) continue;
    const removed = await removeShieldPool(target, pool);
    if (removed) {
      changed++;
      summary.push(`Escudo de ${skill.name} (−${removed})`);
      xp.push({ value: removed, base: Number(target.system?.attributes?.hp?.max) || 1 });
    }
  }

  // 3) Habilidades Ativas mágicas do alvo, de nível ≤ alcance: desligam (religar paga de novo).
  if (target.type === "character") {
    const off = [];
    for (const source of collectActiveUpkeepSources(target)) {
      const sys = source.subSkillIndex != null ? source.skill.system.subSkills?.[source.subSkillIndex] : source.skill.system;
      const { magic, level: lvl } = skillMagicLevel({ ...sys, tier: source.skill.system.tier });
      if (!magic || lvl > reach) continue;
      await source.skill.update(skillStateUpdate(source.skill, source.subSkillIndex, { active: false }));
      await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
      off.push(source.label);
      changed++;
      xp.push({ flat: true });
    }
    if (off.length) summary.push(`${off.join(", ")} desligada(s)`);
  }

  // 4) Condição "Suprimido": renova ficando com o maior nível e a maior duração.
  const suppression = await applySuppression(target, reach, rounds, { field });
  if (suppression) {
    summary.push(suppression);
    xp.push({ flat: true });
  }
  summary.xp = xp;
  summary.changed = changed;
  return summary;
}

/** Marca da Supressão que veio de um campo antimagia (e não de uma Skill). */
export const FIELD_SUPPRESSION_FLAG = "antimagicField";

const isSuppression = e => e.flags?.[SYSTEM_ID]?.[SUPPRESSION_FLAG] !== undefined;
const isFieldSuppression = e => e.flags?.[SYSTEM_ID]?.[FIELD_SUPPRESSION_FLAG] !== undefined;

/** Tira a Supressão de campo do Ator (saiu do campo, ou o campo caiu). A de Skill nunca é tocada. */
export async function releaseFieldSuppression(actor) {
  const ids = (actor?.effects ?? []).filter(e => isSuppression(e) && isFieldSuppression(e)).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

async function applyFieldSuppression(target, reach, sceneId) {
  const condition = getActiveStatusConditions().find(c => c.suppressesMagic);
  const name = `${condition?.label ?? "Suprimido (Antimagia)"} · campo nv ${reach}`;
  const existing = target.effects.find(e => isSuppression(e) && isFieldSuppression(e));
  const plan = fieldSuppressionPlan({ fieldLevel: reach, existingLevel: existing ? Number(existing.flags[SYSTEM_ID][SUPPRESSION_FLAG]) || 0 : null });
  if (plan === "update") {
    await existing.update({ [`flags.${SYSTEM_ID}.${SUPPRESSION_FLAG}`]: reach, [`flags.${SYSTEM_ID}.sourceLevel`]: reach, [`flags.${SYSTEM_ID}.${FIELD_SUPPRESSION_FLAG}`]: { sceneId }, name });
    return `Suprimido pelo campo (nv ${reach})`;
  }
  if (plan !== "create") return "";
  await target.createEmbeddedDocuments("ActiveEffect", [
    {
      name,
      img: condition?.icon || "icons/svg/cancel.svg",
      statuses: condition ? [condition.id] : [],
      duration: {},
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: condition?.id ?? "antimagic-suppressed", [SUPPRESSION_FLAG]: reach, [FIELD_SUPPRESSION_FLAG]: { sceneId }, sourceLevel: reach, magic: false } }
    }
  ]);
  return `Suprimido pelo campo (nv ${reach}) enquanto estiver nele`;
}

async function applySuppression(target, reach, rounds, { field = null } = {}) {
  if (field) return applyFieldSuppression(target, reach, field);
  const condition = getActiveStatusConditions().find(c => c.suppressesMagic);
  const existing = target.effects.find(e => isSuppression(e) && !isFieldSuppression(e));
  const duration = Math.max(0, Math.round(Number(rounds) || 0));
  if (existing) {
    const level = Math.max(Number(existing.flags[SYSTEM_ID][SUPPRESSION_FLAG]) || 0, reach);
    const remaining = existing.duration?.remaining ?? null;
    const update = { [`flags.${SYSTEM_ID}.${SUPPRESSION_FLAG}`]: level, name: `${condition?.label ?? "Suprimido (Antimagia)"} · nv ${level}` };
    if (duration === 0) update["duration.rounds"] = null;
    else if (existing.duration?.rounds && (remaining === null || duration > remaining)) {
      Object.assign(update, { "duration.rounds": duration, "duration.startRound": game.combat?.round ?? 0, "duration.startTurn": game.combat?.turn ?? 0 });
    }
    await existing.update(update);
    return `Suprimido renovado (nv ${level})`;
  }
  await target.createEmbeddedDocuments("ActiveEffect", [
    {
      name: `${condition?.label ?? "Suprimido (Antimagia)"} · nv ${reach}`,
      img: condition?.icon || "icons/svg/cancel.svg",
      statuses: condition ? [condition.id] : [],
      duration: duration > 0 ? { rounds: duration } : {},
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: condition?.id ?? "antimagic-suppressed", [SUPPRESSION_FLAG]: reach, sourceLevel: reach, magic: false } }
    }
  ]);
  return `Suprimido nv ${reach}${duration > 0 ? ` (${duration} rodada(s))` : " (até o Mestre tirar)"}`;
}
