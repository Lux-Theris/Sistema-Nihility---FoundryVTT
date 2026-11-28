import { advancedFold } from "../helpers/advanced-fold.js";
import { normalizeDevice, slotLayout } from "../economy/device-rules.js";
import { resolveMechArea, resolveStructureArea, concentrationNote } from "../combat/area-size-rules.js";
import { normalizeItemShop } from "../economy/shop-rules.js";
import { describeLuck, luckFromScopes } from "../combat/luck-rules.js";
import { ONLY_IF_KINDS, ONLY_IF_LABELS, onlyIfNeeds, normalizeOnlyIf, hasOnlyIf, onlyIfClause } from "../skills/only-if-rules.js";
import { getAntimagicReach,
  SYSTEM_ID,
  NIHILITY,
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
  isSkillRangeEnabled,
  isVesselsEnabled,
  isShipSensorsEnabled,
  isBoardingEnabled,
  isLuckEnabled,
  isForcedMovementEnabled,
  getScaleConfig,
  isScaleEnabled,
  getActiveTraits,
  getComplexityCaps,
  getAttributeLabels,
  getEffectTargetGroups,
  getModuleCategories,
  moduleRole,
  getStructures,
  isStructuresEnabled,
  isStructureMechanic,
  isFormsEnabled,
  isAnalysisEnabled,
  isPredationEnabled,
  isRerollEnabled,
  debugLog,
  getVesselSizes,
  vesselKind,
  isMagicUse,
  isTechUse,
  isInterferenceEnabled,
  isShopsEnabled,
  getAmmoTypes,
  cargoSlotsFor,
  isInventoryEnabled,
  isAnatomyEnabled,
  isDevicesEnabled,
  getActiveSpeciesPresets,
  getActiveHeritages,
  getActiveBodyFunctions,
  getActiveSkillTemplates,
  isFeatureEnabled,
  skillMaxLevel,
  isTimeManipulationEnabled,
  isItemSetsEnabled,
  getActiveItemSets,
} from "../core/config.js";
import { setFitsItemType } from "../economy/item-set-rules.js";
import { skillAssist, costChipHtml } from "../skills/skill-assist.js";
import { targetAcceptsDrain } from "../skills/drain-rules.js";
import { levelUpChanceUpdate } from "../skills/chance-progression.js";
import { MAX_LEVEL_TEXT } from "../skills/chance-rules.js";
import { ATTRIBUTE_PERCENT_TARGETS, PERCENT_AMOUNT_TARGETS } from "../economy/consumable-rules.js";
import { normalizeOnHit, ON_HIT_WHEN, ON_HIT_WHEN_LABELS } from "../skills/marks-rules.js";
import { complexityVerdict } from "../skills/skill-complexity-rules.js";
import { REROLL_WHO, REROLL_WHO_LABELS, REROLL_KEEP_LABELS, REROLL_KIND_KEYS, REROLL_KIND_LABELS, normalizeRerollKinds, rerollKeepOptions } from "../skills/reroll-rules.js";
import { DISPEL_SCOPES, DISPEL_SCOPE_LABELS } from "../core/magic-rules.js";
import { isCombinedSkill, combinedHint, STRUCTURE_PLACE_OPTIONS, INTRUDER_RULE_OPTIONS } from "../skills/combined-rules.js";
import { getDragEventData } from "../helpers/foundry-compat.js";
import { formTemplateOf } from "../skills/forms.js";
import { requestForm } from "../skills/form-request.js";
import { useSkillFlow } from "../skills/skill-use-flow.js";
import {
  WHEN_KINDS,
  WHEN_LABELS,
  SELF_WHEN_KINDS,
  THEN_KINDS,
  THEN_LABELS,
  PER_EACH_KINDS,
  PER_EACH_LABELS
} from "../combat/conditional-modifiers.js";
import { itemNature, itemIsTech } from "../core/magic-rules.js";
import { createGrantedSkill, removeGrantedSkill, refreshGrantedSkill, evolveSkill } from "../skills/skill-economy.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../combat/resistance.js";
import { openSkillEditorDialog, mechanicSummaryFor } from "../apps/skill-editor-dialog.js";
import { pickDamageElements, pickTraits, selectedElementChips, selectedTraitChips } from "../apps/checklist-picker.js";
import { magazineState } from "../economy/consumable-rules.js";
import { openLightConfigDialog, describeLight } from "../combat/lights.js";
import { pickImageFile, filePickerClass } from "../helpers/foundry-compat.js";
import { sequencerAvailable } from "../core/vfx.js";
import { AREA_AFFECTS_OPTIONS } from "../combat/area-geometry.js";
import { clampTimeFactor, describeTimeFactor } from "../combat/time-rate-rules.js";
import { liveSpaceModes, normalizeSpaceMode, spaceShortLabel, skillIsSpatial, pocketSlots, POCKET_DEFAULTS } from "../combat/space-rules.js";
import { isSenseTarget, SENSE_LABELS, describeSenseRange, senseRangeValue } from "../combat/senses-rules.js";
import { isWeaponMasteryEnabled, masteryConfig, masterySentenceFor, weaponTypeChoices, weaponTypeDisplay } from "../combat/weapon-mastery.js";
import { masteryLevelUpBlock } from "../combat/weapon-mastery-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { markVisibleEditorParts, refreshEditorOnTabShow } from "../helpers/sheet-tabs.js";

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
 * Layout do redesenho aprovado (artifact "Redesenho da Ficha de Item"): abas por pergunta
 * (`tabsFor`), chips-resumo no cabeçalho (`headerChipsFor`) e seções em grade. Skill: todos os
 * campos são editados inline nas abas Geral/Mecânica/Passivos/Sub-Skills.
 * `openSkillEditorDialog` só sobrevive como formulário de CRIAÇÃO (Skill Racial em
 * species-config.js, pedido com Pontos de Habilidade, Habilidade Concedida e Sub-Skills) e de
 * Evolução. O "+ Nova Habilidade" da ficha só pede Nome e Tier e abre ESTA ficha. Os
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
 * Chips do cabeçalho: o Item resumido sem abrir aba (princípio A do redesenho) — Tier, Nível,
 * Custo, Ativa, mecânica e Resistência numa Skill; Categoria, Porte, consumo e o número-chave da
 * Função num Módulo; Equipado, quantidade, valor e arma num Item. Só leitura; `tone` muda a cor.
 */
function headerChipsFor(item) {
  const sys = item.system;
  const chips = [];
  const add = (label, title = "", tone = "") => chips.push({ label, title, tone });
  const fmt = n => String(n).replace(".", ",");
  switch (item.type) {
    case "skill": {
      add(NIHILITY.SKILL_TIER_LABELS[sys.tier] ?? sys.tier, "Tier", "violet");
      add(`Nv ${sys.level}`, "Nível");
      if (sys.coreSkill) add("Skill de base", "Skill pré-feita do sistema: outras regras dependem dela", "violet");
      if (sys.cost) add(`${sys.cost} ${getCharacterEnergyLabel()}`, "Custo ao usar");
      if (sys.hasUpkeep) add(`Ativa · ${sys.upkeepCost}/rod.`, "Habilidade Ativa", sys.active ? "ok" : "accent");
      if (sys.variableMana) add(`${getCharacterEnergyLabel()} variável`, "Aceita investir mais ou menos que o Custo", "violet");
      const chipMagic = isMagicUse(sys, item.parent);
      const chipTech = isTechUse(sys, item.parent);
      if (chipMagic && chipTech) add("Tecnomágica", "Sofre Antimagia e PEM", "violet");
      else if (chipMagic) add("Mágica", "Sofre Antimagia", "violet");
      else if (chipTech) add("Tecnológica", "Sofre PEM", "violet");
      if (skillIsSpatial(sys)) add("Espacial", "Marca espacial: a Âncora (Condição, Campo ou Região) bloqueia o teleporte desta Skill", "violet");
      const target = NIHILITY.SKILL_TARGET_TYPE_SHORT_LABELS[sys.targetType] ?? "";
      if (isStructureMechanic(sys)) add("Estrutura", "Mecânica ao usar");
      else if (sys.effectType === "form") add("Forma", "Mecânica ao usar");
      else if (sys.effectType === "analysis") add("Análise", "Mecânica ao usar");
      else if (sys.effectType === "predation") add("Predação", "Mecânica ao usar");
      else if (sys.effectType === "reroll") add("Rerrolar", "Mecânica ao usar: usada no chat");
      else if (sys.effectType === "damage") add(`Dano · ${target}`, "Mecânica ao usar", "hp");
      else if (sys.effectType === "temporary") add(`Efeito · ${target}`, "Mecânica ao usar");
      if (sys.resistanceTarget) {
        const percent = Math.round(computeResistancePercent(sys.resistanceTarget, sys.level) * 100);
        const element = sys.resistanceTarget === "general" ? "Geral" : getActiveDamageElements().find(el => el.id === sys.resistanceTarget)?.label ?? sys.resistanceTarget;
        add(`Resist. ${element} ${percent}%`, "Resistência passiva", "gold");
      }
      if (sys.weaponMastery && isWeaponMasteryEnabled()) add(masterySentenceFor(sys).replace(/ · .*$/, "") || "Maestria", "Maestria de arma (passiva)", "gold");
      if ((sys.fusionSources ?? []).length) add(`Fusão de ${sys.fusionSources.length}`, "Linhagem de fusão");
      if (sys.isItemGranted) add("Concedida", "Concedida por Item/Módulo — fixa");
      break;
    }
    case "starship_module": {
      const role = moduleRole(sys.category);
      add(getModuleCategories().find(c => c.id === sys.category)?.label ?? sys.category, "Categoria", "violet");
      add(NIHILITY.MODULE_SIZE_LABELS[sys.moduleSize] ?? sys.moduleSize, "Porte");
      if (sys.powerConsumption) add(`${sys.powerConsumption} ${getStarshipEnergyAbbr()}`, "Consumo de energia a 100%");
      add(`Vida ${sys.hp?.max ?? 0}`, "Vida máxima");
      const key = {
        weapon: () => `${sys.damageFormula || "?"} · Pen ${sys.penetration ?? 0}%`,
        power: () => `gera ${sys.reactorOutput ?? 0}`,
        storage: () => `guarda ${sys.batteryCapacity ?? 0}`,
        distribution: () => `Fator ×${fmt(sys.transferFactor ?? 1)}`,
        shield: () => `Escudo ${sys.shieldCapacity ?? 0}`,
        propulsion: () => `Acel ${sys.acceleration ?? 0} · Rot ${sys.rotation ?? 0}`,
        armor: () => `Redução ${sys.armorReduction ?? 0}%`,
        ftl: () => (sys.ftlType === "jump" ? `Salto ${sys.jumpRange ?? 0}` : `Dobra ${fmt(sys.warpFactor ?? 1)}`)
      }[role];
      if (key) add(key(), "Número-chave da Função", "accent");
      break;
    }
    case "item": {
      if (sys.equipped) add("Equipado", "", "ok");
      if (sys.quantity > 1) add(`×${sys.quantity}`, "Quantidade");
      if (sys.value?.amount) {
        const currency = getActiveCurrencies().find(c => c.id === sys.value.currency)?.label ?? sys.value.currency;
        add(`${sys.value.amount} ${currency}`, "Valor");
      }
      if (sys.weapon?.enabled) add(`Arma · ${sys.weapon.damageFormula || "?"}`, "Dano", "accent");
      if (sys.weapon?.enabled && sys.weapon.magazineSize > 0) {
        const mag = magazineState({ size: sys.weapon.magazineSize, loaded: sys.weapon.loaded, capacity: sys.weapon.loadedAmmo?.capacity });
        add(`Carregador ${mag.loaded}/${mag.max}`, "Disparos antes de recarregar");
      }
      if (sys.ammo?.enabled && sys.ammo.capacity > 0) add(`Carga ${sys.ammo.capacity}`, "Disparos por unidade numa arma com Carregador");
      if (sys.consumable?.enabled) add(sys.consumable.charges > 1 ? `Consumível · ${sys.consumable.charges} cargas` : "Consumível", "Botão Usar no inventário", "accent");
      if (sys.container?.enabled) add(`Contêiner · ${sys.container.slots} slots`, "Guarda outros Itens");
      if (sys.ammo?.enabled) add(`Munição · ${getAmmoTypes().find(a => a.id === sys.ammo.type)?.label ?? "?"}`, "Munição", "accent");
      if (sys.grantsSkill?.name) add(`concede: ${sys.grantsSkill.name}`, "Habilidade Concedida", "violet");
      break;
    }
    case "title": {
      if (sys.rarity) add(sys.rarity, "Raridade", "gold");
      if (sys.grantedBy) add(sys.grantedBy, "Concedido por");
      if ((sys.bonuses ?? []).length) add(`${sys.bonuses.length} bônus`, "Bônus permanentes");
      if ((sys.resistances ?? []).length) add(`${sys.resistances.length} resistência(s)`, "Resistências");
      break;
    }
    case "body_part": {
      if (sys.slot) add(sys.slot, "Slot", "violet");
      add(`Vida ${sys.hp?.value ?? 0}/${sys.hp?.max ?? 0}`, "Vida");
      if (sys.isProsthetic) add("Protética", "", "accent");
      if ((sys.installedMods ?? []).length) add(`${sys.installedMods.length} modificação(ões)`, "Modificações instaladas");
      break;
    }
  }
  if ((sys.conditionalModifiers ?? []).length) add(`${sys.conditionalModifiers.length} condicional(is)`, "Bônus Condicionais", "gold");
  return chips;
}

/**
 * Abas por tipo, cada uma respondendo uma pergunta (princípio B): "o que é", "o que faz ao
 * usar", "o que dá sempre". A primeira é a que abre — nunca a Descrição. `count` é o número ou
 * a nota ao lado do nome ("dano", "3", "—"); `led` é o indicador de ligado/desligado.
 */
function tabsFor(item) {
  const sys = item.system;
  const n = value => (value ? String(value) : "");
  switch (item.type) {
    case "skill": {
      const mechanic = isStructureMechanic(sys)
        ? "estrutura"
        : sys.effectType === "form"
        ? "forma"
        : sys.effectType === "analysis"
        ? "análise"
        : sys.effectType === "predation"
        ? "predação"
        : sys.effectType === "reroll"
        ? "rerrolar"
        : { damage: "dano", temporary: `${(sys.effects ?? []).length} ef.` }[sys.effectType] ?? "";
      const passives =
        (sys.resistanceTarget ? 1 : 0) +
        (sys.weaponMastery ? 1 : 0) +
        (sys.statModifiers?.hp ? 1 : 0) +
        (sys.statModifiers?.energy ? 1 : 0) +
        (sys.attributeBonuses ?? []).length +
        (sys.conditionalModifiers ?? []).length +
        (sys.onHit?.conditionId ? 1 : 0);
      return [
        { id: "general", label: "Geral" },
        { id: "mechanic", label: "Mecânica", count: mechanic },
        { id: "passive", label: "Passivos", count: n(passives) },
        { id: "subskills", label: "Sub-Skills", count: n((sys.subSkills ?? []).length) },
        { id: "description", label: "Descrição" }
      ];
    }
    case "item": {
      const whileEquipped =
        (sys.grantsSkill?.name ? 1 : 0) +
        (sys.statModifiers?.hp ? 1 : 0) +
        (sys.statModifiers?.energy ? 1 : 0) +
        (sys.attributeBonuses ?? []).length +
        (sys.conditionalModifiers ?? []).length;
      return [
        { id: "general", label: "Geral" },
        { id: "weapon", label: "Arma", led: true, ledOn: Boolean(sys.weapon?.enabled) },
        { id: "consumable", label: "Consumível", led: true, ledOn: Boolean(sys.consumable?.enabled) },
        ...(isAnatomyEnabled() ? [{ id: "implant", label: "Implante", led: true, ledOn: Boolean(sys.implant?.enabled) }] : []),
        ...(isDevicesEnabled()
          ? [
              { id: "device", label: "Placa", led: true, ledOn: Boolean(sys.device?.enabled) },
              { id: "program", label: "Programa", led: true, ledOn: Boolean(sys.program?.enabled) }
            ]
          : []),
        { id: "equipped", label: sys.implant?.enabled ? "Enquanto instalado" : "Enquanto equipado", count: n(whileEquipped) },
        { id: "description", label: "Descrição" }
      ];
    }
    case "starship_module":
      return [
        { id: "spec", label: "Especificação" },
        { id: "grant", label: "Habilidade Concedida", count: sys.grantsSkill?.name ? "1" : "—" },
        { id: "description", label: "Descrição" }
      ];
    case "body_part":
      return [
        { id: "details", label: "Detalhes" },
        { id: "mods", label: "Modificações", count: n((sys.installedMods ?? []).length) },
        { id: "description", label: "Descrição" }
      ];
    default:
      return [
        { id: "details", label: "Detalhes" },
        { id: "description", label: "Descrição" }
      ];
  }
}

/** Linhas prontas do editor de Bônus Condicionais (opções já com `selected`). */
function conditionalModifierRows(list, { activeSkill = false, isSkill = false } = {}) {
  const pickList = (pairs, current) => pairs.map(([value, label]) => ({ value, label, selected: String(value) === String(current ?? "") }));
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const elements = getActiveDamageElements().map(e => [e.id, e.label]);
  const attributeLabels = getAttributeLabels();
  const attributes = NIHILITY.COMBAT_ATTRIBUTES.map(k => [k, attributeLabels[k] ?? k]);

  return list.map((mod, index) => {
    const whenKind = mod.when?.kind || "always";
    const thenKind = mod.then?.kind || "damagePercent";
    const valueSource = { otherTrait: traits, otherCondition: conditions, otherConditionMine: conditions, selfCondition: conditions, element: elements }[whenKind];
    let targetOptions = null;
    if (thenKind === "rollFlat") targetOptions = pickList([["any", "qualquer atributo"], ...attributes], mod.then?.target);
    else if (thenKind === "attributeFlat" || thenKind === "attributePercent") targetOptions = pickList(attributes, mod.then?.target);
    else if (thenKind === "resistancePercent") targetOptions = pickList([["general", "Geral"], ...elements], mod.then?.target);
    return {
      index,
      whenOptions: pickList(WHEN_KINDS.map(k => [k, WHEN_LABELS[k]]), whenKind),
      whenValueOptions: valueSource ? pickList(valueSource, mod.when?.value) : null,
      needsThreshold: whenKind === "selfHpBelow" || whenKind === "otherHpBelow",
      threshold: mod.when?.threshold ?? 50,
      thenOptions: pickList(THEN_KINDS.map(k => [k, THEN_LABELS[k]]), thenKind),
      targetOptions,
      value: mod.then?.value ?? 0,
      perEachOptions: pickList(PER_EACH_KINDS.map(k => [k, PER_EACH_LABELS[k]]), mod.perEach ?? ""),
      // Escala (1.120.0): "a cada N níveis da Skill" só numa Skill (a fonte precisa de nível); "vezes a escuridão" em qualquer fonte.
      showPerLevels: isSkill,
      perLevels: Number(mod.perLevels) || 0,
      timesDarkness: Boolean(mod.timesDarkness),
      // Só numa Skill Ativa (8c.1): vale ligada (o padrão), desligada ou sempre.
      activeStateOptions: activeSkill ? pickList([["on", "só ligada"], ["off", "só desligada"], ["always", "sempre"]], mod.activeState || "on") : null,
      // Bônus contínuo de atributo não sabe quem é o oponente nem qual o elemento.
      warning: (thenKind === "attributeFlat" || thenKind === "attributePercent") && !SELF_WHEN_KINDS.includes(whenKind) ? "Bônus no atributo só vale com condição sobre você mesmo." : ""
    };
  });
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
    tierLabel: NIHILITY.SKILL_TIER_LABELS[grantsSkill.tier] ?? grantsSkill.tier,
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

/** A nota ao fim do efeito de Espaço, por modo (alcance, o que o Bolso dá agora, o corte da Âncora no Domínio). */
function spaceNoteFor(entry, sys) {
  const mode = normalizeSpaceMode(entry.spaceMode);
  if (mode === "pocket") return `agora: ${pocketSlots({ base: entry.pocketBase ?? POCKET_DEFAULTS.base, perLevel: entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel, level: sys.level })} espaços (nível ${Number(sys.level) || 0}), sem peso`;
  if (mode === "domain") return "Preso: quem tem uma Skill espacial de nível maior escapa";
  return Number(sys.range) > 0 ? `alcance ${String(sys.range).replace(".", ",")} m` : "sem alcance: ponha o da Skill";
}

/**
 * Unidade da Duração no card de Efeito: curta, porque cabe numa coluna estreita ao lado da lixeira;
 * o que o 0 quer dizer em cada alvo vai no `title` (o texto longo passava por cima da lixeira).
 */
function effectDurationUnit(entry, { hasUpkeep, periodic }) {
  const t = entry.target;
  if (t === "push") return { durationUnit: "", durationHint: "" };
  if (t === "space" && ["portal", "domain"].includes(normalizeSpaceMode(entry.spaceMode))) {
    return hasUpkeep ? { durationUnit: "ativa", durationHint: "Dura enquanto a Habilidade Ativa estiver ligada" } : { durationUnit: "rod.", durationHint: "Rodadas que o Portal ou o Domínio dura (0 = até o Mestre fechar). Em combate conta pelo turno de quem abriu; fora dele, pelo relógio do mundo." };
  }
  if (t === "space") return { durationUnit: "", durationHint: "Instantâneo: Saltar e Trocar não têm duração (o Bolso é permanente)" };
  if (t === "createSurface") return { durationUnit: "rod.", durationHint: "Rodadas da superfície (0 = a duração do elemento)" };
  if (t === "timeRate" && entry.timeRewind) return { durationUnit: "voltam", durationHint: "Rodadas que voltam" };
  if (["flight", "burrow", "timeRate"].includes(t) || isSenseTarget(t)) {
    return hasUpkeep ? { durationUnit: "ativa", durationHint: "Dura enquanto a Habilidade Ativa estiver ligada" } : { durationUnit: "rod.", durationHint: "Rodadas (0 = até ser desfeito)" };
  }
  if (t === "mark") return { durationUnit: "rod.", durationHint: "Rodadas da Marca (0 = até ser desfeita)" };
  if (["antimagic", "emp"].includes(t)) return { durationUnit: "rod.", durationHint: "Rodadas de supressão (0 = até tirar)" };
  if (hasUpkeep) return { durationUnit: "ativa", durationHint: "Dura enquanto a Habilidade Ativa estiver ligada" };
  return periodic ? { durationUnit: "ticks", durationHint: "Quantos ticks o Periódico dá" } : { durationUnit: "rod.", durationHint: "Rodadas" };
}

/**
 * Liga um listener uma única vez por elemento: as peças são renderizadas separadamente, então
 * `_onRender` pode passar de novo por um elemento que não foi trocado.
 */
function bindOnce(element, key, type, handler) {
  const bound = (element._nihilityBound ??= new Set());
  if (bound.has(key)) return;
  bound.add(key);
  element.addEventListener(type, handler);
}

/** Caminho do template de uma peça da ficha de Item. */
const itemPart = name => `systems/${SYSTEM_ID}/templates/parts/item-${name}.hbs`;
/** Peça de aba: a própria seção rola e o núcleo guarda a posição entre renderizações. */
const tabPart = name => ({ template: itemPart(name), scrollable: [""] });

/** Peças de cada tipo de Item, na ordem em que entram na janela (cabeçalho, abas, conteúdo). */
const PARTS_BY_TYPE = {
  skill: ["header", "tabs", "skillGeneral", "skillMechanic", "skillPassive", "skillSubskills", "description"],
  item: ["header", "tabs", "itemGeneral", "itemWeapon", "itemConsumable", "itemImplant", "itemDevice", "itemProgram", "itemEquipped", "description"],
  starship_module: ["header", "tabs", "moduleSpec", "moduleGrant", "description"],
  body_part: ["header", "tabs", "bodyDetails", "bodyMods", "description"],
  default: ["header", "tabs", "titleDetails", "description"]
};

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
      pickElements: NihilityItemSheet.#onPickElements,
      pickEffectTraits: NihilityItemSheet.#onPickEffectTraits,
      removeEffectTrait: NihilityItemSheet.#onRemoveEffectTrait,
      toggleAmmoType: NihilityItemSheet.#onToggleAmmoType,
      toggleModuleFunction: NihilityItemSheet.#onToggleModuleFunction,
      toggleImplantList: NihilityItemSheet.#onToggleImplantList,
      uninstallDeviceProgram: NihilityItemSheet.#onUninstallDeviceProgram,
      removeElement: NihilityItemSheet.#onRemoveElement,
      showEffectCondition: NihilityItemSheet.#onShowEffectCondition,
      editEffectLight: NihilityItemSheet.#onEditEffectLight,
      browseAnimations: NihilityItemSheet.#onBrowseAnimations,
      pickAnimationFile: NihilityItemSheet.#onPickAnimationFile,
      toggleWeaponAmmoType: NihilityItemSheet.#onToggleWeaponAmmoType,
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
      levelUpSkill: NihilityItemSheet.#onLevelUpSkill,
      requestForm: NihilityItemSheet.#onRequestForm,
      useStoredForm: NihilityItemSheet.#onUseStoredForm,
      spendPointLevelUp: NihilityItemSheet.#onSpendPointLevelUp,
      addTitleResistance: NihilityItemSheet.#onTitleResistanceAdd,
      deleteTitleResistance: NihilityItemSheet.#onTitleResistanceDelete,
      editImage: NihilityItemSheet.#onEditImage,
      editGrantedSkill: NihilityItemSheet.#onEditGrantedSkill,
      clearGrantedSkill: NihilityItemSheet.#onClearGrantedSkill,
      addGrantedSubSkill: NihilityItemSheet.#onAddGrantedSubSkill,
      editGrantedSubSkill: NihilityItemSheet.#onEditGrantedSubSkill,
      deleteGrantedSubSkill: NihilityItemSheet.#onDeleteGrantedSubSkill,
      scrollToEffect: NihilityItemSheet.#onScrollToEffect,
      saveAsTemplate: NihilityItemSheet.#onSaveAsTemplate,
      createSetFromItem: NihilityItemSheet.#onCreateSetFromItem
    }
  };

  /**
   * Uma peça pro cabeçalho, uma pra barra de abas e uma por (tipo, aba): os ids de aba se repetem
   * entre tipos ("general", "details"…) com conteúdo diferente, então cada combinação tem o seu
   * arquivo e `_configureRenderParts` só deixa as do tipo do Item. A aba é um `<section class="tab
   * sheet-body">` — o núcleo troca de aba sem renderizar (`changeTab`) e a própria seção rola
   * (`scrollable: [""]`, o núcleo guarda a posição entre renderizações).
   */
  static PARTS = {
    header: { template: itemPart("header") },
    tabs: { template: itemPart("tabs") },
    skillGeneral: tabPart("skill-general"),
    skillMechanic: tabPart("skill-mechanic"),
    skillPassive: tabPart("skill-passive"),
    skillSubskills: tabPart("skill-subskills"),
    itemGeneral: tabPart("general"),
    itemWeapon: tabPart("weapon"),
    itemConsumable: tabPart("consumable"),
    itemImplant: tabPart("implant"),
    itemDevice: tabPart("device"),
    itemProgram: tabPart("program"),
    itemEquipped: tabPart("equipped"),
    moduleSpec: tabPart("module-spec"),
    moduleGrant: tabPart("module-grant"),
    titleDetails: tabPart("title-details"),
    bodyDetails: tabPart("body-details"),
    bodyMods: tabPart("body-mods"),
    description: tabPart("description")
  };

  /** As abas variam por tipo e têm contador/led: a lista vem de `_getTabsConfig` (`tabsFor`). */
  static TABS = { primary: { tabs: [], initial: null } };

  /** Lista de abas desta renderização (`tabsFor` + avisos), montada em `_prepareContext`. */
  #tabsConfig = null;

  /**
   * Linhas de Efeito com "+ Condição" aberto (estado de tela, nada é salvo): a Condição e o Ícone
   * ficam dobrados até alguém pedir ou até a linha já ter um dos dois.
   */
  #openConditionRows = new Set();

  /**
   * "Avançado ▸" aberto/fechado à mão nesta janela (K1; estado de tela, nada é salvo). Chave da
   * seção ("cost", "presentation", "damage", "eff-<índice>") → aberto? Sem escolha, abre sozinho
   * quando algum campo de dentro tem valor (advancedFold).
   */
  #advOpen = new Map();

  /**
   * @override
   * O layout da ficha (.nihility-sheet, flex em coluna) vivia numa <div> que envolvia cabeçalho,
   * abas e corpo. Com as peças irmãs dentro do .window-content, as classes vão nele: o resto do CSS
   * (todo descendente de .nihility-sheet.item-sheet) segue valendo sem mudar.
   */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.querySelector(".window-content")?.classList.add("nihility-sheet", "item-sheet", `type-${this.item.type}`);
    return frame;
  }

  /** @override Só as peças do tipo deste Item. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const wanted = new Set(PARTS_BY_TYPE[this.item.type] ?? PARTS_BY_TYPE.default);
    for (const id of Object.keys(parts)) if (!wanted.has(id)) delete parts[id];
    // Placas e programas desligados: as abas somem (os dados guardados ficam como estão).
    if (!isDevicesEnabled()) {
      delete parts.itemDevice;
      delete parts.itemProgram;
    }
    return parts;
  }

  /** @override */
  _getTabsConfig(group) {
    if (group !== "primary") return null;
    const tabs = this.#tabsConfig ?? tabsFor(this.item);
    return { tabs, initial: tabs[0].id };
  }

  /**
   * @override
   * A aba tem filhos (contador, led, aviso): o alvo do clique pode ser um deles, e o núcleo lê o
   * `data-tab` só do alvo. Sobe até o elemento da aba.
   */
  /** Abrir a Descrição/Biografia pela 1ª vez redesenha o editor já visível (ver helpers/sheet-tabs.js). */
  changeTab(tab, group, options = {}) {
    super.changeTab(tab, group, options);
    refreshEditorOnTabShow(this, tab, group);
  }

  _onClickTab(event) {
    const button = event.target.closest("[data-tab]");
    if (!button || button.classList.contains("active") || event.button !== 0) return;
    this.changeTab(button.dataset.tab, button.dataset.group, { event, navElement: button.closest(".tabs") });
  }

  /**
   * @override
   * Sem isso o título da janela cai no formato padrão do Foundry ("TYPES.Item.skill: nome"),
   * que mostra a chave de tradução crua quando ninguém registrou esse label em lang/*.json.
   */
  get title() {
    return this.item.name;
  }

  /** "ver ↓" de um aviso: leva ao card do Efeito e pisca. */
  static #onScrollToEffect(event, target) {
    event.preventDefault();
    const card = this.element.querySelector(`.effect-card[data-index="${target.dataset.index}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("sa-flash");
    void card.offsetWidth;
    card.classList.add("sa-flash");
  }

  /** "Salvar como modelo" (L7, só o Mestre): uma cópia desta Skill vai para os Modelos de Skill. */
  static async #onSaveAsTemplate(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const { templateFromSkill } = await import("../skills/skill-template-rules.js");
    const current = getActiveSkillTemplates().map(t => foundry.utils.deepClone(t));
    const entry = templateFromSkill(this.item.name, this.item.toObject().system, current.map(t => t.id));
    current.push(entry);
    await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.skillTemplatesData, JSON.stringify(current, null, 2));
    ui.notifications.info(`"${this.item.name}" virou um Modelo de Skill (Configurações Gerais › Personagem › Modelos de Skill).`);
  }

  /** "Criar conjunto com este Item…" (Mestre): abre o catálogo de Conjuntos já com esta peça num conjunto novo. */
  static async #onCreateSetFromItem(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const { openItemSetsConfig } = await import("../apps/item-sets-config.js");
    openItemSetsConfig({ fromItem: this.item });
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
    const item = this.item;
    const sys = item.system;
    context.system = sys;
    // Quem não é dono vê a descrição como HTML pronto ({{{ }}}): passa pela limpeza do Foundry, que
    // tira script e atributos de evento (onerror…) — a descrição pode ter vindo de outro jogador.
    context.descriptionHTML = foundry.utils.cleanHTML?.(String(sys.description ?? "")) ?? escapeHtml(String(sys.description ?? ""));
    context.config = NIHILITY;
    context.itemType = item.type;
    context.inventoryEnabled = isInventoryEnabled();
    // Alcance e Marcas (H4): desligado, os campos somem da ficha (o que está salvo fica).
    context.skillRangeOn = isSkillRangeEnabled();
    context.luckEnabled = isLuckEnabled();
    context.currencies = getActiveCurrencies();
    context.item = item;
    context.owner = item.isOwner;
    // Ficha travada (Compêndio trancado, ou a Skill de um pedido aberta só para ler): os botões
    // de Mestre que gravam ("+ Nível", "Salvar como modelo"…) somem junto com os campos.
    context.isGM = game.user.isGM && this.isEditable;
    context.resistancesEnabled = isResistancesEnabled();
    context.conditionsEnabled = isStatusConditionsEnabled();
    context.sequencerActive = sequencerAvailable();
    context.scaleEnabled = isScaleEnabled();
    context.energyLabel = getCharacterEnergyLabel();
    // Natureza (Mágico / Tecnológico): as caixas mostram o valor de hoje, mesmo o que vem do automático.
    context.natureMagic = isMagicUse(sys, this.item.parent);
    context.natureTech = isTechUse(sys, this.item.parent);
    context.itemTech = itemIsTech(sys);
    context.interferenceEnabled = isInterferenceEnabled();
    // Lojas (G2): "Venda em lojas" no Item Geral e no Módulo de nave.
    context.shopsEnabled = isShopsEnabled() && ["item", "starship_module"].includes(item.type);
    if (context.shopsEnabled) {
      const shop = normalizeItemShop(sys.shop);
      context.shopTagsText = shop.tags.join(", ");
      context.advShop = advancedFold(
        [
          { label: "Repor para", used: shop.restockTo !== null },
          { label: "Preço fixo", used: shop.priceOverride !== null },
          { label: "Digital", used: shop.digital },
          { label: "Prazo de entrega", used: shop.deliveryHours !== null },
          { label: "Etiquetas", used: shop.tags.length > 0 }
        ],
        this.#advOpen.get("shop")
      );
    }
    // Conjuntos (J12): o campo "Conjunto" do Item Geral e do Módulo (escolher aqui = ser peça do conjunto).
    context.itemSetsEnabled = isItemSetsEnabled() && ["item", "starship_module"].includes(item.type);
    if (context.itemSetsEnabled) {
      const current = String(sys.itemSet ?? "");
      const sets = getActiveItemSets().filter(set => setFitsItemType(set, item.type));
      context.itemSetOptions = [
        { id: "", label: "(nenhum)", selected: !current },
        ...sets.map(set => ({ id: set.id, label: set.label, selected: set.id === current })),
        ...(current && !sets.some(set => set.id === current) ? [{ id: current, label: `${current} (não existe no catálogo)`, selected: true }] : [])
      ];
    }
    context.energyAbbr = getStarshipEnergyAbbr();
    // Seletores de bônus de Atributo (Título, Item, Modificação) usam os rótulos e a
    // visibilidade atuais — atributo oculto sai da lista de opções novas.
    context.visibleAttributes = getVisibleAttributes();
    context.effectTargetLabels = getEffectTargetLabels();

    const helpers = this.#contextHelpers(context);

    if (item.type === "skill") this.#prepareSkillAssist(context);
    if (item.type === "item") this.#prepareGenericItemContext(context, helpers);
    if (item.type === "starship_module") this.#prepareModuleContext(context, helpers);
    if (item.type === "title") this.#prepareTitleContext(context);
    if (item.type === "body_part") {
      context.modGrantSummaries = (sys.installedMods ?? []).map((mod, index) =>
        grantedSkillSummary(mod.grantsSkill, `system.installedMods.${index}.grantsSkill`)
      );
    }
    if (["title", "skill", "item"].includes(item.type)) {
      context.conditionalRows = conditionalModifierRows(sys.conditionalModifiers ?? [], { activeSkill: item.type === "skill" && Boolean(sys.hasUpkeep), isSkill: item.type === "skill" });
    }

    context.headerChips = headerChipsFor(item);
    const tabList = tabsFor(item);
    // Avisos (L8): um número na aba que tem o problema.
    if (context.assist) for (const tab of tabList) tab.warn = context.assist.byTab[tab.id] ?? 0;
    this.#tabsConfig = tabList;
    // Aba guardada que não existe neste tipo (ou primeira abertura): cai na primeira, que é
    // sempre a dos campos — nunca a Descrição.
    if (!tabList.some(tab => tab.id === this.tabGroups.primary)) this.tabGroups.primary = tabList[0].id;
    context.tabs = this._prepareTabs("primary");

    debugLog(`${SYSTEM_ID} | NihilityItemSheet._prepareContext (${item.type}):`, item.name);
    return context;
  }

  /**
   * @override
   * O que só uma aba usa é calculado aqui, na hora de renderizar a peça dela (o contexto é o mesmo
   * objeto de `_prepareContext`). Hoje é o miolo das abas de Skill.
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (this.item.type !== "skill") return context;
    const helpers = this.#contextHelpers(context);
    switch (partId) {
      case "skillGeneral": this.#prepareSkillGeneral(context, helpers); break;
      case "skillMechanic": this.#prepareSkillMechanic(context, helpers); break;
      case "skillPassive": this.#prepareSkillPassive(context, helpers); break;
      case "skillSubskills": this.#prepareSkillSubskills(context); break;
    }
    return context;
  }

  /** Ajudantes de opções (`selected`/`checked` prontos) que os preparos de contexto compartilham. */
  #contextHelpers(context) {
    return {
      pick: (list, current) => list.map(([value, label]) => ({ value, label, selected: value === current })),
      seg: (list, current) => list.map(([value, label, title]) => ({ value, label, title: title ?? "", checked: value === current })),
      scaleOptions: current =>
        [{ id: "", label: "— a de quem ataca —" }, ...getScaleConfig().scales].map(s => ({ ...s, selected: s.id === (current ?? "") })),
      // Atributo escondido pela campanha continua listado se o dano JÁ escala por ele.
      scalingOptions: current => {
        const visible = context.visibleAttributes;
        const choices = [["", "— sem escala —"], ...visible.map(a => [a.key, a.label])];
        if (current && !visible.some(a => a.key === current)) choices.push([current, `${getAttributeLabel(current)} (oculto)`]);
        return choices.map(([value, label]) => ({ value, label, selected: value === (current ?? "") }));
      }
    };
  }

  /**
   * Editor de Skill assistido (L8 avisos + L9 custo sugerido; canvas "Editor de Skill Assistido").
   * Fica no contexto base: o número de avisos aparece na barra de abas e os avisos em duas peças.
   */
  #prepareSkillAssist(context) {
    const owner = this.item.parent;
    const assist = skillAssist(this.item.system, { actor: owner?.documentName === "Actor" ? owner : null });
    if (!assist.enabled) return;
    context.assist = assist;
    context.assistGeneral = assist.warnings.filter(w => w.tab === "general");
    context.assistMechanic = assist.warnings.filter(w => w.tab === "mechanic");
    context.costChipHtml = costChipHtml(assist.cost, "system.cost");
    context.upkeepChipHtml = costChipHtml(assist.upkeep && assist.cost ? { ...assist.cost, suggested: assist.upkeep.suggested, close: assist.upkeep.close, rows: [], holder: null } : null, "system.upkeepCost");
  }

  /** Aba Geral da Skill: Tier, "Só se…", Custo e Apresentação. */
  #prepareSkillGeneral(context, { pick }) {
    const sys = this.item.system;
    const owner = this.item.parent;

    // Jogador pode comprar 1 nível de Skill com 1 Ponto de Habilidade do tier dela (Racial/
    // Ultimate não têm Pontos). O Mestre já tem o "+ Nível" livre, então o botão é só do jogador.
    context.canSpendPointLevel =
      !game.user.isGM && this.item.isOwner && Boolean(owner) && isSkillPointsEnabled() && NIHILITY.SKILL_POINT_TIERS.includes(sys.tier);
    context.levelPointBalance = owner?.system?.skillPoints?.[sys.tier] ?? 0;
    // Nível máximo automático (1.124.0): no máximo, some o "+ Nível" e a ficha diz qual é o próximo passo.
    const maxLevel = sys.resistanceTarget || sys.weaponMastery ? Infinity : skillMaxLevel(sys);
    context.atMaxLevel = Number(sys.level) >= maxLevel;
    context.maxLevelText = Number.isFinite(maxLevel) ? `${MAX_LEVEL_TEXT} (nível ${maxLevel})` : "";
    context.canSpendPointLevel = context.canSpendPointLevel && !context.atMaxLevel;

    const hasUltimate = owner?.system?.hasUltimateSkill ?? sys.tier === "ultimate";
    const visibleTiers = NIHILITY.SKILL_TIERS.filter(t => t !== "ultimate" || hasUltimate || game.user.isGM);
    context.isRacialSkill = sys.tier === "racial";
    context.skillTierOptions = pick(visibleTiers.filter(t => t !== "racial").map(t => [t, NIHILITY.SKILL_TIER_LABELS[t]]), sys.tier);

    // "Avançado ▸" das seções (K1): os campos raros, cada um dizendo se está em uso.
    const adv = (key, fields) => advancedFold(fields, this.#advOpen.get(key));
    // "Só se…" da Skill inteira (8c.1): antes de pagar o Custo, depois de escolher o alvo.
    const skillOnlyIf = normalizeOnlyIf(sys.onlyIf) ?? { kind: "", value: "", threshold: 50 };
    const onlyIfWants = onlyIfNeeds(skillOnlyIf.kind);
    context.skillOnlyIf = {
      kindOptions: [{ value: "", label: "— sempre —", selected: !skillOnlyIf.kind }].concat(ONLY_IF_KINDS.map(k => ({ value: k, label: ONLY_IF_LABELS[k], selected: k === skillOnlyIf.kind }))),
      needsCondition: onlyIfWants === "condition",
      needsTrait: onlyIfWants === "trait",
      needsThreshold: onlyIfWants === "threshold",
      conditionOptions: getActiveStatusConditions().map(c => ({ value: c.id, label: c.label, selected: c.id === skillOnlyIf.value })),
      traitOptions: getActiveTraits().map(t => ({ value: t.id, label: t.label, selected: t.id === skillOnlyIf.value })),
      threshold: skillOnlyIf.threshold
    };
    // Complexidade por Tier (8c.1): só informa; nunca trava.
    context.skillComplexity = complexityVerdict(sys, sys.tier, getComplexityCaps());
    context.advCost = adv("cost", [
      { label: "Só se… (a Skill inteira)", used: hasOnlyIf(sys.onlyIf) },
      { label: `Variar a ${context.energyLabel}`, used: Boolean(sys.variableMana) },
      { label: "Mágico / Tecnológico", used: Boolean(sys.isTech) || sys.isMagic === false || sys.magicTag === "mundane" }
    ]);
    context.advPresentation = adv("presentation", [{ label: "Gatilho Emocional", used: Boolean(sys.emotionTrigger) }]);
    context.canSaveTemplate = game.user.isGM;
  }

  /** Aba Mecânica da Skill: tipo, alvo, área, Forma, Estrutura, Rerrolar, dano e os cards de Efeito. */
  #prepareSkillMechanic(context, { seg, scaleOptions, scalingOptions }) {
    const sys = this.item.system;

    // Mecânica ao Usar: Estrutura é uma mecânica (não um Tipo de Alvo). Bloco desligado pela
    // campanha sai da lista, a não ser que a Skill já esteja nele.
    const mechanicType = isStructureMechanic(sys) ? "structure" : sys.effectType;
    context.skillMechanicType = mechanicType;
    context.skillEffectTypeSeg = seg(
      NIHILITY.SKILL_EFFECT_TYPES.filter(t => (t !== "structure" || isStructuresEnabled() || mechanicType === "structure") && (t !== "form" || isFormsEnabled() || mechanicType === "form") && (t !== "analysis" || isAnalysisEnabled() || mechanicType === "analysis") && (t !== "predation" || isPredationEnabled() || mechanicType === "predation") && (t !== "reroll" || isRerollEnabled() || mechanicType === "reroll")).map(t => [
        t,
        NIHILITY.SKILL_EFFECT_TYPE_SHORT_LABELS[t],
        NIHILITY.SKILL_EFFECT_TYPE_LABELS[t]
      ]),
      mechanicType
    );
    // Análise e Predação (7b) têm sempre alvo único: só o Alcance aparece, sem o Tipo de Alvo.
    context.skillTargetIsFixed = mechanicType === "analysis" || mechanicType === "predation";
    context.skillShowsTarget = mechanicType === "damage" || mechanicType === "temporary" || context.skillTargetIsFixed;
    const areaOn = isAreaEffectsEnabled();
    context.skillTargetTypeSeg = seg(
      NIHILITY.SKILL_TARGET_TYPES.filter(t => areaOn || !["emission", "zone"].includes(t) || t === sys.targetType).map(t => [
        t,
        NIHILITY.SKILL_TARGET_TYPE_SHORT_LABELS[t],
        NIHILITY.SKILL_TARGET_TYPE_LABELS[t]
      ]),
      sys.targetType
    );
    context.skillIsArea = !context.skillTargetIsFixed && (sys.targetType === "emission" || sys.targetType === "zone");
    // Alcance não faz diferença numa Skill "Si mesmo". Origem da forma: sem valor salvo vale "livre".
    context.skillRangeShown = context.skillRangeOn && (context.skillTargetIsFixed || sys.targetType !== "self");
    context.skillAreaOriginSeg = seg(
      [
        ["caster", "Sai de quem lança", "A forma sai do Token de quem lança (ou da Marca): o círculo fica em volta dele, o cone e a linha só giram."],
        ["free", "Livre", "A forma é posta onde quiser, dentro do alcance."]
      ],
      sys.areaOrigin ?? "free"
    );
    context.skillAreaAffectsSeg = seg(AREA_AFFECTS_OPTIONS, sys.areaAffects ?? "all");
    // Combinada (8c.2): "Ao usar" só aparece numa Skill com Sub-Skills; o resto da aba some enquanto ela vale.
    const subCount = (sys.subSkills ?? []).length;
    context.skillHasSubSkills = subCount > 0;
    context.skillCombined = isCombinedSkill(sys);
    context.skillCombinedSeg = seg(
      [
        ["false", "Escolher uma Sub-Skill", "Usar pergunta qual Sub-Skill disparar."],
        ["true", "Combinada · todas juntas", "Usar dispara todas as Sub-Skills em ordem, nos mesmos alvos. O Custo é pago uma vez."]
      ],
      String(Boolean(sys.combined))
    );
    context.skillCombinedHint = combinedHint(subCount);
    context.skillStructurePlaceSeg = seg(STRUCTURE_PLACE_OPTIONS, sys.structurePlace ?? "click");
    context.skillIntruderSeg = seg(INTRUDER_RULE_OPTIONS, sys.intruderRule ?? "");
    // Rerrolar (8d.2): usada no chat; só aparecem as três escolhas dela.
    context.skillIsReroll = mechanicType === "reroll";
    if (context.skillIsReroll) {
      context.rerollWhoSeg = seg(REROLL_WHO.map(w => [w, REROLL_WHO_LABELS[w]]), sys.rerollWho ?? "own");
      context.rerollKeepSeg = seg(rerollKeepOptions(sys.tier).concat(sys.rerollKeep === "choose" && sys.tier !== "ultimate" ? ["choose"] : []).map(k => [k, REROLL_KEEP_LABELS[k]]), sys.rerollKeep ?? "new");
      const kinds = normalizeRerollKinds(sys.rerollKinds);
      context.rerollKindRows = REROLL_KIND_KEYS.map(k => ({ key: k, label: REROLL_KIND_LABELS[k], checked: kinds[k] }));
    }
    context.skillAreaShapeSeg = seg(
      NIHILITY.SKILL_AREA_SHAPES.filter(Boolean).map(s => [s, NIHILITY.SKILL_AREA_SHAPE_LABELS[s]]),
      sys.areaShape
    );

    // Forma (H5): a ficha-molde da mecânica (nome e se ainda existe).
    if (mechanicType === "form") {
      const template = formTemplateOf(sys);
      context.skillFormName = template?.name ?? "";
      context.skillFormMissing = Boolean(sys.formActorUuid) && !template;
      context.skillFormCanRequest = !game.user.isGM && isFormsEnabled();
    }

    // Predação (1.120.0): "O que ela leva" e, em "Só formas", as formas guardadas (Sub-Skills de Forma) com Transformar/Voltar.
    if (mechanicType === "predation") {
      context.predationTakesSeg = seg([["all", "Tudo"], ["forms", "Só formas"]], sys.predationTakes === "forms" ? "forms" : "all");
      context.predationFormsOnly = sys.predationTakes === "forms";
      context.predationStoredForms = (sys.subSkills ?? [])
        .map((sub, index) => ({ sub, index }))
        .filter(({ sub }) => sub?.effectType === "form")
        .map(({ sub, index }) => ({ index, name: String(sub.name ?? "").replace(/^Forma:s*/, "") || "Forma", active: Boolean(sub.active), canUse: Boolean(this.item.parent) }));
    }

    const structures = getStructures();
    context.skillStructureOptions = structures.map(st => ({ value: st.id, label: st.label, selected: st.id === sys.structureId }));
    const structure = structures.find(st => st.id === sys.structureId);
    // Concentração (1.119.0): o padrão do nível e o intervalo de tamanhos na hora de usar (quadro "Tamanho e concentração").
    context.areaNote = concentrationNote(
      sys.effectType === "structure" ? (structure ? resolveStructureArea(structure.size, sys) : null) : ["emission", "zone"].includes(sys.targetType) ? resolveMechArea(sys) : null
    );
    if (structure) {
      const life = structure.manaPowered ? `barreira de mana (o dano sai da ${context.energyLabel} de quem ergueu)` : `Vida ${structure.hp}`;
      const material = structure.material === "ethereal" ? "etérea" : "física";
      const duration = structure.durationRounds > 0 ? `${structure.durationRounds} rodada(s)` : sys.hasUpkeep ? "até desligar a Skill" : "até o Mestre derrubar";
      context.skillStructureSummary = `${NIHILITY.STRUCTURE_SHAPE_LABELS[structure.shape] ?? structure.shape} · tamanho ${structure.size} · ${material} · ${life} · ${duration}`;
    }

    context.skillScalingOptions = scalingOptions(sys.scalingAttribute);
    context.damageScaleOptions = scaleOptions(sys.damageScale);
    context.skillElementField = selectedElementChips(sys.damageElements);

    // Golpe de arma (H6): o Tipo de arma que a Skill usa ao atacar.
    context.weaponMasteryOn = isWeaponMasteryEnabled();
    const strike = sys.weaponStrike ?? "";
    context.skillStrikeIsWeapon = Boolean(strike) && strike !== "unarmed";
    context.skillStrikeOptions = [{ value: "", label: "— nenhum —", selected: !strike }, ...weaponTypeChoices(strike).map(o => ({ ...o, selected: o.value === strike }))];

    // "Avançado ▸" da seção Dano (K1).
    context.advDamage = advancedFold(
      [
        { label: "Dano Absoluto", used: Boolean(sys.isAbsoluteDamage) },
        context.scaleEnabled ? { label: "Escala do golpe", used: Boolean(sys.damageScale) } : null
      ],
      this.#advOpen.get("damage")
    );

    context.skillEffects = this.#effectCards(context);
    // Avisos do editor assistido (L8) em cada card de Efeito.
    if (context.assist) {
      for (const card of context.skillEffects) {
        card.warnings = context.assist.byEffect[card.index] ?? null;
        card.warnLevel = card.warnings?.some(w => w.level === "hard") ? "hard" : "soft";
      }
    }
  }

  /** Aba Passivos da Skill: Resistência, Maestria e "Ao acertar". */
  #prepareSkillPassive(context, { pick, seg }) {
    const sys = this.item.system;

    context.skillResistanceOptions = pick(
      [["", "— nenhuma —"], ...getResistanceTargetOptions().map(o => [o.value, o.label])],
      sys.resistanceTarget ?? ""
    );
    const resistanceTarget = sys.resistanceTarget ?? "";
    context.isResistanceSkill = resistanceTarget !== "";
    if (context.isResistanceSkill) {
      context.resistanceMaxLevel = resistanceMaxLevel(resistanceTarget);
      context.resistancePercent = Math.round(computeResistancePercent(resistanceTarget, sys.level) * 100);
      context.skillResistanceName = computeResistanceName(resistanceTarget, sys.level);
    }

    // Maestria de arma (H6): passiva, de um Tipo de arma. Só se oferece com o recurso ligado (ou se a Skill já é uma).
    const masteryType = sys.weaponMastery ?? "";
    const masteryOn = isWeaponMasteryEnabled();
    context.showMasterySection = masteryOn || Boolean(masteryType);
    context.skillMasteryOptions = [{ value: "", label: "— nenhuma —", selected: !masteryType }, ...weaponTypeChoices(masteryType).map(o => ({ ...o, selected: o.value === masteryType }))];
    context.isMasterySkill = Boolean(masteryType) && masteryOn;
    if (context.isMasterySkill) {
      context.masterySentence = masterySentenceFor(sys);
      context.masteryMaxLevel = masteryConfig().maxLevel;
      context.masteryEvolved = (Number(sys.masteryRank) || 1) >= 2;
      context.masteryRank = Number(sys.masteryRank) || 1;
    }

    // "Ao acertar" (8c.1): a Condição que todo golpe seu põe no alvo.
    const onHit = normalizeOnHit(sys.onHit) ?? { conditionId: "", chance: 100, rounds: 0, when: "always" };
    context.skillOnHit = {
      set: Boolean(onHit.conditionId),
      conditionOptions: [{ value: "", label: "— nenhuma —", selected: !onHit.conditionId }].concat(getActiveStatusConditions().map(c => ({ value: c.id, label: c.label, selected: c.id === onHit.conditionId }))),
      chance: sys.onHit?.chance ?? 100,
      rounds: onHit.rounds,
      pierce: Boolean(onHit.pierce),
      whenSeg: seg(ON_HIT_WHEN.map(w => [w, ON_HIT_WHEN_LABELS[w]]), onHit.when),
      showWhen: Boolean(sys.hasUpkeep)
    };
  }

  /** Aba Sub-Skills da Skill. */
  #prepareSkillSubskills(context) {
    context.subSkillRows = (this.item.system.subSkills ?? []).map((sub, index) => ({
      index,
      name: sub.name,
      tier: sub.tier,
      tierLabel: NIHILITY.SKILL_TIER_LABELS[sub.tier] ?? sub.tier,
      mechanic: mechanicSummaryFor(sub)
    }));
  }

  /**
   * Um card por Efeito Temporário: selo do grupo do alvo, frase-resumo montada dos próprios
   * campos e só os extras que o alvo pede (prancheta 5 do redesenho). As opções já vêm com
   * `selected`, pro template não depender da profundidade de {{#each}} aninhado.
   */
  #effectCards(context) {
    const sys = this.item.system;
    const labels = getEffectTargetLabels();
    const conditions = getActiveStatusConditions();
    const elements = getActiveDamageElements();
    const groupClasses = ["attr", "vit", "arma", "nave"];
    const onShip = ["starship", "vehicle"].includes(this.item.parent?.type);
    const signed = n => (n > 0 ? `+${n}` : `${n}`);

    const effectsPath = this.#effectsPath();
    return (foundry.utils.getProperty(this.item, effectsPath) ?? []).map((entry, index) => {
      // Periódico: Vida/Mana de Personagem e Casco/Integridade de Nave (dano contínuo, reparo por rodada).
      const acceptsPeriodic = ["hp", "energy", "shipCasco", "shipHull"].includes(entry.target);
      const periodic = acceptsPeriodic && Boolean(entry.periodic);
      const isShipTarget = NIHILITY.SHIP_EFFECT_TARGETS.includes(entry.target);
      const groupIndex = NIHILITY.EFFECT_TARGET_GROUPS.findIndex(g => g.targets.includes(entry.target));
      const amount = Number(entry.amount) || 0;
      const targetLabel = labels[entry.target] ?? entry.target;
      const condition = conditions.find(c => c.id === entry.conditionId);

      let summary;
      if (["weaponElement", "bodyElement"].includes(entry.target)) summary = `${targetLabel} → ${elements.find(el => el.id === entry.elementId)?.label ?? "?"}`;
      else if (entry.target === "createSurface") summary = `Cria ${elements.find(el => el.id === entry.elementId)?.surface?.label || elements.find(el => el.id === entry.elementId)?.label || "?"}${amount > 0 ? ` (raio ${amount} m)` : ""}`;
      else if (entry.target === "unarmedType") summary = `${targetLabel} → ${entry.weaponTypeId ? weaponTypeDisplay(entry.weaponTypeId) : "?"}`;
      else if (entry.target === "push") summary = `${{ pull: "Puxa", choose: "Empurra ou puxa" }[entry.pushDirection] ?? "Empurra"} ${amount} m`;
      else if (["flight", "burrow"].includes(entry.target)) summary = targetLabel;
      else if (entry.target === "luck") summary = `Sorte ${describeLuck(luckFromScopes(amount, entry.luckScopes)) || "(sem escopo)"}`;
      else if (entry.target === "space") summary = `Espaço: ${spaceShortLabel(entry)}${entry.spaceWalls && ["jump", "swap"].includes(normalizeSpaceMode(entry.spaceMode)) ? " (respeita paredes)" : ""}`;
      else if (entry.target === "timeRate" && entry.timeRewind) summary = `Reverter ${Math.max(0, Math.floor(Number(entry.durationRounds) || 0))} rod.`;
      else if (entry.target === "timeRate" && entry.timeStop) summary = "Parar o tempo";
      else if (entry.target === "timeRate") summary = `${Number(entry.timeFactor ?? 2) < 1 ? "Desacelerar" : "Acelerar"} ${describeTimeFactor(entry.timeFactor ?? 2)}`;
      else if (entry.target === "dispelMagic") summary = `Dissipar: ${entry.dispelScope === "condition" ? `só ${condition?.label ?? "uma Condição"}` : entry.dispelScope === "marks" ? "só marcas" : "todo efeito mágico"} (nv ≤ ${Number(sys.level) || 0})`;
      else if (entry.target === "magicDampen") summary = `Magia enfraquecida: ${Number(entry.chance ?? 100)}% das magias saem com ${amount}% da força`;
      else if (isSenseTarget(entry.target)) summary = `${SENSE_LABELS[entry.target]} ${describeSenseRange(senseRangeValue(amount))}`;
      else if (isShipTarget && entry.modifierType === "multiplier") summary = `${targetLabel} ×${(1 + amount / 100).toFixed(2).replace(".", ",")}`;
      else summary = `${targetLabel} ${signed(amount)}${entry.amountMode === "percentMax" && PERCENT_AMOUNT_TARGETS.includes(entry.target) ? (ATTRIBUTE_PERCENT_TARGETS.includes(entry.target) ? "% do total" : "% do máx.") : ""}${periodic ? " por tick" : ""}`;
      const extra = [];
      if (entry.target === "push") extra.push("na hora");
      else if (sys.hasUpkeep) extra.push("enquanto ativa");
      else if (entry.target === "shield") extra.push("até absorver");
      else extra.push(`${entry.durationRounds} ${periodic ? "tick(s)" : "rodada(s)"}`);
      if (condition) extra.push(condition.label);
      const onlyIfNow = normalizeOnlyIf(entry.onlyIf) ?? { kind: "", value: "", threshold: 50 };
      if (hasOnlyIf(entry.onlyIf) && entry.target !== "push") extra.push(`só se ${onlyIfClause(entry.onlyIf, (kind, value) => (kind === "otherTrait" ? getActiveTraits().find(t => t.id === value)?.label : conditions.find(c => c.id === value)?.label) ?? value)}`);
      if (periodic && entry.target === "hp" && Number(entry.amount) > 0 && entry.healKind && entry.healKind !== "cura") extra.push(NIHILITY.HEAL_KIND_LABELS[entry.healKind] ?? entry.healKind);
      if (entry.target === "shield" && entry.damageElements?.length) {
        extra.push(`Escudo de ${entry.damageElements.map(id => elements.find(el => el.id === id)?.label ?? id).join(" + ")}`);
      }
      if (periodic && entry.damageElements?.length) {
        extra.push(entry.damageElements.map(id => elements.find(el => el.id === id)?.label ?? id).join(" + "));
      }

      // Nave primeiro numa Skill de Nave; num Personagem, na ordem de sempre.
      let targetGroups = getEffectTargetGroups(entry.target);
      if (onShip) targetGroups = [...targetGroups.filter(g => g.label === "Nave"), ...targetGroups.filter(g => g.label !== "Nave")];

      const showCondition = context.conditionsEnabled && entry.target !== "dispelMagic" && Boolean(entry.conditionId || entry.icon || this.#openConditionRows.has(index));
      const isCurse = Boolean(condition?.curse?.enabled);
      const isHeal = periodic && entry.target === "hp" && Number(entry.amount) > 0;
      const isShield = entry.target === "shield";
      const hasElements = Boolean(entry.damageElements?.length);
      const isPush = entry.target === "push";
      const acceptsDrain = targetAcceptsDrain(entry.target, periodic) && amount < 0;
      // "Avançado ▸" do card (K1): Periódico fica à vista (muda o que a Duração quer dizer);
      // vai para dentro só o que poucos Efeitos usam.
      const advFold = advancedFold(
        [
          !isPush ? { label: "Só se…", used: hasOnlyIf(entry.onlyIf) } : null,
          entry.target !== "magicDampen" ? { label: "Chance", used: Number(entry.chance) > 0 && Number(entry.chance) < 100 } : null,
          acceptsDrain ? { label: "Drenar", used: Boolean(entry.drain) } : null,
          entry.target === "reflect" ? { label: "Só o que o Escudo segura", used: Boolean(entry.reflectShieldOnly) } : null,
          periodic ? { label: "Elemento do tick", used: hasElements } : null,
          isPush ? { label: "Elemento do empurrão", used: hasElements } : null,
          isPush ? { label: "Traços que não saem do lugar", used: Boolean(entry.immuneTraits?.length) } : null,
          isHeal ? { label: "Tipo de cura", used: Boolean(entry.healKind) && entry.healKind !== "cura" } : null,
          isShield ? { label: "Elemento do escudo", used: hasElements } : null,
          isShield && sys.hasUpkeep ? { label: "Escudo mantido", used: Boolean(Number(entry.shieldRegen) || Number(entry.shieldCap)) } : null,
          isShield ? { label: "Luz", used: Boolean(entry.light?.enabled) } : null,
          isCurse && showCondition ? { label: "Sem Mana para pagar", used: Boolean(entry.curseOnUnpaid) } : null
        ],
        this.#advOpen.get(`eff-${index}`)
      );
      return {
        adv: advFold,
        advKey: `eff-${index}`,
        // "Só se…" (8.1a): tipo + o que ele pede (Condição, Traço ou limite em %).
        onlyIfShown: !isPush,
        onlyIfKindOptions: [{ value: "", label: "— sempre —", selected: !onlyIfNow.kind }].concat(ONLY_IF_KINDS.map(k => ({ value: k, label: ONLY_IF_LABELS[k], selected: k === onlyIfNow.kind }))),
        onlyIfCondition: onlyIfNeeds(onlyIfNow.kind) === "condition",
        onlyIfTrait: onlyIfNeeds(onlyIfNow.kind) === "trait",
        onlyIfThreshold: onlyIfNeeds(onlyIfNow.kind) === "threshold",
        onlyIfThresholdValue: onlyIfNow.threshold,
        onlyIfConditionOptions: conditions.map(c => ({ value: c.id, label: c.label, selected: c.id === onlyIfNow.value })),
        onlyIfTraitOptions: getActiveTraits().map(t => ({ value: t.id, label: t.label, selected: t.id === onlyIfNow.value })),
        index,
        amount,
        // Chance do efeito (1.123.0/1.124.0): vazio/100 = sempre; abaixo, "40% de deixar Atordoado". A progressão por chance a faz subir.
        chanceShown: entry.target !== "magicDampen",
        chanceValue: Number(entry.chance) > 0 && Number(entry.chance) < 100 ? Number(entry.chance) : 100,
        acceptsDrain,
        drain: Boolean(entry.drain),
        isReflect: entry.target === "reflect",
        reflectShieldOnly: Boolean(entry.reflectShieldOnly),
        isPurify: entry.target === "purify",
        isRevive: entry.target === "revive",
        isScry: entry.target === "scry",
        hasCondition: Boolean(condition),
        piercesCondition: Boolean(entry.piercesCondition),
        durationRounds: entry.durationRounds,
        ...effectDurationUnit(entry, { hasUpkeep: sys.hasUpkeep, periodic }),
        isAntimagic: ["antimagic", "emp"].includes(entry.target),
        isMark: entry.target === "mark",
        isDispel: entry.target === "dispelMagic",
        dispelScopeOptions: DISPEL_SCOPES.map(sc => ({ value: sc, label: DISPEL_SCOPE_LABELS[sc], selected: sc === (entry.dispelScope || "all") })),
        dispelNeedsCondition: entry.dispelScope === "condition",
        dispelLevel: Number(sys.level) || 0,
        isSpace: entry.target === "space",
        isSwap: normalizeSpaceMode(entry.spaceMode) === "swap",
        isTeleport: ["jump", "swap"].includes(normalizeSpaceMode(entry.spaceMode)),
        isPortal: normalizeSpaceMode(entry.spaceMode) === "portal",
        isPocket: normalizeSpaceMode(entry.spaceMode) === "pocket",
        isDomain: normalizeSpaceMode(entry.spaceMode) === "domain",
        spaceOtherScene: Boolean(entry.spaceOtherScene),
        spaceRadius: Number(entry.spaceRadius) || 0,
        spaceTimeRate: Number(entry.spaceTimeRate ?? 1),
        pocketBase: Number(entry.pocketBase ?? POCKET_DEFAULTS.base),
        pocketPerLevel: Number(entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel),
        pocketNow: pocketSlots({ base: entry.pocketBase ?? POCKET_DEFAULTS.base, perLevel: entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel, level: sys.level }),
        spaceTimeOn: isTimeManipulationEnabled(),
        spaceModeOptions: liveSpaceModes().map(m => ({ value: m.id, label: m.label, selected: m.id === normalizeSpaceMode(entry.spaceMode) })),
        spaceWalls: Boolean(entry.spaceWalls),
        spaceSwapOther: Boolean(entry.spaceSwapOther),
        spaceNote: spaceNoteFor(entry, sys),
        isTimeRate: entry.target === "timeRate",
        timeFactor: Number(entry.timeFactor ?? 2),
        timeStop: Boolean(entry.timeStop),
        timeRewind: Boolean(entry.timeRewind),
        isLuck: entry.target === "luck",
        luckScopeAttributes: Boolean(entry.luckScopes?.attributes),
        luckScopeDamage: Boolean(entry.luckScopes?.damage),
        luckScopeChances: Boolean(entry.luckScopes?.chances),
        isDampen: entry.target === "magicDampen",
        dampenChance: Number(entry.chance ?? 100),
        isPush,
        isSense: isSenseTarget(entry.target),
        isMovementMode: ["flight", "burrow"].includes(entry.target),
        movementModeNote: entry.target === "flight" ? "quem usa pode voar (subir no mapa)" : "quem usa pode cavar (descer abaixo do chão)",
        pushDirectionOptions: [["push", "Empurrar"], ["pull", "Puxar"], ["choose", "Escolher ao usar"]].map(([value, label]) => ({ value, label, selected: value === (entry.pushDirection || "push") })),
        traitField: selectedTraitChips(entry.immuneTraits),
        antimagicReach: Math.floor((Number(sys.level) || 0) * getAntimagicReach() + 1e-9),
        icon: entry.icon ?? "",
        summary,
        summaryExtra: extra.join(" · "),
        groupLabel: NIHILITY.EFFECT_TARGET_GROUPS[groupIndex]?.label ?? "—",
        groupClass: groupClasses[groupIndex] ?? "",
        targetGroups,
        isUnarmedType: entry.target === "unarmedType",
        weaponTypeIdOptions: entry.target === "unarmedType" ? weaponTypeChoices(entry.weaponTypeId ?? "").map(o => ({ ...o, selected: o.value === (entry.weaponTypeId ?? "") })) : [],
        isElementTarget: ["weaponElement", "bodyElement", "createSurface"].includes(entry.target),
        elementIdOptions: elements.map(el => ({ value: el.id, label: el.label, selected: el.id === entry.elementId })),
        acceptsPeriodic,
        periodic,
        isShipTarget,
        showCondition,
        canOpenCondition: context.conditionsEnabled && !showCondition && context.editable,
        isShieldTarget: entry.target === "shield",
        shieldRegen: entry.shieldRegen ?? 0,
        shieldCap: entry.shieldCap ?? 0,
        lightSummary: describeLight(entry.light),
        lightOn: Boolean(entry.light?.enabled),
        hasExtras: showCondition || acceptsPeriodic || isShipTarget || isPush,
        conditionOptions: [{ value: "", label: "— sem Condição —", selected: !entry.conditionId }].concat(
          conditions.map(c => ({ value: c.id, label: c.label, selected: c.id === entry.conditionId }))
        ),
        tickUnitOptions: NIHILITY.PERIODIC_TICK_UNITS.map(u => ({
          value: u, label: NIHILITY.PERIODIC_TICK_UNIT_LABELS[u], selected: u === entry.tickUnit
        })),
        // Maldição: o que fazer sem Mana, só para esta Skill ("" = o da maldição).
        isCurse,
        curseUnpaidOptions: [["", "Como na maldição"], ["hp", "Paga com Vida"], ["sleep", "Dorme"], ["worsen", "Piora"], ["continue", "Continua igual"]].map(([value, label]) => ({ value, label, selected: value === (entry.curseOnUnpaid ?? "") })),
        // Periódico de Vida positivo = cura: Cura / Regeneração / Reparo nas Partes do Corpo.
        isHeal,
        healKindOptions: NIHILITY.HEAL_KINDS.map(k => ({
          value: k, label: NIHILITY.HEAL_KIND_LABELS[k], hint: NIHILITY.HEAL_KIND_HINTS[k], selected: k === (entry.healKind || "cura")
        })),
        modifierTypeOptions: NIHILITY.EFFECT_MODIFIER_TYPES.map(m => ({
          value: m, label: NIHILITY.EFFECT_MODIFIER_TYPE_LABELS[m], selected: m === (entry.modifierType || "flat")
        })),
        elementField: selectedElementChips(entry.damageElements),
        elementPath: `${effectsPath}.${index}.damageElements`,
        // Vida, Mana e Escudo aceitam "% do máximo do alvo" (Poção de 25%).
        acceptsPercent: PERCENT_AMOUNT_TARGETS.includes(entry.target),
        percentLabel: ATTRIBUTE_PERCENT_TARGETS.includes(entry.target) ? "% total" : "% máx.",
        isPercent: entry.amountMode === "percentMax"
      };
    });
  }

  #prepareGenericItemContext(context, { scaleOptions, scalingOptions, seg }) {
    // Implante (board 5): slots conhecidos (das partes de todas as Espécies e Heranças) e Funções.
    const implant = this.item.system.implant ?? {};
    const slots = new Set(implant.fitsSlots ?? []);
    const knownSlots = new Set();
    for (const entry of Object.values(getActiveSpeciesPresets())) for (const p of entry.parts ?? []) if (p.slot) knownSlots.add(p.slot);
    for (const h of getActiveHeritages()) for (const p of h.parts ?? []) if (p.slot) knownSlots.add(p.slot);
    for (const s of slots) knownSlots.add(s);
    context.implantSlotChips = [...knownSlots].sort().map(id => ({ id, checked: slots.has(id) }));
    const fns = new Set(implant.functions ?? []);
    context.implantFunctionChips = getActiveBodyFunctions().map(f => ({ id: f.id, label: f.label, checked: fns.has(f.id) }));
    context.implantIsProsthesis = implant.kind === "prosthesis";
    context.implantHpFixed = implant.hpMode === "fixed";
    const weapon = this.item.system.weapon;
    context.weaponScalingOptions = scalingOptions(weapon.scalingAttribute);
    context.weaponScaleOptions = scaleOptions(weapon.damageScale);
    context.weaponElementField = selectedElementChips(weapon.damageElements);
    // Tipo de arma (H6): só com o recurso ligado. O tipo salvo continua escolhido (mesmo fora do catálogo).
    context.weaponMasteryOn = isWeaponMasteryEnabled();
    context.weaponTypeOptions = [{ value: "", label: "— sem tipo —", selected: !weapon.weaponType }, ...weaponTypeChoices(weapon.weaponType ?? "").map(o => ({ ...o, selected: o.value === (weapon.weaponType ?? "") }))];
    // Modo da arma (J1): Dano ou Gravidade (empurra e puxa). Só se oferece com o recurso ligado (ou se já é de gravidade).
    context.weaponGravity = weapon.mode === "gravity";
    context.weaponModeOn = isForcedMovementEnabled() || context.weaponGravity;
    context.weaponModeSeg = seg([["damage", "Dano"], ["gravity", "Gravidade (empurra e puxa)"]], weapon.mode === "gravity" ? "gravity" : "damage");
    const ammo = this.item.system.ammo ?? {};
    context.ammoElementField = selectedElementChips(ammo.damageElements ?? []);
    context.ammoTypeOptions = [{ id: "", label: "—" }, ...getAmmoTypes()].map(a => ({ id: a.id, label: a.label, selected: a.id === (ammo.type ?? "") }));
    context.ammoSizeOptions = [["", "qualquer"], ...NIHILITY.MODULE_SIZES.map(s => [s, NIHILITY.MODULE_SIZE_LABELS[s]])].map(([id, label]) => ({
      id, label, selected: id === (ammo.minLauncherSize ?? "")
    }));
    context.grantSummary = grantedSkillSummary(this.item.system.grantsSkill, "system.grantsSkill");

    // Carregador (C7): tipos de munição aceitos como chips, e o que está dentro.
    const accepted = new Set(weapon.ammoTypes ?? []);
    context.weaponAmmoChips = getAmmoTypes().map(a => ({ id: a.id, label: a.label, checked: accepted.has(a.id) }));
    const mag = magazineState({ size: weapon.magazineSize, loaded: weapon.loaded, capacity: weapon.loadedAmmo?.capacity });
    context.weaponLoadedLabel = mag.uses ? `${mag.loaded}/${mag.max}${weapon.loadedAmmo?.label ? ` · ${weapon.loadedAmmo.label}` : ""}` : "";

    // Consumível (J6): o mesmo vocabulário da Skill (Efeito/Dano, em si/alvo/área) e o mesmo
    // editor de Efeitos (partial nihility.effectCards, caminho system.consumable.effects).
    const consumable = this.item.system.consumable ?? {};
    // Placa e Programa (Lote 9). A Reserva atual só o Mestre edita; os programas instalados saem pelo "Tirar" (Item de um Ator).
    context.devicesEnabled = isDevicesEnabled();
    if (context.devicesEnabled) {
      const device = normalizeDevice(this.item.system.device);
      context.deviceNatureSeg = seg([["tech", "Tecnológica"], ["technomagic", "Tecnomágica"]], device.nature);
      context.deviceAcceptsSeg = seg([["any", "Qualquer programa"], ["invasion", "Só de Invasão"], ["weapon", "Só de arma"]], device.accepts);
      context.deviceStateLabel = { normal: "normal", off: "desligada (curto leve)", damaged: "danificada" }[device.state];
      const layout = slotLayout(device, device.programs);
      context.devicePrograms = layout.programs;
      context.deviceSlotsFree = layout.free;
      context.deviceOwned = Boolean(this.item.parent?.documentName === "Actor");
      context.deviceIsGM = game.user.isGM;
      context.programFitsSeg = seg([["any", "Qualquer placa"], ["weapon", "Só de arma"]], this.item.system.program?.fits ?? "any");
      const invasion = this.item.system.program?.invasion ?? {};
      context.programInvasionFold = advancedFold(
        [
          { label: "Minigame", used: Boolean(invasion.enabled) },
          { label: "Alvo", used: Boolean(invasion.enabled) },
          { label: "Preparo", used: Number(invasion.prepRounds) > 0 }
        ],
        this.#advOpen.get("invasion")
      );
    }
    context.consumableEffectTypeSeg = seg([["temporary", "Efeito"], ["damage", "Dano"]], consumable.effectType ?? "temporary");
    context.consumableTargetSeg = seg(
      [["self", "Em si", "Quem usa"], ["targeted", "Num alvo", "Escolhe o alvo como numa Skill"], ["emission", "Área", "Posiciona a forma no mapa, como uma Emissão"]],
      consumable.targetType ?? "self"
    );
    context.consumableAreaSeg = seg([["circle", "Círculo"], ["cone", "Cone"], ["ray", "Linha"]], consumable.areaShape ?? "circle");
    context.consumableIsDamage = consumable.effectType === "damage";
    context.consumableIsArea = consumable.targetType === "emission";
    context.consumableScalingOptions = scalingOptions(consumable.scalingAttribute);
    context.consumableElementField = selectedElementChips(consumable.damageElements ?? []);
    context.consumableEffects = this.#effectCards(context);
  }

  #prepareModuleContext(context, { seg }) {
    const sys = this.item.system;
    // Categoria do catálogo editável; os campos da ficha seguem a FUNÇÃO dela (ver MODULE_ROLES).
    const categories = getModuleCategories();
    context.moduleRole = moduleRole(sys.category);
    context.moduleRoleLabel = NIHILITY.MODULE_ROLES[context.moduleRole]?.label ?? context.moduleRole;
    context.moduleCategoryOptions = categories.map(c => ({
      id: c.id,
      label: c.label,
      slots: Number(c.slots) || 0,
      roleLabel: NIHILITY.MODULE_ROLES[c.role]?.label ?? c.role,
      selected: c.id === sys.category
    }));
    // Categoria que sumiu do catálogo continua na lista, senão salvar a ficha a trocaria.
    if (!categories.some(c => c.id === sys.category)) {
      context.moduleCategoryOptions.push({ id: sys.category, label: `${sys.category} (fora do catálogo)`, slots: 0, roleLabel: context.moduleRoleLabel, selected: true });
    }
    context.moduleSizeSeg = seg(NIHILITY.MODULE_SIZES.map(size => [size, NIHILITY.MODULE_SIZE_LABELS[size]]), sys.moduleSize);
    context.moduleElementField = selectedElementChips(sys.damageElements);
    context.shieldElementField = selectedElementChips(sys.shieldElements ?? []);
    const accepted = new Set(sys.ammoTypes ?? []);
    context.launcherAmmoChips = getAmmoTypes().map(a => ({ id: a.id, label: a.label, checked: accepted.has(a.id) }));
    context.cargoSlotsPreview = cargoSlotsFor(sys.moduleSize, sys.cargoMultiplier);
    // Funções extras (F1/F2): cada uma liga um bloco de campos. Só aparecem com o bloco ligado (o que está salvo fica).
    const sensorsOn = isVesselsEnabled() && isShipSensorsEnabled();
    const boardingOn = isVesselsEnabled() && isBoardingEnabled();
    const chosen = new Set(sys.functions ?? []);
    const available = [
      ...(sensorsOn || chosen.has("sensor") ? [["sensor", "Sensor"]] : []),
      ...(sensorsOn || chosen.has("camouflage") ? [["camouflage", "Camuflagem"]] : []),
      ...(sensorsOn || chosen.has("scanBlock") ? [["scanBlock", "Bloqueio de varredura"]] : []),
      ...(boardingOn || chosen.has("teleporter") ? [["teleporter", "Teletransportador"]] : []),
      ...(boardingOn || chosen.has("dock") ? [["dock", "Eclusa (acoplagem)"]] : [])
    ];
    context.moduleFunctionChips = available.map(([id, label]) => ({ id, label, checked: chosen.has(id) }));
    context.hasFunctionChips = available.length > 0;
    context.fnSensor = chosen.has("sensor");
    context.fnCamouflage = chosen.has("camouflage");
    context.fnScanBlock = chosen.has("scanBlock");
    context.fnTeleporter = chosen.has("teleporter");
    context.fnDock = chosen.has("dock");
    context.sensorsFeatureOn = sensorsOn;
    context.moduleScanBlockRoles = sensorsOn && ["shield", "armor"].includes(context.moduleRole);
    context.moduleFireSignature = sensorsOn && context.moduleRole === "weapon";
    context.grantSummary = grantedSkillSummary(sys.grantsSkill, "system.grantsSkill");

    if (context.moduleRole === "shield" && sys.adaptive) {
      // "Phaser (freq. 412) 30%": o que este Escudo instalado já aprendeu.
      const elements = getActiveDamageElements();
      context.adaptationRows = Object.entries(this.item.getFlag(SYSTEM_ID, "shieldAdaptation") ?? {})
        .filter(([, percent]) => percent > 0)
        .map(([key, percent]) => {
          const [elementId, frequency] = key.split("@");
          const name = elementId === "none" ? "sem elemento" : elements.find(e => e.id === elementId)?.label ?? elementId;
          return { label: Number(frequency) ? `${name} (freq. ${frequency})` : name, percent };
        });
    }
    if (context.moduleRole === "distribution") {
      // "Fator 5" não diz nada sozinho: a Capacidade de Transferência sai de
      // `baseline(Porte) × fator`, e a tabela de baseline mora no código. Sem ver o RESULTADO,
      // não há como calibrar o número — nem quem escreveu o Módulo, nem quem recebe ele pronto.
      const factor = Number(sys.transferFactor) || 0;
      context.distributorPreview = {
        abbr: context.energyAbbr,
        // Portes do tipo da Nave onde o Módulo está (Nave, se estiver solto).
        rows: getVesselSizes(vesselKind(this.item.parent)).map(size => ({
          label: size.label,
          baseline: size.distributorBaseline,
          result: Math.round(size.distributorBaseline * factor),
          // Destaca a linha do Porte da Nave onde ESTE Módulo está instalado, quando está.
          current: this.item.parent?.system?.shipSize === size.id
        }))
      };
    }
  }

  #prepareTitleContext(context) {
    const sys = this.item.system;
    const labels = context.effectTargetLabels;
    const visible = new Set(context.visibleAttributes.map(a => a.key));
    // Alvos agrupados como no editor de Efeito, limitados a TITLE_BONUS_TARGETS. Atributo oculto
    // pela campanha sai da lista, a não ser que a linha já o use.
    context.titleBonusRows = (sys.bonuses ?? []).map((bonus, index) => {
      const allowed = NIHILITY.TITLE_BONUS_TARGETS.filter(
        t => !NIHILITY.COMBAT_ATTRIBUTES.includes(t) || visible.has(t) || t === bonus.attribute
      );
      const option = t => ({ value: t, label: labels[t] ?? t, selected: t === bonus.attribute });
      return {
        index,
        amount: bonus.amount,
        groups: [
          { label: "Atributos", options: allowed.filter(t => NIHILITY.COMBAT_ATTRIBUTES.includes(t)).map(option) },
          { label: "Vitais", options: allowed.filter(t => !NIHILITY.COMBAT_ATTRIBUTES.includes(t)).map(option) }
        ].filter(group => group.options.length)
      };
    });
    // Cada entrada de Resistência do Título já tem um alvo escolhido — sem opção "Nenhuma".
    const resistanceTargets = getResistanceTargetOptions();
    context.titleResistances = (sys.resistances ?? []).map(entry => ({
      ...entry,
      targetOptions: resistanceTargets.map(opt => ({ ...opt, selected: opt.value === entry.target }))
    }));
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
    const modMatch = path.match(/^system\.installedMods\.(\d+)\.grantsSkill$/);
    const mod = modMatch ? this.item.system.installedMods?.[Number(modMatch[1])] : null;
    const nature = this.item.type === "starship_module" ? { tech: true } : mod ? { magic: Boolean(mod.magic), tech: Boolean(mod.tech) } : itemNature(this.item.system);
    const refreshed = await refreshGrantedSkill(this.item.parent, saved, this._grantSourceKey(path), nature);
    if (refreshed) ui.notifications.info(`"${saved.name}" foi atualizada na ficha.`);
  }

  static async #onEditGrantedSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});

    const data = await openSkillEditorDialog(
      { ...current, subSkills: [] },
      { tierChoices: NIHILITY.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM }
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

    const data = await openSkillEditorDialog({ tier: current.tier }, { tierChoices: NIHILITY.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
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

    const data = await openSkillEditorDialog(sub, { tierChoices: NIHILITY.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
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
    const merged = mergeSubmittedArrays(data, this.item);
    // "Só se…" da Skill (8c.1): trocar o tipo não deixa o valor do tipo anterior para trás.
    const onlyIf = merged?.system?.onlyIf;
    if (onlyIf) {
      const needs = onlyIfNeeds(onlyIf.kind);
      const ids = needs === "condition" ? getActiveStatusConditions().map(c => c.id) : needs === "trait" ? getActiveTraits().map(t => t.id) : null;
      onlyIf.value = ids ? (ids.includes(onlyIf.value) ? onlyIf.value : ids[0] ?? "") : "";
    }
    return merged;
  }

  /**
   * @override
   * O toggle de equipar (type "item") dispara em "change", não em clique — a API de
   * `actions` só cobre clique, então esse listener é ligado manualmente aqui.
   */
  /**
   * @override
   * A ficha é a mesma instância depois de fechar (`item.sheet`): o estado de tela ("+ Condição"
   * aberto, "Avançado ▸" aberto/fechado à mão) tem de ser esquecido aqui, senão a próxima
   * abertura herda o que o usuário fez da última vez.
   */
  _onClose(options) {
    super._onClose(options);
    this.#advOpen.clear();
    this.#openConditionRows.clear();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    markVisibleEditorParts(this.element);
    // "Avançado ▸" (K1): lembra o que o usuário abriu/fechou até a janela fechar. O clique no
    // <summary> ainda não mudou o `open` aqui — o novo estado é o inverso do atual.
    this.element.querySelectorAll("details.adv[data-adv-key] > summary").forEach(summary => {
      bindOnce(summary, "adv", "click", () => {
        const details = summary.parentElement;
        this.#advOpen.set(details.dataset.advKey, !details.open);
      });
    });
    if (!this.isEditable) return;
    // Forma (H5): arrastar a ficha-molde para o campo.
    const formDrop = this.element.querySelector("[data-form-drop]");
    if (formDrop) {
      bindOnce(formDrop, "dragover", "dragover", event => event.preventDefault());
      bindOnce(formDrop, "drop", "drop", async event => {
        event.preventDefault();
        const data = getDragEventData(event);
        const doc = data?.uuid ? await fromUuid(data.uuid) : null;
        if (doc?.documentName !== "Actor" || doc.type !== "character") return ui.notifications.warn("Arraste uma ficha de Personagem marcada como molde de forma.");
        if (!doc.system.formTemplate) ui.notifications.warn(`${doc.name} não está marcada como "Molde de forma" (caixa no cabeçalho da ficha).`);
        await this.document.update({ "system.formActorUuid": doc.uuid });
      });
    }
    // "usar" do custo sugerido (L9): copia o número para o campo e salva como uma edição comum.
    this.element.querySelectorAll("[data-sa-use]").forEach(link =>
      bindOnce(link, "saUse", "click", event => {
        event.preventDefault();
        const input = this.element.querySelector(`[name="${link.dataset.saUse}"]`);
        if (!input) return;
        input.value = link.dataset.value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      })
    );

    this.element.querySelectorAll(".item-equip-toggle").forEach(checkbox => {
      bindOnce(checkbox, "equip", "change", this._onEquipToggle.bind(this));
    });

    // Etiquetas da loja: texto separado por vírgula → lista (o campo é um array no Item).
    this.element.querySelectorAll("[data-shop-tags]").forEach(input => {
      bindOnce(input, "shopTags", "change", () => {
        const tags = input.value.split(",").map(s => s.trim()).filter(Boolean);
        this.document.update({ "system.shop.tags": tags });
      });
    });

    this.element.querySelectorAll(".skill-effect-input").forEach(input => {
      bindOnce(input, "effectField", "change", this._onSkillEffectFieldChange.bind(this));
    });

    if (this.item.type === "starship_module") {
      // Categoria e Porte são grupos de rádio (blocos e régua): o listener vai em cada opção.
      const presetChange = this._onModulePresetChange.bind(this);
      this.element
        .querySelectorAll('[name="system.category"], [name="system.moduleSize"]')
        .forEach(input => bindOnce(input, "preset", "change", presetChange));
    }
  }

  /**
   * Autopreenche os campos numéricos de um Módulo de Nave (Overhaul de Naves, Fase 1/8) quando
   * o usuário troca Categoria ou Porte, a partir de `NIHILITY.MODULE_SIZE_PRESETS`/
   * `MODULE_HP_BY_SIZE` — só sobrescreve um campo se ele ainda estiver no valor-padrão do
   * schema, nunca uma edição manual já feita. `stopPropagation` evita que este mesmo "change"
   * TAMBÉM dispare o submitOnChange padrão do DocumentSheetV2 — os dois juntos fariam dois
   * `update()` concorrentes no mesmo Item (um só com Categoria/Porte, outro com os presets).
   */
  async _onModulePresetChange(event) {
    event.stopPropagation();
    const form = event.currentTarget.closest("form");
    const category = form.querySelector('[name="system.category"]:checked')?.value ?? this.item.system.category;
    const moduleSize = form.querySelector('[name="system.moduleSize"]:checked')?.value ?? this.item.system.moduleSize;

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

  /**
   * Onde moram os Efeitos editados nesta ficha: `system.effects` numa Skill, `system.consumable.effects`
   * num Item Geral (Consumível). O editor (partial `nihility.effectCards`) é o mesmo nos dois.
   */
  #effectsPath() {
    return this.item.type === "item" ? "system.consumable.effects" : "system.effects";
  }

  /** Cópia editável dos Efeitos (objetos simples, nunca o Data Model vivo). */
  #cloneEffects() {
    return foundry.utils.deepClone(foundry.utils.getProperty(this.item.toObject(), this.#effectsPath()) ?? []);
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
    // "Só se…": três campos de tela viram um objeto só (`onlyIf`), sempre normalizado.
    if (field.startsWith("onlyIf")) {
      const current = normalizeOnlyIf(entry.onlyIf) ?? { kind: "", value: "", threshold: 50 };
      if (field === "onlyIfKind") {
        current.kind = input.value;
        // Trocar o tipo limpa o valor escolhido (ele era de outro menu).
        current.value = "";
        if (onlyIfNeeds(current.kind) === "condition") current.value = getActiveStatusConditions()[0]?.id ?? "";
        if (onlyIfNeeds(current.kind) === "trait") current.value = getActiveTraits()[0]?.id ?? "";
      } else if (field === "onlyIfValue") current.value = input.value;
      else current.threshold = Number(input.value) || 0;
      entry.onlyIf = normalizeOnlyIf(current) ?? { kind: "", value: "", threshold: 50 };
      await this.item.update({ [this.#effectsPath()]: effects });
      return;
    }
    // Sorte (8d.1): as três caixas de escopo viram um objeto só (`luckScopes`).
    if (field.startsWith("luckScope:")) {
      entry.luckScopes = { attributes: false, damage: false, chances: false, ...(entry.luckScopes ?? {}), [field.slice(10)]: input.checked };
      await this.item.update({ [this.#effectsPath()]: effects });
      return;
    }
    if (input.type === "checkbox") {
      entry[field] = input.checked;
      // Parar e Reverter são modos que não convivem no mesmo efeito.
      if (input.checked && field === "timeRewind") entry.timeStop = false;
      if (input.checked && field === "timeStop") entry.timeRewind = false;
    } else if (field === "timeFactor") entry[field] = clampTimeFactor(input.value);
    else if (input.type === "number") entry[field] = Number(input.value) || 0;
    else entry[field] = input.value.trim();

    if (field === "target") {
      // Sorte: ao escolher o alvo sem escopo nenhum marcado, começa valendo em tudo.
      if (entry.target === "luck" && !Object.values(entry.luckScopes ?? {}).some(Boolean)) entry.luckScopes = { attributes: true, damage: true, chances: true };
      if (!["hp", "energy", "shipCasco", "shipHull"].includes(entry.target)) entry.periodic = false;
      if (!NIHILITY.SHIP_EFFECT_TARGETS.includes(entry.target)) entry.modifierType = "flat";
      if (!PERCENT_AMOUNT_TARGETS.includes(entry.target)) entry.amountMode = "flat";
    }
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onSkillEffectAdd(event, target) {
    event.preventDefault();
    const effects = this.#cloneEffects();
    if (this.item.type === "item") {
      effects.push({ target: "heal", amount: 25, amountMode: "percentMax", modifierType: "flat", durationRounds: 0, conditionId: "", icon: "", periodic: false, tickUnit: "combatRound", damageElements: [] });
      return this.item.update({ [this.#effectsPath()]: effects });
    }
    effects.push({
      target: NIHILITY.EFFECT_TARGETS[0],
      amount: 1,
      modifierType: "flat",
      durationRounds: 1,
      conditionId: "",
      icon: "",
      periodic: false,
      tickUnit: "combatRound",
      damageElements: []
    });
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onSkillEffectDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    effects.splice(index, 1);
    this.#openConditionRows.clear();
    // Os índices dos cards andaram: o aberto/fechado à mão deles não vale mais.
    for (const key of [...this.#advOpen.keys()]) if (key.startsWith("eff-")) this.#advOpen.delete(key);
    await this.item.update({ [this.#effectsPath()]: effects });
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

  /*  Elementos de Dano: chips dos escolhidos + janela de escolha (apps/checklist-picker.js)  */

  /**
   * Lê a lista de Elementos de um campo. `system.effects.N.damageElements` mora dentro de um
   * array que não pode ser gravado por caminho (o Foundry trocaria a lista inteira), então é
   * tratado à parte.
   */
  #readElementList(path) {
    const effect = path?.match(/^system\.(?:consumable\.)?effects\.(\d+)\.damageElements$/);
    if (effect) return foundry.utils.getProperty(this.item, this.#effectsPath())?.[Number(effect[1])]?.damageElements ?? [];
    // Tabela de elementos do Escudo dentro de um Efeito usa o mesmo campo (damageElements).
    return foundry.utils.getProperty(this.item, path) ?? [];
  }

  async #writeElementList(path, list) {
    const effect = path?.match(/^system\.(?:consumable\.)?effects\.(\d+)\.damageElements$/);
    if (effect) {
      const effects = this.#cloneEffects();
      const entry = effects[Number(effect[1])];
      if (!entry) return;
      entry.damageElements = list;
      return this.item.update({ [this.#effectsPath()]: effects });
    }
    if (!path?.startsWith("system.")) return;
    return this.item.update({ [path]: list });
  }

  /** Lançador: liga/desliga um Tipo de Munição aceito. */
  /** Chips do Implante: `data-list` = "fitsSlots" | "functions", `data-value` = o id. */
  static async #onToggleImplantList(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const key = target.dataset.list === "functions" ? "functions" : "fitsSlots";
    const list = new Set(this.item.system.implant?.[key] ?? []);
    const value = target.dataset.value;
    if (list.has(value)) list.delete(value);
    else list.add(value);
    await this.item.update({ [`system.implant.${key}`]: [...list] });
  }

  /** "Tirar" de um programa instalado na placa deste Item (só se o Item está na ficha de um Ator): o programa volta ao inventário. */
  static async #onUninstallDeviceProgram(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    if (!this.isEditable || actor?.documentName !== "Actor") return;
    const { uninstallProgram } = await import("../economy/devices.js");
    await uninstallProgram(actor, this.item.id, target.dataset.uid);
  }

  /** Arma com carregador: liga/desliga um Tipo de Munição aceito (vazio = aceita qualquer). */
  static async #onToggleWeaponAmmoType(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const type = target.dataset.ammoType;
    const list = new Set(this.item.system.weapon?.ammoTypes ?? []);
    if (list.has(type)) list.delete(type);
    else list.add(type);
    await this.item.update({ "system.weapon.ammoTypes": [...list] });
  }

  /** Liga/desliga uma função extra do Módulo (sensor, camuflagem…): cada uma liga um bloco de campos. */
  static async #onToggleModuleFunction(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const id = target.dataset.fn;
    const list = new Set(this.item.system.functions ?? []);
    if (list.has(id)) list.delete(id);
    else list.add(id);
    await this.item.update({ "system.functions": [...list] });
  }

  static async #onToggleAmmoType(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const type = target.dataset.ammoType;
    const list = new Set(this.item.system.ammoTypes ?? []);
    if (list.has(type)) list.delete(type);
    else list.add(type);
    await this.item.update({ "system.ammoTypes": [...list] });
  }

  static async #onPickElements(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const picked = await pickDamageElements(this.#readElementList(path));
    if (picked) await this.#writeElementList(path, picked);
  }

  /** Empurrar/Puxar: Traços (ids) de quem não sai do lugar, guardados no Efeito (`immuneTraits`). */
  static async #onPickEffectTraits(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    const picked = await pickTraits(entry.immuneTraits ?? [], { title: "Traços que não saem do lugar" });
    if (!picked) return;
    entry.immuneTraits = picked;
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onRemoveEffectTrait(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    entry.immuneTraits = (entry.immuneTraits ?? []).filter(id => id !== target.dataset.trait);
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onRemoveElement(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    await this.#writeElementList(path, this.#readElementList(path).filter(id => id !== target.dataset.element));
  }

  /**
   * Animação da Skill: abre o navegador de animações do Sequencer (efeitos de módulos como JB2A,
   * pesquisáveis e com prévia). Ali, o botão de copiar caminho dá o texto a colar no campo.
   */
  static #onBrowseAnimations(event) {
    event.preventDefault();
    const viewer = globalThis.Sequencer?.DatabaseViewer;
    if (typeof viewer?.show === "function") viewer.show();
    else ui.notifications.warn("O navegador de animações precisa do módulo Sequencer ativo.");
  }

  /** Animação da Skill a partir de um arquivo (.webm, .gif…): o seletor de arquivos do Foundry. */
  static #onPickAnimationFile(event) {
    event.preventDefault();
    if (!this.isEditable) return;
    const FilePickerClass = filePickerClass();
    new FilePickerClass({
      type: "imagevideo",
      current: this.item.system.animationPath || "",
      callback: path => this.item.update({ "system.animationPath": path })
    }).render(true);
  }

  /** Luz do Escudo pessoal (Efeito de alvo "Escudo"): editor com pré-visualização no mapa. */
  static async #onEditEffectLight(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    const light = await openLightConfigDialog(entry.light, {
      title: `Luz do Escudo — ${this.item.name}`,
      autoHint: "Raio 0 = automático (2 m em volta do Token)"
    });
    if (!light) return;
    entry.light = light.enabled ? light : null;
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  /** "+ Condição" numa linha de Efeito: só abre os campos (estado de tela). */
  static #onShowEffectCondition(event, target) {
    event.preventDefault();
    this.#openConditionRows.add(Number(target.closest("[data-index]").dataset.index));
    this.render();
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
    const tierChoices = NIHILITY.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

    // Uma Maestria evolui para a mesma Maestria, um degrau acima: o editor já abre com o tipo.
    const sys = this.item.system;
    const seed = sys.weaponMastery ? { weaponMastery: sys.weaponMastery, masteryRank: (Number(sys.masteryRank) || 1) + 1 } : {};
    const data = await openSkillEditorDialog(seed, { tierChoices, levelReadonly: !game.user.isGM });
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
      await createGrantedSkill(actor, this.item.system.grantsSkill, this.item.id, itemNature(this.item.system));
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
      const created = await createGrantedSkill(actor, mod.grantsSkill, sourceKey, { magic: Boolean(mod.magic), tech: Boolean(mod.tech) });
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
    bonuses.push({ attribute: NIHILITY.COMBAT_ATTRIBUTES[0], amount: 1 });
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
    mod.attributeBonuses.push({ attribute: NIHILITY.COMBAT_ATTRIBUTES[0], amount: 1 });
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
    bonuses.push({ attribute: NIHILITY.COMBAT_ATTRIBUTES[0], amount: 1 });
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

  /** "Pedir forma…" (jogador): abre o editor de pedido e manda ao Mestre. */
  static async #onRequestForm() {
    const actor = this.document.parent;
    if (!actor) return;
    await requestForm(actor, this.document, null);
  }

  /** "Transformar"/"Voltar" de uma forma guardada na Predação "Só formas": usa a Sub-Skill de Forma (liga ou desliga) pelo fluxo de sempre. */
  static async #onUseStoredForm(event, target) {
    event.preventDefault();
    const actor = this.document.parent;
    const index = Number(target.dataset.index);
    if (!actor || !Number.isInteger(index)) return;
    await useSkillFlow(actor, this.document.id, { event, pickTarget: async () => null, subSkillIndex: index });
  }

  static async #onLevelUpSkill(event, target) {
    event.preventDefault();
    await this.#raiseSkillLevel();
  }

  /** Jogador paga 1 Ponto de Habilidade do tier da Skill por 1 nível (sem esperar o XP encher). */
  static async #onSpendPointLevelUp(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    const tier = this.item.system.tier;
    if (!actor || !NIHILITY.SKILL_POINT_TIERS.includes(tier)) return;
    const balance = actor.system.skillPoints?.[tier] ?? 0;
    if (balance < 1) {
      ui.notifications.warn(`Sem Pontos ${NIHILITY.SKILL_TIER_LABELS[tier]} para subir o nível.`);
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

    // Maestria de arma (H6): para no nível máximo; a evoluída não tem níveis. O próximo passo é a Evolução.
    if (this.item.system.weaponMastery && isWeaponMasteryEnabled()) {
      const block = masteryLevelUpBlock({ rank: this.item.system.masteryRank, level: currentLevel }, masteryConfig());
      if (block) {
        ui.notifications.warn(block);
        return;
      }
    }

    // Nível máximo (1.124.0): só a Evolução deixa continuar (ou a caixa "Sem limite", do Mestre). O Level Up por Ponto também para aqui.
    let chanceNote = "";
    const updates = {};
    if (!resistanceTarget && !this.item.system.weaponMastery) {
      const chanceStep = levelUpChanceUpdate(this.item, id => getActiveStatusConditions().find(c => c.id === id)?.label ?? id);
      if (!chanceStep) {
        ui.notifications.warn(`${this.item.name} chegou ao nível máximo (${MAX_LEVEL_TEXT}).`);
        return;
      }
      Object.assign(updates, chanceStep.update);
      chanceNote = chanceStep.announce;
    }
    const newLevel = currentLevel + 1;
    updates["system.level"] = newLevel;
    if (resistanceTarget) updates.name = computeResistanceName(resistanceTarget, newLevel);
    if (spendPointFrom) await spendPointFrom.update({ [`system.skillPoints.${tier}`]: balance - 1 });
    await this.item.update(updates);

    const actor = this.item.parent;
    if (actor) {
      await announceVoiceOfTheWorld(actor, {
        kind: "skill-level-up",
        title: "Habilidade Evoluiu",
        body: `${this.item.name} de ${actor.name} subiu para o nível ${newLevel}${spendPointFrom ? " (1 Ponto de Habilidade gasto)" : ""}.${chanceNote ? ` Chances: ${chanceNote}.` : ""}`
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
