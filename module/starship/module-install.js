/**
 * Regras de instalação de Módulo em Nave/Veículo e a Faixa de Porte da Classe: junta os dados do
 * Ator/Item, pede o veredito às regras puras (`module-install-rules.js`) e mostra o aviso. Os
 * hooks são registrados por `registerModuleInstallRules()`, chamado no `init`.
 */
import {
  NIHILITY,
  getModuleCategories,
  categorySlotLimit,
  moduleRole,
  getVesselSizes,
  getVesselClasses,
  vesselKind,
  vesselSizeLabel,
  sizeFitsClass,
  describeClassSizeRange
} from "../core/config.js";
import { moduleSizeFits, categorySlotCheck, weaponBudgetCheck } from "./module-install-rules.js";

/**
 * Overhaul de Naves (Fase 1) — compatibilidade de Porte: um Módulo só pode existir numa
 * Nave/Veículo cujo Porte seja igual ou maior ao dele (`MODULE_SIZE_RANK` vs o `rank` do Porte
 * em config.js). Bloqueia a criação/edição com um aviso em vez de deixar o Módulo instalado
 * incompatível silenciosamente.
 */
function checkModuleSizeCompatibility(actor, moduleSize) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  const size = actor.system.vesselSize;
  if (moduleSizeFits({ moduleRank: NIHILITY.MODULE_SIZE_RANK[moduleSize], vesselRank: size.rank })) return true;

  ui.notifications.error(
    `${actor.name}: Módulo de Porte "${NIHILITY.MODULE_SIZE_LABELS[moduleSize]}" não cabe num Porte "${size.label}" (aceita até ${NIHILITY.MODULE_SIZE_LABELS[NIHILITY.MODULE_SIZES[size.rank]]}).`
  );
  return false;
}

/**
 * Vagas por Categoria: cada Categoria do catálogo diz quantos Módulos dela cabem (0 = sem limite),
 * e a Classe da Nave pode mudar isso (ver categorySlotLimit em config.js). Cheio, instalar outro
 * exige remover um antes.
 */
function checkSingleSlotAvailable(actor, category, excludeItemId) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  // Vagas por Categoria: a da Classe da Nave, se ela disser; senão a da Categoria (0 = sem limite).
  const categoryDef = getModuleCategories().find(c => c.id === category);
  if (!categoryDef) return true;
  const limit = categorySlotLimit(categoryDef, actor.system.vesselClass);
  if (!limit) return true;

  const used = actor.items.filter(
    i => i.type === "starship_module" && i.id !== excludeItemId && i.system.category === category
  ).length;
  if (categorySlotCheck({ used, limit }).ok) return true;

  ui.notifications.error(
    `${actor.name}: sem vaga de "${categoryDef.label}" (${used} de ${limit}) — remova um Módulo antes de instalar outro.`
  );
  return false;
}

/**
 * Overhaul de Naves (Fase 2) — orçamento de espaço de Arma por Porte da Nave/Veículo. Cada Arma
 * consome `MODULE_SIZE_RANK + 1` unidades do orçamento do casco (`weaponSlotBudget`, ver
 * ShipSystemsDataModel em starship-model.js): num Porte Mini cabe exatamente uma Arma Compacta.
 * Só não bloqueia se o Porte não estiver na tabela (orçamento `Infinity`).
 */
function checkWeaponBudget(actor, category, moduleSize, excludeItemId) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  if (moduleRole(category) !== "weapon") return true;

  // Porte máximo de Arma da Classe (um Cargueiro não monta canhão Colossal).
  const maxSize = actor.system.vesselClass?.maxWeaponSize;
  const usedByOthers = actor.items
    .filter(i => i.type === "starship_module" && i.id !== excludeItemId && moduleRole(i.system.category) === "weapon")
    .reduce((sum, i) => sum + NIHILITY.MODULE_SIZE_RANK[i.system.moduleSize] + 1, 0);
  const verdict = weaponBudgetCheck({
    thisUnit: NIHILITY.MODULE_SIZE_RANK[moduleSize] + 1,
    usedByOthers,
    budget: actor.system.weaponSlotBudget,
    moduleRank: NIHILITY.MODULE_SIZE_RANK[moduleSize],
    maxRank: maxSize ? NIHILITY.MODULE_SIZE_RANK[maxSize] : undefined
  });
  if (verdict.ok) return true;

  if (verdict.reason === "classMax") {
    ui.notifications.error(`${actor.name}: a Classe desta Nave não comporta Arma maior que ${NIHILITY.MODULE_SIZE_LABELS[maxSize]}.`);
    return false;
  }

  ui.notifications.error(`${actor.name}: orçamento de espaço de Arma excedido (${verdict.total} / ${verdict.budget}).`);
  return false;
}

/** Registra os três hooks (Faixa de Porte da Classe, preCreateItem e preUpdateItem). */
export function registerModuleInstallRules() {
  // Faixa de Porte da Classe: trocar Porte ou Classe para uma combinação que a Classe não aceita é
  // recusado. Uma Nave que JÁ está fora da faixa (Classe editada depois) não muda sozinha — a ficha
  // só avisa o Mestre; o bloqueio vale para a próxima troca, nunca para outras edições.
  Hooks.on("preUpdateActor", (actor, changes) => {
    if (!["starship", "vehicle"].includes(actor.type)) return;
    const newSize = foundry.utils.getProperty(changes, "system.shipSize");
    const newClassId = foundry.utils.getProperty(changes, "system.shipClass");
    if (newSize === undefined && newClassId === undefined) return;
    const sizeId = newSize ?? actor.system.shipSize;
    const classId = newClassId ?? actor.system.shipClass;
    if (sizeId === actor.system.shipSize && classId === actor.system.shipClass) return;
    const kind = vesselKind(actor);
    const sizes = getVesselSizes(kind);
    const vesselClass = getVesselClasses(kind).find(c => c.id === classId) ?? null;
    if (sizeFitsClass(sizeId, vesselClass, sizes)) return;
    ui.notifications.warn(
      `${actor.name}: a Classe ${vesselClass.label} aceita Porte ${describeClassSizeRange(vesselClass, sizes)} — ${vesselSizeLabel(kind, sizeId)} fica fora. Nada foi mudado.`
    );
    return false;
  });

  Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (item.type !== "starship_module") return;
    const actor = item.parent;
    const { category, moduleSize } = item.system;
    if (!checkModuleSizeCompatibility(actor, moduleSize)) return false;
    if (!checkSingleSlotAvailable(actor, category, item.id)) return false;
    if (!checkWeaponBudget(actor, category, moduleSize, item.id)) return false;
  });

  Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    if (item.type !== "starship_module") return;

    const sizeChanged = foundry.utils.getProperty(changes, "system.moduleSize") !== undefined;
    const categoryChanged = foundry.utils.getProperty(changes, "system.category") !== undefined;
    if (!sizeChanged && !categoryChanged) return;

    const actor = item.parent;
    const newSize = foundry.utils.getProperty(changes, "system.moduleSize") ?? item.system.moduleSize;
    const newCategory = foundry.utils.getProperty(changes, "system.category") ?? item.system.category;

    if (!checkModuleSizeCompatibility(actor, newSize)) return false;
    if (!checkSingleSlotAvailable(actor, newCategory, item.id)) return false;
    if (!checkWeaponBudget(actor, newCategory, newSize, item.id)) return false;
  });
}
