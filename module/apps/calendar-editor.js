/**
 * Editor do calendário do mundo (J9b): nome, formato (data ou estelar), o dia (horas, minutos,
 * segundos), meses, bissexto, dias da semana e eras; "Começar de um modelo" (Gregoriano, Fantasia,
 * Sci-Fi) substitui meses, dias e eras, com confirmação. Edita uma cópia; nada é gravado antes de
 * "Salvar calendário". Só muda como a data é ESCRITA: o tempo de ninguém muda.
 */
import { SYSTEM_ID } from "../core/config.js";
import { getCalendar, saveCalendar, getTimelines, lineNow } from "../core/world-time.js";
import {
  CALENDAR_MODELS, buildCalendarModel, normalizeCalendar, calendarProblems, yearLengths, dateToTime, formatDate, formatTimeOfDay, formatDateTimeShort,
  unitSeconds, secondsPerDay
} from "../core/calendar-rules.js";
import { reportError } from "../helpers/report.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CalendarEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-calendar-editor",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-calendar-editor"],
    window: { title: "Editor de calendário", icon: "fa-solid fa-calendar-days", resizable: true },
    position: { width: 620, height: 720 },
    actions: {
      applyModel: CalendarEditorApp.#onApplyModel,
      addMonth: CalendarEditorApp.#onAddMonth,
      removeMonth: CalendarEditorApp.#onRemoveMonth,
      addEra: CalendarEditorApp.#onAddEra,
      removeEra: CalendarEditorApp.#onRemoveEra,
      save: CalendarEditorApp.#onSave,
      cancel: CalendarEditorApp.#onCancel
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/calendar-editor.hbs`, scrollable: [".cal-root"] }
  };

  /** Cópia em edição (o calendário do mundo, normalizado). */
  draft = null;

  /** Lê os campos da tela para a cópia (antes de redesenhar, para não perder o que foi digitado). */
  #collect() {
    const root = this.element;
    if (!root || !this.draft) return;
    const value = name => root.querySelector(`[name=${name}]`)?.value;
    const d = this.draft;
    d.name = value("name") ?? d.name;
    d.format = value("format") === "stellar" ? "stellar" : "date";
    d.hoursPerDay = Number(value("hoursPerDay")) || d.hoursPerDay;
    d.minutesPerHour = Number(value("minutesPerHour")) || d.minutesPerHour;
    d.secondsPerMinute = Number(value("secondsPerMinute")) || d.secondsPerMinute;
    d.months = [...root.querySelectorAll(".cal-month")].map(row => ({
      name: row.querySelector("[name=monthName]").value,
      abbr: row.querySelector("[name=monthAbbr]").value,
      days: Number(row.querySelector("[name=monthDays]").value) || 1,
      leapDays: Number(row.querySelector("[name=monthLeap]").value) || 0
    }));
    const mode = root.querySelector("[name=leapMode]:checked")?.value;
    d.leap = mode === "never" ? { every: 0, from: Number(value("leapFrom")) || 0 } : { every: Math.max(1, Number(value("leapEvery")) || 4), from: Number(value("leapFrom")) || 0 };
    d.weekdays = String(value("weekdays") ?? "").split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    d.eras = [...root.querySelectorAll(".cal-era")].map(row => ({
      name: row.querySelector("[name=eraName]").value,
      abbr: row.querySelector("[name=eraAbbr]").value,
      start: Number(row.querySelector("[name=eraStart]").value) || 0
    }));
    d.beforeAbbr = value("beforeAbbr") ?? d.beforeAbbr;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.draft ??= foundry.utils.deepClone(getCalendar());
    const cal = normalizeCalendar(this.draft);
    const lengths = yearLengths(cal);
    // "Como fica": a data de hoje da linha principal escrita neste calendário, 500 anos antes e antes da 1ª era.
    const today = lineNow(getTimelines()[0]);
    const spy = unitSeconds(cal, "year");
    const preview = [
      `${formatDate(cal, today)} · ${formatTimeOfDay(cal, today)}`,
      `500 anos antes: ${formatDate(cal, today - 500 * spy)}`,
      cal.eras.length ? `Antes da ${cal.eras[0].name}: ${formatDate(cal, dateToTime(cal, { year: cal.eras[0].start - 120, month: 4, day: 14 }), { weekday: false })}` : "",
      `No formato estelar: ${formatDateTimeStellar(cal, today)}`
    ].filter(Boolean);
    return Object.assign(context, {
      models: Object.values(CALENDAR_MODELS).map(m => ({ id: m.id, label: m.label })),
      draft: this.draft,
      isStellar: this.draft.format === "stellar",
      leapNever: !(this.draft.leap?.every > 0),
      leapEvery: this.draft.leap?.every > 0 ? this.draft.leap.every : 4,
      leapFrom: this.draft.leap?.from ?? 0,
      weekdaysText: (this.draft.weekdays ?? []).join("\n"),
      yearText: `${lengths.common} dias no ano${lengths.leap ? ` (${lengths.leap} no bissexto)` : ""}`,
      secondsPerDay: secondsPerDay(cal),
      preview
    });
  }

  static async #onApplyModel() {
    const id = this.element.querySelector("[name=model]")?.value;
    if (!CALENDAR_MODELS[id]) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Trocar o modelo" },
      content: `<p>Isto substitui meses, dias da semana e eras pelos do modelo <strong>${CALENDAR_MODELS[id].label}</strong>. O tempo de ninguém muda: só como a data é escrita. Trocar?</p>`,
      rejectClose: false
    });
    if (!ok) return;
    this.draft = buildCalendarModel(id);
    this.render();
  }

  static #onAddMonth() {
    this.#collect();
    this.draft.months.push({ name: `Mês ${this.draft.months.length + 1}`, abbr: `M${this.draft.months.length + 1}`, days: 30, leapDays: 0 });
    this.render();
  }

  static #onRemoveMonth(event, target) {
    this.#collect();
    if (this.draft.months.length <= 1) return ui.notifications.warn("O calendário precisa de pelo menos um mês.");
    this.draft.months.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onAddEra() {
    this.#collect();
    this.draft.eras.push({ name: "Nova era", abbr: "N.E.", start: (this.draft.eras.at(-1)?.start ?? 0) + 1000 });
    this.render();
  }

  static #onRemoveEra(event, target) {
    this.#collect();
    this.draft.eras.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onSave() {
    this.#collect();
    const problems = calendarProblems(this.draft);
    if (problems.length) return ui.notifications.warn(problems[0]);
    try {
      await saveCalendar(this.draft);
      ui.notifications.info("Calendário salvo.");
      this.close();
    } catch (err) {
      reportError("Não consegui salvar o calendário.", err);
    }
  }

  static #onCancel() {
    this.close();
  }
}

/** "1203.371 · 14:05" (a data estelar do mesmo instante, qualquer que seja o formato do calendário). */
function formatDateTimeStellar(cal, seconds) {
  return formatDateTimeShort({ ...cal, format: "stellar" }, seconds);
}

export function openCalendarEditor() {
  if (!game.user.isGM) return null;
  const existing = foundry.applications.instances.get("nihility-calendar-editor");
  if (existing) return existing.render({ force: true });
  return new CalendarEditorApp().render({ force: true });
}
