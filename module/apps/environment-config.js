import { SYSTEM_ID, NIHILITY, getActiveStatusConditions, isEnvironmentEnabled } from "../core/config.js";
import { pickerFieldHtml, readPickerField, wireTraitPickerField } from "./checklist-picker.js";
import { availableFxPresets, availableFxParticles, availableFxFilters } from "../environment/environment.js";
import { isSceneFoldersEnabled, isShopsEnabled, isShipSensorsEnabled, isVesselsEnabled } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import { sceneOwnValues, folderOwn, inheritanceChain, scenesWithOwnUnder, scenesUnderFolder, subfoldersOf, writeOwn } from "../environment/scene-config.js";
import { copyFoundrySettings, settleFolderScenes } from "../environment/scene-config-apply.js";
import { SCENE_FIELDS, SCENE_FIELD_KEYS, resolveAll, scenesWithOwn, fieldValueText, ownBannerText, normalizeCfg } from "../environment/scene-config-rules.js";
import { SCENE_COPY_FIELDS, copyField } from "../environment/scene-copy-rules.js";
import { isRadiationEnabled, passRadiationTime } from "../environment/radiation.js";
import { isWorldClockEnabled, isCalendarEnabled } from "../core/config.js";
import { getTimelines, lineNow, localDateText } from "../core/world-time.js";
import { createDepot, listDepots, pileSummaryFor, askClearPiles } from "../economy/loot.js";
import { clearPilesSummary } from "../economy/loot-rules.js";
import { lastUndoableTrade, askUndoLastTrade } from "../economy/player-trade.js";

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
    position: { width: 600, height: "auto" },
    actions: {
      addHazard: EnvironmentConfigApp.#onAddHazard,
      removeHazard: EnvironmentConfigApp.#onRemoveHazard,
      save: EnvironmentConfigApp.#onSave,
      passTime: EnvironmentConfigApp.#onPassTime,
      adjustLine: EnvironmentConfigApp.#onAdjustLine,
      newLine: EnvironmentConfigApp.#onNewLine,
      inherit: EnvironmentConfigApp.#onInherit,
      inheritAll: EnvironmentConfigApp.#onInheritAll,
      applyCopy: EnvironmentConfigApp.#onApplyCopy,
      createDepot: EnvironmentConfigApp.#onCreateDepot,
      clearPiles: EnvironmentConfigApp.#onClearPiles,
      undoTrade: EnvironmentConfigApp.#onUndoTrade
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
    return EnvironmentConfigApp.#show(`nihility-environment-${scene.id}`, { sceneId: scene.id });
  }

  /** A janela em modo PASTA (H20): grava nos valores da Pasta, que as cenas dela herdam. */
  static openFolder(folder) {
    if (!folder) return null;
    return EnvironmentConfigApp.#show(`nihility-environment-folder-${folder.id}`, { folderId: folder.id });
  }

  static #show(id, options) {
    const existing = foundry.applications.instances.get(id);
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new EnvironmentConfigApp({ id, ...options }).render({ force: true });
  }

  constructor(options = {}) {
    super(options);
    this.folderId = options.folderId ?? null;
    this.sceneId = this.folderId ? null : (options.sceneId ?? canvas?.scene?.id ?? null);
  }

  get isFolder() {
    return Boolean(this.folderId);
  }

  get title() {
    return this.isFolder ? `Ambiente da pasta — ${this.folder?.name ?? "pasta"}` : `Ambiente — ${this.scene?.name ?? "cena"}`;
  }

  /** Cópia em edição: `{own: {campo: bool}, values: {campo: valor}}`. */
  draft = null;

  /** Rascunho da cópia "do Foundry" (só na janela da pasta). */
  copyDraft = null;

  get scene() {
    return this.sceneId ? game.scenes.get(this.sceneId) ?? null : null;
  }

  get folder() {
    return this.folderId ? game.folders.get(this.folderId) ?? null : null;
  }

  /** A cena ou a pasta que está sendo editada. */
  get target() {
    return this.isFolder ? this.folder : this.scene;
  }

  /** O que cada campo vale sem o valor próprio (herdado das pastas de cima, ou o padrão). */
  #inherited() {
    return resolveAll({ own: {}, chain: inheritanceChain(this.target) });
  }

  #loadDraft() {
    const own = this.isFolder ? folderOwn(this.folder) : sceneOwnValues(this.scene);
    const inherited = this.#inherited();
    this.draft = { own: {}, values: {} };
    for (const key of SCENE_FIELD_KEYS) {
      this.draft.own[key] = key in own;
      const value = key in own ? own[key] : inherited[key].value;
      this.draft.values[key] = Array.isArray(value) ? value.map(h => ({ ...h })) : value;
    }
  }

  /** Lê o que está na tela para a cópia (antes de redesenhar, para não perder o que foi digitado). */
  #collect() {
    const root = this.element;
    if (!root || !this.draft) return;
    const v = this.draft.values;
    const density = root.querySelector("[name=manaDensity]");
    if (density) v.manaDensity = density.value === "" ? null : Number(density.value);
    const radiation = root.querySelector("[name=radiation]");
    if (radiation) v.radiation = Math.max(0, Number(radiation.value) || 0);
    const interference = root.querySelector("[name=sensorInterference]");
    if (interference) v.sensorInterference = Math.min(100, Math.max(0, Number(interference.value) || 0));
    const clockDark = root.querySelector("[name=clockDarkness]");
    if (clockDark) v.clockDarkness = clockDark.checked;
    const timeLine = root.querySelector("[name=timeLine]");
    if (timeLine) v.lineId = timeLine.value || "main";
    const depot = root.querySelector("[name=depotId]");
    if (depot) v.depotId = depot.value;
    const network = root.querySelector("[name=timeNetwork]");
    if (network) v.network = network.checked;
    if (root.querySelector(".env-hazards")) {
      v.hazards = [...root.querySelectorAll(".env-hazard")].map(row => ({
        conditionId: row.querySelector("[name=conditionId]")?.value ?? "",
        immuneTraits: readPickerField(row.querySelector(".env-immune")),
        fx: row.querySelector("[name=fx]")?.value ?? "",
        fxParticle: row.querySelector("[name=fxParticle]")?.value ?? "",
        fxFilter: row.querySelector("[name=fxFilter]")?.value ?? "",
        fxColor: row.querySelector("[name=fxTint]")?.checked ? row.querySelector("[name=fxColor]")?.value ?? "" : ""
      }));
    }
  }

  /** O texto de "de onde vem" de um campo e o botão de voltar a herdar. */
  #chip(key) {
    const own = Boolean(this.draft.own[key]);
    const inherited = this.#inherited()[key];
    if (own) {
      const back = inherited.source === "folder" ? "Voltar a herdar" : this.isFolder ? "Tirar o valor da pasta" : "Voltar ao padrão";
      const from = inherited.source === "folder" ? ` (de ${inherited.from.name})` : "";
      return { state: "own", text: this.isFolder ? "valor da pasta" : "valor próprio", back: back + from };
    }
    if (inherited.source === "folder") return { state: "inherit", text: `herdado de: ${inherited.from.name}`, back: "" };
    return { state: "none", text: this.isFolder ? "sem valor — as cenas usam o padrão do sistema" : "sem valor — padrão do sistema", back: "" };
  }

  #chipHtml(key) {
    const chip = this.#chip(key);
    const button = chip.back ? ` <a class="env-chip-back" data-action="inherit" data-field="${escapeHtml(key)}"><i class="fas fa-rotate-left"></i> ${escapeHtml(chip.back)}</a>` : "";
    return `<div class="env-chip env-chip-${chip.state}" data-chip="${escapeHtml(key)}"><span>${escapeHtml(chip.text)}</span>${button}</div>`;
  }

  /** Mexeu num campo: ele passa a ter valor próprio (a faixa muda na hora, sem redesenhar a janela). */
  #markOwn(key) {
    if (!key || !(key in SCENE_FIELDS) || this.draft.own[key]) return;
    this.draft.own[key] = true;
    const chip = this.element?.querySelector(`[data-chip="${key}"]`);
    if (chip) chip.outerHTML = this.#chipHtml(key);
    this.#updateBanner();
  }

  #ownCount() {
    return SCENE_FIELD_KEYS.filter(key => this.draft.own[key]).length;
  }

  #updateBanner() {
    const banner = this.element?.querySelector(".env-banner-count");
    if (banner) banner.textContent = ownBannerText(this.#ownCount());
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
      worldDensity = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.manaDensityDefault));
    } catch (err) {
      /* sem setting */
    }
    const v = this.draft.values;
    const inheritEnabled = isSceneFoldersEnabled();
    const extra = {
      hasScene: Boolean(this.target),
      isFolder: this.isFolder,
      inheritEnabled,
      manaDensity: v.manaDensity ?? "",
      radiationEnabled: isRadiationEnabled(),
      radiation: v.radiation || 0,
      sensorsEnabled: isVesselsEnabled() && isShipSensorsEnabled(),
      sensorInterference: v.sensorInterference || 0,
      sensorInterferenceExample: Math.round(1000 * (1 - Math.min(100, Math.max(0, Number(v.sensorInterference) || 0)) / 100)),
      clockEnabled: isWorldClockEnabled(),
      clockDarkness: Boolean(v.clockDarkness),
      calendarEnabled: isWorldClockEnabled() && isCalendarEnabled(),
      timeLines: getTimelines().map(line => ({ id: line.id, label: `${line.name} — ${localDateText(lineNow(line))}`, selected: line.id === v.lineId })),
      timeNetwork: Boolean(v.network),
      worldDensity,
      shopsEnabled: isShopsEnabled(),
      depotOptions: this.#depotOptions(v.depotId),
      ...this.#lootContext(),
      fxActive,
      chips: inheritEnabled ? Object.fromEntries(SCENE_FIELD_KEYS.map(key => [key, this.#chipHtml(key)])) : {},
      bannerText: ownBannerText(this.#ownCount()),
      hasOwn: this.#ownCount() > 0,
      hazards: v.hazards.map((h, index) => ({
        index,
        conditions: conditions.map(c => ({ id: c.id, label: c.label, selected: c.id === h.conditionId })),
        presetOptions: optionsFor(presets, h.fx),
        particleOptions: optionsFor(particles, h.fxParticle),
        filterOptions: optionsFor(filters, h.fxFilter),
        tint: Boolean(h.fxColor),
        color: h.fxColor || "#33ff66",
        immuneHtml: pickerFieldHtml(h.immuneTraits ?? [], "env-immune")
      }))
    };
    if (this.isFolder && this.folder) Object.assign(extra, this.#folderContext());
    return Object.assign(context, extra);
  }

  /** As opções do seletor "Entregas vão para": os depósitos do mundo (e o salvo que sumiu, para "Salvar" não apagar calado). */
  #depotOptions(current) {
    const list = listDepots().map(d => ({ id: d.uuid, label: d.name, selected: d.uuid === current }));
    if (current && !list.some(o => o.id === current)) list.push({ id: current, label: "(depósito não encontrado)", selected: true });
    return [{ id: "", label: "— sem endereço de entrega —", selected: !current }, ...list];
  }

  /** Pilhas da cena e a última troca entre jogadores (só na janela de uma cena, só o Mestre). */
  #lootContext() {
    if (this.isFolder || !this.scene || !game.user.isGM || !isShopsEnabled()) return { lootPanel: false };
    const sum = pileSummaryFor(this.scene);
    const last = lastUndoableTrade();
    return { lootPanel: true, pileCount: sum.pileCount, pileItems: sum.itemCount, lastTradeLabel: last?.label ?? "" };
  }

  /** "+ Criar depósito": cria o Ator "Depósito: nome" e já liga ao campo (grava na hora só este campo). */
  static async #onCreateDepot() {
    const doc = this.target;
    if (!doc) return;
    this.#collect();
    const depot = await createDepot(doc.name);
    if (!depot) return;
    const own = this.isFolder ? folderOwn(doc) : sceneOwnValues(doc);
    await writeOwn(doc, { ...own, depotId: depot.uuid });
    this.draft.own.depotId = true;
    this.draft.values.depotId = depot.uuid;
    ui.notifications.info(`${depot.name} criado e ligado. Arraste o Ator para o mapa se quiser um Token (armário, balcão, terminal).`);
    this.render();
  }

  static async #onClearPiles() {
    const scene = this.scene;
    if (!scene) return;
    const summary = clearPilesSummary(pileSummaryFor(scene));
    if (summary.empty) return ui.notifications.info(summary.title);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: summary.title },
      content: `<div class="nihility-shop-confirm"><p>${escapeHtml(summary.body)}</p></div>`,
      yes: { label: summary.confirm },
      rejectClose: false
    });
    if (!ok) return;
    const outcome = await askClearPiles(scene);
    if (outcome?.ok) this.render();
  }

  static async #onUndoTrade() {
    const outcome = await askUndoLastTrade();
    if (outcome?.ok) this.render();
  }

  /** Resumo das cenas com valor próprio e os campos da cópia "do Foundry". */
  #folderContext() {
    const folder = this.folder;
    const lines = getTimelines();
    const scenes = scenesUnderFolder(folder);
    const ownRows = scenesWithOwn(scenesWithOwnUnder(folder)).map(row => {
      const own = sceneOwnValues(game.scenes.get(row.id));
      return {
        name: row.name,
        text: row.fields.map(key => fieldValueText(key, own[key], { lineName: key === "lineId" ? lines.find(l => l.id === own[key])?.name : null, depotName: key === "depotId" ? fromUuidSync(own[key])?.name : null })).join(" · ")
      };
    });
    const copy = this.copyDraft ?? {};
    return {
      sceneCount: scenes.length,
      subfolderCount: subfoldersOf(folder).length,
      ownScenes: ownRows,
      ownSceneCount: ownRows.length,
      copyFields: SCENE_COPY_FIELDS.map(field => {
        const value = copy[field.key]?.value ?? field.def;
        return {
          key: field.key, label: field.label, hint: field.hint ?? "",
          checked: Boolean(copy[field.key]?.on),
          isBool: field.type === "bool", isNumber: field.type === "number", isScale: field.type === "scale", isPlaylist: field.type === "playlist",
          boolValue: Boolean(value), numberValue: value, min: field.min, max: field.max, step: field.step,
          distance: field.type === "scale" ? value.distance : "", units: field.type === "scale" ? value.units : "",
          playlists: field.type === "playlist"
            ? [{ id: "", label: "— nenhuma —", selected: !value }, ...game.playlists.map(p => ({ id: p.id, label: p.name, selected: p.id === value }))]
            : []
        };
      })
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const field of this.element.querySelectorAll(".env-immune")) wireTraitPickerField(field);
    // Mexer num campo marca valor próprio (a cena ou a pasta deixa de herdar aquele campo).
    const mark = event => {
      const wrap = event.target.closest?.("[data-field]");
      if (wrap && this.draft) this.#markOwn(wrap.dataset.field);
    };
    this.element.addEventListener("input", mark);
    this.element.addEventListener("change", mark);
  }

  #collectCopy() {
    const out = {};
    if (!this.element || !this.isFolder) return out;
    for (const row of this.element.querySelectorAll(".env-copy-row")) {
      const key = row.dataset.copy;
      const field = copyField(key);
      if (!field) continue;
      const on = row.querySelector("[name=copyOn]")?.checked ?? false;
      let value;
      if (field.type === "bool") value = row.querySelector("[name=copyValue]").checked;
      else if (field.type === "number") value = Number(row.querySelector("[name=copyValue]").value) || 0;
      else if (field.type === "scale") value = { distance: Number(row.querySelector("[name=copyDistance]").value) || 1, units: row.querySelector("[name=copyUnits]").value };
      else value = row.querySelector("[name=copyValue]").value;
      out[key] = { on, value };
    }
    return out;
  }

  static async #onApplyCopy() {
    this.copyDraft = this.#collectCopy();
    const picked = Object.fromEntries(Object.entries(this.copyDraft).filter(([, c]) => c.on).map(([key, c]) => [key, c.value]));
    await copyFoundrySettings(this.folder, picked);
    this.render();
  }

  static #onInherit(event, target) {
    this.#collect();
    const key = target.dataset.field;
    if (!(key in SCENE_FIELDS)) return;
    this.draft.own[key] = false;
    const value = this.#inherited()[key].value;
    this.draft.values[key] = Array.isArray(value) ? value.map(h => ({ ...h })) : value;
    this.render();
  }

  static #onInheritAll() {
    this.#collect();
    const inherited = this.#inherited();
    for (const key of SCENE_FIELD_KEYS) {
      this.draft.own[key] = false;
      const value = inherited[key].value;
      this.draft.values[key] = Array.isArray(value) ? value.map(h => ({ ...h })) : value;
    }
    this.render();
  }

  static #onAddHazard() {
    this.#collect();
    this.draft.values.hazards.push({ conditionId: getActiveStatusConditions()[0]?.id ?? "", immuneTraits: [], fx: "", fxParticle: "", fxFilter: "", fxColor: "" });
    this.draft.own.hazards = true;
    this.render();
  }

  static #onRemoveHazard(event, target) {
    this.#collect();
    this.draft.values.hazards.splice(Number(target.dataset.index), 1);
    this.draft.own.hazards = true;
    this.render();
  }

  /** "Ajustar esta linha…": abre o editor da linha escolhida. */
  static async #onAdjustLine() {
    this.#collect();
    const { openTimelineEditor } = await import("./timeline-editor.js");
    openTimelineEditor(this.draft.values.lineId || "main");
  }

  static async #onNewLine() {
    const { openTimelineEditor } = await import("./timeline-editor.js");
    openTimelineEditor(null);
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
    const doc = this.target;
    if (!doc) return;
    this.#collect();
    const previous = this.isFolder ? folderOwn(doc) : sceneOwnValues(doc);
    // Campos cuja seção não aparece (bloco desligado) ficam como estão.
    const hidden = new Set([
      ...(isRadiationEnabled() ? [] : ["radiation"]),
      ...(isVesselsEnabled() && isShipSensorsEnabled() ? [] : ["sensorInterference"]),
      ...(isShopsEnabled() ? [] : ["depotId"]),
      ...(isWorldClockEnabled() ? [] : ["clockDarkness"]),
      ...(isWorldClockEnabled() && isCalendarEnabled() ? [] : ["lineId", "network"])
    ]);
    const next = {};
    for (const key of SCENE_FIELD_KEYS) {
      if (hidden.has(key)) {
        if (key in previous) next[key] = previous[key];
        continue;
      }
      if (!this.draft.own[key]) continue;
      const clean = normalizeCfg({ [key]: this.draft.values[key] });
      if (key in clean) next[key] = clean[key];
    }
    // Antes de a pasta mudar de linha ou de "tem rede", guarda a data dos aparelhos (a cena já faz isso por hook).
    if (this.isFolder) await settleFolderScenes(doc);
    // A troca da flag dispara Tokens, escuridão, tempo e visual (hooks de environment, world-clock, world-time e scene-config-apply).
    await writeOwn(doc, next);
    ui.notifications.info(this.isFolder ? `Ambiente da pasta "${doc.name}" salvo.` : `Ambiente de "${doc.name}" salvo.`);
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
