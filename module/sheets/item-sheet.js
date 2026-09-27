import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getActiveDamageElements,
  getActiveCurrencies,
  getResistanceTargetOptions,
  getModuleSizePreset,
  getStarshipEnergyAbbr,
  isResistancesEnabled,
  isSkillPointsEnabled,
  getVisibleAttributes,
  getAttributeLabel,
  getEffectTargetLabels,
  getActiveStatusConditions,
  getCharacterEnergyLabel,
  isStatusConditionsEnabled,
  isAreaEffectsEnabled,
  getActiveDamageElements,
  getScaleConfig,
  isScaleEnabled,
  getActiveTraits,
  getAttributeLabels,
  getEffectTargetGroups,
  getModuleCategories,
  moduleRole,
  getStructures,
  isStructuresEnabled,
  debugLog
} from "../config.js";
import {
  WHEN_KINDS,
  WHEN_LABELS,
  SELF_WHEN_KINDS,
  THEN_KINDS,
  THEN_LABELS,
  PER_EACH_KINDS,
  PER_EACH_LABELS
} from "../conditional-modifiers.js";
import { createGrantedSkill, removeGrantedSkill, refreshGrantedSkill, evolveSkill } from "../skill-economy.js";
import { announceVoiceOfTheWorld } from "../voice-of-the-world.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../skill-effects.js";
import { openSkillEditorDialog, mechanicSummaryFor } from "../apps/skill-editor-dialog.js";
import { pickImageFile } from "../helpers/foundry-compat.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ficha genérica de Item, adaptável por `item.type`
 * (skill, body_part, title, starship_module, item).
 * Migrado pra ApplicationV2 (ItemSheetV2) — `form.submitOnChange` mantém o auto-save por
 * campo que a ficha sempre teve; sem `form.handler` explícito, o DocumentSheetV2 aplica o
 * default (grava direto no Item) — se algum campo parar de salvar sozinho ao editar, esse é
 * o primeiro lugar a olhar.
 *
 * Skill: TODOS os campos (Tier/Nível/Custo/Ativa/Descrição/Resistência/Mecânica ao Usar/
 * Alcance/Efeitos) são editados inline na aba Detalhes — não existe segunda camada de edição.
 * `openSkillEditorDialog` só sobrevive como formulário de CRIAÇÃO (Skill Racial em
 * species-config.js, "+ Nova Habilidade (direto)" em actor-sheet.js) e de Evolução. Os
 * Efeitos (`system.effects[]`) não usam `name=` de formulário: um array submetido por linhas
 * parciais perderia os campos que a linha não renderiza (ícone, elementos), então cada
 * controle é gravado por `_onSkillEffectFieldChange`, que reescreve só o campo tocado.
 */
/**
 * Para cada lista de `system` que chegou do formulário como objeto de índices (`{0: {...}}`),
 * devolve a lista atual com as entradas enviadas mescladas por cima. Listas inteiras (arrays de
 * verdade) passam intactas. Só olha o primeiro nível de `system`.
 */
function mergeSubmittedArrays(data, document) {
  const submitted = data?.system;
  if (!submitted || typeof submitted !== "object") return data;
  for (const [key, value] of Object.entries(submitted)) {
    const current = document.system?.[key];
    if (!Array.isArray(current) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const indices = Object.keys(value).filter(k => /^\d+$/.test(k));
    if (!indices.length) continue;
    const merged = current.map(entry => foundry.utils.deepClone(entry));
    for (const k of indices) {
      const i = Number(k);
      merged[i] = merged[i] ? foundry.utils.mergeObject(merged[i], value[k], { inplace: false }) : value[k];
    }
    submitted[key] = merged;
  }
  return data;
}

/**
 * Chips do cabeçalho: o Item resumido sem abrir aba (Tier, Nível, Custo, Ativa; Categoria e
 * Porte; Equipado, arma; Raridade…). `tone` só muda a cor.
 */
function headerChipsFor(item) {
  const sys = item.system;
  const chips = [];
  const add = (label, title = "", tone = "") => chips.push({ label, title, tone });
  switch (item.type) {
    case "skill":
      add(MEU_SISTEMA.SKILL_TIER_LABELS[sys.tier] ?? sys.tier, "Tier", "violet");
      add(`Nv ${sys.level}`, "Nível");
      if (sys.cost) add(`Custo ${sys.cost}`, "Custo ao usar");
      if (sys.hasUpkeep) add(`Ativa · ${sys.upkeepCost}/rodada`, "Habilidade Ativa", sys.active ? "ok" : "");
      if (sys.effectType === "damage") add(`Dano ${sys.damageFormula || "?"}`, "Mecânica ao usar", "hp");
      if (sys.effectType === "temporary") add(`${(sys.effects ?? []).length} efeito(s)`, "Mecânica ao usar");
      if (sys.resistanceTarget) add("Resistência", "Resistência passiva", "gold");
      if (sys.isItemGranted) add("Concedida", "Concedida por Item/Módulo — fixa");
      break;
    case "starship_module":
      add(getModuleCategories().find(c => c.id === sys.category)?.label ?? sys.category, "Categoria", "violet");
      add(MEU_SISTEMA.MODULE_ROLES[moduleRole(sys.category)]?.label ?? "", "Função");
      add(MEU_SISTEMA.MODULE_SIZE_LABELS[sys.moduleSize] ?? sys.moduleSize, "Porte");
      if (sys.powerConsumption) add(`Consumo ${sys.powerConsumption}`, "Consumo de energia a 100%");
      break;
    case "item":
      if (sys.equipped) add("Equipado", "", "ok");
      if (sys.weapon?.enabled) add(`Arma ${sys.weapon.damageFormula || "?"}`, "Dano", "hp");
      if (sys.grantsSkill?.name) add(`Concede ${sys.grantsSkill.name}`, "Habilidade Concedida", "violet");
      if (sys.quantity > 1) add(`×${sys.quantity}`, "Quantidade");
      break;
    case "title":
      if (sys.rarity) add(sys.rarity, "Raridade", "gold");
      if ((sys.bonuses ?? []).length) add(`${sys.bonuses.length} bônus`, "Bônus permanentes");
      if ((sys.resistances ?? []).length) add(`${sys.resistances.length} resistência(s)`, "Resistências");
      break;
  }
  if ((sys.conditionalModifiers ?? []).length) add(`${sys.conditionalModifiers.length} condicional(is)`, "Bônus Condicionais", "gold");
  return chips;
}

/** Linhas prontas do editor de Bônus Condicionais (opções já com `selected`). */
function conditionalModifierRows(list) {
  const pickList = (pairs, current) => pairs.map(([value, label]) => ({ value, label, selected: String(value) === String(current ?? "") }));
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const elements = getActiveDamageElements().map(e => [e.id, e.label]);
  const attributeLabels = getAttributeLabels();
  const attributes = MEU_SISTEMA.COMBAT_ATTRIBUTES.map(k => [k, attributeLabels[k] ?? k]);

  return list.map((mod, index) => {
    const whenKind = mod.when?.kind || "always";
    const thenKind = mod.then?.kind || "damagePercent";
    const valueSource = { otherTrait: traits, otherCondition: conditions, selfCondition: conditions, element: elements }[whenKind];
    let targetOptions = null;
    if (thenKind === "rollFlat") targetOptions = pickList([["any", "qualquer atributo"], ...attributes], mod.then?.target);
    else if (thenKind === "attributeFlat") targetOptions = pickList(attributes, mod.then?.target);
    else if (thenKind === "resistancePercent") targetOptions = pickList([["general", "Geral"], ...elements], mod.then?.target);
    return {
      index,
      whenOptions: pickList(WHEN_KINDS.map(k => [k, WHEN_LABELS[k]]), whenKind),
      whenValueOptions: valueSource ? pickList(valueSource, mod.when?.value) : null,
      needsThreshold: whenKind === "selfHpBelow",
      threshold: mod.when?.threshold ?? 50,
      thenOptions: pickList(THEN_KINDS.map(k => [k, THEN_LABELS[k]]), thenKind),
      targetOptions,
      value: mod.then?.value ?? 0,
      perEachOptions: pickList(PER_EACH_KINDS.map(k => [k, PER_EACH_LABELS[k]]), mod.perEach ?? ""),
      // Bônus contínuo de atributo não sabe quem é o oponente nem qual o elemento.
      warning: thenKind === "attributeFlat" && !SELF_WHEN_KINDS.includes(whenKind) ? "Bônus no atributo só vale com condição sobre você mesmo." : ""
    };
  });
}

/** Chips de Elemento agrupados por Grupo (ordem do catálogo), com os escolhidos marcados. */
function groupedElementChips(selected = []) {
  const chosen = new Set(selected ?? []);
  const groups = new Map();
  for (const el of getActiveDamageElements()) {
    if (!groups.has(el.group)) groups.set(el.group, []);
    groups.get(el.group).push({ id: el.id, label: el.label, color: el.color, checked: chosen.has(el.id) });
  }
  return [...groups].map(([group, chips]) => ({ group, chips }));
}

/**
 * Resumo de uma Habilidade Concedida pra ficha: nome, tier, custo, a mecânica numa linha e as
 * Sub-Skills. `null` quando o molde está vazio (sem nome) — a ficha mostra "+ Conceder".
 */
function grantedSkillSummary(grantsSkill, path) {
  if (!grantsSkill?.name?.trim()) return { path, empty: true };
  return {
    path,
    empty: false,
    name: grantsSkill.name,
    tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[grantsSkill.tier] ?? grantsSkill.tier,
    cost: grantsSkill.cost ?? 0,
    level: grantsSkill.level ?? 1,
    upkeep: grantsSkill.hasUpkeep ? grantsSkill.upkeepCost ?? 0 : null,
    mechanic: mechanicSummaryFor(grantsSkill),
    subSkills: (grantsSkill.subSkills ?? []).map((sub, index) => ({
      index,
      name: sub.name || "(sem nome)",
      mechanic: mechanicSummaryFor(sub)
    }))
  };
}

export class NihilityItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 560, height: 560 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addSubSkill: NihilityItemSheet.#onSubSkillAdd,
      deleteSubSkill: NihilityItemSheet.#onSubSkillDelete,
      addSkillEffect: NihilityItemSheet.#onSkillEffectAdd,
      deleteSkillEffect: NihilityItemSheet.#onSkillEffectDelete,
      toggleSkillElement: NihilityItemSheet.#onSkillElementToggle,
      toggleEffectElement: NihilityItemSheet.#onEffectElementToggle,
      toggleWeaponElement: NihilityItemSheet.#onWeaponElementToggle,
      toggleElement: NihilityItemSheet.#onElementToggle,
      addConditionalModifier: NihilityItemSheet.#onConditionalModifierAdd,
      editSubSkill: NihilityItemSheet.#onSubSkillEdit,
      deleteConditionalModifier: NihilityItemSheet.#onConditionalModifierDelete,
      evolveSkill: NihilityItemSheet.#onEvolveSkill,
      addInstalledMod: NihilityItemSheet.#onInstalledModAdd,
      deleteInstalledMod: NihilityItemSheet.#onInstalledModDelete,
      toggleModGrant: NihilityItemSheet.#onModGrantToggle,
      addTitleBonus: NihilityItemSheet.#onTitleBonusAdd,
      deleteTitleBonus: NihilityItemSheet.#onTitleBonusDelete,
      addItemAttrBonus: NihilityItemSheet.#onItemAttrBonusAdd,
      deleteItemAttrBonus: NihilityItemSheet.#onItemAttrBonusDelete,
      addModAttrBonus: NihilityItemSheet.#onModAttrBonusAdd,
      deleteModAttrBonus: NihilityItemSheet.#onModAttrBonusDelete,
      selectTab: NihilityItemSheet.#onSelectTab,
      levelUpSkill: NihilityItemSheet.#onLevelUpSkill,
      spendPointLevelUp: NihilityItemSheet.#onSpendPointLevelUp,
      addTitleResistance: NihilityItemSheet.#onTitleResistanceAdd,
      deleteTitleResistance: NihilityItemSheet.#onTitleResistanceDelete,
      editImage: NihilityItemSheet.#onEditImage,
      editGrantedSkill: NihilityItemSheet.#onEditGrantedSkill,
      clearGrantedSkill: NihilityItemSheet.#onClearGrantedSkill,
      addGrantedSubSkill: NihilityItemSheet.#onAddGrantedSubSkill,
      editGrantedSubSkill: NihilityItemSheet.#onEditGrantedSubSkill,
      deleteGrantedSubSkill: NihilityItemSheet.#onDeleteGrantedSubSkill
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  constructor(options = {}) {
    super(options);
    // ApplicationV2 não herda o mixin de abas do AppV1 — mesmo padrão manual já usado em
    // NihilityMenuApp (activeTab + ação "selectTab"), em vez de depender da config de
    // tabs nova (ainda não validada neste sistema).
    // Skill não tem a aba "Descrição": o <prose-mirror> dela mora dentro de Detalhes.
    // Abre direto nos campos (antes abria na Descrição); Skill abre na aba Geral.
    this.activeTab = this.item?.type === "skill" ? "general" : "details";
  }

  /**
   * @override
   * Sem isso o título da janela cai no formato padrão do Foundry ("TYPES.Item.skill: nome"),
   * que mostra a chave de tradução crua quando ninguém registrou esse label em lang/*.json.
   */
  get title() {
    return this.item.name;
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  /** Clique no retrato abre o FilePicker de imagem — precisa de action explícita no ApplicationV2. */
  static async #onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.item, field);
    pickImageFile(current, path => this.item.update({ [field]: path }));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.item.system;
    context.config = MEU_SISTEMA;
    context.itemType = this.item.type;
    context.activeTab = this.activeTab;
    context.currencies = getActiveCurrencies();
    context.item = this.item;
    context.owner = this.item.isOwner;
    context.isGM = game.user.isGM;
    context.resistancesEnabled = isResistancesEnabled();
    // Jogador pode comprar 1 nível de Skill com 1 Ponto de Habilidade do tier dela (Racial/
    // Ultimate não têm Pontos). O Mestre já tem o "+ Nível" livre, então o botão é só do jogador.
    const pointTier = this.item.system?.tier;
    context.canSpendPointLevel =
      this.item.type === "skill" && !game.user.isGM && this.item.isOwner && Boolean(this.item.parent) &&
      isSkillPointsEnabled() && MEU_SISTEMA.SKILL_POINT_TIERS.includes(pointTier);
    context.levelPointBalance = this.item.parent?.system?.skillPoints?.[pointTier] ?? 0;
    // Seletores de bônus de Atributo (Título, Item, Modificação) usam os rótulos e a
    // visibilidade atuais — atributo oculto sai da lista de opções novas.
    context.visibleAttributes = getVisibleAttributes();
    context.effectTargetLabels = getEffectTargetLabels();
    context.titleBonusTargets = MEU_SISTEMA.TITLE_BONUS_TARGETS.filter(
      t => !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t) || context.visibleAttributes.some(a => a.key === t)
    );

    // Alvos de Resistência (Geral + cada Elemento ativo) — usado pela Skill (com "Nenhuma"
    // na frente) e pelo Título (uma entrada sempre tem um alvo, sem opção "Nenhuma").
    const resistanceTargets = getResistanceTargetOptions();

    if (this.item.type === "skill") {
      const sys = this.item.system;

      const owner = this.item.parent;
      const hasUltimate = owner?.system?.hasUltimateSkill ?? sys.tier === "ultimate";
      const ultimateVisible = hasUltimate || game.user.isGM;
      context.visibleSkillTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || ultimateVisible);

      const pick = (list, current) => list.map(([value, label]) => ({ value, label, selected: value === current }));
      const elements = getActiveDamageElements();
      const visibleAttrs = context.visibleAttributes;

      context.energyLabel = getCharacterEnergyLabel();
      context.isRacialSkill = sys.tier === "racial";
      context.skillTierOptions = pick(
        context.visibleSkillTiers.filter(t => t !== "racial").map(t => [t, MEU_SISTEMA.SKILL_TIER_LABELS[t]]),
        sys.tier
      );
      context.skillEffectTypeOptions = pick(
        MEU_SISTEMA.SKILL_EFFECT_TYPES.map(t => [t, MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]]),
        sys.effectType
      );
      context.skillStructureOptions = getStructures().map(st => ({ value: st.id, label: st.label, selected: st.id === sys.structureId }));
      context.skillTargetTypeOptions = pick(
        MEU_SISTEMA.SKILL_TARGET_TYPES.filter(
          t =>
            sys.targetType === t ||
            ((isAreaEffectsEnabled() || !["emission", "zone"].includes(t)) && (isStructuresEnabled() || t !== "structure"))
        )
          .map(t => [t, MEU_SISTEMA.SKILL_TARGET_TYPE_LABELS[t]]),
        sys.targetType
      );
      context.skillAreaShapeOptions = pick(
        MEU_SISTEMA.SKILL_AREA_SHAPES.map(s => [s, MEU_SISTEMA.SKILL_AREA_SHAPE_LABELS[s]]),
        sys.areaShape
      );
      // Atributo escondido pela campanha continua listado se a Skill JÁ escala por ele.
      context.skillScalingOptions = pick(
        [["", "— sem escala —"]]
          .concat(visibleAttrs.map(a => [a.key, a.label]))
          .concat(
            sys.scalingAttribute && !visibleAttrs.some(a => a.key === sys.scalingAttribute)
              ? [[sys.scalingAttribute, `${getAttributeLabel(sys.scalingAttribute)} (oculto)`]]
              : []
          ),
        sys.scalingAttribute ?? ""
      );
      context.skillResistanceOptions = pick(
        [["", "— nenhuma —"]].concat(resistanceTargets.map(o => [o.value, o.label])),
        sys.resistanceTarget ?? ""
      );
      context.skillElementChips = elements.map(el => ({
        id: el.id, label: el.label, color: el.color, checked: (sys.damageElements ?? []).includes(el.id)
      }));

      // Efeitos Temporários: uma linha pronta por entrada (opções já com `selected`, pra o
      // template não depender da profundidade de {{#each}} aninhado).
      const targetLabels = getEffectTargetLabels();
      const hiddenAttrs = new Set(MEU_SISTEMA.COMBAT_ATTRIBUTES.filter(k => !visibleAttrs.some(a => a.key === k)));
      context.conditionsEnabled = isStatusConditionsEnabled();
      const conditions = getActiveStatusConditions();
      context.skillEffects = (sys.effects ?? []).map((entry, index) => {
        const acceptsPeriodic = entry.target === "hp" || entry.target === "energy";
        const entryElements = entry.damageElements ?? [];
        return {
          index,
          amount: entry.amount,
          durationRounds: entry.durationRounds,
          icon: entry.icon ?? "",
          periodic: acceptsPeriodic && Boolean(entry.periodic),
          acceptsPeriodic,
          isShipTarget: MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target),
          targetGroups: getEffectTargetGroups(entry.target),
          isElementTarget: entry.target === "weaponElement",
          elementIdOptions: getActiveDamageElements().map(el => ({ value: el.id, label: el.label, selected: el.id === entry.elementId })),
          targetOptions: pick(
            MEU_SISTEMA.EFFECT_TARGETS.filter(t => !hiddenAttrs.has(t) || t === entry.target).map(t => [t, targetLabels[t]]),
            entry.target
          ),
          conditionOptions: pick(
            [["", "— sem Condição —"]].concat(conditions.map(c => [c.id, c.label])),
            entry.conditionId ?? ""
          ),
          tickUnitOptions: pick(
            MEU_SISTEMA.PERIODIC_TICK_UNITS.map(u => [u, MEU_SISTEMA.PERIODIC_TICK_UNIT_LABELS[u]]),
            entry.tickUnit
          ),
          modifierTypeOptions: pick(
            MEU_SISTEMA.EFFECT_MODIFIER_TYPES.map(m => [m, MEU_SISTEMA.EFFECT_MODIFIER_TYPE_LABELS[m]]),
            entry.modifierType || "flat"
          ),
          elementChips: elements.map(el => ({
            id: el.id, label: el.label, color: el.color, checked: entryElements.includes(el.id)
          }))
        };
      });

      const resistanceTarget = sys.resistanceTarget ?? "";
      context.isResistanceSkill = resistanceTarget !== "";
      if (context.isResistanceSkill) {
        context.resistanceMaxLevel = resistanceMaxLevel(resistanceTarget);
        context.resistancePercent = Math.round(computeResistancePercent(resistanceTarget, sys.level) * 100);
        context.skillResistanceSummary = `${computeResistanceName(resistanceTarget, sys.level)} — ${context.resistancePercent}% (nível ${sys.level}/${context.resistanceMaxLevel})`;
      }
    }

    if (this.item.type === "item") {
      const weapon = this.item.system.weapon;
      const visibleAttrs = context.visibleAttributes;
      const scalingChoices = [["", "— sem escala —"]].concat(visibleAttrs.map(a => [a.key, a.label]));
      // Atributo escondido pela campanha continua listado se a arma JÁ escala por ele.
      if (weapon.scalingAttribute && !visibleAttrs.some(a => a.key === weapon.scalingAttribute)) {
        scalingChoices.push([weapon.scalingAttribute, `${getAttributeLabel(weapon.scalingAttribute)} (oculto)`]);
      }
      context.weaponScalingOptions = scalingChoices.map(([value, label]) => ({
        value, label, selected: value === (weapon.scalingAttribute ?? "")
      }));
      context.weaponElementChips = getActiveDamageElements().map(el => ({
        id: el.id, label: el.label, color: el.color, checked: (weapon.damageElements ?? []).includes(el.id)
      }));
    }

    if (this.item.type === "starship_module") {
      // Categoria do catálogo editável; os campos da ficha seguem a FUNÇÃO dela (ver MODULE_ROLES).
      const current = this.item.system.category;
      const categories = getModuleCategories();
      context.moduleRole = moduleRole(current);
      context.moduleRoleLabel = MEU_SISTEMA.MODULE_ROLES[context.moduleRole]?.label ?? context.moduleRole;
      context.moduleCategoryOptions = categories.map(c => ({
        id: c.id, label: c.label, roleLabel: MEU_SISTEMA.MODULE_ROLES[c.role]?.label ?? c.role, selected: c.id === current
      }));
      // Categoria que sumiu do catálogo continua na lista, senão salvar a ficha a trocaria.
      if (!categories.some(c => c.id === current)) {
        context.moduleCategoryOptions.push({ id: current, label: `${current} (fora do catálogo)`, roleLabel: context.moduleRoleLabel, selected: true });
      }
    }

    if (this.item.type === "starship_module" && moduleRole(this.item.system.category) === "distribution") {
      // "Fator 5" não diz nada sozinho: a Capacidade de Transferência sai de
      // `baseline(Porte) × fator`, e a tabela de baseline mora no código. Sem ver o RESULTADO,
      // não há como calibrar o número — nem quem escreveu o Módulo, nem quem recebe ele pronto.
      const factor = Number(this.item.system.transferFactor) || 0;
      const abbr = getStarshipEnergyAbbr();
      context.distributorPreview = {
        abbr,
        rows: MEU_SISTEMA.SHIP_SIZES.map(size => ({
          label: MEU_SISTEMA.SHIP_SIZE_LABELS[size],
          baseline: MEU_SISTEMA.DISTRIBUTOR_BASELINE_BY_SHIP_SIZE[size] ?? 0,
          result: Math.round((MEU_SISTEMA.DISTRIBUTOR_BASELINE_BY_SHIP_SIZE[size] ?? 0) * factor),
          // Destaca a linha do Porte da Nave onde ESTE Módulo está instalado, quando está.
          current: this.item.parent?.system?.shipSize === size
        }))
      };
    }

    if (this.item.type === "title") {
      // Cada entrada de Resistência do Título já tem um alvo escolhido — sem opção "Nenhuma".
      context.titleResistances = (this.item.system.resistances ?? []).map(entry => ({
        ...entry,
        targetOptions: resistanceTargets.map(opt => ({ ...opt, selected: opt.value === entry.target }))
      }));
    }

    context.headerChips = headerChipsFor(this.item);
    if (this.item.type === "skill") {
      context.subSkillRows = (this.item.system.subSkills ?? []).map((sub, index) => ({
        index,
        name: sub.name,
        mechanic: mechanicSummaryFor(sub)
      }));
    }

    // Elementos agrupados (Físico, Fantasia, Energia…) e Escalas, pros campos de dano.
    context.scaleEnabled = isScaleEnabled();
    const scaleChoices = [{ id: "", label: "— a de quem ataca —" }].concat(getScaleConfig().scales);
    const scaleOptions = current => scaleChoices.map(s => ({ ...s, selected: s.id === (current ?? "") }));
    if (this.item.type === "skill") {
      context.skillElementGroups = groupedElementChips(this.item.system.damageElements);
      context.damageScaleOptions = scaleOptions(this.item.system.damageScale);
    }
    if (this.item.type === "item") {
      context.weaponElementGroups = groupedElementChips(this.item.system.weapon?.damageElements);
      context.weaponScaleOptions = scaleOptions(this.item.system.weapon?.damageScale);
    }
    if (this.item.type === "starship_module") {
      context.moduleElementGroups = groupedElementChips(this.item.system.damageElements);
    }

    if (["title", "skill", "item"].includes(this.item.type)) {
      context.conditionalRows = conditionalModifierRows(this.item.system.conditionalModifiers ?? []);
    }

    // Habilidade Concedida: resumo pronto pro template (Item Geral e Módulo têm uma; Parte do
    // Corpo tem uma por Modificação instalada).
    if (this.item.type === "item" || this.item.type === "starship_module") {
      context.grantSummary = grantedSkillSummary(this.item.system.grantsSkill, "system.grantsSkill");
    }
    if (this.item.type === "body_part") {
      context.modGrantSummaries = (this.item.system.installedMods ?? []).map((mod, index) =>
        grantedSkillSummary(mod.grantsSkill, `system.installedMods.${index}.grantsSkill`)
      );
    }

    debugLog(`${SYSTEM_ID} | NihilityItemSheet._prepareContext (${this.item.type}):`, this.item.name);
    return context;
  }

  /* -------------------------------------------- */
  /*  Habilidade Concedida: editor completo        */
  /* -------------------------------------------- */

  /**
   * Chave que a Skill criada no Ator carrega em `grantedBySource`: o id do Item/Módulo, ou
   * `id:índice` pra uma Modificação de Parte do Corpo (mesma convenção de sempre).
   */
  _grantSourceKey(path) {
    const match = path.match(/^system\.installedMods\.(\d+)\.grantsSkill$/);
    return match ? `${this.item.id}:${match[1]}` : this.item.id;
  }

  /** Grava o molde e, se a fonte estiver concedendo agora, recria a Skill da ficha. */
  async _saveGrantedSkill(path, grantsSkill) {
    await this.item.update({ [path]: grantsSkill });
    const saved = foundry.utils.getProperty(this.item, path);
    const refreshed = await refreshGrantedSkill(this.item.parent, saved, this._grantSourceKey(path));
    if (refreshed) ui.notifications.info(`"${saved.name}" foi atualizada na ficha.`);
  }

  static async #onEditGrantedSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});

    const data = await openSkillEditorDialog(
      { ...current, subSkills: [] },
      { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM }
    );
    if (!data) return;
    // O editor não mexe em Sub-Skills (elas têm a própria lista na ficha); ficam como estavam.
    await this._saveGrantedSkill(path, { ...data, subSkills: current.subSkills ?? [] });
  }

  static async #onClearGrantedSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover Habilidade Concedida" },
      content: "<p>Apagar a Habilidade Concedida deste item? Se ela estiver na ficha de alguém agora, sai de lá também.</p>"
    });
    if (!confirmed) return;

    const actor = this.item.parent;
    if (actor) await removeGrantedSkill(actor, this._grantSourceKey(path));
    await this.item.update({ [`${path}.name`]: "", [`${path}.subSkills`]: [], [`${path}.effectType`]: "none", [`${path}.effects`]: [] });
    // Parte do Corpo guarda "já concedida" na própria Modificação.
    const modMatch = path.match(/^(system\.installedMods\.\d+)\.grantsSkill$/);
    if (modMatch) await this.item.update({ [`${modMatch[1]}.skillGranted`]: false });
  }

  static async #onAddGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});

    const data = await openSkillEditorDialog({ tier: current.tier }, { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
    if (!data) return;
    await this._saveGrantedSkill(path, { ...current, subSkills: [...(current.subSkills ?? []), data] });
  }

  static async #onEditGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const index = Number(target.dataset.subIndex);
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});
    const sub = current.subSkills?.[index];
    if (!sub) return;

    const data = await openSkillEditorDialog(sub, { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
    if (!data) return;
    current.subSkills[index] = data;
    await this._saveGrantedSkill(path, current);
  }

  static async #onDeleteGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const index = Number(target.dataset.subIndex);
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});
    if (!current.subSkills?.[index]) return;
    current.subSkills.splice(index, 1);
    await this._saveGrantedSkill(path, current);
  }

  /**
   * @override
   * O formulário manda só os campos de uma lista que estão na tela (`system.installedMods.0.name`,
   * `.description`, `.statModifiers.hp`…), e o Foundry transforma isso numa lista NOVA feita só
   * desses campos, trocando a inteira. Tudo o que não tem campo na tela voltava ao valor inicial
   * a cada edição: o "já concedida" de uma Modificação e, agora, a Habilidade Concedida inteira
   * guardada nela. Aqui cada entrada enviada é mesclada por cima da entrada que já existe.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    return mergeSubmittedArrays(data, this.item);
  }

  /**
   * @override
   * O toggle de equipar (type "item") dispara em "change", não em clique — a API de
   * `actions` só cobre clique, então esse listener é ligado manualmente aqui.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;

    this.element.querySelectorAll(".item-equip-toggle").forEach(checkbox => {
      checkbox.addEventListener("change", this._onEquipToggle.bind(this));
    });

    this.element.querySelectorAll(".skill-effect-input").forEach(input => {
      input.addEventListener("change", this._onSkillEffectFieldChange.bind(this));
    });

    if (this.item.type === "starship_module") {
      const presetChange = this._onModulePresetChange.bind(this);
      this.element.querySelector('[name="system.category"]')?.addEventListener("change", presetChange);
      this.element.querySelector('[name="system.moduleSize"]')?.addEventListener("change", presetChange);
    }
  }

  /**
   * Autopreenche os campos numéricos de um Módulo de Nave (Overhaul de Naves, Fase 1/8) quando
   * o usuário troca Categoria ou Porte, a partir de `MEU_SISTEMA.MODULE_SIZE_PRESETS`/
   * `MODULE_HP_BY_SIZE` — só sobrescreve um campo se ele ainda estiver no valor-padrão do
   * schema, nunca uma edição manual já feita. `stopPropagation` evita que este mesmo "change"
   * TAMBÉM dispare o submitOnChange padrão do DocumentSheetV2 — os dois juntos fariam dois
   * `update()` concorrentes no mesmo Item (um só com Categoria/Porte, outro com os presets).
   */
  async _onModulePresetChange(event) {
    event.stopPropagation();
    const form = event.currentTarget.closest("form");
    const category = form.querySelector('[name="system.category"]').value;
    const moduleSize = form.querySelector('[name="system.moduleSize"]').value;

    const sys = this.item.system;
    const updates = { "system.category": category, "system.moduleSize": moduleSize };
    const fieldDefaults = { "system.transferFactor": 1, "system.warpFactor": 1, "system.hp.max": 20, "system.hp.value": 20 };

    for (const [key, value] of Object.entries(getModuleSizePreset(category, moduleSize))) {
      const field = key.replace(/^system\./, "");
      const current = foundry.utils.getProperty(sys, field);
      const defaultValue = fieldDefaults[key] ?? (typeof value === "string" ? "" : 0);
      if (current === defaultValue || current === undefined) updates[key] = value;
    }

    await this.item.update(updates);
  }

  /* -------------------------------------------- */
  /*  Efeitos Temporários da Skill (edição inline) */
  /* -------------------------------------------- */

  /** Cópia editável de `system.effects` (objetos simples, nunca o Data Model vivo). */
  #cloneEffects() {
    return foundry.utils.deepClone(this.item.toObject().system.effects ?? []);
  }

  /**
   * Grava UM campo de UMA linha de Efeito. Alvo que não aceita Periódico desliga o Periódico e
   * alvo que não é "de Nave" volta o modificador pra "flat" — o mesmo saneamento que o antigo
   * modal fazia ao trocar o Alvo.
   */
  async _onSkillEffectFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const index = Number(input.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;

    const field = input.dataset.effectField;
    if (input.type === "checkbox") entry[field] = input.checked;
    else if (input.type === "number") entry[field] = Number(input.value) || 0;
    else entry[field] = input.value.trim();

    if (field === "target") {
      if (entry.target !== "hp" && entry.target !== "energy") entry.periodic = false;
      if (!MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target)) entry.modifierType = "flat";
    }
    await this.item.update({ "system.effects": effects });
  }

  static async #onSkillEffectAdd(event, target) {
    event.preventDefault();
    const effects = this.#cloneEffects();
    effects.push({
      target: MEU_SISTEMA.EFFECT_TARGETS[0],
      amount: 1,
      modifierType: "flat",
      durationRounds: 1,
      conditionId: "",
      icon: "",
      periodic: false,
      tickUnit: "combatRound",
      damageElements: []
    });
    await this.item.update({ "system.effects": effects });
  }

  static async #onSkillEffectDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    effects.splice(index, 1);
    await this.item.update({ "system.effects": effects });
  }

  /** Liga/desliga um Elemento no dano da Skill (chips não são campos de formulário). */
  static async #onSkillElementToggle(event, target) {
    event.preventDefault();
    const elements = new Set(this.item.system.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    await this.item.update({ "system.damageElements": [...elements] });
  }

  static async #onConditionalModifierAdd(event) {
    event.preventDefault();
    const list = foundry.utils.deepClone(this.item.system.conditionalModifiers ?? []);
    list.push({ when: { kind: "always", value: "", threshold: 50 }, then: { kind: "damagePercent", target: "any", value: 10 }, perEach: "" });
    await this.item.update({ "system.conditionalModifiers": list });
  }

  static async #onConditionalModifierDelete(event, target) {
    event.preventDefault();
    const list = foundry.utils.deepClone(this.item.system.conditionalModifiers ?? []);
    list.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.conditionalModifiers": list });
  }

  /** Liga/desliga um Elemento numa lista qualquer do Item (`data-path`: system.damageElements, system.weapon.damageElements…). */
  static async #onElementToggle(event, target) {
    event.preventDefault();
    const path = target.dataset.path;
    if (!path?.startsWith("system.")) return;
    const elements = new Set(foundry.utils.getProperty(this.item, path) ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    await this.item.update({ [path]: [...elements] });
  }

  /** Liga/desliga um Elemento no dano de uma Arma (Item Geral). */
  static async #onWeaponElementToggle(event, target) {
    event.preventDefault();
    const elements = new Set(this.item.system.weapon.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    await this.item.update({ "system.weapon.damageElements": [...elements] });
  }

  /** Liga/desliga um Elemento no tick de dano de uma linha de Efeito Periódico. */
  static async #onEffectElementToggle(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    const elements = new Set(entry.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    entry.damageElements = [...elements];
    await this.item.update({ "system.effects": effects });
  }

  /**
   * Evolução: 1 Skill vira uma Skill NOVA e diferente (não uma fusão — nada de Sub-Skills
   * aqui), só ficando o registro histórico "Evoluiu de: X". A Skill antiga é preservada no
   * Compêndio e removida do Ator, igual `fuseSkills` já faz — ver `evolveSkill` em skill-economy.js.
   */
  static async #onEvolveSkill(event, target) {
    event.preventDefault();
    // Só Mestre: o botão some da ficha do jogador; isto fecha a porta dos fundos.
    if (!game.user.isGM) return;
    if (this.item.system.isItemGranted) return;
    const actor = this.item.parent;
    if (!actor) {
      ui.notifications?.warn("Só é possível Evoluir uma Skill que já está numa ficha de Ator.");
      return;
    }

    const hasUltimate = actor.system?.hasUltimateSkill;
    const ultimateVisible = hasUltimate || game.user.isGM;
    const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

    const data = await openSkillEditorDialog({}, { tierChoices, levelReadonly: !game.user.isGM });
    if (!data) return;

    await evolveSkill(actor, this.item.id, data);
  }

  /* -------------------------------------------- */
  /*  Habilidade Concedida (Item Geral / equipar)  */
  /* -------------------------------------------- */

  async _onEquipToggle(event) {
    const actor = this.item.parent;
    if (!actor) return; // Item ainda não está numa ficha — nada a conceder/revogar.

    if (event.currentTarget.checked) {
      await createGrantedSkill(actor, this.item.system.grantsSkill, this.item.id);
    } else {
      await removeGrantedSkill(actor, this.item.id);
    }
  }

  static async #onSubSkillAdd(event, target) {
    event.preventDefault();
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.push({ name: "Nova Sub-Skill", description: "" });
    await this.item.update({ "system.subSkills": subSkills });
  }

  /** Sub-Skill de uma Skill (componente de fusão): edita a mecânica inteira no editor de Skill. Só o Mestre. */
  static async #onSubSkillEdit(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const index = Number(target.closest("[data-index]").dataset.index);
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    const sub = subSkills[index];
    if (!sub) return;
    const data = await openSkillEditorDialog(sub, { levelReadonly: false });
    if (!data) return;
    // `active` é estado de uso, não de edição: fica como estava.
    subSkills[index] = { ...sub, ...data, active: sub.active };
    await this.item.update({ "system.subSkills": subSkills });
  }

  static async #onSubSkillDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.splice(index, 1);
    await this.item.update({ "system.subSkills": subSkills });
  }

  static async #onInstalledModAdd(event, target) {
    event.preventDefault();
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    mods.push({ name: "Nova Modificação", description: "" });
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onInstalledModDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);

    const actor = this.item.parent;
    if (actor && mods[index]?.skillGranted) {
      await removeGrantedSkill(actor, `${this.item.id}:${index}`);
    }

    mods.splice(index, 1);
    await this.item.update({ "system.installedMods": mods });
  }

  /** Concede (ou revoga) a Habilidade de uma Modificação instalada em Parte do Corpo. */
  static async #onModGrantToggle(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    if (!actor) {
      ui.notifications?.warn("A Parte do Corpo precisa estar numa ficha de Ator para conceder a Habilidade.");
      return;
    }

    const index = Number(target.closest("[data-index]").dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[index];
    if (!mod) return;

    const sourceKey = `${this.item.id}:${index}`;
    if (mod.skillGranted) {
      await removeGrantedSkill(actor, sourceKey);
      mod.skillGranted = false;
    } else {
      const created = await createGrantedSkill(actor, mod.grantsSkill, sourceKey);
      if (!created) {
        ui.notifications?.warn("Preencha o nome da Habilidade Concedida antes de conceder.");
        return;
      }
      mod.skillGranted = true;
    }

    await this.item.update({ "system.installedMods": mods });
  }

  static async #onItemAttrBonusAdd(event, target) {
    event.preventDefault();
    const bonuses = foundry.utils.deepClone(this.item.system.attributeBonuses ?? []);
    bonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.attributeBonuses": bonuses });
  }

  static async #onItemAttrBonusDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const bonuses = foundry.utils.deepClone(this.item.system.attributeBonuses ?? []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.attributeBonuses": bonuses });
  }

  static async #onModAttrBonusAdd(event, target) {
    event.preventDefault();
    const modIndex = Number(target.dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[modIndex];
    if (!mod) return;
    mod.attributeBonuses = mod.attributeBonuses ?? [];
    mod.attributeBonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onModAttrBonusDelete(event, target) {
    event.preventDefault();
    const li = target.closest("[data-bonus-index]");
    const modIndex = Number(li.dataset.index);
    const bonusIndex = Number(li.dataset.bonusIndex);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[modIndex];
    if (!mod?.attributeBonuses) return;
    mod.attributeBonuses.splice(bonusIndex, 1);
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onTitleBonusAdd(event, target) {
    event.preventDefault();
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.bonuses": bonuses });
  }

  static async #onTitleBonusDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.bonuses": bonuses });
  }

  /* -------------------------------------------- */
  /*  Level Up de Skill (só GM — campo Nível é readonly pro jogador)  */
  /* -------------------------------------------- */

  static async #onLevelUpSkill(event, target) {
    event.preventDefault();
    await this.#raiseSkillLevel();
  }

  /** Jogador paga 1 Ponto de Habilidade do tier da Skill por 1 nível (sem esperar o XP encher). */
  static async #onSpendPointLevelUp(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    const tier = this.item.system.tier;
    if (!actor || !MEU_SISTEMA.SKILL_POINT_TIERS.includes(tier)) return;
    const balance = actor.system.skillPoints?.[tier] ?? 0;
    if (balance < 1) {
      ui.notifications.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} para subir o nível.`);
      return;
    }
    // O ponto só é gasto se o nível realmente subiu (teto de Resistência recusa antes).
    await this.#raiseSkillLevel({ spendPointFrom: actor, tier, balance });
  }

  async #raiseSkillLevel({ spendPointFrom = null, tier = null, balance = 0 } = {}) {
    // Skill concedida por Item/Módulo é fixa: o nível dela vem do molde da fonte.
    if (this.item.system.isItemGranted) {
      ui.notifications?.warn("Habilidade concedida não sobe de nível — edite o nível no Item/Módulo que a concede.");
      return;
    }
    const resistanceTarget = this.item.system.resistanceTarget;
    const currentLevel = this.item.system.level;

    if (resistanceTarget) {
      const maxLevel = resistanceMaxLevel(resistanceTarget);
      if (currentLevel >= maxLevel) {
        ui.notifications.warn(
          resistanceTarget === "general"
            ? "Resistência Geral já está no teto (nível 5, 50%) — não existe Imunidade Geral."
            : `Essa Skill já está no nível máximo (${maxLevel}, Imunidade).`
        );
        return;
      }
    }

    const newLevel = currentLevel + 1;
    const updates = { "system.level": newLevel };
    if (resistanceTarget) updates.name = computeResistanceName(resistanceTarget, newLevel);
    if (spendPointFrom) await spendPointFrom.update({ [`system.skillPoints.${tier}`]: balance - 1 });
    await this.item.update(updates);

    const actor = this.item.parent;
    if (actor) {
      await announceVoiceOfTheWorld(actor, {
        kind: "skill-level-up",
        title: "Habilidade Evoluiu",
        body: `${this.item.name} de ${actor.name} subiu para o nível ${newLevel}${spendPointFrom ? " (1 Ponto de Habilidade gasto)" : ""}.`
      });
    }
  }

  /* -------------------------------------------- */
  /*  Resistência concedida por Título             */
  /* -------------------------------------------- */

  static async #onTitleResistanceAdd(event, target) {
    event.preventDefault();
    const resistances = foundry.utils.deepClone(this.item.system.resistances ?? []);
    resistances.push({ target: "general", amount: 0 });
    await this.item.update({ "system.resistances": resistances });
  }

  static async #onTitleResistanceDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const resistances = foundry.utils.deepClone(this.item.system.resistances ?? []);
    resistances.splice(index, 1);
    await this.item.update({ "system.resistances": resistances });
  }
}
