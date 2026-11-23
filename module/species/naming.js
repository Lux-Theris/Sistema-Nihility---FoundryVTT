import { SYSTEM_ID, NIHILITY, isNamingEnabled, getNamingConfig, getXpForNextLevel, getFeatureOption, getEnergyLabelForActor, getCharacterEnergyLabel } from "../core/config.js";
import { runAsGm, mayActFor } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { autoSnapshot } from "../world/auto-snapshot.js";
import { knockUnconscious } from "../combat/incapacitation.js";
import { computeResistanceName, resistanceMaxLevel } from "../combat/resistance.js";
import { isFormActor, isFormTemplate } from "../skills/forms.js";
import { linkActors, registerBorrowedSheetRefresh } from "../skills/borrowed-skills.js";
import { getHeritageEntry } from "./origin.js";
import { getSpeciesEntry, changeActorHeritage, openEvolution } from "./species.js";
import {
  namingCost, namingOutcome, namingXpTotal, soulShare, xpGainFromChange, cleanNamingName, namingBlockReason, namingXpDistribution, namingPreviewLine
} from "./naming-rules.js";

/**
 * Nomeação (7a.1). Quem nomeia perde Mana máxima para sempre (`energy.namedLoss`); o nomeado ganha ficha
 * própria, a Herança "Nomeado", XP nas Skills (o que não cabe fica guardado: `namingXpBank`) e passa a
 * estar ligado a quem o nomeou pelo Corredor de alma (`soulLink`/`soulLinks` e as Skills emprestadas,
 * ver skills/borrowed-skills.js). Regras puras em naming-rules.js. Jogador pede, o Mestre aprova; o
 * Mestre pelo HUD aplica direto. Tudo que grava roda no cliente do Mestre.
 */

const BANK_FLAG = "namingXpBank";

/* ------------------------------------------------------------------ Leituras */

function actorByUuid(uuid) {
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
}

/** Quem nomeou este Ator (flag `soulLink`), ou null. */
export const soulLinkOf = actor => actor?.getFlag?.(SYSTEM_ID, "soulLink") ?? null;

/** O XP da Nomeação guardado (o que não coube em nenhuma Skill). */
export const namingBankOf = actor => Math.max(0, Math.floor(Number(actor?.getFlag?.(SYSTEM_ID, BANK_FLAG)) || 0));

/** `{blocked, cap}` de uma Skill para o XP da Nomeação: concedida por Item e Maestria evoluída não sobem; Resistência e Maestria têm teto. */
function skillXpLimits(skill) {
  const sys = skill.system;
  if (sys.isItemGranted) return { blocked: true };
  if (sys.weaponMastery) {
    if ((Number(sys.masteryRank) || 1) >= 2) return { blocked: true };
    return { cap: Math.max(1, Number(getFeatureOption("weaponMastery", "masteryMaxLevel")) || 10) };
  }
  if (sys.resistanceTarget) return { cap: resistanceMaxLevel(sys.resistanceTarget) };
  return {};
}

function skillInputs(actor) {
  return actor.items
    .filter(i => i.type === "skill")
    .map(skill => ({ id: skill.id, level: Number(skill.system.level) || 1, xp: Number(skill._source?.system?.xp ?? skill.system.xp) || 0, ...skillXpLimits(skill) }));
}

/** Soma dos `total` dos atributos de combate (o que mede a "força" do nomeado). */
function attributeTotals(actor) {
  const combat = actor.system.attributes?.combat ?? {};
  return NIHILITY.COMBAT_ATTRIBUTES.map(key => Number(combat[key]?.total) || 0);
}

/** A prévia do que a Nomeação faria agora (cliente ou Mestre). */
export function namingPreview(namer, named) {
  const cfg = getNamingConfig();
  const cost = namingCost(attributeTotals(named), cfg.manaFactor);
  const outcome = namingOutcome(Number(namer.system.attributes?.energy?.max) || 0, cost);
  const totalXp = namingXpTotal(cost, cfg.xpFactor);
  const inputs = skillInputs(named);
  const dist = namingXpDistribution(inputs, outcome.ok ? totalXp : 0, { xpForLevel: getXpForNextLevel });
  const lines = dist.updates.map(update => {
    const skill = named.items.get(update.id);
    return namingPreviewLine(skill?.name ?? "?", update, inputs.find(i => i.id === update.id));
  });
  return { cost, outcome, totalXp, updates: dist.updates, leftover: dist.leftover, lines, namerMax: Number(namer.system.attributes?.energy?.max) || 0 };
}

function previewHtml(namer, named, preview) {
  const energy = escapeHtml(getEnergyLabelForActor(namer));
  if (!preview.outcome.ok) {
    return `<p><strong>Vai falhar:</strong> o máximo de ${energy} de ${escapeHtml(namer.name)} é ${preview.namerMax} e a Nomeação custa ${preview.cost}. ${escapeHtml(namer.name)} fica sem ${energy} e cai Inconsciente; nada mais muda.</p>`;
  }
  const rows = preview.lines.map(line => `<li>${escapeHtml(line)}</li>`).join("");
  const costLine = preview.cost > 0
    ? `<p>${escapeHtml(namer.name)} perde <strong>${preview.cost}</strong> do máximo de ${energy} para sempre.</p>`
    : `<p>Dar este nome não custa nada a ${escapeHtml(namer.name)}: ${escapeHtml(named.name)} não tem atributos de combate.</p>`;
  const xpLine = preview.totalXp > 0
    ? `<p>${escapeHtml(named.name)} recebe <strong>${preview.totalXp}</strong> de XP nas Skills${preview.leftover ? ` (sobram ${preview.leftover}, guardados para Evoluir uma Skill)` : ""}.</p>`
    : `<p>${escapeHtml(named.name)} não recebe XP nas Skills.</p>`;
  return `${costLine}${xpLine}${rows ? `<ul>${rows}</ul>` : ""}`;
}

/* ------------------------------------------------------------------ Pedido (Token HUD) */

function namerCandidates(target) {
  return game.actors.filter(a => a.type === "character" && a.uuid !== target.uuid && !isFormTemplate(a) && !isFormActor(a) && (game.user.isGM || a.isOwner));
}

/** Quem nomeia por padrão: o Token controlado (que não é o alvo), senão o personagem do usuário. */
function defaultNamer(target, candidates) {
  const controlled = canvas?.tokens?.controlled?.map(t => t.actor).find(a => a && a.uuid !== target.uuid && candidates.some(c => c.uuid === a.uuid));
  if (controlled) return controlled;
  const mine = game.user.character;
  return mine && candidates.some(c => c.uuid === mine.uuid) ? mine : candidates[0] ?? null;
}

async function promptNaming(target, candidates, defaultActor) {
  const options = candidates.map(a => `<option value="${escapeHtml(a.uuid)}" ${a.uuid === defaultActor?.uuid ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
  // Conteúdo num <div>, nunca <form>: o DialogV2 já embrulha num form.
  return foundry.applications.api.DialogV2.wait({
    window: { title: `Nomear — ${target.name}` },
    content: `<div class="nihility-naming-dialog">
      <div class="form-group"><label>Novo nome</label><input type="text" name="newName" maxlength="80" autofocus/></div>
      <div class="form-group"><label>Quem nomeia</label><select name="namer">${options}</select></div>
      <p class="hint-inline">Quem nomeia perde parte do máximo de ${escapeHtml(getCharacterEnergyLabel())} para sempre. ${game.user.isGM ? "Você aplica direto, depois de ver a prévia." : "O Mestre precisa aprovar."}</p>
    </div>`,
    buttons: [
      {
        action: "send",
        label: game.user.isGM ? "Continuar" : "Enviar",
        default: true,
        callback: (event, button, dialog) => ({ name: cleanNamingName(dialog.element.querySelector("[name=newName]").value), namerUuid: dialog.element.querySelector("[name=namer]").value })
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
}

/** O motivo de este Token não poder ser nomeado agora, ou null. */
function blockReasonFor(actor, namerUuid = "") {
  return namingBlockReason({
    isCharacter: actor?.type === "character",
    isFormTemplate: isFormTemplate(actor),
    isFormActor: isFormActor(actor),
    alreadyNamed: Boolean(soulLinkOf(actor)),
    sameAsNamer: Boolean(namerUuid) && actor?.uuid === namerUuid
  });
}

/** Clique em "Nomear" no HUD. */
export async function requestNaming(tokenDoc) {
  if (!isNamingEnabled()) return;
  const target = tokenDoc?.actor;
  const reason = blockReasonFor(target);
  if (reason) {
    ui.notifications.warn(`${target?.name ?? "Este Token"}: ${reason}.`);
    return;
  }
  const candidates = namerCandidates(target);
  if (!candidates.length) {
    ui.notifications.warn("Não há personagem seu para nomear.");
    return;
  }
  const asked = await promptNaming(target, candidates, defaultNamer(target, candidates));
  if (!asked) return;
  if (!asked.name) {
    ui.notifications.warn("Escreva o novo nome.");
    return;
  }
  const namer = actorByUuid(asked.namerUuid);
  if (!namer) return;
  const sameReason = blockReasonFor(target, namer.uuid);
  if (sameReason) {
    ui.notifications.warn(`${sameReason}.`);
    return;
  }
  const request = { namerUuid: namer.uuid, targetUuid: target.uuid, tokenUuid: tokenDoc.uuid, name: asked.name, status: "pending" };
  const preview = namingPreview(namer, target);

  if (game.user.isGM) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Nomear ${target.name} como ${asked.name}` },
      content: `<div class="nihility-naming-dialog">${previewHtml(namer, target, preview)}<p>Aplicar a Nomeação?</p></div>`,
      rejectClose: false
    });
    if (ok) await performNaming(request).catch(err => reportError("Falha na Nomeação.", err));
    return;
  }
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: ChatMessage.getSpeaker({ actor: namer }),
    content: `<div class="nihility-naming-request"><p><strong>${escapeHtml(namer.name)}</strong> quer nomear <strong>${escapeHtml(target.name)}</strong> como <strong>${escapeHtml(asked.name)}</strong>.</p>${previewHtml(namer, target, preview)}<div class="naming-status"></div></div>`,
    flags: { [SYSTEM_ID]: { namingRequest: request } }
  });
  ui.notifications.info("Pedido de Nomeação enviado ao Mestre.");
}

/* ------------------------------------------------------------------ Card do pedido (Mestre) */

function renderNamingRequest(message, html) {
  const req = message.flags?.[SYSTEM_ID]?.namingRequest;
  if (!req) return;
  const slot = html.querySelector(".naming-status");
  if (!slot) return;
  if (req.status !== "pending") {
    slot.textContent = { approved: "Aprovada.", rejected: "Rejeitada.", failed: `Falhou (faltou máximo de ${getCharacterEnergyLabel()}).`, error: "Não foi possível aplicar." }[req.status] ?? req.status;
    return;
  }
  if (!game.user.isGM) {
    slot.textContent = "Aguardando o Mestre aprovar: nada mudou ainda.";
    return;
  }
  const make = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async event => {
      event.preventDefault();
      button.disabled = true;
      try {
        await decideRequest(message, action);
      } catch (err) {
        reportError("Falha na Nomeação.", err);
      }
    });
    return button;
  };
  slot.append(make("Aprovar", "approve"), make("Rejeitar", "reject"));
}

async function decideRequest(message, action) {
  const req = message.flags?.[SYSTEM_ID]?.namingRequest;
  if (!req || req.status !== "pending") return;
  // Marca já, antes de aplicar: dois cliques (ou dois Mestres) nunca nomeiam duas vezes.
  if (action === "reject") {
    await message.setFlag(SYSTEM_ID, "namingRequest", { ...req, status: "rejected" });
    const namer = actorByUuid(req.namerUuid);
    if (namer) await announceVoiceOfTheWorld(namer, { kind: "naming", title: "Nomeação", body: `O Mestre não aprovou nomear ${req.name}.` });
    return;
  }
  await message.setFlag(SYSTEM_ID, "namingRequest", { ...req, status: "approved" });
  const result = await performNaming(req);
  await message.setFlag(SYSTEM_ID, "namingRequest", { ...req, status: result === "failed" ? "failed" : result ? "approved" : "error" });
}

/* ------------------------------------------------------------------ Aplicar (Mestre) */

/** Apelido de quem pertence a quem: jogadores (não Mestres) que são donos de um Ator. */
const playerOwners = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));

/**
 * Faz a Nomeação. Devolve `true` (feita), `"failed"` (Mana máxima insuficiente: já aplicou a queda) ou
 * `false` (não deu para fazer; nada mudou).
 * @param {{namerUuid: string, targetUuid: string, tokenUuid?: string, name: string}} request
 */
export async function performNaming(request) {
  if (!game.user.isGM || !isNamingEnabled()) return false;
  const namer = actorByUuid(request.namerUuid);
  const target = actorByUuid(request.targetUuid);
  const name = cleanNamingName(request.name);
  if (!namer || !target || !name) return false;
  const reason = blockReasonFor(target, namer.uuid);
  if (reason || namer.type !== "character") {
    ui.notifications.warn(reason ? `${target.name}: ${reason}.` : "Quem nomeia precisa ser um Personagem.");
    return false;
  }

  const preview = namingPreview(namer, target);
  if (!preview.outcome.ok) {
    // Falha: a Mana atual vai a 0 e quem nomeava cai Inconsciente. Nada mais muda.
    await namer.update({ "system.attributes.energy.value": 0 });
    await knockUnconscious(namer);
    await announceVoiceOfTheWorld(namer, {
      kind: "naming",
      title: "Nomeação falhou",
      body: `${namer.name} não tinha máximo de ${getEnergyLabelForActor(namer)} para dar um nome a ${target.name} (${preview.cost} necessários). ${namer.name} fica sem ${getEnergyLabelForActor(namer)} e desmaia.`
    });
    return "failed";
  }

  await autoSnapshot(namer, `Antes de nomear ${target.name}`);
  await autoSnapshot(target, `Antes de ser nomeado por ${namer.name}`);

  const tokenDoc = request.tokenUuid ? await fromUuid(request.tokenUuid) : null;
  const oldName = target.name;
  const named = await makeNamedActor(target, tokenDoc, name);
  if (!named) return false;

  // Mana máxima perdida para sempre (a conta fica em `energy.namedLoss`; ver deriveVitalStats).
  const lost = (Number(namer._source.system.attributes?.energy?.namedLoss) || 0) + preview.cost;
  await namer.update({ "system.attributes.energy.namedLoss": lost });

  // Os jogadores de quem nomeou passam a ser donos do nomeado.
  const owners = playerOwners(namer);
  if (owners.length) await named.update({ ownership: Object.fromEntries(owners.map(u => [u.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER])) });

  // Corredor de alma: o nomeado usa as Skills de quem nomeou; o XP dele também reparte com quem nomeou.
  const since = Date.now();
  await named.setFlag(SYSTEM_ID, "soulLink", { namerUuid: namer.uuid, since });
  const soulLinks = (namer.getFlag(SYSTEM_ID, "soulLinks") ?? []).filter(l => l.namedUuid !== named.uuid);
  await namer.setFlag(SYSTEM_ID, "soulLinks", [...soulLinks, { namedUuid: named.uuid, since }]);
  await linkActors({ kind: "soul", owner: namer, borrower: named });

  await giveNamedHeritage(named, namer);

  // O XP da Nomeação: dividido entre as Skills do nomeado; o que não cabe fica guardado.
  const applied = await applyXpToActor(named, preview.totalXp + namingBankOf(named), null);

  // O nomeado nasce inteiro (achado do teste de 20/11: saía com a Vida/Mana que o Token tinha, sobre o máximo novo).
  const vitals = named.system.attributes ?? {};
  await named.update({ "system.attributes.hp.value": Number(vitals.hp?.max) || 0, "system.attributes.energy.value": Number(vitals.energy?.max) || 0 });

  await announceVoiceOfTheWorld(namer, {
    kind: "naming",
    title: "Nomeação",
    body: `${namer.name} deu o nome ${name} a ${oldName} e perdeu ${preview.cost} do máximo de ${getEnergyLabelForActor(namer)}. Agora ${name} está ligado a ${namer.name} pelo Corredor de alma.`
  });
  await announceVoiceOfTheWorld(named, {
    kind: "naming",
    title: "Você recebeu um nome",
    body: `${named.name} foi nomeado por ${namer.name}${applied.lines.length ? `: ${applied.lines.join("; ")}.` : "."}`
  });

  if (namingBankOf(named) > 0) await openNamingBank(named);
  const species = getSpeciesEntry(named.system.species);
  if (species?.evolvesTo?.length) await openEvolution(named);
  return true;
}

/**
 * Garante que o nomeado é uma ficha do Diretório, com o nome novo. Token não vinculado: cria a ficha a
 * partir do Ator sintético do Token e religa o Token. Ficha do Diretório: só renomeia.
 */
async function makeNamedActor(target, tokenDoc, name) {
  if (!target.isToken) {
    await target.update({ name, "prototypeToken.name": name });
    for (const scene of game.scenes) for (const token of scene.tokens) if (token.actorLink && token.actorId === target.id) await token.update({ name });
    return target;
  }
  const data = target.toObject();
  delete data._id;
  data.name = name;
  data.folder = target.folder?.id ?? null;
  data.prototypeToken = { ...foundry.utils.deepClone(data.prototypeToken ?? {}), name, actorLink: true };
  delete data.prototypeToken.actorId;
  const created = await Actor.create(data);
  const token = tokenDoc ?? target.token;
  if (created && token) {
    await token.update({ actorId: created.id, actorLink: true, name });
  }
  return created;
}

/** Herança de fábrica "Nomeado" (marca na aba Origem). Sem a prévia interativa. */
async function giveNamedHeritage(named, namer) {
  const entry = getHeritageEntry("named");
  if (!entry) return;
  const source = `por ${namer.name}`;
  try {
    if (named.system.species) await changeActorHeritage(named, "named", { op: "add", source: "naming", interactive: false, announce: false });
    else await named.update({ "system.heritages": [...(named.system.heritages ?? []).filter(h => h.id !== "named").map(h => ({ ...h })), { id: "named", acquiredAt: Date.now(), source: "naming" }] });
  } catch (err) {
    reportError(`Não consegui dar a Herança "Nomeado" (${source}).`, err, { gmOnly: true });
  }
}

/* ------------------------------------------------------------------ XP e o banco */

/**
 * Reparte `total` de XP entre as Skills do Ator (ou só `onlyId`), grava nível + XP direto (é a única via
 * que passa do teto de XP) e guarda o que sobrou no banco. Devolve as linhas para o anúncio.
 */
async function applyXpToActor(actor, total, onlyId) {
  const inputs = skillInputs(actor).filter(i => !onlyId || i.id === onlyId);
  const { updates, leftover } = namingXpDistribution(inputs, total, { xpForLevel: getXpForNextLevel });
  const docUpdates = [];
  const lines = [];
  for (const update of updates) {
    const skill = actor.items.get(update.id);
    if (!skill) continue;
    const patch = { _id: skill.id, "system.level": update.level, "system.xp": update.xp };
    // Resistência que passou de nível: o nome acompanha (Resistência → Imunidade) se ainda era o nome calculado.
    const target = skill.system.resistanceTarget;
    if (target && update.level !== (Number(skill.system.level) || 1) && skill.name === computeResistanceName(target, Number(skill.system.level) || 1)) {
      patch.name = computeResistanceName(target, update.level);
    }
    docUpdates.push(patch);
    lines.push(namingPreviewLine(skill.name, update, inputs.find(i => i.id === update.id)));
  }
  if (docUpdates.length) await actor.updateEmbeddedDocuments("Item", docUpdates);
  if (leftover > 0) await actor.setFlag(SYSTEM_ID, BANK_FLAG, leftover);
  else if (actor.getFlag(SYSTEM_ID, BANK_FLAG) != null) await actor.unsetFlag(SYSTEM_ID, BANK_FLAG);
  return { lines, leftover };
}

/** Evolui uma Skill pelo mesmo editor da ficha e devolve o Item novo, ou null se cancelou. */
async function evolveWithEditor(actor, skillId) {
  const { openSkillEditorDialog } = await import("../apps/skill-editor-dialog.js");
  const { evolveSkill } = await import("../skills/skill-economy.js");
  const source = actor.items.get(skillId)?.system;
  if (!source) return null;
  const tierChoices = NIHILITY.SKILL_TIERS.filter(t => t !== "racial");
  const seed = source.weaponMastery ? { weaponMastery: source.weaponMastery, masteryRank: (Number(source.masteryRank) || 1) + 1 } : {};
  const data = await openSkillEditorDialog(seed, { tierChoices, levelReadonly: false });
  if (!data) return null;
  return evolveSkill(actor, skillId, data);
}

/**
 * Mestre: "Sobraram N de XP da Nomeação". Escolhe uma Skill para Evoluir (o mesmo fluxo da ficha); a Skill
 * nova recebe o XP do banco pela mesma regra (sobe o quanto couber) e o que sobrar continua no banco. Repete
 * enquanto houver XP e o Mestre quiser.
 */
export async function openNamingBank(actor) {
  if (!game.user.isGM || !actor) return;
  for (let guard = 0; guard < 20; guard++) {
    const bank = namingBankOf(actor);
    if (bank <= 0) return;
    const skills = actor.items.filter(i => i.type === "skill" && !i.system.isItemGranted);
    if (!skills.length) {
      ui.notifications.info(`${actor.name} não tem Skill que possa Evoluir; o XP (${bank}) fica guardado.`);
      return;
    }
    const options = skills.map((s, i) => `<label class="naming-bank-row"><input type="radio" name="skill" value="${escapeHtml(s.id)}" ${i === 0 ? "checked" : ""}/> ${escapeHtml(s.name)} <em>nv ${Number(s.system.level) || 1}</em></label>`).join("");
    const pick = await foundry.applications.api.DialogV2.wait({
      window: { title: `Sobraram ${bank} de XP da Nomeação — ${actor.name}` },
      content: `<div class="nihility-naming-dialog"><p>Todas as Skills de ${escapeHtml(actor.name)} já estão no teto (ou não recebem XP). Escolha uma para <strong>Evoluir</strong>: a Skill nova recebe o XP guardado.</p>${options}</div>`,
      buttons: [
        { action: "evolve", label: "Evoluir…", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=skill]:checked")?.value ?? false },
        { action: "later", label: "Depois", callback: () => false }
      ],
      rejectClose: false
    });
    if (!pick) return;
    let created = null;
    try {
      created = await evolveWithEditor(actor, pick);
    } catch (err) {
      reportError("Falha ao Evoluir a Skill.", err);
      return;
    }
    if (!created) continue;
    const result = await applyXpToActor(actor, bank, created.id);
    if (result.lines.length) {
      await announceVoiceOfTheWorld(actor, { kind: "naming", title: "XP da Nomeação", body: `${created.name}: ${result.lines.join("; ")}.` });
    }
  }
}

/* ------------------------------------------------------------------ XP compartilhado (Corredor de alma) */

/**
 * Lado do Mestre de `soulXp`: parte do XP que o nomeado ganhou vai a quem o nomeou. O vínculo é conferido
 * dos dois lados e o ganho nunca passa de um nível do nomeado (o payload veio de outro cliente).
 */
export async function soulXpAsGm({ namedUuid, gain }) {
  if (!isNamingEnabled()) return refuse("o bloco Nomeação está desligado");
  const named = typeof namedUuid === "string" ? await fromUuid(namedUuid) : null;
  if (named?.documentName !== "Actor") return refuse(RELAY_REASONS.invalid);
  const link = soulLinkOf(named);
  const namer = link ? await fromUuid(link.namerUuid) : null;
  if (namer?.documentName !== "Actor") return refuse("o vínculo não existe mais");
  if (!(namer.getFlag(SYSTEM_ID, "soulLinks") ?? []).some(l => l.namedUuid === named.uuid)) return refuse("o vínculo não existe nos dois lados");
  const level = Number(named.system.attributes?.level) || 1;
  const claimed = Math.min(Math.max(0, Math.floor(Number(gain) || 0)), getXpForNextLevel(level));
  const share = soulShare(claimed, getNamingConfig().sharePercent);
  if (share <= 0) return;
  const current = Number(namer.system.attributes?.xp) || 0;
  const max = Number(namer.system.attributes?.xpMax) || 0;
  const next = max > 0 ? Math.min(max, current + share) : current + share;
  if (next !== current) await namer.update({ "system.attributes.xp": next });
}

/* ------------------------------------------------------------------ Hooks */

function addHudButton(hud, html) {
  if (!isNamingEnabled()) return;
  const tokenDoc = hud.object?.document;
  const actor = tokenDoc?.actor;
  if (!tokenDoc || !actor || blockReasonFor(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if (!column || column.querySelector(".nihility-naming-hud")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon nihility-naming-hud";
  button.dataset.tooltip = "Nomear";
  button.innerHTML = `<i class="fa-solid fa-signature"></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    requestNaming(tokenDoc).catch(err => reportError("Falha ao pedir a Nomeação.", err));
  });
  column.append(button);
}

/**
 * O jogador só abre o HUD de Token que é dele (`Token#_canHUD`), e quase sempre quer nomear um que não é.
 * Para Token alheio, o clique direito (que hoje não faz nada) abre o pedido de Nomeação. Encadeado em
 * `CONFIG.Token.objectClass`, como movement.js e effect-badges.js.
 */
function namingByRightClick(token, user) {
  if (!isNamingEnabled() || !token?.layer?.active || user.isGM) return false;
  const actor = token.actor;
  if (!actor || actor.testUserPermission(user, "OWNER")) return false;
  if (token.document.hidden || !token.visible) return false;
  return !blockReasonFor(actor);
}

function registerNamingRightClick() {
  const BaseToken = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class NihilityNamingToken extends BaseToken {
    _canHUD(user, event) {
      return super._canHUD(user, event) || namingByRightClick(this, user);
    }

    _onClickRight(event) {
      if (namingByRightClick(this, game.user)) {
        requestNaming(this.document).catch(err => reportError("Falha ao pedir a Nomeação.", err));
        return;
      }
      return super._onClickRight(event);
    }
  };
}

/** Chamado uma vez, no `init`: tudo confere `isNamingEnabled()` ao agir. */
export function registerNaming() {
  registerNamingRightClick();
  registerBorrowedSheetRefresh();
  Hooks.on("renderTokenHUD", addHudButton);
  Hooks.on("renderChatMessageHTML", renderNamingRequest);

  // XP do nomeado que sobe: quem gravou calcula o ganho aqui (o valor de antes só existe nele) e, depois da gravação, avisa o Mestre.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (!isNamingEnabled() || actor.type !== "character" || !soulLinkOf(actor)) return;
    const newXp = foundry.utils.getProperty(changes, "system.attributes.xp");
    if (newXp === undefined) return;
    const gain = xpGainFromChange({
      oldLevel: actor._source.system.attributes?.level,
      newLevel: foundry.utils.getProperty(changes, "system.attributes.level") ?? actor._source.system.attributes?.level,
      oldXp: actor._source.system.attributes?.xp,
      newXp
    });
    if (gain > 0) options.nihilitySoulGain = gain;
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || !(options?.nihilitySoulGain > 0) || !isNamingEnabled()) return;
    runAsGm("soulXp", { namedUuid: actor.uuid, gain: options.nihilitySoulGain });
  });
}

/** Para a aba Origem: o que a Nomeação mostra desta ficha. */
export function namingContext(actor) {
  if (!isNamingEnabled() || actor?.type !== "character") return null;
  const link = soulLinkOf(actor);
  const named = (actor.getFlag(SYSTEM_ID, "soulLinks") ?? []).map(l => ({ uuid: l.namedUuid, name: actorByUuid(l.namedUuid)?.name ?? "(apagado)" }));
  const bank = namingBankOf(actor);
  const lost = Number(actor.system.attributes?.energy?.namedLoss) || 0;
  if (!link && !named.length && !bank && !lost) return null;
  return {
    namedBy: link ? { uuid: link.namerUuid, name: actorByUuid(link.namerUuid)?.name ?? "(apagado)" } : null,
    named,
    lost,
    bank,
    showBank: game.user.isGM && bank > 0
  };
}


// ---------------------------------------------------------------------------
// Ações do relay do Mestre (ver helpers/gm-relay.js). Juntadas em core/relay-actions.js.
// Todas recebem `(payload, user)`; `user` é dito pelo servidor, nunca pelo payload.
// ---------------------------------------------------------------------------
export const RELAY_HANDLERS = {
  /**
   * Corredor de alma (7a): parte do XP que o nomeado ganhou vai a quem o nomeou. Quem pede é dono do
   * nomeado (foi quem gravou o XP dele); o vínculo é conferido aqui e o ganho é limitado a um nível.
   */
  async soulXp(payload, user) {
    if (!(await mayActFor(user, payload?.namedUuid))) return refuse(RELAY_REASONS.permission);
    return soulXpAsGm(payload ?? {});
  }
};
