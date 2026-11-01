/**
 * Painel do Mestre em combate (backlog H10; canvas "Ferramentas da Mesa", prancha 4): todos os
 * combatentes numa tabela, na ordem da iniciativa, com a vez de quem joga destacada — Vida,
 * Escudo, Mana, Condições (com a mesma contagem do ícone no Token), Skills Ativas e Deslocamento.
 * Atualiza sozinho. Só leitura: clicar no nome abre a ficha, na linha centraliza o Token e
 * "Efeitos" abre a janela de efeitos. Só o Mestre.
 */
import { SYSTEM_ID, isFeatureEnabled, getNpcTierConfig } from "../core/config.js";
import { badgeFor } from "../combat/effect-badges.js";
import { collectActiveUpkeepSources } from "../skills/upkeep.js";
import { NPC_TIER_LABELS } from "../npc/npc-generator-rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const HOOKS = ["updateActor", "updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateItem", "deleteCombat", "createCombat"];
const pct = (value, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0);

export class CombatPanelApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-combat-panel",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-combat-panel"],
    window: { title: "Painel do combate", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 1040, height: 520 },
    actions: {
      openSheet: CombatPanelApp.#onOpenSheet,
      focusToken: CombatPanelApp.#onFocusToken,
      openEffects: CombatPanelApp.#onOpenEffects
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/combat-panel.hbs`, scrollable: [".cp-body"] }
  };

  #hookIds = [];
  #timer = null;

  get combat() {
    return ui.combat?.viewed ?? game.combat ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const combat = this.combat;
    context.hasCombat = Boolean(combat?.combatants?.size);
    if (!context.hasCombat) return context;
    const current = combat.combatant?.id;
    const movementOn = isFeatureEnabled("movement");
    const tiersOn = getNpcTierConfig().enabled;
    context.round = combat.round ?? 0;
    context.turnName = combat.combatant?.name ?? "";
    context.rows = (combat.turns ?? []).map(c => {
      const actor = c.actor;
      const sys = actor?.system ?? {};
      const ship = actor?.type === "starship" || actor?.type === "vehicle";
      const hp = ship ? sys.hull ?? {} : sys.attributes?.hp ?? {};
      const energy = ship ? sys.powerGrid?.capacitor ?? {} : sys.attributes?.energy ?? {};
      const shield = ship ? Number(sys.shields?.value) || 0 : Number(sys.attributes?.shield?.value) || 0;
      const effects = (actor?.appliedEffects ?? actor?.effects?.contents ?? [])
        .filter(e => e.img && !e.disabled)
        .map(e => {
          const badge = badgeFor(e, { combat });
          return { name: e.name, img: e.img, badge: badge?.text ?? "", tone: badge?.tone ?? "" };
        });
      const fallen = actor?.effects?.find(e => e.getFlag(SYSTEM_ID, "incapacitation")?.kind);
      const fallenFlag = fallen?.getFlag(SYSTEM_ID, "incapacitation");
      const total = Number(sys.movement?.total) || 0;
      const used = Number(c.getFlag(SYSTEM_ID, "movementUsed")) || 0;
      const dash = Boolean(c.getFlag(SYSTEM_ID, "movementDash"));
      return {
        id: c.id,
        actorUuid: actor?.uuid ?? "",
        tokenId: c.tokenId,
        sceneId: c.sceneId,
        name: c.name,
        img: c.img || actor?.img,
        initiative: c.initiative ?? "—",
        isTurn: c.id === current,
        hidden: c.hidden || c.token?.hidden,
        defeated: c.isDefeated,
        friendly: actor?.hasPlayerOwner || c.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        tier: tiersOn && !ship && sys.npcTier && sys.npcTier !== "normal" && !sys.isPlayerCharacter ? NPC_TIER_LABELS[sys.npcTier] : "",
        hpText: `${hp.value ?? 0}/${hp.max ?? 0}`,
        hpPercent: pct(hp.value ?? 0, hp.max ?? 0),
        hpLabel: ship ? "Integridade" : "Vida",
        shield: shield || "",
        energyText: energy.max ? `${energy.value ?? 0}/${energy.max}` : "",
        energyPercent: pct(energy.value ?? 0, energy.max ?? 0),
        effects,
        fallen: fallenFlag?.kind ? `${fallenFlag.kind === "fallen" ? "Caído" : "Inconsciente"}${fallenFlag.rounds ? ` · ${fallenFlag.rounds}` : ""}` : "",
        actives: actor && !ship ? collectActiveUpkeepSources(actor).map(s => ({ label: s.label, cost: s.upkeepCost })) : [],
        movement: movementOn && total > 0 ? `${Math.round(used * 10) / 10}/${dash ? total * 2 : total} m${dash ? " (correndo)" : ""}` : ""
      };
    });
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Atualiza sozinho: qualquer mudança em ficha, efeito ou combate redesenha (agrupado).
    const refresh = () => {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.rendered && this.render(), 120);
    };
    this.#hookIds = HOOKS.map(name => [name, Hooks.on(name, refresh)]);
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [name, id] of this.#hookIds) Hooks.off(name, id);
    this.#hookIds = [];
    clearTimeout(this.#timer);
  }

  static async #onOpenSheet(event, target) {
    event.stopPropagation();
    const actor = await fromUuid(target.dataset.actorUuid);
    actor?.sheet?.render(true);
  }

  /** Clicar na linha: centraliza o mapa no Token e o seleciona (se a cena dele estiver aberta). */
  static #onFocusToken(event, target) {
    if (event.target.closest("button, a")) return;
    const token = canvas?.scene?.id === target.dataset.sceneId ? canvas.tokens?.get(target.dataset.tokenId) : null;
    if (!token) return;
    token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  static async #onOpenEffects(event, target) {
    event.stopPropagation();
    const actor = await fromUuid(target.dataset.actorUuid);
    if (!actor) return;
    const { EffectsListApp } = await import("./effects-list.js");
    EffectsListApp.open(actor);
  }
}

/** Abre o painel (só o Mestre). */
export function openCombatPanel() {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre usa o Painel do combate.");
  const existing = foundry.applications.instances.get("nihility-combat-panel");
  if (existing) return existing.render({ force: true });
  return new CombatPanelApp().render({ force: true });
}

/** Botão "Painel" no rastreador de combate (só o Mestre). */
export function registerCombatPanelTracker() {
  Hooks.on("renderCombatTracker", (app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".nihility-panel-btn")) return;
    const host = root.querySelector(".encounter-controls, .combat-tracker-header, header");
    if (!host) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nihility-sim-btn nihility-panel-btn";
    button.title = "Painel do combate: todos numa tabela, atualizando sozinho.";
    button.innerHTML = `<i class="fa-solid fa-table-list"></i> Painel`;
    button.addEventListener("click", event => {
      event.preventDefault();
      openCombatPanel();
    });
    host.append(button);
  });
}
