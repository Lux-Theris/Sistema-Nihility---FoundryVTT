/**
 * Validador do mundo — a parte PURA (testada em test/rules.test.mjs). Procura referências que
 * apontam para fora dos catálogos do Mestre: uma Skill com Condição que foi apagada, um elemento
 * que aplica uma Condição inexistente, uma Nave com Porte removido, um tripulante deletado…
 *
 * O sistema nunca quebra com isso (cada leitor tem um fallback: Porte apagado vira a linha padrão,
 * categoria desconhecida vira Utilidade, id fora do catálogo aparece em "Fora do catálogo"), mas
 * o fallback é silencioso. O validador só lista; não corrige nada.
 *
 * Recebe documentos como objetos simples (`toObject()`) e os catálogos já lidos, nunca
 * `game.*` — quem coleta é apps/world-validator-app.js.
 */
import { sizeFitsClass } from "../core/config.js";

const ids = list => new Set((list ?? []).map(entry => (typeof entry === "string" ? entry : entry?.id ?? entry?.key)).filter(Boolean));

/**
 * Índice de ids válidos de cada catálogo.
 * @param {object} catalogs - { conditions, elements, structures, scales, attributes, traits,
 *   species (objeto por chave), ammoTypes, crewRoles, moduleCategories, shipSizes, vehicleSizes,
 *   shipClasses, vehicleClasses }
 */
export function buildCatalogIndex(catalogs = {}) {
  return {
    conditions: ids(catalogs.conditions),
    elements: ids(catalogs.elements),
    structures: ids(catalogs.structures),
    scales: ids(catalogs.scales),
    attributes: ids(catalogs.attributes),
    traits: ids(catalogs.traits),
    species: new Set(Object.keys(catalogs.species ?? {})),
    ammoTypes: ids(catalogs.ammoTypes),
    crewRoles: ids(catalogs.crewRoles),
    moduleCategories: ids(catalogs.moduleCategories),
    shipSizes: ids(catalogs.shipSizes),
    vehicleSizes: ids(catalogs.vehicleSizes),
    shipClasses: catalogs.shipClasses ?? [],
    vehicleClasses: catalogs.vehicleClasses ?? [],
    sizeLists: { starship: catalogs.shipSizes ?? [], vehicle: catalogs.vehicleSizes ?? [] }
  };
}

/** Nome do catálogo como o Mestre o vê em Configurações Gerais. */
const CATALOG_LABELS = {
  conditions: "Condições",
  elements: "Tipos de Dano",
  structures: "Estruturas",
  scales: "Escalas",
  attributes: "Atributos",
  traits: "Traços",
  species: "Espécies",
  ammoTypes: "Munições",
  crewRoles: "Funções de Tripulação",
  moduleCategories: "Categorias de Módulo",
  shipSizes: "Portes de Nave",
  vehicleSizes: "Portes de Veículo",
  shipClasses: "Classes de Nave",
  vehicleClasses: "Classes de Veículo"
};

/** Junta trechos de caminho ("Sub-Skill 2 › Efeito 1 › Condição"), ignorando os vazios. */
const at = (...parts) => parts.filter(Boolean).join(" › ");

function missing(issues, where, catalog, ref) {
  issues.push({ where, catalog, ref, message: `"${ref}" não existe em ${CATALOG_LABELS[catalog] ?? catalog}` });
}

function checkRef(issues, idx, where, catalog, ref) {
  if (typeof ref !== "string" || !ref) return;
  if (!idx[catalog]?.has(ref)) missing(issues, where, catalog, ref);
}

function checkRefs(issues, idx, where, catalog, refs) {
  for (const ref of refs ?? []) checkRef(issues, idx, where, catalog, ref);
}

/** Alvo de Resistência: "" (nenhum), "general" ou id de elemento. */
function checkResistanceTarget(issues, idx, where, target) {
  if (!target || target === "general") return;
  checkRef(issues, idx, where, "elements", target);
}

/**
 * Mecânica de Skill (Skill, Sub-Skill ou Habilidade Concedida): Efeitos, elementos, Estrutura,
 * Escala, Atributo de escala, Resistência, e as Sub-Skills dentro dela.
 */
export function checkMechanic(mech, idx, prefix = "") {
  const issues = [];
  if (!mech || typeof mech !== "object") return issues;
  (mech.effects ?? []).forEach((entry, i) => {
    const where = at(prefix, `Efeito ${i + 1}`);
    checkRef(issues, idx, at(where, "Condição"), "conditions", entry?.conditionId);
    checkRef(issues, idx, at(where, "Elemento"), "elements", entry?.elementId);
    checkRefs(issues, idx, at(where, "Elementos"), "elements", entry?.damageElements);
  });
  checkRefs(issues, idx, at(prefix, "Elementos de dano"), "elements", mech.damageElements);
  if (mech.effectType === "structure" || mech.targetType === "structure" || mech.structureId) {
    checkRef(issues, idx, at(prefix, "Estrutura"), "structures", mech.structureId);
  }
  checkRef(issues, idx, at(prefix, "Escala do dano"), "scales", mech.damageScale);
  checkRef(issues, idx, at(prefix, "Atributo de escala"), "attributes", mech.scalingAttribute);
  checkResistanceTarget(issues, idx, at(prefix, "Resistência"), mech.resistanceTarget);
  (mech.subSkills ?? []).forEach((sub, i) => issues.push(...checkMechanic(sub, idx, at(prefix, `Sub-Skill ${i + 1}${sub?.name ? ` (${sub.name})` : ""}`))));
  return issues;
}

/** "Quando → Então": o `value` do Quando e o `target` do Então apontam para catálogos. */
export function checkConditionals(modifiers, idx, prefix = "") {
  const issues = [];
  (modifiers ?? []).forEach((mod, i) => {
    const where = at(prefix, `Quando → Então ${i + 1}`);
    const kind = mod?.when?.kind;
    if (kind === "otherTrait") checkRef(issues, idx, at(where, "Traço"), "traits", mod.when.value);
    if (kind === "otherCondition" || kind === "selfCondition") checkRef(issues, idx, at(where, "Condição"), "conditions", mod.when.value);
    if (kind === "element") checkRef(issues, idx, at(where, "Elemento"), "elements", mod.when.value);
    const then = mod?.then ?? {};
    if (then.kind === "resistancePercent") checkResistanceTarget(issues, idx, at(where, "Resistência"), then.target);
    if ((then.kind === "rollFlat" || then.kind === "attributeFlat") && then.target !== "any") {
      checkRef(issues, idx, at(where, "Atributo"), "attributes", then.target);
    }
  });
  return issues;
}

/** Habilidade Concedida: só confere quando tem nome (sem nome = o campo nunca foi usado). */
function checkGrant(grant, idx, prefix) {
  if (!grant?.name) return [];
  return checkMechanic(grant, idx, at(prefix, `Habilidade Concedida (${grant.name})`));
}

/**
 * Um Item (embutido num Ator ou solto no Diretório/Compêndio).
 * @param {{name:string, type:string, system:object}} item
 * @returns {Array<{where:string, catalog:string, ref:string, message:string}>}
 */
export function validateItem(item, idx) {
  const s = item?.system ?? {};
  const issues = [];
  switch (item?.type) {
    case "skill":
      issues.push(...checkMechanic(s, idx));
      issues.push(...checkConditionals(s.conditionalModifiers, idx));
      break;
    case "item":
      issues.push(...checkGrant(s.grantsSkill, idx, ""));
      if (s.weapon?.enabled) {
        checkRefs(issues, idx, "Arma › Elementos", "elements", s.weapon.damageElements);
        checkRef(issues, idx, "Arma › Atributo de escala", "attributes", s.weapon.scalingAttribute);
        checkRef(issues, idx, "Arma › Escala do dano", "scales", s.weapon.damageScale);
      }
      if (s.ammo?.enabled) {
        checkRef(issues, idx, "Munição › Tipo", "ammoTypes", s.ammo.type);
        checkRefs(issues, idx, "Munição › Elementos", "elements", s.ammo.damageElements);
      }
      issues.push(...checkConditionals(s.conditionalModifiers, idx));
      break;
    case "starship_module":
      checkRef(issues, idx, "Categoria", "moduleCategories", s.category);
      checkRefs(issues, idx, "Munições aceitas", "ammoTypes", s.ammoTypes);
      checkRefs(issues, idx, "Elementos de dano", "elements", s.damageElements);
      checkRefs(issues, idx, "Elementos do Escudo", "elements", s.shieldElements);
      issues.push(...checkGrant(s.grantsSkill, idx, ""));
      break;
    case "body_part":
      (s.installedMods ?? []).forEach((mod, i) => issues.push(...checkGrant(mod?.grantsSkill, idx, `Modificação ${i + 1}${mod?.name ? ` (${mod.name})` : ""}`)));
      break;
    case "title":
      (s.resistances ?? []).forEach((r, i) => checkResistanceTarget(issues, idx, `Resistência ${i + 1}`, r?.target));
      issues.push(...checkConditionals(s.conditionalModifiers, idx));
      break;
    default:
      break;
  }
  return issues;
}

/**
 * Um Ator com seus Itens.
 * @param {{name:string, type:string, system:object, items?:Array}} actor
 * @param {object} idx - buildCatalogIndex
 * @param {{uuidExists?: (uuid:string) => boolean}} [options]
 * @returns {Array<{where:string, catalog:string, ref:string, message:string, itemId?:string}>}
 */
export function validateActor(actor, idx, { uuidExists = () => true } = {}) {
  const s = actor?.system ?? {};
  const items = actor?.items ?? [];
  const issues = [];

  if (actor?.type === "character") {
    checkRef(issues, idx, "Espécie", "species", s.species);
    checkRefs(issues, idx, "Traços", "traits", s.traits);
    checkRefs(issues, idx, "Traços removidos", "traits", s.traitsRemoved);
    checkRef(issues, idx, "Escala", "scales", s.scale);
    // Contêiner: Item Geral com `container.enabled` ou Skill com `grantsContainer.enabled`, do próprio Ator.
    const containers = new Set(
      items.filter(i => (i.type === "item" && i.system?.container?.enabled) || (i.type === "skill" && i.system?.grantsContainer?.enabled)).map(i => i._id)
    );
    for (const item of items) {
      const containerId = item.system?.containerId;
      if (containerId && !containers.has(containerId)) {
        issues.push({ where: at(item.name, "Guardado em"), catalog: "containers", ref: containerId, message: "aponta para um contêiner que não existe mais (o item conta como solto)", itemId: item._id });
      }
    }
  }

  if (actor?.type === "starship" || actor?.type === "vehicle") {
    const isVehicle = actor.type === "vehicle";
    const sizeCatalog = isVehicle ? "vehicleSizes" : "shipSizes";
    checkRef(issues, idx, "Porte", sizeCatalog, s.shipSize);
    if (s.shipClass) {
      const classes = isVehicle ? idx.vehicleClasses : idx.shipClasses;
      const vesselClass = classes.find(c => c.id === s.shipClass);
      if (!vesselClass) missing(issues, "Classe", isVehicle ? "vehicleClasses" : "shipClasses", s.shipClass);
      else if (!sizeFitsClass(s.shipSize, vesselClass, idx.sizeLists[actor.type])) {
        issues.push({ where: "Classe", catalog: sizeCatalog, ref: s.shipSize, message: `Porte "${s.shipSize}" fora da faixa da Classe "${vesselClass.label ?? vesselClass.id}"` });
      }
    }
    (s.crewMembers ?? []).forEach((member, i) => {
      const where = `Tripulação ${i + 1}`;
      if (member?.actorUuid && !uuidExists(member.actorUuid)) {
        issues.push({ where, catalog: "actors", ref: member.actorUuid, message: "tripulante não existe mais (apagado)" });
      }
      checkRef(issues, idx, at(where, "Posto"), "crewRoles", member?.role);
    });
    // Grupo de prioridade: com a fila vazia valem os cinco grupos padrão (p1…p5).
    const groups = (s.powerGroups ?? []).length ? new Set(s.powerGroups.map(g => g?.id)) : new Set(["p1", "p2", "p3", "p4", "p5"]);
    for (const item of items) {
      const group = item.type === "starship_module" ? item.system?.powerGroup : "";
      if (group && !groups.has(group)) {
        issues.push({ where: at(item.name, "Prioridade"), catalog: "powerGroups", ref: group, message: "grupo de prioridade que não existe mais nesta Nave (vai para o grupo do meio)", itemId: item._id });
      }
    }
  }

  for (const item of items) {
    for (const issue of validateItem(item, idx)) issues.push({ ...issue, where: at(item.name, issue.where), itemId: item._id });
  }
  return issues;
}

/**
 * Referências ENTRE catálogos: elemento → Condição/Traço/elemento, Condição → elemento, Espécie →
 * Traço/elemento/Skill Racial, Estrutura → elemento, Escala por Porte, faixa e vagas das Classes.
 * @returns {Array<{catalog:string, entry:string, where:string, message:string}>}
 */
export function validateCatalogs(catalogs, idx = buildCatalogIndex(catalogs)) {
  const issues = [];
  const push = (catalog, entry, list) => list.forEach(issue => issues.push({ ...issue, catalog, entry }));

  for (const element of catalogs.elements ?? []) {
    const list = [];
    (element.effects ?? []).forEach((effect, i) => {
      if (effect?.type === "condition") checkRef(list, idx, `Efeito ${i + 1} › Condição`, "conditions", effect.conditionId);
      if (effect?.type === "traitBonus") checkRef(list, idx, `Efeito ${i + 1} › Traço`, "traits", effect.trait);
    });
    checkRefs(list, idx, "Tabela de vantagens", "elements", Object.keys(element.affinity ?? {}));
    push("elements", element.label ?? element.id, list);
  }

  for (const condition of catalogs.conditions ?? []) {
    const list = [];
    checkRefs(list, idx, "Elementos", "elements", condition.elements);
    if (condition.effect?.kind === "modifier" && condition.effect.modTarget && condition.effect.modTarget !== "movement") {
      checkRef(list, idx, "Efeito padrão › Atributo", "attributes", condition.effect.modTarget);
    }
    push("conditions", condition.label ?? condition.id, list);
  }

  for (const [key, preset] of Object.entries(catalogs.species ?? {})) {
    const list = [];
    checkRefs(list, idx, "Traços", "traits", preset?.traits);
    checkRefs(list, idx, "Elementos", "elements", preset?.elements);
    (preset?.skills ?? []).forEach((skill, i) => list.push(...checkMechanic(skill, idx, `Skill Racial ${i + 1}${skill?.name ? ` (${skill.name})` : ""}`)));
    push("species", preset?.label ?? key, list);
  }

  for (const structure of catalogs.structures ?? []) {
    const list = [];
    checkRefs(list, idx, "Elementos", "elements", structure.elements);
    push("structures", structure.label ?? structure.id, list);
  }

  const scaleMaps = catalogs.scaleMaps ?? {};
  for (const [kind, map] of [["shipSizes", scaleMaps.shipSizeMap], ["vehicleSizes", scaleMaps.vehicleSizeMap]]) {
    const list = [];
    for (const [sizeId, scaleId] of Object.entries(map ?? {})) {
      if (!idx[kind].has(sizeId)) continue; // Porte que já saiu do catálogo: a linha só sobra no mapa
      checkRef(list, idx, `Porte "${sizeId}"`, "scales", scaleId);
    }
    push("scales", CATALOG_LABELS[kind], list);
  }

  for (const [kind, classes, sizeCatalog] of [["shipClasses", catalogs.shipClasses, "shipSizes"], ["vehicleClasses", catalogs.vehicleClasses, "vehicleSizes"]]) {
    for (const vesselClass of classes ?? []) {
      const list = [];
      checkRef(list, idx, "Porte mínimo", sizeCatalog, vesselClass.minSize);
      checkRef(list, idx, "Porte máximo", sizeCatalog, vesselClass.maxSize);
      checkRefs(list, idx, "Vagas por categoria", "moduleCategories", Object.keys(vesselClass.slots ?? {}));
      push(kind, vesselClass.label ?? vesselClass.id, list);
    }
  }

  return issues;
}

export { CATALOG_LABELS };
