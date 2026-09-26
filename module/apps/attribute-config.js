/**
 * "Configurar Atributos" — renomear e mostrar/esconder cada um dos Atributos de Combate.
 *
 * Não usa `list-config-app-factory.js` pelo mesmo motivo de `feature-config.js`: a factory monta
 * listas em que o Mestre adiciona e remove linhas, e aqui o conjunto de linhas é **fixo**. As
 * chaves (`strength`, `magic`, ...) são estrutura do sistema, não conteúdo: elas aparecem dentro
 * de caminhos de Active Effect já gravados, em `EFFECT_TARGETS`, em `TITLE_BONUS_TARGETS` e nas
 * settings de fórmula vital. Deixar renomear a chave apagaria em silêncio todo efeito, Título e
 * fórmula que apontasse pra ela — por isso só o rótulo e a visibilidade são editáveis.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveAttributes, getVitalFormula, debugLog } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AttributeConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-attribute-config",
    tag: "form",
    window: { title: "Configurar Atributos" },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-attribute-config"],
    position: { width: 600, height: "auto" },
    actions: {
      save: AttributeConfigApp.#onSave,
      reset: AttributeConfigApp.#onReset
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/attribute-config.hbs`, scrollable: [".attribute-list"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Um atributo usado na fórmula de HP/Mana ganha um aviso: esconder não o tira da conta (o
    // valor continua valendo), e é exatamente isso que costuma confundir quem esconde.
    const formula = getVitalFormula();
    const usedInFormula = new Set([...formula.hp, ...(formula.energyEnabled ? formula.energy : [])]);

    context.attributes = getActiveAttributes().map(attr => ({
      ...attr,
      defaultLabel: MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS[attr.key],
      inFormula: usedInFormula.has(attr.key)
    }));

    debugLog(`${SYSTEM_ID} | AttributeConfigApp._prepareContext`);
    return context;
  }

  /** Devolve os rótulos originais e reexibe todos — não toca em valor de ficha nenhum. */
  static async #onReset(event, target) {
    event.preventDefault();
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributesData, "[]");
    ui.notifications.info("Atributos voltaram aos rótulos padrão.");
    this.render();
  }

  static async #onSave(event, target) {
    event.preventDefault();

    const data = MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => {
      const row = this.element.querySelector(`[data-attribute="${key}"]`);
      const label = row?.querySelector(".attribute-label-input")?.value?.trim();
      return {
        key,
        // Rótulo vazio volta pro padrão em vez de virar um atributo sem nome na ficha.
        label: label || MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS[key],
        visible: row?.querySelector(".attribute-visible-input")?.checked !== false
      };
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributesData, JSON.stringify(data, null, 2));
    ui.notifications.info("Atributos salvos. Recarregue o mundo (F5) para as fichas acompanharem.");
    this.close();
  }
}
