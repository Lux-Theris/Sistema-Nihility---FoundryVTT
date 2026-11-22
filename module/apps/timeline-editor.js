/**
 * "Ajustar linha do tempo" (J9b): nome, a data de agora nesta linha, o ritmo do tempo, o combate ("o
 * mundo para" ou "anda no fim") e as cenas que estão nela. Muda o `base`, nunca o tempo do mundo.
 * Linha nova = cópia da data da principal em ritmo normal. A principal não tem ritmo nem "Apagar".
 */
import { SYSTEM_ID } from "../core/config.js";
import {
  getCalendar, getTimelines, lineNow, scenesOfLine, commitTimelines, sceneTimeFlag
} from "../core/world-time.js";
import {
  rateInputs, rateFromUnits, describeRate, RATE_UNITS, trackRebase, trackSetValue, normalizeTimelines, removeLine, outsideSeconds, humanDuration,
  MAIN_LINE_ID
} from "../core/calendar-rules.js";
import { dateFieldsContext, readDateFields } from "./world-clock-app.js";
import { reportError } from "../helpers/report.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TimelineEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-timeline-editor"],
    window: { title: "Ajustar linha do tempo", icon: "fa-solid fa-timeline", resizable: true },
    position: { width: 520, height: "auto" },
    actions: { save: TimelineEditorApp.#onSave, remove: TimelineEditorApp.#onRemove, setNormal: TimelineEditorApp.#onSetNormal }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/timeline-editor.hbs`, scrollable: [".tl-root"] }
  };

  constructor(options = {}) {
    super(options);
    this.lineId = options.lineId ?? null;
  }

  /** A linha em edição (a nova ainda não existe na lista). */
  #line() {
    const lines = getTimelines();
    if (this.lineId) return lines.find(l => l.id === this.lineId) ?? null;
    const main = lines[0];
    return { id: "", name: "Nova linha", base: main.base, worldAt: main.worldAt, rate: 1, combatWorld: "stop" };
  }

  get title() {
    return this.lineId ? `Ajustar linha do tempo — ${this.#line()?.name ?? ""}` : "Nova linha do tempo";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cal = getCalendar();
    const line = this.#line();
    const inputs = rateInputs(cal, line.rate);
    const unitOptions = current => RATE_UNITS.map(([id, one, many]) => ({ id, label: many, selected: id === current, one }));
    const inLine = new Set(this.lineId ? scenesOfLine(this.lineId).map(s => s.id) : []);
    return Object.assign(context, {
      isNew: !this.lineId,
      isMain: this.lineId === MAIN_LINE_ID,
      name: line.name,
      fields: dateFieldsContext(lineNow(line)),
      insideValue: inputs.inside.value,
      outsideValue: inputs.outside.value,
      insideUnits: unitOptions(inputs.inside.unit),
      outsideUnits: unitOptions(inputs.outside.unit),
      rateText: describeRate(cal, line.rate),
      combatStop: line.combatWorld !== "atEnd",
      combatAtEnd: line.combatWorld === "atEnd",
      scenes: game.scenes.map(scene => ({
        id: scene.id,
        name: scene.name,
        checked: inLine.has(scene.id),
        elsewhere: !inLine.has(scene.id) && sceneTimeFlag(scene).lineId !== MAIN_LINE_ID ? sceneTimeFlag(scene).lineId : ""
      }))
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // A frase "1 semana nesta linha = 7 anos na principal" se atualiza enquanto o Mestre digita.
    const update = () => {
      const cal = getCalendar();
      const rate = this.#readRate();
      const hint = root.querySelector(".tl-rate-hint");
      if (hint) hint.textContent = describeRate(cal, rate);
      const held = root.querySelector(".tl-combat-hint");
      if (held) held.textContent = `ao acabar, lá fora passa tudo de uma vez (1 rodada aqui = ${humanDuration(cal, outsideSeconds(rate, Number(CONFIG.time?.roundTime) || 6))} fora)`;
    };
    root.querySelectorAll(".tl-rate input, .tl-rate select").forEach(el => el.addEventListener("input", update));
    update();
  }

  #readRate() {
    const root = this.element;
    const read = side => ({ value: Number(root.querySelector(`[name=${side}Value]`)?.value), unit: root.querySelector(`[name=${side}Unit]`)?.value });
    return rateFromUnits(getCalendar(), read("inside"), read("outside"));
  }

  static #onSetNormal() {
    const root = this.element;
    for (const side of ["inside", "outside"]) {
      root.querySelector(`[name=${side}Value]`).value = 1;
      root.querySelector(`[name=${side}Unit]`).value = "day";
    }
    root.querySelector(".tl-rate input")?.dispatchEvent(new Event("input"));
  }

  static async #onSave() {
    const root = this.element;
    const now = Number(game.time.worldTime) || 0;
    const isMain = this.lineId === MAIN_LINE_ID;
    const lines = getTimelines();
    const current = this.#line();
    const rate = isMain ? 1 : this.#readRate();
    // O ritmo novo parte do valor de agora (a data não salta); depois, se o Mestre mexeu na data, ela é posta.
    let track = trackRebase(current, now, { rate });
    const originalFields = dateFieldsContext(lineNow(current));
    const typed = readDateFields(root);
    const before = readDateFields(this.#asFields(originalFields));
    if (typed !== before) track = trackSetValue(track, now, typed);
    const next = {
      id: this.lineId || `line-${foundry.utils.randomID(8)}`,
      name: root.querySelector("[name=name]")?.value?.trim() || current.name,
      ...track,
      combatWorld: root.querySelector("[name=combatWorld]:checked")?.value === "atEnd" ? "atEnd" : "stop"
    };
    const list = this.lineId ? lines.map(l => (l.id === this.lineId ? next : l)) : [...lines, next];
    const sceneIds = isMain ? null : [...root.querySelectorAll("[name=scene]:checked")].map(el => el.value);
    try {
      await commitTimelines(normalizeTimelines(list), { lineId: isMain ? null : next.id, sceneIds });
      ui.notifications.info(`Linha "${next.name}" salva.`);
      this.close();
    } catch (err) {
      reportError("Não consegui salvar a linha do tempo.", err);
    }
  }

  /** Um "documento" falso com os campos originais, para `readDateFields` ler o que a janela mostrou ao abrir. */
  #asFields(fields) {
    const values = { day: fields.day, year: fields.year, hour: fields.hour, minute: fields.minute, month: fields.months.find(m => m.selected)?.index, era: fields.eras.find(e => e.selected)?.index };
    return { querySelector: selector => {
      const name = /name=(\w+)/.exec(selector)?.[1];
      return name in values && values[name] !== undefined ? { value: values[name] } : null;
    } };
  }

  static async #onRemove() {
    if (!this.lineId || this.lineId === MAIN_LINE_ID) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Apagar linha do tempo" },
      content: "<p>As cenas desta linha voltam para a linha principal. O tempo de ninguém muda. Apagar?</p>",
      rejectClose: false
    });
    if (!ok) return;
    await commitTimelines(removeLine(getTimelines(), this.lineId), { lineId: this.lineId, sceneIds: [] });
    this.close();
  }
}

/** Abre o editor de uma linha (`null` = linha nova). */
export function openTimelineEditor(lineId) {
  if (!game.user.isGM) return null;
  const id = `nihility-timeline-${lineId ?? "new"}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  return new TimelineEditorApp({ id, lineId }).render({ force: true });
}
