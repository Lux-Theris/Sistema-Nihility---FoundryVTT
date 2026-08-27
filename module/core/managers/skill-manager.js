/**
 * Gerencia operações e lógica central relacionadas a habilidades no sistema.
 */
export class SkillManager {
  /**
   * Prepara dados das habilidades para exibição na ficha.
   * @param {Actor} actor - O ator cujas habilidades estão sendo preparadas
   * @returns {Promise<Object>} Dados formatados para exibição
   */
  static async prepareSkillsData(actor) {
    const skills = actor.items.filter(item => item.type === "skill");

    // Agrupar por tier
    const skillsByTier = {};
    const visibleTiers = [];

    for (const tier of MEU_SISTEMA.SKILL_TIERS) {
      const tierSkills = skills.filter(skill => skill.system.tier === tier);
      if (tierSkills.length > 0) {
        visibleTiers.push(tier);
        skillsByTier[tier] = tierSkills;
      }
    }

    return {
      skills,
      skillsByTier,
      visibleTiers
    };
  }

  /**
   * Verifica se uma habilidade pode ser usada por um ator.
   * @param {Actor} actor - O ator que tenta usar a habilidade
   * @param {Item} skill - A habilidade a ser verificada
   * @returns {boolean} Se a habilidade pode ser usada
   */
  static canUseSkill(actor, skill) {
    // Verificar custo
    if (skill.system.cost > actor.system.skillPoints[skill.system.tier]) {
      return false;
    }

    // Verificar requisitos de item
    if (skill.system.requiredItem && !actor.items.find(item => item.name === skill.system.requiredItem)) {
      return false;
    }

    return true;
  }

  /**
   * Usa uma habilidade no sistema.
   * @param {Actor} actor - O ator que está usando a habilidade
   * @param {string} skillId - ID da habilidade a ser usada
   * @param {Object} options - Opções para uso da habilidade
   * @returns {Promise<Object>} Resultado do uso da habilidade
   */
  static async useSkill(actor, skillId, options = {}) {
    const skill = actor.items.get(skillId);
    if (!skill) return null;

    // Verificar se pode usar a habilidade
    if (!this.canUseSkill(actor, skill)) {
      ui.notifications?.warn("Não é possível usar essa habilidade.");
      return null;
    }

    // Aplicar o tipo de efeito da habilidade
    if (skill.system.effectType === "damage") {
      return await DamageManager.rollSkillDamage(actor, skill, options.targetActor);
    } else if (skill.system.effectType === "temporary") {
      const targetActor = options.targetActor ?? actor;
      return await this._applyTemporaryEffects(actor, skill, targetActor);
    }

    ui.notifications?.info("Essa habilidade é apenas descritiva — sem mecânica para ativar.");
    return null;
  }

  /**
   * Aplica efeitos temporários de uma habilidade.
   * @private
   */
  static async _applyTemporaryEffects(actor, skill, targetActor) {
    const entries = skill.system.effects ?? [];
    if (!entries.length) {
      ui.notifications?.warn("Essa habilidade não tem nenhum Efeito configurado.");
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
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> usou <strong>${skill.name}</strong> em <strong>${targetActor.name}</strong>: ${summary.join(", ")}.</p>`
    });

    return true;
  }

  /**
   * Calcula o custo total de uma lista de habilidades.
   * @param {Item[]} skills - Lista de habilidades
   * @returns {number} Custo total
   */
  static calculateTotalCost(skills) {
    return skills.reduce((sum, skill) => sum + (skill.system.cost || 0), 0);
  }

  /**
   * Verifica se há habilidades fundidas em um ator.
   * @param {Actor} actor - O ator a ser verificado
   * @returns {boolean} Se há habilidades fundidas
   */
  static hasFusedSkills(actor) {
    return actor.items.some(item => item.type === "skill" && item.system.isFused);
  }

  /**
   * Retorna estatísticas de habilidades do ator.
   * @param {Actor} actor - O ator a ser analisado
   * @returns {Object} Estatísticas das habilidades
   */
  static getSkillStatistics(actor) {
    const skills = actor.items.filter(item => item.type === "skill");

    return {
      total: skills.length,
      fused: skills.filter(skill => skill.system.isFused).length,
      byTier: MEU_SISTEMA.SKILL_TIERS.reduce((acc, tier) => {
        acc[tier] = skills.filter(skill => skill.system.tier === tier).length;
        return acc;
      }, {}),
      totalCost: this.calculateTotalCost(skills)
    };
  }
}