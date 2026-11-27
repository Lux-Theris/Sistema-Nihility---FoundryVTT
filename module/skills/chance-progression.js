/**
 * Progressão por chance (1.124.0), o lado que lê e grava fichas. Regras puras em `chance-rules.js`; o ciclo e o nível máximo
 * em `core/config/progression.js`.
 *  - `registerSkillIds`: toda Skill ganha ids estáveis nos efeitos e nas Sub-Skills ao ser criada ou editada.
 *  - `levelUpChanceUpdate`: o que o Level Up grava quando o passo do nível é Chance (pontos sorteados) e o anúncio.
 *  - `migrateSkillChances`: a migração única (recalcula tudo; como a campanha não começou, nada é preservado à parte) e o
 *    aviso único ao Mestre com as Skills do mundo cujos números mudaram.
 */
import { SYSTEM_ID, skillCycleConfig, skillChances, skillMaxLevel, skillNextStep, skillLevelBonuses } from "../core/config.js";
import { levelPlan, withStableIds, distributeChancePoints, chanceGainsText, pruneChanceBonus, carryOverChanceBonus } from "./chance-rules.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { worldActors } from "../helpers/world-actors.js";

const makeId = () => foundry.utils.randomID();

/** Dá ids estáveis ao que ainda não tem, antes de a Skill ser gravada (criar e editar). */
export function registerSkillIds() {
  Hooks.on("preCreateItem", (item, data) => {
    if (item.type !== "skill") return;
    const stamped = withStableIds(data.system ?? item.system, makeId);
    if (stamped.changed) item.updateSource({ "system.effects": stamped.effects, "system.subSkills": stamped.subSkills });
  });
  Hooks.on("preUpdateItem", (item, changes) => {
    if (item.type !== "skill" || !changes.system) return;
    if (!("effects" in changes.system) && !("subSkills" in changes.system)) return;
    const merged = {
      effects: changes.system.effects ?? item.toObject().system.effects,
      subSkills: changes.system.subSkills ?? item.toObject().system.subSkills
    };
    const stamped = withStableIds(merged, makeId);
    if (!stamped.changed) return;
    changes.system.effects = stamped.effects;
    changes.system.subSkills = stamped.subSkills;
  });
}

/** O retrato das chances de Skills que vão sumir (Evolução e Fusão), tirado ANTES de apagá-las. */
export function snapshotChances(items) {
  return (items ?? []).map(item => ({ chances: skillChances(item.system), bonus: foundry.utils.deepClone(item.system.chanceBonus ?? {}) }));
}

/**
 * Evolução e Fusão ficam com a MELHOR chance (por sentido, não por índice): a Skill nova nunca piora as chances que a antiga
 * tinha. Roda depois de criada (os ids estáveis nascem na criação).
 */
export async function carryChancesOver(snapshots, newItem) {
  const bonus = carryOverChanceBonus(snapshots, skillChances(newItem.system));
  if (Object.keys(bonus).length) await newItem.update({ "system.chanceBonus": bonus });
}

/** O rótulo de uma chave de chance para o anúncio ("Atordoado", "Saltar entre alvos"). */
function labelOfKey(system, key, conditionLabel) {
  const found = skillChances(system).find(c => c.key === key);
  if (!found) return key;
  if (found.kind === "chain") return found.label;
  return conditionLabel(found.label);
}

/**
 * O que gravar ao subir a Skill de `level` para `level + 1`: o passo Chance sorteia os pontos. Devolve
 * `{update, announce}` (`update` vazio se o passo não é Chance) ou `null` se a Skill está no máximo.
 */
export function levelUpChanceUpdate(item, conditionLabel = id => id) {
  const system = item.system;
  if (Number(system.level) >= skillMaxLevel(system)) return null;
  if (skillNextStep(system) !== "chance") return { update: {}, announce: "" };
  const cfg = skillCycleConfig(system);
  const chances = skillChances(system);
  const result = distributeChancePoints(chances, pruneChanceBonus(system.chanceBonus, chances), cfg.chancePoints);
  return {
    update: { "system.chanceBonus": result.bonus },
    announce: chanceGainsText(result.gains, key => labelOfKey(system, key, conditionLabel))
  };
}

/** Migração `skillChanceCycle`: ids, pontos de chance já "ganhos" no nível atual e o aviso único ao Mestre. */
export async function migrateSkillChances() {
  const changed = [];
  const overMax = [];
  for (const actor of worldActors()) {
    for (const item of actor.items) {
      if (item.type !== "skill" || item.system.resistanceTarget || item.system.weaponMastery) continue;
      const patch = {};
      const stamped = withStableIds(item.toObject().system, makeId);
      if (stamped.changed) Object.assign(patch, { "system.effects": stamped.effects, "system.subSkills": stamped.subSkills });
      if (Object.keys(patch).length) await item.update(patch);
      const system = item.system;
      const cfg = skillCycleConfig(system);
      const chances = skillChances(system);
      if (chances.length) {
        const steps = levelPlan(system.level, cfg).chanceSteps;
        const dist = distributeChancePoints(chances, {}, steps * cfg.chancePoints);
        await item.update({ "system.chanceBonus": dist.bonus });
      }
      const before = skillLevelBonuses(system.level);
      const after = skillLevelBonuses(item.system);
      if (Math.abs(before.power - after.power) > 1e-9 || Math.abs(before.cost - after.cost) > 1e-9) changed.push(`${actor.name}: ${item.name} (nível ${item.system.level})`);
      if (Number(item.system.level) > skillMaxLevel(item.system)) overMax.push(`${actor.name}: ${item.name}`);
    }
  }
  if (!changed.length && !overMax.length) return;
  const gm = game.users.filter(u => u.isGM).map(u => u.id);
  const body = [
    "A progressão por chance recalculou o ciclo de níveis. Skills sem chance e com Custo seguem iguais.",
    changed.length ? `Mudaram de números: ${changed.join("; ")}.` : "",
    overMax.length ? `Acima do novo nível máximo (continuam como estão, mas não sobem mais; marque "Sem limite" para liberar): ${overMax.join("; ")}.` : ""
  ].filter(Boolean).join(" ");
  await announceVoiceOfTheWorld(null, { kind: "info", title: "Progressão por chance: Skills que mudaram", body, whisper: gm });
}
