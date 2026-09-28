/**
 * Namespace central de configuração do sistema.
 * Reunido em um único objeto para ser exposto em `game.nihility.config`
 * e consultado por Data Models, Sheets e o AI Helper.
 */
// damage-rules.js é puro e não importa nada: não há ciclo.
import { buildAffinityMatrix } from "./damage-rules.js";

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
    },
    movement: {
      setting: "movementEnabled",
      name: "Deslocamento por rodada",
      hint: "Em combate, o token só anda até o deslocamento do turno (base + Destreza). O que passa do limite aparece pontilhado na régua e o token para no último ponto que alcança. Fora de combate o movimento é livre.",
      // Desligado por padrão: ligar muda o comportamento dos tokens em combate, e mundos que já
      // existem não devem ganhar uma regra nova só por atualizar o sistema.
      default: false,
      // Campos numéricos/booleanos que moram sob o interruptor na tela "Módulos do Sistema".
      // A chave de cada um é também o nome da setting (world, config:false).
      options: {
        movementBase: { label: "Base (m)", hint: "Metros por rodada com Destreza 0.", type: "number", default: 6, min: 0 },
        movementStep: { label: "Passo de Destreza", hint: "Pontos de Destreza para ganhar +1 m.", type: "number", default: 10, min: 1 },
        movementCap: { label: "Teto (m)", hint: "Máximo alcançável só com Destreza permanente (pontos e Títulos). Destreza vinda de Skills passa por cima.", type: "number", default: 18, min: 0 },
        movementGmIgnores: { label: "Mestre ignora o limite", hint: "O Mestre move tokens sem gastar nem respeitar o deslocamento.", type: "boolean", default: true }
      }
    },
    inventory: {
      setting: "inventoryEnabled",
      name: "Inventário (slots, pilhas e contêineres)",
      hint: "Aba Inventário na ficha: cada pilha ocupa um slot (padrão 20 por pilha), Itens iguais arrastados somam na pilha, contêineres (mochila, bolsa) têm slots próprios e reduzem o peso. Slots e carga base vêm da Espécie; Força e Defesa aumentam a carga. Naves ganham o Porão (Módulos de carga). Passar do limite só avisa — o bloqueio de peso é o bloco abaixo.",
      default: true,
      options: {
        carryPerStrength: { label: "Carga por ponto de Força (kg)", hint: "Quanto cada ponto de Força (total) soma à carga.", type: "number", default: 1, min: 0 },
        carryPerDefense: { label: "Carga por ponto de Defesa (kg)", hint: "Quanto cada ponto de Defesa (total) soma à carga.", type: "number", default: 0.5, min: 0 }
      }
    },
    encumbrance: {
      setting: "encumbranceEnabled",
      parent: "inventory",
      name: "Peso limita o Deslocamento",
      hint: "Acima da carga, o personagem perde Deslocamento na mesma proporção do excesso (20% acima = −20%; o dobro = parado). No Porão da Nave, a carga pesa no Motor (menos Movimento e Evasão) — mais energia nos Motores compensa.",
      default: false
    },
    structures: {
      setting: "structuresEnabled",
      name: "Estruturas (manipulação do ambiente)",
      hint: "Skills que criam paredes e blocos no mapa (Parede de Pedra, Bloco de Gelo, Barreira de Mana), com forma escolhida ou desenhada à mão. As Estruturas bloqueiam movimento e visão como paredes de verdade. Catálogo em Configurações Gerais › Estruturas.",
      default: true
    },
    scale: {
      setting: "scaleEnabled",
      name: "Escala (Personagem × Nave)",
      hint: "Dano entre escalas diferentes (Pessoal, Veículo, Nave, Capital) é multiplicado ou dividido pelo fator a cada degrau: uma pistola faz quase nada numa Nave, um canhão de Nave vaporiza uma pessoa. As escalas e o Porte de cada uma ficam em Configurações Gerais › Escalas.",
      default: false,
      options: {
        scaleFactor: { label: "Fator por degrau", hint: "Quanto o dano muda a cada degrau de diferença (10 = ×10 / ÷10).", type: "number", default: 10, min: 1 }
      }
    },
    shipManeuver: {
      setting: "shipManeuverEnabled",
      name: "Movimento e Evasão de naves",
      hint: "Em combate, Nave/Veículo só anda as casas da rodada (Porte × Motor) e a Manobra vira Evasão: um percentual do dano dos tiros que ele evita antes do Escudo. Motor menor, throttle baixo ou falta de energia diminuem os dois.",
      default: false,
      options: {
        shipMoveMini: { label: "Movimento — Mini (casas)", hint: "Casas por rodada de uma nave Mini com o Motor do tamanho esperado a 100%.", type: "number", default: 8, min: 0, legacy: true },
        shipMovePequeno: { label: "Movimento — Pequeno (casas)", hint: "Casas por rodada de uma nave Pequeno com o Motor do tamanho esperado a 100%.", type: "number", default: 6, min: 0, legacy: true },
        shipMoveMedio: { label: "Movimento — Médio (casas)", hint: "Casas por rodada de uma nave Médio com o Motor do tamanho esperado a 100%.", type: "number", default: 5, min: 0, legacy: true },
        shipMoveGrande: { label: "Movimento — Grande (casas)", hint: "Casas por rodada de uma nave Grande com o Motor do tamanho esperado a 100%.", type: "number", default: 4, min: 0, legacy: true },
        shipMoveCapital: { label: "Movimento — Capital (casas)", hint: "Casas por rodada de uma nave Capital com o Motor do tamanho esperado a 100%.", type: "number", default: 3, min: 0, legacy: true },
        shipEvasionMini: { label: "Evasão — Mini (%)", hint: "Dano evitado por uma nave Mini com o Motor do tamanho esperado a 100%.", type: "number", default: 30, min: 0, legacy: true },
        shipEvasionPequeno: { label: "Evasão — Pequeno (%)", hint: "Dano evitado por uma nave Pequeno com o Motor do tamanho esperado a 100%.", type: "number", default: 22, min: 0, legacy: true },
        shipEvasionMedio: { label: "Evasão — Médio (%)", hint: "Dano evitado por uma nave Médio com o Motor do tamanho esperado a 100%.", type: "number", default: 15, min: 0, legacy: true },
        shipEvasionGrande: { label: "Evasão — Grande (%)", hint: "Dano evitado por uma nave Grande com o Motor do tamanho esperado a 100%.", type: "number", default: 8, min: 0, legacy: true },
        shipEvasionCapital: { label: "Evasão — Capital (%)", hint: "Dano evitado por uma nave Capital com o Motor do tamanho esperado a 100%.", type: "number", default: 3, min: 0, legacy: true },
        shipEvasionCap: { label: "Teto de Evasão (%)", hint: "Nenhuma nave evita mais que isso, nem com overclock.", type: "number", default: 40, min: 0 }
      }
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
      // Conteúdo que o preset carrega (substitui o catálogo): nome da(s) lista(s) de MEU_SISTEMA.
      content: { damageElementsData: ["DEFAULT_DAMAGE_ELEMENTS"] },
      hint: "Isekai/fantasia: Títulos, Anatomia, Fusão e Magia ligados; nada de Naves, Veículos ou PAD.",
      features: {
        economy: true, titles: true, anatomy: true, vessels: false, skillFusion: true,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: false, movement: true, shipManeuver: false, scale: false, structures: true
      }
    },
    scifi: {
      label: "Sci-Fi Arcano",
      content: {
        damageElementsData: ["SCIFI_DAMAGE_ELEMENTS", "DEFAULT_DAMAGE_ELEMENTS"],
        moduleCategoriesData: ["SCIFI_MODULE_CATEGORIES"]
      },
      hint: "Naves, Veículos e PAD ligados; Títulos e Fusão de Habilidades desligados (são convenções de isekai).",
      features: {
        economy: true, titles: false, anatomy: true, vessels: true, skillFusion: false,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: true, movement: true, shipManeuver: true, scale: true, structures: true
      }
    },
    misto: {
      label: "Misto (tudo ligado)",
      content: {
        damageElementsData: ["DEFAULT_DAMAGE_ELEMENTS", "SCIFI_DAMAGE_ELEMENTS"],
        moduleCategoriesData: ["SCIFI_MODULE_CATEGORIES"]
      },
      hint: "O sistema inteiro disponível — fantasia e sci-fi coexistindo na mesma campanha.",
      features: {
        economy: true, titles: true, anatomy: true, vessels: true, skillFusion: true,
        skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
        areaEffects: true, aiAssistant: true, pad: true, movement: true, shipManeuver: true, scale: true, structures: true
      }
    }
  },

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

  /** Estados possíveis de uma Parte do Corpo. */
  BODY_PART_STATUS: ["intact", "damaged", "destroyed"],

  BODY_PART_STATUS_LABELS: {
    intact: "Intacto",
    damaged: "Danificado",
    destroyed: "Destruído"
  },

  /**
   * Portes de Nave e de Veículo — listas próprias, editáveis (Configurações Gerais › Naves), do
   * menor pro maior (a ordem é a régua da faixa de Porte das Classes). Cada linha guarda os números
   * do Porte:
   * - `rank` (0-4): maior Porte de Módulo aceito (0 = Compacto … 4 = Colossal) e o Motor de
   *   referência da razão do Motor; também é a régua do Raio Trator.
   * - `weaponBudget`: espaço de Arma (cada Arma ocupa rank do Porte dela + 1).
   * - `distributorBaseline`: teto do Distribuidor com Fator 1 (EPS/rodada).
   * - `conduitCapacitor`: reserva dos conduítes do casco sem Bateria. Instalar uma Bateria
   *   SUBSTITUI esse valor, então fica abaixo de 125 (a menor Bateria, Compacta) — trocar nunca
   *   piora; o teste de regras trava isso nos padrões.
   * - `move` / `evasion`: casas por rodada e Evasão (%) base, com o Motor do tamanho esperado.
   * - `massReference` (kg): carga do porão que corta o desempenho do Motor pela metade.
   * Os ids mini/pequeno/medio/grande/capital são os de sempre (Naves salvas não mudam); Veículo
   * mantém mini/pequeno com os mesmos números de antes e ganha Médio, Grande e Colossal.
   */
  DEFAULT_SHIP_SIZES: [
    { id: "mini", label: "Mini", rank: 0, weaponBudget: 1, distributorBaseline: 80, conduitCapacitor: 10, move: 8, evasion: 30, massReference: 2000 },
    { id: "pequeno", label: "Pequeno", rank: 1, weaponBudget: 2, distributorBaseline: 160, conduitCapacitor: 20, move: 6, evasion: 22, massReference: 8000 },
    { id: "medio", label: "Médio", rank: 2, weaponBudget: 4, distributorBaseline: 320, conduitCapacitor: 40, move: 5, evasion: 15, massReference: 30000 },
    { id: "grande", label: "Grande", rank: 3, weaponBudget: 8, distributorBaseline: 640, conduitCapacitor: 80, move: 4, evasion: 8, massReference: 120000 },
    { id: "capital", label: "Capital", rank: 4, weaponBudget: 16, distributorBaseline: 1280, conduitCapacitor: 120, move: 3, evasion: 3, massReference: 500000 }
  ],

  DEFAULT_VEHICLE_SIZES: [
    { id: "mini", label: "Mini", rank: 0, weaponBudget: 1, distributorBaseline: 80, conduitCapacitor: 10, move: 8, evasion: 30, massReference: 200 },
    { id: "pequeno", label: "Pequeno", rank: 1, weaponBudget: 2, distributorBaseline: 160, conduitCapacitor: 20, move: 6, evasion: 22, massReference: 1000 },
    { id: "medio", label: "Médio", rank: 2, weaponBudget: 4, distributorBaseline: 320, conduitCapacitor: 40, move: 5, evasion: 15, massReference: 4000 },
    { id: "grande", label: "Grande", rank: 3, weaponBudget: 8, distributorBaseline: 640, conduitCapacitor: 80, move: 4, evasion: 8, massReference: 15000 },
    { id: "colossal", label: "Colossal", rank: 4, weaponBudget: 16, distributorBaseline: 1280, conduitCapacitor: 120, move: 3, evasion: 3, massReference: 60000 }
  ],

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

  /**
   * FUNÇÕES MECÂNICAS de Módulo — o que o código de fato entende. As Categorias (catálogo
   * editável, `moduleCategoriesData`) são nomes livres que apontam pra uma Função: "Motor de
   * Impulso" e "Manobradores" são as duas Propulsão; "Núcleo de Dobra" e "Contêiner da
   * Protoestrela" as duas Geração de Energia. Como várias da mesma Função se combinam é da
   * Função, não da Categoria (senão duas Categorias de Propulsão com regras diferentes brigariam):
   *  - sum: somam (Geração, Armazenamento, Escudo, Propulsão, Blindagem);
   *  - independent: cada uma é usada por si (FTL — dobra, transdobra —, Arma);
   *  - single: só uma ativa (Distribuição; somar dois dobraria o teto de transferência);
   *  - none: sem mecânica (Utilidade/Narrativo — Comunicações, Defletor… só Vida, consumo e
   *    Habilidade Concedida).
   * `presetKey` aponta pra linha de MODULE_SIZE_PRESETS (indexada pelos ids antigos).
   */
  MODULE_ROLES: {
    power: { label: "Geração de Energia", combine: "sum", presetKey: "reactor", overload: 100 },
    storage: { label: "Armazenamento", combine: "sum", presetKey: "battery", overload: null },
    distribution: { label: "Distribuição", combine: "single", presetKey: "distributor", overload: null },
    shield: { label: "Escudo", combine: "sum", presetKey: "shield", overload: 500 },
    propulsion: { label: "Propulsão", combine: "sum", presetKey: "engine", overload: 200 },
    ftl: { label: "FTL", combine: "independent", presetKey: "ftl", overload: 200 },
    armor: { label: "Blindagem", combine: "sum", presetKey: "armor", overload: 200 },
    weapon: { label: "Arma", combine: "independent", presetKey: "weapon", overload: null },
    utility: { label: "Utilidade/Narrativo", combine: "none", presetKey: "utility", overload: 200 },
    // Raio trator: prende outra Nave (deslocamento dela cai conforme a diferença de Porte).
    tractor: { label: "Raio Trator", combine: "independent", presetKey: "tractor", overload: 200 },
    // Porão: slots de carga da Nave (dobram por Porte, × o multiplicador do Módulo).
    cargo: { label: "Porão de Carga", combine: "sum", presetKey: "cargo", overload: null }
  },

  /**
   * Catálogo padrão de Categorias — as 9 de sempre, com os MESMOS ids, então Naves salvas antes
   * das Categorias personalizáveis continuam funcionando sem migração. `slots`: quantas cabem por
   * padrão (a Classe pode mudar); 0 = sem limite de contagem (Arma usa o orçamento de espaço).
   */
  DEFAULT_MODULE_CATEGORIES: [
    { id: "reactor", label: "Reator", role: "power", slots: 1 },
    { id: "battery", label: "Bateria", role: "storage", slots: 1 },
    { id: "distributor", label: "Distribuidor", role: "distribution", slots: 1 },
    { id: "shield", label: "Escudo", role: "shield", slots: 1 },
    { id: "engine", label: "Motor", role: "propulsion", slots: 1 },
    { id: "armor", label: "Casco (Armadura)", role: "armor", slots: 1 },
    { id: "ftl", label: "FTL", role: "ftl", slots: 1 },
    { id: "weapon", label: "Arma", role: "weapon", slots: 0 },
    { id: "utility", label: "Utilidade", role: "utility", slots: 0 },
    { id: "tractor", label: "Raio Trator", role: "tractor", slots: 0 },
    { id: "cargo", label: "Porão", role: "cargo", slots: 0 }
  ],

  /** Categorias estilo Star Trek — carregadas pelo preset Sci-Fi (impulso + manobradores, dobra…). */
  SCIFI_MODULE_CATEGORIES: [
    { id: "reactor", label: "Núcleo de Dobra", role: "power", slots: 1 },
    { id: "battery", label: "Bancos de Energia", role: "storage", slots: 1 },
    { id: "distributor", label: "Rede EPS", role: "distribution", slots: 1 },
    { id: "shield", label: "Escudos Defletores", role: "shield", slots: 1 },
    { id: "engine", label: "Motor de Impulso", role: "propulsion", slots: 1 },
    { id: "thrusters", label: "Manobradores (RCS)", role: "propulsion", slots: 1 },
    { id: "armor", label: "Blindagem Ablativa", role: "armor", slots: 1 },
    { id: "ftl", label: "Motor de Dobra", role: "ftl", slots: 1 },
    { id: "transwarp", label: "Transdobra", role: "ftl", slots: 0 },
    { id: "weapon", label: "Arma", role: "weapon", slots: 0 },
    { id: "utility", label: "Utilidade", role: "utility", slots: 0 },
    { id: "tractor", label: "Emissor de Raio Trator", role: "tractor", slots: 0 },
    { id: "cargo", label: "Compartimento de Carga", role: "cargo", slots: 0 }
  ],

  /**
   * Classes de Nave (Porte = tamanho, Classe = papel). Multiplicadores sobre o que o Porte dá e
   * vagas por Categoria (`slots`: {categoriaId: n}, sobrescreve o padrão da Categoria). "Parrudo"
   * vem de mais vagas de Blindagem/Escudo. `maxWeaponSize`: id de MODULE_SIZES ("" = sem limite).
   */
  DEFAULT_SHIP_CLASSES: [
    { id: "explorer", label: "Exploradora", description: "Equilibrada.", evasionMultiplier: 1, movementMultiplier: 1, weaponBudgetMultiplier: 1, maxWeaponSize: "", slots: {} },
    { id: "battleship", label: "Encouraçado", description: "Blindagem e escudos dobrados, lento e fácil de acertar.", evasionMultiplier: 0.6, movementMultiplier: 0.75, weaponBudgetMultiplier: 1.5, maxWeaponSize: "", slots: { armor: 2, shield: 2 }, shieldPenResist: 5, cascoPenResist: 10, hardening: 10 },
    { id: "cruiser", label: "Cruzador", description: "Mais armas que o normal para o Porte.", evasionMultiplier: 0.9, movementMultiplier: 1, weaponBudgetMultiplier: 1.5, maxWeaponSize: "", slots: {} },
    { id: "freighter", label: "Cargueiro", description: "Pouca arma, mais espaço de Utilidade.", evasionMultiplier: 0.8, movementMultiplier: 0.9, weaponBudgetMultiplier: 0.25, maxWeaponSize: "standard", slots: {} },
    { id: "interceptor", label: "Interceptador", description: "Rápido e difícil de acertar, frágil.", evasionMultiplier: 1.4, movementMultiplier: 1.3, weaponBudgetMultiplier: 0.75, maxWeaponSize: "", slots: {} }
  ],

  DEFAULT_VEHICLE_CLASSES: [
    { id: "car", label: "Carro", description: "Leve e rápido.", evasionMultiplier: 1.2, movementMultiplier: 1.2, weaponBudgetMultiplier: 0.5, maxWeaponSize: "compact", slots: {} },
    { id: "tank", label: "Tanque", description: "Blindagem dobrada, lento, armado.", evasionMultiplier: 0.5, movementMultiplier: 0.6, weaponBudgetMultiplier: 2, maxWeaponSize: "", slots: { armor: 2 }, cascoPenResist: 15, hardening: 10 },
    { id: "bike", label: "Moto", description: "Muito rápida, quase sem proteção.", evasionMultiplier: 1.6, movementMultiplier: 1.5, weaponBudgetMultiplier: 0.5, maxWeaponSize: "compact", slots: {} }
  ],

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
  /**
   * Slots e carga base por Espécie padrão — o que ela carregaria no corpo, sem mochila (os
   * contêineres somam por cima). O editor de Espécies sobrescreve.
   */
  SPECIES_CARRY_DEFAULTS: {
    humano: { slots: 10, carry: 30 },
    elfo: { slots: 10, carry: 25 },
    anao: { slots: 12, carry: 45 },
    orc: { slots: 12, carry: 50 },
    goblin: { slots: 8, carry: 15 },
    halfling: { slots: 8, carry: 15 },
    slime: { slots: 6, carry: 20 },
    dragoide: { slots: 12, carry: 60 },
    ogro: { slots: 14, carry: 90 },
    lobo_tempestade: { slots: 3, carry: 20 },
    harpia: { slots: 6, carry: 10 },
    ciborgue: { slots: 12, carry: 60 },
    androide: { slots: 12, carry: 50 },
    mutante: { slots: 10, carry: 40 },
    simbionte: { slots: 10, carry: 35 },
    cavalo: { slots: 4, carry: 100 },
    lobo_gigante: { slots: 4, carry: 60 },
    grifo: { slots: 4, carry: 80 },
    inseto_de_carga: { slots: 8, carry: 150 }
  },
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

  DEFAULT_CREW_ROLES: [
    { id: "captain", label: "Capitão" },
    { id: "pilot", label: "Piloto" },
    { id: "engineer", label: "Engenheiro" },
    { id: "tactical", label: "Tático" },
    { id: "science", label: "Ciências" },
    { id: "medic", label: "Médico" }
  ],

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
    tractor: {
      compact: { powerConsumption: 20 },
      standard: { powerConsumption: 40 },
      reinforced: { powerConsumption: 80 },
      industrial: { powerConsumption: 160 },
      colossal: { powerConsumption: 320 }
    },
    cargo: {
      compact: { powerConsumption: 0 },
      standard: { powerConsumption: 0 },
      reinforced: { powerConsumption: 0 },
      industrial: { powerConsumption: 0 },
      colossal: { powerConsumption: 0 }
    },
    shield: {
      compact: { powerConsumption: 30, shieldCapacity: 100, shieldRegen: 10, shieldRechargeRounds: 3, penetrationResist: 5 },
      standard: { powerConsumption: 60, shieldCapacity: 200, shieldRegen: 20, shieldRechargeRounds: 3, penetrationResist: 10 },
      reinforced: { powerConsumption: 120, shieldCapacity: 400, shieldRegen: 40, shieldRechargeRounds: 4, penetrationResist: 15 },
      industrial: { powerConsumption: 240, shieldCapacity: 800, shieldRegen: 80, shieldRechargeRounds: 4, penetrationResist: 20 },
      colossal: { powerConsumption: 480, shieldCapacity: 1600, shieldRegen: 160, shieldRechargeRounds: 5, penetrationResist: 25 }
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
      compact: { armorReduction: 10, penetrationResist: 10 },
      standard: { armorReduction: 20, penetrationResist: 15 },
      reinforced: { armorReduction: 30, penetrationResist: 20 },
      industrial: { armorReduction: 45, penetrationResist: 25 },
      colossal: { armorReduction: 60, penetrationResist: 30 }
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
    "shipDamageReduction"
  ],

  EFFECT_TARGET_LABELS: {
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
    { label: "Vitais", actor: "character", targets: ["hp", "energy", "shield", "movement"] },
    { label: "Arma", actor: "any", targets: ["weaponDamage", "weaponElement", "weaponMagic", "weaponAbsolute"] },
    { label: "Elemento", actor: "any", targets: ["bodyElement"] },
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

  /** Tipos de dano elemental padrão, sobrescritos pela setting `damageElementsData` (editor visual). */
  DEFAULT_DAMAGE_ELEMENTS: [
    { id: "physical", label: "Físico", color: "#9aa1c2", group: "Físico", effects: [] },
    // `affinity`: vantagem contra outros elementos (−2 Imune … 2 Super efetivo) — ver a tabela no editor.
    { id: "fire", label: "Fogo", color: "#ff7043", group: "Fantasia", effects: [{ type: "condition", conditionId: "burn", chance: 25 }], affinity: { ice: 1 } },
    { id: "ice", label: "Gelo", color: "#6ee7ff", group: "Fantasia", effects: [{ type: "condition", conditionId: "slow", chance: 25 }], affinity: { fire: -1 } },
    { id: "lightning", label: "Elétrico", color: "#ffe066", group: "Fantasia", effects: [] },
    { id: "acid", label: "Ácido", color: "#8bc34a", group: "Fantasia", effects: [] },
    { id: "dark", label: "Sombrio", color: "#7b5ea7", group: "Fantasia", effects: [], affinity: { holy: 1 } },
    { id: "holy", label: "Sagrado", color: "#e8c170", group: "Fantasia", effects: [], affinity: { dark: 1 } }
  ],

  /**
   * Tipos de Efeito ao acertar que um Elemento pode ter (tela Tipos de Dano). O código entende
   * só estes tipos; os números ficam com o Mestre.
   *  - condition: aplica uma Condição (com chance %), usando o efeito padrão dela;
   *  - traitBonus: +X% de dano se o alvo tiver o Traço;
   *  - shieldDrain: +X% de dano só contra Escudo (camada de Escudo da Nave ou Escudo pessoal);
   *  - penetration: ignora X% das defesas do alvo (nunca atravessa Imunidade).
   */
  ELEMENT_EFFECT_TYPES: ["condition", "traitBonus", "layer", "shieldDrain", "penetration", "moduleDisable", "energyDrain", "resistanceDown"],
  /** Níveis da tabela de vantagens entre elementos (clique esquerdo sobe, direito desce). */
  AFFINITY_LEVEL_LABELS: { "-2": "Imune", "-1": "Ineficaz", 0: "Neutro", 1: "Efetivo", 2: "Super efetivo" },
  ELEMENT_EFFECT_TYPE_LABELS: {
    condition: "Aplicar Condição",
    traitBonus: "Dano extra contra Traço",
    layer: "Dano por camada (Escudo, Casco, Integridade)",
    shieldDrain: "Dano extra em Escudo (antigo: use Dano por camada)",
    penetration: "Penetração",
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

  /** Elementos de energia estilo Star Trek Online — carregados pelo preset Sci-Fi. */
  SCIFI_DAMAGE_ELEMENTS: [
    // Cinético/torpedo: fraco contra Escudo, forte contra Casco (Elite e Star Trek Online).
    { id: "kinetic", label: "Cinético", color: "#b0b7d6", group: "Físico", effects: [
      { type: "layer", layer: "shield", percent: -50 }, { type: "layer", layer: "casco", percent: 30 }, { type: "layer", layer: "hull", percent: 10 }
    ] },
    // Phaser: bom no Escudo, fraco no Casco; chance de derrubar um sistema.
    { id: "phaser", label: "Phaser", color: "#ff9f43", group: "Energia", effects: [
      { type: "layer", layer: "shield", percent: 20 }, { type: "layer", layer: "casco", percent: -20 }, { type: "moduleDisable", chance: 10, rounds: 2 }
    ] },
    // Disruptor: atravessa um pouco e amolece as defesas do alvo.
    { id: "disruptor", label: "Disruptor", color: "#6ee7a0", group: "Energia", effects: [
      { type: "penetration", percent: 10 }, { type: "resistanceDown", chance: 20, percent: 10, rounds: 2 }
    ] },
    // Plasma: queima (dano contínuo) e morde o Casco.
    { id: "plasma", label: "Plasma", color: "#7bed9f", group: "Energia", effects: [
      { type: "condition", conditionId: "burn", chance: 25 }, { type: "layer", layer: "casco", percent: 15 }
    ] },
    // Pólaron: forte contra orgânicos e drena a energia do alvo.
    { id: "polaron", label: "Pólaron", color: "#a29bfe", group: "Energia", effects: [
      { type: "traitBonus", trait: "organic", percent: 20 }, { type: "energyDrain", chance: 20, percent: 15, rounds: 2 }
    ] },
    { id: "tetryon", label: "Táquion", color: "#74b9ff", group: "Energia", effects: [{ type: "layer", layer: "shield", percent: 30 }] },
    { id: "antiproton", label: "Antiprótons", color: "#fd79a8", group: "Energia", effects: [{ type: "layer", layer: "hull", percent: 15 }] },
    { id: "transphasic", label: "Transfásico", color: "#e8c170", group: "Exótico", effects: [{ type: "penetration", percent: 40 }] }
  ],

  /**
   * Traços (Dracônico, Voador, Orgânico…): etiquetas que uma Espécie dá a quem a tem, e que a
   * ficha pode acrescentar ou retirar. Usados por Elementos ("+X% contra Orgânico") e, depois,
   * pelos Modificadores Condicionais ("Caçador de Dragões"). Sobrescritos pela setting `traitsData`.
   */
  DEFAULT_TRAITS: [
    { id: "organic", label: "Orgânico" },
    { id: "mechanical", label: "Mecânico" },
    { id: "draconic", label: "Dracônico" },
    { id: "flying", label: "Voador" },
    { id: "wingless", label: "Sem Asas" },
    { id: "undead", label: "Morto-vivo" },
    { id: "beast", label: "Besta" }
  ],

  /**
   * Escala (Pessoal → Veículo → Nave → Capital): dano entre escalas diferentes é multiplicado ou
   * dividido pelo fator a cada degrau (ver `scaleMultiplier` em damage-rules.js). A ordem da
   * lista É a ordem dos degraus. Porte de Nave/Veículo aponta pra uma escala.
   */
  DEFAULT_SCALES: {
    scales: [
      { id: "personal", label: "Pessoal" },
      { id: "vehicle", label: "Veículo" },
      { id: "ship", label: "Nave" },
      { id: "capital", label: "Capital" }
    ],
    shipSizeMap: { mini: "vehicle", pequeno: "vehicle", medio: "ship", grande: "ship", capital: "capital" },
    vehicleSizeMap: { mini: "vehicle", pequeno: "vehicle", medio: "vehicle", grande: "vehicle", colossal: "vehicle" }
  },

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
    // Selo antimagia: toda magia de quem tem o selo paga Mana extra (ver antimagicSurcharge).
    { id: "antimagic-seal", label: "Selo Antimagia", icon: "icons/svg/padlock.svg", antimagicLevel: 1 },
    { id: "poison", label: "Veneno", icon: "icons/svg/poison.svg",
      effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
    { id: "burn", label: "Queimadura", icon: "icons/svg/fire.svg",
      effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 10, durationRounds: 2, tickUnit: "combatRound" } },
    { id: "slow", label: "Lentidão", icon: "icons/svg/frozen.svg",
      effect: { kind: "modifier", modTarget: "movement", modMode: "percent", value: -50, durationRounds: 2 } },
    { id: "stun", label: "Atordoamento", icon: "icons/svg/daze.svg" },
    { id: "silence", label: "Silêncio", icon: "icons/svg/silenced.svg" },
    { id: "paralysis", label: "Paralisia", icon: "icons/svg/paralysis.svg" },
    { id: "fear", label: "Medo", icon: "icons/svg/terror.svg" },
    { id: "bleeding", label: "Sangramento", icon: "icons/svg/blood.svg",
      effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
    { id: "regeneration", label: "Regeneração", icon: "icons/svg/regen.svg",
      effect: { kind: "tick", tickTarget: "hp", tickSign: "heal", valueMode: "maxPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } }
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic", "draconic", "wingless"],
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
      traits: ["organic"],
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
      traits: ["organic", "beast"],
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
      traits: ["organic", "flying"],
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
      traits: ["organic", "mechanical"],
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
      traits: ["mechanical"],
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
      traits: ["organic"],
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
      traits: ["organic"],
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
      traits: ["organic", "beast"],
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
      traits: ["organic", "beast"],
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
      traits: ["organic", "beast", "flying"],
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
      traits: ["organic", "beast"],
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
  let list = MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS;
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageElementsData);
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

/** Tabela de vantagens `{atacante: {defensor: nível}}` do catálogo ativo. */
export function getElementAffinityMatrix() {
  return buildAffinityMatrix(getActiveDamageElements());
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

/**
 * Elementos que um Ator É agora (pra vantagem entre elementos): os da Espécie, os dos efeitos
 * "Elemento do corpo" de Skill (flag `bodyElement`) e os das Condições ativas que têm elemento.
 */
export function actorElements(actor) {
  if (!actor) return [];
  const out = new Set();
  const preset = actor.type === "character" ? getActiveSpeciesPresets()?.[actor.system?.species] : null;
  for (const id of preset?.elements ?? []) out.add(id);
  const conditions = getActiveStatusConditions().filter(c => Array.isArray(c.elements) && c.elements.length);
  for (const effect of actor.effects ?? []) {
    if (effect.disabled) continue;
    const flagged = effect.flags?.[SYSTEM_ID]?.bodyElement;
    if (flagged) out.add(flagged);
    for (const status of effect.statuses ?? []) {
      for (const id of conditions.find(c => c.id === status)?.elements ?? []) out.add(id);
    }
  }
  return [...out].filter(Boolean);
}

/** Um elemento pelo id, já normalizado (ver `getActiveDamageElements`). */
export function getDamageElement(id) {
  return getActiveDamageElements().find(el => el.id === id) ?? null;
}

/** Catálogo de Traços (setting > padrão). */
export function getActiveTraits() {
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.traitsData);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed.filter(t => t?.id);
  } catch (err) {
    /* setting ausente/inválida — cai no padrão */
  }
  return MEU_SISTEMA.DEFAULT_TRAITS;
}

/** Rótulo de um Traço (cai no id se o Traço sumiu do catálogo). */
export function getTraitLabel(id) {
  return getActiveTraits().find(t => t.id === id)?.label ?? id;
}

/**
 * Traços efetivos de um Ator: os da Espécie, mais os acrescentados na ficha, menos os retirados
 * na ficha. Nave/Veículo só têm os da ficha. Pura sobre os dados que recebe.
 * @param {{species?:string, traits?:string[], traitsRemoved?:string[]}} system
 * @param {Record<string, {traits?:string[]}>} speciesPresets
 * @returns {string[]}
 */
export function resolveActorTraits(system, speciesPresets = {}) {
  const fromSpecies = speciesPresets?.[system?.species]?.traits ?? [];
  const removed = new Set(system?.traitsRemoved ?? []);
  return [...new Set([...fromSpecies, ...(system?.traits ?? [])])].filter(t => !removed.has(t));
}

/** `resolveActorTraits` para um Ator de verdade. */
export function actorTraits(actor) {
  return resolveActorTraits(actor?.system, getActiveSpeciesPresets());
}

/** Configuração de Escala (setting > padrão), sempre com as três chaves. */
export function getScaleConfig() {
  let saved = null;
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.scalesData);
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
}

/**
 * Índice de Escala de um Ator: Personagem usa `system.scale` (vazio = a primeira, Pessoal);
 * Nave/Veículo seguem o Porte. Escala desconhecida cai no 0.
 */
export function actorScaleIndex(actor) {
  const config = getScaleConfig();
  let id = "";
  if (actor?.type === "starship") id = config.shipSizeMap[actor.system?.shipSize];
  else if (actor?.type === "vehicle") id = config.vehicleSizeMap[actor.system?.shipSize];
  else id = actor?.system?.scale;
  const index = config.scales.findIndex(s => s.id === id);
  return index >= 0 ? index : 0;
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

/** Lê uma lista JSON de uma setting; cai no padrão se vazia/inválida/ausente. */
function readCatalog(settingKey, fallback) {
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingKey]);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length) return parsed.filter(e => e?.id);
  } catch (err) {
    /* setting ausente/inválida — cai no padrão */
  }
  return fallback;
}

/** Catálogo de Categorias de Módulo (setting > padrão), com Função válida em toda entrada. */
export function getModuleCategories() {
  return readCatalog("moduleCategoriesData", MEU_SISTEMA.DEFAULT_MODULE_CATEGORIES).map(c => ({
    ...c,
    label: c.label || c.id,
    role: MEU_SISTEMA.MODULE_ROLES[c.role] ? c.role : "utility",
    slots: Math.max(0, Math.round(Number(c.slots) || 0))
  }));
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

export function isInventoryEnabled() {
  return isFeatureEnabled("inventory");
}

export function isEncumbranceEnabled() {
  return isFeatureEnabled("encumbrance");
}

/** Slots e carga base (kg) de uma Espécie: os campos do preset, senão a tabela padrão. Pura. */
export function speciesCarry(preset, speciesKey) {
  const fallback = MEU_SISTEMA.SPECIES_CARRY_DEFAULTS[speciesKey] ?? MEU_SISTEMA.DEFAULT_CARRY;
  const read = (value, fb) => {
    if (value === undefined || value === null || value === "") return fb;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  return { slots: Math.round(read(preset?.inventorySlots, fallback.slots)), carry: read(preset?.carryBase, fallback.carry) };
}

/** Quantos slots uma quantidade ocupa em pilhas de `stackSize` (0 itens = 0 slots). Pura. */
export function stackCount(quantity, stackSize) {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!q) return 0;
  const size = Math.max(1, Math.floor(Number(stackSize) || MEU_SISTEMA.ITEM_STACK_DEFAULT));
  return Math.ceil(q / size);
}

/**
 * Carga de um inventário. `entries`: Itens ({id, quantity, stackSize, weight, containerId,
 * isContainer}); `containers`: contêineres disponíveis ({id, slots, unlimited, weightReduction}),
 * de Item ou de Skill. Um contêiner ocupa sempre 1 slot de quem o carrega; o que está dentro
 * ocupa os slots dele e pesa menos pela redução. Id de contêiner que não existe = solto. Pura.
 * @returns {{looseSlots: number, weight: number, byContainer: Object<string, {used: number, slots: number, unlimited: boolean}>}}
 */
export function inventoryLoad(entries, containers = []) {
  const byId = new Map((containers ?? []).map(c => [c.id, c]));
  const byContainer = {};
  for (const c of containers ?? []) byContainer[c.id] = { used: 0, slots: Math.max(0, Number(c.slots) || 0), unlimited: Boolean(c.unlimited) };
  let looseSlots = 0;
  let weight = 0;
  for (const e of entries ?? []) {
    const slots = e.isContainer ? 1 : stackCount(e.quantity, e.stackSize);
    const ownWeight = Math.max(0, Number(e.weight) || 0) * Math.max(0, Number(e.quantity) || 0);
    const holder = e.containerId && e.containerId !== e.id ? byId.get(e.containerId) : null;
    if (holder) {
      byContainer[holder.id].used += slots;
      weight += ownWeight * (1 - Math.min(100, Math.max(0, Number(holder.weightReduction) || 0)) / 100);
    } else {
      looseSlots += slots;
      weight += ownWeight;
    }
  }
  return { looseSlots, weight: Math.round(weight * 100) / 100, byContainer };
}

/** Peso das moedas (quantidade × peso de cada moeda do catálogo). Pura. */
export function currencyWeight(balances, catalog) {
  return (catalog ?? []).reduce((sum, c) => sum + (Number(balances?.[c.id]) || 0) * (Number(c.weight) || 0), 0);
}

/** Carga máxima: base da Espécie + Força × a + Defesa × b + bônus do Mestre (nunca negativa). Pura. */
export function carryCapacity({ base = 0, strength = 0, defense = 0, bonus = 0 } = {}, { perStrength = 1, perDefense = 0.5 } = {}) {
  return Math.max(0, Math.round(((Number(base) || 0) + (Number(strength) || 0) * perStrength + (Number(defense) || 0) * perDefense + (Number(bonus) || 0)) * 100) / 100);
}

/** −% de Deslocamento pelo excesso de peso: 20% acima = 20; o dobro ou mais = 100. Pura. */
export function encumbrancePenalty(weight, capacity) {
  const w = Math.max(0, Number(weight) || 0);
  const cap = Math.max(0, Number(capacity) || 0);
  if (w <= cap) return 0;
  if (!cap) return 100;
  return Math.min(100, Math.round((w / cap - 1) * 100));
}

/** Slots de um Módulo de Porão: tabela do Porte × multiplicador do Módulo. Pura. */
export function cargoSlotsFor(moduleSize, multiplier = 1) {
  return Math.floor((MEU_SISTEMA.CARGO_SLOTS_BY_MODULE_SIZE[moduleSize] ?? 0) * Math.max(0, Number(multiplier ?? 1) || 0));
}

/** Fator de massa da carga no Motor: 1 + peso ÷ carga de referência do Porte. Pura. */
export function cargoMassFactor(weight, reference) {
  const ref = Number(reference) || 0;
  return ref > 0 ? 1 + Math.max(0, Number(weight) || 0) / ref : 1;
}

/** Catálogo de Tipos de Munição. */
export function getAmmoTypes() {
  return readCatalog("ammoTypesData", MEU_SISTEMA.DEFAULT_AMMO_TYPES).map(a => ({ ...a, label: a.label || a.id }));
}

/**
 * A Munição (`item.system.ammo`) serve neste lançador (`module.system`)? Mesmo tipo, lançador que
 * usa munição e Porte mínimo atendido. Pura.
 */
export function ammoFitsLauncher(ammo, launcher) {
  if (!ammo?.enabled || !launcher?.usesAmmo || !ammo.type) return false;
  if (!(launcher.ammoTypes ?? []).includes(ammo.type)) return false;
  if (!ammo.minLauncherSize) return true;
  return (MEU_SISTEMA.MODULE_SIZE_RANK[launcher.moduleSize] ?? 0) >= (MEU_SISTEMA.MODULE_SIZE_RANK[ammo.minLauncherSize] ?? 0);
}

/** Catálogo de Classes: `"ship"` (Nave) ou `"vehicle"` (Veículo). */
export function getVesselClasses(kind) {
  const list = kind === "vehicle"
    ? readCatalog("vehicleClassesData", MEU_SISTEMA.DEFAULT_VEHICLE_CLASSES)
    : readCatalog("shipClassesData", MEU_SISTEMA.DEFAULT_SHIP_CLASSES);
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

/** "ship" (Nave) ou "vehicle" (Veículo) para um Ator, um tipo de Ator ou o próprio kind. */
export function vesselKind(actorOrType) {
  const type = typeof actorOrType === "string" ? actorOrType : actorOrType?.type;
  return type === "vehicle" ? "vehicle" : "ship";
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

/**
 * O Porte `sizeId` cabe na faixa da Classe? `sizes` = a lista de Portes do tipo, em ordem.
 * Porte ou limite que não está na lista não restringe nada. Pura.
 */
export function sizeFitsClass(sizeId, vesselClass, sizes) {
  if (!vesselClass) return true;
  const ids = (sizes ?? []).map(s => s.id);
  const index = ids.indexOf(sizeId);
  if (index < 0) return true;
  const min = vesselClass.minSize ? ids.indexOf(vesselClass.minSize) : -1;
  const max = vesselClass.maxSize ? ids.indexOf(vesselClass.maxSize) : -1;
  if (min >= 0 && index < min) return false;
  if (max >= 0 && index > max) return false;
  return true;
}

/** "até Pequeno", "a partir de Grande", "de Médio a Grande" ou "" (sem limite). Pura. */
export function describeClassSizeRange(vesselClass, sizes) {
  const label = id => (sizes ?? []).find(s => s.id === id)?.label ?? "";
  const min = vesselClass?.minSize ? label(vesselClass.minSize) : "";
  const max = vesselClass?.maxSize ? label(vesselClass.maxSize) : "";
  if (min && max) return min === max ? `só ${min}` : `de ${min} a ${max}`;
  if (max) return `até ${max}`;
  if (min) return `a partir de ${min}`;
  return "";
}

/**
 * Quantas vagas uma Categoria tem nesta Nave: a da Classe, se a Classe disser; senão a da
 * Categoria. Distribuição é sempre 1 (somar dois dobraria o teto). Pura.
 * @returns {number} 0 = sem limite de contagem
 */
export function categorySlotLimit(category, vesselClass) {
  if (!category) return 0;
  if (category.role === "distribution") return 1;
  const override = vesselClass?.slots?.[category.id];
  if (override !== undefined && override !== null && override !== "") return Math.max(0, Math.round(Number(override) || 0));
  return category.slots ?? 0;
}

/** Catálogo de Estruturas (setting > padrão), com números saneados. */
export function getStructures() {
  return readCatalog("structuresData", MEU_SISTEMA.DEFAULT_STRUCTURES).map(s => ({
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
  }));
}

/* ------------------------------------------------------------------ Antimagia */

/** Opções da marca "Mágica" de uma Skill. Automático = custa Mana (a energia do personagem). */
export const MAGIC_TAG_LABELS = { auto: "Automático", magic: "Sim", mundane: "Não" };

/**
 * A Skill/arma é mágica? Marca explícita manda; no Automático, é mágica quando custa a energia do
 * personagem (Custo ou Custo por rodada) ou tem Dano Mágico. Nave/Veículo nunca (paga com a
 * Bateria). Pura (só lê os campos).
 */
export function isMagicUse(mech, actor) {
  if (!mech) return false;
  if (mech.magicTag === "magic") return true;
  if (mech.magicTag === "mundane") return false;
  if (["starship", "vehicle"].includes(actor?.type)) return false;
  return (Number(mech.cost) || 0) > 0 || (Boolean(mech.hasUpkeep) && (Number(mech.upkeepCost) || 0) > 0) || Boolean(mech.isMagicDamage);
}

/**
 * Custo extra de uma magia sob antimagia de nível `level`: `(custo + base) × (crescimento^nível − 1)`,
 * arredondado pra cima. Nível 0 = 0. Com os padrões (base 10, ×2): uma magia de custo 20 paga +30
 * no nível 1, +90 no 2, +210 no 3. Pura.
 */
export function antimagicSurcharge(cost, level, { base = 10, growth = 2 } = {}) {
  const lvl = Math.max(0, Math.round(Number(level) || 0));
  if (!lvl) return 0;
  const g = Math.max(1, Number(growth) || 1);
  return Math.ceil((Math.max(0, Number(cost) || 0) + Math.max(0, Number(base) || 0)) * (g ** lvl - 1));
}

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

/** Nível do "Selo antimagia" que o próprio Ator carrega (a maior Condição ativa com antimagia). */
export function actorAntimagicLevel(actor) {
  const sealed = getActiveStatusConditions().filter(c => Number(c.antimagicLevel) > 0);
  if (!sealed.length || !actor?.effects) return 0;
  let level = 0;
  for (const effect of actor.effects) {
    if (effect.disabled) continue;
    for (const status of effect.statuses ?? []) {
      const condition = sealed.find(c => c.id === status);
      if (condition) level = Math.max(level, Number(condition.antimagicLevel) || 0);
    }
  }
  return level;
}

export function isStructuresEnabled() {
  return isFeatureEnabled("structures");
}

/**
 * Luz de uma Estrutura ou de um Escudo pessoal, como guardada no catálogo/Efeito: `null` quando
 * não emite luz. `dim`/`bright` em unidades da cena (0 = automático: quem usa decide o raio);
 * `alpha` é a intensidade da cor (0–1); `animation` é uma chave de CONFIG.Canvas.lightAnimations
 * ("" = sem animação), com velocidade e intensidade 1–10 como no editor de luz do Foundry.
 */
export function normalizeLightConfig(raw) {
  if (!raw || typeof raw !== "object" || !raw.enabled) return null;
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const dim = num(raw.dim, 0, 0, 1000);
  const bright = num(raw.bright, 0, 0, 1000);
  return {
    enabled: true,
    color: /^#[0-9a-f]{6}$/i.test(raw.color ?? "") ? raw.color : "#6ee7ff",
    alpha: num(raw.alpha, 0.5, 0, 1),
    dim,
    // Luz forte maior que a fraca não existe no Foundry (a fraca é o limite de fora).
    bright: dim > 0 ? Math.min(bright, dim) : bright,
    animation: typeof raw.animation === "string" ? raw.animation : "",
    speed: Math.round(num(raw.speed, 5, 1, 10)),
    intensity: Math.round(num(raw.intensity, 5, 1, 10))
  };
}

/**
 * Força de uma Skill que aceita variar a Mana, dado `r` = Mana investida ÷ Custo. Abaixo do Custo
 * é proporcional (metade da Mana, metade da força); acima, `r^k` com 0 < k ≤ 1 — sem teto (o
 * personagem "tudo numa explosão" é recompensado), mas cada Mana a mais rende menos que a
 * anterior: o ganho de uma Mana extra tende a zero, e o golpe gigante é ineficiente por Mana.
 */
export function manaInvestmentPower(ratio, exponent = 0.75) {
  const r = Math.max(0, Number(ratio) || 0);
  const k = Math.min(1, Math.max(0.05, Number(exponent) || 0.75));
  return r < 1 ? r : Math.pow(r, k);
}

/**
 * Quanto um Raio Trator segura um alvo (0-1 do deslocamento dele tirado), pela diferença entre o
 * Porte do alvo e o Porte do Módulo (os dois na mesma régua 0-4): mesmo Porte ou menor 100%, um
 * acima 50%, dois 25%, mais que isso nada. O throttle multiplica (sobrecarregar segura mais, até
 * 100%). Pura.
 */
export function tractorHold(moduleRank, targetRank, throttleRatio = 1) {
  const diff = Math.round(Number(targetRank) || 0) - Math.round(Number(moduleRank) || 0);
  const base = diff <= 0 ? 1 : diff === 1 ? 0.5 : diff === 2 ? 0.25 : 0;
  return Math.min(1, Math.max(0, base * Math.max(0, Number(throttleRatio) || 0)));
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

/**
 * Grupo de prioridade de energia (1 = recebe primeiro … 5 = por último), no modelo do Elite
 * Dangerous: cada Módulo tem um grupo, e a tripulação ajusta no chip "P1…P5" da grade de
 * Módulos da Nave. Substituiu a lista ordenada com setas, que crescia uma linha por Módulo e
 * pedia um clique por posição. Valores antigos fora de 1–5 (o padrão 50, ou a numeração
 * 10/20/30 da lista) caem no grupo do meio; 0 vira 1.
 */
export function powerPriorityGroup(value) {
  const n = Math.round(Number(value));
  if (n >= 1 && n <= MEU_SISTEMA.POWER_PRIORITY_GROUPS) return n;
  if (n === 0) return 1;
  return Math.ceil(MEU_SISTEMA.POWER_PRIORITY_GROUPS / 2);
}

/**
 * Fila de prioridade de energia de UMA Nave/Veículo: a lista salva em `system.powerGroups`, em
 * ordem (a primeira recebe energia primeiro), ou os cinco grupos padrão quando a Nave nunca mexeu
 * nela. Os ids padrão são `p1…p5` de propósito: é o que faz um Módulo salvo antes da fila
 * dinâmica (só com o número 1–5 em `powerPriority`) continuar no mesmo lugar. Ids repetidos ou
 * vazios são descartados; nome vazio vira "Prioridade N".
 * @param {Array<{id: string, label: string}>} stored
 * @returns {Array<{id: string, label: string}>}
 */
export function resolvePowerGroups(stored) {
  const seen = new Set();
  const groups = [];
  for (const entry of Array.isArray(stored) ? stored : []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, label: String(entry.label ?? "").trim() });
  }
  const list = groups.length ? groups : MEU_SISTEMA.DEFAULT_POWER_GROUPS.map(g => ({ ...g }));
  return list.map((g, i) => ({ id: g.id, label: g.label || `Prioridade ${i + 1}` }));
}

/**
 * Posição (0 = primeiro) do grupo de um Módulo na fila. Ordem de busca: o grupo escolhido
 * (`powerGroup`); o grupo padrão do número antigo (`powerPriority` 1–5 → `p1…p5`), se a fila
 * ainda o tiver; e, sem nenhum dos dois, o grupo do meio — mesmo lugar onde caía um Módulo novo
 * antes da fila dinâmica. Um Módulo trazido de outra Nave, com um grupo que não existe aqui, cai
 * no meio também.
 */
export function powerGroupIndex(groups, groupId, legacyPriority) {
  if (!groups.length) return 0;
  const chosen = groupId ? groups.findIndex(g => g.id === groupId) : -1;
  if (chosen >= 0) return chosen;
  const legacy = groups.findIndex(g => g.id === `p${powerPriorityGroup(legacyPriority)}`);
  if (legacy >= 0) return legacy;
  return Math.floor((groups.length - 1) / 2);
}

/** A fila com o grupo `id` trocado de lugar com o vizinho (`step` −1 sobe, +1 desce). Pura. */
export function movePowerGroup(groups, id, step) {
  const list = groups.map(g => ({ ...g }));
  const from = list.findIndex(g => g.id === id);
  const to = from + Math.sign(step);
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

/**
 * A fila sem o grupo `id`, e para onde vão os Módulos dele: o grupo seguinte, ou o anterior
 * quando era o último. A fila nunca fica vazia — apagar o único grupo não muda nada
 * (`fallbackId: null`).
 * @returns {{groups: Array<{id: string, label: string}>, fallbackId: string|null}}
 */
export function removePowerGroup(groups, id) {
  const index = groups.findIndex(g => g.id === id);
  if (index < 0 || groups.length <= 1) return { groups: groups.map(g => ({ ...g })), fallbackId: null };
  const fallback = groups[index + 1] ?? groups[index - 1];
  return { groups: groups.filter(g => g.id !== id).map(g => ({ ...g })), fallbackId: fallback.id };
}

/**
 * Foco de energia (Escudos/Armas/Motores) com a fila dinâmica: os Módulos da Função em foco vão
 * pro primeiro grupo, e o grupo de onde saíram fica guardado (`moved`) pra voltarem quando o foco
 * mudar — sem isso, focar Escudos e depois Armas deixava os dois no topo pra sempre. Os Módulos
 * das outras Funções voltam ao grupo guardado (se tinham sido movidos) ou ficam onde estão.
 * @param {Array<{id: string, role: string, groupId: string}>} modules  Módulos das três Funções do foco
 * @param {string|null} focusRole  Função em foco, ou null (Equilibrado)
 * @param {string} firstGroupId
 * @param {Record<string, string>} previousMoved  o `moved` do foco anterior
 * @returns {{assign: Record<string, string>, moved: Record<string, string>}}
 */
export function focusGroupAssignments(modules, focusRole, firstGroupId, previousMoved = {}) {
  const assign = {};
  const moved = {};
  for (const module of modules) {
    const home = previousMoved[module.id] ?? module.groupId;
    if (focusRole && module.role === focusRole) {
      assign[module.id] = firstGroupId;
      if (home !== firstGroupId) moved[module.id] = home;
    } else {
      assign[module.id] = home;
    }
  }
  return { assign, moved };
}

/**
 * Estado de um grupo na aba Prioridade: `empty` (ninguém ali pede energia), `full` (recebe tudo),
 * `partial` (recebe parte) ou `none` (não recebe nada — os Módulos dele ficam sem energia).
 */
export function powerGroupState(demand, delivered) {
  if (!(demand > 0)) return "empty";
  if (delivered >= demand) return "full";
  return delivered > 0 ? "partial" : "none";
}

/**
 * O que o card do Grid de Energia mostra desta rodada, a partir de quatro números: quanto os
 * Módulos pedem (`demand`), quanto passa do Reator pelo Distribuidor (`generation` = o menor dos
 * dois), e a reserva (`capacitor` de `capacitorMax`).
 *
 * Com sobra: `slack` vai pra reserva, e `roundsToFull` diz em quantas rodadas ela enche. Com falta:
 * a reserva cobre o que puder (`fromReserve`), o resto é `missing`, e `roundsLeft` diz quantas
 * rodadas inteiras ela aguenta neste ritmo (0 = acaba nesta). `afterReservePercent` é o que a Nave
 * entrega quando a reserva acabar. Mesma conta do tick (`applyPowerGridTick`), só que prevista.
 */
export function powerBudget({ demand, generation, capacitor, capacitorMax }) {
  const d = Math.max(0, Math.round(Number(demand) || 0));
  const g = Math.max(0, Math.round(Number(generation) || 0));
  const c = Math.max(0, Math.round(Number(capacitor) || 0));
  const max = Math.max(0, Math.round(Number(capacitorMax) || 0));
  const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 100);

  if (d <= g) {
    const slack = g - d;
    const room = Math.max(0, max - c);
    return {
      shortage: false, demand: d, generation: g, delivered: d, percent: 100,
      fromReactor: d, fromReserve: 0, missing: 0, slack,
      roundsToFull: room === 0 ? 0 : slack > 0 ? Math.ceil(room / slack) : null,
      roundsLeft: null, afterReservePercent: 100
    };
  }
  const deficit = d - g;
  const fromReserve = Math.min(c, deficit);
  const delivered = g + fromReserve;
  return {
    shortage: true, demand: d, generation: g, delivered, percent: percentOf(delivered, d),
    fromReactor: g, fromReserve, missing: d - delivered, slack: 0,
    roundsToFull: null,
    roundsLeft: c > 0 ? Math.floor(c / deficit) : 0,
    afterReservePercent: percentOf(g, d)
  };
}

/**
 * Divide a energia disponível entre os Módulos por grupo de prioridade: o primeiro grupo inteiro,
 * depois o seguinte… Quando o que sobra não cobre um grupo inteiro, todos os Módulos DESSE grupo
 * recebem a mesma fração (ninguém do mesmo grupo passa na frente do outro), e os grupos seguintes
 * ficam sem nada. Módulo sem demanda recebe 1. `priority` é a POSIÇÃO do grupo na fila (menor
 * recebe primeiro) — quem chama resolve a fila da Nave (ver powerGroupIndex).
 * @param {{id: string, demand: number, priority: number}[]} entries
 * @param {number} available
 * @returns {Map<string, number>} id → fração (0-1)
 */
export function fundByPriority(entries, available) {
  const ratios = new Map();
  const groups = new Map();
  for (const entry of entries) {
    if (!(entry.demand > 0)) {
      ratios.set(entry.id, 1);
      continue;
    }
    const rank = Number(entry.priority);
    const group = Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  let left = Math.max(0, Number(available) || 0);
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(group);
    const need = list.reduce((sum, e) => sum + e.demand, 0);
    const ratio = left >= need ? 1 : left / need;
    for (const e of list) ratios.set(e.id, ratio);
    left = Math.max(0, left - need);
  }
  return ratios;
}

/**
 * A Skill (ou Sub-Skill, ou Habilidade Concedida) ergue uma Estrutura ao ser usada? Aceita as
 * duas formas: a atual (`effectType: "structure"`) e a de 1.37, quando Estrutura era um Tipo de
 * Alvo (`targetType: "structure"`) — uma Skill guardada assim continua funcionando.
 */
export function isStructureMechanic(mech) {
  return mech?.effectType === "structure" || mech?.targetType === "structure";
}

/**
 * Converte a forma de 1.37 (Estrutura como Tipo de Alvo) na atual, no próprio objeto. Usado no
 * `migrateData` das Skills e dos moldes de Habilidade Concedida.
 */
export function migrateStructureTarget(mech) {
  if (mech && typeof mech === "object" && mech.targetType === "structure") {
    mech.effectType = "structure";
    mech.targetType = "targeted";
  }
  return mech;
}

/** Catálogo de Funções de Tripulação. */
export function getCrewRoles() {
  return readCatalog("crewRolesData", MEU_SISTEMA.DEFAULT_CREW_ROLES).map(r => ({ ...r, label: r.label || r.id }));
}

/*
 * Tokens NÃO vinculados ("Drone (1)", "Drone (2)") são pessoas diferentes com a mesma ficha-base:
 * cada um tem o próprio Ator sintético, com `uuid` próprio mas o MESMO `id` da ficha do Diretório.
 * Comparar por `id` (ou buscar com `game.actors.get(id)`) mistura os dois — o dano ia pra ficha
 * do Diretório, a iniciativa rolava pro combatente errado. Compare sempre por `uuid` (um Token
 * vinculado dá o mesmo `uuid` da ficha, então continua contando uma vez só).
 */

/** Mesmo Ator? Por `uuid`: distingue Tokens não vinculados da mesma ficha. */
export function sameActor(a, b) {
  return Boolean(a && b) && (a === b || a.uuid === b.uuid);
}

/** Este Combatant é este Ator (o Token dele, no caso não vinculado)? */
export function combatantIsActor(combatant, actor) {
  return sameActor(combatant?.actor, actor);
}

/** Nome pra listas: o do Token quando não vinculado ("Drone (2)"), senão o da ficha. */
export function actorDisplayName(actor) {
  return (actor?.isToken ? actor.token?.name : null) || actor?.name || "?";
}

/**
 * O Token do Ator na Cena aberta. Não vinculado: o próprio Token. Vinculado com vários Tokens: o
 * de `preferred` que for dele (os selecionados, os marcados como alvo), senão o primeiro.
 */
export function actorToken(actor, preferred = []) {
  if (!actor) return null;
  const chosen = preferred.find(token => sameActor(token.actor, actor));
  if (chosen) return chosen;
  const own = actor.isToken ? actor.token?.object : null;
  if (own) return own.scene?.id === canvas?.scene?.id ? own : null;
  return actor.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Atores candidatos a alvo/destinatário: só quem tem um Token na CENA atualmente aberta
 * (`canvas.scene`), não o Diretório de Atores do mundo inteiro — evita listar gente que nem
 * está na cena (ex: mandar dinheiro pra um Ator noutra sessão de jogo, ou mirar Habilidade
 * numa Nave que não está nem por perto). Vários Tokens VINCULADOS ao mesmo Ator contam uma vez só;
 * Tokens NÃO vinculados ("Drone (1)", "Drone (2)") são pessoas diferentes e aparecem cada um (a
 * chave é o `uuid`). `types` (opcional) filtra por `actor.type`; `exclude` tira um Ator (por
 * `uuid`); `permission` (padrão "OBSERVER") é o nível mínimo exigido.
 */
export function sceneActorCandidates({ types = null, exclude = null, permission = "OBSERVER" } = {}) {
  const scene = canvas?.scene;
  if (!scene) return [];
  const seen = new Set();
  const candidates = [];
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    if (exclude && sameActor(actor, exclude)) continue;
    if (types && !types.includes(actor.type)) continue;
    if (!actor.testUserPermission(game.user, permission)) continue;
    seen.add(actor.uuid);
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
 * Valor atual de um campo de FEATURES (`options`). Cai no default da tabela quando a setting ainda
 * não existe, pelo mesmo motivo de `isFeatureEnabled`, e nunca devolve abaixo do `min` declarado.
 */
export function getFeatureOption(featureKey, optionKey) {
  const option = MEU_SISTEMA.FEATURES[featureKey]?.options?.[optionKey];
  if (!option) return undefined;
  let value;
  try {
    value = game.settings.get(SYSTEM_ID, optionKey);
  } catch (err) {
    value = option.default;
  }
  if (option.type === "boolean") return Boolean(value);
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : option.default;
  return option.min !== undefined ? Math.max(option.min, safe) : safe;
}

/**
 * Deslocamento por rodada, em metros. Duas partes, de propósito:
 *  - a PERMANENTE (`permanentDexterity` = pontos + Título) sobe 1 m por `step` pontos e para no
 *    `cap`, senão o valor cruzaria o mapa em poucos níveis;
 *  - a de SKILLS (`skillDexterity` = buffDelta temporário) soma por cima, sem teto, e é negativa
 *    quando a Skill reduz Destreza (Lentidão desacelera sem regra nova).
 * Bônus de Item não entra, igual ao resto do sistema. Recebe a configuração por parâmetro para
 * poder ser testada sem Foundry.
 * @returns {{base:number, fromDexterity:number, fromSkills:number, total:number, capped:boolean}}
 */
export function movementAllowance({ permanentDexterity = 0, skillDexterity = 0, percent = 0 } = {}, { base = 6, step = 10, cap = 18 } = {}) {
  const safeBase = Math.max(0, Number(base) || 0);
  const safeStep = Math.max(1, Number(step) || 1);
  // Teto abaixo da base não faz sentido: a base é o piso da parte permanente.
  const ceiling = Math.max(safeBase, Number(cap) || 0);

  const raw = safeBase + Math.floor(Math.max(0, permanentDexterity) / safeStep);
  const permanent = Math.min(raw, ceiling);
  const fromSkills = Math.trunc(skillDexterity / safeStep) || 0;

  // Efeitos percentuais (Lentidão −50%) valem sobre o total, depois da Destreza.
  const factor = Math.max(0, 1 + (Number(percent) || 0) / 100);
  const beforePercent = Math.max(0, permanent + fromSkills);

  return {
    base: safeBase,
    fromDexterity: permanent - safeBase,
    fromSkills,
    percent: Number(percent) || 0,
    total: Math.floor(beforePercent * factor + 1e-9),
    capped: raw >= ceiling
  };
}

/**
 * Quão perto do desempenho de referência do Porte o Motor da nave está (1 = Motor do tamanho
 * esperado, a 100% de throttle, com energia e sem dano). Motor menor, throttle baixo, falta de
 * energia ou dano baixam; overclock sobe. Nave sem Motor (referência ou efetivo zerado) dá 0.
 *
 * Existe porque a Aceleração/Rotação crua dobra a cada Porte de Motor (20 → 320): usada direto,
 * a nave Capital andaria dezesseis vezes mais que a Mini, o oposto do que se quer.
 */
export function engineRatio(effectiveStat, referenceStat) {
  if (!(referenceStat > 0) || !(effectiveStat > 0)) return 0;
  return effectiveStat / referenceStat;
}

/** Casas por rodada de uma nave: base do Porte × razão do Motor, arredondado para baixo. */
export function shipMovementCells(baseCells, ratio) {
  return Math.max(0, Math.floor(baseCells * ratio + 1e-9));
}

/** Evasão de uma nave como fração 0-1 (base do Porte × razão da Rotação), limitada ao teto em %. */
export function shipEvasionFraction(basePercent, ratio, capPercent) {
  return Math.min(Math.max(0, basePercent * ratio), Math.max(0, capPercent)) / 100;
}

/** Teto de Evasão das naves (%). As casas e a Evasão base ficam em cada Porte (`getVesselSizes`). */
export function getShipManeuverConfig() {
  return { evasionCap: getFeatureOption("shipManeuver", "shipEvasionCap") };
}

/** Texto da ficha para um resultado de `movementAllowance`: o total e de onde ele vem. */
export function describeMovement(movement) {
  if (!movement) return null;
  let text = `${movement.base} base`;
  if (movement.fromDexterity) text += ` + ${movement.fromDexterity} de Destreza${movement.capped ? " (no teto)" : ""}`;
  if (movement.fromSkills) text += ` ${movement.fromSkills > 0 ? "+" : "−"} ${Math.abs(movement.fromSkills)} de Skills`;
  return { total: movement.total, title: `Deslocamento por rodada: ${text}` };
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

/**
 * Aplica um preset de campanha (MEU_SISTEMA.CAMPAIGN_PRESETS) de uma vez só. Blocos que o preset
 * não menciona ficam como estão. Não toca em dado nenhum do mundo — só nas settings de exibição.
 * @param {keyof MEU_SISTEMA["CAMPAIGN_PRESETS"]} presetKey
 */
/**
 * Conteúdo que um preset carrega, já resolvido: `{settingKey: lista}`, com as listas de
 * MEU_SISTEMA juntadas na ordem e sem id repetido (a primeira vence). Pura.
 */
export function presetContent(presetKey) {
  const content = MEU_SISTEMA.CAMPAIGN_PRESETS[presetKey]?.content ?? {};
  const out = {};
  for (const [settingKey, names] of Object.entries(content)) {
    const seen = new Set();
    out[settingKey] = names
      .flatMap(name => MEU_SISTEMA[name] ?? [])
      .filter(entry => entry?.id && !seen.has(entry.id) && seen.add(entry.id));
  }
  return out;
}

export async function applyCampaignPreset(presetKey) {
  const preset = MEU_SISTEMA.CAMPAIGN_PRESETS[presetKey];
  if (!preset) throw new Error(`Preset de campanha desconhecido: "${presetKey}".`);

  for (const [featureKey, enabled] of Object.entries(preset.features)) {
    const feature = MEU_SISTEMA.FEATURES[featureKey];
    if (!feature) continue;
    await game.settings.set(SYSTEM_ID, feature.setting, Boolean(enabled));
  }
  // Conteúdo do preset (elementos de energia, categorias estilo Star Trek…): SUBSTITUI o catálogo.
  for (const [settingKey, lists] of Object.entries(presetContent(presetKey))) {
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingKey], JSON.stringify(lists, null, 2));
  }
  return preset;
}

/* Atalhos nomeados — mantidos porque metade do sistema já os importa, mas todos delegam pro
   mesmo `isFeatureEnabled` acima (nenhuma leitura paralela de setting). */
export function isShipManeuverEnabled() {
  return isFeatureEnabled("shipManeuver");
}
export function isScaleEnabled() {
  return isFeatureEnabled("scale");
}
export function isMovementEnabled() {
  return isFeatureEnabled("movement");
}
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

    // Campos sob o interruptor (ver `options` em FEATURES). Lidos em tempo de uso, então não
    // pedem reload como o interruptor pede.
    for (const [optionKey, option] of Object.entries(feature.options ?? {})) {
      game.settings.register(SYSTEM_ID, optionKey, {
        name: option.label,
        hint: option.hint,
        scope: "world",
        config: false,
        type: option.type === "boolean" ? Boolean : Number,
        default: option.default
      });
    }
  }

  // Rótulo/visibilidade dos atributos (editados pela tela "Configurar Atributos").
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

  game.settings.register(SYSTEM_ID, S.manaInvestExponent, {
    name: "Custo variável — Expoente",
    hint: "Numa Skill que aceita variar o investimento de energia (Mana, Ki… o nome da sua campanha), investir r vezes o Custo dá força r^expoente (abaixo do Custo é proporcional). Entre 0 e 1: quanto menor, mais cada ponto extra perde valor. Padrão 0,75 (10× o Custo = ×5,6; 40× = ×15,9). Sem teto.",
    scope: "world",
    config: true,
    type: Number,
    default: 0.75
  });

  game.settings.register(SYSTEM_ID, S.manaInvestMinPercent, {
    name: "Custo variável — Mínimo (% do Custo)",
    hint: "O menos que se pode investir numa Skill que aceita variar o investimento de energia, em % do Custo dela. Padrão 25%.",
    scope: "world",
    config: true,
    type: Number,
    default: 25
  });

  game.settings.register(SYSTEM_ID, S.shipTargetAsk, {
    name: "Naves — Perguntar sistema-alvo ao atacar",
    hint: "Ao atacar uma Nave/Veículo com alvo único, pergunta se quer mirar num Módulo (Motor, Armas, Escudo…). Desligado, o dano de Integridade sempre se espalha.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, S.shipTargetShare, {
    name: "Naves — Fatia no sistema mirado (%)",
    hint: "Quanto do dano de Integridade Estrutural vai pro Módulo mirado (até a Vida dele); o resto se espalha. Padrão 75%.",
    scope: "world",
    config: true,
    type: Number,
    default: 75
  });

  for (const [key, name, value] of [
    ["affinityImmune", "Imune", 0],
    ["affinityIneffective", "Ineficaz", 0.5],
    ["affinityEffective", "Efetivo", 1.5],
    ["affinitySuperEffective", "Super efetivo", 2]
  ]) {
    game.settings.register(SYSTEM_ID, S[key], {
      name: `Vantagem entre elementos — ${name} (×)`,
      hint: `Multiplicador do dano quando a tabela de vantagens diz "${name}" (Tipos de Dano › Tabela). Padrão ×${String(value).replace(".", ",")}. Defensor com dois elementos: os multiplicadores se multiplicam.`,
      scope: "world",
      config: true,
      type: Number,
      default: value
    });
  }

  game.settings.register(SYSTEM_ID, S.antimagicBase, {
    name: "Antimagia — Base do custo extra",
    hint: "Magia sob antimagia paga (Custo da Skill + esta base) × (crescimento^nível − 1) a mais, na hora (ou por rodada, se for contínua). Não tem como pagar: é anulada. Padrão 10.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(SYSTEM_ID, S.antimagicGrowth, {
    name: "Antimagia — Crescimento por nível",
    hint: "Quanto o custo extra multiplica a cada nível de antimagia. Padrão 2: nível 1 = ×1, nível 2 = ×3, nível 3 = ×7 sobre (Custo + base).",
    scope: "world",
    config: true,
    type: Number,
    default: 2
  });

  game.settings.register(SYSTEM_ID, S.shipRepairEngineerFormula, {
    name: "Naves — Bônus de Engenharia no reparo (Vida)",
    hint: "Fórmula somada à Vida restaurada (2d6) quando quem conserta está no posto de Engenharia da Nave (posto \"engineer\" ou com \"engenh\" no nome). Padrão 1d6 (o engenheiro restaura 2d6 + 1d6). Aceita número fixo (4) ou dados (2d6). Vazio desliga.",
    scope: "world",
    config: true,
    type: String,
    default: "1d6"
  });

  game.settings.register(SYSTEM_ID, S.shipBracePercent, {
    name: "Naves — Preparar para impacto (%)",
    hint: "Ação da Nave: quanto do dano recebido é tirado até o próximo turno dela (antes do Escudo; não vale contra Dano Absoluto). Padrão 30%.",
    scope: "world",
    config: true,
    type: Number,
    default: 30
  });

  game.settings.register(SYSTEM_ID, S.shipFocusBoost, {
    name: "Naves — Foco de energia: sistema em foco (%)",
    hint: "Atalho Escudos/Armas/Motores: o throttle dos Módulos daquele sistema sobe pra este valor (nunca acima do ponto em que a Sobrecarga começa) e eles vão pra prioridade P1. Padrão 150%.",
    scope: "world",
    config: true,
    type: Number,
    default: 150
  });

  game.settings.register(SYSTEM_ID, S.shipFocusCut, {
    name: "Naves — Foco de energia: os outros dois sistemas (%)",
    hint: "Atalho Escudos/Armas/Motores: o throttle dos outros dois sistemas cai pra este valor e eles vão pra P3. Padrão 75%.",
    scope: "world",
    config: true,
    type: Number,
    default: 75
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
    hint: "Quantos pontos o jogador tem pra distribuir entre os atributos ao criar o personagem.",
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

  game.settings.register(SYSTEM_ID, S.traitsData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(MEU_SISTEMA.DEFAULT_TRAITS, null, 2)
  });

  game.settings.register(SYSTEM_ID, S.scalesData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(MEU_SISTEMA.DEFAULT_SCALES, null, 2)
  });

  // Catálogos de Nave (vazio = padrão do código; ver readCatalog).
  for (const key of ["moduleCategoriesData", "shipClassesData", "vehicleClassesData", "shipSizesData", "vehicleSizesData", "ammoTypesData", "crewRolesData", "structuresData"]) {
    game.settings.register(SYSTEM_ID, S[key], { scope: "world", config: false, type: String, default: "" });
  }

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
