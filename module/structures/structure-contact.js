/**
 * Dano de contato de Estrutura (Muralha de Fogo…): rolado pelo Mestre designado quando um Token atravessa.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID } from "../core/config.js";
import { damageApplyFlags, withDamageTrace } from "../combat/damage-apply.js";
import { applyDamageReductions, triggeredLabel, personalTraceTail } from "../combat/damage-roll.js";
import { cardReactions, reactionLabel } from "../combat/reactions.js";
import { grantSkillUseXp, vitalBase } from "../skills/skill-xp.js";
import { isShipLike } from "../starship/ship-damage.js";

/**
 * Lado do Mestre: alguém atravessou (ou parou dentro de) uma Estrutura com dano de contato. Rola a
 * fórmula dela, com os elementos dela, contra o Ator do Token (as reduções do alvo valem, como num
 * golpe normal), e posta o cartão com os botões de Aplicar. Nave/Veículo não queima.
 */
export async function applyStructureContactAsGm(tokenDocument, instance, info) {
  const target = tokenDocument?.actor;
  if (!target || isShipLike(target) || !info?.contactDamage) return;
  let roll;
  try {
    roll = await new Roll(info.contactDamage).evaluate();
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Dano de contato inválido em ${instance.label}: ${info.contactDamage}`, err);
    return;
  }
  const caster = instance.sourceActorUuid ? await fromUuid(instance.sourceActorUuid) : null;
  const mech = { damageElements: info.elements ?? [], isMagicDamage: Boolean(info.magic), isAbsoluteDamage: false };
  const reduction = applyDamageReductions(roll.total, mech, target, { attacker: caster });
  await roll.toMessage({
    speaker: { alias: instance.label },
    flavor: `${instance.label} — contato — ${tokenDocument.name}: ${reduction.finalDamage}${reactionLabel(reduction.reactions)}${triggeredLabel(reduction.triggeredConditions)}`,
    flags: withDamageTrace(
      damageApplyFlags(target, reduction.finalDamage, {
        reactions: cardReactions(reduction.reactions),
        shieldBase: reduction.shieldBase,
        elementIds: reduction.elementIds,
        shieldExtra: reduction.shieldExtra ?? 0,
        shieldMultiplier: reduction.shieldMultiplier ?? 1,
        shieldPenetration: reduction.shieldPenetration ?? 0,
        triggeredConditions: reduction.triggeredConditions ?? [],
        sever: reduction.sever,
        label: instance.label
      }),
      [{ name: tokenDocument.name, rows: [{ label: "Rolagem (contato)", value: String(roll.total) }, ...personalTraceTail(reduction, target)] }]
    )
  });
  // XP por uso: o dano de contato conta para a Skill que ergueu a Estrutura, como o tick de uma Zona.
  if (caster && instance.skillId && reduction.finalDamage > 0) {
    await grantSkillUseXp(`${instance.sourceActorUuid}.Item.${instance.skillId}`, [{ value: reduction.finalDamage, base: vitalBase(target) }]);
  }
}
