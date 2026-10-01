/**
 * Tripulação opera a Nave: quem joga com um tripulante ganha permissão de Dono na Nave/Veículo.
 *
 * Com poucos jogadores à mesa, o engenheiro tem que conseguir assumir o leme se o piloto cair —
 * por isso a Função de Tripulação é só "quem está em qual posto", e qualquer tripulante pode
 * mover o token, mexer no throttle e na prioridade de energia, disparar e trocar a própria
 * Função. Sem isso, nada disso funcionava pra jogador: o Foundry só deixa editar ou mover o que
 * a pessoa possui. O Mestre continua sendo o único a editar Porte, Classe e a lista da
 * Tripulação (a UI esconde esses controles de quem não é Mestre).
 *
 * As permissões dadas pela tripulação ficam anotadas no flag `crewGrantedOwners`, pra poderem
 * ser retiradas quando o tripulante sai — sem mexer em quem já era Dono por outro motivo.
 */
import { SYSTEM_ID } from "../core/config.js";

const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
const FLAG = "crewGrantedOwners";

/** Usuários (não-Mestre) donos de algum tripulante atual. */
function crewUserIds(ship) {
  const ids = new Set();
  for (const { actor } of ship.system.crewActors ?? []) {
    for (const user of game.users) {
      if (!user.isGM && actor?.testUserPermission(user, "OWNER")) ids.add(user.id);
    }
  }
  return ids;
}

/** Recalcula as permissões dadas pela tripulação. Só o Mestre chama (ações da aba Tripulação). */
export async function syncShipOwnershipToCrew(ship) {
  if (!game.user.isGM || !ship) return;
  const wanted = crewUserIds(ship);
  const previously = new Set(ship.getFlag(SYSTEM_ID, FLAG) ?? []);
  const current = ship.ownership ?? {};
  const changes = {};
  const granted = [];

  for (const userId of wanted) {
    // Quem já era Dono por conta própria não entra na lista: sair da tripulação não tira dele.
    if ((current[userId] ?? 0) >= OWNER && !previously.has(userId)) continue;
    changes[userId] = OWNER;
    granted.push(userId);
  }
  // Quem saiu volta a herdar a permissão padrão do mundo (INHERIT), em vez de ficar sem nada.
  for (const userId of previously) {
    if (!wanted.has(userId)) changes[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT;
  }

  await ship.update({ ownership: changes, [`flags.${SYSTEM_ID}.${FLAG}`]: granted });
}
