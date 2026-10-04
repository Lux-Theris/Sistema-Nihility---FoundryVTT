/**
 * Antimagia: cobra a Mana extra (ou anula) de um uso mágico que cruza um campo ou está sob Selo.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { getEnergyLabelForActor, isEnergyPoolEnabled, isMagicUse, antimagicSurcharge, getAntimagicConfig } from "../core/config.js";
import { antimagicBetween } from "../structures/structures.js";
import { grantSkillUseXp } from "../skills/skill-xp.js";
import { isShipLike } from "../starship/ship-damage.js";
import { energyValuePath, currentEnergyValue } from "../skills/skill-state.js";

/* ------------------------------------------------------------------ Antimagia */

/**
 * Antimagia num ataque: se o uso é mágico (isMagicUse) e há antimagia no caminho de algum alvo
 * (campo atravessado, de onde sai, onde o alvo está, ou Selo em quem ataca), cobra UMA vez o custo
 * extra do maior nível, da energia do personagem. Sem como pagar, os alvos sob antimagia ficam
 * sem efeito (vale pra Dano Absoluto mágico também).
 * @returns {Promise<{nulled: Set<string>, note: string}>} uuids anulados e o texto pro chat
 */
export async function chargeAntimagic(actor, mech, targets, { origin = null } = {}) {
  const result = { nulled: new Set(), note: "" };
  if (!actor || isShipLike(actor) || !isMagicUse(mech, actor)) return result;
  const found = new Map(targets.filter(Boolean).map(t => [t.uuid, antimagicBetween(actor, t, { origin })]));
  const levels = new Map([...found].map(([uuid, f]) => [uuid, f.level]));
  const level = Math.max(0, ...levels.values());
  if (level <= 0) return result;
  const cost = antimagicSurcharge(Number(mech.cost) || 0, level, getAntimagicConfig());
  const label = getEnergyLabelForActor(actor);
  const current = currentEnergyValue(actor);
  if (isEnergyPoolEnabled() && current >= cost) {
    await actor.update({ [energyValuePath(actor)]: current - cost });
    result.note = ` — antimagia (nível ${level}): +${cost} ${label}`;
  } else {
    for (const [uuid, l] of levels) if (l > 0) result.nulled.add(uuid);
    result.note = ` — anulado pela antimagia (nível ${level}: faltou ${label})`;
    // XP por uso: cada alvo anulado conta o fixo pra Skill do campo/Selo responsável.
    const credit = new Map();
    for (const uuid of result.nulled) for (const skillUuid of found.get(uuid)?.sources ?? []) credit.set(skillUuid, (credit.get(skillUuid) ?? 0) + 1);
    for (const [skillUuid, count] of credit) await grantSkillUseXp(skillUuid, Array.from({ length: count }, () => ({ flat: true })));
  }
  return result;
}
