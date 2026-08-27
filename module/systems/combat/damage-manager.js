/**
 * Gerencia todos os aspectos do sistema de dano no Nihility RPG.
 */
export class DamageManager {
  /**
   * Rola o dano de uma habilidade e aplica reduções de defesa.
   * @param {Actor} actor - O ator que está usando a habilidade
   * @param {Item} skill - A habilidade sendo usada
   * @param {Actor} targetActor - O alvo do dano (opcional)
   * @returns {Promise<Object>} Objeto com o roll e dano final
   */
  static async rollSkillDamage(actor, skill, targetActor = null) {
    const formula = skill.system.damageFormula?.trim();
    if (!formula) {
      ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
      return null;
    }

    // Avaliar dano base
    const roll = new Roll(formula);
    await roll.evaluate();

    let finalDamage = roll.total;

    // Aplicar redução de dano se houver alvo e for dano mágico
    if (targetActor && skill.system.isElementalDamage) {
      finalDamage = this._applyDamageReduction(roll, actor, targetActor, skill);
    }

    // Aplicar efeitos especiais de fusão
    if (skill.system.fusionSources && skill.system.fusionSources.length > 0) {
      finalDamage = this._applyFusionEffects(finalDamage, skill, targetActor);
    }

    // Formatando a mensagem de dano
    let flavor = `${skill.name} — Dano`;
    if (skill.system.isElementalDamage) {
      const element = getActiveDamageElements().find(e => e.id === skill.system.damageElement);
      if (element) flavor = `${skill.name} — Dano ${element.label}`;
    }

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor
    });

    return { roll, finalDamage };
  }

  /**
   * Aplica redução de dano com base na defesa mágica do alvo.
   * @private
   */
  static _applyDamageReduction(baseRoll, attacker, defender, skill) {
    // Calcular redução de dano com base na defesa mágica
    if (skill.system.damageType === "magic") {
      const magicDefense = defender.system.attributes.combat.magicalDefense.value;

      // Exemplo de fórmula: reduzir dano por 25% da defesa mágica + 5 pontos
      const reduction = Math.floor(magicDefense / 4) + 5;
      return Math.max(0, baseRoll.total - reduction);
    }

    return baseRoll.total;
  }

  /**
   * Aplica efeitos especiais de fusão ao dano.
   * @private
   */
  static _applyFusionEffects(baseDamage, skill, targetActor) {
    // Aplicar bônus especiais de habilidades fundidas
    if (skill.system.fusionSources && skill.system.fusionSources.length > 0) {
      // Exemplo: habilidades fundidas podem ter multiplicadores de dano
      const fusionCount = skill.system.fusionSources.length;
      const multiplier = 1 + (fusionCount * 0.1); // 10% bônus por fonte

      return Math.floor(baseDamage * multiplier);
    }

    return baseDamage;
  }

  /**
   * Calcula dano total com todos os modificadores.
   * @param {number} baseDamage - Dano base
   * @param {Actor} attacker - Ator atacante
   * @param {Actor} defender - Ator defensor
   * @param {Item} skill - Habilidade usada
   * @returns {number} Dano total calculado
   */
  static calculateTotalDamage(baseDamage, attacker, defender, skill) {
    let totalDamage = baseDamage;

    // Aplicar modificadores de defesa
    if (skill.system.isElementalDamage) {
      const magicDefense = defender.system.attributes.combat.magicalDefense.value;
      const reduction = Math.floor(magicDefense / 4) + 5;
      totalDamage = Math.max(0, totalDamage - reduction);
    }

    // Aplicar bônus de habilidades fundidas
    if (skill.system.fusionSources && skill.system.fusionSources.length > 0) {
      const fusionCount = skill.system.fusionSources.length;
      const multiplier = 1 + (fusionCount * 0.1);
      totalDamage = Math.floor(totalDamage * multiplier);
    }

    return totalDamage;
  }

  /**
   * Verifica se o dano foi suficiente para causar efeito.
   * @param {number} damage - Dano calculado
   * @param {Actor} defender - Defensor
   * @returns {boolean} Se o dano foi significativo
   */
  static isDamageSignificant(damage, defender) {
    const threshold = defender.system.attributes.hp.max / 4; // 25% do HP máximo
    return damage >= threshold;
  }

  /**
   * Retorna configurações do sistema de dano.
   * @returns {Object} Configurações do sistema de dano
   */
  static getDamageConfig() {
    return {
      magicDefenseMultiplier: 0.25,
      fusionBonusPerSource: 0.1,
      minimumDamage: 0,
      elementalReductionFormula: (defense) => Math.floor(defense / 4) + 5
    };
  }
}