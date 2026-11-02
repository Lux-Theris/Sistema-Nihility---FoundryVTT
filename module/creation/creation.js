/**
 * Ficha em modo criação (backlog J10; design aprovado: artefato "Ficha em Modo Criação", v2).
 *
 * Não há assistente em janela à parte: a ficha real nasce em branco (ou o Mestre põe uma em modo
 * criação) e ganha uma faixa "Criando" dizendo o que falta. O jogador clica "Pronto para jogar", o
 * Mestre recebe um aviso na tela e libera (confirma os pontos, trava a Espécie, aprova os pedidos
 * de Skill que marcar) ou pede ajuste com um recado. Nenhuma regra de jogo nova.
 *
 * Regras puras em creation-rules.js. O estado mora em `system.creation` (ver character-model.js).
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isFeatureEnabled,
  isSkillPointsEnabled,
  isAttributePoolEnabled,
  isMovementEnabled,
  getActiveSpeciesPresets,
  getSpeciesForCreation,
  getVitalFormula,
  getVisibleAttributes,
  getAttributeLabel,
  getCharacterEnergyLabel,
  getActiveTraits,
  getDamageElement
} from "../core/config.js";
import { getInitiativeAttribute } from "../combat/combat.js";
import { buildAttributeRollFormula } from "../core/dice.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { showVoiceBanner } from "../core/voice-banner.js";
import { renderSystemTemplate } from "../helpers/foundry-compat.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import {
  creationSteps,
  creationStatusRow,
  skillSlots,
  vitalPreview,
  attributePurpose,
  speciesCardLines,
  speciesBlurb,
  quickSpread,
  QUICK_SPREADS
} from "./creation-rules.js";

const { DialogV2 } = foundry.applications.api;
const READY_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/creation-ready.hbs`;

/* ------------------------------------------------------------------ leitura */

export function isCreationEnabled() {
  return isFeatureEnabled("creationMode");
}

/** A ficha está em modo criação (e o bloco está ligado)? Desligar o bloco só esconde a faixa. */
export function inCreation(actor) {
  return actor?.type === "character" && Boolean(actor.system?.creation?.active) && isCreationEnabled();
}

/** Jogadores donos (não Mestre) da ficha. */
function playerOwners(actor) {
  return game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

function speciesEntry(id) {
  return id ? getActiveSpeciesPresets()[id] ?? null : null;
}

/** "Dragoide · Linhagem do Fogo" — vazio enquanto falta a Espécie (ou a Linhagem obrigatória). */
function originLabel(actor) {
  const entry = speciesEntry(actor.system.species);
  if (!entry) return "";
  const lineage = (entry.lineages ?? []).find(l => l.id === actor.system.lineage);
  if (entry.lineageRequired && entry.lineages?.length && !lineage) return "";
  return lineage ? `${entry.label} · ${lineage.label}` : entry.label;
}

/** Skills compradas com ponto, pedidos abertos e pontos que a ficha tem (para "Skills N/M"). */
async function skillCounts(actor) {
  const { openSkillRequests } = await import("../skills/skill-economy.js");
  const tiers = MEU_SISTEMA.SKILL_POINT_TIERS;
  const owned = actor.items.filter(i => i.type === "skill" && tiers.includes(i.system.tier) && !i.system.isItemGranted && !i.getFlag(SYSTEM_ID, "speciesGrant")).length;
  const pending = openSkillRequests(actor).length;
  const points = tiers.reduce((sum, t) => sum + (Number(actor.system.skillPoints?.[t]) || 0), 0);
  return skillSlots({ owned, pending, points });
}

/** Passos da faixa e se "Pronto" pode, para esta ficha. */
export async function creationProgress(actor) {
  const pool = actor.system.attributePointsPool;
  return creationSteps({
    name: actor.name,
    concept: actor.system.concept,
    speciesNeeded: Object.keys(getActiveSpeciesPresets()).length > 0,
    speciesLabel: originLabel(actor),
    pool: isAttributePoolEnabled() && pool ? { spent: pool.spent, total: pool.total } : null,
    skills: isSkillPointsEnabled() ? await skillCounts(actor) : null
  });
}

/** O painel "Ao confirmar" (prancha 2 B), com os rótulos prontos para a ficha. */
export function vitalPreviewFor(actor) {
  const formula = getVitalFormula();
  const combat = actor.system.attributes.combat;
  const read = Object.fromEntries(MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => [key, { total: combat[key]?.total ?? 0, pending: combat[key]?.pendingPoints ?? 0 }]));
  const preview = vitalPreview({ combat: read, formula, hpNow: actor.system.attributes.hp.max, energyNow: actor.system.attributes.energy.max });
  const line = (label, entry) =>
    entry && {
      label,
      now: entry.now,
      next: entry.next,
      changed: entry.next !== entry.now,
      formula: `${getAttributeLabel(entry.a.key)} ${entry.a.value} × ${getAttributeLabel(entry.b.key)} ${entry.b.value} × ${formula.multiplier}`
    };
  const initiativeKey = getInitiativeAttribute();
  const initiativeAttr = combat[initiativeKey];
  return {
    hp: line("Vida", preview.hp),
    energy: line(getCharacterEnergyLabel(), preview.energy),
    initiative: `${buildAttributeRollFormula(initiativeAttr?.previewBonus ?? initiativeAttr?.bonus ?? 0)} (${getAttributeLabel(initiativeKey)})`,
    movement: isMovementEnabled() ? `${actor.system.movement?.total ?? 0} m por rodada` : "",
    changed: preview.changed
  };
}

/** Contexto da frase de cada atributo: o que alimenta neste mundo. */
export function attributePurposeContext() {
  const formula = getVitalFormula();
  return {
    hpKeys: formula.hp,
    energyKeys: formula.energyEnabled ? formula.energy : [],
    energyLabel: getCharacterEnergyLabel(),
    initiativeKey: getInitiativeAttribute(),
    movement: isMovementEnabled()
  };
}

export { attributePurpose, QUICK_SPREADS };

/**
 * A aba Origem em modo criação (prancha 1 C): a grade de Espécies liberadas para criação, as
 * Linhagens da escolhida e o que ela traz. `pick` é o cartão marcado na tela (ainda não aplicado).
 */
export function originPicker(actor, pick = {}) {
  const catalog = getActiveSpeciesPresets();
  const traitLabel = id => getActiveTraits().find(t => t.id === id)?.label ?? id;
  const elementLabel = id => getDamageElement(id)?.label ?? id;
  const speciesId = pick.species ?? actor.system.species ?? "";
  const entry = catalog[speciesId] ?? null;
  const lineageId = pick.lineage ?? (speciesId === actor.system.species ? actor.system.lineage : "") ?? "";
  const lineage = entry?.lineages?.find(l => l.id === lineageId) ?? null;
  const groupLabels = MEU_SISTEMA.SPECIES_GROUP_LABELS;
  const cards = getSpeciesForCreation().map(({ key, label }) => {
    const e = catalog[key];
    return {
      key,
      label,
      nameLower: String(label).toLowerCase(),
      group: e?.group ?? "",
      blurb: speciesBlurb(e, { traitLabel }),
      lineages: e?.lineages?.length ?? 0,
      selected: key === speciesId,
      applied: key === actor.system.species
    };
  });
  const groups = [...new Set(cards.map(c => c.group))].map(id => ({ id, label: groupLabels[id] ?? "Outras" }));
  const appliedHere = Boolean(entry) && speciesId === actor.system.species && (lineageId || "") === (actor.system.lineage || "");
  const needsLineage = Boolean(entry?.lineageRequired && entry?.lineages?.length && !lineage);
  return {
    cards,
    groups: groups.length > 1 ? groups : [],
    selectedLabel: entry ? (lineage ? `${entry.label} · ${lineage.label}` : entry.label) : "",
    lineages: (entry?.lineages ?? []).map(l => ({
      id: l.id,
      label: l.label || l.id,
      blurb: speciesCardLines({ ...entry, skills: [], parts: [], traits: [] }, l, { traitLabel, elementLabel }).map(x => `${x.label} ${x.value}`).join(" · ") || l.description || "",
      selected: l.id === lineageId
    })),
    lines: speciesCardLines(entry, lineage, { traitLabel, elementLabel, level: actor.system.attributes?.level ?? 1 }),
    speciesId,
    lineageId: lineage?.id ?? "",
    canApply: Boolean(entry) && !appliedHere && !needsLineage,
    needsLineage,
    appliedHere
  };
}

/* ------------------------------------------------------------------ escrita: jogador */

/** "Começar de um jeito": preenche os pendentes com a distribuição (só se nada foi confirmado). */
export async function applyQuickSpread(actor, spreadId) {
  const spread = QUICK_SPREADS[spreadId];
  if (!spread || !isAttributePoolEnabled()) return;
  const combat = actor.system.attributes.combat;
  const pool = actor.system.attributePointsPool;
  const free = pool.total - MEU_SISTEMA.COMBAT_ATTRIBUTES.reduce((sum, key) => sum + (combat[key]?.points ?? 0), 0);
  const keys = getVisibleAttributes().map(a => a.key);
  const out = quickSpread(free, spread.weights, keys);
  const updates = {};
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) updates[`system.attributes.combat.${key}.pendingPoints`] = out[key] ?? 0;
  await actor.update(updates);
}

/** Jogador: "Pronto para jogar" (prancha 4). Avisa o Mestre na tela e deixa um card no chat. */
export async function markReady(actor) {
  if (!inCreation(actor) || !actor.isOwner) return;
  const progress = await creationProgress(actor);
  if (!progress.canReady) {
    ui.notifications.warn("Falta o nome ou a Espécie para dizer que está pronto.");
    return;
  }
  await actor.update({ "system.creation.status": "ready", "system.creation.readyAt": Date.now() });
  await postReadyCard(actor);
  ui.notifications.info("O Mestre foi avisado. Você ainda pode mexer: ele vê a versão mais nova.");
}

/** Jogador: "Voltar a editar" depois de "Pronto". */
export async function backToEditing(actor) {
  if (!inCreation(actor) || !actor.isOwner) return;
  await actor.update({ "system.creation.status": "editing" });
  await updateReadyCards(actor, "editing");
}

async function readySummary(actor) {
  const { openSkillRequests } = await import("../skills/skill-economy.js");
  const vitals = vitalPreviewFor(actor);
  const owner = playerOwners(actor)[0];
  const pending = openSkillRequests(actor).length;
  const parts = [originLabel(actor), `Vida ${vitals.hp.next}`, vitals.energy ? `${vitals.energy.label} ${vitals.energy.next}` : "", pending ? `${pending} pedido(s) de Skill aguardando` : ""].filter(Boolean);
  return `${owner ? `${owner.name} terminou o personagem. ` : ""}${parts.join(" · ")}.`;
}

async function readyCardContent(actor, status) {
  return renderSystemTemplate(READY_TEMPLATE, {
    name: actor.name,
    summary: await readySummary(actor),
    status,
    open: status === "ready",
    gmNote: actor.system.creation?.gmNote ?? ""
  });
}

async function postReadyCard(actor) {
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  if (!gmIds.length) return;
  const summary = await readySummary(actor);
  await ChatMessage.create({
    content: await readyCardContent(actor, "ready"),
    whisper: gmIds,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SYSTEM_ID]: { creationReady: { actorUuid: actor.uuid, status: "ready", title: `${actor.name} está pronto`, summary } } }
  });
}

/** Regrava os cards "está pronto" desta ficha (só o Mestre, ou o autor, pode regravar). */
async function updateReadyCards(actor, status) {
  for (const message of game.messages.contents) {
    const flag = message.flags?.[SYSTEM_ID]?.creationReady;
    if (!flag || flag.actorUuid !== actor.uuid || flag.status === "released" || !message.isOwner) continue;
    await message.update({ content: await readyCardContent(actor, status), [`flags.${SYSTEM_ID}.creationReady.status`]: status });
  }
}

/* ------------------------------------------------------------------ escrita: Mestre */

/** Mestre: "Pôr em modo criação" (menu ⋮ da ficha). Não apaga nada; devolve a Espécie ao jogador. */
export async function enterCreation(actor) {
  if (!game.user.isGM || actor?.type !== "character") return;
  await actor.update({
    "system.creation": { active: true, status: "editing", gmNote: "", readyAt: null },
    "system.speciesState.unlocked": true
  });
  ui.notifications.info(`${actor.name} está em modo criação: a faixa aparece na ficha.`);
}

/** Mestre: "Pedir ajuste…" — recado que aparece na faixa do jogador e na tela dele. */
export async function requestAdjustment(actor) {
  if (!game.user.isGM || !inCreation(actor)) return;
  const owner = playerOwners(actor)[0];
  const note = await DialogV2.wait({
    window: { title: `Pedir ajuste: ${actor.name}` },
    content: `<div class="nihility-creation-dialog"><p>O que ${escapeHtml(owner?.name ?? "o jogador")} deve mudar?</p><textarea name="note" rows="3"></textarea></div>`,
    buttons: [
      { action: "send", label: "Enviar", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=note]").value.trim() },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  if (typeof note !== "string" || !note) return;
  await actor.update({ "system.creation.status": "adjust", "system.creation.gmNote": note });
  await updateReadyCards(actor, "adjust");
  await announceVoiceOfTheWorld(actor, { kind: "creation-adjust", title: `Ajuste pedido em ${actor.name}`, body: `O Mestre pediu: "${note}"` });
}

/**
 * Mestre: "Liberar…" (prancha 4 C). Confirma os pontos pendentes (o que trava a Espécie), aprova
 * os pedidos de Skill marcados e tira a ficha do modo criação.
 */
export async function releaseCharacter(actor) {
  if (!game.user.isGM || actor?.type !== "character") return;
  const { openSkillRequests, approveSkillCreationRequest } = await import("../skills/skill-economy.js");
  const combat = actor.system.attributes.combat;
  const pending = MEU_SISTEMA.COMBAT_ATTRIBUTES.reduce((sum, key) => sum + (combat[key]?.pendingPoints ?? 0), 0);
  const requests = openSkillRequests(actor);
  const freePoints = MEU_SISTEMA.SKILL_POINT_TIERS.reduce((sum, t) => sum + (Number(actor.system.skillPoints?.[t]) || 0), 0) - requests.length;
  const requestRows = requests
    .map(m => {
      const req = m.flags[SYSTEM_ID].skillRequest;
      return `<label class="nc-check"><input type="checkbox" name="approve" value="${escapeHtml(m.id)}" checked/> Aprovar "${escapeHtml(req.name)}" junto</label>`;
    })
    .join("");
  const chosen = await DialogV2.wait({
    window: { title: `Liberar ${actor.name} para jogar` },
    classes: ["nihility-creation-release"],
    content: `<div class="nihility-creation-dialog">
      <p class="nc-lab">Vai acontecer</p>
      <p>✓ ${pending ? `Confirmar os ${pending} ponto(s) de atributo pendentes (trava a Espécie)` : "Travar a Espécie (não há pontos pendentes)"}</p>
      <p>✓ Sair do modo criação</p>
      ${requestRows ? `<p class="nc-lab">Pedidos de Skill ainda abertos</p>${requestRows}` : ""}
      ${freePoints > 0 ? `<p class="hint-inline">${freePoints} Ponto(s) de Habilidade fica(m) livre(s) para pedir depois.</p>` : ""}
    </div>`,
    buttons: [
      { action: "release", label: "Liberar", default: true, callback: (event, button, dialog) => [...dialog.element.querySelectorAll("[name=approve]:checked")].map(i => i.value) },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  if (!Array.isArray(chosen)) return;

  const updates = {
    "system.speciesState.lockedAt": actor.system.speciesState?.lockedAt ?? Date.now(),
    "system.speciesState.unlocked": false,
    "system.creation": { active: false, status: "editing", gmNote: "", readyAt: null }
  };
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const p = combat[key]?.pendingPoints ?? 0;
    if (!p) continue;
    updates[`system.attributes.combat.${key}.points`] = (combat[key].points ?? 0) + p;
    updates[`system.attributes.combat.${key}.pendingPoints`] = 0;
  }
  await actor.update(updates);
  // Ficha nova: Vida e Mana cheias com os pontos de verdade.
  await actor.update({ "system.attributes.hp.value": actor.system.attributes.hp.max, "system.attributes.energy.value": actor.system.attributes.energy.max });

  for (const id of chosen) {
    const message = game.messages.get(id);
    if (!message) continue;
    try {
      await approveSkillCreationRequest(message);
    } catch (err) {
      reportError(`Falha ao aprovar um pedido de Skill de ${actor.name}.`, err);
    }
  }
  await updateReadyCards(actor, "released");
  await announceVoiceOfTheWorld(actor, { kind: "creation-released", title: `${actor.name} está pronto para jogar`, body: "O Mestre liberou o personagem." });
}

/* ------------------------------------------------------------------ fichas novas */

/** Dados de uma ficha nova em modo criação. `userId` vazio = sem dono (NPC do Mestre). */
function newCharacterData(userId) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  if (userId) ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  return {
    name: "Novo personagem",
    type: "character",
    ownership,
    system: { isPlayerCharacter: Boolean(userId), creation: { active: true, status: "editing" } }
  };
}

/** A ficha em criação que este usuário já tem, se tiver (uma por jogador, prancha 5). */
export function creationSheetOf(user) {
  return game.actors.find(a => a.type === "character" && a.system.creation?.active && !user.isGM && a.testUserPermission(user, "OWNER")) ?? null;
}

async function createFor(user) {
  const actor = await Actor.implementation.create(newCharacterData(user?.id ?? ""));
  if (!actor) return null;
  // Personagem de jogador: Token vinculado e amigável. Feito depois para o preCreateActor ainda pôr
  // as barras de Vida/Mana (ele só põe quando a criação não traz um Token próprio).
  await actor.update({ "prototypeToken.actorLink": Boolean(user), "prototypeToken.disposition": user ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE });
  if (user && !user.character) await user.update({ character: actor.id });
  return actor;
}

/**
 * Relay `createCharacter` (no Mestre designado): o jogador pede, o Mestre cria a ficha em branco
 * que já é dele. Uma em criação por jogador — pedir de novo devolve a que existe.
 */
export async function createCharacterAsGm(payload, user) {
  if (!isCreationEnabled()) return { ok: false, reason: "o modo criação está desligado neste mundo" };
  if (!user || user.isGM) return { ok: false, reason: "invalid" };
  const existing = creationSheetOf(user);
  if (existing) return { ok: true, value: { uuid: existing.uuid } };
  const actor = await createFor(user);
  return actor ? { ok: true, value: { uuid: actor.uuid } } : { ok: false, reason: "o Foundry não criou a ficha" };
}

/** Espera o Ator chegar neste cliente (a criação vem pelo socket, às vezes depois da resposta). */
async function waitForActor(uuid, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const actor = fromUuidSync(uuid);
    if (actor) return actor;
    await new Promise(r => setTimeout(r, 100));
  }
  return fromUuidSync(uuid);
}

/** Jogador: "+ Criar personagem" (Menu › Fichas). Sem Mestre conectado, não dá. */
export async function requestNewCharacter() {
  const existing = creationSheetOf(game.user);
  if (existing) return existing.sheet.render(true);
  const { runAsGm } = await import("../helpers/gm-relay.js");
  const { relayFailureMessage } = await import("../helpers/gm-relay-rules.js");
  const outcome = await runAsGm("createCharacter", {}, { reply: true, timeout: 10000 });
  if (!outcome?.ok) {
    ui.notifications.warn(relayFailureMessage(outcome, "criar a ficha") ?? "Não deu para criar a ficha.");
    return null;
  }
  const actor = await waitForActor(outcome.value?.uuid);
  if (actor) actor.sheet.render(true);
  return actor;
}

/** Mestre: "+ Criar personagem para [jogador / Ninguém]". */
export async function createCharacterFor(userId) {
  if (!game.user.isGM) return null;
  const user = userId ? game.users.get(userId) : null;
  const actor = await createFor(user && !user.isGM ? user : null);
  actor?.sheet.render(true);
  return actor;
}

/** A lista "Em criação" do Mestre (prancha 5 B). */
export async function creationListForGm() {
  const rows = [];
  for (const actor of game.actors.filter(a => a.type === "character" && a.system.creation?.active)) {
    const progress = await creationProgress(actor);
    const status = creationStatusRow(actor.system.creation.status, progress.doneCount, progress.total);
    rows.push({ id: actor.id, name: actor.name, img: actor.img, owner: playerOwners(actor)[0]?.name ?? "sem dono", status, waiting: actor.system.creation.status === "ready" });
  }
  return rows.sort((a, b) => Number(b.waiting) - Number(a.waiting) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ hooks */

function rerenderSheetsOf(uuid) {
  const actor = uuid ? fromUuidSync(uuid) : null;
  if (actor?.sheet?.rendered) actor.sheet.render();
}

function onRequestMessage(message) {
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (req) rerenderSheetsOf(req.actorUuid ?? (req.actorId ? `Actor.${req.actorId}` : ""));
}

/** O aviso "Kael está pronto" na tela do Mestre (prancha 4 B), com os três botões. */
function onReadyMessage(message) {
  const flag = message.flags?.[SYSTEM_ID]?.creationReady;
  if (!flag || flag.status !== "ready" || !game.user.isGM) return;
  const actor = fromUuidSync(flag.actorUuid);
  if (!actor) return;
  showVoiceBanner({
    label: "Criação de personagem",
    title: flag.title ?? `${actor.name} está pronto`,
    body: flag.summary ?? "",
    actions: [
      { label: "Abrir ficha", onClick: () => actor.sheet.render(true) },
      { label: "Pedir ajuste…", onClick: () => requestAdjustment(actor) },
      { label: "Liberar…", primary: true, onClick: () => releaseCharacter(actor) }
    ]
  });
}

/** Botões do card "está pronto" no chat (o mesmo que o aviso, para quem perdeu o aviso). */
export function renderCreationReadyControls(message, html) {
  const flag = message.flags?.[SYSTEM_ID]?.creationReady;
  if (!flag) return;
  if (!game.user.isGM) {
    html.querySelectorAll(".ncr-actions").forEach(el => el.remove());
    return;
  }
  const actor = () => fromUuidSync(flag.actorUuid);
  const handlers = {
    open: () => actor()?.sheet.render(true),
    adjust: () => actor() && requestAdjustment(actor()),
    release: () => actor() && releaseCharacter(actor())
  };
  html.querySelectorAll("[data-ncr]").forEach(el =>
    el.addEventListener("click", event => {
      event.preventDefault();
      handlers[el.dataset.ncr]?.();
    })
  );
}

/**
 * Só o Mestre liga/desliga o modo criação e escreve o recado; o jogador só alterna entre
 * "editando" e "pronto". O jogador também não confirma pontos enquanto está em criação (quem
 * confirma é a liberação) — o botão some, e isto segura o resto.
 */
function guardCreationWrites(actor, changes, options, userId) {
  if (actor.type !== "character" || game.users.get(userId)?.isGM) return;
  const creation = changes.system?.creation;
  if (creation) {
    delete creation.active;
    delete creation.gmNote;
    if (creation.status !== undefined && !["editing", "ready"].includes(creation.status)) delete creation.status;
    if (creation.status === "ready" && actor.system.creation?.status === "ready") delete creation.status;
  }
  // Com o Pool desligado os pontos são digitados à mão: aí não há "Confirmar" para segurar.
  if (actor.system.creation?.active && isCreationEnabled() && isAttributePoolEnabled()) {
    const combat = changes.system?.attributes?.combat;
    if (combat) for (const attr of Object.values(combat)) if (attr && typeof attr === "object") delete attr.points;
    if (changes.system?.speciesState) delete changes.system.speciesState.lockedAt;
  }
}

export function registerCreationHooks() {
  Hooks.on("preUpdateActor", guardCreationWrites);
  Hooks.on("createChatMessage", onRequestMessage);
  Hooks.on("updateChatMessage", onRequestMessage);
  Hooks.on("deleteChatMessage", onRequestMessage);
  Hooks.on("createChatMessage", onReadyMessage);
}
