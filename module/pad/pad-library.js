/**
 * PAD (Fase 3) — Biblioteca: favoritos de referência rápida (Item/JournalEntry/Actor arrastado
 * pro PAD), em dois escopos com armazenamento bem diferente:
 *
 * - Pessoal (por Personagem): flag simples no próprio Actor (`padLibrary`) — permissão
 *   trivialmente correta, o jogador já é dono do próprio Ator, sem precisar de Compêndio nem
 *   ownership por documento.
 * - Da Nave (compartilhada com a tripulação): mesmo padrão de `world-backup.js` (um `JournalEntry`
 *   por Nave num Compêndio de Mundo oculto, dados só em `flags`, `content` nunca usado), mas com
 *   `ownership` setado explicitamente pros usuários donos dos `crewActors` ATUAIS — recalculado
 *   toda vez que a tripulação muda (`syncLibraryOwnershipToCrew`, chamado pelos handlers de
 *   add/remove-crew em starship-sheet.js) pra quem sai da tripulação perder o acesso.
 */
import { SYSTEM_ID, NIHILITY } from "../core/config.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { relayFailureMessage } from "../helpers/gm-relay-rules.js";

const LIBRARY_PACK_COLLECTION = `world.${NIHILITY.COMPENDIUM.padLibrary.key}`;

function getLibraryPack() {
  return game.packs.get(LIBRARY_PACK_COLLECTION) ?? null;
}

/* ---------- Pessoal (flag no Actor do personagem) ---------- */

export function getPersonalLibrary(actor) {
  return actor.getFlag(SYSTEM_ID, "padLibrary") ?? [];
}

export async function addPersonalLibraryEntry(actor, { label, uuid, note = "" }) {
  const entries = [...getPersonalLibrary(actor), { id: foundry.utils.randomID(), label, uuid, note, addedAt: Date.now() }];
  await actor.setFlag(SYSTEM_ID, "padLibrary", entries);
}

export async function removePersonalLibraryEntry(actor, entryId) {
  const entries = getPersonalLibrary(actor).filter(e => e.id !== entryId);
  await actor.setFlag(SYSTEM_ID, "padLibrary", entries);
}

/* ---------- Da Nave (JournalEntry num Compêndio de Mundo oculto + ownership por documento) ---------- */

/** {default: NONE, [userId]: OWNER} pros usuários donos dos tripulantes ATUAIS da Nave. */
function crewOwnershipMap(shipActor) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const entry of shipActor.system.crewActors) {
    for (const user of game.users.filter(u => !u.isGM && entry.actor.testUserPermission(u, "OWNER"))) {
      ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    }
  }
  return ownership;
}

/** Acha (sem criar) o JournalEntry de Biblioteca desta Nave, se alguém já tiver salvo algo nela. */
async function findShipLibraryDocument(shipActor) {
  const pack = getLibraryPack();
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ["flags"] });
  const entry = index.find(e => e.flags?.[SYSTEM_ID]?.library?.ownerUuid === shipActor.uuid);
  return entry ? pack.getDocument(entry._id) : null;
}

/** Acha ou cria (já com a ownership da tripulação atual) o JournalEntry de Biblioteca desta Nave. */
async function ensureShipLibraryDocument(shipActor) {
  const pack = getLibraryPack();
  if (!pack) return null;

  const existing = await findShipLibraryDocument(shipActor);
  if (existing) return existing;

  const [created] = await pack.documentClass.createDocuments([{
    name: `Biblioteca — ${shipActor.name}`,
    ownership: crewOwnershipMap(shipActor),
    flags: { [SYSTEM_ID]: { library: { ownerUuid: shipActor.uuid, entries: [] } } }
  }], { pack: pack.collection });
  return created;
}

/**
 * Recalcula a ownership do JournalEntry de Biblioteca desta Nave — chamado toda vez que a
 * tripulação muda (ver `_onDropCrewMember`/`onRemoveCrew` em starship-sheet.js). Não faz nada se
 * a Biblioteca da Nave ainda não foi criada (ninguém salvou nada nela ainda, nada pra sincronizar).
 */
export async function syncLibraryOwnershipToCrew(shipActor) {
  const doc = await findShipLibraryDocument(shipActor);
  if (!doc) return;
  await doc.update({ ownership: crewOwnershipMap(shipActor) });
}

export async function getShipLibrary(shipActor) {
  const doc = await findShipLibraryDocument(shipActor);
  return doc?.getFlag(SYSTEM_ID, "library")?.entries ?? [];
}

/**
 * Quem grava na Biblioteca da Nave: jogador não escreve em Compêndio (nem no documento de que é dono
 * lá dentro — achado da sessão 3, 21/11), então o pedido vai ao Mestre designado (`shipLibrary` no
 * relay), que confere se quem pede comanda a Nave ou um tripulante. Devolve `true` se gravou.
 */
async function writeShipLibrary(op, shipActor, data) {
  if (game.user.isGM) {
    if (op === "add") await addShipLibraryEntryAsGm(shipActor, data);
    else await removeShipLibraryEntryAsGm(shipActor, data.entryId);
    return true;
  }
  const outcome = await runAsGm("shipLibrary", { op, shipUuid: shipActor.uuid, ...data }, { reply: true });
  if (!outcome.ok) ui.notifications.warn(`Biblioteca da Nave: ${relayFailureMessage(outcome.reason)}`);
  return outcome.ok;
}

/** O jogador comanda esta Nave (dono dela ou de um tripulante)? */
export function commandsShip(user, shipActor) {
  if (!user || !shipActor) return false;
  if (user.isGM || shipActor.testUserPermission?.(user, "OWNER")) return true;
  return (shipActor.system?.crewActors ?? []).some(entry => entry.actor?.testUserPermission?.(user, "OWNER"));
}

export async function addShipLibraryEntry(shipActor, { label, uuid, note = "" }) {
  return writeShipLibrary("add", shipActor, { label, uuid, note });
}

export async function removeShipLibraryEntry(shipActor, entryId) {
  return writeShipLibrary("remove", shipActor, { entryId });
}

/** Só no Mestre (direto ou pelo relay). */
export async function addShipLibraryEntryAsGm(shipActor, { label, uuid, note = "" }) {
  const doc = await ensureShipLibraryDocument(shipActor);
  if (!doc) return;
  const entries = [
    ...(doc.getFlag(SYSTEM_ID, "library")?.entries ?? []),
    { id: foundry.utils.randomID(), label, uuid, note, addedAt: Date.now() }
  ];
  await doc.update({ [`flags.${SYSTEM_ID}.library.entries`]: entries });
  await pingShipLibrary(shipActor);
}

/**
 * Avisa os PADs abertos de que a Biblioteca da Nave mudou. O documento mora num compêndio e os outros clientes nem
 * sempre recebem o hook dele (achado da sessão 4, C4: a aba só repintava minutos depois); a Nave é um Ator comum e o
 * `updateActor` chega a todos, na ordem, depois da gravação do compêndio.
 */
async function pingShipLibrary(shipActor) {
  try {
    await shipActor.setFlag(SYSTEM_ID, "libraryTick", Date.now());
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Biblioteca da Nave: não consegui avisar os outros PADs.`, err);
  }
}

/** Só no Mestre (direto ou pelo relay). */
export async function removeShipLibraryEntryAsGm(shipActor, entryId) {
  const doc = await findShipLibraryDocument(shipActor);
  if (!doc) return;
  const entries = (doc.getFlag(SYSTEM_ID, "library")?.entries ?? []).filter(e => e.id !== entryId);
  await doc.update({ [`flags.${SYSTEM_ID}.library.entries`]: entries });
  await pingShipLibrary(shipActor);
}

/** Enriquece entradas (pessoal ou de Nave) com o documento resolvido, pra exibição — nome/img/tipo sempre vêm do `resolvedDoc` quando ele existe; `label` salvo é só o fallback pra quando o documento original foi apagado. */
export function resolveLibraryEntries(entries) {
  return entries.map(entry => ({ ...entry, resolvedDoc: fromUuidSync(entry.uuid) }));
}
