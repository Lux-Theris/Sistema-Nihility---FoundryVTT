/**
 * Namespace central de configuração do sistema.
 * Reunido em um único objeto para ser exposto em `game.nihility.config`
 * e consultado por Data Models, Sheets e o AI Helper.
 */
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
    attributePointsStarting: "attributePointsStarting",
    attributePointsPerLevel: "attributePointsPerLevel",
    skillPointsStarting: "skillPointsStarting",
    skillPointsPerLevel: "skillPointsPerLevel",
    damageElementsData: "damageElementsData",
    statusConditionsData: "statusConditionsData",
    // Blocos ligáveis/desligáveis por campanha (ver MEU_SISTEMA.FEATURES). As chaves dos blocos
    // que já existiam mantêm o nome original de storage de propósito — mundos que já tinham
    // essas settings configuradas não perdem o valor ao atualizar.
    attributesData: "attributesData",
    xpFormula: "xpFormula",
    damageScalingDivisor: "damageScalingDivisor",
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

  /**
   * Blocos do sistema que o Mestre liga/desliga por mundo — a espinha da modularidade: o mesmo
   * sistema roda uma campanha de Fantasia Medieval, uma de Sci-Fi ou uma mistura das duas, e o
   * que a campanha não usa simplesmente some da interface.
   *
   * **Regra que nunca pode ser quebrada: desligar um bloco só ESCONDE a UI (e impede criar
   * conteúdo novo daquele tipo) — nunca apaga nem migra dado já existente.** Religar tem que
   * devolver o mundo exatamente como estava; é isso que torna seguro trocar de preset no meio
   * de uma campanha, ou usar o mesmo mundo pra duas mesas diferentes.
   *
   * Cada entrada: `setting` (chave de storage — as pré-existentes mantêm o nome antigo pra não
   * perder configuração de quem já atualizou), `name`/`hint` (mostrados na tela de Settings e no
   * editor visual), `default` e, opcionalmente, `parent` (a sub-feature só vale se o pai estiver
   * ligado — ver `isFeatureEnabled`, que sobe a cadeia inteira).
   *
   * Pra adicionar um bloco novo: acrescente UMA linha aqui e use `isFeatureEnabled("chave")`
   * onde for gatear. O registro da setting, a tela de configuração e os presets abaixo já varrem
   * esta tabela sozinhos — não existe lista paralela pra manter em sincronia.
   */
  FEATURES: {
    economy: {
      setting: "economyEnabled",
      name: "Economia / Moedas",
      hint: "Rastreamento de moedas nas fichas, conversão e transferência entre Personagens.",
      default: true
    },
    titles: {
      setting: "titlesEnabled",
      name: "Títulos",
      hint: "Títulos com bônus permanentes de Atributo/HP/Mana e Resistências.",
      default: true
    },
    anatomy: {
      setting: "anatomyEnabled",
      name: "Anatomia / Modificação Corporal",
      hint: "Partes do Corpo com Vida própria, presets por Espécie e próteses/modificações.",
      default: true
    },
    vessels: {
      setting: "vesselsEnabled",
      name: "Naves e Veículos",
      hint: "Naves Espaciais e Veículos Terrestres: Porte, Módulos, Grid de Energia, cascata de dano e reparo. Desligado, nenhuma Nave/Veículo NOVO pode ser criado — as que já existem continuam intactas e abríveis.",
      default: true
    },
    skillFusion: {
      setting: "skillFusionEnabled",
      name: "Fusão de Habilidades",
      hint: "Fundir 2+ Habilidades numa só (com Sub-Skills disparáveis). Desligar esconde a seleção e o botão de Fundir; Evolução (1-pra-1) continua disponível.",
      default: true
    },
    skillPoints: {
      setting: "skillPointsEnabled",
      name: "Pontos de Habilidade",
      hint: "Economia de Pontos de Habilidade: quebra/fusão de pontos, pedido de criação com aprovação do Mestre e ganho automático por nível.",
      default: true
    },
    attributePool: {
      setting: "attributePoolEnabled",
      name: "Pool de Pontos de Atributo",
      hint: "Orçamento de pontos por nível com alocação em duas etapas (pendente → Confirmar). Desligado, os Atributos viram campos de digitação livre.",
      default: true
    },
    resistances: {
      setting: "resistancesEnabled",
      name: "Resistências / Imunidades",
      hint: "Habilidades e Títulos que reduzem dano por tipo (Geral ou Elemental).",
      default: true
    },
    statusConditions: {
      setting: "statusConditionsEnabled",
      name: "Condições de Status",
      hint: "Condições nomeadas (Veneno, Cegueira, Atordoamento...) com ícone no token, em Efeitos de Habilidade.",
      default: true
    },
    areaEffects: {
      setting: "areaEffectsEnabled",
      name: "Habilidades de Emissão (área)",
      hint: "Habilidades que posicionam uma forma no canvas (Círculo/Cone/Linha) em vez de escolher um alvo único.",
      default: true
    },
    aiAssistant: {
      setting: "aiAssistantEnabled",
      name: "Assistente de IA",
      hint: "Geração e edição de conteúdo via IA (só Mestre). Desligado, somem as abas de IA e Geração do Menu Principal.",
      default: true
    },
    pad: {
      setting: "padEnabled",
      name: "PAD — Aplicativo do Personagem",
      hint: "Chave-mestra do PAD (app estilo smartphone). Desligada, nenhuma das sub-funcionalidades abaixo aparece, mesmo que estejam ativas.",
      default: true
    },
    padShip: {
      setting: "padShipEnabled",
      parent: "pad",
      name: "PAD — Conexão com a Nave",
      hint: "Tela de Status da Nave/Veículo tripulada e gestão de Tripulação no PAD.",
      default: true
    },
    padLibrary: {
      setting: "padLibraryEnabled",
      parent: "pad",
      name: "PAD — Biblioteca",
      hint: "Tela de Biblioteca (favoritos pessoais e da Nave) no PAD.",
      default: true
    },
    padMessaging: {
      setting: "padMessagingEnabled",
      parent: "pad",
      name: "PAD — Mensagens",
      hint: "Troca de mensagens privadas (diretas e em grupo) entre Personagens no PAD.",
      default: true
    }
  },

  /**
   * Combinações prontas de FEATURES por tipo de campanha — aplicadas de uma vez pelo editor
   * visual (ver `applyCampaignPreset`). Só mexem nos blocos listados em `features`; o que não
   * aparece na lista fica como está. Nenhum preset apaga dado: "Naves desligadas" numa campanha
   * medieval significa que a UI some, não que as Naves do mundo sumam.
   */
  CAMPAIGN_PRESETS: {
    medieval: {
      label: "Fantasia Medieval",
      hint: "Isekai/fantasia: Títulos, Anatomia, Fusão e Magia ligados; nada de Naves, Veículos ou PAD.",
      features: {
        economy: true, titles: true, anatomy: true, vessels: false, skillFusion: true,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: false
      }
    },
    scifi: {
      label: "Sci-Fi Arcano",
      hint: "Naves, Veículos e PAD ligados; Títulos e Fusão de Habilidades desligados (são convenções de isekai).",
      features: {
        economy: true, titles: false, anatomy: true, vessels: true, skillFusion: false,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: true
      }
    },
    misto: {
      label: "Misto (tudo ligado)",
      hint: "O sistema inteiro disponível — fantasia e sci-fi coexistindo na mesma campanha.",
      features: {
        economy: true, titles: true, anatomy: true, vessels: true, skillFusion: true,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: true
      }
    }
  },

  /** Nomes (chaves) dos Compêndios de World auto-geridos pelo sistema. */
  COMPENDIUM: {
    skills: { key: "meu-sistema-skills", label: "Compêndio de Habilidades", type: "Item" },
    bodyParts: { key: "meu-sistema-body-parts", label: "Compêndio de Partes do Corpo", type: "Item" },
    titles: { key: "meu-sistema-titles", label: "Compêndio de Títulos", type: "Item" },
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

  /** Estados possíveis de uma Parte do Corpo. */
  BODY_PART_STATUS: ["intact", "damaged", "destroyed"],

  BODY_PART_STATUS_LABELS: {
    intact: "Intacto",
    damaged: "Danificado",
    destroyed: "Destruído"
  },

  /**
   * Porte de Nave Espacial, do menor pro maior — só o Mestre edita (mesmo padrão de Nível).
   * Rege compatibilidade de Módulo (SHIP_SIZE_RANK vs MODULE_SIZE_RANK) e o orçamento de
   * espaço de Arma (WEAPON_SLOT_BUDGET_BY_SHIP_SIZE).
   */
  SHIP_SIZES: ["mini", "pequeno", "medio", "grande", "capital"],

  SHIP_SIZE_LABELS: {
    mini: "Mini",
    pequeno: "Pequeno",
    medio: "Médio",
    grande: "Grande",
    capital: "Capital"
  },

  /** Veículo terrestre só cabe nos dois portes menores (reaproveita os mesmos labels acima). */
  VEHICLE_SIZES: ["mini", "pequeno"],

  /** Índice (0-4) de cada Porte de Nave/Veículo — usado só pra comparar "módulo cabe na nave". */
  SHIP_SIZE_RANK: { mini: 0, pequeno: 1, medio: 2, grande: 3, capital: 4 },

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

  /** Índice (0-4) de cada Porte de Módulo — comparado contra SHIP_SIZE_RANK pra checar compatibilidade. */
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
   * (WEAPON_SLOT_BUDGET_BY_SHIP_SIZE) — dobrar a cada Porte cria fricção o bastante pra evitar
   * troca casual de Módulo sem precisar de uma curva mais agressiva: subir de Porte já dobra o
   * Consumo de Energia daquele Módulo, obrigando a Nave inteira (Reator/Distribuidor) a
   * acompanhar antes de sustentar o upgrade.
   */
  MODULE_SIZE_MULTIPLIER: { compact: 1, standard: 2, reinforced: 4, industrial: 8, colossal: 16 },

  /** Orçamento de espaço de Arma por Porte de Nave/Veículo — Mini = exatamente 1 Arma Compacta (decisão já fechada), o resto segue MODULE_SIZE_MULTIPLIER. */
  WEAPON_SLOT_BUDGET_BY_SHIP_SIZE: { mini: 1, pequeno: 2, medio: 4, grande: 8, capital: 16 },

  /** Baseline de Capacidade de Transferência do Distribuidor por Porte de Nave — Médio = 320 EPS/rodada (mesma referência já usada no mockup aprovado da Fase 0), resto segue MODULE_SIZE_MULTIPLIER. */
  DISTRIBUTOR_BASELINE_BY_SHIP_SIZE: { mini: 80, pequeno: 160, medio: 320, grande: 640, capital: 1280 },

  /**
   * Capacidade mínima de Capacitor que TODA Nave/Veículo tem mesmo sem Módulo de Bateria: é a
   * energia que já está parada dentro dos próprios conduítes de força do casco. Sem isso o
   * Capacitor ficava em 0 sem Bateria, e como é dele que sai o Custo de Habilidade de Nave (ver
   * `energyValuePath` em skill-effects.js), uma Nave sem Bateria não conseguia usar Habilidade
   * nenhuma — o que nunca foi a intenção.
   *
   * Instalar um Módulo de Bateria **substitui** este valor (não soma) — ver `prepareDerivedData`
   * em starship-model.js. Por isso todos os valores aqui ficam abaixo de 125, a capacidade da
   * menor Bateria instalável (Compacto): assim substituir nunca é um downgrade, em Porte nenhum.
   * É também por isso que a curva achata no fim em vez de dobrar até 320 como as outras tabelas.
   */
  CONDUIT_CAPACITOR_BY_SHIP_SIZE: { mini: 10, pequeno: 20, medio: 40, grande: 80, capital: 120 },

  /**
   * Presets de stat sugeridos por Categoria×Porte de Módulo (Fase 8), usados só pra
   * autopreenchimento no editor do Item (Fase 1) — nunca sobrescrevem um valor já editado à
   * mão. Campos de CAPACIDADE (Vida/Consumo/Output/Aceleração/Rotação/dado de Dano) escalam por
   * MODULE_SIZE_MULTIPLIER a partir do valor "a Compacto"; campos de PERCENTUAL (Penetração/
   * Redução) e de TEMPO (Recarga/Carga/Fator) NÃO seguem essa curva — dobrar Recarga a cada
   * Porte deixaria Módulos grandes inutilizáveis, então esses sobem bem mais devagar, num
   * incremento próprio por Porte.
   */
  MODULE_SIZE_PRESETS: {
    shield: {
      compact: { powerConsumption: 30, shieldCapacity: 100, shieldRegen: 10, shieldRechargeRounds: 3 },
      standard: { powerConsumption: 60, shieldCapacity: 200, shieldRegen: 20, shieldRechargeRounds: 3 },
      reinforced: { powerConsumption: 120, shieldCapacity: 400, shieldRegen: 40, shieldRechargeRounds: 4 },
      industrial: { powerConsumption: 240, shieldCapacity: 800, shieldRegen: 80, shieldRechargeRounds: 4 },
      colossal: { powerConsumption: 480, shieldCapacity: 1600, shieldRegen: 160, shieldRechargeRounds: 5 }
    },
    engine: {
      compact: { powerConsumption: 20, acceleration: 20, rotation: 15 },
      standard: { powerConsumption: 40, acceleration: 40, rotation: 30 },
      reinforced: { powerConsumption: 80, acceleration: 80, rotation: 60 },
      industrial: { powerConsumption: 160, acceleration: 160, rotation: 120 },
      colossal: { powerConsumption: 320, acceleration: 320, rotation: 240 }
    },
    reactor: {
      compact: { powerConsumption: 0, reactorOutput: 250 },
      standard: { powerConsumption: 0, reactorOutput: 500 },
      reinforced: { powerConsumption: 0, reactorOutput: 1000 },
      industrial: { powerConsumption: 0, reactorOutput: 2000 },
      colossal: { powerConsumption: 0, reactorOutput: 4000 }
    },
    battery: {
      compact: { powerConsumption: 0, batteryCapacity: 125 },
      standard: { powerConsumption: 0, batteryCapacity: 250 },
      reinforced: { powerConsumption: 0, batteryCapacity: 500 },
      industrial: { powerConsumption: 0, batteryCapacity: 1000 },
      colossal: { powerConsumption: 0, batteryCapacity: 2000 }
    },
    distributor: {
      compact: { powerConsumption: 10, transferFactor: 0.5 },
      standard: { powerConsumption: 20, transferFactor: 1 },
      reinforced: { powerConsumption: 40, transferFactor: 1.5 },
      industrial: { powerConsumption: 80, transferFactor: 2.25 },
      colossal: { powerConsumption: 160, transferFactor: 3 }
    },
    armor: {
      compact: { armorReduction: 10 },
      standard: { armorReduction: 20 },
      reinforced: { armorReduction: 30 },
      industrial: { armorReduction: 45 },
      colossal: { armorReduction: 60 }
    },
    ftl: {
      compact: { powerConsumption: 15, warpFactor: 1, jumpRange: 10, chargeTime: 3 },
      standard: { powerConsumption: 30, warpFactor: 1.5, jumpRange: 20, chargeTime: 3 },
      reinforced: { powerConsumption: 60, warpFactor: 2, jumpRange: 40, chargeTime: 4 },
      industrial: { powerConsumption: 120, warpFactor: 3, jumpRange: 80, chargeTime: 4 },
      colossal: { powerConsumption: 240, warpFactor: 4, jumpRange: 160, chargeTime: 5 }
    },
    weapon: {
      compact: { powerConsumption: 15, damageFormula: "1d10", penetration: 10, cooldownRounds: 1 },
      standard: { powerConsumption: 30, damageFormula: "2d10", penetration: 20, cooldownRounds: 2 },
      reinforced: { powerConsumption: 60, damageFormula: "4d10", penetration: 30, cooldownRounds: 2 },
      industrial: { powerConsumption: 120, damageFormula: "8d10", penetration: 40, cooldownRounds: 3 },
      colossal: { powerConsumption: 240, damageFormula: "16d10", penetration: 50, cooldownRounds: 3 }
    },
    utility: {
      compact: { powerConsumption: 10 },
      standard: { powerConsumption: 20 },
      reinforced: { powerConsumption: 40 },
      industrial: { powerConsumption: 80 },
      colossal: { powerConsumption: 160 }
    }
  },

  /** Vida estrutural (hp.max) sugerida por Porte de Módulo, igual pra toda Categoria — 20 é o valor "a Compacto" (já o default do campo), escala por MODULE_SIZE_MULTIPLIER. */
  MODULE_HP_BY_SIZE: { compact: 20, standard: 40, reinforced: 80, industrial: 160, colossal: 320 },

  /**
   * Atributos de combate. `bonus = floor(pontos / 3)`; a cada +10 de bônus a
   * rolagem ganha +1d20 (todos os dados são somados). Bônus de arma/equipamento
   * NUNCA contam pra essa conta — somam por fora, sempre como número fixo.
   */
  COMBAT_ATTRIBUTES: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "precision"],

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
    precision: "Precisão"
  },

  /**
   * Tipos de Efeito de uma Skill. "damage" cobre dano físico e elemental (o
   * elemento é um sub-campo); "temporary" cobre buffs/debuffs/escudos/drawbacks
   * como uma lista de Efeitos (ver EFFECT_TARGETS).
   */
  SKILL_EFFECT_TYPES: ["none", "damage", "temporary"],

  SKILL_EFFECT_TYPE_LABELS: {
    none: "Descritiva (sem mecânica)",
    damage: "Dano",
    temporary: "Efeito Temporário (buff/debrawback/escudo)"
  },

  /** Ver module/area-effects.js. */
  SKILL_TARGET_TYPES: ["targeted", "emission"],

  SKILL_TARGET_TYPE_LABELS: {
    targeted: "Targetada (escolhe 1 Ator)",
    emission: "Emissão (posiciona uma área no canvas)"
  },

  SKILL_AREA_SHAPES: ["", "circle", "cone", "ray"],

  SKILL_AREA_SHAPE_LABELS: {
    "": "— selecione —",
    circle: "Círculo",
    cone: "Cone",
    ray: "Linha"
  },

  /**
   * Alvos possíveis de um Efeito Temporário: os 7 atributos de combate (afetam
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
    "precision",
    "hp",
    "energy",
    "shield",
    "shipWeaponDamage",
    "shipWeaponPenetration"
  ],

  EFFECT_TARGET_LABELS: {
    strength: "Força",
    defense: "Defesa",
    magic: "Magia",
    magicalDefense: "Defesa Mágica",
    dexterity: "Destreza",
    stealth: "Furtividade",
    precision: "Precisão",
    hp: "HP",
    energy: "Mana/Energia",
    shield: "Escudo",
    shipWeaponDamage: "Dano de Arma (Nave)",
    shipWeaponPenetration: "Penetração de Arma (Nave)"
  },

  /** Alvos "de Nave" de EFFECT_TARGETS — só fazem sentido numa Skill usada por uma Nave. */
  SHIP_EFFECT_TARGETS: ["shipWeaponDamage", "shipWeaponPenetration"],

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
   * Alvos possíveis de um bônus de Título: os 7 atributos de combate + HP/Mana
   * diretamente (sem passar pela fórmula — soma como um modificador permanente,
   * igual statModifiers de Skill/Item). Reaproveita EFFECT_TARGET_LABELS pros rótulos.
   */
  TITLE_BONUS_TARGETS: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "precision", "hp", "energy"],

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

  /** Tipos de dano elemental padrão, sobrescritos pela setting `damageElementsData` (editor visual). */
  DEFAULT_DAMAGE_ELEMENTS: [
    { id: "physical", label: "Físico", color: "#9aa1c2" },
    { id: "fire", label: "Fogo", color: "#ff7043" },
    { id: "ice", label: "Gelo", color: "#6ee7ff" },
    { id: "lightning", label: "Elétrico", color: "#ffe066" },
    { id: "acid", label: "Ácido", color: "#8bc34a" },
    { id: "dark", label: "Sombrio", color: "#7b5ea7" },
    { id: "holy", label: "Sagrado", color: "#e8c170" }
  ],

  /**
   * Condições nomeadas padrão, sobrescritas pela setting `statusConditionsData` (editor
   * visual, mesmo padrão de Moedas/Elementos de Dano). Puramente ícone + rótulo — dão nome
   * reconhecível (e ícone de status no token, via `ActiveEffect.statuses`) a uma entrada de
   * `effects[]` de uma Skill, mas NÃO bloqueiam ação nenhuma sozinhas: o Mestre arbitra o que
   * "cego"/"atordoado" impede na mesa, o sistema só automatiza o número por trás (debuff de
   * atributo, ou dano/cura por tick se `periodic: true`). Ícones são os SVGs já embutidos no
   * core do Foundry (`icons/svg/*`), sem depender de asset externo.
   */
  DEFAULT_STATUS_CONDITIONS: [
    { id: "blindness", label: "Cegueira", icon: "icons/svg/blind.svg" },
    { id: "poison", label: "Veneno", icon: "icons/svg/poison.svg" },
    { id: "stun", label: "Atordoamento", icon: "icons/svg/daze.svg" },
    { id: "silence", label: "Silêncio", icon: "icons/svg/silenced.svg" },
    { id: "paralysis", label: "Paralisia", icon: "icons/svg/paralysis.svg" },
    { id: "fear", label: "Medo", icon: "icons/svg/terror.svg" },
    { id: "bleeding", label: "Sangramento", icon: "icons/svg/blood.svg" },
    { id: "regeneration", label: "Regeneração", icon: "icons/svg/regen.svg" }
  ],

  /** Valores padrão (fallback) dos rótulos de energia — Personagens e Naves usam energias diferentes. */
  DEFAULT_CHARACTER_ENERGY_LABEL: "Mana",
  DEFAULT_STARSHIP_ENERGY_LABEL: "Sistema Eletro-Plasmático (EPS)",

  /**
   * Conjunto padrão de moedas, sobrescrito pela setting `currenciesData` (JSON).
   * `baseValue`: quantas "unidades-base" 1 unidade dessa moeda vale — permite
   * converter automaticamente entre quaisquer duas moedas da lista, mesmo com
   * hierarquias arbitrárias definidas pelo Mestre (ex: Moeda/Fita/Barra por metal).
   */
  DEFAULT_CURRENCIES: [
    { id: "gold", label: "Ouro", icon: "icons/commodities/currency/coins-plain-gold.webp", weight: 0.02, baseValue: 100 },
    { id: "silver", label: "Prata", icon: "icons/commodities/currency/coin-embossed-crown-silver.webp", weight: 0.02, baseValue: 10 },
    { id: "copper", label: "Cobre", icon: "icons/commodities/currency/coins-copper-various.webp", weight: 0.02, baseValue: 1 }
  ],

  /**
   * Presets de Partes do Corpo E Skills Raciais por Espécie, sobrescritos pela setting
   * `speciesPresetsData` (editor visual) para permitir espécies próprias sem tocar em código.
   *
   * Cada espécie: `{ label, group, availableAtCreation, parts[], skills[] }`
   *  - `parts`: `{ key, label, slot, hpMax, tags[] }` — vira um Item `body_part` na ficha.
   *  - `skills`: `{ name, description, level, cost }` — vira uma Skill de tier Racial.
   *  - `group`: só organiza a lista no editor (ver SPECIES_GROUP_LABELS), sem efeito mecânico.
   *  - `availableAtCreation`: `false` tira a espécie do seletor da ficha do JOGADOR. O Mestre
   *    continua vendo todas (precisa poder aplicar qualquer uma), e a geração via IA também —
   *    é o que permite ter Grifo e Cavalo como preset de Montaria sem oferecê-los como escolha
   *    de personagem. Ausente conta como `true`, então espécie criada à mão continua aparecendo.
   */
  /**
   * Grupos de Espécie — só rótulo, pra organizar a lista no editor e deixar óbvio de qual tipo de
   * campanha cada uma veio. Não têm efeito mecânico nenhum.
   */
  SPECIES_GROUP_LABELS: {
    fantasia: "Fantasia",
    isekai: "Isekai",
    scifi: "Sci-Fi",
    besta: "Besta / Montaria"
  },

  DEFAULT_SPECIES_PRESETS: {
    humano: {
      label: "Humano",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 20, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 8, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 8, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 10, tags: ["limb"] }
      ],
      skills: [
        { name: "Adaptabilidade", description: "Aprende habilidades comuns com mais facilidade que as demais espécies.", level: 1, cost: 0 }
      ]
    },
    elfo: {
      label: "Elfo",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 8, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 16, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 6, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 6, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "ears", label: "Orelhas Élficas", slot: "cosmetic", hpMax: 4, tags: ["sensory"] }
      ],
      skills: [
        { name: "Visão Élfica", description: "Enxerga com clareza mesmo em pouca luz; bônus em Precisão à distância.", level: 1, cost: 0 }
      ]
    },
    anao: {
      label: "Anão",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 24, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 10, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 10, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 8, tags: ["limb"] }
      ],
      skills: [
        { name: "Constituição Pétrea", description: "Corpo denso e baixo centro de gravidade: resiste a ser derrubado e a venenos comuns.", level: 1, cost: 0 },
        { name: "Olho de Forja", description: "Reconhece metal, liga e qualidade de forja no toque — e enxerga no escuro das minas.", level: 1, cost: 0 }
      ]
    },
    orc: {
      label: "Orc",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 26, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 12, tags: ["limb"] }
      ],
      skills: [
        { name: "Fúria Crescente", description: "Quanto mais ferido, mais forte bate — a dor vira ímpeto em vez de hesitação.", level: 1, cost: 0 },
        { name: "Couro Grosso", description: "A pele espessa absorve parte dos cortes e contusões.", level: 1, cost: 0 }
      ]
    },
    goblin: {
      label: "Goblin",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 6, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 12, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 5, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 5, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 7, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 7, tags: ["limb"] }
      ],
      skills: [
        { name: "Esgueirar-se", description: "Pequeno e silencioso: passa por brechas e some de vista em terreno bagunçado.", level: 1, cost: 0 },
        { name: "Instinto de Sucata", description: "Improvisa ferramenta ou arma com o que houver por perto.", level: 1, cost: 0 }
      ]
    },
    halfling: {
      label: "Pequenino",
      group: "fantasia",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 7, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 13, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 5, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 5, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 7, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 7, tags: ["limb"] }
      ],
      skills: [
        { name: "Sorte Teimosa", description: "Uma vez por cena, o desastre erra por pouco.", level: 1, cost: 0 },
        { name: "Pés Silenciosos", description: "Anda sem fazer ruído, mesmo sobre folhas secas ou assoalho velho.", level: 1, cost: 0 }
      ]
    },
    slime: {
      label: "Slime",
      group: "isekai",
      availableAtCreation: true,
      parts: [
        { key: "core", label: "Núcleo", slot: "core", hpMax: 30, tags: ["vital", "regenerative"] },
        { key: "mass", label: "Massa Gelatinosa", slot: "body", hpMax: 40, tags: ["amorphous", "regenerative"] }
      ],
      skills: [
        { name: "Regeneração Amorfa", description: "Recupera uma fração do HP máximo por turno enquanto o Núcleo estiver intacto.", level: 1, cost: 0 }
      ]
    },
    dragoide: {
      label: "Dragoide",
      group: "isekai",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 14, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 28, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 14, tags: ["limb"] },
        { key: "tail", label: "Cauda", slot: "tail", hpMax: 12, tags: ["limb"] },
        { key: "wings", label: "Asas Membranosas", slot: "wing", hpMax: 10, tags: ["limb", "flight"] }
      ],
      skills: [
        { name: "Escamas Ancestrais", description: "As escamas reduzem dano físico e resistem ao calor.", level: 1, cost: 0 },
        { name: "Sopro Dracônico", description: "Exala o elemento da própria linhagem num cone à frente.", level: 1, cost: 20 },
        { name: "Presença de Dragão", description: "A mera presença impõe medo a criaturas menores.", level: 1, cost: 0 }
      ]
    },
    ogro: {
      label: "Ogro",
      group: "isekai",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 16, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 34, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 18, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 18, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 16, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 16, tags: ["limb"] }
      ],
      skills: [
        { name: "Força Bruta", description: "Ergue e arremessa o que criatura nenhuma do seu tamanho deveria.", level: 1, cost: 0 },
        { name: "Estômago de Ferro", description: "Come e bebe o que for sem adoecer — veneno ingerido quase não o afeta.", level: 1, cost: 0 }
      ]
    },
    lobo_tempestade: {
      label: "Lobo Tempestade",
      group: "isekai",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 24, tags: ["vital"] },
        { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "tail", label: "Cauda", slot: "tail", hpMax: 6, tags: ["limb"] }
      ],
      skills: [
        { name: "Passo de Trovão", description: "Move-se em rajadas curtas, rápido demais para o olho acompanhar.", level: 1, cost: 0 },
        { name: "Pelo Estático", description: "A pelagem carregada fere quem o agarra.", level: 1, cost: 0 }
      ]
    },
    harpia: {
      label: "Harpia",
      group: "isekai",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 8, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 16, tags: ["vital"] },
        { key: "left_wing", label: "Asa Esquerda", slot: "wing", hpMax: 10, tags: ["limb", "flight"] },
        { key: "right_wing", label: "Asa Direita", slot: "wing", hpMax: 10, tags: ["limb", "flight"] },
        { key: "left_talon", label: "Garra Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "right_talon", label: "Garra Direita", slot: "leg", hpMax: 8, tags: ["limb"] }
      ],
      skills: [
        { name: "Voo Batido", description: "Voa de verdade — não plana: sobe, para no ar e mergulha.", level: 1, cost: 0 },
        { name: "Grito Cortante", description: "Um grito que desorienta quem estiver perto.", level: 1, cost: 15 }
      ]
    },
    ciborgue: {
      label: "Ciborgue",
      group: "scifi",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 22, tags: ["vital", "mechanical"] },
        { key: "left_arm", label: "Braço Esquerdo (Protético)", slot: "arm", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
        { key: "right_arm", label: "Braço Direito (Protético)", slot: "arm", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
        { key: "left_leg", label: "Perna Esquerda (Protética)", slot: "leg", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
        { key: "right_leg", label: "Perna Direita (Protética)", slot: "leg", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] }
      ],
      skills: [
        { name: "Blindagem Sintética", description: "Membros protéticos absorvem parte do dano físico recebido.", level: 1, cost: 0 }
      ]
    },
    androide: {
      label: "Androide",
      group: "scifi",
      availableAtCreation: true,
      parts: [
        { key: "core", label: "Núcleo de Processamento", slot: "core", hpMax: 18, tags: ["vital", "mechanical"] },
        { key: "chassis", label: "Chassi", slot: "torso", hpMax: 28, tags: ["vital", "mechanical"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 16, tags: ["limb", "mechanical"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 16, tags: ["limb", "mechanical"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 16, tags: ["limb", "mechanical"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 16, tags: ["limb", "mechanical"] },
        { key: "optics", label: "Conjunto Óptico", slot: "head", hpMax: 8, tags: ["sensory", "mechanical"] }
      ],
      skills: [
        { name: "Sem Fôlego a Perder", description: "Não respira, não cansa e não dorme: imune a veneno inalado e a sufocamento.", level: 1, cost: 0 },
        { name: "Interface Direta", description: "Conecta-se a sistemas e portas de dados sem precisar de terminal.", level: 1, cost: 0 }
      ]
    },
    mutante: {
      label: "Mutante",
      group: "scifi",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 22, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 10, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 10, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 11, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 11, tags: ["limb"] }
      ],
      skills: [
        { name: "Carne Instável", description: "O corpo se reconfigura sob estresse — fecha ferimentos rápido demais para ser natural.", level: 1, cost: 0 },
        { name: "Anomalia Latente", description: "Cada Mutante carrega uma mutação única, definida com o Mestre na criação.", level: 1, cost: 0 }
      ]
    },
    simbionte: {
      label: "Simbionte",
      group: "scifi",
      availableAtCreation: true,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 20, tags: ["vital"] },
        { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 9, tags: ["limb"] },
        { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 9, tags: ["limb"] },
        { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "symbiote", label: "Simbionte", slot: "body", hpMax: 20, tags: ["vital", "regenerative", "parasitic"] }
      ],
      skills: [
        { name: "Hospedeiro Compartilhado", description: "O simbionte cura o hospedeiro — e sente o que ele sente.", level: 1, cost: 0 },
        { name: "Massa Adaptativa", description: "O simbionte endurece sobre o corpo, virando lâmina ou escudo conforme a necessidade.", level: 1, cost: 10 }
      ]
    },
    cavalo: {
      label: "Cavalo",
      group: "besta",
      availableAtCreation: false,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 30, tags: ["vital"] },
        { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
        { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 14, tags: ["limb"] }
      ],
      skills: [
        { name: "Galope Sustentado", description: "Mantém velocidade alta por horas sem se esgotar.", level: 1, cost: 0 },
        { name: "Coice", description: "Um coice das patas traseiras derruba quem se aproxima por trás.", level: 1, cost: 0 }
      ]
    },
    lobo_gigante: {
      label: "Lobo Gigante",
      group: "besta",
      availableAtCreation: false,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 14, tags: ["vital"] },
        { key: "torso", label: "Tronco", slot: "torso", hpMax: 28, tags: ["vital"] },
        { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
        { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 14, tags: ["limb"] },
        { key: "tail", label: "Cauda", slot: "tail", hpMax: 6, tags: ["limb"] }
      ],
      skills: [
        { name: "Faro de Caçador", description: "Segue um rastro por dias, mesmo depois da chuva.", level: 1, cost: 0 },
        { name: "Mordida Travante", description: "A mordida prende a presa no lugar.", level: 1, cost: 0 }
      ]
    },
    grifo: {
      label: "Grifo",
      group: "besta",
      availableAtCreation: false,
      parts: [
        { key: "head", label: "Cabeça de Águia", slot: "head", hpMax: 12, tags: ["vital", "sensory"] },
        { key: "torso", label: "Tronco Leonino", slot: "torso", hpMax: 26, tags: ["vital"] },
        { key: "left_wing", label: "Asa Esquerda", slot: "wing", hpMax: 12, tags: ["limb", "flight"] },
        { key: "right_wing", label: "Asa Direita", slot: "wing", hpMax: 12, tags: ["limb", "flight"] },
        { key: "front_left", label: "Garra Dianteira Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "front_right", label: "Garra Dianteira Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
        { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
        { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 12, tags: ["limb"] }
      ],
      skills: [
        { name: "Montaria Alada", description: "Carrega um cavaleiro em voo, não só em terra.", level: 1, cost: 0 },
        { name: "Olhar de Águia", description: "Distingue detalhes a distâncias que olho nenhum alcança.", level: 1, cost: 0 }
      ]
    },
    inseto_de_carga: {
      label: "Inseto de Carga",
      group: "besta",
      availableAtCreation: false,
      parts: [
        { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
        { key: "thorax", label: "Tórax", slot: "torso", hpMax: 26, tags: ["vital", "chitinous"] },
        { key: "abdomen", label: "Abdômen", slot: "body", hpMax: 30, tags: ["chitinous"] },
        { key: "leg_1", label: "Perna 1", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "leg_2", label: "Perna 2", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "leg_3", label: "Perna 3", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "leg_4", label: "Perna 4", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "leg_5", label: "Perna 5", slot: "leg", hpMax: 8, tags: ["limb"] },
        { key: "leg_6", label: "Perna 6", slot: "leg", hpMax: 8, tags: ["limb"] }
      ],
      skills: [
        { name: "Carapaça de Quitina", description: "A casca dura reduz cortes e perfurações.", level: 1, cost: 0 },
        { name: "Besta de Carga", description: "Carrega várias vezes o próprio peso sem perder o passo.", level: 1, cost: 0 }
      ]
    }
  }
};

/**
 * Lê a lista de moedas atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,icon:string,weight:number,baseValue:number}>}
 */
export function getActiveCurrencies() {
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.currenciesData);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de moedas inválido, usando padrão.`, err);
  }
  return MEU_SISTEMA.DEFAULT_CURRENCIES;
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
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageElementsData);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de elementos de dano inválido, usando padrão.`, err);
  }
  return MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS;
}

/**
 * Lê a lista de Condições de Status atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,icon:string}>}
 */
export function getActiveStatusConditions() {
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.statusConditionsData);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de condições de status inválido, usando padrão.`, err);
  }
  return MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS;
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
  return [{ value: "general", label: "Geral" }, ...getActiveDamageElements().map(el => ({ value: el.id, label: el.label }))];
}

/**
 * Chaves de migração única (ver runMigrationIfNeeded em nihility-rpg-system.js) já executadas
 * com sucesso neste mundo.
 * @returns {string[]}
 */
export function getCompletedMigrations() {
  try {
    const parsed = JSON.parse(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.completedMigrations) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de migrações concluídas inválido, tratando como nenhuma migração feita.`, err);
    return [];
  }
}

/** Marca uma migração única como concluída (idempotente — chamar de novo com a mesma chave não duplica). */
export async function markMigrationCompleted(key) {
  const current = getCompletedMigrations();
  if (current.includes(key)) return;
  await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.completedMigrations, JSON.stringify([...current, key]));
}

/**
 * Log gateado pela setting "Modo Debug" (`false` por padrão) — usado pelos `_prepareContext`/
 * handlers de toda Sheet/App do sistema, que sem isso poluíam o console de qualquer GM com um
 * log a cada render/clique. Eventos raros de ciclo de vida (init, Compêndio criado, migração
 * concluída) continuam em `console.log` direto, sem gate — não valem o barulho de precisar
 * ligar Modo Debug só pra ver se o sistema carregou.
 */
export function debugLog(...args) {
  try {
    if (!game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.debugMode)) return;
  } catch (err) {
    return;
  }
  console.log(...args);
}

/**
 * Lê o dicionário de presets de espécie atualmente ativo.
 * Assim que o GM salva algo pelo editor visual (Configurar Presets de Espécie),
 * o resultado completo passa a ser a única fonte da verdade; até lá, usa os padrões.
 * @returns {Record<string, {label:string, parts:Array, skills:Array}>}
 */
export function getActiveSpeciesPresets() {
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.speciesPresetsData);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return parsed;
    }
  } catch (err) {
    console.warn(`${SYSTEM_ID} | JSON de presets de espécie inválido, usando padrão.`, err);
  }
  return MEU_SISTEMA.DEFAULT_SPECIES_PRESETS;
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
 * Rótulo de energia certo pro TIPO do Ator em questão — nunca hardcode "Energia"/"Mana" em
 * mensagens de chat/notificação; use isso (Personagem/Criatura usa `characterEnergyLabel`,
 * Nave usa `starshipEnergyLabel`, cada um configurável separadamente pelo Mestre).
 */
export function getEnergyLabelForActor(actor) {
  // Veículo compartilha o mesmo Grid de Energia de Nave desde o overhaul de Porte (Fase 1).
  return ["starship", "vehicle"].includes(actor?.type) ? getStarshipEnergyLabel() : getCharacterEnergyLabel();
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
  for (const [field, value] of Object.entries(MEU_SISTEMA.MODULE_SIZE_PRESETS[category]?.[moduleSize] ?? {})) {
    preset[`system.${field}`] = value;
  }
  const hp = MEU_SISTEMA.MODULE_HP_BY_SIZE[moduleSize];
  if (hp) {
    preset["system.hp.max"] = hp;
    preset["system.hp.value"] = hp;
  }
  return preset;
}

/**
 * Atores candidatos a alvo/destinatário: só quem tem um Token na CENA atualmente aberta
 * (`canvas.scene`), não o Diretório de Atores do mundo inteiro — evita listar gente que nem
 * está na cena (ex: mandar dinheiro pra um Ator noutra sessão de jogo, ou mirar Habilidade
 * numa Nave que não está nem por perto). Tokens duplicados do mesmo Ator (vários NPCs iguais)
 * contam uma vez só. `types` (opcional) filtra por `actor.type`; `excludeActorId` tira um Ator
 * específico da lista; `permission` (padrão "OBSERVER") é o nível mínimo exigido.
 */
export function sceneActorCandidates({ types = null, excludeActorId = null, permission = "OBSERVER" } = {}) {
  const scene = canvas?.scene;
  if (!scene) return [];
  const seen = new Set();
  const candidates = [];
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || seen.has(actor.id)) continue;
    if (actor.id === excludeActorId) continue;
    if (types && !types.includes(actor.type)) continue;
    if (!actor.testUserPermission(game.user, permission)) continue;
    seen.add(actor.id);
    candidates.push(actor);
  }
  return candidates;
}

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
  let saved = {};
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributesData);
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
 * MEU_SISTEMA.EFFECT_TARGET_LABELS com os sete atributos trocados pelos rótulos ativos — os
 * alvos que não são atributo (hp/energy/shield/os de Nave) ficam como estão.
 */
export function getEffectTargetLabels() {
  return { ...MEU_SISTEMA.EFFECT_TARGET_LABELS, ...getAttributeLabels() };
}

/**
 * XP necessário para sair de `level` para o próximo. A fórmula é uma setting (padrão
 * `100 * @nivel`, ou seja 100 no nv 1, 1000 no nv 10) porque a curva certa depende da campanha:
 * o poder do personagem cresce de forma QUADRÁTICA (HP = Atributo × Atributo × mult, sobre
 * pontos que crescem linearmente por nível), então uma curva linear de XP mantém o preço por
 * ponto de poder quase constante, enquanto uma quadrática vira um teto disfarçado.
 *
 * Avaliada por `Roll.safeEval` (só aritmética, nunca código do usuário). Fórmula inválida cai no
 * padrão em vez de quebrar a ficha.
 * @param {number} level
 * @returns {number} XP para o próximo nível (mínimo 1)
 */
export function getXpForNextLevel(level) {
  const safeLevel = Math.max(1, Math.round(Number(level) || 1));
  const fallback = 100 * safeLevel;
  let formula;
  try {
    formula = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.xpFormula);
  } catch (err) {
    return fallback;
  }
  if (!formula?.trim()) return fallback;

  try {
    const value = Roll.safeEval(String(formula).replaceAll("@nivel", String(safeLevel)));
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Fórmula de XP inválida ("${formula}") — usando o padrão.`, err);
    return fallback;
  }
}

/** Golpes de um mesmo tipo até o sistema sugerir a Resistência ao Mestre (0 = aviso desligado). */
export function getResistanceLearnThreshold() {
  try {
    const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.resistanceLearnThreshold));
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 25;
  } catch (err) {
    return 25;
  }
}

/**
 * XP que uma Skill de Resistência ganha por ter bloqueado `blocked` de dano num defensor com
 * `maxHp` de Vida Máxima.
 *
 * É proporcional à FRAÇÃO da própria Vida que foi salva, nunca ao número absoluto de dano: como
 * o dano deste sistema escala com o quadrado do atributo, XP proporcional ao dano bruto
 * inflacionaria sozinho (a mesma defesa renderia dezenas de vezes mais XP no fim da campanha que
 * no começo, e a Skill subiria de nível sem esforço). Em fração, defender um golpe igualmente
 * perigoso rende o mesmo XP em qualquer nível — e arranhão continua rendendo 0.
 * @returns {number} XP inteiro (0 quando o bloqueio foi irrelevante perto da Vida do defensor)
 */
export function resistanceXpGain(blocked, maxHp) {
  if (!(blocked > 0) || !(maxHp > 0)) return 0;

  let factor = 100;
  try {
    const configured = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.resistanceXpFactor));
    if (Number.isFinite(configured) && configured >= 0) factor = configured;
  } catch (err) {
    /* setting ainda não registrada — segue no padrão */
  }

  return Math.round((blocked / maxHp) * factor);
}

/**
 * O que o nível de uma Skill entrega, acumulado do nível 1 até `level`.
 *
 * O nível avança num CICLO fixo e previsível: N níveis de Poder (cada um multiplica o efeito da
 * Skill) seguidos de M níveis de Desconto (cada um corta o Custo), repetindo pra sempre. O
 * jogador sempre sabe o que o próximo nível dá sem consultar tabela — é o motivo de o ciclo ser
 * fixo em vez de uma tabela por nível.
 *
 * Duas regras não-óbvias, ambas deliberadas:
 *  - **Os dois são multiplicativos, nunca subtrativos.** Um desconto de -20% subtrativo levaria o
 *    custo ao piso em 5 níveis e tornaria todo o resto da curva inútil; multiplicativo, o piso
 *    chega por volta do nível 24 com os padrões atuais.
 *  - **Nível de Desconto que cai com o custo JÁ no piso vira nível de Poder.** Sem isso, toda
 *    Skill que passa do piso acumula níveis que não entregam nada (13 níveis mortos até o nível
 *    50, nos padrões) — e o Mestre ainda teria gasto o clique de Level Up em cada um.
 *
 * Skill de Resistência não passa por aqui: ela tem progressão própria (10%/nível, ver
 * `computeResistancePercent`) e teto de nível próprio.
 * @param {number} level
 * @returns {{power: number, cost: number}} multiplicadores (1 = sem alteração)
 */
export function skillLevelBonuses(level) {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };

  const powerStep = read("skillPowerPerLevel", 10) / 100;
  const discountStep = read("skillDiscountPerLevel", 20) / 100;
  const floor = Math.clamp(read("skillCostFloorPercent", 10) / 100, 0, 1);
  const powerLevels = Math.max(0, Math.round(read("skillCyclePower", 2)));
  const discountLevels = Math.max(0, Math.round(read("skillCycleDiscount", 2)));

  const cycle = [...Array(powerLevels).fill("power"), ...Array(discountLevels).fill("discount")];
  const safeLevel = Math.max(1, Math.round(Number(level) || 1));
  if (!cycle.length) return { power: 1, cost: 1 };

  let power = 1;
  let cost = 1;
  for (let i = 0; i < safeLevel - 1; i++) {
    const atFloor = cost <= floor + 1e-9;
    // Desconto com o custo já no piso não teria efeito nenhum — vira Poder (ver acima).
    const phase = cycle[i % cycle.length] === "discount" && !atFloor ? "discount" : "power";
    if (phase === "power") power *= 1 + powerStep;
    else cost = Math.max(floor, cost * (1 - discountStep));
  }

  return { power, cost };
}

/**
 * Custo de Energia efetivo de uma Skill/Sub-Skill no nível dela — o valor escrito na Skill já
 * com o desconto acumulado do ciclo. Uma Skill que custa alguma coisa nunca fica de graça por
 * arredondamento: o mínimo é 1.
 * @param {number} baseCost - `cost` ou `upkeepCost` escrito na Skill
 * @param {number} level
 */
export function effectiveSkillCost(baseCost, level) {
  const base = Number(baseCost) || 0;
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * skillLevelBonuses(level).cost));
}

/**
 * Multiplicador de dano vindo do Atributo de Escala de uma Skill: `(Atributo.Total)² ÷ divisor`.
 *
 * A forma é QUADRÁTICA de propósito, não por gosto: o HP deste sistema é
 * `Atributo × Atributo × multiplicador`, ou seja cresce com o quadrado dos pontos investidos.
 * Qualquer escala linear de dano (somar o bônus, multiplicar pelo total) é engolida pela curva
 * de HP — um alvo de mesmo nível passaria de ~24 golpes no nível 1 para ~200 no nível 50. Com a
 * forma quadrática o número de golpes fica constante em toda a campanha, e quem controla o
 * ritmo é o divisor (setting) e a fórmula de dado escrita na Skill.
 *
 * Sem Atributo de Escala escolhido (`""`, o padrão) devolve 1 — toda Skill criada antes desta
 * regra continua causando exatamente o dano que sempre causou.
 * @param {Actor} actor - quem está usando a Skill
 * @param {string} attributeKey - `mech.scalingAttribute`
 * @returns {number} fator multiplicativo (1 = sem escala)
 */
export function damageScalingMultiplier(actor, attributeKey) {
  if (!attributeKey || !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(attributeKey)) return 1;

  const total = actor?.system?.attributes?.combat?.[attributeKey]?.total ?? 0;
  if (total <= 0) return 1;

  let divisor = 10;
  try {
    const configured = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageScalingDivisor));
    if (Number.isFinite(configured) && configured > 0) divisor = configured;
  } catch (err) {
    /* setting ainda não registrada — segue no padrão */
  }

  return (total * total) / divisor;
}

/**
 * Leitor ÚNICO de todo bloco ligável/desligável do sistema (ver MEU_SISTEMA.FEATURES) — use
 * isto, e não `game.settings.get` direto, pra gatear qualquer coisa: só aqui a cadeia de
 * `parent` é respeitada (uma sub-feature do PAD com a chave-mestra desligada conta como
 * desligada, mesmo que a setting dela esteja `true`).
 *
 * Cai no `default` da tabela quando as settings ainda não foram registradas — isso acontece de
 * verdade quando um Data Model prepara dados cedo demais no boot, e um `throw` aqui derrubaria
 * a preparação inteira da ficha.
 * @param {keyof MEU_SISTEMA["FEATURES"]} key
 * @returns {boolean}
 */
export function isFeatureEnabled(key) {
  const feature = MEU_SISTEMA.FEATURES[key];
  if (!feature) return true;
  if (feature.parent && !isFeatureEnabled(feature.parent)) return false;
  try {
    return Boolean(game.settings.get(SYSTEM_ID, feature.setting));
  } catch (err) {
    return feature.default ?? true;
  }
}

/**
 * Aplica um preset de campanha (MEU_SISTEMA.CAMPAIGN_PRESETS) de uma vez só. Blocos que o preset
 * não menciona ficam como estão. Não toca em dado nenhum do mundo — só nas settings de exibição.
 * @param {keyof MEU_SISTEMA["CAMPAIGN_PRESETS"]} presetKey
 */
export async function applyCampaignPreset(presetKey) {
  const preset = MEU_SISTEMA.CAMPAIGN_PRESETS[presetKey];
  if (!preset) throw new Error(`Preset de campanha desconhecido: "${presetKey}".`);

  for (const [featureKey, enabled] of Object.entries(preset.features)) {
    const feature = MEU_SISTEMA.FEATURES[featureKey];
    if (!feature) continue;
    await game.settings.set(SYSTEM_ID, feature.setting, Boolean(enabled));
  }
  return preset;
}

/* Atalhos nomeados — mantidos porque metade do sistema já os importa, mas todos delegam pro
   mesmo `isFeatureEnabled` acima (nenhuma leitura paralela de setting). */
export function isEconomyEnabled() {
  return isFeatureEnabled("economy");
}
export function isTitlesEnabled() {
  return isFeatureEnabled("titles");
}
export function isAnatomyEnabled() {
  return isFeatureEnabled("anatomy");
}
export function isVesselsEnabled() {
  return isFeatureEnabled("vessels");
}
export function isSkillFusionEnabled() {
  return isFeatureEnabled("skillFusion");
}
export function isSkillPointsEnabled() {
  return isFeatureEnabled("skillPoints");
}
export function isAttributePoolEnabled() {
  return isFeatureEnabled("attributePool");
}
export function isResistancesEnabled() {
  return isFeatureEnabled("resistances");
}
export function isStatusConditionsEnabled() {
  return isFeatureEnabled("statusConditions");
}
export function isAreaEffectsEnabled() {
  return isFeatureEnabled("areaEffects");
}
export function isAIAssistantEnabled() {
  return isFeatureEnabled("aiAssistant");
}

/** Chave-mestra do PAD — sem ela, nenhuma sub-funcionalidade abaixo aparece mesmo que ligada. */
export function isPadEnabled() {
  return isFeatureEnabled("pad");
}
export function isPadShipEnabled() {
  return isFeatureEnabled("padShip");
}
export function isPadLibraryEnabled() {
  return isFeatureEnabled("padLibrary");
}
export function isPadMessagingEnabled() {
  return isFeatureEnabled("padMessaging");
}

/**
 * Fórmula de HP/Mana Máximo, configurável pelo Mestre (ver `deriveVitalStats` em
 * data/character-model.js). O formato é sempre `Atributo A .Total × Atributo B .Total ×
 * multiplicador`, com um piso — o que muda por campanha é QUAIS atributos entram e com que
 * escala. É isso que permite uma campanha sem magia: basta apontar a Mana pra outros dois
 * atributos, ou desligar o pool inteiro (`energyPoolEnabled`).
 *
 * Um atributo removido da lista por engano (ou uma setting de um mundo antigo apontando pra
 * chave que não existe mais) cai no padrão em vez de quebrar a preparação da ficha.
 * @returns {{hp: [string, string], energy: [string, string], multiplier: number, floor: number, energyEnabled: boolean}}
 */
export function getVitalFormula() {
  const read = (key, fallback) => {
    try {
      const value = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]);
      return MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const readNumber = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };

  return {
    hp: [read("hpFormulaPrimary", "strength"), read("hpFormulaSecondary", "defense")],
    energy: [read("energyFormulaPrimary", "magic"), read("energyFormulaSecondary", "magicalDefense")],
    multiplier: readNumber("vitalFormulaMultiplier", MEU_SISTEMA.DEFAULT_VITAL_FORMULA_MULTIPLIER),
    floor: readNumber("vitalFormulaFloor", MEU_SISTEMA.MIN_BASE_VITAL_STAT),
    energyEnabled: isEnergyPoolEnabled()
  };
}

/**
 * Campanha usa pool de Mana/Energia? Desligado (campanha "sem magia"), a barra some da ficha,
 * o Máximo vira 0 e nenhum Custo/Custo por Rodada de Habilidade é cobrado — a Skill continua
 * funcionando, o recurso é que deixa de existir. Nave/Veículo NÃO é afetado: o Grid de Energia
 * é outro sistema, com pool próprio.
 */
export function isEnergyPoolEnabled() {
  try {
    return Boolean(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.energyPoolEnabled));
  } catch (err) {
    return true;
  }
}

/** Pontos de Atributo/Habilidade concedidos na criação e por nível (settings do Mestre). */
export function getAttributePointsStarting() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributePointsStarting);
}
export function getAttributePointsPerLevel() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributePointsPerLevel);
}
export function getSkillPointsStarting() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.skillPointsStarting);
}
export function getSkillPointsPerLevel() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.skillPointsPerLevel);
}

/**
 * Registra todas as Game Settings do sistema. Deve ser chamado no hook `init`.
 */
export function registerSystemSettings() {
  const S = MEU_SISTEMA.SETTINGS;

  // Um registro por bloco de MEU_SISTEMA.FEATURES — a tabela é a única fonte da verdade, então
  // ligar um bloco novo não exige tocar aqui. `config: false` de propósito: a lista apareceria
  // como 15 checkboxes soltos no meio das settings do Foundry; em vez disso ela é editada pela
  // tela "Configurar Módulos do Sistema" (list-config-app-factory-style, ver
  // apps/feature-config.js), que mostra os presets de campanha junto.
  for (const feature of Object.values(MEU_SISTEMA.FEATURES)) {
    game.settings.register(SYSTEM_ID, feature.setting, {
      name: feature.name,
      hint: feature.hint,
      scope: "world",
      config: false,
      type: Boolean,
      default: feature.default ?? true,
      requiresReload: true
    });
  }

  // Rótulo/visibilidade dos sete atributos (editados pela tela "Configurar Atributos").
  // Registrada ANTES das settings de fórmula vital de propósito: os `choices` daquelas são
  // montados a partir dos rótulos ATIVOS, então esta precisa já existir pra ser lida.
  game.settings.register(SYSTEM_ID, S.attributesData, {
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.register(SYSTEM_ID, S.damageScalingDivisor, {
    name: "Escala de Dano por Atributo — Divisor",
    hint: "Uma Skill com Atributo de Escala causa: Fórmula × (Atributo.Total)² ÷ este número. Menor = combate mais rápido. Padrão 10 (uma skill 2d6 derruba um alvo de mesmo nível em ~14 golpes; uma 10d10, em 2).",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.skillPowerPerLevel, {
    name: "Nível de Skill — Poder por nível (%)",
    hint: "Quanto cada nível de Poder multiplica o efeito da Skill (dano e valores de efeito). Padrão 10%.",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.skillDiscountPerLevel, {
    name: "Nível de Skill — Desconto de Custo por nível (%)",
    hint: "Quanto cada nível de Desconto corta do Custo de Energia, multiplicativamente. Padrão 20%.",
    scope: "world",
    config: true,
    type: Number,
    default: 20,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.skillCyclePower, {
    name: "Nível de Skill — Níveis de Poder no ciclo",
    hint: "Quantos níveis seguidos dão Poder antes de começarem os de Desconto. Padrão 2.",
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.skillCycleDiscount, {
    name: "Nível de Skill — Níveis de Desconto no ciclo",
    hint: "Quantos níveis seguidos dão Desconto antes de o ciclo recomeçar. Padrão 2. Com o custo já no piso, esses níveis viram Poder.",
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.skillCostFloorPercent, {
    name: "Nível de Skill — Piso do Custo (%)",
    hint: "O Custo de uma Skill nunca cai abaixo deste percentual do valor original. Padrão 10%.",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.resistanceXpFactor, {
    name: "XP de Resistência — Fator",
    hint: "XP que uma Skill de Resistência ganha ao defender: (dano bloqueado ÷ Vida Máxima do defensor) × este número. Padrão 100 — bloquear 10% da própria Vida rende 10 XP, e um arranhão rende 0.",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.resistanceLearnThreshold, {
    name: "Resistência — Golpes para aprender",
    hint: "Quantos golpes de um mesmo tipo de dano um personagem precisa levar antes de o sistema avisar o Mestre que ele pode ganhar a Resistência àquele tipo. A Skill NÃO é criada sozinha — o aviso é só uma sugestão. Padrão 25. Coloque 0 para desligar o aviso.",
    scope: "world",
    config: true,
    type: Number,
    default: 25,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.xpFormula, {
    name: "Fórmula de XP por Nível",
    hint: "XP necessário para sair do nível atual. Use @nivel para o nível atual. Padrão: 100 * @nivel (100 no nível 1, 1000 no nível 10).",
    scope: "world",
    config: true,
    type: String,
    default: "100 * @nivel"
  });

  // Fórmula de HP/Mana. Fica visível na tela de settings (config: true) porque é uma regra de
  // balanceamento que o Mestre ajusta uma vez e esquece — não é um liga/desliga de campanha.
  const attributeChoices = Object.fromEntries(getActiveAttributes().map(a => [a.key, a.label]));

  game.settings.register(SYSTEM_ID, S.hpFormulaPrimary, {
    name: "Fórmula de HP — 1º Atributo",
    hint: "HP Máximo = (1º Atributo).Total × (2º Atributo).Total × Multiplicador.",
    scope: "world",
    config: true,
    type: String,
    choices: attributeChoices,
    default: "strength",
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.hpFormulaSecondary, {
    name: "Fórmula de HP — 2º Atributo",
    hint: "O segundo fator da multiplicação de HP Máximo.",
    scope: "world",
    config: true,
    type: String,
    choices: attributeChoices,
    default: "defense",
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.energyPoolEnabled, {
    name: "Usar pool de Mana/Energia",
    hint: "Desligue numa campanha sem magia: a barra some da ficha e nenhum Custo de Habilidade é cobrado (as Habilidades continuam funcionando). Não afeta o Grid de Energia de Naves/Veículos, que é outro sistema.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.energyFormulaPrimary, {
    name: "Fórmula de Mana/Energia — 1º Atributo",
    hint: "Mana Máxima = (1º Atributo).Total × (2º Atributo).Total × Multiplicador.",
    scope: "world",
    config: true,
    type: String,
    choices: attributeChoices,
    default: "magic",
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.energyFormulaSecondary, {
    name: "Fórmula de Mana/Energia — 2º Atributo",
    hint: "O segundo fator da multiplicação de Mana Máxima.",
    scope: "world",
    config: true,
    type: String,
    choices: attributeChoices,
    default: "magicalDefense",
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.allowOffSceneTargets, {
    name: "Permitir alvo sem Token na cena",
    hint: "Ligado, a busca do diálogo de alvo alcança o diretório de Atores do mundo — necessário em mesa de teatro da mente, onde ninguém tem Token. Desligado (padrão), só quem está na cena atual pode ser alvo.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.initiativeAttribute, {
    name: "Atributo de Iniciativa",
    hint: "Atributo que rege a rolagem de iniciativa. Usa o mesmo pool escalável de qualquer rolagem (Nd20 + fixo), não um d20 solto.",
    scope: "world",
    config: true,
    type: String,
    choices: attributeChoices,
    default: "dexterity",
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.vitalFormulaMultiplier, {
    name: "Fórmula de HP/Mana — Multiplicador",
    hint: "O ×10 padrão da fórmula. Baixar deixa a campanha inteira mais letal; subir, mais heroica.",
    scope: "world",
    config: true,
    type: Number,
    default: MEU_SISTEMA.DEFAULT_VITAL_FORMULA_MULTIPLIER,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.vitalFormulaFloor, {
    name: "Fórmula de HP/Mana — Piso",
    hint: "Resultado mínimo da fórmula, mesmo com os atributos zerados. Modificadores de Título/Skill/Item somam POR CIMA desse piso.",
    scope: "world",
    config: true,
    type: Number,
    default: MEU_SISTEMA.MIN_BASE_VITAL_STAT,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.characterEnergyLabel, {
    name: "Rótulo de Energia — Personagens/Criaturas",
    hint: "Nome customizado da energia usada por Personagens e Criaturas (ex: Mana, Ki, Fluxo Quântico).",
    scope: "world",
    config: true,
    type: String,
    default: MEU_SISTEMA.DEFAULT_CHARACTER_ENERGY_LABEL
  });

  game.settings.register(SYSTEM_ID, S.starshipEnergyLabel, {
    name: "Rótulo de Energia — Naves Espaciais",
    hint: "Nome customizado da energia usada por Naves Espaciais (ex: Sistema Eletro-Plasmático (EPS)).",
    scope: "world",
    config: true,
    type: String,
    default: MEU_SISTEMA.DEFAULT_STARSHIP_ENERGY_LABEL
  });

  game.settings.register(SYSTEM_ID, S.starshipEnergyAbbr, {
    name: "Sigla da Energia de Naves",
    hint: "Forma curta do rótulo de energia, usada nas tabelas da ficha de Nave (onde o nome completo se repetiria em toda linha e comeria a largura útil). O nome completo continua nos títulos e no chat.",
    scope: "world",
    config: true,
    type: String,
    default: "EPS"
  });

  game.settings.register(SYSTEM_ID, S.attributePointsStarting, {
    name: "Pontos de Atributo — Criação (Nível 1)",
    hint: "Quantos pontos o jogador tem pra distribuir entre os 7 atributos ao criar o personagem.",
    scope: "world",
    config: true,
    type: Number,
    default: 35
  });

  game.settings.register(SYSTEM_ID, S.attributePointsPerLevel, {
    name: "Pontos de Atributo — Por Nível",
    hint: "Quantos pontos de atributo adicionais o personagem ganha a cada nível acima do 1.",
    scope: "world",
    config: true,
    type: Number,
    default: 5
  });

  game.settings.register(SYSTEM_ID, S.skillPointsStarting, {
    name: "Pontos de Habilidade Normais — Criação (Nível 1)",
    hint: "Quantos Pontos de Habilidade Normais o personagem começa tendo no nível 1.",
    scope: "world",
    config: true,
    type: Number,
    default: 3
  });

  game.settings.register(SYSTEM_ID, S.skillPointsPerLevel, {
    name: "Pontos de Habilidade Normais — Por Nível",
    hint: "Quantos Pontos de Habilidade Normais o personagem ganha a cada nível acima do 1.",
    scope: "world",
    config: true,
    type: Number,
    default: 2
  });

  // Armazenamento cru (sem UI própria na lista de settings): editados pelos
  // FormApplications dedicados registrados como Settings Menu em nihility-rpg-system.js.
  game.settings.register(SYSTEM_ID, S.currenciesData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(MEU_SISTEMA.DEFAULT_CURRENCIES, null, 2)
  });

  game.settings.register(SYSTEM_ID, S.speciesPresetsData, {
    scope: "world",
    config: false,
    type: String,
    default: "{}"
  });

  game.settings.register(SYSTEM_ID, S.damageElementsData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS, null, 2)
  });

  game.settings.register(SYSTEM_ID, S.statusConditionsData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS, null, 2)
  });

  // Chaves das migrações únicas (ver runMigrationIfNeeded em nihility-rpg-system.js) já
  // executadas com sucesso neste mundo — sem isso, cada migração reescanearia todos os
  // Atores/Compêndios em TODO hook `ready`, pra sempre, mesmo anos depois de já ter rodado.
  game.settings.register(SYSTEM_ID, S.completedMigrations, {
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  // scope "client" (não "world"): cada pessoa liga o próprio log de debug sem forçar isso nos
  // jogadores conectados.
  game.settings.register(SYSTEM_ID, S.debugMode, {
    name: "Modo Debug (log no console)",
    hint: "Loga no console a cada render/ação de Sheets e Apps do sistema. Só pra investigar bug — deixa desligado no dia a dia.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  // scope:"client" (não "world"): fica só no navegador de quem configura, nunca
  // sincroniza pros outros clientes conectados. Como só o GM usa o Assistente de
  // IA, isso mantém a chave fora do alcance dos jogadores sem precisar de
  // nenhuma infraestrutura extra. Efeito colateral: precisa reconfigurar por
  // navegador/dispositivo se o GM trocar de máquina.
  game.settings.register(SYSTEM_ID, S.aiProvider, {
    name: "Provedor de IA",
    hint: "Fica salvo só neste navegador (não sincroniza com jogadores).",
    scope: "client",
    config: true,
    type: String,
    choices: {
      openai: "OpenAI-compatível (Chat Completions)",
      anthropic: "Anthropic (Claude)"
    },
    default: "openai"
  });

  game.settings.register(SYSTEM_ID, S.aiEndpointUrl, {
    name: "Endpoint de IA (só para provedor OpenAI-compatível)",
    hint: "URL do endpoint Chat Completions. Ignorado quando o Provedor é Anthropic.",
    scope: "client",
    config: true,
    type: String,
    default: "https://api.openai.com/v1/chat/completions"
  });

  game.settings.register(SYSTEM_ID, S.aiModel, {
    name: "Modelo de IA",
    hint: "Nome do modelo. Ex OpenAI-compatível: gpt-4o-mini, llama-3.1-70b. Ex Anthropic: claude-sonnet-4-5, claude-haiku-4-5.",
    scope: "client",
    config: true,
    type: String,
    default: "gpt-4o-mini"
  });

  game.settings.register(SYSTEM_ID, S.aiApiKey, {
    name: "Chave de API de IA",
    hint: "Chave do provedor escolhido acima. Fica salva só neste navegador (scope: client) — nunca sincroniza pros jogadores.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });
}
