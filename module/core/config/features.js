/**
 * Blocos liga/desliga (MEU_SISTEMA.FEATURES), presets de campanha, migrações já feitas e o log de debug.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { MEU_SISTEMA, SYSTEM_ID } from "./constants.js";

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

export function isInventoryEnabled() {
  return isFeatureEnabled("inventory");
}

export function isEncumbranceEnabled() {
  return isFeatureEnabled("encumbrance");
}

export function isStructuresEnabled() {
  return isFeatureEnabled("structures");
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

/** Ferimentos por parte: as Funções das partes passam a ter efeito (sub-bloco de Anatomia). */
export function isBodyInjuryEnabled() {
  return isFeatureEnabled("bodyPartInjury");
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
