/**
 * Janela do Mestre "Relógio do mundo" (J9, J9b): a data e a hora da linha principal, passar o tempo,
 * as linhas do tempo (com "Ajustar"), o que cada personagem "acha que é" e o "Descanso do grupo".
 * Só o Mestre. O jogador nunca vê esta janela nem a hora pela interface do Foundry — vê só no PAD e em
 * itens que marcam o tempo. Redesenha sozinha quando o tempo muda.
 */
import { SYSTEM_ID, isWorldClockEnabled, isCalendarEnabled } from "../core/config.js";
import { clockParts, isDayAt, darknessFor, timeAt, SECONDS_PER_HOUR } from "../core/world-clock-rules.js";
import { advanceWorldClock, setWorldClock, groupRest, clockConfig, worldNow, partyMembers, sleepingEffect, sleepState } from "../core/world-clock.js";
import {
  getCalendar, getTimelines, lineNow, scenesOfLine, localDateText, localDateLong, actorScene, sceneLine, personalNow,
  deviceView, dayLengthSeconds, actorAge, listChambers, passTimeForActors
} from "../core/world-time.js";
import { timeToDate, dateToTime, eraYearToYear, describeRate, formatElapsed, MAIN_LINE_ID } from "../core/calendar-rules.js";
import { escapeHtml } from "../helpers/html.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Os campos de data de uma hora local: dia, mês (opções), ano da era, era (opções), hora e minuto. */
export function dateFieldsContext(local) {
  const cal = getCalendar();
  const p = timeToDate(cal, local);
  const eraIndex = p.era.index;
  return {
    day: p.day,
    year: p.era.year,
    hour: String(p.hour).padStart(2, "0"),
    minute: String(p.minute).padStart(2, "0"),
    months: cal.months.map((m, i) => ({ index: i + 1, name: m.name, selected: i === p.monthIndex })),
    eras: [
      ...(cal.eras.length ? [{ index: -1, name: `Antes da ${cal.eras[0].name}`, selected: eraIndex === -1 }] : []),
      ...cal.eras.map((e, i) => ({ index: i, name: e.name, selected: eraIndex === i }))
    ],
    hasEras: cal.eras.length > 0
  };
}

/** Lê os campos de data postos por `dateFieldsContext` e devolve segundos locais. */
export function readDateFields(root) {
  const cal = getCalendar();
  const num = name => Number(root.querySelector(`[name=${name}]`)?.value);
  const eraSelect = root.querySelector("[name=era]");
  const eraIndex = eraSelect ? Number(eraSelect.value) : -2;
  return dateToTime(cal, {
    year: eraYearToYear(cal, eraIndex, num("year")),
    month: num("month") || 1,
    day: num("day") || 1,
    hour: num("hour") || 0,
    minute: num("minute") || 0
  });
}

export class WorldClockApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-world-clock",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-world-clock"],
    window: { title: "Relógio do mundo", icon: "fa-solid fa-clock", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      advance: WorldClockApp.#onAdvance,
      advanceDay: WorldClockApp.#onAdvanceDay,
      setTime: WorldClockApp.#onSetTime,
      groupRest: WorldClockApp.#onGroupRest,
      openCalendar: WorldClockApp.#onOpenCalendar,
      newLine: WorldClockApp.#onNewLine,
      editLine: WorldClockApp.#onEditLine,
      viewScenes: WorldClockApp.#onViewScenes,
      toggleNpcs: WorldClockApp.#onToggleNpcs,
      toggleMark: WorldClockApp.#onToggleMark,
      clearMarks: WorldClockApp.#onClearMarks,
      goToChamber: WorldClockApp.#onGoToChamber
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/world-clock.hbs`, scrollable: [".wc-root"] }
  };

  #hookId = null;
  showNpcs = false;
  /** Os personagens marcados na tabela (uuids): "Passar o tempo" vale só para eles (8b.2). */
  marked = new Set();

  /** Os Atores marcados que ainda existem. */
  #markedActors() {
    const out = [];
    for (const uuid of [...this.marked]) {
      const actor = fromUuidSync(uuid);
      if (actor?.documentName === "Actor") out.push(actor);
      else this.marked.delete(uuid);
    }
    return out;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = worldNow();
    const config = clockConfig();
    const calendar = isCalendarEnabled();
    const lines = getTimelines();
    const main = lines[0];
    const local = lineNow(main);
    const parts = clockParts(local, dayLengthSeconds());
    const day = isDayAt(local, config);
    const sleepers = partyMembers().filter(a => sleepingEffect(a)).map(a => ({ name: a.name, rest: sleepState(a)?.kind === "long" ? "completo" : "curto" }));
    const cal = getCalendar();
    const fields = calendar ? dateFieldsContext(local) : null;
    return Object.assign(context, {
      calendarOn: calendar,
      day: parts.day,
      hour: String(parts.hour).padStart(2, "0"),
      minute: String(parts.minute).padStart(2, "0"),
      dateLong: calendar ? localDateLong(local) : "",
      calendarName: cal.name,
      fields,
      phase: day ? "Dia" : "Noite",
      phaseIcon: day ? "fa-sun" : "fa-moon",
      sunsetText: `${config.sunset}:00`,
      darkness: Math.round(darknessFor(local, config) * 100),
      sleepers,
      partySize: partyMembers().length,
      shortHours: config.shortRestHours,
      longHours: config.longRestHours,
      lines: calendar
        ? lines.map(line => ({
          id: line.id,
          name: line.name,
          isMain: line.id === MAIN_LINE_ID,
          dateText: localDateText(lineNow(line, now)),
          sceneCount: scenesOfLine(line.id).length,
          rateText: line.id === MAIN_LINE_ID || Math.abs(line.rate - 1) < 1e-12 ? "" : describeRate(cal, line.rate),
          activeScene: line.id === MAIN_LINE_ID ? (game.scenes.active?.name ?? "") : ""
        }))
        : [],
      people: calendar ? this.#people(cal) : [],
      chambers: calendar ? this.#chambers(cal) : [],
      markedCount: calendar ? this.#markedActors().length : 0,
      markedNames: calendar ? this.#markedActors().map(a => a.name).join(", ") : "",
      showNpcs: this.showNpcs
    });
  }

  /** As câmaras do tempo (Regiões com ritmo próprio): onde ficam, o ritmo, e "Ir até". */
  #chambers(cal) {
    return listChambers().map(c => ({
      uuid: c.behavior.uuid,
      where: `${c.scene.name} › ${c.region.name}`,
      rateText: describeRate(cal, c.rate),
      network: c.network,
      disabled: c.disabled
    }));
  }

  /** Os PJs (e os NPCs, por opção): onde estão, o tempo pessoal e o que o aparelho acha que é. */
  #people(cal) {
    const actors = game.actors.filter(a => a.type === "character" && (this.showNpcs || (a.system?.isPlayerCharacter !== false && a.hasPlayerOwner)));
    return actors.map(actor => {
      const scene = actorScene(actor);
      const line = sceneLine(scene);
      const view = deviceView(actor);
      const drift = !view.network && view.drift !== 0;
      const age = actorAge(actor);
      return {
        uuid: actor.uuid,
        checked: this.marked.has(actor.uuid),
        ageText: age === null ? "" : `${age} ${age === 1 ? "ano" : "anos"}`,
        name: actor.name,
        place: scene?.name ?? "—",
        lineName: scene ? line.name : "sem Token",
        personal: formatElapsed(cal, personalNow(actor)),
        thinks: view.suppressed ? "--:--" : localDateText(view.local),
        mismatch: drift && !view.suppressed
      };
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hookId = Hooks.on("updateWorldTime", () => this.render());
    // D2 (sessão 4): `updateSetting` chega antes de a leitura da setting valer (a janela ficava com a data velha): re-pinta
    // também um instante depois, e quem salva o calendário/linhas chama `refreshOpenWorldClock`.
    this.updateHooks = ["updateScene", "updateSetting", "createToken", "deleteToken", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"].map(name => [name, Hooks.on(name, () => {
      this.render();
      if (name === "updateSetting") setTimeout(() => { if (this.rendered) this.render(); }, 120);
    })]);
  }

  _onClose(options) {
    if (this.#hookId !== null) Hooks.off("updateWorldTime", this.#hookId);
    this.#hookId = null;
    for (const [name, id] of this.updateHooks ?? []) Hooks.off(name, id);
    super._onClose?.(options);
  }

  /** Com personagens marcados, o tempo passa só para eles (o mundo não anda). Devolve se foi assim. */
  async #passForMarked(seconds) {
    const actors = this.#markedActors();
    if (!actors.length) return false;
    const count = await passTimeForActors(actors, seconds);
    ui.notifications.info(`${count} personagem(ns) viveram ${formatElapsed(getCalendar(), seconds)}; o mundo não andou.`);
    this.render();
    return true;
  }

  static async #onAdvance(event, target) {
    const hours = Number(target.dataset.hours) || 0;
    const seconds = Math.round(hours * SECONDS_PER_HOUR);
    if (await this.#passForMarked(seconds)) return;
    await advanceWorldClock(seconds);
  }

  static async #onAdvanceDay() {
    if (await this.#passForMarked(dayLengthSeconds())) return;
    await advanceWorldClock(dayLengthSeconds());
  }

  static #onToggleMark(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    if (this.marked.has(uuid)) this.marked.delete(uuid);
    else this.marked.add(uuid);
    this.render();
  }

  static #onClearMarks() {
    this.marked.clear();
    this.render();
  }

  /** Abre a cena da câmara e leva a vista até a Região. */
  static async #onGoToChamber(event, target) {
    const behavior = fromUuidSync(target.dataset.uuid);
    const region = behavior?.parent;
    const scene = region?.parent;
    if (!scene) return;
    try {
      if (canvas?.scene?.id !== scene.id) {
        // Vindo de outra cena, o `view()` resolve antes de o canvas terminar de desenhar e pôr a vista inicial
        // da cena (que apagava o pan): espera o `canvasReady` (sessão 5, "Ir até" centrava no meio da cena).
        const ready = new Promise(resolve => Hooks.once("canvasReady", resolve));
        await scene.view();
        await Promise.race([ready, new Promise(resolve => setTimeout(resolve, 5000))]);
      }
      const bounds = region.bounds;
      if (bounds && canvas?.ready && canvas.scene?.id === scene.id) {
        await canvas.animatePan({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Relógio: não consegui ir até a câmara.`, err);
    }
  }

  static async #onSetTime() {
    const root = this.element;
    if (isCalendarEnabled()) {
      await setWorldClock(readDateFields(root));
      return;
    }
    const day = Number(root.querySelector("[name=day]")?.value) || clockParts(worldNow()).day;
    const hour = Number(root.querySelector("[name=hour]")?.value) || 0;
    const minute = Number(root.querySelector("[name=minute]")?.value) || 0;
    await setWorldClock(timeAt(day, hour, minute));
  }

  static async #onGroupRest(event, target) {
    const kind = target.dataset.kind === "long" ? "long" : "short";
    const count = await groupRest(kind);
    ui.notifications.info(count ? `${count} personagem(ns) descansaram.` : "Ninguém para descansar (nenhum PJ com jogador online).");
  }

  static async #onOpenCalendar() {
    const { openCalendarEditor } = await import("./calendar-editor.js");
    openCalendarEditor();
  }

  static async #onNewLine() {
    const { openTimelineEditor } = await import("./timeline-editor.js");
    openTimelineEditor(null);
  }

  static async #onEditLine(event, target) {
    const { openTimelineEditor } = await import("./timeline-editor.js");
    openTimelineEditor(target.dataset.line);
  }

  static async #onViewScenes(event, target) {
    const scenes = scenesOfLine(target.dataset.line);
    const content = `<div class="nihility-config-app"><ul>${scenes.map(s => `<li><a data-open-scene="${escapeHtml(s.id)}">${escapeHtml(s.name)}</a></li>`).join("") || "<li>Nenhuma cena nesta linha.</li>"}</ul></div>`;
    await foundry.applications.api.DialogV2.prompt({
      window: { title: "Cenas desta linha" },
      content,
      ok: { label: "Fechar" },
      render: (event, dialog) => {
        dialog.element.querySelectorAll("[data-open-scene]").forEach(a => a.addEventListener("click", () => game.scenes.get(a.dataset.openScene)?.sheet?.render(true)));
      },
      rejectClose: false
    });
  }

  static #onToggleNpcs() {
    this.showNpcs = !this.showNpcs;
    this.render();
  }
}

/** Abre a janela (só o Mestre). */
export function openWorldClock() {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre mexe no Relógio do mundo.");
  if (!isWorldClockEnabled()) return ui.notifications.warn("O bloco Relógio do mundo está desligado em Módulos do Sistema.");
  const existing = foundry.applications.instances.get("nihility-world-clock");
  if (existing) return existing.render({ force: true });
  return new WorldClockApp().render({ force: true });
}
