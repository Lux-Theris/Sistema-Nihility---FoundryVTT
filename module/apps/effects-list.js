/**
 * Janela "Efeitos": tudo o que está agindo sobre um Personagem ou uma Nave, em palavras — Active
 * Effects (de onde vieram, o que mudam, quanto falta), Escudo e pools, Escudos mantidos, Skills
 * Ativas e o custo por rodada, Estruturas mantidas, efeitos que somem no próximo turno, sobrecarga
 * de peso; na Nave, efeitos de sistema, Raio Trator e Escudo adaptativo. O Mestre encerra dali.
 * Só lê; quem escreve são as funções de sempre (endShipSystemEffect, regenerateSustainedShields…).
 */
import { SYSTEM_ID, getEnergyLabelForActor, getActiveStatusConditions, getActiveDamageElements, getEffectTargetLabels, actorElements } from "../config.js";
import { readEffectChanges, effectModes } from "../helpers/foundry-compat.js";
import { describeShieldPools } from "../shield-pools.js";
import { structuresOnScene } from "../structures.js";
import { describeEffectChangeKey, collectActiveUpkeepSources } from "../skill-effects.js";
import { endShipSystemEffect } from "../starship-power.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { effectAnchors, finiteRemaining, anchorLifetime, PERMANENT } from "../effect-anchors.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Id da janela por Ator (uuid: dois Tokens não vinculados do mesmo Ator são duas janelas). */
function appId(actor) {
  return `nihility-effects-${actor.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

const isShip = actor => ["starship", "vehicle"].includes(actor?.type);

/** "Força +3", "Dano das armas ×1.20", "Elemento das armas → Fogo", "Deslocamento −50%". */
function describeChange(change) {
  const M = effectModes();
  const label = describeEffectChangeKey(change.key);
  const value = Number(change.value);
  if (change.mode === M.OVERRIDE) {
    const element = getActiveDamageElements().find(e => e.id === change.value)?.label;
    return `${label} → ${element ?? change.value}`;
  }
  if (change.mode === M.MULTIPLY) return `${label} ×${Number.isFinite(value) ? value.toFixed(2) : change.value}`;
  if (/forceMagic|absolute|weaponAbsolute/i.test(change.key)) return label;
  const percent = /Percent$/.test(change.key) ? "%" : "";
  return Number.isFinite(value) ? `${label} ${value >= 0 ? "+" : "−"}${Math.abs(value)}${percent}` : `${label} ${change.value}`;
}

/** Uma linha por Active Effect do Ator. */
function describeActiveEffect(effect, actor) {
  const flags = effect.flags?.[SYSTEM_ID] ?? {};
  const condition = flags.conditionId ? getActiveStatusConditions().find(c => c.id === flags.conditionId) : null;
  // A Skill de origem mora em quem a usou, não no alvo: `origin` (uuid) acha; o id só serve
  // quando o efeito está no próprio dono.
  let source = "";
  if (effect.origin) {
    try {
      source = fromUuidSync(effect.origin)?.name ?? "";
    } catch (err) {
      source = "";
    }
  }
  if (!source && flags.sourceSkillId) source = actor.items.get(flags.sourceSkillId)?.name ?? "";
  const anchors = effectAnchors(flags, effect.origin);
  const now = game.combat?.started ? { round: game.combat.round ?? 0, combatId: game.combat.id } : {};
  if (!source && condition) source = "Condição";

  let lines;
  let remaining;
  if (flags.periodic) {
    const labels = getEffectTargetLabels();
    const amount = Number(flags.tickAmount) || 0;
    const target = labels[flags.tickTarget] ?? flags.tickTarget;
    lines = [`${target} ${amount >= 0 ? "+" : "−"}${Math.abs(amount)} por ${flags.tickUnit === "manual" ? "tick manual" : "rodada"}`];
    remaining = anchors.length ? "até desligar a Skill" : `${flags.ticksRemaining ?? 0} tick(s)`;
  } else {
    lines = readEffectChanges(effect).map(describeChange);
    if (anchors.length) {
      const finite = finiteRemaining(flags.finite, now);
      const holders = anchors.length > 1 ? ` (${anchors.length} Skills)` : "";
      remaining = anchorLifetime({ anchors, finite }).untilOff ? `até desligar a Skill${holders}` : finite === PERMANENT ? "sem prazo" : `${finite} rodada(s) ou até desligar a Skill${holders}`;
    } else {
      const rounds = effect.duration?.remaining ?? effect.duration?.rounds;
      remaining = rounds ? `${Math.max(0, Math.ceil(rounds))} rodada(s)` : "sem prazo";
    }
  }
  if (condition && !lines.length) lines = ["só o marcador (o Mestre decide o efeito)"];
  return {
    img: effect.img,
    name: effect.name,
    source,
    lines,
    remaining,
    muted: effect.disabled,
    endAction: "endEffect",
    endId: effect.id
  };
}

export class EffectsListApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #hookIds = [];

  constructor(actor, options = {}) {
    super({ id: appId(actor), ...options });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-effects-list"],
    window: { title: "Efeitos", resizable: true },
    position: { width: 540, height: 620 },
    actions: {
      endEffect: EffectsListApp.#onEndEffect,
      endSystemEffect: EffectsListApp.#onEndSystemEffect,
      regenShields: EffectsListApp.#onRegenShields
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/effects-list.hbs`, scrollable: [".effects-list-body"] }
  };

  /** Abre (ou traz pra frente) a janela deste Ator. */
  static open(actor) {
    const existing = foundry.applications.instances?.get(appId(actor));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new EffectsListApp(actor).render({ force: true });
  }

  get title() {
    return `Efeitos — ${this.actor.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const isGM = game.user.isGM;
    const energy = getEnergyLabelForActor(actor);
    const sections = [];

    const bodyElements = actorElements(actor);
    if (bodyElements.length) {
      const catalog = getActiveDamageElements();
      sections.push({
        title: "Elemento",
        rows: [{
          img: "icons/svg/fire.svg",
          name: bodyElements.map(id => catalog.find(e => e.id === id)?.label ?? id).join(" + "),
          lines: ["A vantagem entre elementos vale contra este corpo (Espécie, Skill ou Condição)."],
          remaining: ""
        }]
      });
    }

    const effects = actor.effects.map(effect => describeActiveEffect(effect, actor));
    if (effects.length) sections.push({ title: "Efeitos ativos", rows: effects });

    if (isShip(actor)) {
      const sys = actor.system;
      const systemRows = (sys.systemEffects ?? []).map(effect => {
        const module = effect.moduleId ? actor.items.get(effect.moduleId) : null;
        const text = {
          moduleDisabled: `${module?.name ?? "Módulo"} derrubado`,
          energyDrain: `Energia drenada −${effect.percent}%`,
          resistanceDown: `Resistência à Penetração e Redução −${effect.percent}`,
          brace: `Preparada para impacto: −${effect.percent}% de dano`,
          tractor: `Presa por Raio Trator: −${effect.percent}% de deslocamento`
        }[effect.kind] ?? effect.kind;
        return {
          img: "icons/svg/hazard.svg",
          name: text,
          source: effect.label || "",
          lines: [],
          remaining: effect.kind === "tractor" ? "enquanto o Raio estiver ligado" : `${effect.rounds} rodada(s)`,
          endAction: "endSystemEffect",
          endId: effect.id
        };
      });
      if (systemRows.length) sections.push({ title: "Efeitos de sistema", rows: systemRows });

      const elements = getActiveDamageElements();
      const adaptRows = sys.modulesByRole("shield")
        .filter(m => m.system.adaptive)
        .map(m => {
          const learned = Object.entries(m.getFlag(SYSTEM_ID, "shieldAdaptation") ?? {}).filter(([, v]) => v > 0);
          return {
            img: m.img,
            name: `${m.name} (adaptativo)`,
            lines: learned.length
              ? learned.map(([key, percent]) => {
                  const [id, frequency] = key.split("@");
                  const name = id === "none" ? "sem elemento" : elements.find(e => e.id === id)?.label ?? id;
                  return `${name}${Number(frequency) ? ` (freq. ${frequency})` : ""}: ${percent}%`;
                })
              : ["ainda sem adaptação"],
            remaining: "até o Escudo cair"
          };
        });
      const tractorRows = sys.modulesByRole("tractor")
        .filter(m => m.getFlag(SYSTEM_ID, "tractorTarget"))
        .map(m => ({ img: m.img, name: `${m.name} prendendo ${fromUuidSync(m.getFlag(SYSTEM_ID, "tractorTarget"))?.name ?? "?"}`, lines: [], remaining: "enquanto ligado" }));
      if (adaptRows.length || tractorRows.length) sections.push({ title: "Módulos em ação", rows: [...adaptRows, ...tractorRows] });
    } else {
      const shield = actor.system.attributes?.shield;
      if (shield?.value > 0) {
        const lit = actor.getActiveTokens?.().some(t => t.document.getFlag(SYSTEM_ID, "shieldLight"));
        sections.push({
          title: "Escudo pessoal",
          rows: [{ img: "icons/svg/shield.svg", name: `Escudo ${shield.value}`, lines: [describeShieldPools(actor) || "avulso"].concat(lit ? ["com luz no Token"] : []), remaining: "até zerar" }]
        });
      }
      if (actor.system.inventory?.penalty) {
        sections.push({
          title: "Carga",
          rows: [{ img: "icons/svg/anchor.svg", name: "Sobrecarga", lines: [`Deslocamento −${actor.system.inventory.penalty}% (${actor.system.inventory.weight} / ${actor.system.inventory.capacity} kg)`], remaining: "até aliviar o peso" }]
        });
      }
    }

    const sustained = actor.getFlag(SYSTEM_ID, "sustainedShields") ?? [];
    if (sustained.length) {
      sections.push({
        title: "Escudos mantidos",
        button: actor.isOwner || isGM ? { action: "regenShields", label: "Regenerar agora" } : null,
        rows: sustained.map(r => ({
          img: "icons/svg/shield.svg",
          name: `${r.label || "Escudo"} em ${fromUuidSync(r.targetUuid)?.name ?? "?"}`,
          lines: [`+${r.regen} por rodada${r.cap ? `, até ${r.cap}` : ""}`],
          remaining: "enquanto a Skill estiver ligada"
        }))
      });
    }

    const active = collectActiveUpkeepSources(actor);
    if (active.length) {
      sections.push({
        title: "Habilidades Ativas ligadas",
        rows: active.map(s => ({
          img: s.skill.img,
          name: s.label,
          lines: [isShip(actor) ? `${s.upkeepCost} ${energy} reservado(s) do Reator` : `−${s.upkeepCost} ${energy} por rodada`],
          remaining: "até desligar"
        }))
      });
    }

    const structures = [];
    for (const scene of game.scenes) {
      for (const instance of structuresOnScene(scene)) {
        if (instance.sourceActorUuid !== actor.uuid) continue;
        structures.push({
          img: "icons/svg/wall-direction.svg",
          name: instance.label,
          source: scene.name,
          lines: [instance.manaBarrier ? `barreira de ${energy}` : `Vida ${instance.hp}/${instance.hpMax}`],
          remaining: instance.roundsRemaining ? `${instance.roundsRemaining} rodada(s)` : instance.untilDeactivated ? "até desligar a Skill" : "sem prazo"
        });
      }
    }
    if (structures.length) sections.push({ title: "Estruturas mantidas", rows: structures });

    const pending = actor.getFlag(SYSTEM_ID, "pendingUpkeepRemoval") ?? [];
    if (pending.length) {
      sections.push({
        title: "Somem no próximo turno",
        rows: pending.map(p => ({ img: "icons/svg/clockwork.svg", name: actor.items.get(p.skillId)?.name ?? "Skill", lines: [`${energy} chegou a 0: os efeitos desta Skill terminam no início do próximo turno`], remaining: "próximo turno" }))
      });
    }

    context.sections = sections;
    context.isGM = isGM;
    context.actorName = actor.name;
    return context;
  }

  /** Atualiza sozinha quando algo do Ator muda (efeito, Item, Cena das Estruturas). */
  _onRender(context, options) {
    super._onRender(context, options);
    if (this.#hookIds.length) return;
    const actor = this.actor;
    const mine = doc => doc?.uuid === actor.uuid || doc?.parent?.uuid === actor.uuid;
    const refresh = doc => {
      if (mine(doc)) this.render();
    };
    for (const hook of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateItem"]) {
      this.#hookIds.push([hook, Hooks.on(hook, refresh)]);
    }
    this.#hookIds.push(["updateScene", Hooks.on("updateScene", () => this.render())]);
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hookIds) Hooks.off(hook, id);
    this.#hookIds = [];
  }

  static async #onEndEffect(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await this.actor.effects.get(target.dataset.endId)?.delete();
  }

  static async #onEndSystemEffect(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await endShipSystemEffect(this.actor, target.dataset.endId);
  }

  static async #onRegenShields(event) {
    event.preventDefault();
    await runAsGm("regenerateSustainedShields", { actorUuid: this.actor.uuid });
  }
}
