/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "./config.js";

const EFFECT_TARGET_PATHS = {
  strength: "system.attributes.combat.strength.buffDelta",
  defense: "system.attributes.combat.defense.buffDelta",
  magic: "system.attributes.combat.magic.buffDelta",
  magicalDefense: "system.attributes.combat.magicalDefense.buffDelta",
  dexterity: "system.attributes.combat.dexterity.buffDelta",
  stealth: "system.attributes.combat.stealth.buffDelta",
  precision: "system.attributes.combat.precision.buffDelta",
  hp: "system.attributes.hp.buffDelta",
  energy: "system.attributes.energy.buffDelta"
};

/**
 * Ponto de entrada único de "Usar Habilidade".
 * @param {Actor} sourceActor - dono da skill
 * @param {string} skillId
 * @param {{targetActor?: Actor}} [options] - alvo dos Efeitos Temporários (padrão: o próprio dono)
 */
export async function useSkillEffect(sourceActor, skillId, options = {}) {
  const skill = sourceActor.items.get(skillId);
  if (!skill) return null;

  if (skill.system.effectType === "damage") {
    return rollSkillDamage(sourceActor, skill);
  }
  if (skill.system.effectType === "temporary") {
    const targetActor = options.targetActor ?? sourceActor;
    return applySkillEffects(sourceActor, skill, targetActor);
  }

  ui.notifications?.info("Essa skill é só descritiva — sem mecânica pra ativar.");
  return null;
}

async function rollSkillDamage(actor, skill) {
  const formula = skill.system.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }

  const roll = new Roll(formula);
  await roll.evaluate();

  let flavor = `${skill.name} — Dano`;
  if (skill.system.isElementalDamage) {
    const element = getActiveDamageElements().find(e => e.id === skill.system.damageElement);
    if (element) flavor = `${skill.name} — Dano ${element.label}`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor
  });
  return roll;
}

async function applySkillEffects(sourceActor, skill, targetActor) {
  const entries = skill.system.effects ?? [];
  if (!entries.length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  const summary = [];

  for (const entry of entries) {
    const label = MEU_SISTEMA.EFFECT_TARGET_LABELS[entry.target] ?? entry.target;
    const sign = entry.amount >= 0 ? "+" : "";

    if (entry.target === "shield") {
      const current = targetActor.system.attributes.shield.value ?? 0;
      await targetActor.update({
        "system.attributes.shield.value": Math.max(0, current + entry.amount)
      });
      summary.push(`Escudo ${sign}${entry.amount}`);
      continue;
    }

    const path = EFFECT_TARGET_PATHS[entry.target];
    if (!path) continue;

    await targetActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: `${skill.name}: ${label} ${sign}${entry.amount}`,
        img: skill.img,
        origin: skill.uuid,
        duration: entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
        changes: [{ key: path, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(entry.amount) }],
        flags: { [SYSTEM_ID]: { skillEffect: true } }
      }
    ]);
    summary.push(`${label} ${sign}${entry.amount}${entry.durationRounds > 0 ? ` (${entry.durationRounds} rounds)` : ""}`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${skill.name}</strong> em <strong>${targetActor.name}</strong>: ${summary.join(", ")}.</p>`
  });

  return true;
}
