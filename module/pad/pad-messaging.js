/**
 * PAD (Fase 4) — Mensagens (estilo WhatsApp) entre Personagens, diretas e em grupo. Guarda cada
 * mensagem como uma `ChatMessage` nativa (`whisper` + dados estruturados em `flags`), o mesmo
 * mecanismo já usado por `voice-of-the-world.js` pra "Voz do Mundo" — sem precisar de nenhum
 * socket customizado, a replicação entre clientes já vem de graça do próprio `ChatMessage.create`.
 * O card fica escondido do log de chat padrão por `renderChatMessage` em nihility-rpg-system.js;
 * o PAD lê direto de `game.messages`, independente do DOM do log.
 *
 * Grupos precisam de uma entidade PERSISTIDA separada das mensagens (uma conversa vazia recém-
 * criada, ou a lista de membros, não dá pra derivar só olhando mensagens já enviadas) — mesmo
 * padrão de `pad-library.js`: um `JournalEntry` por grupo num Compêndio de Mundo oculto, dados só
 * em `flags`, `ownership` sincronizada com os membros atuais.
 *
 * Mestre é sempre incluído no whisper de toda mensagem, direta ou de grupo, independente de sua
 * persona atual constar como membro — "membro invisível" de qualquer conversa (mesma convenção de
 * privacidade já estabelecida em `voice-of-the-world.js`, ver CLAUDE.md).
 */
import { SYSTEM_ID, MEU_SISTEMA, sceneActorCandidates } from "../config.js";
import { findCrewedShipsForActor } from "./pad-crew.js";

const GROUPS_PACK_COLLECTION = `world.${MEU_SISTEMA.COMPENDIUM.padGroups.key}`;

function getGroupsPack() {
  return game.packs.get(GROUPS_PACK_COLLECTION) ?? null;
}

function gmUserIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

function owningUserIds(actor) {
  return game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** Chave de thread determinística pra uma conversa direta — os dois lados chegam na mesma sem tabela de lookup. */
export function directThreadId(uuidA, uuidB) {
  return [uuidA, uuidB].sort().join("::");
}

/* ---------- Envio ---------- */

async function createPadMessage({ threadId, senderActorUuid, senderName, recipientActorUuids, groupId, conversationType, body, whisper }) {
  await ChatMessage.create({
    content: `<div class="pad-chat-card"><strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(body)}</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: fromUuidSync(senderActorUuid) }),
    flags: {
      [SYSTEM_ID]: {
        padMessage: {
          id: foundry.utils.randomID(),
          threadId,
          senderActorUuid,
          senderName,
          recipientActorUuids,
          groupId,
          conversationType,
          body,
          createdAt: Date.now()
        }
      }
    }
  });
}

export async function sendDirectMessage(senderActor, recipientActor, body) {
  const whisper = Array.from(new Set([...gmUserIds(), ...owningUserIds(senderActor), ...owningUserIds(recipientActor)]));
  await createPadMessage({
    threadId: directThreadId(senderActor.uuid, recipientActor.uuid),
    senderActorUuid: senderActor.uuid,
    senderName: senderActor.name,
    recipientActorUuids: [recipientActor.uuid],
    groupId: null,
    conversationType: "direct",
    body,
    whisper
  });
}

export async function sendGroupMessage(senderActor, groupId, body) {
  const group = await getGroup(groupId);
  if (!group) return;
  const memberActors = group.memberActorUuids.map(uuid => fromUuidSync(uuid)).filter(Boolean);
  const whisper = Array.from(new Set([...gmUserIds(), ...memberActors.flatMap(owningUserIds)]));
  await createPadMessage({
    threadId: groupId,
    senderActorUuid: senderActor.uuid,
    senderName: senderActor.name,
    recipientActorUuids: group.memberActorUuids,
    groupId,
    conversationType: "group",
    body,
    whisper
  });
}

/* ---------- Leitura ---------- */

export function getThreadMessages(threadId) {
  return game.messages.contents
    .map(m => m.getFlag(SYSTEM_ID, "padMessage"))
    .filter(pm => pm?.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Conversas diretas (a partir de mensagens já trocadas) + Grupos (mesmo sem mensagem ainda) que envolvem este Ator, mais recente primeiro. */
export async function getRecentThreadsFor(actor) {
  const directByThread = new Map();
  for (const m of game.messages.contents) {
    const pm = m.getFlag(SYSTEM_ID, "padMessage");
    if (!pm || pm.conversationType !== "direct") continue;
    const isSender = pm.senderActorUuid === actor.uuid;
    if (!isSender && !pm.recipientActorUuids.includes(actor.uuid)) continue;
    const existing = directByThread.get(pm.threadId);
    if (existing && existing.lastMessage.createdAt >= pm.createdAt) continue;
    directByThread.set(pm.threadId, {
      threadId: pm.threadId,
      conversationType: "direct",
      otherActorUuid: isSender ? pm.recipientActorUuids[0] : pm.senderActorUuid,
      lastMessage: pm
    });
  }

  const groups = await getGroupsFor(actor);
  const groupThreads = groups.map(group => {
    const lastMessage = getThreadMessages(group.groupId).at(-1) ?? null;
    return { threadId: group.groupId, conversationType: "group", groupId: group.groupId, groupName: group.groupName, lastMessage };
  });

  return [...directByThread.values(), ...groupThreads]
    .sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
}

/**
 * Contatos disponíveis pro Ator iniciar uma conversa direta ou compor um grupo: todo PJ visível
 * (`LIMITED`+) mais sempre os tripulantes das Naves atuais (mesmo que a visibilidade padrão não
 * cubra — tripulante deveria sempre ser alcançável), mais NPCs só quando quem está operando o
 * PAD é o Mestre (`includeNpcs`, ver seletor de persona em nihility-pad.js) — jogador comum nunca
 * vê NPC "de graça" na lista. `getSavedContacts` entra por cima de tudo isso: um contato salvo
 * (via `shareContactWithScene`/`addSavedContact`) sempre aparece, mesmo um NPC que um jogador
 * comum não veria pela regra padrão — é assim que o "compartilhar contato" fura essa regra de
 * propósito.
 */
export function getContactsFor(actor, { includeNpcs = game.user.isGM } = {}) {
  const pcs = game.actors.filter(a =>
    a.type === "character" && a.system.isPlayerCharacter === true &&
    a.id !== actor.id && a.testUserPermission(game.user, "LIMITED")
  );
  const crewmates = findCrewedShipsForActor(actor)
    .flatMap(ship => ship.system.crewActors.map(entry => entry.actor))
    .filter(a => a.id !== actor.id);
  const npcs = includeNpcs
    ? game.actors.filter(a => a.type === "character" && a.system.isPlayerCharacter === false && a.id !== actor.id)
    : [];
  const saved = getSavedContacts(actor).map(uuid => fromUuidSync(uuid)).filter(a => a && a.id !== actor.id);

  const seen = new Set();
  return [...pcs, ...crewmates, ...npcs, ...saved].filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

/* ---------- Contatos salvos (flag no Actor, mesmo padrão da Biblioteca Pessoal) ---------- */

export function getSavedContacts(actor) {
  return actor.getFlag(SYSTEM_ID, "padContacts") ?? [];
}

export async function addSavedContact(actor, contactActorUuid) {
  const current = getSavedContacts(actor);
  if (current.includes(contactActorUuid)) return;
  await actor.setFlag(SYSTEM_ID, "padContacts", [...current, contactActorUuid]);
}

export async function removeSavedContact(actor, contactActorUuid) {
  await actor.setFlag(SYSTEM_ID, "padContacts", getSavedContacts(actor).filter(uuid => uuid !== contactActorUuid));
}

/* ---------- Compartilhar contato com a cena atual ---------- */

/**
 * Compartilha o contato da persona atual com todo Personagem (PJ ou NPC) que tiver Token na cena
 * atual — `permission:"NONE"` em `sceneActorCandidates` de propósito: quem compartilha não
 * precisa ter permissão de OBSERVER sobre quem recebe, só precisa que ambos estejam na mesma
 * cena. Cada destinatário decide se adiciona (ver `getPendingContactShares`/`addSavedContact`) —
 * não é automático, senão um jogador não teria como recusar um contato indesejado.
 */
export async function shareContactWithScene(senderActor) {
  const recipients = sceneActorCandidates({ types: ["character"], excludeActorId: senderActor.id, permission: "NONE" });
  if (!recipients.length) {
    ui.notifications.warn("Nenhum outro Personagem na cena atual pra compartilhar o contato.");
    return false;
  }

  const whisper = Array.from(new Set([...gmUserIds(), ...owningUserIds(senderActor), ...recipients.flatMap(owningUserIds)]));
  await ChatMessage.create({
    content: `<div class="pad-chat-card">${escapeHtml(senderActor.name)} compartilhou o contato com a cena.</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: senderActor }),
    flags: {
      [SYSTEM_ID]: {
        padContactShare: {
          id: foundry.utils.randomID(),
          senderActorUuid: senderActor.uuid,
          senderName: senderActor.name,
          senderImg: senderActor.img,
          recipientActorUuids: recipients.map(a => a.uuid),
          createdAt: Date.now()
        }
      }
    }
  });
  return true;
}

/** Compartilhamentos de contato recebidos por este Ator que ainda não foram adicionados aos contatos salvos. */
export function getPendingContactShares(actor) {
  const saved = new Set(getSavedContacts(actor));
  const seenSenders = new Set();
  const pending = [];
  for (const m of game.messages.contents) {
    const share = m.getFlag(SYSTEM_ID, "padContactShare");
    if (!share || share.senderActorUuid === actor.uuid) continue;
    if (!share.recipientActorUuids.includes(actor.uuid)) continue;
    if (saved.has(share.senderActorUuid) || seenSenders.has(share.senderActorUuid)) continue;
    seenSenders.add(share.senderActorUuid);
    pending.push(share);
  }
  return pending.sort((a, b) => b.createdAt - a.createdAt);
}

/* ---------- Grupos (JournalEntry num Compêndio de Mundo oculto + ownership por documento) ---------- */

function groupOwnershipMap(memberActorUuids) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const uuid of memberActorUuids) {
    const actor = fromUuidSync(uuid);
    if (!actor) continue;
    for (const userId of owningUserIds(actor)) ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }
  return ownership;
}

async function findGroupDocument(groupId) {
  const pack = getGroupsPack();
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ["flags"] });
  const entry = index.find(e => e.flags?.[SYSTEM_ID]?.group?.groupId === groupId);
  return entry ? pack.getDocument(entry._id) : null;
}

export async function getGroup(groupId) {
  const doc = await findGroupDocument(groupId);
  return doc?.getFlag(SYSTEM_ID, "group") ?? null;
}

/** Nave/Veículo NÃO participa de grupo — grupos são só entre Personagens (PJ ou NPC). */
export async function createGroup({ name, memberActorUuids, creatorActor }) {
  const pack = getGroupsPack();
  if (!pack) return null;

  const groupId = foundry.utils.randomID();
  const memberSet = Array.from(new Set([...memberActorUuids, creatorActor.uuid]));
  const [doc] = await pack.documentClass.createDocuments([{
    name: `Grupo — ${name}`,
    ownership: groupOwnershipMap(memberSet),
    flags: {
      [SYSTEM_ID]: {
        group: { groupId, groupName: name, memberActorUuids: memberSet, createdByActorUuid: creatorActor.uuid, createdAt: Date.now() }
      }
    }
  }], { pack: pack.collection });

  return doc?.getFlag(SYSTEM_ID, "group") ?? null;
}

export async function addGroupMember(groupId, actorUuid) {
  const doc = await findGroupDocument(groupId);
  if (!doc) return;
  const group = doc.getFlag(SYSTEM_ID, "group");
  if (group.memberActorUuids.includes(actorUuid)) return;
  const memberActorUuids = [...group.memberActorUuids, actorUuid];
  await doc.update({ [`flags.${SYSTEM_ID}.group.memberActorUuids`]: memberActorUuids, ownership: groupOwnershipMap(memberActorUuids) });
}

export async function removeGroupMember(groupId, actorUuid) {
  const doc = await findGroupDocument(groupId);
  if (!doc) return;
  const group = doc.getFlag(SYSTEM_ID, "group");
  const memberActorUuids = group.memberActorUuids.filter(uuid => uuid !== actorUuid);
  await doc.update({ [`flags.${SYSTEM_ID}.group.memberActorUuids`]: memberActorUuids, ownership: groupOwnershipMap(memberActorUuids) });
}

export async function renameGroup(groupId, name) {
  const doc = await findGroupDocument(groupId);
  if (!doc) return;
  await doc.update({ name: `Grupo — ${name}`, [`flags.${SYSTEM_ID}.group.groupName`]: name });
}

export async function getGroupsFor(actor) {
  const pack = getGroupsPack();
  if (!pack) return [];
  const index = await pack.getIndex({ fields: ["flags"] });
  return index
    .map(e => e.flags?.[SYSTEM_ID]?.group)
    .filter(group => group && group.memberActorUuids.includes(actor.uuid));
}
