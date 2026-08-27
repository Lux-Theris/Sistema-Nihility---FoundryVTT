/**
 * Diálogo do assistente de fusão de habilidades.
 */
export class FusionAssistantDialog extends Dialog {
  constructor(actor, selectedSkills = [], options = {}) {
    super({}, options);
    this.actor = actor;
    this.selectedSkills = selectedSkills;
    this.fusionData = {
      sourceIds: selectedSkills.map(s => s.id),
      sourceNames: selectedSkills.map(s => s.name),
      targetTier: "normal",
      mode: "auto",
      emotionPrompt: ""
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nihility", "fusion-assistant"],
      template: `systems/nihility/templates/apps/fusion-assistant.html`,
      width: 800,
      height: 600,
      resizable: true,
      title: "Assistente de Fusão de Habilidades"
    });
  }

  async getData() {
    const context = await super.getData();

    context.actor = this.actor;
    context.selectedSkills = this.selectedSkills;
    context.fusionData = this.fusionData;

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Configurar navegação entre etapas
    html.find(".next-step").on("click", this._onNextStep.bind(this));
    html.find(".create-fusion").on("click", this._onCreateFusion.bind(this));
    html.find(".close-button").on("click", this.close.bind(this));

    // Configurar seleção de habilidades
    html.find(".skill-select-checkbox").on("change", this._onSkillSelect.bind(this));

    // Configurar opções de fusão
    html.find("[name='targetTier']").on("change", this._onTierChange.bind(this));
    html.find("[name='mode']").on("change", this._onModeChange.bind(this));
    html.find("[name='emotionPrompt']").on("input", this._onEmotionPromptChange.bind(this));
  }

  /**
   * Navega para a próxima etapa.
   * @private
   */
  _onNextStep(event) {
    event.preventDefault();

    const currentStep = $(event.currentTarget).closest(".step");
    const nextStep = currentStep.next(".step");

    if (nextStep.length > 0) {
      currentStep.removeClass("active");
      nextStep.addClass("active");

      // Atualizar pré-visualização na etapa 3
      if (nextStep.data("step") === "preview") {
        this._updatePreview();
      }
    }
  }

  /**
   * Cria a fusão de habilidades.
   * @private
   */
  async _onCreateFusion(event) {
    event.preventDefault();

    try {
      const fusionResult = await SkillFusionManager.fuseSkills(
        this.actor,
        this.fusionData.sourceIds,
        {
          tier: this.fusionData.targetTier,
          mode: this.fusionData.mode,
          emotionPrompt: this.fusionData.emotionPrompt
        }
      );

      ui.notifications?.info("Fusão de habilidades criada com sucesso!");
      this.close();

      // Atualizar a ficha do ator
      if (this.actor.sheet) {
        this.actor.sheet.render(true);
      }
    } catch (error) {
      ui.notifications?.error(`Erro ao criar fusão: ${error.message}`);
    }
  }

  /**
   * Manipula a seleção de habilidades.
   * @private
   */
  _onSkillSelect(event) {
    const checkbox = $(event.currentTarget);
    const skillId = checkbox.data("skill-id");

    if (checkbox.is(":checked")) {
      if (!this.fusionData.sourceIds.includes(skillId)) {
        this.fusionData.sourceIds.push(skillId);
      }
    } else {
      this.fusionData.sourceIds = this.fusionData.sourceIds.filter(id => id !== skillId);
    }
  }

  /**
   * Manipula a mudança de tier.
   * @private
   */
  _onTierChange(event) {
    this.fusionData.targetTier = event.currentTarget.value;
  }

  /**
   * Manipula a mudança de modo.
   * @private
   */
  _onModeChange(event) {
    this.fusionData.mode = event.currentTarget.value;

    // Mostrar/ocultar campo de prompt emocional
    const emotionField = $(event.currentTarget).closest(".fusion-settings").find(".emotion-prompt");
    if (this.fusionData.mode === "auto") {
      emotionField.hide();
    } else {
      emotionField.show();
    }
  }

  /**
   * Manipula a mudança do prompt emocional.
   * @private
   */
  _onEmotionPromptChange(event) {
    this.fusionData.emotionPrompt = event.currentTarget.value;
  }

  /**
   * Atualiza a pré-visualização da fusão.
   * @private
   */
  _updatePreview() {
    // Aqui poderíamos fazer uma pré-visualização mais detalhada
    // Por enquanto, apenas atualizamos os dados básicos
    const previewElement = this.element.find(".fusion-preview-result");

    if (previewElement.length > 0) {
      previewElement.find(".result-name").text("Nova Habilidade de Exemplo");
      previewElement.find(".cost-value").text(this._calculateEstimatedCost());
    }
  }

  /**
   * Calcula o custo estimado da fusão.
   * @private
   */
  _calculateEstimatedCost() {
    return this.selectedSkills.reduce((sum, skill) => sum + (skill.system.cost || 0), 0);
  }

  /**
   * Fecha o diálogo.
   */
  async close(options = {}) {
    await super.close(options);
  }
}