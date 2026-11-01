/**
 * Janela do Gerador de NPC (canvas "Gerador de NPC", prancha 1). À esquerda o que se quer
 * (arquétipo, nível, quantidade, Espécie, Nível de NPC, nomes, pasta); à direita a prévia das
 * fichas sorteadas. Nada é criado até "Criar". Só o Mestre.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveNpcArchetypes, getActiveSpeciesPresets, getAttributeLabel, isFeatureEnabled } from "../core/config.js";
import { draftNpc, draftNpcs, createNpcs, placeNpcTokens, pickCanvasPoint, tierLabel, archetypeBudget } from "../npc/npc-generator.js";
import { NPC_TIERS, NPC_TIER_LABELS } from "../npc/npc-generator-rules.js";
import { reportError } from "../helpers/report.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Há chave de IA neste navegador? (A configuração da IA é por navegador.) */
function aiConfigured() {
  try {
    return Boolean(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiApiKey));
  } catch (err) {
    return false;
  }
}

/** Abreviação curta dos atributos nas barras do card. */
const SHORT = { magicalDefense: "Def. Mágica" };

export class NpcGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-npc-generator",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-npc-generator"],
    window: { title: "Gerador de NPC", icon: "fa-solid fa-users", resizable: true },
    position: { width: 1180, height: 760 },
    actions: {
      pickArchetype: NpcGeneratorApp.#onPickArchetype,
      pickTier: NpcGeneratorApp.#onPickTier,
      pickNames: NpcGeneratorApp.#onPickNames,
      reroll: NpcGeneratorApp.#onReroll,
      rerollAll: NpcGeneratorApp.#onRerollAll,
      removeDraft: NpcGeneratorApp.#onRemoveDraft,
      describeAI: NpcGeneratorApp.#onDescribeAI,
      create: NpcGeneratorApp.#onCreate
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/npc-generator.hbs`, scrollable: [".ng-left", ".ng-cards"] }
  };

  constructor(options = {}) {
    super(options);
    const archetypes = getActiveNpcArchetypes();
    this.opts = {
      archetypeId: archetypes[0]?.id ?? "",
      level: 1,
      count: 3,
      species: "",
      vary: true,
      tier: "normal",
      names: "random",
      folder: "NPCs gerados",
      place: false
    };
    this.drafts = [];
    this.busy = false;
    this.#regenerate();
  }

  get archetype() {
    return getActiveNpcArchetypes().find(a => a.id === this.opts.archetypeId) ?? null;
  }

  #regenerate() {
    const archetype = this.archetype;
    this.drafts = archetype ? draftNpcs(archetype, this.opts) : [];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const archetypes = getActiveNpcArchetypes();
    const groupLabels = MEU_SISTEMA.NPC_ARCHETYPE_GROUP_LABELS;
    const defaults = new Set(MEU_SISTEMA.DEFAULT_NPC_ARCHETYPES.map(a => a.id));
    const groups = {};
    for (const a of archetypes) {
      const key = groupLabels[a.group] ? a.group : "";
      (groups[key] ??= { label: groupLabels[key] ?? "Outros", tiles: [] }).tiles.push({ id: a.id, label: a.label, img: a.img, active: a.id === this.opts.archetypeId, mine: !defaults.has(a.id) });
    }
    const order = [...Object.keys(groupLabels), ""];
    context.groups = Object.entries(groups).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([, g]) => g);

    const archetype = this.archetype;
    const species = getActiveSpeciesPresets();
    context.opts = this.opts;
    context.speciesOptions = [
      { id: "", label: archetype?.species?.length ? "Sorteada (as do arquétipo)" : "Sorteada (qualquer)", selected: !this.opts.species },
      ...Object.entries(species)
        .filter(([, s]) => s.availableAtCreation !== false)
        .map(([id, s]) => ({ id, label: s.label || id, selected: id === this.opts.species }))
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
    context.tiersEnabled = isFeatureEnabled("npcTiers");
    context.tiers = NPC_TIERS.map(id => ({ id, label: NPC_TIER_LABELS[id], active: id === this.opts.tier }));
    context.namesRandom = this.opts.names !== "numbered";
    context.numberedLabel = `Numerados (${archetype?.label ?? "NPC"} 1, 2…)`;
    context.canPlace = Boolean(canvas?.ready && canvas.scene);
    context.aiAvailable = aiConfigured();
    context.busy = this.busy;

    if (archetype) {
      const skillRange = archetype.skillsMax > 0 ? `${archetype.skillsMin === archetype.skillsMax ? archetype.skillsMax : `${archetype.skillsMin} a ${archetype.skillsMax}`} da lista do ${archetype.label}` : "nenhuma";
      context.summary = `${archetype.label} · nível ${this.opts.level}${this.opts.vary ? " (±1)" : ""} · ${archetypeBudget(archetype, this.opts.level)} pontos de atributo${archetype.pointsPercent === 100 ? ", os mesmos de um PJ do nível" : ` (${archetype.pointsPercent}% dos de um PJ)`} · Skills sorteadas: ${skillRange}`;
      const favored = new Set(Object.entries(archetype.weights).filter(([, w]) => w >= 2).map(([k]) => k));
      context.favoredHint = favored.size ? `Os atributos em dourado são os que o ${archetype.label} favorece.` : "";
      context.cards = this.drafts.map((d, index) => {
        const top = Math.max(1, ...Object.values(d.points));
        return {
          index,
          name: d.name,
          img: archetype.img,
          meta: [d.speciesLabel, `Nv ${d.level}`, archetype.label, tierLabel(d.tier)].filter(Boolean).join(" · "),
          hp: d.vitals.hp,
          mp: d.vitals.mp,
          attrs: MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => ({
            label: SHORT[key] ?? getAttributeLabel(key),
            value: d.points[key] ?? 0,
            width: `${Math.round(((d.points[key] ?? 0) / top) * 100)}%`,
            favored: favored.has(key)
          })),
          skills: archetype.skills.filter(s => d.skillKeys.includes(s.key)).map(s => s.name),
          items: archetype.items.filter(i => d.itemKeys.includes(i.key)).map(i => i.name),
          described: Boolean(d.biography || d.personality)
        };
      });
    } else {
      context.cards = [];
    }
    context.createLabel = `Criar ${this.drafts.length} ficha${this.drafts.length === 1 ? "" : "s"}`;
    context.canCreate = this.drafts.length > 0 && !this.busy;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelector(".ng-search")?.addEventListener("input", event => {
      const q = event.currentTarget.value.trim().toLowerCase();
      root.querySelectorAll(".ng-tile").forEach(t => t.classList.toggle("hidden", Boolean(q) && !t.dataset.label.toLowerCase().includes(q)));
      root.querySelectorAll(".ng-group").forEach(g => g.classList.toggle("hidden", ![...g.querySelectorAll(".ng-tile")].some(t => !t.classList.contains("hidden"))));
    });
    // Campos que mudam o sorteio: sorteia de novo. Pasta e "pôr no mapa" só guardam.
    root.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("change", () => {
        const field = el.dataset.field;
        let value = el.type === "checkbox" ? el.checked : el.value;
        if (field === "level") value = Math.max(1, Math.round(Number(value) || 1));
        if (field === "count") value = Math.min(30, Math.max(1, Math.round(Number(value) || 1)));
        this.opts[field] = value;
        if (["level", "count", "species", "vary"].includes(field)) {
          this.#regenerate();
          this.render();
        }
      })
    );
    root.querySelectorAll("[data-draft-name]").forEach(el =>
      el.addEventListener("change", () => {
        const draft = this.drafts[Number(el.dataset.draftName)];
        if (draft) draft.name = el.value.trim() || draft.name;
      })
    );
  }

  static #onPickArchetype(event, target) {
    this.opts.archetypeId = target.dataset.id;
    this.opts.species = "";
    this.#regenerate();
    this.render();
  }

  static #onPickTier(event, target) {
    this.opts.tier = target.dataset.tier;
    this.#regenerate();
    this.render();
  }

  static #onPickNames(event, target) {
    this.opts.names = target.dataset.names;
    this.#regenerate();
    this.render();
  }

  static #onReroll(event, target) {
    const index = Number(target.dataset.index);
    const archetype = this.archetype;
    if (!archetype || !this.drafts[index]) return;
    this.drafts[index] = draftNpc(archetype, { ...this.opts, index });
    this.render();
  }

  static #onRerollAll() {
    this.#regenerate();
    this.render();
  }

  static #onRemoveDraft(event, target) {
    this.drafts.splice(Number(target.dataset.index), 1);
    this.render();
  }

  /** Só escreve aparência e personalidade; o resto da ficha já está pronto. */
  static async #onDescribeAI() {
    const archetype = this.archetype;
    if (!archetype || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const { describeNpcWithAI } = await import("../ai/ai-generation.js");
      for (const draft of this.drafts) {
        const text = await describeNpcWithAI(draft, archetype);
        draft.biography = text.biography;
        draft.personality = text.personality;
      }
      ui.notifications.info("Aparência e personalidade escritas. Elas vão para a Biografia de cada ficha.");
    } catch (err) {
      reportError("O Assistente de IA falhou.", err);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  static async #onCreate() {
    if (!this.drafts.length || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const actors = await createNpcs(this.drafts, { folder: this.opts.folder });
      if (!actors.length) return;
      ui.notifications.info(`${actors.length} ficha(s) criada(s)${this.opts.folder ? ` em "${this.opts.folder}"` : ""}.`);
      if (this.opts.place && canvas?.ready && canvas.scene) {
        this.minimize();
        const point = await pickCanvasPoint();
        if (point) await placeNpcTokens(actors, point);
        this.maximize();
      }
      this.#regenerate();
    } catch (err) {
      reportError("Não deu para criar os NPCs.", err);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

/** Abre o gerador (só o Mestre, com o bloco ligado). */
export function openNpcGenerator() {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre gera NPCs.");
  if (!isFeatureEnabled("npcGenerator")) return ui.notifications.warn("O Gerador de NPC está desligado em Módulos do Sistema.");
  const existing = foundry.applications.instances.get("nihility-npc-generator");
  if (existing) return existing.render({ force: true });
  return new NpcGeneratorApp().render({ force: true });
}
