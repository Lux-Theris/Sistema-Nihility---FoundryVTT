import { SYSTEM_ID, isNamingEnabled, isPactEnabled, getManaInvestConfig } from "../core/config.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { deleteKeyUpdate } from "../helpers/foundry-compat.js";
import { skillSummariesFor } from "./skill-summary-ui.js";
import { applyCooldownAfterUse, skillTimersFor, inStartedCombat } from "./preparation.js";
import { totalCooldown } from "./cooldown-rules.js";
import {
  borrowedSkillList, borrowedLabel, borrowedSectionTitle, addBorrowLink, addLendLink, removeBorrowLink, removeLendLink, setLendBlocked,
  setLendReleased, linkUsable, skillLent, pactObserversToGrant, borrowableSkill
} from "./borrowed-rules.js";

/**
 * Skills emprestadas (7a): o Corredor de alma (vínculo da Nomeação, ver species/naming.js) e o Pacto.
 * Regras puras em borrowed-rules.js. Quem usa lança com a PRÓPRIA Mana, Token, alcance e Supressão; a
 * mecânica, o nível, o XP por uso e a Recarga são da Skill do DONO. O uso passa pelo fluxo normal
 * (`useSkillFlow` → `useSkillEffect`) com a opção `borrowedSkill`; ver skill-effects.js.
 */

const BORROW_FLAG = "borrowLinks";
const LEND_FLAG = "lendLinks";

export const borrowLinksOf = actor => (Array.isArray(actor?.getFlag?.(SYSTEM_ID, BORROW_FLAG)) ? foundry.utils.deepClone(actor.getFlag(SYSTEM_ID, BORROW_FLAG)) : []);
export const lendLinksOf = actor => (Array.isArray(actor?.getFlag?.(SYSTEM_ID, LEND_FLAG)) ? foundry.utils.deepClone(actor.getFlag(SYSTEM_ID, LEND_FLAG)) : []);

/** O bloco certo está ligado? Corredor de alma vem com a Nomeação; o Pacto tem o bloco dele. */
function kindEnabled(kind) {
  return kind === "pact" ? isPactEnabled() : isNamingEnabled();
}

function actorByUuid(uuid) {
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
}

/** "pelo Corredor de alma de X" / "pelo Pacto com X" para o card do uso. */
export function borrowedVia(via, skill) {
  return borrowedLabel(via?.kind === "pact" ? "pact" : "soul", skill?.parent?.name ?? "?");
}

/**
 * Este uso vale agora? (cliente) O bloco ligado, o vínculo dos dois lados, o dono aceitando e a Skill
 * liberada. O Mestre reconfere o que grava em nome de quem usa.
 */
export function isBorrowedUseAllowed(borrower, skill, via) {
  const owner = skill?.parent;
  if (!owner || !via?.kind || !kindEnabled(via.kind) || via.ownerUuid !== owner.uuid) return false;
  const check = linkUsable({ borrowLinks: borrowLinksOf(borrower), lendLinks: lendLinksOf(owner) }, { kind: via.kind, ownerUuid: owner.uuid, borrowerUuid: borrower.uuid });
  return check.ok && skillLent(via.kind, check.lend, skill.id, skill.system);
}

/* ------------------------------------------------------------------ Lado do Mestre (relay) */

/** `applySkillEffects` de uma Skill emprestada: quem pede é dono de QUEM USA e o vínculo libera a Skill. */
export async function borrowedRequestAllowed(borrowerUuid, skill, user) {
  const borrower = typeof borrowerUuid === "string" ? await fromUuid(borrowerUuid) : null;
  const owner = skill?.parent;
  if (borrower?.documentName !== "Actor" || owner?.documentName !== "Actor") return false;
  if (!user?.isGM && !borrower.testUserPermission(user, "OWNER")) return false;
  for (const kind of ["soul", "pact"]) {
    if (!kindEnabled(kind)) continue;
    const check = linkUsable({ borrowLinks: borrowLinksOf(borrower), lendLinks: lendLinksOf(owner) }, { kind, ownerUuid: owner.uuid, borrowerUuid: borrower.uuid });
    if (check.ok && skillLent(kind, check.lend, skill.id, skill.system)) return true;
  }
  return false;
}

/**
 * Grava a Recarga de depois do uso na Skill do DONO. Se quem usa é dono dela, direto; senão o Mestre
 * confere o vínculo e grava (`borrowedCooldown`). Nunca lança: uma Recarga que não gravou não desfaz o uso.
 */
export async function applyBorrowedCooldown(borrower, skill, subSkillIndex, ratio) {
  try {
    if (!skill || !inStartedCombat(borrower)) return;
    const mech = subSkillIndex != null ? skill.system.subSkills?.[subSkillIndex] : skill.system;
    if (!totalCooldown(mech?.cooldown, ratio, getManaInvestConfig().overcharge)) return;
    if (skill.isOwner) {
      await applyCooldownAfterUse(borrower, skill, subSkillIndex, ratio);
      return;
    }
    const outcome = await runAsGm("borrowedCooldown", { borrowerUuid: borrower.uuid, skillUuid: skill.uuid, subSkillIndex, ratio }, { reply: true, timeout: 8000 });
    const failure = relayFailureMessage(outcome, "gravar a Recarga na Skill do dono");
    if (failure) ui.notifications?.warn(failure);
  } catch (err) {
    console.warn("nihility-rpg-system | Falha ao gravar a Recarga da Skill emprestada.", err);
  }
}

/** Lado do Mestre de `borrowedCooldown`: o vínculo é conferido e a Recarga é recalculada da Skill do dono. */
export async function borrowedCooldownAsGm(payload, user) {
  const borrower = typeof payload?.borrowerUuid === "string" ? await fromUuid(payload.borrowerUuid) : null;
  const skill = typeof payload?.skillUuid === "string" ? await fromUuid(payload.skillUuid) : null;
  if (borrower?.documentName !== "Actor" || skill?.type !== "skill" || skill.parent?.documentName !== "Actor") return refuse(RELAY_REASONS.invalid);
  if (!user?.isGM && !borrower.testUserPermission(user, "OWNER")) return refuse(RELAY_REASONS.permission);
  if (!(await borrowedRequestAllowed(borrower.uuid, skill, user))) return refuse("o vínculo não libera esta Skill");
  const index = payload.subSkillIndex == null ? null : Math.floor(Number(payload.subSkillIndex));
  if (index != null && !(index >= 0)) return refuse(RELAY_REASONS.invalid);
  const ratio = Math.min(10, Math.max(1, Number(payload.ratio) || 1));
  await applyCooldownAfterUse(borrower, skill, index, ratio);
}

/* ------------------------------------------------------------------ Ficha de quem usa */

/**
 * As seções da aba Habilidades de quem usa: uma por vínculo, com as Skills que o dono empresta, a frase
 * de cada uma (com o nível do dono) e o motivo de estar desligada.
 */
export function borrowedSectionsFor(borrower) {
  const sections = [];
  for (const link of borrowLinksOf(borrower)) {
    if (!kindEnabled(link.kind)) continue;
    const owner = actorByUuid(link.sourceUuid);
    if (!owner) continue;
    const lend = lendLinksOf(owner).find(l => l.kind === link.kind && l.borrowerUuid === borrower.uuid);
    if (!lend) continue;
    const sentences = skillSummariesFor(owner);
    const timers = skillTimersFor(owner);
    const accepting = !lend.blocked;
    const rows = borrowedSkillList(link.kind, owner.items.filter(i => i.type === "skill"), lend.released).map(skill => ({
      id: skill.id,
      name: skill.name,
      img: skill.img,
      sentence: sentences[skill.id] ?? "",
      timer: timers[skill.id] ?? "",
      disabled: !accepting || Boolean(timers[skill.id])
    }));
    sections.push({
      kind: link.kind,
      ownerUuid: owner.uuid,
      ownerName: owner.name,
      title: borrowedSectionTitle(link.kind, owner.name),
      accepting,
      refusal: `${owner.name} não está aceitando pedidos`,
      emptyText: link.kind === "pact" ? `${owner.name} ainda não liberou nenhuma Skill do Pacto.` : `${owner.name} não tem Skills que passem pelo Corredor de alma.`,
      rows
    });
  }
  return sections;
}

/**
 * "Usar" numa linha emprestada. A Skill é a do dono; quem lança é `borrower`.
 * @param {Actor} borrower
 * @param {{kind: string, ownerUuid: string, skillId: string, event?: Event|null, pickTarget?: Function}} args
 */
export async function useBorrowedSkill(borrower, { kind, ownerUuid, skillId, event = null, pickTarget } = {}) {
  const owner = actorByUuid(ownerUuid);
  const skill = owner?.items.get(skillId);
  if (!skill || skill.type !== "skill") {
    ui.notifications?.warn("Esta Skill não existe mais.");
    return;
  }
  const via = { kind: kind === "pact" ? "pact" : "soul", ownerUuid };
  const check = linkUsable({ borrowLinks: borrowLinksOf(borrower), lendLinks: lendLinksOf(owner) }, { kind: via.kind, ownerUuid, borrowerUuid: borrower.uuid });
  if (!kindEnabled(via.kind) || !check.ok) {
    ui.notifications?.warn(!kindEnabled(via.kind) ? "Este bloco está desligado nas Módulos do Sistema." : `${owner.name} não está aceitando pedidos (${check.reason}).`);
    return;
  }
  if (!skillLent(via.kind, check.lend, skill.id, skill.system)) {
    ui.notifications?.warn(`${skill.name} não está liberada para você.`);
    return;
  }
  const { useSkillFlow } = await import("./skill-use-flow.js");
  try {
    await useSkillFlow(borrower, skill.id, { event, pickTarget, borrowedSkill: skill, borrowedVia: via });
  } catch (err) {
    reportError("Falha ao usar a Skill emprestada.", err);
  }
}

/* ------------------------------------------------------------------ Vínculos (criar, opções, cortar) */

/** O que a aba Origem mostra de vínculos para este Ator (como dono e como quem usa). */
export function linkRowsFor(actor) {
  const asOwner = [];
  for (const lend of lendLinksOf(actor)) {
    if (!kindEnabled(lend.kind)) continue;
    const borrower = actorByUuid(lend.borrowerUuid);
    if (!borrower) continue;
    const skills = lend.kind === "pact"
      ? actor.items.filter(i => i.type === "skill" && borrowableSkill(i.system)).map(i => ({ id: i.id, name: i.name, checked: (lend.released ?? []).includes(i.id) }))
      : [];
    asOwner.push({
      kind: lend.kind,
      kindLabel: lend.kind === "pact" ? "Pacto" : "Corredor de alma",
      isPact: lend.kind === "pact",
      borrowerUuid: borrower.uuid,
      borrowerName: borrower.name,
      accepting: !lend.blocked,
      skills,
      canCut: lend.kind === "pact" || game.user.isGM
    });
  }
  const asBorrower = [];
  for (const link of borrowLinksOf(actor)) {
    if (!kindEnabled(link.kind)) continue;
    const owner = actorByUuid(link.sourceUuid);
    asBorrower.push({
      kind: link.kind,
      kindLabel: link.kind === "pact" ? "Pacto" : "Corredor de alma",
      ownerUuid: link.sourceUuid,
      ownerName: owner?.name ?? "(apagado)",
      canCut: link.kind === "pact" || game.user.isGM
    });
  }
  return { asOwner, asBorrower, any: asOwner.length > 0 || asBorrower.length > 0 };
}

/** Mestre: cria o vínculo nos dois lados. No Pacto, quem joga com o bruxo passa a poder VER o patrono. */
export async function linkActors({ kind, owner, borrower }) {
  if (!game.user.isGM) return false;
  let grantedTo = [];
  if (kind === "pact") {
    const borrowerOwners = game.users.filter(u => !u.isGM && borrower.testUserPermission(u, "OWNER")).map(u => u.id);
    grantedTo = pactObserversToGrant(borrowerOwners, owner.ownership, CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2);
    if (grantedTo.length) {
      const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
      await owner.update({ ownership: { ...Object.fromEntries(grantedTo.map(id => [id, observer])) } });
    }
  }
  const since = Date.now();
  await borrower.setFlag(SYSTEM_ID, BORROW_FLAG, addBorrowLink(borrowLinksOf(borrower), { kind, sourceUuid: owner.uuid, since }));
  await owner.setFlag(SYSTEM_ID, LEND_FLAG, addLendLink(lendLinksOf(owner), { kind, borrowerUuid: borrower.uuid, since, grantedTo }));
  return true;
}

/** Mestre: desfaz o vínculo nos dois lados (e a visão que o Pacto deu, só a que ele mesmo deu). */
export async function unlinkActors({ kind, ownerUuid, borrowerUuid }) {
  const owner = actorByUuid(ownerUuid) ?? (await fromUuid(ownerUuid));
  const borrower = actorByUuid(borrowerUuid) ?? (await fromUuid(borrowerUuid));
  if (borrower) await setOrUnset(borrower, BORROW_FLAG, removeBorrowLink(borrowLinksOf(borrower), kind, ownerUuid));
  if (owner) {
    const lend = lendLinksOf(owner).find(l => l.kind === kind && l.borrowerUuid === borrowerUuid);
    for (const userId of lend?.grantedTo ?? []) {
      if (owner.ownership?.[userId] === (CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2)) await owner.update(deleteKeyUpdate(`ownership.${userId}`));
    }
    await setOrUnset(owner, LEND_FLAG, removeLendLink(lendLinksOf(owner), kind, borrowerUuid));
  }
}

async function setOrUnset(actor, key, list) {
  if (list.length) await actor.setFlag(SYSTEM_ID, key, list);
  else await actor.unsetFlag(SYSTEM_ID, key);
}

/** Lado do Mestre de `cutBorrowLink`: o patrono ou o bruxo corta o Pacto (o Corredor só o Mestre). */
export async function cutLinkAsGm(payload, user) {
  const owner = typeof payload?.ownerUuid === "string" ? await fromUuid(payload.ownerUuid) : null;
  const borrower = typeof payload?.borrowerUuid === "string" ? await fromUuid(payload.borrowerUuid) : null;
  if (owner?.documentName !== "Actor" || borrower?.documentName !== "Actor") return refuse(RELAY_REASONS.invalid);
  if (payload.kind !== "pact") return refuse("só o Mestre corta o Corredor de alma");
  if (!user?.isGM && !owner.testUserPermission(user, "OWNER") && !borrower.testUserPermission(user, "OWNER")) return refuse(RELAY_REASONS.permission);
  await unlinkActors({ kind: "pact", ownerUuid: owner.uuid, borrowerUuid: borrower.uuid });
}

/** Cortar um vínculo (botão da aba Origem): o Mestre corta direto; o jogador pede ao Mestre (só Pacto). */
export async function cutLink({ kind, ownerUuid, borrowerUuid }) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: kind === "pact" ? "Cortar o Pacto" : "Cortar o Corredor de alma" },
    content: `<div><p>${kind === "pact" ? "O bruxo perde o acesso às Skills do patrono." : "O nomeado perde o acesso às Skills de quem o nomeou, e o XP deixa de ser dividido."} Isto não apaga nada das fichas. Cortar?</p></div>`,
    rejectClose: false
  });
  if (!confirmed) return;
  if (game.user.isGM) {
    await unlinkActors({ kind, ownerUuid, borrowerUuid });
    if (kind === "soul") await clearSoulLinks(ownerUuid, borrowerUuid);
    return;
  }
  const outcome = await runAsGm("cutBorrowLink", { kind, ownerUuid, borrowerUuid }, { reply: true, timeout: 8000 });
  const failure = relayFailureMessage(outcome, "cortar o Pacto");
  if (failure) ui.notifications?.warn(failure);
}

/** O XP compartilhado do Corredor de alma também acaba quando o Mestre o corta. */
async function clearSoulLinks(namerUuid, namedUuid) {
  const namer = actorByUuid(namerUuid);
  const named = actorByUuid(namedUuid);
  if (namer) {
    const rest = (namer.getFlag(SYSTEM_ID, "soulLinks") ?? []).filter(l => l.namedUuid !== namedUuid);
    if (rest.length) await namer.setFlag(SYSTEM_ID, "soulLinks", rest);
    else await namer.unsetFlag(SYSTEM_ID, "soulLinks");
  }
  if (named) await named.unsetFlag(SYSTEM_ID, "soulLink");
}

/** O dono liga/desliga "Aceitar pedidos" (grava na própria ficha). */
export async function toggleAcceptRequests(owner, kind, borrowerUuid) {
  const current = lendLinksOf(owner).find(l => l.kind === kind && l.borrowerUuid === borrowerUuid);
  if (!current) return;
  await owner.setFlag(SYSTEM_ID, LEND_FLAG, setLendBlocked(lendLinksOf(owner), kind, borrowerUuid, !current.blocked));
}

/** O patrono marca/desmarca uma Skill liberada no Pacto. */
export async function setPactReleased(owner, borrowerUuid, skillId, released) {
  await owner.setFlag(SYSTEM_ID, LEND_FLAG, setLendReleased(lendLinksOf(owner), borrowerUuid, skillId, released));
}

/** Mestre: "Criar Pacto…" na aba Origem do bruxo. Escolhe o patrono numa lista de Personagens. */
export async function createPactDialog(borrower) {
  if (!game.user.isGM || !isPactEnabled()) return false;
  const already = new Set(borrowLinksOf(borrower).filter(l => l.kind === "pact").map(l => l.sourceUuid));
  const candidates = game.actors.filter(a => a.type === "character" && a.uuid !== borrower.uuid && !already.has(a.uuid));
  if (!candidates.length) {
    ui.notifications.info("Não há outro personagem para ser patrono.");
    return false;
  }
  const options = candidates.map(a => `<option value="${escapeHtml(a.uuid)}">${escapeHtml(a.name)}</option>`).join("");
  const uuid = await foundry.applications.api.DialogV2.wait({
    window: { title: `Criar Pacto — ${borrower.name}` },
    content: `<div class="form-group"><label>Patrono</label><select name="patron">${options}</select></div><p class="hint-inline">${escapeHtml(borrower.name)} poderá usar, com a própria Mana, as Skills que o patrono liberar. O XP de uso vai para o patrono.</p>`,
    buttons: [
      { action: "ok", label: "Criar Pacto", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=patron]").value },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  if (!uuid) return false;
  const patron = actorByUuid(uuid);
  if (!patron) return false;
  await linkActors({ kind: "pact", owner: patron, borrower });
  ui.notifications.info(`Pacto criado: ${borrower.name} ← ${patron.name}. O patrono marca as Skills liberadas na aba Origem dele.`);
  return true;
}

/**
 * Re-pinta a ficha aberta de quem empresta e de quem toma emprestado quando um vínculo/liberação muda (sessão 4: a seção
 * "Pacto" do bruxo só aparecia depois de fechar e reabrir a ficha quando o patrono liberava uma Skill, porque a mudança
 * é na ficha DO OUTRO Ator). Chamado uma vez (`registerNaming`).
 */
export function registerBorrowedSheetRefresh() {
  Hooks.on("updateActor", (actor, changes) => {
    const flags = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}`);
    if (!flags || (!(LEND_FLAG in flags) && !(BORROW_FLAG in flags) && !(`-=${LEND_FLAG}` in flags) && !(`-=${BORROW_FLAG}` in flags))) return;
    const uuids = new Set([actor.uuid]);
    for (const link of lendLinksOf(actor)) if (link.borrowerUuid) uuids.add(link.borrowerUuid);
    for (const link of borrowLinksOf(actor)) if (link.sourceUuid) uuids.add(link.sourceUuid);
    for (const uuid of uuids) {
      const other = fromUuidSync(uuid);
      if (other?.sheet?.rendered) other.sheet.render();
    }
  });
}
