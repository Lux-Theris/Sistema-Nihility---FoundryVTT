/**
 * PAD (Fase 1) — resolução de Tripulação e posse do dispositivo físico. A associação
 * Personagem→Nave em si mora em `system.crewMembers` de cada Nave/Veículo (ver
 * `shipSystemsSchema()`/`ShipSystemsDataModel.crewActors` em starship-model.js); as funções
 * daqui fazem o caminho inverso — "que Nave(s) este Personagem tripula" — que é um scan
 * cross-Actor (`game.actors`), não algo que um getter de Data Model (limitado ao próprio
 * documento) consegue responder sozinho.
 */

/** Nave(s)/Veículo(s) que atualmente listam este Ator como tripulante (system.crewMembers). Um personagem pode tripular mais de uma ao mesmo tempo. */
export function findCrewedShipsForActor(actorOrUuid) {
  const uuid = typeof actorOrUuid === "string" ? actorOrUuid : actorOrUuid?.uuid;
  if (!uuid) return [];
  return game.actors.filter(a =>
    ["starship", "vehicle"].includes(a.type) &&
    a.system.crewMembers.some(entry => entry.actorUuid === uuid)
  );
}

/** Verdadeiro se o Ator possuir ao menos um Item marcado como dispositivo PAD (não exige equipado). */
export function hasPadDevice(actor) {
  return actor.items.some(i => i.type === "item" && i.system.isPadDevice === true);
}
