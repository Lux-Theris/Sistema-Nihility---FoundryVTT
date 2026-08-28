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
    aiProvider: "aiProvider",
    aiEndpointUrl: "aiEndpointUrl",
    aiModel: "aiModel",
    aiApiKey: "aiApiKey"
  },

  /** Nome da pasta usada para organizar Atores/Notas criados pelo Assistente de IA. */
  AI_GENERATED_FOLDER_NAME: "IA — Gerado",

  /** Nomes (chaves) dos Compêndios de World auto-geridos pelo sistema. */
  COMPENDIUM: {
    skills: { key: "meu-sistema-skills", label: "Compêndio de Habilidades", type: "Item" },
    bodyParts: { key: "meu-sistema-body-parts", label: "Compêndio de Partes do Corpo", type: "Item" },
    titles: { key: "meu-sistema-titles", label: "Compêndio de Títulos", type: "Item" },
    starshipModules: { key: "meu-sistema-starship-modules", label: "Compêndio de Módulos de Naves", type: "Item" }
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

  /** Taxas de conversão fixas entre Pontos de Habilidade (nos dois sentidos). */
  SKILL_POINT_CONVERSION: {
    extraToNormal: 3, // 3 Extra <-> 1 Normal
    normalToUnique: 3 // 3 Normal <-> 1 Único
  },

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

  /**
   * Alvos possíveis de um Efeito Temporário: os 7 atributos de combate (afetam
   * a rolagem via Active Effect, mas NUNCA o cálculo de HP/Mana — só a base
   * permanente do atributo conta pra isso), "hp"/"energy" (HP/Mana atuais,
   * também via Active Effect temporário) e "shield" (Escudo — tratado à parte,
   * é somado direto e gasto na mão, sem Active Effect/duração).
   */
  EFFECT_TARGETS: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "precision", "hp", "energy", "shield"],

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
    shield: "Escudo"
  },

  /**
   * Alvos possíveis de um bônus de Título: os 7 atributos de combate + HP/Mana
   * diretamente (sem passar pela fórmula — soma como um modificador permanente,
   * igual statModifiers de Skill/Item). Reaproveita EFFECT_TARGET_LABELS pros rótulos.
   */
  TITLE_BONUS_TARGETS: ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "precision", "hp", "energy"],

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
   * Presets de Partes do Corpo E Skills Raciais por Espécie.
   * Sobrescrito/estendido pela setting `speciesPresetsData` (JSON) para permitir
   * espécies customizadas sem editar código.
   * Cada parte: { key, label, slot, hpMax, tags[] }
   * Cada skill racial: { name, description, level, cost }
   */
  DEFAULT_SPECIES_PRESETS: {
    humano: {
      label: "Humano",
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
    slime: {
      label: "Slime",
      parts: [
        { key: "core", label: "Núcleo", slot: "core", hpMax: 30, tags: ["vital", "regenerative"] },
        { key: "mass", label: "Massa Gelatinosa", slot: "body", hpMax: 40, tags: ["amorphous", "regenerative"] }
      ],
      skills: [
        { name: "Regeneração Amorfa", description: "Recupera uma fração do HP máximo por turno enquanto o Núcleo estiver intacto.", level: 1, cost: 0 }
      ]
    },
    ciborgue: {
      label: "Ciborgue",
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

/** Atalhos de leitura para os três toggles principais. */
export function isEconomyEnabled() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.economyEnabled);
}
export function isTitlesEnabled() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.titlesEnabled);
}
export function isAnatomyEnabled() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.anatomyEnabled);
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

  game.settings.register(SYSTEM_ID, S.economyEnabled, {
    name: "Sistema de Moedas/Economia",
    hint: "Ativa o rastreamento de moedas dinâmicas nas fichas de personagem.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.titlesEnabled, {
    name: "Sistema de Títulos",
    hint: "Ativa o rastreamento e exibição de Títulos nas fichas de personagem.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, S.anatomyEnabled, {
    name: "Sistema de Anatomia/Modificação Corporal",
    hint: "Ativa Partes do Corpo com HP próprio, presets por espécie e próteses/modificações.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
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
