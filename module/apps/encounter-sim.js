/**
 * Janela do Simulador de encontro (canvas "Simulador de Encontro", pranchas 1 e 2): grupo contra
 * oponentes, o veredito numa frase com a sugestão de ajuste, a tabela "aguenta N golpes de X /
 * cai em ~N rodadas / Mana" e, ao clicar num número, a conta inteira. Só o Mestre. Nada é rolado
 * nem gravado; NPCs de Arquétipo e da prévia do Gerador entram como Atores temporários.
 */
import { SYSTEM_ID, isFeatureEnabled, getNpcTierConfig, getActiveNpcArchetypes } from "../core/config.js";
import { evaluateEncounter, suggestAdjustment, roundsToDropEach, hitsToDrop, roundsText, VERDICT_LABELS, VERDICTS } from "../combat/encounter-rules.js";
import { unitFor, buildSides, displayHp, canSimulate, temporaryActorFromDraft } from "../combat/encounter-sim.js";
import { NPC_TIERS, NPC_TIER_LABELS } from "../npc/npc-generator-rules.js";
import { getDragEventData } from "../helpers/foundry-compat.js";
import { escapeHtml } from "../helpers/html.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let keySeq = 0;
const newKey = () => `u${++keySeq}`;

/** PJs dos jogadores (fichas de Personagem marcadas PJ com um jogador dono). */
function playerCharacters() {
  return game.actors.filter(a => a.type === "character" && a.system.isPlayerCharacter && a.hasPlayerOwner);
}

export class EncounterSimApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-encounter-sim",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-encounter-sim"],
    window: { title: "Simulador de Encontro", icon: "fa-solid fa-scale-unbalanced", resizable: true },
    position: { width: 1100, height: 820 },
    actions: {
      addSelected: EncounterSimApp.#onAddSelected,
      addFoe: EncounterSimApp.#onAddFoe,
      remove: EncounterSimApp.#onRemove,
      count: EncounterSimApp.#onCount,
      detail: EncounterSimApp.#onDetail,
      closeDetail: EncounterSimApp.#onCloseDetail
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/encounter-sim.hbs`, scrollable: [".es-body"] }
  };

  /**
   * @param {{allies?: Actor[], foes?: Array<{actor: Actor, count?: number, tier?: string}>}} [setup]
   */
  constructor(setup = {}, options = {}) {
    super(options);
    this.allies = (setup.allies ?? playerCharacters()).filter(canSimulate).map(actor => ({ key: newKey(), actor }));
    this.foes = (setup.foes ?? []).filter(f => canSimulate(f.actor)).map(f => ({ key: newKey(), actor: f.actor, count: f.count ?? 1, tier: f.tier ?? null }));
    this.choices = {};
    this.areaTargets = {};
    this.detail = null;
  }

  #units() {
    const allies = this.allies.map(a => unitFor(a.actor, { key: a.key }));
    const foes = this.foes.map(f => unitFor(f.actor, { key: f.key, count: f.count, tier: f.tier, npc: !f.actor.system?.isPlayerCharacter }));
    return { allies, foes };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tiersCfg = getNpcTierConfig();
    const tiers = { elite: tiersCfg.eliteHp, boss: tiersCfg.bossHp };
    const sides = buildSides(this.#units(), { choices: this.choices, areaTargets: this.areaTargets });
    const describeUnit = (unit, isFoe) => ({
      key: unit.key,
      name: unit.name,
      img: unit.actor.img,
      level: unit.actor.system?.attributes?.level ?? 1,
      hp: displayHp(unit),
      shield: unit.shield,
      hpText: unit.shield ? `${displayHp(unit) - unit.shield} + Escudo ${unit.shield}` : String(displayHp(unit)),
      count: unit.count ?? 1,
      isFoe,
      tierOptions: isFoe && unit.npc && tiersCfg.enabled ? NPC_TIERS.map(id => ({ id, label: NPC_TIER_LABELS[id], selected: (unit.tier || "normal") === id })) : null,
      attackOptions: unit.options.map(o => ({ id: o.id, label: `${o.label}${o.area ? " (área)" : ""}`, selected: o.id === unit.chosenId })),
      hasAttack: Boolean(unit.attack),
      isArea: Boolean(unit.options.find(o => o.id === unit.chosenId)?.area),
      areaTargets: unit.attack?.targets ?? 1,
      chosenId: unit.chosenId
    });
    context.allies = sides.allies.map(u => describeUnit(u, false));
    context.foes = sides.foes.map(u => describeUnit(u, true));
    context.ready = sides.allies.length > 0 && sides.foes.length > 0;
    context.enabled = isFeatureEnabled("encounterSim");

    if (context.ready) {
      const result = evaluateEncounter(sides, tiers);
      const suggestion = suggestAdjustment(sides, tiers);
      context.verdict = {
        id: result.verdict,
        label: VERDICT_LABELS[result.verdict].toUpperCase(),
        text: verdictSentence(result),
        suggestion: suggestion ? `Para ficar justo: ${suggestion.text}.` : "",
        scale: VERDICTS.map(v => ({ id: v, label: VERDICT_LABELS[v], on: v === result.verdict }))
      };
      const row = (unit, enemies, isFoe) => {
        const hp = displayHp(unit);
        const cells = enemies
          .filter(e => e.attack)
          .map(e => {
            const dmg = e.attack.perTarget[unit.key] ?? 0;
            const hits = hitsToDrop(hp, dmg);
            return { attacker: e.key, target: unit.key, text: Number.isFinite(hits) ? `${hits} golpe${hits === 1 ? "" : "s"} de ${e.name}` : `${e.name} não passa`, danger: !isFoe && hits <= 2 };
          });
        const drop = roundsToDropEach(enemies, [unit], tiers)[0];
        const uses = unit.attack?.uses;
        return {
          name: unit.name,
          note: isFoe && (unit.count ?? 1) > 1 ? "(cada)" : unit.npc && unit.tier && unit.tier !== "normal" ? `(${NPC_TIER_LABELS[unit.tier]})` : "",
          hpText: unit.shield ? `${hp - unit.shield} + ${unit.shield}` : String(hp),
          cells,
          danger: cells.some(c => c.danger),
          drop: drop && Number.isFinite(drop.rounds) ? (drop.rounds <= 1 ? "≤ 1 rodada" : `~${drop.rounds} rodadas`) : "não cai",
          dropDanger: !isFoe && drop?.rounds <= 1,
          mana: !unit.attack ? "sem ataque de dano" : Number.isFinite(uses) ? `${uses} uso${uses === 1 ? "" : "s"} de ${unit.attack.label}` : "sobra"
        };
      };
      context.rowsAllies = sides.allies.map(u => row(u, sides.foes, false));
      context.rowsFoes = sides.foes.map(u => row(u, sides.allies, true));

      if (this.detail) {
        const attacker = [...sides.allies, ...sides.foes].find(u => u.key === this.detail.attacker);
        const target = [...sides.allies, ...sides.foes].find(u => u.key === this.detail.target);
        const option = attacker?.options.find(o => o.id === attacker.chosenId);
        if (attacker && target && option) {
          const breakdown = sides.hit(attacker, option, target);
          const hp = displayHp(target);
          const hits = hitsToDrop(hp, breakdown.damage);
          context.detail = {
            title: `${attacker.name} → ${target.name} · ${option.label}${option.area ? ` (área, até ${attacker.attack.targets} alvos)` : ""}`,
            rows: breakdown.rows,
            hpText: target.shield ? `Escudo ${target.shield} (gasta primeiro) + Vida ${hp - target.shield}` : `Vida ${hp}`,
            hits: Number.isFinite(hits) ? `${hits} golpe${hits === 1 ? "" : "s"}` : "não derruba",
            foot: Number.isFinite(hits) && breakdown.damage > 0 ? `${hp} ÷ ${breakdown.damage} = ${(hp / breakdown.damage).toFixed(1).replace(".", ",")} → cai no ${hits}º.` : "O golpe não passa pelas defesas."
          };
        }
      }
    }
    context.archetypes = getActiveNpcArchetypes().map(a => ({ id: a.id, label: a.label }));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelectorAll("[data-attack-for]").forEach(sel =>
      sel.addEventListener("change", () => {
        this.choices[sel.dataset.attackFor] = sel.value;
        this.render();
      })
    );
    root.querySelectorAll("[data-area-for]").forEach(input =>
      input.addEventListener("change", () => {
        this.areaTargets[`${input.dataset.areaFor}|${input.dataset.areaOption}`] = Math.max(1, Math.round(Number(input.value) || 1));
        this.render();
      })
    );
    root.querySelectorAll("[data-tier-for]").forEach(sel =>
      sel.addEventListener("change", () => {
        const foe = this.foes.find(f => f.key === sel.dataset.tierFor);
        if (foe) foe.tier = sel.value;
        this.render();
      })
    );
    // A conta aberta (clique num número) vem para a vista.
    if (this.detail) root.querySelector(".es-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Arrastar uma ficha do Diretório para um dos lados.
    root.querySelectorAll("[data-drop-side]").forEach(zone => {
      zone.addEventListener("dragover", event => event.preventDefault());
      zone.addEventListener("drop", async event => {
        event.preventDefault();
        const data = getDragEventData(event);
        if (data?.type !== "Actor" || !data.uuid) return;
        const actor = await fromUuid(data.uuid);
        if (!canSimulate(actor)) return ui.notifications.warn("O simulador só conta Personagens (Nave e Veículo ficam de fora por enquanto).");
        if (zone.dataset.dropSide === "allies") this.allies.push({ key: newKey(), actor });
        else this.foes.push({ key: newKey(), actor, count: 1, tier: null });
        this.render();
      });
    });
  }

  static #onAddSelected() {
    const actors = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(canSimulate);
    if (!actors.length) return ui.notifications.info("Selecione Tokens de Personagem no mapa.");
    for (const actor of actors) if (!this.allies.some(a => a.actor === actor)) this.allies.push({ key: newKey(), actor });
    this.render();
  }

  /** "+ Ficha / arquétipo": uma ficha de NPC do mundo, ou um NPC de Arquétipo (temporário). */
  static async #onAddFoe() {
    const npcs = game.actors.filter(a => a.type === "character" && !a.system.isPlayerCharacter).sort((a, b) => a.name.localeCompare(b.name));
    const archetypes = getActiveNpcArchetypes();
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Adicionar oponente" },
      classes: ["nihility-encounter-add"],
      content: `<div class="es-add">
        <label>Quem <select name="pick">
          ${npcs.length ? `<optgroup label="Fichas de NPC">${npcs.map(a => `<option value="actor:${escapeHtml(a.uuid)}">${escapeHtml(a.name)}</option>`).join("")}</optgroup>` : ""}
          <optgroup label="Arquétipos (sem criar ficha)">${archetypes.map(a => `<option value="arch:${escapeHtml(a.id)}">${escapeHtml(a.label)}</option>`).join("")}</optgroup>
        </select></label>
        <label>Nível (arquétipo) <input type="number" name="level" value="${Math.max(1, ...playerCharacters().map(a => a.system.attributes.level ?? 1))}" min="1"></label>
        <label>Quantos <input type="number" name="count" value="1" min="1" max="30"></label>
      </div>`,
      buttons: [
        { action: "add", label: "Adicionar", default: true, callback: (event, button, dialog) => ({ pick: dialog.element.querySelector("[name=pick]").value, level: Number(dialog.element.querySelector("[name=level]").value) || 1, count: Number(dialog.element.querySelector("[name=count]").value) || 1 }) },
        { action: "cancel", label: "Cancelar", callback: () => false }
      ],
      rejectClose: false
    });
    if (!result || typeof result !== "object") return;
    let actor = null;
    if (result.pick.startsWith("actor:")) actor = await fromUuid(result.pick.slice(6));
    else {
      const archetype = archetypes.find(a => a.id === result.pick.slice(5));
      if (!archetype) return;
      const { draftNpc } = await import("../npc/npc-generator.js");
      const draft = draftNpc(archetype, { level: result.level, vary: false, species: "", tier: "normal", names: "numbered", index: 0 });
      draft.name = archetype.label;
      actor = await temporaryActorFromDraft(draft);
    }
    if (!canSimulate(actor)) return;
    this.foes.push({ key: newKey(), actor, count: Math.min(30, Math.max(1, Math.round(result.count))), tier: null });
    this.render();
  }

  static #onRemove(event, target) {
    const key = target.dataset.key;
    this.allies = this.allies.filter(a => a.key !== key);
    this.foes = this.foes.filter(f => f.key !== key);
    if (this.detail && (this.detail.attacker === key || this.detail.target === key)) this.detail = null;
    this.render();
  }

  static #onCount(event, target) {
    const foe = this.foes.find(f => f.key === target.dataset.key);
    if (!foe) return;
    foe.count = Math.min(30, Math.max(0, (foe.count ?? 1) + Number(target.dataset.step)));
    this.render();
  }

  static #onDetail(event, target) {
    this.detail = { attacker: target.dataset.attacker, target: target.dataset.target };
    this.render();
  }

  static #onCloseDetail() {
    this.detail = null;
    this.render();
  }
}

/** A frase do veredito (prancha 1). */
function verdictSentence(r) {
  const weakest = r.weakest?.name ?? "o mais frágil";
  switch (r.verdict) {
    case "easy":
      return `O grupo vence em ${roundsText(r.win)}, antes de qualquer um poder cair.`;
    case "fair":
      return `O grupo vence em ${roundsText(r.win)}; ${weakest} cairia em ${roundsText(r.dropFirst)} se todos fossem nele.`;
    case "dangerous":
      return Number.isFinite(r.win)
        ? `O grupo vence em ${roundsText(r.win)}, mas ${weakest} cai em ${roundsText(r.dropFirst)} se os oponentes forem nele.`
        : `O grupo não consegue derrubar os oponentes com os ataques escolhidos.`;
    default:
      return `Os oponentes derrubam o grupo inteiro em ${roundsText(r.wipe)}, antes de o grupo vencer (${roundsText(r.win)}).`;
  }
}

/**
 * Abre o simulador (só o Mestre, com o bloco ligado).
 * @param {{allies?: Actor[], foes?: Array<{actor: Actor, count?: number, tier?: string}>}} [setup]
 */
export function openEncounterSim(setup = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre usa o Simulador de encontro.");
  if (!isFeatureEnabled("encounterSim")) return ui.notifications.warn("O Simulador de encontro está desligado em Módulos do Sistema.");
  foundry.applications.instances.get("nihility-encounter-sim")?.close();
  return new EncounterSimApp(setup).render({ force: true });
}

/** A partir de um combate: PJs (e Tokens amistosos) de um lado, o resto do outro. */
export function openEncounterSimFromCombat(combat) {
  const allies = [];
  const foes = new Map();
  for (const c of combat?.combatants ?? []) {
    const actor = c.actor;
    if (!canSimulate(actor)) continue;
    const friendly = actor.hasPlayerOwner || c.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    if (friendly) {
      if (!allies.includes(actor)) allies.push(actor);
    } else {
      // Tokens não vinculados da mesma ficha viram uma linha com quantidade.
      const id = actor.isToken ? actor.parent?.baseActor?.id ?? actor.id : actor.id;
      const entry = foes.get(id) ?? { actor, count: 0 };
      entry.count += 1;
      foes.set(id, entry);
    }
  }
  return openEncounterSim({ allies, foes: [...foes.values()] });
}

/** A partir da prévia do Gerador de NPC: os rascunhos viram oponentes temporários. */
export async function openEncounterSimFromDrafts(drafts) {
  const foes = [];
  for (const draft of drafts) foes.push({ actor: await temporaryActorFromDraft(draft), count: 1 });
  return openEncounterSim({ foes });
}

/** Botão "Simular" no rastreador de combate (só o Mestre). */
export function registerEncounterSimTracker() {
  Hooks.on("renderCombatTracker", (app, html) => {
    if (!game.user.isGM || !isFeatureEnabled("encounterSim")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !(app.viewed ?? game.combat) || root.querySelector(".nihility-sim-btn")) return;
    const host = root.querySelector(".encounter-controls, .combat-tracker-header, header");
    if (!host) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nihility-sim-btn";
    button.title = "Simular este combate: quantos golpes cada um aguenta e se está fácil, justo ou mortal.";
    button.innerHTML = `<i class="fa-solid fa-scale-unbalanced"></i> Simular`;
    button.addEventListener("click", event => {
      event.preventDefault();
      // O combate à mostra NA HORA do clique (o rastreador pode ter trocado de combate).
      const combat = ui.combat?.viewed ?? game.combat;
      if (combat) openEncounterSimFromCombat(combat);
    });
    host.append(button);
  });
}

