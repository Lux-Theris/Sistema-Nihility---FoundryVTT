/**
 * Monta, com os catálogos do mundo, a frase de cada Skill de um Ator (`skill-summary.js`) para
 * a linha da ficha. Lê os catálogos uma vez por render, não uma vez por Skill.
 */
import {
  getActiveDamageElements,
  getActiveStatusConditions,
  getEffectTargetLabels,
  getStructures,
  getEnergyLabelForActor,
  getStarshipEnergyAbbr,
  effectiveSkillCost
} from "../core/config.js";
import { computeResistancePercent } from "../combat/resistance.js";
import { skillSummary } from "./skill-summary.js";

const byId = list => Object.fromEntries((list ?? []).map(entry => [entry.id, entry.label]));

/** `{itemId: "3d6 de Fogo · cone de 6 m · 20 Mana"}` para todas as Skills do Ator. */
export function skillSummariesFor(actor) {
  const skills = actor?.items?.filter(i => i.type === "skill") ?? [];
  if (!skills.length) return {};
  const elements = byId(getActiveDamageElements());
  const base = {
    elements,
    conditions: byId(getActiveStatusConditions()),
    targets: getEffectTargetLabels(),
    structures: byId(getStructures()),
    // Na Nave o rótulo longo ("Sistema Eletro-Plasmático (EPS)") comeria a linha inteira.
    energyLabel: ["starship", "vehicle"].includes(actor.type) ? getStarshipEnergyAbbr() : getEnergyLabelForActor(actor)
  };
  const out = {};
  for (const skill of skills) {
    const sys = skill.system;
    let resistance = "";
    if (sys.resistanceTarget) {
      const percent = Math.round(computeResistancePercent(sys.resistanceTarget, sys.level) * 100);
      const element = sys.resistanceTarget === "general" ? "Geral" : elements[sys.resistanceTarget] ?? sys.resistanceTarget;
      resistance = `Resistência ${element} ${percent}%`;
    }
    out[skill.id] = skillSummary(sys, {
      ...base,
      cost: effectiveSkillCost(sys.cost, sys.level),
      upkeep: effectiveSkillCost(sys.upkeepCost, sys.level),
      resistance
    });
  }
  return out;
}
