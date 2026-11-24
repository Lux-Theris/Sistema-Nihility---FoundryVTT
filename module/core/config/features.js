/**
 * Blocos liga/desliga (NIHILITY.FEATURES), presets de campanha, migrações já feitas e o log de debug.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { NIHILITY, SYSTEM_ID } from "./constants.js";

/**
 * Chaves de migração única (ver runMigrationIfNeeded em nihility-rpg-system.js) já executadas
 * com sucesso neste mundo.
 * @returns {string[]}
 */
export function getCompletedMigrations() {
  try {
    const parsed = JSON.parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.completedMigrations) || "[]");
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
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.completedMigrations, JSON.stringify([...current, key]));
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
    if (!game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.debugMode)) return;
  } catch (err) {
    return;
  }
  console.log(...args);
}

export function isInventoryEnabled() {
  return isFeatureEnabled("inventory");
}

export function isEncumbranceEnabled() {
  return isFeatureEnabled("encumbrance");
}

export function isStructuresEnabled() {
  return isFeatureEnabled("structures");
}

/** Alcance de Skill/arma/arremesso e Marcas (H4). Desligado: nada é conferido nem mostrado. */
export function isSkillRangeEnabled() {
  return isFeatureEnabled("skillRange");
}

/** Empurrar/puxar (J1): Skill, arma de gravidade e dano de impacto. Desligado: nada se move nem se confere. */
export function isForcedMovementEnabled() {
  return isFeatureEnabled("forcedMovement");
}

/** Sorte e azar (item 8d.1): inclinação dos dados. Desligado: nenhuma sorte conta e os campos somem. */
export function isLuckEnabled() {
  return isFeatureEnabled("luck");
}

/** Reações elementais (item 8.1): o golpe reage com as marcas do alvo. Desligado: nada reage. */
export function isReactionsEnabled() {
  return isFeatureEnabled("reactions");
}

/** Superfícies elementais (item 8.2): o elemento deixa uma superfície no chão. Desligado: nada nasce nem age. */
export function isSurfacesEnabled() {
  return isFeatureEnabled("surfaces");
}

/** Voo, altura e escavação (J4): a elevação do Token entra nas distâncias e áreas. */
export function isElevationEnabled() {
  return isFeatureEnabled("elevation");
}

/** Sentidos e visibilidade (J4b): debaixo da terra, invisível, sentidos por Skill/Espécie. */
export function isSensesEnabled() {
  return isFeatureEnabled("senses");
}

/** Armadilhas de Região (I1). Desligado: nenhuma dispara nem é desarmada. */
export function isTrapsEnabled() {
  return isFeatureEnabled("traps");
}

/** Formas (H5): Skill de Forma e ficha temporária. Desligado: não liga nem aparece nos editores. */
export function isFormsEnabled() {
  return isFeatureEnabled("forms");
}

/** Nomeação e Corredor de alma (7a). Desligado: sem botão Nomear e sem uso emprestado. */
export function isNamingEnabled() {
  return isFeatureEnabled("naming");
}

/** Análise (7b): Mecânica de Skill que revela a ficha de um alvo. */
export function isAnalysisEnabled() {
  return isFeatureEnabled("analysis");
}

/** Predação (7b): Mecânica de Skill que absorve Skills, pontos e forma de um alvo derrotado. */
export function isPredationEnabled() {
  return isFeatureEnabled("predation");
}

/** Rerrolar (8d.2): Mecânica de Skill usada no chat para refazer uma rolagem. */
export function isRerollEnabled() {
  return isFeatureEnabled("reroll");
}

/** Pacto (7a): Skills emprestadas pelo patrono ao bruxo. */
export function isPactEnabled() {
  return isFeatureEnabled("pact");
}

/** Relógio do mundo, dia/noite e escuro (J9). Desligado: o Descanso volta a ser na hora. */
export function isWorldClockEnabled() {
  return isFeatureEnabled("worldClock");
}

/** Manipulação do tempo (8e): o efeito "Ritmo do tempo" (Acelerar/Desacelerar) e o grupo Tempo do editor. */
export function isTimeManipulationEnabled() {
  return isFeatureEnabled("timeManipulation");
}

/** Manipulação do espaço (8f): o efeito "Espaço" (Saltar, Trocar), a Âncora e a Interdição. Separada do tempo. */
export function isSpaceManipulationEnabled() {
  return isFeatureEnabled("spaceManipulation");
}

/** Calendário, linhas do tempo e tempo pessoal (J9b). Desligado: o tempo pessoal é o do mundo. */
export function isCalendarEnabled() {
  return isFeatureEnabled("calendar");
}

/**
 * Leitor ÚNICO de todo bloco ligável/desligável do sistema (ver NIHILITY.FEATURES) — use
 * isto, e não `game.settings.get` direto, pra gatear qualquer coisa: só aqui a cadeia de
 * `parent` é respeitada (uma sub-feature do PAD com a chave-mestra desligada conta como
 * desligada, mesmo que a setting dela esteja `true`).
 *
 * Cai no `default` da tabela quando as settings ainda não foram registradas — isso acontece de
 * verdade quando um Data Model prepara dados cedo demais no boot, e um `throw` aqui derrubaria
 * a preparação inteira da ficha.
 * @param {keyof NIHILITY["FEATURES"]} key
 * @returns {boolean}
 */
export function isFeatureEnabled(key) {
  const feature = NIHILITY.FEATURES[key];
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
  const option = NIHILITY.FEATURES[featureKey]?.options?.[optionKey];
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
 * Aplica um preset de campanha (NIHILITY.CAMPAIGN_PRESETS) de uma vez só. Blocos que o preset
 * não menciona ficam como estão. Não toca em dado nenhum do mundo — só nas settings de exibição.
 * @param {keyof NIHILITY["CAMPAIGN_PRESETS"]} presetKey
 */
/**
 * Conteúdo que um preset carrega, já resolvido: `{settingKey: lista}`, com as listas de
 * NIHILITY juntadas na ordem e sem id repetido (a primeira vence). Pura.
 */
export function presetContent(presetKey) {
  const content = NIHILITY.CAMPAIGN_PRESETS[presetKey]?.content ?? {};
  const out = {};
  for (const [settingKey, names] of Object.entries(content)) {
    const seen = new Set();
    out[settingKey] = names
      .flatMap(name => NIHILITY[name] ?? [])
      .filter(entry => entry?.id && !seen.has(entry.id) && seen.add(entry.id));
  }
  return out;
}

export async function applyCampaignPreset(presetKey) {
  const preset = NIHILITY.CAMPAIGN_PRESETS[presetKey];
  if (!preset) throw new Error(`Preset de campanha desconhecido: "${presetKey}".`);

  for (const [featureKey, enabled] of Object.entries(preset.features)) {
    const feature = NIHILITY.FEATURES[featureKey];
    if (!feature) continue;
    await game.settings.set(SYSTEM_ID, feature.setting, Boolean(enabled));
  }
  // Conteúdo do preset (elementos de energia, categorias estilo Star Trek…): SUBSTITUI o catálogo.
  for (const [settingKey, lists] of Object.entries(presetContent(presetKey))) {
    await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS[settingKey], JSON.stringify(lists, null, 2));
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

/** Ferimentos por parte: as Funções das partes passam a ter efeito (sub-bloco de Anatomia). */
export function isBodyInjuryEnabled() {
  return isFeatureEnabled("bodyPartInjury");
}

export function isVesselsEnabled() {
  return isFeatureEnabled("vessels");
}

/** Sensores e furtividade de nave (F1). Filho de Naves e Veículos. */
export function isShipSensorsEnabled() {
  return isFeatureEnabled("shipSensors");
}

/** Abordagem de naves (F2). Filho de Naves e Veículos. */
export function isBoardingEnabled() {
  return isFeatureEnabled("boarding");
}

/** As afinações do F1 lidas das opções do bloco (os padrões valem fora do jogo). */
export function getSensorTuning() {
  const get = (key, fallback) => {
    const value = Number(getFeatureOption("shipSensors", key));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    passiveFactor: get("sensorPassiveFactor", 50),
    energyActive: get("signatureEnergyActive", 20),
    energyPassive: get("signatureEnergyPassive", 4),
    lostRounds: Math.max(1, Math.round(get("sensorLostRounds", 5))),
    cleanMargin: Math.max(1, get("scanCleanMargin", 3))
  };
}

/** Quanto de diferença no teste resistido de propulsão ainda só arrasta a nave acoplada. */
export function getBoardingDragMargin() {
  const value = Number(getFeatureOption("boarding", "boardingDragMargin"));
  return Number.isFinite(value) ? Math.max(0, value) : 4;
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

export function isInterferenceEnabled() {
  return isFeatureEnabled("interference");
}
export function isEnvironmentEnabled() {
  return isFeatureEnabled("environment");
}
/** Lojas (G2): a aba Loja da ficha e a Vitrine. Filho da Economia. */
export function isShopsEnabled() {
  return isFeatureEnabled("shops");
}

/** "Perto", em metros, para saquear, pegar de uma pilha ou depósito e trocar com outro jogador (lote B das Lojas). */
export function getShopLootRange() {
  const value = Number(getFeatureOption("shops", "shopLootRange"));
  return Number.isFinite(value) && value > 0 ? value : 2;
}
/** Configuração de cenas por pasta (H20). Desligado: vale só o valor da própria cena. */
export function isSceneFoldersEnabled() {
  return isFeatureEnabled("sceneFolders");
}
export function isIncapacitationEnabled() {
  return isFeatureEnabled("incapacitation");
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
 * Campanha usa pool de Mana/Energia? Desligado (campanha "sem magia"), a barra some da ficha,
 * o Máximo vira 0 e nenhum Custo/Custo por Rodada de Habilidade é cobrado — a Skill continua
 * funcionando, o recurso é que deixa de existir. Nave/Veículo NÃO é afetado: o Grid de Energia
 * é outro sistema, com pool próprio.
 */
export function isEnergyPoolEnabled() {
  try {
    return Boolean(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.energyPoolEnabled));
  } catch (err) {
    return true;
  }
}

/** Níveis de NPC (M6): multiplicadores de Vida e Skills a mais do gerador (Módulos do Sistema). */
export function getNpcTierConfig() {
  return {
    enabled: isFeatureEnabled("npcTiers"),
    eliteHp: getFeatureOption("npcTiers", "npcEliteHp"),
    bossHp: getFeatureOption("npcTiers", "npcBossHp"),
    eliteSkills: getFeatureOption("npcTiers", "npcEliteSkills"),
    bossSkills: getFeatureOption("npcTiers", "npcBossSkills")
  };
}
