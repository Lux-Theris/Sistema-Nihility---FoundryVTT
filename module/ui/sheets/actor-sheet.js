/**
 * Ficha do personagem para o sistema Nihility.
 */
export class NihilityActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "actor"],
      template: `systems/${SYSTEM_ID}/templates/actor-sheet.hbs`,
      width: 780,
      height: 860,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "ficha" }]
    });
  }

  async getData(options) {
    const context = await super.getData(options);

    // Usar gerenciadores para preparação de dados
    context.skills = await SkillManager.prepareSkillsData(this.actor);
    context.combatAttributes = CombatAttributeManager.deriveCombatStats(this.actor);
    context.damageSystem = DamageManager.getDamageConfig();

    // Adicionar informações específicas do sistema
    context.tierLabels = MEU_SISTEMA.SKILL_TIER_LABELS;
    context.visibleSkillTiers = MEU_SISTEMA.SKILL_TIERS.filter(tier =>
      this.actor.items.some(item => item.type === "skill" && item.system.tier === tier)
    );

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Configurar listeners para fusão de habilidades
    this._setupFusionListeners(html);

    // Configurar listeners para uso de habilidades
    this._setupSkillUseListeners(html);

    // Configurar listeners para gerenciamento de pontos
    this._setupSkillPointListeners(html);
  }

  /**
   * Configura listeners para fusão de habilidades.
   * @private
   */
  _setupFusionListeners(html) {
    // Botão para abrir o assistente de fusão
    html.find(".skill-fuse-button").on("click", this._onOpenFusionAssistant.bind(this));

    // Checkbox para seleção de habilidades
    html.find(".skill-fuse-checkbox").on("change", this._onSkillSelectionChange.bind(this));
  }

  /**
   * Configura listeners para uso de habilidades.
   * @private
   */
  _setupSkillUseListeners(html) {
    // Botão para usar habilidade
    html.find(".skill-use-button").on("click", this._onUseSkill.bind(this));
  }

  /**
   * Configura listeners para gerenciamento de pontos.
   * @private
   */
  _setupSkillPointListeners(html) {
    // Botões para quebrar e fundir pontos
    html.find(".sp-break").on("click", this._onBreakSkillPoints.bind(this));
    html.find(".sp-merge").on("click", this._onMergeSkillPoints.bind(this));
  }

  /**
   * Abre o assistente de fusão.
   * @private
   */
  async _onOpenFusionAssistant(event) {
    event.preventDefault();

    // Obter habilidades selecionadas
    const selectedSkills = this.actor.items.filter(item =>
      item.type === "skill" &&
      item.system.isItemGranted !== true &&
      $(event.currentTarget).closest(".item-row").find(".skill-fuse-checkbox:checked").length > 0
    );

    // Criar e mostrar assistente de fusão
    const fusionAssistant = new FusionAssistantDialog(this.actor, selectedSkills);
    fusionAssistant.render(true);
  }

  /**
   * Altera a seleção de habilidades.
   * @private
   */
  _onSkillSelectionChange(event) {
    const checkbox = $(event.currentTarget);
    const row = checkbox.closest(".item-row");

    if (checkbox.is(":checked")) {
      row.addClass("skill-fusion-target");
    } else {
      row.removeClass("skill-fusion-target");
    }
  }

  /**
   * Usa uma habilidade.
   * @private
   */
  async _onUseSkill(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const skillId = button.closest(".item-row").data("item-id");

    // Usar a habilidade
    await SkillManager.useSkill(this.actor, skillId);
  }

  /**
   * Quebra pontos de habilidade.
   * @private
   */
  async _onBreakSkillPoints(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const tier = button.closest(".sp-item").data("tier");

    try {
      await breakSkillPoints(this.actor, tier);
      this.render();
    } catch (error) {
      ui.notifications?.error(`Erro ao quebrar pontos: ${error.message}`);
    }
  }

  /**
   * Funde pontos de habilidade.
   * @private
   */
  async _onMergeSkillPoints(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const tier = button.closest(".sp-item").data("tier");

    try {
      await mergeSkillPoints(this.actor, tier);
      this.render();
    } catch (error) {
      ui.notifications?.error(`Erro ao fundir pontos: ${error.message}`);
    }
  }

  /**
   * Processa o resultado da fusão.
   * @private
   */
  async _onFusionComplete(fusionData) {
    try {
      await SkillFusionManager.fuseSkills(this.actor, fusionData.sourceIds, fusionData.options);
      ui.notifications?.info("Fusão de habilidades criada com sucesso!");
      this.render();
    } catch (error) {
      ui.notifications?.error(`Erro ao criar fusão: ${error.message}`);
    }
  }
}