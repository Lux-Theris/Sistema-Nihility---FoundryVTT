/**
 * Validador do mundo — a parte PURA (testada em test/). Procura referências que
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
import { drainLint } from "../skills/drain-rules.js";
import { strikesLint } from "../skills/strikes-rules.js";
import { collectChances, entryHasChance } from "../skills/chance-rules.js";
import { pocketSlots, POCKET_DEFAULTS, pocketEntryOf, PRESO_CONDITION_ID } from "../combat/space-rules.js";
import { weaponTypeCatalogIssues } from "../combat/weapon-mastery-rules.js";
import { shopSetupIssues, normalizeItemShop } from "../economy/shop-rules.js";
import { moduleSensorIssues, shipSensorIssues } from "../starship/sensor-rules.js";
import { itemSetIssues, itemSetRefIssues } from "../economy/item-set-rules.js";
import { deviceProgramIssues } from "../economy/device-rules.js";

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
    // Condições que ancoram (8f): `anchorLevel` maior que 0.
    anchorConditions: ids((catalogs.conditions ?? []).filter(c => Number(c?.anchorLevel) > 0)),
    elements: ids(catalogs.elements),
    structures: ids(catalogs.structures),
    scales: ids(catalogs.scales),
    attributes: ids(catalogs.attributes),
    traits: ids(catalogs.traits),
    species: new Set(Object.keys(catalogs.species ?? {})),
    heritages: ids(catalogs.heritages),
    bodyFunctions: ids(catalogs.bodyFunctions),
    ammoTypes: ids(catalogs.ammoTypes),
    weaponTypes: ids(catalogs.weaponTypes),
    crewRoles: ids(catalogs.crewRoles),
    moduleCategories: ids(catalogs.moduleCategories),
    shipSizes: ids(catalogs.shipSizes),
    vehicleSizes: ids(catalogs.vehicleSizes),
    shipClasses: catalogs.shipClasses ?? [],
    vehicleClasses: catalogs.vehicleClasses ?? [],
    // Conjuntos (J12): o catálogo inteiro (para o tipo do conjunto) e os ids. Sem `itemSets`, o campo do Item não é conferido.
    itemSets: ids(catalogs.itemSets),
    itemSetList: Array.isArray(catalogs.itemSets) ? catalogs.itemSets : null,
    sizeLists: { starship: catalogs.shipSizes ?? [], vehicle: catalogs.vehicleSizes ?? [] },
    // Forma (H5): (uuid) => o molde existe e está marcado; ausente = não confere.
    formTemplateOk: typeof catalogs.formTemplateOk === "function" ? catalogs.formTemplateOk : null,
    skillMaxLevel: typeof catalogs.skillMaxLevel === "function" ? catalogs.skillMaxLevel : null
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
  heritages: "Heranças",
  bodyFunctions: "Funções de Parte",
  ammoTypes: "Munições",
  weaponTypes: "Tipos de Arma",
  crewRoles: "Funções de Tripulação",
  moduleCategories: "Categorias de Módulo",
  shipSizes: "Portes de Nave",
  vehicleSizes: "Portes de Veículo",
  shipClasses: "Classes de Nave",
  vehicleClasses: "Classes de Veículo",
  itemSets: "Conjuntos"
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
    // "Fura imunidade e resistência a Condição" (1.119.0) sem Condição no efeito não faz nada.
    if (entry?.piercesCondition && !entry?.conditionId) issues.push({ where: at(where, "Condição"), catalog: "conditions", ref: "", message: "\"Fura imunidade e resistência a Condição\" num efeito sem Condição: não faz nada" });
    checkRef(issues, idx, at(where, "Elemento"), "elements", entry?.elementId);
    checkRefs(issues, idx, at(where, "Elementos"), "elements", entry?.damageElements);
    // Empurrar/Puxar: os Traços que não saem do lugar.
    checkRefs(issues, idx, at(where, "Traços imunes"), "traits", entry?.immuneTraits);
    // "Só se…" (8.1a): a Condição ou o Traço escolhido precisa existir.
    if (entry?.onlyIf?.kind === "otherCondition" || entry?.onlyIf?.kind === "otherConditionMine" || entry?.onlyIf?.kind === "selfCondition") checkRef(issues, idx, at(where, "Só se… › Condição"), "conditions", entry.onlyIf.value);
    if (entry?.onlyIf?.kind === "otherTrait") checkRef(issues, idx, at(where, "Só se… › Traço"), "traits", entry.onlyIf.value);
    // Espaço (8f): Skill espacial sem alcance vale no mapa inteiro; o modo precisa existir; Âncora (Condição) sem duração nunca sai.
    if (entry?.target === "space") {
      const mode = entry.spaceMode || "jump";
      if (!["jump", "swap", "portal", "pocket", "domain"].includes(mode)) issues.push({ where, catalog: "space", ref: String(mode), message: "o modo de Espaço não existe: o uso é recusado" });
      if (!(Number(mech.range) > 0) && !["pocket", "domain"].includes(mode)) issues.push({ where, catalog: "space", ref: "", message: mode === "portal" ? "Portal sem alcance: as pontas valem em qualquer ponto do mapa" : "Skill espacial sem alcance: Saltar/Trocar vale em qualquer ponto do mapa" });
      if (["emission", "zone"].includes(mech.targetType) && mode !== "pocket") issues.push({ where, catalog: "space", ref: "", message: "Espaço não vale em área ou Zona: o uso é recusado" });
      // Portal e Domínio (8f, lotes 3 e 5): sem duração ficam até o Mestre fechar (ou, numa Ativa, até desligar).
      if (["portal", "domain"].includes(mode) && !(Number(entry.durationRounds) > 0) && !mech.hasUpkeep) {
        issues.push({ where, catalog: "space", ref: "", message: `${mode === "portal" ? "Portal" : "Domínio"} sem duração: fica aberto até o Mestre fechar` });
      }
      if (mode === "domain" && !(Number(entry.spaceRadius) > 0)) issues.push({ where, catalog: "space", ref: "", message: "Domínio sem área (raio): vale o padrão de 10 m" });
      if (mode === "domain" && idx.conditions && !idx.conditions.has(PRESO_CONDITION_ID)) issues.push({ where, catalog: "conditions", ref: PRESO_CONDITION_ID, message: "o Domínio usa a Condição Preso, que não está no catálogo de Condições (o Domínio prende, mas sem o selo na ficha)" });
      // Bolso (lote 4): sem nível ou sem espaços não guarda nada.
      if (mode === "pocket") {
        if (!(Number(mech.level) >= 1)) issues.push({ where, catalog: "space", ref: "", message: "Bolso sem nível: os espaços crescem pelo nível da Skill" });
        else if (pocketSlots({ base: entry.pocketBase ?? POCKET_DEFAULTS.base, perLevel: entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel, level: mech.level }) <= 0) issues.push({ where, catalog: "space", ref: "", message: "Bolso sem espaços: o nível da Skill não dá nenhum" });
      }
    }
    if (entry?.conditionId && idx.anchorConditions?.has(entry.conditionId) && !(Number(entry.durationRounds) > 0) && !mech.hasUpkeep) {
      issues.push({ where, catalog: "space", ref: entry.conditionId, message: "Âncora sem duração: quem a recebe fica Ancorado até o Mestre tirar" });
    }
    // Peças de magia (1.123.0) e Chance (1.124.0).
    for (const w of drainLint(entry)) issues.push({ where, catalog: "skills", ref: "", message: w.text });
    if (entry?.target === "purify" && entry.conditionId) checkRef(issues, idx, at(where, "Purificar › Condição"), "conditions", entry.conditionId);
    if (entry?.target === "revive" && ["emission", "zone"].includes(mech.targetType)) issues.push({ where, catalog: "skills", ref: "", message: "Reviver numa área nunca alcança o morto: o uso não faz nada" });
    if (entry?.target === "scry" && ["self", "emission", "zone"].includes(mech.targetType)) issues.push({ where, catalog: "skills", ref: "", message: "Ver pela Marca precisa de um alvo único (o Marcado)" });
    if (entryHasChance(entry) && !entry.id) issues.push({ where, catalog: "skills", ref: "", message: "efeito com Chance sem id estável: salve a Skill de novo para a progressão por chance contar" });
    // Desarmado vira tipo de arma.
    if (entry?.target === "unarmedType") checkRef(issues, idx, at(where, "Tipo de arma"), "weaponTypes", entry?.weaponTypeId);
  });
  // Zona que escurece o mapa e Predação "Só formas" (1.120.0): só fazem sentido na própria mecânica.
  if (mech.zoneDarkens && mech.targetType !== "zone") issues.push({ where: at(prefix, "Escurece o mapa"), catalog: "skills", ref: "", message: "\"Escurece o mapa\" numa Skill que não é Zona: o campo não faz nada" });
  if (mech.predationTakes === "forms" && mech.effectType !== "predation") issues.push({ where: at(prefix, "Predação"), catalog: "skills", ref: "", message: "\"Só formas\" numa Skill que não é Predação: o campo não faz nada" });
  // Roubo de vida (1.119.0): só o dano cura quem usa.
  if (Number(mech.lifeSteal) > 0 && mech.effectType !== "damage") issues.push({ where: at(prefix, "Cura quem usa"), catalog: "skills", ref: "", message: "\"Cura quem usa (% do dano)\" numa Skill que não causa dano: o campo não faz nada" });
  // Golpes N e corrente (1.123.0).
  for (const w of strikesLint(mech)) if (w.code === "chainNoStrikes") issues.push({ where: at(prefix, "Golpes"), catalog: "skills", ref: "", message: w.text });
  // Progressão por chance (1.124.0): pontos de uma chance que não existe mais, e Skill acima do nível máximo.
  if (mech.chanceBonus && typeof mech.chanceBonus === "object") {
    const live = new Set(collectChances(mech).map(c => c.key));
    const dead = Object.keys(mech.chanceBonus).filter(k => !k.includes("element:") && !live.has(k));
    if (dead.length) issues.push({ where: at(prefix, "Chances"), catalog: "skills", ref: dead.join(", "), message: "pontos de chance guardados de um efeito que não existe mais (ficam sem uso; se a chave voltar com outro sentido, confira)" });
  }
  if (typeof idx.skillMaxLevel === "function" && !prefix && !mech.resistanceTarget && !mech.weaponMastery) {
    const max = idx.skillMaxLevel(mech);
    if (Number.isFinite(max) && Number(mech.level) > max) issues.push({ where: at(prefix, "Nível"), catalog: "skills", ref: "", message: `nível ${mech.level} acima do nível máximo automático (${max}): a Skill não sobe mais; marque "Sem limite" ou deixe como está (só a Evolução continua)` });
  }
  // "Só se…" da Skill inteira e "ao acertar" (8c.1).
  if (mech.onlyIf?.kind === "otherCondition" || mech.onlyIf?.kind === "otherConditionMine" || mech.onlyIf?.kind === "selfCondition") checkRef(issues, idx, at(prefix, "Só se… da Skill › Condição"), "conditions", mech.onlyIf.value);
  if (mech.onlyIf?.kind === "otherTrait") checkRef(issues, idx, at(prefix, "Só se… da Skill › Traço"), "traits", mech.onlyIf.value);
  if (mech.onHit?.conditionId) checkRef(issues, idx, at(prefix, "Ao acertar › Condição"), "conditions", mech.onHit.conditionId);
  // Maestria de arma e golpe de arma (H6): o tipo precisa existir no catálogo.
  checkRef(issues, idx, at(prefix, "Maestria de arma"), "weaponTypes", mech.weaponMastery);
  checkRef(issues, idx, at(prefix, "Golpe de arma"), "weaponTypes", mech.weaponStrike);
  checkRefs(issues, idx, at(prefix, "Elementos de dano"), "elements", mech.damageElements);
  if (mech.effectType === "structure" || mech.targetType === "structure" || mech.structureId) {
    checkRef(issues, idx, at(prefix, "Estrutura"), "structures", mech.structureId);
    // Aura que segue (1.118.0): sem Skill Ativa ninguém a mantém.
    if (mech.structureFollows && !mech.hasUpkeep) issues.push({ where: at(prefix, "Estrutura"), catalog: "structures", ref: mech.structureId ?? "", message: "\"Segue quem lançou\" sem Habilidade Ativa: a aura anda mas ninguém a mantém" });
  }
  if (mech.effectType === "form") {
    if (!mech.formActorUuid) issues.push({ where: at(prefix, "Forma"), catalog: "forms", ref: "", message: "a Mecânica Forma não tem ficha de forma" });
    else if (idx.formTemplateOk && !idx.formTemplateOk(mech.formActorUuid)) issues.push({ where: at(prefix, "Forma"), catalog: "forms", ref: mech.formActorUuid, message: "a ficha da forma sumiu ou não está marcada como molde de forma" });
  }
  checkRef(issues, idx, at(prefix, "Escala do dano"), "scales", mech.damageScale);
  checkRef(issues, idx, at(prefix, "Atributo de escala"), "attributes", mech.scalingAttribute);
  checkResistanceTarget(issues, idx, at(prefix, "Resistência"), mech.resistanceTarget);
  (mech.subSkills ?? []).forEach((sub, i) => issues.push(...checkMechanic(sub, idx, at(prefix, `Sub-Skill ${i + 1}${sub?.name ? ` (${sub.name})` : ""}`))));
  return issues;
}

/** "Quando → Então": o `value` do Quando e o `target` do Então apontam para catálogos. */
export function checkConditionals(modifiers, idx, prefix = "", { isSkill = false } = {}) {
  const issues = [];
  (modifiers ?? []).forEach((mod, i) => {
    const where = at(prefix, `Quando → Então ${i + 1}`);
    const kind = mod?.when?.kind;
    if (kind === "otherTrait") checkRef(issues, idx, at(where, "Traço"), "traits", mod.when.value);
    if (kind === "otherCondition" || kind === "otherConditionMine" || kind === "selfCondition") checkRef(issues, idx, at(where, "Condição"), "conditions", mod.when.value);
    if (kind === "element") checkRef(issues, idx, at(where, "Elemento"), "elements", mod.when.value);
    // Escala (1.120.0): "a cada N níveis da Skill" precisa de uma Skill (a fonte tem nível); em Título/Item conta 1 vez.
    if (Number(mod?.perLevels) > 0 && !isSkill) issues.push({ where: at(where, "A cada N níveis"), catalog: "skills", ref: "", message: "\"a cada N níveis da Skill\" fora de uma Skill: a fonte não tem nível e a regra conta 1 vez" });
    const then = mod?.then ?? {};
    if (then.kind === "resistancePercent") checkResistanceTarget(issues, idx, at(where, "Resistência"), then.target);
    if ((then.kind === "rollFlat" || then.kind === "attributeFlat" || then.kind === "attributePercent") && then.target !== "any") {
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
  // Conjunto (J12): o Item aponta para um conjunto que não existe (ou que é de outro tipo de ficha).
  if (idx.itemSetList && s.itemSet && ["item", "starship_module"].includes(item?.type)) {
    for (const problem of itemSetRefIssues([{ label: item.name ?? "", type: item.type, setId: s.itemSet }], idx.itemSetList)) {
      issues.push({ where: "Conjunto", catalog: "itemSets", ref: s.itemSet, message: problem.text });
    }
  }
  switch (item?.type) {
    case "skill":
      issues.push(...checkMechanic(s, idx));
      issues.push(...checkConditionals(s.conditionalModifiers, idx, "", { isSkill: true }));
      break;
    case "item":
      issues.push(...checkGrant(s.grantsSkill, idx, ""));
      if (s.weapon?.enabled) {
        checkRefs(issues, idx, "Arma › Elementos", "elements", s.weapon.damageElements);
        checkRef(issues, idx, "Arma › Atributo de escala", "attributes", s.weapon.scalingAttribute);
        checkRef(issues, idx, "Arma › Escala do dano", "scales", s.weapon.damageScale);
        checkRef(issues, idx, "Arma › Tipo de arma", "weaponTypes", s.weapon.weaponType);
      }
      if (s.device?.enabled) {
        for (const message of deviceProgramIssues(s.device, { hostIsWeapon: Boolean(s.weapon?.enabled) })) issues.push({ where: "Placa", catalog: "items", ref: "", message });
      }
      if (s.implant?.enabled && idx.bodyFunctions?.size) checkRefs(issues, idx, "Implante › Funções", "bodyFunctions", s.implant.functions);
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
      for (const issue of moduleSensorIssues(s)) issues.push({ where: issue.where, catalog: "modules", ref: "", message: issue.message });
      break;
    case "body_part":
      if (idx.bodyFunctions?.size) checkRefs(issues, idx, "Funções", "bodyFunctions", s.functions);
      (s.installedMods ?? []).forEach((mod, i) => {
        const where = `Modificação ${i + 1}${mod?.name ? ` (${mod.name})` : ""}`;
        issues.push(...checkGrant(mod?.grantsSkill, idx, where));
        if (idx.bodyFunctions?.size) checkRefs(issues, idx, `${where} › Funções`, "bodyFunctions", mod?.functions);
      });
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
 * Vínculos da Nomeação e do Pacto (flags `soulLink`, `soulLinks`, `borrowLinks`, `lendLinks`) que
 * apontam para um Ator apagado. Só lista; o vínculo sobra inofensivo (o leitor ignora quem sumiu).
 * @param {object} [flags] - os flags do sistema no Ator
 * @param {(uuid:string) => boolean} uuidExists
 */
export function soulLinkIssues(flags, uuidExists = () => true) {
  const out = [];
  const check = (where, uuid) => {
    if (typeof uuid === "string" && uuid && !uuidExists(uuid)) out.push({ where, catalog: "actors", ref: uuid, message: "vínculo com um personagem que não existe mais (apagado)" });
  };
  check("Corredor de alma (quem nomeou)", flags?.soulLink?.namerUuid);
  for (const link of flags?.soulLinks ?? []) check("Corredor de alma (nomeado)", link?.namedUuid);
  for (const link of flags?.borrowLinks ?? []) check(link?.kind === "pact" ? "Pacto (patrono)" : "Corredor de alma (dono)", link?.sourceUuid);
  for (const link of flags?.lendLinks ?? []) check(link?.kind === "pact" ? "Pacto (bruxo)" : "Corredor de alma (usuário)", link?.borrowerUuid);
  return out;
}

/**
 * Um Ator com seus Itens.
 * @param {{name:string, type:string, system:object, items?:Array}} actor
 * @param {object} idx - buildCatalogIndex
 * @param {{uuidExists?: (uuid:string) => boolean}} [options]
 * @returns {Array<{where:string, catalog:string, ref:string, message:string, itemId?:string}>}
 */
export function validateActor(actor, idx, { uuidExists = () => true, catalogs = null, shops = false, depotAnywhere = true } = {}) {
  const s = actor?.system ?? {};
  const items = actor?.items ?? [];
  const issues = [];

  if (actor?.type === "character") {
    checkRef(issues, idx, "Espécie", "species", s.species);
    // "named" (Nomeação) é uma Herança de fábrica: se ela sumiu do catálogo não é erro (nada depende dela).
    checkRefs(issues, idx, "Heranças", "heritages", (s.heritages ?? []).map(h => h?.id).filter(id => id !== "named"));
    issues.push(...soulLinkIssues(actor?.flags?.["nihility-rpg-system"], uuidExists));
    if (s.lineage && catalogs?.species?.[s.species]) {
      const lineages = (catalogs.species[s.species].lineages ?? []).map(l => l.id);
      if (!lineages.includes(s.lineage)) issues.push({ where: "Linhagem", catalog: "species", ref: s.lineage, message: `"${s.lineage}" não existe nas Linhagens desta Espécie` });
    }
    checkRefs(issues, idx, "Traços", "traits", s.traits);
    checkRefs(issues, idx, "Traços removidos", "traits", s.traitsRemoved);
    checkRef(issues, idx, "Escala", "scales", s.scale);
    // Contêiner: Item Geral com `container.enabled` ou Skill com `grantsContainer.enabled`, do próprio Ator.
    const containers = new Set(
      items.filter(i => (i.type === "item" && i.system?.container?.enabled) || (i.type === "skill" && (i.system?.grantsContainer?.enabled || pocketEntryOf(i.system)))).map(i => i._id)
    );
    for (const item of items) {
      const containerId = item.system?.containerId;
      if (containerId && !containers.has(containerId)) {
        issues.push({ where: at(item.name, "Guardado em"), catalog: "containers", ref: containerId, message: "aponta para um contêiner que não existe mais (o item conta como solto)", itemId: item._id });
      }
    }
  }

  // Loja (G2): aberta sem estoque, item à venda sem preço base, jogadores que não enxergam a ficha.
  if (actor?.type === "character" && s.shop?.enabled) {
    const stock = items
      .filter(i => i.type === "item" || i.type === "starship_module")
      .map(i => {
        const shop = normalizeItemShop(i.system?.shop);
        return { name: i.name, stock: shop.stock, digital: shop.digital, deliveryHours: shop.deliveryHours, hasPrice: shop.basePrice > 0 || (Number(i.system?.value?.amount) || 0) > 0 || shop.priceOverride !== null };
      });
    for (const issue of shopSetupIssues({ shop: s.shop, stock, shopsEnabled: shops, depotAnywhere })) issues.push({ where: issue.where, catalog: "shops", ref: "", message: issue.message });
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
    for (const issue of shipSensorIssues(s, {
      hasSensor: items.some(i => i.type === "starship_module" && (i.system?.functions ?? []).includes("sensor")),
      dockExists: !s.dock?.withUuid || uuidExists(s.dock.withUuid),
      boarderExists: uuidExists
    })) issues.push({ where: issue.where, catalog: "sensors", ref: "", message: issue.message });
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
 * Comportamento de Região "Armadilha (Nihility)" (I1): Condição, elemento ou Traço imune que não
 * existe mais. Recebe os campos do comportamento (`behavior.system`, já como objeto simples).
 * @returns {Array<{where:string, catalog:string, ref:string, message:string}>}
 */
export function validateTrap(system, idx) {
  const issues = [];
  checkRef(issues, idx, "Condição", "conditions", system?.conditionId);
  checkRefs(issues, idx, "Elemento", "elements", [...(system?.damageElements ?? [])]);
  checkRefs(issues, idx, "Imune com", "traits", [...(system?.immuneTraits ?? [])]);
  return issues;
}

/** Módulos de calendário de terceiros que o Nihility ignora (e que podem voltar o tempo do mundo). */
export const CALENDAR_MODULES = ["seasons-and-stars", "foundryvtt-simple-calendar", "foundryvtt-simple-calendar-reborn"];

/**
 * Linhas do tempo e módulos de calendário (J9b). Pura.
 * @param {{timelines?: Array<{id:string,name?:string,rate?:number}>, scenes?: Array<{name:string, lineId:string}>, folders?: Array<{name:string, lineId:string}>, activeModules?: string[], chambers?: Array<{where:string, rate:number}>}} input
 *   `timelines` = a lista CRUA salva (antes de limitar o ritmo).
 * @returns {Array<{where:string, message:string}>}
 */
export function validateTimeSetup({ timelines = [], scenes = [], activeModules = [], chambers = [], folders = [] } = {}) {
  const issues = [];
  const ids = new Set((timelines ?? []).map(l => l?.id).concat("main"));
  for (const line of timelines ?? []) {
    if (!line || line.id === "main" || line.rate === undefined) continue;
    const rate = Number(line.rate);
    if (!(rate >= 1e-10 && rate <= 1e6)) issues.push({ where: `Linha "${line.name || line.id}"`, message: `o ritmo ${line.rate} está fora de 10⁻¹⁰ a 10⁶ (o sistema usa o limite mais próximo; 0 ou negativo vira 1)` });
  }
  // Câmaras do tempo (8b.2): o ritmo da Região também vale de 10⁻¹⁰ a 10⁶.
  for (const chamber of chambers ?? []) {
    const rate = Number(chamber?.rate);
    if (!(rate >= 1e-10 && rate <= 1e6)) issues.push({ where: `Câmara do tempo "${chamber?.where || "?"}"`, message: `o ritmo ${chamber?.rate} está fora de 10⁻¹⁰ a 10⁶ (o sistema usa o limite mais próximo; 0 ou negativo vira 1)` });
  }
  for (const scene of scenes ?? []) {
    if (scene?.lineId && !ids.has(scene.lineId)) issues.push({ where: `Cena "${scene.name}"`, message: `está numa linha do tempo que foi apagada ("${scene.lineId}"): conta como a linha principal` });
  }
  // Pasta de cenas (H20): o valor da pasta cita uma linha que não existe mais (as cenas dela herdam o erro).
  for (const folder of folders ?? []) {
    if (folder?.lineId && !ids.has(folder.lineId)) issues.push({ where: `Pasta de cenas "${folder.name}"`, message: `define uma linha do tempo que foi apagada ("${folder.lineId}"): as cenas dela que herdam contam como a linha principal` });
  }
  for (const id of CALENDAR_MODULES) {
    if ((activeModules ?? []).includes(id)) issues.push({ where: "Módulo de calendário", message: `"${id}" está ativo: o Nihility o ignora (a data vem da linha do tempo). O "definir data" dele volta o tempo do mundo, o que o aviso de retrocesso pega; só a linha principal aparece nele` });
  }
  return issues;
}

/**
 * Referências ENTRE catálogos: elemento → Condição/Traço/elemento, Condição → elemento, Espécie →
 * Traço/elemento/Skill Racial, Estrutura → elemento, Escala por Porte, faixa e vagas das Classes.
 * @returns {Array<{catalog:string, entry:string, where:string, message:string}>}
 */
/**
 * Condições que o PRÓPRIO sistema usa para segurar alguém (Âncora, Domínio/Preso, Antimagia/PEM, Vida 0, Dormindo,
 * selos): Imunidade ou Resistência da origem a elas faz o Domínio, a Âncora ou a Antimagia falharem em silêncio.
 */
export function isSystemHoldingCondition(condition) {
  if (!condition) return false;
  return Boolean(Number(condition.anchorLevel) > 0 || condition.suppressesMagic || condition.suppressesTech || condition.incapacitates || Number(condition.antimagicLevel) > 0 || Number(condition.interferenceLevel) > 0);
}

/**
 * Defesas de uma origem (Espécie, Linhagem ou Herança): alvos de Resistência/fraqueza que não existem, Condições que não
 * existem e Imunidade/Resistência a uma Condição que o próprio sistema usa para segurar alguém (1.117.0). Pura.
 * @param {object} entry - a entrada do catálogo (usa `passives.resistances` e `passives.conditions`)
 * @param {object} idx - `buildCatalogIndex`
 * @param {Array} [conditions] - o catálogo de Condições (para reconhecer as do sistema)
 * @param {string} [prefix]
 */
export function originDefenseIssues(entry, idx, conditions = [], prefix = "") {
  const issues = [];
  (entry?.passives?.resistances ?? []).forEach((r, i) => checkResistanceTarget(issues, idx, at(prefix, `Resistência ${i + 1}`), r?.target));
  (entry?.passives?.conditions ?? []).forEach((c, i) => {
    const where = at(prefix, `Condição ${i + 1}`);
    checkRef(issues, idx, where, "conditions", c?.conditionId);
    const condition = (conditions ?? []).find(x => x?.id === c?.conditionId);
    if (isSystemHoldingCondition(condition)) {
      const how = c?.mode === "immune" || Number(c?.amount) >= 100 ? "Imunidade" : `Resistência ${Number(c?.amount) || 0}%`;
      issues.push({ where, catalog: "conditions", ref: c.conditionId, message: `${how} a "${condition.label ?? condition.id}", que o próprio sistema usa para segurar alguém (Âncora, Domínio, Antimagia, Vida 0): essas regras podem falhar nesta origem` });
    }
  });
  return issues;
}

export function validateCatalogs(catalogs, idx = buildCatalogIndex(catalogs)) {
  const issues = [];
  const push = (catalog, entry, list) => list.forEach(issue => issues.push({ ...issue, catalog, entry }));

  // Conjuntos (J12): sem peças, faixa maior que o número de peças, faixa sem bônus, alvo que não existe.
  for (const problem of itemSetIssues(catalogs.itemSets ?? [], { elementIds: idx.elements, attributeKeys: idx.attributes })) {
    issues.push({ catalog: "itemSets", entry: problem.label, where: "Conjunto", ref: problem.setId, message: problem.text });
  }

  // Tipos de arma: pai desconhecido, de si mesmo ou em ciclo.
  for (const problem of weaponTypeCatalogIssues(catalogs.weaponTypes)) {
    const message = { selfParent: "o tipo é subtipo de si mesmo", unknownParent: `"${problem.parent}" não existe em Tipos de Arma`, cycle: "a cadeia de \"Subtipo de\" volta para si mesma (ciclo)" }[problem.kind];
    issues.push({ catalog: "weaponTypes", entry: problem.id, where: "Subtipo de", ref: problem.parent ?? "", message });
  }

  for (const element of catalogs.elements ?? []) {
    const list = [];
    (element.effects ?? []).forEach((effect, i) => {
      if (effect?.type === "condition") checkRef(list, idx, `Efeito ${i + 1} › Condição`, "conditions", effect.conditionId);
      if (effect?.type === "blockRegen" && effect.conditionId) checkRef(list, idx, `Efeito ${i + 1} › Condição (Impede regeneração)`, "conditions", effect.conditionId);
      if (effect?.type === "traitBonus") checkRef(list, idx, `Efeito ${i + 1} › Traço`, "traits", effect.trait);
    });
    checkRefs(list, idx, "Tabela de vantagens", "elements", Object.keys(element.affinity ?? {}));
    // Reações elementais (8.1): o elemento carregado, a Condição que aplica/tira e a superfície que deixa.
    for (const [carriedId, reaction] of Object.entries(element.reactions ?? {})) {
      const where = `Reação contra ${carriedId}`;
      checkRef(list, idx, `${where} › elemento carregado`, "elements", carriedId);
      checkRef(list, idx, `${where} › aplica Condição`, "conditions", reaction?.applyCondition?.conditionId);
      checkRef(list, idx, `${where} › tira Condição`, "conditions", reaction?.removeCondition);
      checkRef(list, idx, `${where} › deixa no chão`, "elements", reaction?.leaveSurface);
    }
    // Superfícies (8.2): "Deixa no chão" — a Condição que aplica e os Traços imunes.
    if (element.surface) {
      checkRef(list, idx, "Deixa no chão › Condição", "conditions", element.surface.conditionId);
      checkRefs(list, idx, "Deixa no chão › Traços imunes", "traits", element.surface.immuneTraits);
    }
    if (element.parent) {
      if (element.parent === element.id) list.push({ where: "Subtipo de", catalog: "elements", ref: element.parent, message: "o elemento é subtipo de si mesmo" });
      else checkRef(list, idx, "Subtipo de", "elements", element.parent);
      // Ciclo (A subtipo de B, B subtipo de A): a cadeia é cortada no ciclo, mas vale avisar.
      const byId = new Map((catalogs.elements ?? []).map(e => [e.id, e]));
      const seen = new Set([element.id]);
      for (let current = element.parent; current && byId.has(current); current = byId.get(current)?.parent) {
        if (seen.has(current)) {
          list.push({ where: "Subtipo de", catalog: "elements", ref: current, message: `ciclo em "Subtipo de" passando por "${current}"` });
          break;
        }
        seen.add(current);
      }
    }
    push("elements", element.label ?? element.id, list);
  }

  for (const condition of catalogs.conditions ?? []) {
    const list = [];
    checkRefs(list, idx, "Elementos", "elements", condition.elements);
    checkRefs(list, idx, "Contágio › Imune com", "traits", condition.spread?.immuneTraits);
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
    list.push(...originDefenseIssues(preset, idx, catalogs.conditions));
    for (const lineage of preset?.lineages ?? []) list.push(...originDefenseIssues(lineage, idx, catalogs.conditions, `Linhagem ${lineage?.label ?? lineage?.id}`));
    push("species", preset?.label ?? key, list);
  }

  for (const heritage of catalogs.heritages ?? []) {
    const list = [];
    checkRefs(list, idx, "Traços", "traits", heritage.traits);
    checkRefs(list, idx, "Tira Traços", "traits", heritage.removesTraits);
    checkRefs(list, idx, "Elementos", "elements", heritage.elements);
    checkRefs(list, idx, "Não convive com", "heritages", heritage.excludes);
    checkRefs(list, idx, "Espécies permitidas", "species", heritage.allowedSpecies?.list);
    (heritage.skills ?? []).forEach((skill, i) => list.push(...checkMechanic(skill, idx, `Skill ${i + 1}${skill?.name ? ` (${skill.name})` : ""}`)));
    list.push(...originDefenseIssues(heritage, idx, catalogs.conditions));
    push("heritages", heritage.label ?? heritage.id, list);
  }

  for (const fn of catalogs.bodyFunctions ?? []) {
    const list = [];
    if (fn.effect?.kind === "condition") checkRef(list, idx, "Condição", "conditions", fn.effect.conditionId);
    if (fn.effect?.kind === "removeTrait") checkRef(list, idx, "Traço", "traits", fn.effect.traitId);
    if (fn.effect?.kind === "movement" && fn.effect.crawlFunction) checkRef(list, idx, "Arrastar com", "bodyFunctions", fn.effect.crawlFunction);
    push("bodyFunctions", fn.label ?? fn.id, list);
  }

  for (const structure of catalogs.structures ?? []) {
    const list = [];
    checkRefs(list, idx, "Elementos", "elements", structure.elements);
    // Campo de Âncora (8f) sem duração fica de pé até a Antimagia ou o Mestre o derrubar.
    if (Number(structure.anchorLevel) > 0 && !(Number(structure.durationRounds) > 0)) list.push({ where: "Âncora", catalog: "space", ref: "", message: "Campo de Âncora sem duração: fica de pé até a Antimagia ou o Mestre o tirar" });
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
