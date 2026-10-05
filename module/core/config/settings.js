/**
 * Registro de todas as Game Settings do sistema (chamado no `init`).
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { getActiveAttributes } from "./catalogs.js";
import { MEU_SISTEMA, SYSTEM_ID } from "./constants.js";

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

  game.settings.register(SYSTEM_ID, S.restShortHpPercent, {
    name: "Descanso Curto — Vida (%)",
    hint: "Quanto da Vida máxima o Descanso Curto devolve. Partes a 0% seguram o % delas (a Vida não passa do que sobra). Padrão 25%.",
    scope: "world",
    config: true,
    type: Number,
    default: 25
  });

  game.settings.register(SYSTEM_ID, S.restShortEnergyPercent, {
    name: "Descanso Curto — energia (%)",
    hint: "Quanto da energia máxima (Mana, Ki…) o Descanso Curto devolve. Padrão 50%.",
    scope: "world",
    config: true,
    type: Number,
    default: 50
  });

  game.settings.register(SYSTEM_ID, S.healBlockZeroMultiplier, {
    name: "Cura contra bloqueio — a redução zera em (× o limite)",
    hint: "Maldição/bloqueio de nível N bloqueia toda cura até N + N/3 (o limite). Acima disso a cura passa reduzida, e a redução cai em linha reta até zerar neste múltiplo do limite. Padrão 2 (maldição 9: bloqueia até 12, cura nível 24 passa inteira).",
    scope: "world",
    config: true,
    type: Number,
    default: 2
  });

  game.settings.register(SYSTEM_ID, S.cureRegrowLevel, {
    name: "Cura — nível que refaz parte perdida",
    hint: "Com Ferimentos por parte: uma Skill de Cura (qualquer tier) deste nível ou mais também refaz parte perdida, como uma Regeneração. Padrão 10.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
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

  game.settings.register(SYSTEM_ID, S.antimagicReach, {
    name: "Antimagia — alcance (× o nível)",
    hint: "A Skill de Antimagia corta efeitos mágicos, desliga Habilidades Ativas e suprime (passivos, itens mágicos, Skills usadas no alvo) até o nível dela vezes isto. Padrão 1,5 (nível 10 alcança até 15); 2 = o dobro.",
    scope: "world",
    config: true,
    type: Number,
    default: 1.5
  });

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

  game.settings.register(SYSTEM_ID, S.heritagesData, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(SYSTEM_ID, S.bodyFunctionsData, {
    scope: "world",
    config: false,
    type: String,
    default: ""
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

  // Números sobre o Token (combat/floating-numbers.js). Por usuário: quem prefere a tela limpa
  // desliga só para si. O "texto de status flutuante" do core (world) desliga para todos.
  game.settings.register(SYSTEM_ID, S.floatingNumbers, {
    name: "Números flutuantes sobre o Token",
    hint: "Mostra dano, cura, Escudo e Mana subindo do Token quando mudam (Nave: Escudo, Casco e Integridade). Só neste navegador.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
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
