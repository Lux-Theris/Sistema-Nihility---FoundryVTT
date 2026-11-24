/**
 * Junta as ações do relay do Mestre que cada subsistema exporta em `RELAY_HANDLERS` e as registra
 * em `helpers/gm-relay.js`. Chamado uma vez, no `ready`, logo antes de `registerGmRelay()`.
 *
 * Só o arquivo de entrada importa este módulo (os subsistemas nunca), então os imports estáticos
 * abaixo não criam ciclo. Ação nova: exporte em `RELAY_HANDLERS` do subsistema, ponha o nome em
 * `relay-action-names.js` e, se o arquivo do subsistema for novo, importe-o aqui.
 */
import { registerRelayActions } from "../helpers/gm-relay.js";
import { reportError } from "../helpers/report.js";
import { RELAY_ACTION_NAMES, missingRelayActions, unexpectedRelayActions } from "./relay-action-names.js";
import { RELAY_HANDLERS as worldTime } from "./world-time.js";
import { RELAY_HANDLERS as padLibrary } from "../pad/pad-library.js";
import { RELAY_HANDLERS as resistance } from "../combat/resistance.js";
import { RELAY_HANDLERS as skillXp } from "../skills/skill-xp.js";
import { RELAY_HANDLERS as incapacitation } from "../combat/incapacitation.js";
import { RELAY_HANDLERS as compendium } from "./compendium.js";
import { RELAY_HANDLERS as skillEffects } from "../skills/skill-effects.js";
import { RELAY_HANDLERS as creation } from "../creation/creation.js";
import { RELAY_HANDLERS as playerUploads } from "../helpers/player-uploads.js";
import { RELAY_HANDLERS as forms } from "../skills/forms.js";
import { RELAY_HANDLERS as borrowedSkills } from "../skills/borrowed-skills.js";
import { RELAY_HANDLERS as naming } from "../species/naming.js";
import { RELAY_HANDLERS as reroll } from "../skills/reroll.js";
import { RELAY_HANDLERS as structures } from "../structures/structures.js";
import { RELAY_HANDLERS as forcedMovement } from "../combat/forced-movement.js";
import { RELAY_HANDLERS as sustainedShields } from "../skills/sustained-shields.js";
import { RELAY_HANDLERS as starshipPower } from "../starship/starship-power.js";
import { RELAY_HANDLERS as lights } from "../combat/lights.js";
import { RELAY_HANDLERS as upkeep } from "../skills/upkeep.js";
import { RELAY_HANDLERS as areaEffects } from "../combat/area-effects.js";
import { RELAY_HANDLERS as surfaces } from "../environment/surfaces.js";
import { RELAY_HANDLERS as shops } from "../economy/shops.js";
import { RELAY_HANDLERS as shopOnline } from "../economy/shop-online.js";
import { RELAY_HANDLERS as loot } from "../economy/loot.js";
import { RELAY_HANDLERS as playerTrade } from "../economy/player-trade.js";
import { RELAY_HANDLERS as space } from "../combat/space.js";
import { RELAY_HANDLERS as boarding } from "../starship/boarding.js";

/** Um objeto por subsistema; a ordem não importa. */
const ALL_HANDLERS = [worldTime, padLibrary, resistance, skillXp, incapacitation, compendium, skillEffects, creation, playerUploads, forms, borrowedSkills, naming, reroll, structures, forcedMovement, sustainedShields, starshipPower, lights, upkeep, areaEffects, surfaces, shops, shopOnline, loot, playerTrade, space, boarding];

/** Registra todas as ações e avisa o Mestre, na tela, se faltar ou sobrar alguma. */
export function registerAllRelayActions() {
  const names = [];
  for (const handlers of ALL_HANDLERS) {
    registerRelayActions(handlers);
    names.push(...Object.keys(handlers));
  }
  const missing = missingRelayActions(names);
  const unexpected = unexpectedRelayActions(names);
  if (missing.length || unexpected.length) {
    const parts = [];
    if (missing.length) parts.push(`faltam: ${missing.join(", ")}`);
    if (unexpected.length) parts.push(`fora da lista: ${unexpected.join(", ")}`);
    reportError(`Relay do Mestre incompleto: ${parts.join("; ")} (esperadas ${RELAY_ACTION_NAMES.length}).`, null, { gmOnly: true });
  }
}
