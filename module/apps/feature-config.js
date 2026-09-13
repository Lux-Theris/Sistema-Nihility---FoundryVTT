/**
 * "Configurar Módulos do Sistema" — a tela onde o Mestre liga/desliga cada bloco do sistema
 * (MEU_SISTEMA.FEATURES) e aplica um preset de campanha inteiro de uma vez
 * (MEU_SISTEMA.CAMPAIGN_PRESETS).
 *
 * Não usa `list-config-app-factory.js` de propósito: a factory monta LISTAS editáveis (linhas
 * que o Mestre adiciona/remove livremente), e aqui o conjunto de blocos é fixo — quem define
 * quais existem é o código, não o Mestre. O que varia é só o booleano de cada um.
 *
 * Toda a tela é derivada de `MEU_SISTEMA.FEATURES`/`CAMPAIGN_PRESETS`: adicionar um bloco novo
 * na tabela de config faz ele aparecer aqui sozinho, sem tocar neste arquivo nem no template.
 */
import { SYSTEM_ID, MEU_SISTEMA, isFeatureEnabled, applyCampaignPreset, debugLog } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class FeatureConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-feature-config",
    tag: "form",
    window: { title: "Configurar Módulos do Sistema" },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-feature-config"],
    position: { width: 620, height: "auto" },
    actions: {
      applyPreset: FeatureConfigApp.#onApplyPreset,
      save: FeatureConfigApp.#onSave
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/feature-config.hbs`, scrollable: [".feature-list"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Sub-features (as do PAD) entram aninhadas na linha do pai em vez de soltas na lista —
    // deixa visível que desligar o pai desliga o conjunto.
    const entries = Object.entries(MEU_SISTEMA.FEATURES).map(([key, feature]) => ({
      key,
      name: feature.name,
      hint: feature.hint,
      parent: feature.parent ?? null,
      enabled: isFeatureEnabled(key),
      // O estado CRU da setting, sem herdar o pai: uma sub-feature ligada sob um pai desligado
      // precisa continuar aparecendo marcada, senão salvar a tela a apagaria silenciosamente.
      checked: this._rawSetting(feature.setting)
    }));

    context.features = entries.filter(e => !e.parent).map(parent => ({
      ...parent,
      children: entries.filter(e => e.parent === parent.key)
    }));

    context.presets = Object.entries(MEU_SISTEMA.CAMPAIGN_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      hint: preset.hint
    }));

    debugLog(`${SYSTEM_ID} | FeatureConfigApp._prepareContext`);
    return context;
  }

  _rawSetting(settingKey) {
    try {
      return Boolean(game.settings.get(SYSTEM_ID, settingKey));
    } catch (err) {
      return true;
    }
  }

  /**
   * Aplica um preset de campanha. Confirma antes porque é uma mudança em lote que mexe em vários
   * blocos de uma vez — e avisa explicitamente que nada é apagado, já que "desligar Naves" numa
   * campanha medieval assusta quem tem Naves salvas no mundo.
   */
  static async #onApplyPreset(event, target) {
    event.preventDefault();
    const presetKey = target.dataset.preset;
    const preset = MEU_SISTEMA.CAMPAIGN_PRESETS[presetKey];
    if (!preset) return;

    const confirmed = await DialogV2.confirm({
      window: { title: `Preset: ${preset.label}` },
      content:
        `<p>Aplicar o preset <strong>${preset.label}</strong>?</p>` +
        `<p class="hint">${preset.hint}</p>` +
        "<p><strong>Nenhum dado é apagado.</strong> Blocos desligados apenas somem da interface e " +
        "não podem receber conteúdo novo — Atores, Itens e Compêndios que já existem continuam " +
        "intactos, e religar o bloco devolve tudo exatamente como estava.</p>"
    });
    if (!confirmed) return;

    await applyCampaignPreset(presetKey);
    ui.notifications.info(`Preset "${preset.label}" aplicado. Recarregue o mundo (F5) para a interface acompanhar.`);
    this.render();
  }

  static async #onSave(event, target) {
    event.preventDefault();

    for (const [key, feature] of Object.entries(MEU_SISTEMA.FEATURES)) {
      const checkbox = this.element.querySelector(`[data-feature="${key}"]`);
      if (!checkbox) continue;
      await game.settings.set(SYSTEM_ID, feature.setting, checkbox.checked);
    }

    ui.notifications.info("Módulos do sistema salvos. Recarregue o mundo (F5) para a interface acompanhar.");
    this.close();
  }
}
