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
    energyLabel: "energyLabel",
    speciesPresetsData: "speciesPresetsData",
    aiProvider: "aiProvider",
    aiEndpointUrl: "aiEndpointUrl",
    aiModel: "aiModel",
    aiApiKey: "aiApiKey",
    aiRelayUrl: "aiRelayUrl",
    aiRelayToken: "aiRelayToken"
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

  /** Tiers de habilidade, na ordem de força relativa. */
  SKILL_TIERS: ["common", "extra", "unique", "ultimate", "racial"],

  SKILL_TIER_LABELS: {
    common: "Comum",
    extra: "Extra",
    unique: "Única",
    ultimate: "Ultimate",
    racial: "Racial"
  },

  /** Estados possíveis de uma Parte do Corpo. */
  BODY_PART_STATUS: ["intact", "damaged", "destroyed"],

  BODY_PART_STATUS_LABELS: {
    intact: "Intacto",
    damaged: "Danificado",
    destroyed: "Destruído"
  },

  /** Valor padrão (fallback) do rótulo de energia, sobrescrito pela setting `energyLabel`. */
  DEFAULT_ENERGY_LABEL: "Sistema Eletro-Plasmático (EPS)",

  /** Conjunto padrão de moedas, sobrescrito pela setting `currenciesData` (JSON). */
  DEFAULT_CURRENCIES: [
    { id: "gold", label: "Ouro", icon: "icons/commodities/currency/coins-plain-gold.webp", weight: 0.02 },
    { id: "silver", label: "Prata", icon: "icons/commodities/currency/coin-embossed-crown-silver.webp", weight: 0.02 },
    { id: "copper", label: "Cobre", icon: "icons/commodities/currency/coins-copper-various.webp", weight: 0.02 }
  ],

  /**
   * Presets de Partes do Corpo por Espécie.
   * Sobrescrito/estendido pela setting `speciesPresetsData` (JSON) para permitir
   * espécies customizadas sem editar código.
   * Cada parte: { key, label, slot, hpMax, tags[] }
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
      ]
    },
    slime: {
      label: "Slime",
      parts: [
        { key: "core", label: "Núcleo", slot: "core", hpMax: 30, tags: ["vital", "regenerative"] },
        { key: "mass", label: "Massa Gelatinosa", slot: "body", hpMax: 40, tags: ["amorphous", "regenerative"] }
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
      ]
    }
  }
};

/**
 * Lê a lista de moedas atualmente ativa (setting > default).
 * @returns {Array<{id:string,label:string,icon:string,weight:number}>}
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
 * Lê o dicionário de presets de espécie atualmente ativo.
 * Assim que o GM salva algo pelo editor visual (Configurar Presets de Espécie),
 * o resultado completo passa a ser a única fonte da verdade; até lá, usa os padrões.
 * @returns {Record<string, {label:string, parts:Array}>}
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

/** Rótulo atual do sistema de energia (setting > default). */
export function getEnergyLabel() {
  try {
    const label = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.energyLabel);
    if (label && String(label).trim().length) return label;
  } catch (err) {
    /* settings ainda não registradas (fora do hook init/ready) */
  }
  return MEU_SISTEMA.DEFAULT_ENERGY_LABEL;
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

  game.settings.register(SYSTEM_ID, S.energyLabel, {
    name: "Rótulo do Sistema de Energia",
    hint: "Nome customizado da energia usada por personagens e naves (ex: Mana, EPS, Ki).",
    scope: "world",
    config: true,
    type: String,
    default: MEU_SISTEMA.DEFAULT_ENERGY_LABEL
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

  // scope:"client" (não "world"): fica só no navegador de quem configura, nunca
  // sincroniza pros outros clientes conectados. Como só o GM usa o Assistente de
  // IA, isso mantém a chave/token fora do alcance dos jogadores sem precisar de
  // nenhuma infraestrutura extra. Efeito colateral: precisa reconfigurar por
  // navegador/dispositivo se o GM trocar de máquina.
  game.settings.register(SYSTEM_ID, S.aiProvider, {
    name: "Provedor de IA",
    hint: "Fica salvo só neste navegador (não sincroniza com jogadores). Relay Seguro é útil se você quiser um teto de uso ou compartilhar uma chave entre co-Mestres; os provedores diretos falam direto com o provedor escolhido.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      relay: "Relay Seguro (Cloudflare)",
      openai: "OpenAI-compatível (Chat Completions) — direto",
      anthropic: "Anthropic (Claude) — direto"
    },
    default: "openai"
  });

  game.settings.register(SYSTEM_ID, S.aiRelayUrl, {
    name: "URL do Relay (só para provedor Relay Seguro)",
    hint: "URL do seu Worker do Cloudflare, ex: https://nihility-ai-relay.SEU-USUARIO.workers.dev. Veja tools/ai-relay/README.md no repositório do sistema para configurar.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(SYSTEM_ID, S.aiRelayToken, {
    name: "Token do Relay (só para provedor Relay Seguro)",
    hint: "O mesmo valor configurado como RELAY_SHARED_SECRET no Worker.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(SYSTEM_ID, S.aiEndpointUrl, {
    name: "Endpoint de IA (só para provedor OpenAI-compatível direto)",
    hint: "URL do endpoint Chat Completions. Ignorado nos provedores Anthropic e Relay Seguro.",
    scope: "client",
    config: true,
    type: String,
    default: "https://api.openai.com/v1/chat/completions"
  });

  game.settings.register(SYSTEM_ID, S.aiModel, {
    name: "Modelo de IA (só para provedores diretos)",
    hint: "Nome do modelo. Ex OpenAI-compatível: gpt-4o-mini, llama-3.1-70b. Ex Anthropic: claude-sonnet-4-5, claude-haiku-4-5. Ignorado no Relay Seguro (o modelo é definido lá no Worker).",
    scope: "client",
    config: true,
    type: String,
    default: "gpt-4o-mini"
  });

  game.settings.register(SYSTEM_ID, S.aiApiKey, {
    name: "Chave de API de IA (só para provedores diretos)",
    hint: "Chave do provedor escolhido acima. Ignorada no Relay Seguro. Fica salva só neste navegador (scope: client) — nunca sincroniza pros jogadores.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });
}
