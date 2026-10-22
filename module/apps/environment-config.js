import { SYSTEM_ID, MEU_SISTEMA, getActiveStatusConditions, isEnvironmentEnabled } from "../core/config.js";
import { pickerFieldHtml, readPickerField, wireTraitPickerField } from "./checklist-picker.js";
import { sceneEnvironment, availableFxPresets, availableFxParticles, availableFxFilters, syncSceneFx } from "../environment/environment.js";
import { normalizeHazard, normalizeDensity } from "../environment/environment-rules.js";
import { isRadiationEnabled, passRadiationTime } from "../environment/radiation.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ambiente da CENA (backlog B4/C5): perigos que valem na cena inteira e a densidade de mana dela.
 * As áreas menores são Regions com o comportamento "Ambiente (Nihility)", editadas na janela da
 * própria Region. Edita uma cópia; nada é gravado antes de "Salvar".
 */
export class EnvironmentConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-environment-config"],
    window: { title: "Ambiente da Cena", icon: "fa-solid fa-smog", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      addHazard: EnvironmentConfigApp.#onAddHazard,
      removeHazard: EnvironmentConfigApp.#onRemoveHazard,
      save: EnvironmentConfigApp.#onSave,
      passTime: EnvironmentConfigApp.#onPassTime
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/environment-config.hbs`, scrollable: [".env-body"] }
  };

  /**
   * Abre (ou traz para frente) a janela de UMA cena — a que está no mapa, sem argumento. Outra cena
   * se abre pelo clique direito na lista de Cenas (registerEnvironmentSceneMenu).
   */
  static open(scene = canvas?.scene ?? null) {
    if (!scene) {
      ui.notifications.warn("Abra uma cena no mapa (ou clique com o direito numa cena da lista de Cenas → Ambiente).");
      return null;
    }
    const existing = foundry.applications.instances.get(`nihility-environment-${scene.id}`);
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new EnvironmentConfigApp({ id: `nihility-environment-${scene.id}`, sceneId: scene.id }).render({ force: true });
  }

  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId ?? canvas?.scene?.id ?? null;
  }

  get title() {
    return `Ambiente — ${this.scene?.name ?? "cena"}`;
  }

  /** Cópia em edição: `{hazards, manaDensity}` (density como texto, "" = a do mundo). */
  draft = null;

  get scene() {
    return game.scenes.get(this.sceneId) ?? null;
  }

  #loadDraft() {
    const env = sceneEnvironment(this.scene);
    this.draft = { hazards: env.hazards.map(h => ({ ...h })), manaDensity: env.manaDensity ?? "", radiation: env.radiation || 0 };
  }

  /** Lê o que está na tela para a cópia (antes de redesenhar, para não perder o que foi digitado). */
  #collect() {
    const root = this.element;
    if (!root || !this.draft) return;
    const density = root.querySelector("[name=manaDensity]");
    if (density) this.draft.manaDensity = density.value;
    const radiation = root.querySelector("[name=radiation]");
    if (radiation) this.draft.radiation = Math.max(0, Number(radiation.value) || 0);
    this.draft.hazards = [...root.querySelectorAll(".env-hazard")].map(row => ({
      conditionId: row.querySelector("[name=conditionId]")?.value ?? "",
      immuneTraits: readPickerField(row.querySelector(".env-immune")),
      fx: row.querySelector("[name=fx]")?.value ?? "",
      fxParticle: row.querySelector("[name=fxParticle]")?.value ?? "",
      fxFilter: row.querySelector("[name=fxFilter]")?.value ?? "",
      fxColor: row.querySelector("[name=fxTint]")?.checked ? row.querySelector("[name=fxColor]")?.value ?? "" : ""
    }));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.draft) this.#loadDraft();
    const conditions = getActiveStatusConditions();
    const fxActive = Boolean(game.modules.get("fxmaster")?.active);
    const presets = fxActive ? availableFxPresets() : [];
    const particles = fxActive ? availableFxParticles() : [];
    const filters = fxActive ? availableFxFilters() : [];
    // Valor salvo que não está mais no catálogo continua na lista, para "Salvar" não o apagar calado.
    const optionsFor = (list, current) => [
      ...list.map(o => ({ ...o, selected: o.id === current })),
      ...(current && !list.some(o => o.id === current) ? [{ id: current, label: `${current} (não encontrado)`, selected: true }] : [])
    ];
    let worldDensity = 1;
    try {
      worldDensity = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.manaDensityDefault));
    } catch (err) {
      /* sem setting */
    }
    return Object.assign(context, {
      hasScene: Boolean(this.scene),
      manaDensity: this.draft.manaDensity,
      radiationEnabled: isRadiationEnabled(),
      radiation: this.draft.radiation,
      worldDensity,
      fxActive,
      hazards: this.draft.hazards.map((h, index) => ({
        index,
        conditions: conditions.map(c => ({ id: c.id, label: c.label, selected: c.id === h.conditionId })),
        presetOptions: optionsFor(presets, h.fx),
        particleOptions: optionsFor(particles, h.fxParticle),
        filterOptions: optionsFor(filters, h.fxFilter),
        tint: Boolean(h.fxColor),
        color: h.fxColor || "#33ff66",
        immuneHtml: pickerFieldHtml(h.immuneTraits ?? [], "env-immune")
      }))
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const field of this.element.querySelectorAll(".env-immune")) wireTraitPickerField(field);
  }

  static #onAddHazard() {
    this.#collect();
    this.draft.hazards.push({ conditionId: getActiveStatusConditions()[0]?.id ?? "", immuneTraits: [], fx: "", fxParticle: "", fxFilter: "", fxColor: "" });
    this.render();
  }

  static #onRemoveHazard(event, target) {
    this.#collect();
    this.draft.hazards.splice(Number(target.dataset.index), 1);
    this.render();
  }

  /** Fora de combate: N rodadas de radiação de uma vez (acúmulo, queda e dano) para a cena. */
  static async #onPassTime() {
    const scene = this.scene;
    if (!scene) return;
    const roundSeconds = Number(CONFIG.time?.roundTime) || 6;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Passar tempo", icon: "fa-solid fa-hourglass-half" },
      classes: ["nihility-condition-dialog"],
      content: `<div class="nihility-pass-time">
        <p class="hint">Aplica a radiação de uma vez em todos os Personagens da cena, como se essas rodadas tivessem passado: quem está exposto acumula e leva o dano de cada rodada; quem está fora vai baixando. 1 rodada = ${roundSeconds} s. Salve o ambiente antes, se mudou algo.</p>
        <div class="form-group"><label>Quanto tempo</label><input type="number" name="amount" min="1" step="1" value="10"/>
          <select name="unit"><option value="rounds">rodadas</option><option value="minutes">minutos</option><option value="hours">horas</option></select></div>
      </div>`,
      buttons: [
        {
          action: "go",
          label: "Passar",
          default: true,
          callback: (event, button, dialog) => {
            const amount = Math.max(0, Number(dialog.element.querySelector("[name=amount]").value) || 0);
            const unit = dialog.element.querySelector("[name=unit]").value;
            const seconds = unit === "hours" ? amount * 3600 : unit === "minutes" ? amount * 60 : amount * roundSeconds;
            return { rounds: Math.round(seconds / roundSeconds) };
          }
        },
        { action: "cancel", label: "Cancelar" }
      ],
      rejectClose: false
    });
    if (!result?.rounds) return;
    const rows = await passRadiationTime(scene, result.rounds);
    ui.notifications.info(rows.length ? `Passaram ${result.rounds} rodada(s): ${rows.length} personagem(ns) afetado(s) — resumo no chat do Mestre.` : "Ninguém nesta cena está exposto nem irradiado.");
  }

  static async #onSave() {
    const scene = this.scene;
    if (!scene) return;
    this.#collect();
    const hazards = this.draft.hazards.map(normalizeHazard).filter(Boolean);
    const manaDensity = normalizeDensity(this.draft.manaDensity);
    const previous = sceneEnvironment(scene).fxPlaying;
    const fxPlaying = await syncSceneFx(scene, hazards, previous);
    // A troca da flag dispara a sincronização de todos os Tokens da cena (environment.js).
    await scene.setFlag(SYSTEM_ID, "environment", { hazards, manaDensity, radiation: this.draft.radiation || 0, fxPlaying });
    ui.notifications.info(`Ambiente de "${scene.name}" salvo.`);
    this.#loadDraft();
    this.render();
  }
}

/**
 * Clique direito numa cena da lista de Cenas → "Ambiente (Nihility)". Chaves da V14 (visible/onClick)
 * e da V13 (condition/callback) juntas: cada versão lê as suas, e a V14 só reclama das antigas
 * quando as novas faltam.
 */
export function registerEnvironmentSceneMenu() {
  Hooks.on("getSceneContextOptions", (app, options) => {
    const allowed = () => game.user.isGM && isEnvironmentEnabled();
    const sceneOf = li => game.scenes.get((li instanceof HTMLElement ? li : li?.[0])?.dataset.entryId ?? li?.data?.("entryId"));
    options.push({
      name: "Ambiente (Nihility)",
      icon: '<i class="fa-solid fa-smog"></i>',
      visible: allowed,
      condition: allowed,
      onClick: (event, li) => EnvironmentConfigApp.open(sceneOf(li)),
      callback: li => EnvironmentConfigApp.open(sceneOf(li))
    });
  });
}
