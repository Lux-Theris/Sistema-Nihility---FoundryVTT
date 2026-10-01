/**
 * Janela "De onde vem": explica um Atributo de combate ou a Vida/Mana máxima de um Personagem,
 * parcela por parcela, com a fonte de cada uma e o que cada bloco afeta (Vida/Mana, rolagem,
 * Pool de d20). Aberta pelo botão ⓘ na ficha — visível para quem vê a ficha, porque são as
 * fontes do próprio personagem (as defesas de um ALVO continuam escondidas: ver o rastro de dano,
 * só do Mestre, em damage-apply.js).
 *
 * Só lê. As contas vêm de stat-explain.js (puro) sobre as mesmas listas que a preparação da ficha
 * soma (titleBonusSources/itemAttributeSources/statModifierSources em character-model.js).
 */
import { SYSTEM_ID, MEU_SISTEMA, getAttributeLabel, getVitalFormula, getEnergyLabelForActor, isMovementEnabled, describeMovement } from "../config.js";
import { readEffectChanges, effectModes } from "../helpers/foundry-compat.js";
import { titleBonusSources, itemAttributeSources, statModifierSources } from "../data/character-model.js";
import { conditionalModifierSources, buildModifierContext } from "../conditional-context.js";
import { sumConditionalModifiers } from "../conditional-modifiers.js";
import { explainAttribute, explainVital } from "../stat-explain.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KIND_LABELS = { points: "Pontos", title: "Título", skill: "Skill", item: "Item", mod: "Modificação", effect: "Efeito", conditional: "Quando → Então" };

function appId(actor, stat) {
  return `nihility-breakdown-${stat}-${actor.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

const signed = value => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

/** Parcelas de Active Effects que somam (ADD) num campo; MULTIPLY/OVERRIDE ficam no "não identificado". */
function effectSources(actor, key) {
  const M = effectModes();
  const effects = actor.appliedEffects ?? actor.effects.filter(e => !e.disabled);
  const list = [];
  for (const effect of effects) {
    let value = 0;
    for (const change of readEffectChanges(effect)) {
      if (change.key === key && change.mode === M.ADD) value += Number(change.value) || 0;
    }
    if (!value) continue;
    let from = "";
    try {
      from = effect.origin ? fromUuidSync(effect.origin)?.name ?? "" : "";
    } catch (err) {
      from = "";
    }
    list.push({ label: effect.name, detail: from && from !== effect.name ? `de ${from}` : "", value, kind: "effect" });
  }
  return list;
}

/** "Quando → Então" contínuos (attributeFlat) que valem AGORA, por Item de origem. */
function conditionalSources(actor, key) {
  const hp = actor.system.attributes.hp;
  const ctx = buildModifierContext(actor, null, { hpPercent: hp.max > 0 ? (hp.value / hp.max) * 100 : 0 });
  const list = [];
  for (const { item, mods } of conditionalModifierSources(actor)) {
    const value = sumConditionalModifiers(mods, "attributeFlat", ctx, { attribute: key });
    if (value) list.push({ label: item.name, value, uuid: item.uuid, kind: "conditional" });
  }
  return list;
}

/** Linha pronta para o template. */
function row(source) {
  return {
    label: source.label,
    detail: source.detail || "",
    kind: source.unknown ? "?" : KIND_LABELS[source.kind] ?? "",
    value: signed(source.value),
    uuid: source.uuid || "",
    unknown: Boolean(source.unknown)
  };
}

export class StatBreakdownApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #hookIds = [];

  constructor(actor, stat, options = {}) {
    super({ id: appId(actor, stat), ...options });
    this.actor = actor;
    this.stat = stat;
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-stat-breakdown"],
    window: { title: "De onde vem", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      openSource: StatBreakdownApp.#onOpenSource
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/stat-breakdown.hbs`, scrollable: [".sb-body"] }
  };

  /** Abre (ou traz pra frente) a janela deste Ator e deste valor. */
  static open(actor, stat) {
    const existing = foundry.applications.instances?.get(appId(actor, stat));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new StatBreakdownApp(actor, stat).render({ force: true });
  }

  get title() {
    return `${this.#statLabel()} — ${this.actor.name}`;
  }

  #statLabel() {
    if (this.stat === "hp") return "Vida máxima";
    if (this.stat === "energy") return `${getEnergyLabelForActor(this.actor)} máxima`;
    return getAttributeLabel(this.stat);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.statLabel = this.#statLabel();
    context.sections = this.stat === "hp" || this.stat === "energy" ? this.#vitalSections() : this.#attributeSections();
    return context;
  }

  #attributeSections() {
    const actor = this.actor;
    const key = this.stat;
    const attr = actor.system.attributes.combat[key];
    const ex = explainAttribute({
      points: attr.points,
      pending: attr.pendingPoints,
      titles: titleBonusSources(actor, key),
      buffs: effectSources(actor, `system.attributes.combat.${key}.buffDelta`),
      buffActual: attr.buffDelta || 0,
      conditionals: conditionalSources(actor, key),
      items: itemAttributeSources(actor, key)
    });

    const formula = getVitalFormula();
    const energy = getEnergyLabelForActor(actor);
    const usedIn = [];
    if (formula.hp.includes(key)) usedIn.push("a fórmula da Vida máxima");
    if (formula.energyEnabled && formula.energy.includes(key)) usedIn.push(`a fórmula da ${energy} máxima`);

    const sections = [
      {
        title: "Base permanente",
        hint: usedIn.length
          ? `Pontos e Títulos. É o único valor que entra em ${usedIn.join(" e ")}.`
          : "Pontos e Títulos. É a base de tudo o que vem abaixo.",
        rows: ex.permanent.map(row),
        result: { label: "Total", value: ex.total }
      }
    ];
    if (ex.temporary.length) {
      sections.push({
        title: "Temporário",
        hint: "Efeitos de Skills e regras \"Quando → Então\" valendo agora. Mudam a rolagem, nunca a Vida/Mana.",
        rows: ex.temporary.map(row),
        result: { label: "Efetivo", value: ex.effectiveTotal }
      });
    }
    sections.push({
      title: "Rolagem",
      hint: "Bônus = Efetivo ÷ 3, arredondado para baixo. A cada 10 de Bônus a rolagem ganha +1d20; o que sobra soma fixo.",
      rows: [
        { label: `Bônus ⌊${ex.effectiveTotal} ÷ 3⌋`, value: String(ex.bonus) },
        { label: "Dados", value: `${ex.diceCount}d20` },
        { label: "Fixo do Bônus", value: signed(ex.flat) }
      ],
      result: { label: "Rolagem", value: ex.formula }
    });
    if (ex.items.length) {
      sections.splice(sections.length - 1, 0, {
        title: "Por fora (Itens e Modificações)",
        hint: "Somam como número fixo na hora de rolar. Não aumentam o Pool de d20 nem a Vida/Mana.",
        rows: ex.items.map(row),
        result: { label: "Fixo de Itens", value: signed(ex.itemBonus) }
      });
    }

    const notes = [];
    if (ex.pending) notes.push(`${ex.pending} ponto(s) pendente(s) ainda não confirmados: confirmando, o Bônus vai para ${ex.previewBonus}.`);
    if (key === "dexterity" && isMovementEnabled() && actor.system.movement) {
      notes.push(`Deslocamento: ${describeMovement(actor.system.movement).title.replace("Deslocamento por rodada: ", "")} = ${actor.system.movement.total} m por rodada.`);
    }
    try {
      if (game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.initiativeAttribute) === key) notes.push("É o atributo que rola a Iniciativa.");
    } catch (err) {
      /* setting ausente */
    }
    if (notes.length) sections.push({ title: "Também", notes });
    return sections;
  }

  #vitalSections() {
    const actor = this.actor;
    const stat = this.stat;
    const formula = getVitalFormula();
    const vital = actor.system.attributes[stat];
    const combat = actor.system.attributes.combat;
    const pairKeys = formula[stat] ?? [];
    const ex = explainVital({
      pair: pairKeys.map(key => ({ label: getAttributeLabel(key), total: combat[key]?.total ?? 0 })),
      multiplier: formula.multiplier,
      floor: formula.floor,
      permanent: statModifierSources(actor, stat),
      buffs: effectSources(actor, `system.attributes.${stat}.buffDelta`),
      buffActual: vital.buffDelta || 0,
      enabled: stat === "hp" || formula.energyEnabled,
      min: stat === "hp" ? 1 : 0
    });

    if (!ex.enabled) {
      return [{ title: "Desligada", notes: [`Esta campanha não usa ${getEnergyLabelForActor(actor)}: o máximo é 0 e nenhuma Skill cobra Custo.`] }];
    }

    const [a, b] = ex.pair;
    const sections = [
      {
        title: "Fórmula",
        hint: "Usa só o Total (pontos + Títulos) dos dois atributos: buffs temporários de atributo não mexem aqui.",
        rows: [
          { label: `${a.label} (Total)`, value: String(a.total) },
          { label: `× ${b.label} (Total)`, value: String(b.total) },
          { label: `× multiplicador`, value: String(ex.multiplier) },
          { label: "= resultado", value: String(ex.formulaValue) },
          ...(ex.floorApplied ? [{ label: `Abaixo do piso: vale o piso`, value: String(ex.floor) }] : [])
        ],
        result: { label: "Base", value: ex.base }
      }
    ];
    if (ex.permanent.length) {
      sections.push({
        title: "Permanentes",
        hint: "Títulos, Skills que você tem, Itens equipados e Modificações instaladas.",
        rows: ex.permanent.map(row),
        result: { label: "Soma", value: signed(ex.permanentTotal) }
      });
    }
    if (ex.temporary.length) {
      sections.push({
        title: "Temporário",
        hint: "Efeitos de Skills valendo agora.",
        rows: ex.temporary.map(row),
        result: { label: "Soma", value: signed(ex.temporaryTotal) }
      });
    }
    sections.push({
      title: "Máximo",
      rows: ex.minApplied ? [{ label: `Abaixo de ${ex.min}: fica em ${ex.min}`, value: String(ex.min) }] : [],
      result: { label: this.#statLabel(), value: ex.max }
    });
    if (ex.max !== vital.max) {
      sections.push({ title: "Atenção", notes: [`A ficha mostra ${vital.max}; a diferença vem de algo que esta janela não reconhece (outro módulo mexendo no valor).`] });
    }
    return sections;
  }

  /** Atualiza sozinha quando algo do Ator muda. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (this.#hookIds.length) return;
    const actor = this.actor;
    const mine = doc => doc?.uuid === actor.uuid || doc?.parent?.uuid === actor.uuid;
    const refresh = doc => {
      if (mine(doc)) this.render();
    };
    for (const hook of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem"]) {
      this.#hookIds.push([hook, Hooks.on(hook, refresh)]);
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hookIds) Hooks.off(hook, id);
    this.#hookIds = [];
  }

  static async #onOpenSource(event, target) {
    const doc = target.dataset.uuid ? await fromUuid(target.dataset.uuid) : null;
    doc?.sheet?.render(true);
  }
}
