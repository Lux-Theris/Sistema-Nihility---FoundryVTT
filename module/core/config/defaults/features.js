/**
 * Blocos de Módulos do Sistema (FEATURES) e presets de campanha.
 * Dados puros, referenciados por MEU_SISTEMA (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

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
export const FEATURES = {
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
  naturalRegen: {
    setting: "naturalRegenEnabled",
    name: "Regeneração natural de energia",
    hint: "Em combate, no início do turno de cada Personagem, a energia (Mana, Ki…) volta um % da máxima. Fora de combate, quem devolve é o Descanso. Passivos de Skill, Título, Item e Espécie somam por cima — e valem mesmo com este bloco desligado.",
    // Desligado por padrão: mundos que já existem não ganham uma regra nova só por atualizar.
    default: false,
    options: {
      naturalEnergyRegenPercent: { label: "% da energia máxima por rodada", hint: "Mana 240 com 5% = +12 por rodada.", type: "number", default: 5, min: 0 }
    }
  },
  speciesEvolution: {
    setting: "speciesEvolutionEnabled",
    name: "Evolução de Espécie",
    hint: "Espécies podem declarar para onde evoluem (estilo Tensura). O Mestre ganha o botão \"Evoluir…\" na aba Origem; a evolução passa pela prévia e preserva nível, próteses e Heranças.",
    default: true
  },
  bodyPartInjury: {
    setting: "bodyPartInjuryEnabled",
    name: "Ferimentos por parte",
    hint: "As Funções das Partes do Corpo passam a ter efeito: parte destruída aplica a Condição da Função (Cego, Sem mão…), locomoção reduz o Deslocamento, prótese repõe a Função e implantes arrastados só encaixam no slot certo.",
    parent: "anatomy",
    // Desligado por padrão: muda o que acontece com quem leva dano numa parte.
    default: false,
    options: {
      partLossOverflow: {
        label: "Sobra que deixa a parte Perdida (%)",
        hint: "Golpe que passa do 0 com esta sobra (em % da Vida da parte) ou mais arranca a parte: só Regeneração a traz de volta. 0 = nunca por sobra (só pelo efeito Decepar ou pelo Mestre).",
        type: "number",
        default: 50,
        min: 0
      },
      aimBodyPart: {
        label: "Perguntar \"Mirar numa parte?\"",
        hint: "Ao atacar um Personagem com alvo único, quem ataca pode escolher a parte. Sem mirar (ou desligado), o dano cai numa parte sorteada, com chance proporcional ao tamanho dela.",
        type: "boolean",
        default: true
      }
    }
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
  skillUseXp: {
    setting: "skillUseXpEnabled",
    name: "XP por uso de Skill",
    hint: "A Skill ganha XP pelo que fez: dano, cura e Escudo pela fração da Vida máxima do alvo; buff/debuff pela fração do valor que mudou; Condição, Estrutura e Zona um valor fixo (Estrutura também pelo dano que segurou). Para no teto do nível — subir continua sendo clique do Mestre.",
    default: true,
    options: {
      skillXpFactor: { label: "XP de um efeito do tamanho de uma Vida", hint: "Um golpe que leva a Vida máxima inteira do alvo vale isto (cada alvo conta no máximo uma vez).", type: "number", default: 100, min: 0 },
      skillXpFlatPercent: { label: "% fixo (Condição, Estrutura, Zona)", hint: "Porcentagem do valor acima dada por Condição aplicada, Estrutura erguida ou Zona criada.", type: "number", default: 10, min: 0 }
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
};

/**
 * Combinações prontas de FEATURES por tipo de campanha — aplicadas de uma vez pelo editor
 * visual (ver `applyCampaignPreset`). Só mexem nos blocos listados em `features`; o que não
 * aparece na lista fica como está. Nenhum preset apaga dado: "Naves desligadas" numa campanha
 * medieval significa que a UI some, não que as Naves do mundo sumam.
 */
export const CAMPAIGN_PRESETS = {
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
};
