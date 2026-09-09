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
import { SYSTEM_ID, MEU_SISTEMA } from "../config.js";

const LIBRARY_PACK_COLLECTION = `world.${MEU_SISTEMA.COMPENDIUM.padLibrary.key}`;

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

export async function addShipLibraryEntry(shipActor, { label, uuid, note = "" }) {
  const doc = await ensureShipLibraryDocument(shipActor);
  if (!doc) return;
  const entries = [
    ...(doc.getFlag(SYSTEM_ID, "library")?.entries ?? []),
    { id: foundry.utils.randomID(), label, uuid, note, addedAt: Date.now() }
  ];
  await doc.update({ [`flags.${SYSTEM_ID}.library.entries`]: entries });
}

export async function removeShipLibraryEntry(shipActor, entryId) {
  const doc = await findShipLibraryDocument(shipActor);
  if (!doc) return;
  const entries = (doc.getFlag(SYSTEM_ID, "library")?.entries ?? []).filter(e => e.id !== entryId);
  await doc.update({ [`flags.${SYSTEM_ID}.library.entries`]: entries });
}

/** Enriquece entradas (pessoal ou de Nave) com o documento resolvido, pra exibição — nome/img/tipo sempre vêm do `resolvedDoc` quando ele existe; `label` salvo é só o fallback pra quando o documento original foi apagado. */
export function resolveLibraryEntries(entries) {
  return entries.map(entry => ({ ...entry, resolvedDoc: fromUuidSync(entry.uuid) }));
}
