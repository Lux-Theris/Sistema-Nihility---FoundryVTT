/**
 * Leitores dos catálogos editáveis pelo Mestre (setting > padrão), rótulos e configurações lidas das settings.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { buildAffinityMatrix, elementAncestors } from "../../combat/damage-rules.js";
import { MEU_SISTEMA, SYSTEM_ID } from "./constants.js";
import { getFeatureOption } from "./features.js";
import { normalizeLightConfig } from "./rules.js";
import { createRawCache, memoByObject } from "./cache.js";

const rawCache = createRawCache();

/**
 * Lê a setting de catálogo `settingKey` e devolve `build(raw)`, guardado enquanto o texto salvo
 * não mudar (ver cache.js — quem recebe NÃO altera o resultado; copie antes). Setting que ainda não
 * existe (carga do Foundry, testes): reconstrói sempre, como antes do cache.
 * @param {string} settingKey - chave em MEU_SISTEMA.SETTINGS
 * @param {(raw: unknown) => unknown} build
 * @param {string} [cacheKey] - quando duas leituras da mesma setting montam coisas diferentes
 */
function cachedCatalog(settingKey, build, cacheKey = settingKey) {
  let raw;
  try {
    raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingKey]);
  } catch (err) {
    return build(undefined);
  }
  return rawCache(cacheKey, raw, build);
}

/**
 * Lê a lista de moedas atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,icon:string,weight:number,baseValue:number}>}
 */
export function getActiveCurrencies() {
  return cachedCatalog("currenciesData", raw => {
    try {
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | JSON de moedas inválido, usando padrão.`, err);
    }
    return MEU_SISTEMA.DEFAULT_CURRENCIES;
  });
}

/**
 * Converte uma quantidade de uma moeda para outra usando a razão de `baseValue`
 * das duas (funciona pra qualquer hierarquia de moedas que o Mestre definir).
 * @returns {number} quantidade equivalente na moeda de destino (pode ser fracionária)
 */
export function convertCurrencyAmount(fromId, toId, amount) {
  const currencies = getActiveCurrencies();
  const from = currencies.find(c => c.id === fromId);
  const to = currencies.find(c => c.id === toId);
  if (!from || !to || !to.baseValue) return 0;
  return (amount * (from.baseValue ?? 1)) / to.baseValue;
}

/**
 * Lê a lista de Tipos de Dano Elemental atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,color:string}>}
 */
export function getActiveDamageElements() {
  return cachedCatalog("damageElementsData", buildDamageElements);
}

/** O catálogo de elementos normalizado a partir do texto salvo (ver getActiveDamageElements). */
function buildDamageElements(raw) {
  let list = MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS;
  try {
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length) list = parsed;
    }
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de elementos de dano inválido, usando padrão.`, err);
  }
  // Listas salvas antes de grupos/efeitos existirem continuam valendo, sem efeito. O grupo vem do
  // elemento padrão de mesmo id (Fogo → Fantasia, Phaser → Energia…); só o que o Mestre criou
  // sem grupo cai em "Outros".
  const knownGroups = new Map(
    [...MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS, ...MEU_SISTEMA.SCIFI_DAMAGE_ELEMENTS].map(el => [el.id, el.group])
  );
  return list.map(el => ({
    ...el,
    group: el.group || knownGroups.get(el.id) || "Outros",
    // O antigo "Dano extra contra elemento" vira nível na tabela (buildAffinityMatrix) e sai da lista.
    affinity: buildAffinityMatrix([el])[el.id] ?? {},
    effects: Array.isArray(el.effects) ? el.effects.filter(e => e?.type !== "vsElement") : []
  }));
}

/** Tabela de vantagens `{atacante: {defensor: nível}}` do catálogo ativo (refeita só quando a lista muda). */
const affinityMatrixOf = memoByObject(list => buildAffinityMatrix(list));
export function getElementAffinityMatrix() {
  return affinityMatrixOf(getActiveDamageElements());
}

/** Multiplicador de cada nível da tabela (Regras da Mesa). */
export function getAffinityConfig() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return {
    immune: read("affinityImmune", 0),
    ineffective: read("affinityIneffective", 0.5),
    effective: read("affinityEffective", 1.5),
    superEffective: read("affinitySuperEffective", 2)
  };
}

/** Um elemento pelo id, já normalizado (ver `getActiveDamageElements`). */
export function getDamageElement(id) {
  return getActiveDamageElements().find(el => el.id === id) ?? null;
}

/** Catálogo de Traços (setting > padrão). */
export function getActiveTraits() {
  return cachedCatalog("traitsData", raw => {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed.filter(t => t?.id);
    } catch (err) {
      /* setting ausente/inválida — cai no padrão */
    }
    return MEU_SISTEMA.DEFAULT_TRAITS;
  });
}

/** Rótulo de um Traço (cai no id se o Traço sumiu do catálogo). */
export function getTraitLabel(id) {
  return getActiveTraits().find(t => t.id === id)?.label ?? id;
}

/** Configuração de Escala (setting > padrão), sempre com as três chaves. */
export function getScaleConfig() {
  return cachedCatalog("scalesData", raw => {
    let saved = null;
    try {
      saved = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      /* setting ausente/inválida — cai no padrão */
    }
    const fallback = MEU_SISTEMA.DEFAULT_SCALES;
    const scales = Array.isArray(saved?.scales) && saved.scales.length ? saved.scales : fallback.scales;
    return {
      scales,
      shipSizeMap: { ...fallback.shipSizeMap, ...(saved?.shipSizeMap ?? {}) },
      vehicleSizeMap: { ...fallback.vehicleSizeMap, ...(saved?.vehicleSizeMap ?? {}) }
    };
  });
}

/** Índice de uma Escala pelo id, ou `null` se vazio/desconhecido (quem chama usa a de quem ataca). */
export function scaleIndexOf(id) {
  if (!id) return null;
  const index = getScaleConfig().scales.findIndex(s => s.id === id);
  return index >= 0 ? index : null;
}

/**
 * Lê a lista de Condições de Status atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,icon:string}>}
 */
export function getActiveStatusConditions() {
  return cachedCatalog("statusConditionsData", raw => {
    try {
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | JSON de condições de status inválido, usando padrão.`, err);
    }
    return MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS;
  });
}

/**
 * Alvos possíveis de Resistência: "Geral" (reduz qualquer dano) + cada Elemento de Dano ativo —
 * mesma lista usada tanto pela Skill (que tem uma opção extra "Nenhuma" fora daqui, montada por
 * quem chama) quanto pelo Título (cada entrada de Resistência sempre tem um alvo escolhido).
 * Extraída aqui porque item-sheet.js e skill-editor-dialog.js precisavam exatamente da mesma
 * lista.
 * @returns {Array<{value:string,label:string}>}
 */
export function getResistanceTargetOptions() {
  return [{ value: "general", label: "Geral" }, ...getActiveDamageElements().map(el => ({ value: el.id, label: damageElementPathLabel(el.id) }))];
}

/**
 * O elemento e os ancestrais dele ("Subtipo de"), como objetos do catálogo: Cortante → [Cortante,
 * Físico]. Elemento que não existe: lista vazia.
 */
export function damageElementChain(id) {
  const elements = getActiveDamageElements();
  const self = elements.find(el => el.id === id);
  if (!self) return [];
  return [self, ...elementAncestors(id, elements).map(a => elements.find(el => el.id === a)).filter(Boolean)];
}

/** "Físico › Cortante" para um subtipo; o nome simples para o resto. */
export function damageElementPathLabel(id) {
  const chain = damageElementChain(id);
  if (!chain.length) return id;
  return chain.map(el => el.label).reverse().join(" › ");
}

/** Catálogo de Funções de Parte (setting > padrão). Ver DEFAULT_BODY_FUNCTIONS. */
export function getActiveBodyFunctions() {
  return cachedCatalog("bodyFunctionsData", raw => {
    try {
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return parsed.filter(f => f?.id);
      }
    } catch (err) {
      /* setting ausente/inválida — cai no padrão */
    }
    return MEU_SISTEMA.DEFAULT_BODY_FUNCTIONS;
  });
}

/**
 * Catálogo de Heranças (o que ACONTECEU com o personagem: Vampirizado, Meio-Dragão…), que vale
 * para qualquer Espécie. Lista `{id, label, group, description, traits, removesTraits, elements,
 * passives, parts, skills, replaces, allowedSpecies:{mode, list}, excludes, announce}`.
 * Setting salva > padrão (MEU_SISTEMA.DEFAULT_HERITAGES).
 */
export function getActiveHeritages() {
  return cachedCatalog("heritagesData", raw => {
    try {
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return parsed.filter(h => h?.id);
      }
    } catch (err) {
      /* setting ausente/inválida — cai no padrão */
    }
    return MEU_SISTEMA.DEFAULT_HERITAGES;
  });
}

/**
 * Lê o dicionário de presets de espécie atualmente ativo.
 * Assim que o GM salva algo pelo editor visual (Configurar Presets de Espécie),
 * o resultado completo passa a ser a única fonte da verdade; até lá, usa os padrões.
 * @returns {Record<string, {label:string, parts:Array, skills:Array}>}
 */
export function getActiveSpeciesPresets() {
  return cachedCatalog("speciesPresetsData", raw => {
    try {
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return parsed;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | JSON de presets de espécie inválido, usando padrão.`, err);
    }
    return MEU_SISTEMA.DEFAULT_SPECIES_PRESETS;
  });
}

/**
 * Espécies que o seletor da ficha deve oferecer. O Mestre vê todas — ele precisa poder aplicar
 * qualquer preset, inclusive os de Montaria; o jogador só vê as marcadas como disponíveis.
 * @returns {Array<{key:string, label:string}>}
 */
export function getSpeciesForCreation() {
  const presets = getActiveSpeciesPresets();
  return Object.entries(presets)
    .filter(([, def]) => game.user.isGM || def.availableAtCreation !== false)
    .map(([key, def]) => ({ key, label: def.label ?? key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Rótulo atual do sistema de energia de Personagens/Criaturas (setting > default). */
export function getCharacterEnergyLabel() {
  try {
    const label = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.characterEnergyLabel);
    if (label && String(label).trim().length) return label;
  } catch (err) {
    /* settings ainda não registradas (fora do hook init/ready) */
  }
  return MEU_SISTEMA.DEFAULT_CHARACTER_ENERGY_LABEL;
}

/**
 * Forma CURTA do rótulo de energia de Nave, pra usar em coluna de tabela — o nome completo
 * ("Sistema Eletro-Plasmático (EPS)") repetido em toda linha de Módulo consumia metade da largura
 * da ficha. O nome completo continua valendo em título e mensagem de chat.
 */
export function getStarshipEnergyAbbr() {
  try {
    const abbr = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.starshipEnergyAbbr);
    if (abbr && String(abbr).trim().length) return String(abbr).trim();
  } catch (err) {
    /* setting ainda não registrada */
  }
  return "EPS";
}

/** Rótulo atual do sistema de energia de Naves Espaciais (setting > default). */
export function getStarshipEnergyLabel() {
  try {
    const label = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.starshipEnergyLabel);
    if (label && String(label).trim().length) return label;
  } catch (err) {
    /* settings ainda não registradas (fora do hook init/ready) */
  }
  return MEU_SISTEMA.DEFAULT_STARSHIP_ENERGY_LABEL;
}

/**
 * Preset completo (stats de MODULE_SIZE_PRESETS + hp.max/value de MODULE_HP_BY_SIZE) pra um
 * Módulo de uma Categoria×Porte — usado tanto pelo autopreenchimento do editor de Item (Fase
 * 1/8, `_onModulePresetChange`/`onItemCreate`) quanto pela geração de Nave via IA (Fase 9), pra
 * nunca duplicar a lógica de "que número sugerir" em dois lugares. Chaves já vêm no formato
 * `system.<campo>` pronto pra entrar direto num objeto de `createEmbeddedDocuments`/`update`.
 */
export function getModuleSizePreset(category, moduleSize) {
  const preset = {};
  // Presets são por Função (a Categoria "Manobradores" usa a linha de Propulsão/"engine").
  const presetKey = MEU_SISTEMA.MODULE_ROLES[moduleRole(category)]?.presetKey ?? category;
  for (const [field, value] of Object.entries(MEU_SISTEMA.MODULE_SIZE_PRESETS[presetKey]?.[moduleSize] ?? {})) {
    preset[`system.${field}`] = value;
  }
  const hp = MEU_SISTEMA.MODULE_HP_BY_SIZE[moduleSize];
  if (hp) {
    preset["system.hp.max"] = hp;
    preset["system.hp.value"] = hp;
  }
  return preset;
}

/** A lista JSON de uma setting (só as entradas com id), ou null se vazia/inválida/ausente. */
function parseCatalogList(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length) return parsed.filter(e => e?.id);
  } catch (err) {
    /* setting ausente/inválida — cai no padrão */
  }
  return null;
}

/** Lê uma lista JSON de uma setting; cai no padrão se vazia/inválida/ausente. */
function readCatalog(settingKey, fallback) {
  return cachedCatalog(settingKey, parseCatalogList, `${settingKey}:lista`) ?? fallback;
}

/** Catálogo inteiro (leitura + normalização) guardado pelo texto salvo; `normalize` recebe a lista. */
function cachedList(settingKey, fallback, normalize) {
  return cachedCatalog(settingKey, raw => normalize(parseCatalogList(raw) ?? fallback));
}

/** Catálogo de Categorias de Módulo (setting > padrão), com Função válida em toda entrada. */
export function getModuleCategories() {
  return cachedList("moduleCategoriesData", MEU_SISTEMA.DEFAULT_MODULE_CATEGORIES, list => list.map(c => ({
    ...c,
    label: c.label || c.id,
    role: MEU_SISTEMA.MODULE_ROLES[c.role] ? c.role : "utility",
    slots: Math.max(0, Math.round(Number(c.slots) || 0))
  })));
}

/**
 * Função mecânica de uma Categoria. Id que sumiu do catálogo: tenta a Categoria padrão de mesmo
 * id (Naves antigas), senão Utilidade — um Módulo órfão nunca quebra a Nave, só perde a mecânica.
 */
export function moduleRole(categoryId) {
  const found = getModuleCategories().find(c => c.id === categoryId)
    ?? MEU_SISTEMA.DEFAULT_MODULE_CATEGORIES.find(c => c.id === categoryId);
  return found?.role ?? "utility";
}

/** Rótulo de uma Categoria (cai no id). */
export function moduleCategoryLabel(categoryId) {
  return getModuleCategories().find(c => c.id === categoryId)?.label
    ?? MEU_SISTEMA.STARSHIP_MODULE_CATEGORY_LABELS[categoryId] ?? categoryId;
}

/* ------------------------------------------------------------------ Inventário */

/** Catálogo de Tipos de Munição. */
export function getAmmoTypes() {
  return cachedList("ammoTypesData", MEU_SISTEMA.DEFAULT_AMMO_TYPES, list => list.map(a => ({ ...a, label: a.label || a.id })));
}

/** Catálogo de Classes: `"ship"` (Nave) ou `"vehicle"` (Veículo). */
export function getVesselClasses(kind) {
  return kind === "vehicle"
    ? cachedList("vehicleClassesData", MEU_SISTEMA.DEFAULT_VEHICLE_CLASSES, normalizeVesselClasses)
    : cachedList("shipClassesData", MEU_SISTEMA.DEFAULT_SHIP_CLASSES, normalizeVesselClasses);
}

function normalizeVesselClasses(list) {
  return list.map(c => ({
    ...c,
    label: c.label || c.id,
    evasionMultiplier: Number(c.evasionMultiplier) >= 0 ? Number(c.evasionMultiplier) : 1,
    movementMultiplier: Number(c.movementMultiplier) >= 0 ? Number(c.movementMultiplier) : 1,
    weaponBudgetMultiplier: Number(c.weaponBudgetMultiplier) >= 0 ? Number(c.weaponBudgetMultiplier) : 1,
    slots: c.slots && typeof c.slots === "object" ? c.slots : {},
    // Bônus de Resistência à Penetração por camada e de Endurecimento (%), somados aos dos Módulos.
    shieldPenResist: Math.max(0, Number(c.shieldPenResist) || 0),
    cascoPenResist: Math.max(0, Number(c.cascoPenResist) || 0),
    hardening: Math.max(0, Number(c.hardening) || 0),
    // Faixa de Porte aceita (ids da lista de Portes do mesmo tipo; vazio = sem limite).
    minSize: typeof c.minSize === "string" ? c.minSize : "",
    maxSize: typeof c.maxSize === "string" ? c.maxSize : ""
  }));
}

/** Número ≥ 0 (ou o padrão). */
function nonNegative(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Catálogo de Portes (`"ship"` ou `"vehicle"`), do menor pro maior, com números saneados. Sem
 * catálogo salvo, os Portes de Nave (e os mini/pequeno… de Veículo) herdam as casas e a Evasão
 * que o Mestre já tinha ajustado nas opções antigas de "Movimento e Evasão de naves".
 */
export function getVesselSizes(kind) {
  const isVehicle = kind === "vehicle";
  const defaults = isVehicle ? MEU_SISTEMA.DEFAULT_VEHICLE_SIZES : MEU_SISTEMA.DEFAULT_SHIP_SIZES;
  const suffix = { mini: "Mini", pequeno: "Pequeno", medio: "Medio", grande: "Grande", capital: "Capital" };
  const seeded = defaults.map(s => (suffix[s.id]
    ? { ...s, move: getFeatureOption("shipManeuver", `shipMove${suffix[s.id]}`), evasion: getFeatureOption("shipManeuver", `shipEvasion${suffix[s.id]}`) }
    : s));
  const list = readCatalog(isVehicle ? "vehicleSizesData" : "shipSizesData", seeded);
  return list.map(s => normalizeVesselSize(s, defaults.find(d => d.id === s.id) ?? defaults[0]));
}

function normalizeVesselSize(s, base) {
  return {
    id: s.id,
    label: s.label || s.id,
    rank: Math.min(4, Math.max(0, Math.round(nonNegative(s.rank, base.rank)))),
    weaponBudget: nonNegative(s.weaponBudget, base.weaponBudget),
    distributorBaseline: nonNegative(s.distributorBaseline, base.distributorBaseline),
    conduitCapacitor: nonNegative(s.conduitCapacitor, base.conduitCapacitor),
    move: nonNegative(s.move, base.move),
    evasion: nonNegative(s.evasion, base.evasion),
    massReference: nonNegative(s.massReference, base.massReference) || base.massReference
  };
}

/**
 * Linha do Porte `sizeId` no catálogo do tipo. Id que saiu do catálogo cai no Porte padrão de
 * mesmo id, senão no primeiro: uma Nave nunca quebra por um Porte apagado, só volta aos números
 * padrão até o Mestre escolher outro.
 */
export function vesselSizeFor(kind, sizeId) {
  const found = getVesselSizes(kind).find(s => s.id === sizeId);
  if (found) return found;
  const defaults = kind === "vehicle" ? MEU_SISTEMA.DEFAULT_VEHICLE_SIZES : MEU_SISTEMA.DEFAULT_SHIP_SIZES;
  const fallback = defaults.find(s => s.id === sizeId) ?? getVesselSizes(kind)[0] ?? defaults[0];
  return normalizeVesselSize(fallback, fallback);
}

/** Rótulo de um Porte (cai no id). */
export function vesselSizeLabel(kind, sizeId) {
  return getVesselSizes(kind).find(s => s.id === sizeId)?.label ?? sizeId ?? "";
}

/** Catálogo de Estruturas (setting > padrão), com números saneados. */
export function getStructures() {
  return cachedList("structuresData", MEU_SISTEMA.DEFAULT_STRUCTURES, list => list.map(s => ({
    ...s,
    label: s.label || s.id,
    shape: MEU_SISTEMA.STRUCTURE_SHAPES.includes(s.shape) ? s.shape : "line",
    size: Math.max(0.5, Number(s.size) || 1),
    hp: Math.max(0, Math.round(Number(s.hp) || 0)),
    durationRounds: Math.max(0, Math.round(Number(s.durationRounds) || 0)),
    blocksMove: s.blocksMove !== false,
    blocksSight: Boolean(s.blocksSight),
    color: s.color || "#9aa1c2",
    // Luz opcional (Barreira de energia com Campo de Energia etc.) — ver lights.js.
    light: normalizeLightConfig(s.light),
    // Segura golpes entre quem ataca e o alvo? Campo antimagia e Muralha de Fogo não seguram.
    blocksAttacks: s.blocksAttacks !== false,
    // Elementos da Estrutura (Parede de Gelo = Gelo): o golpe contra ela segue "Dano extra contra
    // elemento" dos elementos de quem ataca, e o dano de contato é desses elementos.
    elements: Array.isArray(s.elements) ? s.elements.filter(e => typeof e === "string" && e) : [],
    magic: Boolean(s.magic),
    antimagicLevel: Math.max(0, Math.round(Number(s.antimagicLevel) || 0)),
    contactDamage: typeof s.contactDamage === "string" ? s.contactDamage.trim() : ""
  })));
}

/* ------------------------------------------------------------------ Antimagia */

/** Números da antimagia (Regras da Mesa), com os padrões. */
export function getAntimagicConfig() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return { base: Math.max(0, read("antimagicBase", 10)), growth: Math.max(1, read("antimagicGrowth", 2)) };
}

/** Alcance da Antimagia (prancha 8): nível × isto = até onde ela corta, desliga e suprime. Padrão 1,5. */
export function getAntimagicReach() {
  try {
    const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.antimagicReach));
    return Number.isFinite(value) && value > 0 ? value : 1.5;
  } catch (err) {
    return 1.5;
  }
}

/** Números das ações e do foco de energia da Nave (Regras da Mesa), com os padrões. */
export function getShipActionConfig() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return {
    bracePercent: Math.min(95, Math.max(0, read("shipBracePercent", 30))),
    focusBoost: Math.max(100, read("shipFocusBoost", 150)),
    focusCut: Math.min(100, Math.max(0, read("shipFocusCut", 75))),
    // Vida extra que quem está no posto de Engenharia restaura no reparo (fórmula; vazio = nada).
    repairEngineerFormula: (() => {
      try {
        return String(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.shipRepairEngineerFormula) ?? "").trim();
      } catch (err) {
        return "1d6";
      }
    })()
  };
}

/** "Mirar num sistema": perguntar ao atacar Nave, e a fatia (0-1) que vai pro Módulo mirado. */
export function getShipTargetingConfig() {
  let ask = true;
  let share = 0.75;
  try {
    ask = Boolean(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.shipTargetAsk));
    const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.shipTargetShare));
    if (Number.isFinite(value)) share = Math.min(1, Math.max(0, value / 100));
  } catch (err) {
    /* setting ainda não registrada — padrão */
  }
  return { ask, share };
}

/** Descanso Curto, bloqueio de cura e o nível em que a Cura refaz parte perdida (com os padrões). */
export function getHealingRules() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return {
    shortHpPercent: Math.max(0, read("restShortHpPercent", 25)),
    shortEnergyPercent: Math.max(0, read("restShortEnergyPercent", 50)),
    zeroMultiplier: Math.max(1, read("healBlockZeroMultiplier", 2)),
    cureRegrowLevel: Math.max(0, read("cureRegrowLevel", 10))
  };
}

/** Expoente e mínimo (% do Custo) da Mana variável, com os padrões quando a setting falta. */
export function getManaInvestConfig() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return {
    exponent: Math.min(1, Math.max(0.05, read("manaInvestExponent", 0.75))),
    minPercent: Math.max(0, read("manaInvestMinPercent", 25))
  };
}

/** Catálogo de Funções de Tripulação. */
export function getCrewRoles() {
  return cachedList("crewRolesData", MEU_SISTEMA.DEFAULT_CREW_ROLES, list => list.map(r => ({ ...r, label: r.label || r.id })));
}

/*
 * Tokens NÃO vinculados ("Drone (1)", "Drone (2)") são pessoas diferentes com a mesma ficha-base:
 * cada um tem o próprio Ator sintético, com `uuid` próprio mas o MESMO `id` da ficha do Diretório.
 * Comparar por `id` (ou buscar com `game.actors.get(id)`) mistura os dois — o dano ia pra ficha
 * do Diretório, a iniciativa rolava pro combatente errado. Compare sempre por `uuid` (um Token
 * vinculado dá o mesmo `uuid` da ficha, então continua contando uma vez só).
 */

/**
 * Atributos de combate com rótulo e visibilidade atuais (setting > padrão do código).
 *
 * As CHAVES são imutáveis de propósito e nunca entram na edição: elas aparecem dentro de
 * caminhos de Active Effect já gravados (`system.attributes.combat.magic.buffDelta`), em
 * `EFFECT_TARGETS`, em `TITLE_BONUS_TARGETS` e nas settings de fórmula vital — deixar o Mestre
 * renomear a chave apagaria silenciosamente todo efeito, Título e fórmula que já apontasse pra
 * ela. O que é editável é só o RÓTULO e o liga/desliga de exibição.
 *
 * `visible: false` some o atributo da ficha e da rolagem, mas o valor salvo continua existindo e
 * continua contando em toda conta que já o usava (inclusive a fórmula de HP/Mana) — reexibir
 * devolve o atributo exatamente como estava. Desligar nunca destrói dado, mesma regra de
 * MEU_SISTEMA.FEATURES.
 * @returns {Array<{key:string,label:string,visible:boolean}>} sempre na ordem de COMBAT_ATTRIBUTES
 */
export function getActiveAttributes() {
  return cachedCatalog("attributesData", raw => {
    let saved = {};
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) saved = Object.fromEntries(parsed.map(a => [a.key, a]));
    } catch (err) {
      /* setting ausente/inválida — cai nos padrões do código abaixo */
    }

    return MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => ({
      key,
      label: saved[key]?.label?.trim() || MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS[key],
      visible: saved[key]?.visible !== false
    }));
  });
}

/** Só os atributos que a campanha exibe — use nas fichas e em qualquer seletor mostrado ao jogador. */
export function getVisibleAttributes() {
  return getActiveAttributes().filter(a => a.visible);
}

/** Rótulo atual de um atributo (cai na chave crua se alguém passar uma chave desconhecida). */
export function getAttributeLabel(key) {
  return getActiveAttributes().find(a => a.key === key)?.label ?? key;
}

/** Mapa chave→rótulo, substituto direto de MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS. */
export function getAttributeLabels() {
  return Object.fromEntries(getActiveAttributes().map(a => [a.key, a.label]));
}

/**
 * MEU_SISTEMA.EFFECT_TARGET_LABELS com os atributos trocados pelos rótulos ativos — os
 * alvos que não são atributo (hp/energy/shield/os de Nave) ficam como estão.
 */
export function getEffectTargetLabels() {
  return { ...MEU_SISTEMA.EFFECT_TARGET_LABELS, ...getAttributeLabels() };
}

/**
 * Opções do seletor de Alvo de Efeito, agrupadas (EFFECT_TARGET_GROUPS). Atributo escondido pela
 * campanha sai da lista — a não ser que seja o alvo já escolhido, senão editar a Skill o apagaria.
 * @returns {Array<{label:string, options:Array<{value:string,label:string,selected:boolean}>}>}
 */
export function getEffectTargetGroups(current) {
  const labels = getEffectTargetLabels();
  const visible = new Set(getVisibleAttributes().map(a => a.key));
  return MEU_SISTEMA.EFFECT_TARGET_GROUPS.map(group => ({
    label: group.label,
    options: group.targets
      .filter(t => !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t) || visible.has(t) || t === current)
      .map(t => ({ value: t, label: labels[t] ?? t, selected: t === current }))
  })).filter(group => group.options.length);
}

/** Teto de Evasão das naves (%). As casas e a Evasão base ficam em cada Porte (`getVesselSizes`). */
export function getShipManeuverConfig() {
  return { evasionCap: getFeatureOption("shipManeuver", "shipEvasionCap") };
}

/** Configuração ativa do deslocamento (Base/Passo/Teto e se o Mestre é isento). */
export function getMovementConfig() {
  return {
    base: getFeatureOption("movement", "movementBase"),
    step: getFeatureOption("movement", "movementStep"),
    cap: getFeatureOption("movement", "movementCap"),
    gmIgnores: getFeatureOption("movement", "movementGmIgnores")
  };
}
