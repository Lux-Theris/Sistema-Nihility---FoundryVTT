/**
 * Janela do Mestre "Relógio do mundo" (J9): a hora e o dia, +10 min / +1 h / +8 h, definir a hora,
 * e o "Descanso do grupo". Só o Mestre. O jogador nunca vê esta janela nem a hora pela interface do
 * Foundry — ele vê só no PAD e em itens que marcam o tempo. Redesenha sozinha quando o tempo muda.
 */
import { SYSTEM_ID, isWorldClockEnabled } from "../core/config.js";
import { clockParts, isDayAt, darknessFor, timeAt, SECONDS_PER_HOUR } from "../core/world-clock-rules.js";
import { advanceWorldClock, setWorldClock, groupRest, clockConfig, worldNow, partyMembers, sleepingEffect, sleepState } from "../core/world-clock.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class WorldClockApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-world-clock",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-world-clock"],
    window: { title: "Relógio do mundo", icon: "fa-solid fa-clock", resizable: false },
    position: { width: 420, height: "auto" },
    actions: {
      advance: WorldClockApp.#onAdvance,
      setTime: WorldClockApp.#onSetTime,
      groupRest: WorldClockApp.#onGroupRest
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/world-clock.hbs` }
  };

  #hookId = null;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = worldNow();
    const config = clockConfig();
    const parts = clockParts(now);
    const day = isDayAt(now, config);
    const sleepers = partyMembers().filter(a => sleepingEffect(a)).map(a => ({ name: a.name, rest: sleepState(a)?.kind === "long" ? "completo" : "curto" }));
    return Object.assign(context, {
      day: parts.day,
      hour: String(parts.hour).padStart(2, "0"),
      minute: String(parts.minute).padStart(2, "0"),
      phase: day ? "Dia" : "Noite",
      phaseIcon: day ? "fa-sun" : "fa-moon",
      darkness: Math.round(darknessFor(now, config) * 100),
      sleepers,
      partySize: partyMembers().length,
      shortHours: config.shortRestHours,
      longHours: config.longRestHours
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hookId = Hooks.on("updateWorldTime", () => this.render());
  }

  _onClose(options) {
    if (this.#hookId !== null) Hooks.off("updateWorldTime", this.#hookId);
    this.#hookId = null;
    super._onClose?.(options);
  }

  static async #onAdvance(event, target) {
    const hours = Number(target.dataset.hours) || 0;
    await advanceWorldClock(hours * SECONDS_PER_HOUR);
  }

  static async #onSetTime() {
    const root = this.element;
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
}

/** Abre a janela (só o Mestre). */
export function openWorldClock() {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre mexe no Relógio do mundo.");
  if (!isWorldClockEnabled()) return ui.notifications.warn("O bloco Relógio do mundo está desligado em Módulos do Sistema.");
  const existing = foundry.applications.instances.get("nihility-world-clock");
  if (existing) return existing.render({ force: true });
  return new WorldClockApp().render({ force: true });
}
