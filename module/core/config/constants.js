/**
 * SYSTEM_ID e MEU_SISTEMA: os catálogos e tabelas padrão (dados). Nenhuma função aqui.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */

import { DEFAULT_SPECIES_PRESETS, DEFAULT_HERITAGES, DEFAULT_BODY_FUNCTIONS, DEFAULT_TRAITS, SPECIES_CARRY_DEFAULTS } from "./defaults/species.js";
import { PHYSICAL_SUBTYPES, DEFAULT_DAMAGE_ELEMENTS, SCIFI_DAMAGE_ELEMENTS, DEFAULT_STATUS_CONDITIONS } from "./defaults/elements.js";
import { DEFAULT_SHIP_SIZES, DEFAULT_VEHICLE_SIZES, MODULE_ROLES, DEFAULT_MODULE_CATEGORIES, SCIFI_MODULE_CATEGORIES, DEFAULT_SHIP_CLASSES, DEFAULT_VEHICLE_CLASSES, DEFAULT_CREW_ROLES, MODULE_SIZE_PRESETS } from "./defaults/vessels.js";
import { FEATURES, CAMPAIGN_PRESETS } from "./defaults/features.js";
import { DEFAULT_CURRENCIES, DEFAULT_SCALES } from "./defaults/misc.js";
export { PHYSICAL_SUBTYPES } from "./defaults/elements.js";

export const SYSTEM_ID = "nihility-rpg-system";


export const MEU_SISTEMA = {
  id: SYSTEM_ID,

  /** Chaves usadas em game.settings.register/get/set */
  SETTINGS: {
    economyEnabled: "economyEnabled",
    titlesEnabled: "titlesEnabled",
    anatomyEnabled: "anatomyEnabled",
    currenciesData: "currenciesData",
    // Mantém a chave de storage "energyLabel" (não "characterEnergyLabel") de propósito:
    // é a setting original de rótulo de energia, e assim quem já tinha customizado o
    // valor (ex: "Fluxo Quântico") não perde a configuração ao atualizar o sistema.
    characterEnergyLabel: "energyLabel",
    starshipEnergyLabel: "starshipEnergyLabel",
    speciesPresetsData: "speciesPresetsData",
    heritagesData: "heritagesData",
    bodyFunctionsData: "bodyFunctionsData",
    attributePointsStarting: "attributePointsStarting",
    attributePointsPerLevel: "attributePointsPerLevel",
    skillPointsStarting: "skillPointsStarting",
    skillPointsPerLevel: "skillPointsPerLevel",
    damageElementsData: "damageElementsData",
    statusConditionsData: "statusConditionsData",
    traitsData: "traitsData",
    scalesData: "scalesData",
    moduleCategoriesData: "moduleCategoriesData",
    shipClassesData: "shipClassesData",
    shipSizesData: "shipSizesData",
    ammoTypesData: "ammoTypesData",
    vehicleSizesData: "vehicleSizesData",
    vehicleClassesData: "vehicleClassesData",
    crewRolesData: "crewRolesData",
    structuresData: "structuresData",
    // Blocos ligáveis/desligáveis por campanha (ver MEU_SISTEMA.FEATURES). As chaves dos blocos
    // que já existiam mantêm o nome original de storage de propósito — mundos que já tinham
    // essas settings configuradas não perdem o valor ao atualizar.
    attributesData: "attributesData",
    xpFormula: "xpFormula",
    damageScalingDivisor: "damageScalingDivisor",
    manaInvestExponent: "manaInvestExponent",
    manaInvestMinPercent: "manaInvestMinPercent",
    restShortHpPercent: "restShortHpPercent",
    restShortEnergyPercent: "restShortEnergyPercent",
    healBlockZeroMultiplier: "healBlockZeroMultiplier",
    cureRegrowLevel: "cureRegrowLevel",
    shipTargetAsk: "shipTargetAsk",
    shipTargetShare: "shipTargetShare",
    shipBracePercent: "shipBracePercent",
    shipRepairEngineerFormula: "shipRepairEngineerFormula",
    antimagicBase: "antimagicBase",
    affinityImmune: "affinityImmune",
    affinityIneffective: "affinityIneffective",
    affinityEffective: "affinityEffective",
    affinitySuperEffective: "affinitySuperEffective",
    antimagicGrowth: "antimagicGrowth",
    antimagicReach: "antimagicReach",
    shipFocusBoost: "shipFocusBoost",
    shipFocusCut: "shipFocusCut",
    skillPowerPerLevel: "skillPowerPerLevel",
    skillDiscountPerLevel: "skillDiscountPerLevel",
    skillCyclePower: "skillCyclePower",
    skillCycleDiscount: "skillCycleDiscount",
    skillCostFloorPercent: "skillCostFloorPercent",
    resistanceXpFactor: "resistanceXpFactor",
    resistanceLearnThreshold: "resistanceLearnThreshold",
    initiativeAttribute: "initiativeAttribute",
    allowOffSceneTargets: "allowOffSceneTargets",
    starshipEnergyAbbr: "starshipEnergyAbbr",
    vesselsEnabled: "vesselsEnabled",
    skillFusionEnabled: "skillFusionEnabled",
    skillPointsEnabled: "skillPointsEnabled",
    attributePoolEnabled: "attributePoolEnabled",
    resistancesEnabled: "resistancesEnabled",
    statusConditionsEnabled: "statusConditionsEnabled",
    areaEffectsEnabled: "areaEffectsEnabled",
    aiAssistantEnabled: "aiAssistantEnabled",
    // Fórmula de HP/Mana configurável (ver getVitalFormula / deriveVitalStats).
    hpFormulaPrimary: "hpFormulaPrimary",
    hpFormulaSecondary: "hpFormulaSecondary",
    energyPoolEnabled: "energyPoolEnabled",
    energyFormulaPrimary: "energyFormulaPrimary",
    energyFormulaSecondary: "energyFormulaSecondary",
    vitalFormulaMultiplier: "vitalFormulaMultiplier",
    vitalFormulaFloor: "vitalFormulaFloor",
    completedMigrations: "completedMigrations",
    debugMode: "debugMode",
    floatingNumbers: "floatingNumbers",
    aiProvider: "aiProvider",
    aiEndpointUrl: "aiEndpointUrl",
    aiModel: "aiModel",
    aiApiKey: "aiApiKey",
    padEnabled: "padEnabled",
    padShipEnabled: "padShipEnabled",
    padLibraryEnabled: "padLibraryEnabled",
    padMessagingEnabled: "padMessagingEnabled"
  },

  /** Nome da pasta usada para organizar Atores/Notas criados pelo Assistente de IA. */
  AI_GENERATED_FOLDER_NAME: "IA — Gerado",

  FEATURES,

  CAMPAIGN_PRESETS,

  /** Nomes (chaves) dos Compêndios de World auto-geridos pelo sistema. */
  COMPENDIUM: {
    skills: { key: "meu-sistema-skills", label: "Compêndio de Habilidades", type: "Item" },
    bodyParts: { key: "meu-sistema-body-parts", label: "Compêndio de Partes do Corpo", type: "Item" },
    titles: { key: "meu-sistema-titles", label: "Compêndio de Títulos", type: "Item" },
    items: { key: "meu-sistema-items", label: "Compêndio de Itens", type: "Item" },
    starshipModules: { key: "meu-sistema-starship-modules", label: "Compêndio de Módulos de Naves", type: "Item" },
    padLibrary: { key: "meu-sistema-pad-library", label: "Biblioteca do PAD (Naves)", type: "JournalEntry" },
    padGroups: { key: "meu-sistema-pad-groups", label: "Grupos de Mensagem do PAD", type: "JournalEntry" }
  },

  /**
   * Tiers de habilidade, na ordem de força relativa (do mais fraco pro mais forte).
   * Uma skill de tier T só pode consumir/fundir fontes de tier ≤ T (nunca acima).
   * Racial nunca é comprada com Pontos de Habilidade (vem só da Espécie). Ultimate
   * nunca é comprada (só surge por fusão) e fica oculta na UI até o Ator possuir uma.
   */
  SKILL_TIERS: ["extra", "normal", "racial", "unique", "ultimate"],

  SKILL_TIER_LABELS: {
    extra: "Extra",
    normal: "Normal",
    racial: "Racial",
    unique: "Único",
    ultimate: "Ultimate"
  },

  /** Tiers que participam da economia de Pontos de Habilidade (Racial e Ultimate ficam de fora). */
  SKILL_POINT_TIERS: ["extra", "normal", "unique"],

  /**
   * Quantos Pontos de Habilidade de um tier valem 1 do tier acima, nos dois sentidos (quebrar
   * 1 Normal devolve 3 Extra; juntar 3 Extra vira 1 Normal). Vale igual pra todo par de tiers
   * vizinhos em SKILL_POINT_TIERS — ver breakSkillPoints/mergeSkillPoints em skill-economy.js.
   */
  SKILL_POINT_CONVERSION_RATE: 3,

  /**
   * Tiers que um Item Geral/Modificação de Parte do Corpo/Módulo de Nave pode
   * conceder como Habilidade (padrão "normal"; o Mestre pode liberar até aqui,
   * nunca Único/Ultimate — essas só nascem de fusão/narrativa, nunca de loot).
   */
  ITEM_GRANTABLE_SKILL_TIERS: ["extra", "normal", "racial"],

  /**
   * Estados possíveis de uma Parte do Corpo. "destroyed" é a Vida 0 (Inutilizada: a parte existe
   * mas não funciona — Cura recupera); "lost" é a parte que não existe mais (decepada — só
   * Regeneração refaz). Ver resolvePartVitals em species/anatomy-rules.js.
   */
  BODY_PART_STATUS: ["intact", "damaged", "destroyed", "lost"],

  BODY_PART_STATUS_LABELS: {
    intact: "Íntegra",
    damaged: "Ferida",
    destroyed: "Inutilizada",
    lost: "Perdida"
  },

  /**
   * Vida de cada parte em % da Vida máxima do personagem, por slot — o padrão das Espécies de
   * fábrica e o "Preencher pelo slot" do editor. Não soma 100%: diz quanto dano NAQUELA parte a
   * destrói. Slot sem linha usa `default`.
   */
  PART_HP_PERCENT_BY_SLOT: { head: 30, torso: 50, core: 50, body: 60, arm: 20, leg: 25, tail: 15, wing: 20, horn: 10, cosmetic: 5, default: 20 },

  /**
   * Tipos de cura de um Efeito Periódico de Vida positivo (bloco "Ferimentos por parte"): Cura
   * fecha feridas (Vida e partes feridas/inutilizadas); Regeneração também refaz partes perdidas
   * (e, numa Skill Única ou Ultimate, conserta próteses); Reparo conserta só próteses.
   */
  HEAL_KINDS: ["cura", "regeneracao", "reparo"],
  HEAL_KIND_LABELS: { cura: "Cura", regeneracao: "Regeneração", reparo: "Reparo" },
  HEAL_KIND_HINTS: {
    cura: "fecha feridas: Vida e partes feridas ou inutilizadas",
    regeneracao: "também refaz partes perdidas",
    reparo: "conserta próteses"
  },

  DEFAULT_SHIP_SIZES,

  DEFAULT_VEHICLE_SIZES,

  /**
   * Porte de Módulo de Nave (inclusive Arma, que reaproveita esta MESMA escala pro seu
   * próprio Porte — não é uma terceira escala nova). Nomenclatura própria, paralela à de
   * Nave mas com nomes diferentes (Compacto/Standard/Robusto/Industrial/Colossal).
   */
  MODULE_SIZES: ["compact", "standard", "reinforced", "industrial", "colossal"],

  MODULE_SIZE_LABELS: {
    compact: "Compacto",
    standard: "Standard",
    reinforced: "Robusto",
    industrial: "Industrial",
    colossal: "Colossal"
  },

  /** Índice (0-4) de cada Porte de Módulo — comparado contra o `rank` do Porte da Nave pra checar compatibilidade. */
  MODULE_SIZE_RANK: { compact: 0, standard: 1, reinforced: 2, industrial: 3, colossal: 4 },

  /**
   * Categorias de Módulo de Nave/Veículo. Reator/Bateria/Distribuidor/Escudo/Motor/Casco/FTL
   * são "slot único" (STARSHIP_SINGLE_SLOT_CATEGORIES — só 1 instalado por vez, ver o hook de
   * compatibilidade em nihility-rpg-system.js); Arma e Utilidade não têm limite de contagem
   * (Arma usa orçamento de espaço por Porte em vez disso — `weaponSlotBudget` no Data Model).
   */
  STARSHIP_MODULE_CATEGORIES: [
    "weapon", "shield", "engine", "utility", "armor", "reactor", "battery", "distributor", "ftl"
  ],

  STARSHIP_MODULE_CATEGORY_LABELS: {
    weapon: "Arma",
    shield: "Escudo",
    engine: "Motor",
    utility: "Utilidade",
    armor: "Casco (Armadura)",
    reactor: "Reator",
    battery: "Bateria",
    distributor: "Distribuidor",
    ftl: "FTL"
  },

  STARSHIP_SINGLE_SLOT_CATEGORIES: ["reactor", "battery", "distributor", "shield", "engine", "armor", "ftl"],

  MODULE_ROLES,

  DEFAULT_MODULE_CATEGORIES,

  SCIFI_MODULE_CATEGORIES,

  DEFAULT_SHIP_CLASSES,

  DEFAULT_VEHICLE_CLASSES,

  /**
   * Funções de Tripulação: dizem QUEM ESTÁ EM QUAL POSTO — não são permissão. Com poucos
   * jogadores, o engenheiro tem que conseguir assumir o leme se o piloto cair; qualquer
   * tripulante opera qualquer coisa e troca a própria função na hora.
   */
  /**
   * Estruturas que uma Skill pode criar no mapa. `shape`: line (dois cliques), free (traçado ponto
   * a ponto), circle (centro, `size` = raio), rect (centro, `size` = lado). `size` em metros —
   * comprimento máximo pra linha/livre. `hp` 0 = **barreira de mana**: o dano que ela leva sai da
   * Mana de quem conjurou. `durationRounds` 0 = sem prazo (some com a Skill Ativa desligada, ou
   * quando o Mestre remove, ou quando a Vida/Mana de quem conjurou chega a 0).
   */
  DEFAULT_STRUCTURES: [
    { id: "stone-wall", label: "Parede de Pedra", img: "", color: "#8d8471", shape: "free", size: 10, blocksMove: true, blocksSight: true, hp: 60, durationRounds: 0 },
    { id: "ice-block", label: "Bloco de Gelo", img: "", color: "#6ee7ff", shape: "rect", size: 2, blocksMove: true, blocksSight: false, hp: 30, durationRounds: 3 },
    { id: "mana-barrier", label: "Barreira de Mana", img: "", color: "#c084fc", shape: "circle", size: 3, blocksMove: true, blocksSight: false, hp: 0, durationRounds: 0, magic: true },
    // Não segura golpe nenhum: queima quem atravessa (a vantagem entre elementos vale contra ela).
    { id: "fire-wall", label: "Muralha de Fogo", img: "", color: "#ff7043", shape: "line", size: 8, blocksMove: false, blocksSight: false, blocksAttacks: false, hp: 0, durationRounds: 3, magic: true, elements: ["fire"], contactDamage: "2d6" },
    // Campo Antimagia: ataque mágico que o atravessa (ou sai de dentro) paga Mana extra ou é anulado.
    { id: "antimagic-field", label: "Campo Antimagia", img: "", color: "#9aa1c2", shape: "circle", size: 4, blocksMove: false, blocksSight: false, blocksAttacks: false, hp: 0, durationRounds: 3, antimagicLevel: 1 }
  ],
  STRUCTURE_SHAPES: ["line", "free", "circle", "rect"],

  /** Quanto cabe numa pilha quando o Item não diz (Item Geral `stackSize`). */
  ITEM_STACK_DEFAULT: 20,
  /** Slots e carga base (kg) sem Espécie, ou de uma Espécie sem os campos. */
  DEFAULT_CARRY: { slots: 10, carry: 30 },
  SPECIES_CARRY_DEFAULTS,
  /** Slots de um Módulo de Porão por Porte (× o multiplicador do Módulo; vários Porões somam). */
  CARGO_SLOTS_BY_MODULE_SIZE: { compact: 10, standard: 20, reinforced: 40, industrial: 80, colossal: 160 },

  /** Tipos de Munição (catálogo editável). Lançador aceita tipos; a Munição tem um. */
  DEFAULT_AMMO_TYPES: [
    { id: "torpedo", label: "Torpedo" },
    { id: "missile", label: "Míssil" },
    { id: "mine", label: "Mina" },
    { id: "kinetic", label: "Projétil cinético" },
    { id: "arrow", label: "Flecha" },
    { id: "bolt", label: "Virote" },
    { id: "bullet", label: "Bala" }
  ],
  STRUCTURE_SHAPE_LABELS: { line: "Linha reta", free: "Forma livre (desenhar)", circle: "Círculo", rect: "Quadrado" },

  DEFAULT_CREW_ROLES,

  /**
   * Limiar de `powerAllocationPercent` (%) acima do qual um Módulo sofre dano por sobrecarga a
   * cada rodada (Overhaul de Naves, Fase 3 — ver `tickStarshipModuleOverload` em
   * starship-power.js). Escudo tolera mais que um Módulo comum; Reator não tolera NADA acima
   * de 100% (assimétrico de propósito — Underclock nunca causa dano). Arma tem regra própria
   * (throttle não dana o Módulo, vira Recarga mais longa — ver Fase 5) e Distribuidor/Bateria
   * nunca entram nesse tick (não têm throttle próprio).
   */
  OVERLOAD_THRESHOLD_DEFAULT: 200,
  OVERLOAD_THRESHOLD_SHIELD: 500,
  OVERLOAD_THRESHOLD_REACTOR: 100,

  /**
   * Percentual da Vida Máxima do Módulo perdido por rodada de sobrecarga, por ponto percentual
   * de `powerAllocationPercent` acima do limiar. Fechado em 0.5 (Fase 8 do overhaul, "moderado":
   * ~5% da Vida Máxima por rodada a cada 10 pontos de excesso — dano = (excesso/100) × hp.max ×
   * este valor, então excesso=10 vira 5% e excesso=20 vira 10%, escalando linear).
   */
  OVERLOAD_DAMAGE_PERCENT_OF_MAX_PER_ROUND: 0.5,

  /** Percentual mínimo de Vida Máxima pra um Módulo desligado por dano poder ser religado. */
  MODULE_RESTART_HP_THRESHOLD_PERCENT: 15,

  /**
   * Fórmula de dado da 2ª rolagem do reparo (Fase 7/8) — quanto de Vida um reparo bem-sucedido
   * restaura, aplicado igual em Módulo ou pool do Ator (Escudo/Casco/Integridade Estrutural),
   * sem escalar pelo tamanho do alvo (consertar algo grande simplesmente pode levar mais
   * tentativas). Sem DC formal — o Mestre julga o resultado da rolagem de Destreza por fora
   * (mesma filosofia do resto do sistema) antes de decidir aplicar este roll.
   */
  REPAIR_ROLL_FORMULA: "2d6",

  /**
   * Curva de escala de Porte de Módulo (Overhaul de Naves, Fase 8) — cada Porte multiplica um
   * valor-base "a Compacto" por este fator. Usada tanto pelos presets de stat sugeridos
   * (MODULE_SIZE_PRESETS) quanto pelo orçamento de espaço de Arma por Porte de Nave
   * (`weaponBudget` de cada Porte) — dobrar a cada Porte cria fricção o bastante pra evitar
   * troca casual de Módulo sem precisar de uma curva mais agressiva: subir de Porte já dobra o
   * Consumo de Energia daquele Módulo, obrigando a Nave inteira (Reator/Distribuidor) a
   * acompanhar antes de sustentar o upgrade.
   */
  MODULE_SIZE_MULTIPLIER: { compact: 1, standard: 2, reinforced: 4, industrial: 8, colossal: 16 },

  

  

  MODULE_SIZE_PRESETS,

  /** Vida estrutural (hp.max) sugerida por Porte de Módulo, igual pra toda Categoria — 20 é o valor "a Compacto" (já o default do campo), escala por MODULE_SIZE_MULTIPLIER. */
  MODULE_HP_BY_SIZE: { compact: 20, standard: 40, reinforced: 80, industrial: 160, colossal: 320 },

  /**
   * Atributos de combate. `bonus = floor(pontos / 3)`; a cada +10 de bônus a
   * rolagem ganha +1d20 (todos os dados são somados). Bônus de arma/equipamento
   * NUNCA contam pra essa conta — somam por fora, sempre como número fixo.
   */
  COMBAT_ATTRIBUTES: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "perception", "precision"],

  /**
   * Piso da fórmula de HP/Mana Máximo (Força.Total x Defesa.Total x 10, etc.):
   * mesmo com os atributos zerados, o resultado da fórmula nunca fica abaixo
   * disso. Modificadores permanentes (Título/Skill/Item/Modificação) e o
   * buffDelta temporário de HP/Mana somam por cima, sem piso.
   */
  MIN_BASE_VITAL_STAT: 50,

  /** Multiplicador padrão da fórmula de HP/Mana (Atributo × Atributo × ISTO). Sobrescrito pela setting `vitalFormulaMultiplier`. */
  DEFAULT_VITAL_FORMULA_MULTIPLIER: 10,

  /**
   * Redução de dano mágico/elemental (skill.system.isMagicDamage) pela Defesa Mágica do alvo:
   * reduçãoPercentual = clamp(magicalDefense.total x PER_POINT, 0, CAP). Percentual em vez de
   * fixo pra continuar relevante em qualquer faixa de nível (HP/Mana escalam multiplicando
   * Total x Total x 10, então um número fixo de redução vira irrelevante cedo).
   */
  MAGIC_DEFENSE_REDUCTION_PER_POINT: 0.02,
  MAGIC_DEFENSE_REDUCTION_CAP: 0.6,

  COMBAT_ATTRIBUTE_LABELS: {
    strength: "Força",
    defense: "Defesa",
    magic: "Magia",
    magicalDefense: "Defesa Mágica",
    dexterity: "Destreza",
    stealth: "Furtividade",
    perception: "Percepção",
    precision: "Precisão"
  },

  /**
   * Tipos de Efeito de uma Skill. "damage" cobre dano físico e elemental (o
   * elemento é um sub-campo); "temporary" cobre buffs/debuffs/escudos/drawbacks
   * como uma lista de Efeitos (ver EFFECT_TARGETS).
   */
  /** Grupos de prioridade de energia de Módulo (1 recebe primeiro). Ver powerPriorityGroup. */
  POWER_PRIORITY_GROUPS: 5,

  /**
   * Fila de prioridade de uma Nave que nunca mexeu na aba Prioridade (ver resolvePowerGroups). Os
   * ids `p1…p5` casam com o número 1–5 que os Módulos guardavam antes da fila dinâmica.
   */
  DEFAULT_POWER_GROUPS: [
    { id: "p1", label: "Essencial" },
    { id: "p2", label: "Alta" },
    { id: "p3", label: "Normal" },
    { id: "p4", label: "Baixa" },
    { id: "p5", label: "Mínima" }
  ],

  SKILL_EFFECT_TYPES: ["none", "damage", "temporary", "structure"],

  SKILL_EFFECT_TYPE_LABELS: {
    none: "Descritiva (sem mecânica)",
    damage: "Dano",
    temporary: "Efeito Temporário (buff/debuff/escudo)",
    structure: "Estrutura (parede, bloco, barreira no mapa)"
  },

  /** Rótulos curtos, pro controle segmentado da ficha de Item. */
  SKILL_EFFECT_TYPE_SHORT_LABELS: {
    none: "Descritiva",
    damage: "Dano",
    temporary: "Efeito Temporário",
    structure: "Estrutura"
  },

  /**
   * Ver module/area-effects.js. Estrutura NÃO é um Tipo de Alvo: é uma Mecânica ao Usar
   * (`effectType: "structure"`), porque o formato vem do catálogo de Estruturas, não de um alvo.
   * O schema ainda aceita `targetType: "structure"` só pra ler Skills salvas assim (1.37) — ver
   * `isStructureMechanic` e o `migrateData` de SkillDataModel.
   */
  SKILL_TARGET_TYPES: ["targeted", "self", "emission", "zone"],

  SKILL_TARGET_TYPE_LABELS: {
    targeted: "Targetada (escolhe 1 Ator)",
    self: "Si mesmo (sem escolher alvo)",
    emission: "Emissão (atinge na hora quem está na área)",
    zone: "Zona (área que fica na cena e afeta quem permanecer nela)"
  },

  SKILL_TARGET_TYPE_SHORT_LABELS: {
    targeted: "Targetada",
    self: "Si mesmo",
    emission: "Emissão",
    zone: "Zona"
  },

  SKILL_AREA_SHAPES: ["", "circle", "cone", "ray"],

  SKILL_AREA_SHAPE_LABELS: {
    "": "— selecione —",
    circle: "Círculo",
    cone: "Cone",
    ray: "Linha"
  },

  /**
   * Alvos possíveis de um Efeito Temporário: os 8 atributos de combate (afetam
   * a rolagem via Active Effect, mas NUNCA o cálculo de HP/Mana — só a base
   * permanente do atributo conta pra isso), "hp"/"energy" (HP/Mana atuais,
   * também via Active Effect temporário) e "shield" (Escudo — tratado à parte,
   * é somado direto e gasto na mão, sem Active Effect/duração).
   */
  EFFECT_TARGETS: [
    "strength",
    "defense",
    "magic",
    "magicalDefense",
    "dexterity",
    "stealth",
    "perception",
    "precision",
    "hp",
    "energy",
    "heal",
    "restoreEnergy",
    "shield",
    "movement",
    "weaponDamage",
    "weaponElement",
    "bodyElement",
    "weaponMagic",
    "weaponAbsolute",
    "shipWeaponDamage",
    "shipWeaponPenetration",
    "shipShieldCapacity",
    "shipShieldRegen",
    "shipReactorOutput",
    "shipPropulsion",
    "shipShieldRestore",
    "shipCasco",
    "shipHull",
    "shipDamageReduction",
    "antimagic"
  ],

  EFFECT_TARGET_LABELS: {
    antimagic: "Antimagia (corta efeitos mágicos e suprime)",
    strength: "Força",
    defense: "Defesa",
    magic: "Magia",
    magicalDefense: "Defesa Mágica",
    dexterity: "Destreza",
    stealth: "Furtividade",
    perception: "Percepção",
    precision: "Precisão",
    hp: "HP",
    energy: "Mana/Energia",
    heal: "Curar Vida (na hora)",
    restoreEnergy: "Recuperar Mana/Energia (na hora)",
    shield: "Escudo",
    movement: "Deslocamento (%)",
    weaponDamage: "Dano das Armas equipadas",
    weaponElement: "Elemento das Armas (substitui)",
    bodyElement: "Elemento do corpo (vira o elemento)",
    weaponMagic: "Armas causam dano Mágico",
    weaponAbsolute: "Armas causam Dano Absoluto",
    shipWeaponDamage: "Dano de Arma (Nave)",
    shipWeaponPenetration: "Penetração de Arma (Nave)",
    shipShieldCapacity: "Capacidade do Escudo (Nave, %)",
    shipShieldRestore: "Restaurar Escudo da Nave",
    shipCasco: "Casco da Nave (− dano, + reparo)",
    shipHull: "Integridade da Nave (− dano, + reparo)",
    shipDamageReduction: "Preparar para impacto (Nave, % de redução)",
    shipShieldRegen: "Regeneração do Escudo (Nave, %)",
    shipReactorOutput: "Geração de Energia (Nave, %)",
    shipPropulsion: "Propulsão (Nave, %)"
  },

  /**
   * Grupos do seletor de Alvo de um Efeito — só organização. `actor` diz em que tipo de Ator o
   * alvo faz sentido: aplicar um alvo de Nave num Personagem (ou vice-versa) é recusado com aviso
   * no chat, em vez de gravar um efeito que não faz nada.
   */
  EFFECT_TARGET_GROUPS: [
    { label: "Atributos", actor: "character", targets: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "perception", "precision"] },
    { label: "Vitais", actor: "character", targets: ["heal", "restoreEnergy", "hp", "energy", "shield", "movement"] },
    { label: "Arma", actor: "any", targets: ["weaponDamage", "weaponElement", "weaponMagic", "weaponAbsolute"] },
    { label: "Elemento", actor: "any", targets: ["bodyElement"] },
    { label: "Magia", actor: "character", targets: ["antimagic"] },
    { label: "Nave", actor: "ship", targets: ["shipWeaponDamage", "shipWeaponPenetration", "shipShieldCapacity", "shipShieldRegen", "shipReactorOutput", "shipPropulsion", "shipShieldRestore", "shipCasco", "shipHull", "shipDamageReduction"] }
  ],

  /** Alvos "de Nave" de EFFECT_TARGETS — só fazem sentido numa Skill usada por uma Nave. */
  SHIP_EFFECT_TARGETS: ["shipWeaponDamage", "shipWeaponPenetration", "weaponDamage"],

  /**
   * Só relevante pros dois EFFECT_TARGETS "de Nave" acima: uma Skill de aprimoramento de arma
   * pode dar um bônus FIXO (soma direto no resultado, `CONST.ACTIVE_EFFECT_MODES.ADD`) ou
   * MULTIPLICATIVO (multiplica o resultado, `CONST.ACTIVE_EFFECT_MODES.MULTIPLY`) — cada Skill
   * escolhe o que faz mais sentido pra ela, não é um comportamento fixo do alvo.
   */
  EFFECT_MODIFIER_TYPES: ["flat", "multiplier"],

  EFFECT_MODIFIER_TYPE_LABELS: {
    flat: "Fixo (soma)",
    multiplier: "Multiplicador"
  },

  /**
   * Alvos possíveis de um bônus de Título: os 8 atributos de combate + HP/Mana
   * diretamente (sem passar pela fórmula — soma como um modificador permanente,
   * igual statModifiers de Skill/Item). Reaproveita EFFECT_TARGET_LABELS pros rótulos.
   */
  TITLE_BONUS_TARGETS: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "perception", "precision", "hp", "energy"],

  /**
   * Unidade de "tick" de um Efeito Periódico (veneno/cura contínua — ver `entry.periodic`
   * em EFFECT_TARGETS, só válido pra target "hp"/"energy"). "combatRound" bate sozinho a
   * cada vez que chega o turno do Ator dono do efeito (hook `updateCombat` em
   * nihility-rpg-system.js); "manual" não bate sozinho — fica esperando um clique no botão
   * "Aplicar Tick" da ficha (cobre cura/dano de longo prazo fora de combate, tipo
   * "Regeneração Amorfa" do Slime, sem precisar de um sistema de tempo/calendário).
   */
  PERIODIC_TICK_UNITS: ["combatRound", "manual"],

  PERIODIC_TICK_UNIT_LABELS: {
    combatRound: "Por rodada de combate (automático)",
    manual: "Manual (fora de combate)"
  },

  DEFAULT_DAMAGE_ELEMENTS,

  /**
   * Tipos de Efeito ao acertar que um Elemento pode ter (tela Tipos de Dano). O código entende
   * só estes tipos; os números ficam com o Mestre.
   *  - condition: aplica uma Condição (com chance %), usando o efeito padrão dela;
   *  - traitBonus: +X% de dano se o alvo tiver o Traço;
   *  - shieldDrain: +X% de dano só contra Escudo (camada de Escudo da Nave ou Escudo pessoal);
   *  - penetration: ignora X% das defesas do alvo (nunca atravessa Imunidade).
   */
  ELEMENT_EFFECT_TYPES: ["condition", "traitBonus", "layer", "shieldDrain", "penetration", "sever", "blockRegen", "moduleDisable", "energyDrain", "resistanceDown"],
  /** Níveis da tabela de vantagens entre elementos (clique esquerdo sobe, direito desce). */
  AFFINITY_LEVEL_LABELS: { "-2": "Imune", "-1": "Ineficaz", 0: "Neutro", 1: "Efetivo", 2: "Super efetivo" },
  ELEMENT_EFFECT_TYPE_LABELS: {
    condition: "Aplicar Condição",
    traitBonus: "Dano extra contra Traço",
    layer: "Dano por camada (Escudo, Casco, Integridade)",
    shieldDrain: "Dano extra em Escudo (antigo: use Dano por camada)",
    penetration: "Penetração",
    sever: "Decepar (parte do corpo)",
    blockRegen: "Impede regeneração",
    moduleDisable: "Nave: derrubar Módulo",
    energyDrain: "Nave: drenar energia",
    resistanceDown: "Nave: baixar resistência"
  },
  /** Camadas do "Dano por camada". `shield` também vale pro Escudo pessoal de Personagem. */
  DAMAGE_LAYERS: ["shield", "casco", "hull"],
  DAMAGE_LAYER_LABELS: { shield: "Escudo", casco: "Casco", hull: "Integridade Estrutural" },
  /** Efeitos de sistema de Nave (do elemento), com duração em rodadas da Nave atingida. */
  SHIP_SYSTEM_EFFECT_LABELS: {
    moduleDisabled: "Módulo derrubado",
    energyDrain: "Energia drenada",
    resistanceDown: "Resistência baixa"
  },

  SCIFI_DAMAGE_ELEMENTS,

  DEFAULT_TRAITS,

  DEFAULT_SCALES,

  DEFAULT_STATUS_CONDITIONS,

  DEFAULT_BODY_FUNCTIONS,

  /** Valores padrão (fallback) dos rótulos de energia — Personagens e Naves usam energias diferentes. */
  DEFAULT_CHARACTER_ENERGY_LABEL: "Mana",
  DEFAULT_STARSHIP_ENERGY_LABEL: "Sistema Eletro-Plasmático (EPS)",

  DEFAULT_CURRENCIES,

  DEFAULT_HERITAGES,

  SPECIES_GROUP_LABELS: {
    fantasia: "Fantasia",
    isekai: "Isekai",
    scifi: "Sci-Fi",
    besta: "Besta / Montaria"
  },

  DEFAULT_SPECIES_PRESETS,
};

/**
 * Espécies, Linhagens e Heranças de fábrica: a Vida de cada parte é um % da Vida máxima do
 * personagem, pelo slot (PART_HP_PERCENT_BY_SLOT), quando a parte não diz o próprio. O `hpMax`
 * fica como a Vida fixa de antes (catálogo salvo sem % continua usando ele).
 */
for (const entry of [...Object.values(MEU_SISTEMA.DEFAULT_SPECIES_PRESETS), ...(MEU_SISTEMA.DEFAULT_HERITAGES ?? [])]) {
  const layers = [entry, ...(entry.lineages ?? [])];
  for (const layer of layers) {
    for (const part of layer.parts ?? []) {
      part.hpPercent ??= MEU_SISTEMA.PART_HP_PERCENT_BY_SLOT[part.slot] ?? MEU_SISTEMA.PART_HP_PERCENT_BY_SLOT.default;
    }
  }
}

/** Opções da marca "Mágica" de uma Skill. Automático = custa Mana (a energia do personagem). */
export const MAGIC_TAG_LABELS = { auto: "Automático", magic: "Sim", mundane: "Não" };
