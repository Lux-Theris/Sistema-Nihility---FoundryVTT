/**
 * Registro de todas as Game Settings do sistema (chamado no `init`).
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { getActiveAttributes } from "./catalogs.js";
import { NIHILITY, SYSTEM_ID } from "./constants.js";

/**
 * Registra todas as Game Settings do sistema. Deve ser chamado no hook `init`.
 */
export function registerSystemSettings() {
  registerFeatureSettings();
  registerAttributeAndDamageSettings();
  registerUnarmedAndShipTargetSettings();
  registerElementAdvantageSettings();
  registerEnvironmentAndClockSettings();
  registerAntimagicSettings();
  registerShipSettings();
  registerSkillLevelAndXpSettings();
  registerVitalAndInitiativeSettings();
  registerEnergyLabelAndPointSettings();
  registerPresetStorageSettings();
  registerSkillCostAndComplexitySettings();
  registerNamingAndPredationSettings();
  registerCatalogSettings();
  registerScaleAndVesselSettings();
  registerMigrationSettings();
  registerDebugAndUiSettings();
  registerAiSettings();
}

/** Aplica "segundos por rodada" em `CONFIG.time.roundTime` (o núcleo deixa 0). Roda no `ready` e quando a setting muda. */
export function applyRoundSeconds() {
  try {
    const n = Math.max(0, Math.floor(Number(game.settings.get(SYSTEM_ID, "clockRoundSeconds"))));
    if (Number.isFinite(n) && n > 0 && CONFIG?.time) CONFIG.time.roundTime = n;
  } catch (err) {
    // Setting ainda não registrada: fica o valor do núcleo (0 = o combate não passa tempo).
  }
}

/** Um interruptor por bloco de NIHILITY.FEATURES, e as opções sob cada um. */
function registerFeatureSettings() {
  const S = NIHILITY.SETTINGS;

  // Um registro por bloco de NIHILITY.FEATURES — a tabela é a única fonte da verdade, então
  // ligar um bloco novo não exige tocar aqui. `config: false` de propósito: a lista apareceria
  // como 15 checkboxes soltos no meio das settings do Foundry; em vez disso ela é editada pela
  // tela "Configurar Módulos do Sistema" (list-config-app-factory-style, ver
  // apps/feature-config.js), que mostra os presets de campanha junto.
  for (const feature of Object.values(NIHILITY.FEATURES)) {
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
}

/** Atributos, escala de dano, Custo variável, Descanso e Cura. */
function registerAttributeAndDamageSettings() {
  const S = NIHILITY.SETTINGS;

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

  game.settings.register(SYSTEM_ID, S.manaInvestOvercharge, {
    name: "Custo variável — Sobrecarga (multiplicador da recarga)",
    hint: "Investir mais de 2× o Custo de uma Skill dá recarga extra de ⌈(r − 2)² × este valor⌉ rodadas (r = investido ÷ Custo). Padrão 1; 0 desliga a recarga por sobrecarga.",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
}

/** Ataque desarmado e o sistema-alvo de Naves. */
function registerUnarmedAndShipTargetSettings() {
  const S = NIHILITY.SETTINGS;

  // Ataque desarmado (H6): sempre existe, mesmo com `FEATURES.weaponMastery` desligada.
  game.settings.register(SYSTEM_ID, S.unarmedFormula, {
    name: "Desarmado — fórmula de dano",
    hint: "Dano base do ataque desarmado (qualquer fórmula de dados do Foundry, ex.: 1d4). Fórmula inválida volta para 1d4. Itens marcados \"Reforça o desarmado\" somam a fórmula deles a esta.",
    scope: "world",
    config: true,
    type: String,
    default: "1d4"
  });
  game.settings.register(SYSTEM_ID, S.unarmedAttribute, {
    name: "Desarmado — atributo de escala",
    hint: "O atributo que multiplica o dano do ataque desarmado (e que o 🎲 rola).",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(getActiveAttributes().map(a => [a.key, a.label])),
    default: "strength"
  });
  game.settings.register(SYSTEM_ID, S.unarmedElement, {
    name: "Desarmado — elemento de dano (id)",
    hint: "Id do Tipo de Dano do ataque desarmado (padrão: blunt, Contundente). Se não existir no catálogo, usa physical; se também não, sem elemento.",
    scope: "world",
    config: true,
    type: String,
    default: "blunt"
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
}

/** Multiplicadores da tabela de vantagens entre elementos. */
function registerElementAdvantageSettings() {
  const S = NIHILITY.SETTINGS;

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
}

/** Densidade de mana do mundo, Relógio do mundo e Reverter o tempo. */
function registerEnvironmentAndClockSettings() {
  const S = NIHILITY.SETTINGS;

  // Densidade de mana do mundo (ambiente, environment.js): multiplica a potência das Skills mágicas
  // e a regeneração de Mana. Cenas e áreas (Regions com "Ambiente") sobrescrevem.
  game.settings.register(SYSTEM_ID, S.manaDensityDefault, {
    name: "Densidade de mana do mundo",
    hint: "Quanta mana há no ambiente, em geral: multiplica a potência das Skills mágicas e a regeneração de Mana. 1 = normal; 0,5 = pouca; 2 = nexo arcano; 0 = magia não funciona. Cada cena e cada área com 'Ambiente (Nihility)' pode ter a sua.",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });

  // Relógio do mundo (J9, core/world-clock.js).
  const clockSetting = (key, name, hint, value) =>
    game.settings.register(SYSTEM_ID, S[key], { name, hint, scope: "world", config: true, type: Number, default: value });
  clockSetting("clockSunrise", "Relógio — nascer do sol (hora)", "Hora em que o dia começa (0–24). Padrão 6.", 6);
  clockSetting("clockSunset", "Relógio — pôr do sol (hora)", "Hora em que a noite começa (0–24). Padrão 18. Dia = entre o nascer e o pôr do sol; o crepúsculo leva 1 hora.", 18);
  clockSetting("clockNightDarkness", "Relógio — escuridão da noite", "Escuridão (0 a 1) que uma cena marcada \"Escurece com o relógio\" tem de noite. Padrão 0,8.", 0.8);
  clockSetting("clockDarkThreshold", "Relógio — limite de \"escuro\" (%)", "A condição \"Está escuro\" do Quando → Então vale quando a Escuridão da cena do Token (ou da Região de escuridão onde ele está) chega a este %. Padrão 50.", 50);
  clockSetting("clockShortRestHours", "Relógio — horas do Descanso Curto", "Quanto tempo o Descanso Curto leva (o personagem fica Dormindo até passar). Padrão 1.", 1);
  clockSetting("clockLongRestHours", "Relógio — horas do Descanso Completo", "Quanto tempo o Descanso Completo leva. Padrão 8.", 8);
  // O núcleo deixa `CONFIG.time.roundTime` em 0 (cada sistema define o seu): com 0 o combate não passa tempo nenhum.
  game.settings.register(SYSTEM_ID, S.clockRoundSeconds, {
    name: "Relógio — segundos por rodada",
    hint: "Quanto tempo do mundo uma rodada de combate leva. 0 (padrão, como o núcleo do Foundry) = o combate não passa tempo e os efeitos em rodadas só acabam pelo combate. Com mais de 0 (ex.: 6), o combate anda o relógio e um efeito em rodadas também vence fora de combate, quando o tempo passa.",
    scope: "world", config: true, type: Number, default: 0,
    onChange: () => applyRoundSeconds()
  });

  // Reverter o tempo (8e.7/8e.8): quantas rodadas de fotos o sistema guarda e o teto do que uma Habilidade reverte.
  game.settings.register(SYSTEM_ID, S.timeRewindRounds, {
    name: "Reverter o tempo — teto de rodadas",
    hint: "Quantas rodadas uma Habilidade de Reverter pode voltar (de 1 a 100; padrão 10). Em combate o sistema guarda uma foto de cada personagem por turno, só em memória no navegador do Mestre, até esse número de rodadas; recarregar a página do Mestre apaga o histórico. Fora de combate o teto vale para o tempo que volta (1 rodada = os segundos por rodada do relógio, ou 6).",
    scope: "world", config: true, type: Number, default: 10
  });
}

/** Antimagia e Tecnomagia. */
function registerAntimagicSettings() {
  const S = NIHILITY.SETTINGS;

  game.settings.register(SYSTEM_ID, S.antimagicReach, {
    name: "Antimagia — alcance (× o nível)",
    hint: "A Skill de Antimagia corta efeitos mágicos, desliga Habilidades Ativas e suprime (passivos, itens mágicos, Skills usadas no alvo) até o nível dela vezes isto. Padrão 1,5 (nível 10 alcança até 15); 2 = o dobro.",
    scope: "world",
    config: true,
    type: Number,
    default: 1.5
  });

  game.settings.register(SYSTEM_ID, S.technomagicPower, {
    name: "Tecnomagia — multiplicador de poder",
    hint: "Um uso que é Mágico E Tecnológico (tecnomágico) sai com a força multiplicada por isto: dano, Efeitos e Vida de Estrutura. Em compensação sofre Antimagia e PEM. Padrão 2 (×2); mínimo 1 (sem bônus).",
    scope: "world",
    config: true,
    type: Number,
    default: 2
  });

  game.settings.register(SYSTEM_ID, S.antimagicBase, {
    name: "Antimagia — Base do custo extra",
    hint: "Magia sob antimagia paga (Custo da Skill + esta base) × (crescimento^nível − 1) a mais, na hora (ou por rodada, se for contínua). Não tem como pagar: é anulada. Padrão 10.",
    scope: "world",
    // Sem uso desde 1.88 (o campo agora decide pela Manipulação): fica registrada, escondida.
    config: false,
    type: Number,
    default: 10
  });

  game.settings.register(SYSTEM_ID, S.antimagicGrowth, {
    name: "Antimagia — Crescimento por nível",
    hint: "Quanto o custo extra multiplica a cada nível de antimagia. Padrão 2: nível 1 = ×1, nível 2 = ×3, nível 3 = ×7 sobre (Custo + base).",
    scope: "world",
    // Sem uso desde 1.88 (o campo agora decide pela Manipulação): fica registrada, escondida.
    config: false,
    type: Number,
    default: 2
  });
}

/** Naves: reparo, preparo para impacto e foco de energia. */
function registerShipSettings() {
  const S = NIHILITY.SETTINGS;

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
}

/** Nível de Skill, XP de Resistência e fórmula de XP. */
function registerSkillLevelAndXpSettings() {
  const S = NIHILITY.SETTINGS;

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
}

/** Fórmulas de HP/Mana, pool de energia, alvos fora da cena e Iniciativa. */
function registerVitalAndInitiativeSettings() {
  const S = NIHILITY.SETTINGS;

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
    default: NIHILITY.DEFAULT_VITAL_FORMULA_MULTIPLIER,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.vitalFormulaFloor, {
    name: "Fórmula de HP/Mana — Piso",
    hint: "Resultado mínimo da fórmula, mesmo com os atributos zerados. Modificadores de Título/Skill/Item somam POR CIMA desse piso.",
    scope: "world",
    config: true,
    type: Number,
    default: NIHILITY.MIN_BASE_VITAL_STAT,
    requiresReload: true
  });
}

/** Rótulos de energia e Pontos de Atributo e de Habilidade. */
function registerEnergyLabelAndPointSettings() {
  const S = NIHILITY.SETTINGS;

  game.settings.register(SYSTEM_ID, S.characterEnergyLabel, {
    name: "Rótulo de Energia — Personagens/Criaturas",
    hint: "Nome customizado da energia usada por Personagens e Criaturas (ex: Mana, Ki, Fluxo Quântico).",
    scope: "world",
    config: true,
    type: String,
    default: NIHILITY.DEFAULT_CHARACTER_ENERGY_LABEL
  });

  game.settings.register(SYSTEM_ID, S.starshipEnergyLabel, {
    name: "Rótulo de Energia — Naves Espaciais",
    hint: "Nome customizado da energia usada por Naves Espaciais (ex: Sistema Eletro-Plasmático (EPS)).",
    scope: "world",
    config: true,
    type: String,
    default: NIHILITY.DEFAULT_STARSHIP_ENERGY_LABEL
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
}

/** Dados guardados de Moedas, Espécies, Heranças e Modelos de Skill (sem UI própria). */
function registerPresetStorageSettings() {
  const S = NIHILITY.SETTINGS;

  // Armazenamento cru (sem UI própria na lista de settings): editados pelos
  // FormApplications dedicados registrados como Settings Menu em nihility-rpg-system.js.
  game.settings.register(SYSTEM_ID, S.currenciesData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(NIHILITY.DEFAULT_CURRENCIES, null, 2)
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

  // Modelos de Skill (vazio = os de fábrica, NIHILITY.DEFAULT_SKILL_TEMPLATES).
  game.settings.register(SYSTEM_ID, S.skillTemplatesData, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/** Custo sugerido de Skill e teto de Complexidade por tier. */
function registerSkillCostAndComplexitySettings() {
  const S = NIHILITY.SETTINGS;

  // Custo sugerido (L9): quanto de Mana/Energia vale cada "ponto de poder" da Skill.
  game.settings.register(SYSTEM_ID, S.skillCostManaPerPoint, {
    name: "Custo sugerido de Skill — por ponto de poder",
    hint: "Multiplica a conta do custo sugerido ao lado do Custo das Skills (dano médio, área, efeitos). Mais alto = Skills sugeridas mais caras. Padrão 0,9 (a Bola de Fogo padrão sai 25). Só sugere: nunca muda o Custo de nenhuma Skill.",
    scope: "world",
    config: true,
    type: Number,
    default: 0.9
  });

  // Complexidade por Tier (8c.1): só avisa no editor; nunca trava. Ultimate e Racial não têm teto.
  game.settings.register(SYSTEM_ID, S.complexityCapExtra, {
    name: "Complexidade — teto de uma Skill Extra",
    hint: "Pontuação de complexidade (1 por efeito, +1 Condição, +2 \"Só se…\", +2 área, +3 Estrutura…) acima da qual o editor avisa que a Skill é complexa demais para o Tier. Padrão 3. Só avisa: nunca impede de salvar nem de usar.",
    scope: "world",
    config: true,
    type: Number,
    default: 3
  });
  game.settings.register(SYSTEM_ID, S.complexityCapNormal, {
    name: "Complexidade — teto de uma Skill Normal",
    hint: "Padrão 6. Skills Racial e Ultimate não têm teto.",
    scope: "world",
    config: true,
    type: Number,
    default: 6
  });
  game.settings.register(SYSTEM_ID, S.complexityCapUnique, {
    name: "Complexidade — teto de uma Skill Única",
    hint: "Padrão 12. Skills Racial e Ultimate não têm teto.",
    scope: "world",
    config: true,
    type: Number,
    default: 12
  });
}

/** Nomeação, Análise e Predação (grupos da Regras da Mesa). */
function registerNamingAndPredationSettings() {
  const S = NIHILITY.SETTINGS;

  // Nomeação (7a): Regras da Mesa, grupo "Nomeação".
  game.settings.register(SYSTEM_ID, S.namingManaFactor, {
    name: "Nomeação — fator da Mana máxima perdida",
    hint: "A Mana máxima que quem nomeia perde para sempre = soma dos atributos de combate do nomeado × este fator. Padrão 1. Sem Mana máxima suficiente a Nomeação falha.",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
  game.settings.register(SYSTEM_ID, S.namingXpFactor, {
    name: "Nomeação — fator do XP",
    hint: "A Mana máxima perdida × este fator vira XP, dividido igual entre as Skills do nomeado que podem subir. Padrão 10.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });
  game.settings.register(SYSTEM_ID, S.namingShareXpPercent, {
    name: "Nomeação — % do XP do nomeado que vai a quem nomeou",
    hint: "De todo XP que o nomeado ganha, esta porcentagem também vai a quem o nomeou (bônus: o nomeado não perde nada). Padrão 10; 0 desliga.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  // Análise e Predação (7b): Regras da Mesa, grupo "Análise e Predação".
  game.settings.register(SYSTEM_ID, S.analysisAttrStep, {
    name: "Análise — pontos de Percepção × Furtividade por degrau",
    hint: "A cada tantos pontos de diferença entre a Percepção de quem analisa e a Furtividade do alvo, a margem da Análise sobe ou desce 1. Padrão 10.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });
  game.settings.register(SYSTEM_ID, S.predationAttrPercent, {
    name: "Predação — % dos atributos do alvo que viram pontos",
    hint: "Na 1ª, 5ª, 10ª, 20ª, 40ª… criatura da mesma Espécie predada, cada atributo ganha esta porcentagem do atributo da criatura (arredondada para baixo) como pontos permanentes. Padrão 5; 0 desliga os pontos.",
    scope: "world",
    config: true,
    type: Number,
    default: 5
  });

  game.settings.register(SYSTEM_ID, S.predationFormsPercent, {
    name: "Predação (Só formas) — % dos pontos de atributo",
    hint: "Numa Predação marcada como \"Só formas\", quem preda ganha esta porcentagem dos pontos de atributo que a Predação normal daria (arredondada para baixo), sem rolar Skills. Padrão 50 (metade); 0 não dá pontos.",
    scope: "world",
    config: true,
    type: Number,
    default: 50
  });

  game.settings.register(SYSTEM_ID, S.predationLevelStep, {
    name: "Predação — pontos de chance por nível de diferença",
    hint: "A chance de absorver uma Skill começa em 50% no mesmo Tier e no mesmo nível. Cada nível que a Skill alvo está acima da Predação tira estes pontos; cada nível abaixo soma. Padrão 5.",
    scope: "world",
    config: true,
    type: Number,
    default: 5
  });
}

/** Dados guardados dos catálogos, do Glossário e do Calendário (sem UI própria). */
function registerCatalogSettings() {
  const S = NIHILITY.SETTINGS;

  // Arquétipos do Gerador de NPC (vazio = os de fábrica, NIHILITY.DEFAULT_NPC_ARCHETYPES).
  game.settings.register(SYSTEM_ID, S.npcArchetypesData, {
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
    default: JSON.stringify(NIHILITY.DEFAULT_DAMAGE_ELEMENTS, null, 2)
  });

  game.settings.register(SYSTEM_ID, S.statusConditionsData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(NIHILITY.DEFAULT_STATUS_CONDITIONS, null, 2)
  });

  game.settings.register(SYSTEM_ID, S.traitsData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(NIHILITY.DEFAULT_TRAITS, null, 2)
  });

  // Glossário (1.85.0): termos da mesa e explicações de fábrica reescritas. Termina em "Data",
  // então o Exportar/Importar Configurações já o leva no grupo Catálogos.
  game.settings.register(SYSTEM_ID, S.glossaryData, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // Calendário do mundo (J9b, vazio = Gregoriano) e linhas do tempo (estado: o Mestre ajusta; a
  // principal nunca se apaga). Só `calendarData` termina em "Data" e viaja no Exportar/Importar.
  game.settings.register(SYSTEM_ID, S.calendarData, { name: "Calendário", scope: "world", config: false, type: String, default: "" });
  game.settings.register(SYSTEM_ID, S.timelines, { name: "Linhas do tempo", scope: "world", config: false, type: String, default: "" });
}

/** Escalas e catálogos de Nave/Veículo (dados guardados, sem UI própria). */
function registerScaleAndVesselSettings() {
  const S = NIHILITY.SETTINGS;

  game.settings.register(SYSTEM_ID, S.scalesData, {
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(NIHILITY.DEFAULT_SCALES, null, 2)
  });

  // Catálogos de Nave (vazio = padrão do código; ver readCatalog).
  for (const key of ["moduleCategoriesData", "shipClassesData", "vehicleClassesData", "shipSizesData", "vehicleSizesData", "ammoTypesData", "crewRolesData", "structuresData", "weaponTypesData"]) {
    game.settings.register(SYSTEM_ID, S[key], { scope: "world", config: false, type: String, default: "" });
  }
}

/** Chaves das migrações já executadas neste mundo. */
function registerMigrationSettings() {
  const S = NIHILITY.SETTINGS;

  // Chaves das migrações únicas (ver runMigrationIfNeeded em nihility-rpg-system.js) já
  // executadas com sucesso neste mundo — sem isso, cada migração reescanearia todos os
  // Atores/Compêndios em TODO hook `ready`, pra sempre, mesmo anos depois de já ter rodado.
  game.settings.register(SYSTEM_ID, S.completedMigrations, {
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  // Trocas abertas entre jogadores (Lojas, lote B): o estado de cada troca (itens e moedas dos dois
  // lados, aceites). Só o Mestre designado escreve (relay `playerTrade`); todos os clientes leem e
  // redesenham a janela pelo `onChange`.
  game.settings.register(SYSTEM_ID, S.playerTrades, {
    scope: "world",
    config: false,
    type: String,
    default: "{}",
    onChange: () => Hooks.callAll("nihilityPlayerTradesChanged")
  });
}

/** Log de debug e os avisos por navegador (números, Voz do Mundo, duração). */
function registerDebugAndUiSettings() {
  const S = NIHILITY.SETTINGS;

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

  // Avisos na tela (mockup aprovado "Avisos na Tela"): cada pessoa desliga só para si.
  game.settings.register(SYSTEM_ID, S.voiceBanner, {
    name: "Voz do Mundo na tela",
    hint: "Level up, XP pronta, Skill nova e outros anúncios aparecem no centro da tela. O sussurro no chat continua. Só neste navegador.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(SYSTEM_ID, S.effectBadges, {
    name: "Duração sobre os ícones do Token",
    hint: "Número de rodadas, ∞ ou nível de irradiação no canto de cada ícone de efeito, nos Tokens que você controla. Só neste navegador.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      for (const token of globalThis.canvas?.tokens?.placeables ?? []) token.renderFlags?.set({ redrawEffects: true });
    }
  });
}

/** Assistente de IA (fica só no navegador de quem configura). */
function registerAiSettings() {
  const S = NIHILITY.SETTINGS;

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

