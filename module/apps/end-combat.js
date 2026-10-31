import { SYSTEM_ID, getFeatureOption, isFeatureEnabled, getXpForNextLevel, getHealingRules, isEnergyPoolEnabled, getCharacterEnergyLabel } from "../core/config.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { badgeFor } from "../combat/effect-badges.js";
import { countsAsNpc, isDead } from "../combat/incapacitation.js";
import { applyShortRest } from "../combat/regeneration.js";
import { suggestCombatXp, splitXp, endCombatEffectChoice } from "../combat/end-combat-rules.js";
import { reportError } from "../helpers/report.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Fim do combate (backlog L11 + H11; mockup aprovado "Fim do Combate", quadro 1). Abre para o
 * Mestre que encerrou o combate pelo próprio Foundry (opção A do quadro 2): efeitos com prazo em
 * rodadas que ficariam congelados (marcados = removidos), XP do combate (sugestão pelos NPCs
 * derrotados, dividida entre os PJs, cada parte editável) e Descanso curto para os PJs.
 * "Pular" fecha sem fazer nada. Regras puras em combat/end-combat-rules.js.
 *
 * Os dados são lidos do combate no `deleteCombat` (os combatentes ainda estão no documento
 * apagado) e guardados aqui; depois disso só se mexe nos Atores, por uuid.
 */
export class EndCombatApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-end-combat",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-end-combat"],
    window: { title: "Fim do combate", icon: "fa-solid fa-flag-checkered", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      skip: EndCombatApp.#onSkip,
      finish: EndCombatApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/end-combat.hbs`, scrollable: [".ec-body"] }
  };

  constructor(summary, options = {}) {
    super(options);
    this.summary = summary;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rules = getHealingRules();
    const rest = [`+${rules.shortHpPercent}% Vida`];
    if (isEnergyPoolEnabled()) rest.push(`+${rules.shortEnergyPercent}% ${getCharacterEnergyLabel()}`);
    return Object.assign(context, this.summary, { restLabel: rest.join(", ") });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Mudar o total redivide entre os PJs; mudar a parte de um não mexe nas outras.
    this.element.querySelector("[name=xpTotal]")?.addEventListener("input", event => {
      const inputs = [...this.element.querySelectorAll("[data-xp-uuid]")];
      splitXp(event.currentTarget.value, inputs.length).forEach((value, i) => {
        inputs[i].value = value;
      });
    });
  }

  static #onSkip() {
    this.close();
  }

  static async #onFinish() {
    const root = this.element;

    // 1. Efeitos marcados saem.
    const byActor = new Map();
    for (const box of root.querySelectorAll("[data-effect-id]:checked")) {
      const list = byActor.get(box.dataset.actorUuid) ?? [];
      list.push(box.dataset.effectId);
      byActor.set(box.dataset.actorUuid, list);
    }
    for (const [uuid, ids] of byActor) {
      const actor = fromUuidSync(uuid);
      const existing = ids.filter(id => actor?.effects?.get(id));
      if (existing.length) await actor.deleteEmbeddedDocuments("ActiveEffect", existing);
    }

    // 2. XP de cada PJ, avisada pela Voz do Mundo (quem encher a barra recebe o aviso normal).
    for (const input of root.querySelectorAll("[data-xp-uuid]")) {
      const amount = Math.max(0, Math.floor(Number(input.value) || 0));
      const actor = fromUuidSync(input.dataset.xpUuid);
      if (!amount || !actor) continue;
      await actor.update({ "system.attributes.xp": (Number(actor.system.attributes.xp) || 0) + amount });
      await announceVoiceOfTheWorld(actor, { kind: "xp-gain", title: "Experiência", body: `${actor.name} ganhou ${amount} XP no combate.` });
    }

    // 3. Descanso curto para todos os PJs.
    if (root.querySelector("[name=shortRest]")?.checked) {
      for (const pc of this.summary.pcs) {
        const actor = fromUuidSync(pc.uuid);
        if (actor) await applyShortRest(actor);
      }
    }
    this.close();
  }
}

/** Texto da sugestão: "Goblin ×3 nv 4 (100 cada)". */
function describeDefeated(defeated, xpEach) {
  const groups = new Map();
  for (const d of defeated) {
    const key = `${d.name}|${d.level}`;
    const g = groups.get(key) ?? { name: d.name, level: d.level, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map(g => `${g.count > 1 ? `${g.name} ×${g.count}` : g.name} nv ${g.level} (${xpEach(g.level)} cada)`).join(" · ");
}

function effectLabel(effect, badge) {
  if (badge.tone === "danger") return `${badge.text} rodada(s)`;
  return effect.getFlag(SYSTEM_ID, "periodic") ? `${badge.text} tick(s)` : `${badge.text} rodada(s)`;
}

/** Lê o combate encerrado e monta o que a janela mostra. Nada para mostrar → null. */
export function summarizeCombat(combat) {
  const percent = getFeatureOption("endOfCombat", "combatXpPercent") ?? 25;
  const xpEach = level => Math.round(getXpForNextLevel(level) * (Math.max(0, Number(percent) || 0) / 100));
  const seen = new Set();
  const pcs = [];
  const defeated = [];
  const effectGroups = [];

  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const name = combatant.token?.name || combatant.name || actor.name;
    const npc = countsAsNpc(actor);
    const dead = combatant.defeated || isDead(actor);

    if (npc && dead) {
      defeated.push({ name, level: Math.max(1, Number(actor.system.attributes?.level) || 1) });
      continue;
    }
    if (!npc) pcs.push({ uuid: actor.uuid, name });
    if (dead) continue;

    const rows = [];
    for (const effect of actor.effects) {
      const badge = badgeFor(effect, { combat });
      const choice = endCombatEffectChoice(badge);
      if (!choice.listed) continue;
      rows.push({ id: effect.id, name: effect.name, label: effectLabel(effect, badge), tone: badge.tone, checked: choice.checked, danger: badge.tone === "danger" });
    }
    if (rows.length) effectGroups.push({ actorUuid: actor.uuid, name, rows });
  }

  const total = suggestCombatXp(defeated.map(d => d.level), { xpFor: getXpForNextLevel, percent });
  const parts = splitXp(total, pcs.length);
  pcs.forEach((pc, i) => {
    pc.xp = parts[i];
  });
  if (!effectGroups.length && !pcs.length) return null;
  return {
    round: combat.round ?? 0,
    effectGroups,
    pcs,
    xpTotal: total,
    suggestion: defeated.length ? describeDefeated(defeated, xpEach) : "",
    hasPcs: pcs.length > 0
  };
}

/** Abre a janela para o Mestre que encerrou um combate que chegou a começar. */
export function registerEndCombat() {
  Hooks.on("deleteCombat", (combat, options, userId) => {
    if (userId !== game.user.id || !game.user.isGM || !isFeatureEnabled("endOfCombat")) return;
    if (!(Number(combat.round) > 0)) return;
    try {
      const summary = summarizeCombat(combat);
      if (summary) new EndCombatApp(summary).render({ force: true });
    } catch (err) {
      reportError("Falha ao abrir o Fim do combate.", err, { gmOnly: true });
    }
  });
}
