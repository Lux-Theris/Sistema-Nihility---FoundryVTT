/**
 * Lista congelada das ações do relay do Mestre (ver helpers/gm-relay.js). PURO: sem imports.
 *
 * Cada subsistema exporta as suas ações em `RELAY_HANDLERS`; `core/relay-actions.js` junta tudo e
 * confere contra esta lista. Ação nova = nome aqui (em ordem alfabética) + handler no subsistema.
 * Se faltar um lado, o Mestre vê um aviso na tela em vez de um pedido falhar em silêncio.
 */
export const RELAY_ACTION_NAMES = Object.freeze([
  "antimagicStructures",
  "applySkillEffects",
  "boardingAction",
  "boardingGroup",
  "boardingTeleport",
  "borrowedCooldown",
  "clearShieldLights",
  "createCharacter",
  "createStructure",
  "createSurface",
  "createZone",
  "cutBorrowLink",
  "damageStructure",
  "deviceRepair",
  "engageTractor",
  "ensureUploadFolder",
  "forcedMove",
  "listUploadFolder",
  "lootTake",
  "pileDrop",
  "pilesClear",
  "playerTrade",
  "playerTradeUndo",
  "regenerateSustainedShields",
  "registerCompendiumItem",
  "releaseSkillAnchors",
  "releaseTractor",
  "removeStructures",
  "removeZones",
  "rerollApply",
  "resistanceExposure",
  "resistanceXp",
  "setMovementDash",
  "setShieldLight",
  "shipDock",
  "shipLibrary",
  "shopBuy",
  "shopOrder",
  "shopSell",
  "shopTrade",
  "shopUndo",
  "skillUseXp",
  "soulXp",
  "spaceMove",
  "spaceRegion",
  "timePassedFor",
  "timeSyncRequest",
  "transformActor"
]);

/** Nomes da lista que não estão em `registered` (Set ou array). */
export function missingRelayActions(registered) {
  const have = new Set(registered);
  return RELAY_ACTION_NAMES.filter(name => !have.has(name));
}

/** Nomes registrados que não estão na lista. */
export function unexpectedRelayActions(registered) {
  const known = new Set(RELAY_ACTION_NAMES);
  return [...new Set(registered)].filter(name => !known.has(name));
}
