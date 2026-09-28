import { SYSTEM_ID, debugLog } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * "Regras da Mesa": todas as regras numéricas e de texto do sistema (as settings de mundo que
 * aparecem na tela nativa de Configurações do Foundry) num lugar só, agrupadas por assunto —
 * Progressão, Vida e Energia, Combate, Outras. Antes ficavam espalhadas no meio das settings do
 * core e de módulos.
 *
 * Lê o registro de settings direto (`game.settings.settings`), então uma setting nova com
 * `config: true` aparece aqui sozinha. As de navegador (`scope: "client"`: IA, Debug) ficam na
 * tela nativa — são de cada pessoa, não da mesa.
 */

const GROUPS = [
  { id: "progression", label: "Progressão", test: key => /^(xp|attributePoints|skillPoints|skillPower|skillDiscount|skillCycle|skillCostFloor|resistance)/.test(key) },
  { id: "vitals", label: "Vida e Energia", test: key => /(vital|energy|Energy|manaInvest)/.test(key) },
  { id: "ships", label: "Naves", test: key => /^ship/.test(key) },
  { id: "combat", label: "Combate", test: key => /(initiative|damage|OffScene|Scaling|antimagic|affinity)/i.test(key) },
  { id: "other", label: "Outras", test: () => true }
];

function tableSettings() {
  return [...game.settings.settings.values()].filter(c => c.namespace === SYSTEM_ID && c.scope === "world" && c.config);
}

export class TableRulesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-table-rules",
    tag: "form",
    window: { title: "Regras da Mesa", resizable: true },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-table-rules"],
    position: { width: 620, height: 640 },
    form: { handler: TableRulesConfigApp.#onSubmit, submitOnChange: false, closeOnSubmit: true }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/table-rules-config.hbs`, scrollable: [".table-rules-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const groups = GROUPS.map(g => ({ ...g, rows: [] }));
    for (const config of tableSettings()) {
      const value = game.settings.get(SYSTEM_ID, config.key);
      const choices = config.choices ? Object.entries(config.choices).map(([v, l]) => ({ value: v, label: l, selected: String(v) === String(value) })) : null;
      const row = {
        key: config.key,
        name: config.name || config.key,
        hint: config.hint || "",
        isBoolean: config.type === Boolean,
        isNumber: config.type === Number,
        choices,
        value,
        reload: Boolean(config.requiresReload)
      };
      groups.find(g => g.test(config.key)).rows.push(row);
    }
    context.groups = groups.filter(g => g.rows.length);
    debugLog(`${SYSTEM_ID} | TableRulesConfigApp._prepareContext`);
    return context;
  }

  static async #onSubmit() {
    let changed = 0;
    let reload = false;
    for (const config of tableSettings()) {
      const input = this.element.querySelector(`[data-rule="${config.key}"]`);
      if (!input) continue;
      let value;
      if (config.type === Boolean) value = input.checked;
      else if (config.type === Number) {
        const n = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(n)) continue;
        value = n;
      } else value = input.value;
      if (value === game.settings.get(SYSTEM_ID, config.key)) continue;
      await game.settings.set(SYSTEM_ID, config.key, value);
      changed++;
      if (config.requiresReload) reload = true;
    }
    if (changed) ui.notifications.info(`${changed} regra(s) atualizada(s).${reload ? " Recarregue o mundo (F5) para todas valerem." : ""}`);
  }
}
