/**
 * XP por uso de Skill — lê as fichas, converte as medidas (skill-xp-rules.js) e grava.
 *
 * Quem grava: o dono da Skill direto (é quem a usou, ou o Mestre nos ticks de Zona/periódicos);
 * quando não é (uma Estrutura de outro segurando o MEU ataque), vai pelo relay do Mestre, que
 * refaz a conta e limita o pedido a uma unidade (ver `skillUseXp` em gm-relay.js).
 *
 * Skill concedida por Item/Módulo não ganha XP (é fixa), igual à XP de Resistência.
 */
import { isFeatureEnabled, getFeatureOption } from "../core/config.js";
import { SHIP_PERCENT_PATHS } from "./effect-targets.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { skillUseXp, effectEntryMeasures, largestXpMeasures } from "./skill-xp-rules.js";
import { masteryXpFromConfig, masteryEarnsXp } from "../combat/weapon-mastery-rules.js";

export function skillXpConfig() {
  return {
    factor: Number(getFeatureOption("skillUseXp", "skillXpFactor")) || 0,
    flatPercent: Number(getFeatureOption("skillUseXp", "skillXpFlatPercent")) || 0,
    buffCapPercent: Number(getFeatureOption("skillUseXp", "skillXpBuffCapPercent")) || 0,
    blockPercent: Number(getFeatureOption("skillUseXp", "skillXpBlockPercent")) || 0
  };
}

/** A configuração da XP de uso, com a fatia da Maestria de arma (`masteryXpShare`% da mesma conta). */
export function masteryXpConfig() {
  return masteryXpFromConfig(skillXpConfig(), getFeatureOption("weaponMastery", "masteryXpShare"));
}

/** A "Vida" de um alvo para medir dano/cura: Vida máxima; Nave/Veículo, Escudo + Casco + Integridade. */
export function vitalBase(actor) {
  const sys = actor?.system;
  if (!sys) return 1;
  if (actor.type === "starship" || actor.type === "vehicle") {
    return Math.max(1, (sys.shields?.max ?? 0) + (sys.casco?.max ?? 0) + (sys.hull?.max ?? 0));
  }
  return Math.max(1, Number(sys.attributes?.hp?.max) || 1);
}

/** Medidas de uma entrada de Efeito que pegou em `targetActor` (ver effectEntryMeasures). */
export function effectMeasuresFor(entry, targetActor, { hasCondition = false } = {}) {
  const attr = targetActor?.system?.attributes?.combat?.[entry.target];
  const vital = entry.target === "hp" ? targetActor?.system?.attributes?.hp?.max : entry.target === "energy" ? targetActor?.system?.attributes?.energy?.max : null;
  return effectEntryMeasures(entry, {
    attributeTotal: attr ? Math.max(1, Number(attr.total) || 0) : null,
    vitalMax: vital ? Number(vital) : entry.target === "shield" ? vitalBase(targetActor) : null,
    percent: entry.target === "movement" || Boolean(SHIP_PERCENT_PATHS?.[entry.target]) || entry.modifierType === "multiplier",
    hasCondition
  });
}

/**
 * Lotes de uma Skill Combinada: dentro de `withXpBatch`, o XP de cada parte é guardado em vez de creditado, e no fim
 * credita-se só a parte que mais rende (a Skill-mãe ganha XP uma vez por uso).
 */
const xpBatches = new Map();
export async function withXpBatch(skill, run) {
  const uuid = typeof skill === "string" ? skill : skill?.uuid;
  if (!uuid || xpBatches.has(uuid)) return run(() => {});
  const batch = { parts: [], current: 0 };
  xpBatches.set(uuid, batch);
  try {
    return await run(index => { batch.current = index; });
  } finally {
    xpBatches.delete(uuid);
    const best = largestXpMeasures(batch.parts.filter(Boolean), skillXpConfig());
    if (best.length) await grantSkillUseXp(uuid, best);
  }
}

/**
 * Credita na Skill a XP das medidas. `skill` pode ser o Item ou o uuid dele. Nunca lança: XP é
 * um extra, e uma falha aqui não pode derrubar o uso da Skill.
 */
export async function grantSkillUseXp(skill, measures) {
  try {
    if (!measures?.length || !isFeatureEnabled("skillUseXp")) return;
    const batch = xpBatches.get(typeof skill === "string" ? skill : skill?.uuid);
    if (batch) {
      // Parte de uma Combinada: junta as medidas da parte; quem credita é o fim do lote.
      batch.parts[batch.current] = [...(batch.parts[batch.current] ?? []), ...measures];
      return;
    }
    const item = typeof skill === "string" ? await fromUuid(skill) : skill;
    if (!item || item.type !== "skill" || item.system.isItemGranted) return;
    if (!item.isOwner) {
      await runAsGm("skillUseXp", { skillUuid: item.uuid, measures });
      return;
    }
    const gain = skillUseXp(measures, skillXpConfig());
    if (!gain) return;
    const current = Number(item.system.xp) || 0;
    const max = Number(item.system.xpMax) || 0;
    const next = max > 0 ? Math.min(max, current + gain) : current + gain;
    if (next !== current) await item.update({ "system.xp": next });
  } catch (err) {
    console.warn("nihility-rpg-system | Falha ao creditar XP de uso da Skill.", err);
  }
}

/**
 * XP de uma Maestria de arma (H6): `masteryXpShare`% do que a mesma medida de dano daria a uma Skill
 * (fração da Vida máxima do alvo, no máximo 1 por alvo). Nada no teto do nível nem para Maestria
 * evoluída. Mesmo caminho de `grantSkillUseXp`: o dono grava direto; quem não é dono pede ao Mestre,
 * que refaz a conta com a configuração DELE. Nunca lança.
 */
export async function grantMasteryXp(skill, measures) {
  try {
    if (!measures?.length || !isFeatureEnabled("skillUseXp") || !isFeatureEnabled("weaponMastery")) return;
    const item = typeof skill === "string" ? await fromUuid(skill) : skill;
    if (!item || item.type !== "skill" || item.system.isItemGranted || !item.system.weaponMastery) return;
    const cfg = { detailed: false, maxLevel: getFeatureOption("weaponMastery", "masteryMaxLevel") };
    if (!masteryEarnsXp(item.system, cfg)) return;
    if (!item.isOwner) {
      await runAsGm("skillUseXp", { skillUuid: item.uuid, measures, mastery: true });
      return;
    }
    const gain = skillUseXp(measures, masteryXpConfig());
    if (!gain) return;
    const current = Number(item.system.xp) || 0;
    const max = Number(item.system.xpMax) || 0;
    const next = max > 0 ? Math.min(max, current + gain) : current + gain;
    if (next !== current) await item.update({ "system.xp": next });
  } catch (err) {
    console.warn("nihility-rpg-system | Falha ao creditar XP de Maestria.", err);
  }
}
