/**
 * Rerrolar (item 8d.2) — o lado Foundry. As contas estão em reroll-rules.js (pura, testada).
 *
 * Como funciona: toda rolagem do sistema guarda no flag da mensagem `nihilityRoll` o que é preciso para
 * refazê-la (atributo, iniciativa, o d100 de passar da Mana); o card de dano ainda não aplicado e o card
 * pendente da Predação já têm flags próprios, que são reaproveitados. No card dessas rolagens aparece
 * "🎲 Rerrolar (Skill)" para quem é dono de um Ator com uma Skill de mecânica "reroll" que a alcança.
 * Clicar usa a Skill pelo fluxo normal (Custo, Recarga, XP por uso) e então `performReroll` refaz a rolagem.
 *
 * Quem escreve em mensagem/combate alheios é o Mestre, pelo relay `rerollApply` (`rerollApplyAsGm`), que
 * confere de novo quem pediu, a Skill e o alcance. O número novo vem do cliente que rolou (o mesmo grau de
 * confiança de qualquer rolagem do sistema); os limites (razão do dano, d100) são refeitos no Mestre.
 */
import { SYSTEM_ID, sameActor, actorToken, effectiveSkillCost, isEnergyPoolEnabled, isRerollEnabled } from "../core/config.js";
import { skillIsMagic, skillIsTech } from "../core/magic-rules.js";
import { suppressionLevel, techSuppressionLevel } from "../core/suppression.js";
import { isIncapacitated } from "../combat/incapacitation.js";
import { applyLuckToFormula, luckOf } from "../combat/luck-rules.js";
import { isShipLike } from "../starship/ship-damage.js";
import { currentEnergyValue } from "./skill-state.js";
import { useBlockReason } from "./preparation.js";
import { useSkillEffect } from "./skill-effects.js";
import { grantSkillUseXp } from "./skill-xp.js";
import { runAsGm, mayActFor } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import {
  rerollReaches, rerollRelation, rerollKeepFor, pickKept, lowerIsBetter, damageRatio, scaleDamageFlags, damageCardRerollable,
  replacePredationRoll, rerollNoteText, rerollGroupOf, rerollWindowOpen
} from "./reroll-rules.js";

const ROLL_FLAG = "nihilityRoll";
const DONE_FLAG = "rerolled";
/** A rolagem já foi rerrolada uma vez (mesmo ficando a antiga): o botão some do card. */
const USED_FLAG = "rerollUsed";

/* ------------------------------------------------------------------ O que cada mensagem guarda */

/**
 * O que se sabe de uma rolagem refazível numa mensagem, ou null. `kind`: attribute, initiative, damage,
 * predation ou overdraw. Mensagem já rerrolada (ou o card descartado de um rerrolar) não vale mais.
 */
export function rerollInfoOf(message) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!flags || flags[DONE_FLAG] || flags[USED_FLAG]) return null;
  if (!rerollWindowOpen(message.timestamp, Date.now())) return null;
  const own = flags[ROLL_FLAG];
  if (own?.kind && own.formula) return { ...own };
  if (flags.predation?.status === "pending" && Array.isArray(flags.predation.results) && flags.predation.results.length) {
    return { kind: "predation", actorUuid: flags.predation.predatorUuid, results: flags.predation.results };
  }
  const roll = message.rolls?.[0];
  if (roll && damageCardRerollable(flags)) {
    return { kind: "damage", actorUuid: "", formula: roll.formula, total: Number(flags.rerollRaw ?? roll.total) || 0 };
  }
  return null;
}

/** O Ator que rolou (flag, senão o da fala da mensagem). */
function rollerOf(info, message) {
  if (info.actorUuid) {
    try {
      return fromUuidSync(info.actorUuid);
    } catch (err) {
      return null;
    }
  }
  return ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
}

/** Mesmo lado? Disposição dos Tokens quando há; senão os dois são de jogadores. */
function isAlly(holder, roller) {
  const a = actorToken(holder)?.document?.disposition;
  const b = actorToken(roller)?.document?.disposition;
  if (a !== undefined && a !== null && b !== undefined && b !== null) return a === b;
  return Boolean(holder?.hasPlayerOwner && roller?.hasPlayerOwner);
}

function relationBetween(holder, roller) {
  return rerollRelation({ same: sameActor(holder, roller), ally: Boolean(holder && roller) && isAlly(holder, roller) });
}

/** A mecânica de uma Skill (ou da Sub-Skill) de Rerrolar, com o Tier da Skill. */
function mechOf(skill, subSkillIndex) {
  const sub = subSkillIndex != null ? (skill.system.subSkills ?? [])[subSkillIndex] : null;
  const base = sub ?? skill.system;
  return { mech: base, tier: skill.system.tier, label: sub ? `${skill.name} — ${sub.name}` : skill.name };
}

/* ------------------------------------------------------------------ Quem pode rerrolar o quê */

/** Por que esta Skill de Rerrolar não pode ser usada agora (null = pode). Sem avisos na tela. */
function usabilityReason(actor, skill, subSkillIndex, mech) {
  if (mech.effectType !== "reroll") return "não é de Rerrolar";
  if (mech.hasUpkeep || Number(mech.prepTurns) > 0) return "não é de uso na hora";
  if (useBlockReason(actor, skill, subSkillIndex)) return "em Recarga";
  if (actor.type === "character" && isIncapacitated(actor)) return "incapacitado";
  const chargesEnergy = isShipLike(actor) || isEnergyPoolEnabled();
  if (chargesEnergy) {
    const cost = effectiveSkillCost(mech.cost, mech);
    if (cost > 0 && currentEnergyValue(actor) < cost) return "sem energia";
  }
  if (actor.type === "character") {
    const level = Number(mech.level) || 0;
    const magicLevel = suppressionLevel(actor);
    if (magicLevel !== null && skillIsMagic({ ...mech, tier: skill.system.tier }) && level <= magicLevel) return "suprimido";
    const techLevel = techSuppressionLevel(actor);
    if (techLevel !== null && skillIsTech({ ...mech }, actor) && level <= techLevel) return "suprimido";
  }
  return null;
}

/** Os Atores que este usuário comanda: o Mestre, só os selecionados no mapa; o jogador, os que possui. */
function actorsOfUser(user) {
  const map = new Map();
  const add = actor => {
    if (actor && actor.type === "character" && actor.isOwner) map.set(actor.uuid, actor);
  };
  for (const token of canvas?.tokens?.controlled ?? []) add(token.actor);
  if (!user.isGM) {
    for (const actor of game.actors) add(actor);
    add(user.character);
  }
  return [...map.values()];
}

/** As Skills de Rerrolar que `user` pode usar nesta rolagem: `[{actor, skill, subSkillIndex, label}]`. */
export function rerollCandidates(user, message, info) {
  if (!isRerollEnabled() || !info) return [];
  const roller = rollerOf(info, message);
  const out = [];
  for (const actor of actorsOfUser(user)) {
    const relation = relationBetween(actor, roller);
    for (const skill of actor.items) {
      if (skill.type !== "skill") continue;
      const entries = [{ index: null, mech: skill.system }, ...(skill.system.subSkills ?? []).map((sub, index) => ({ index, mech: sub }))];
      for (const { index, mech } of entries) {
        if (mech.effectType !== "reroll") continue;
        if (!rerollReaches(mech, { rollKind: info.kind, relation })) continue;
        if (usabilityReason(actor, skill, index, mech)) continue;
        out.push({ actor, skill, subSkillIndex: index, label: mechOf(skill, index).label });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ O card */

/** Botões "🎲 Rerrolar" e a faixa "rerrolado por", no `renderChatMessageHTML`. */
export function renderRerollControls(message, html) {
  const done = message.flags?.[SYSTEM_ID]?.[DONE_FLAG];
  if (done) {
    html.classList.add("nihility-rerolled");
    const strip = document.createElement("div");
    strip.className = "nihility-rerolled-strip";
    strip.textContent = done.discarded ? "Rolagem descartada: ficou o resultado antigo." : `Rerrolado${done.by ? ` por ${done.by}` : ""}: vale a rolagem nova.`;
    html.append(strip);
    return;
  }
  const info = rerollInfoOf(message);
  if (!info) return;
  const candidates = rerollCandidates(game.user, message, info);
  if (!candidates.length) return;
  const wrap = document.createElement("div");
  wrap.className = "nihility-reroll-controls";
  const several = new Set(candidates.map(c => c.actor.uuid)).size > 1;
  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nihility-reroll-button";
    button.textContent = `🎲 Rerrolar (${candidate.label}${several ? ` · ${candidate.actor.name}` : ""})`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await useRerollSkill(message, candidate);
      } finally {
        button.disabled = false;
      }
    });
    wrap.append(button);
  }
  html.append(wrap);
}

/** Usa a Skill pelo fluxo normal; a rolagem sai em `performReroll` (chamado pelo caminho de uso). */
async function useRerollSkill(message, { actor, skill, subSkillIndex }) {
  const info = rerollInfoOf(message);
  if (!info) {
    ui.notifications.warn("Esta rolagem já foi refeita.");
    return;
  }
  const { mech } = mechOf(skill, subSkillIndex);
  const reason = usabilityReason(actor, skill, subSkillIndex, mech);
  if (reason) {
    ui.notifications.warn(`${skill.name}: ${reason}.`);
    return;
  }
  try {
    await useSkillEffect(actor, skill.id, { subSkillIndex, reroll: { messageId: message.id } });
  } catch (err) {
    reportError("Falha ao rerrolar.", err);
  }
}

/* ------------------------------------------------------------------ A rolagem */

async function chooseKept({ label, oldTotal, newTotal }) {
  const { DialogV2 } = foundry.applications.api;
  const answer = await DialogV2.wait({
    window: { title: `Rerrolar — ${label}` },
    content: `<div class="nihility-reroll-choose"><p>Rolagem antiga: <strong>${escapeHtml(String(oldTotal))}</strong> · rolagem nova: <strong>${escapeHtml(String(newTotal))}</strong>. Qual fica?</p></div>`,
    buttons: [
      { action: "old", label: `Ficar com a antiga (${oldTotal})` },
      { action: "new", label: `Ficar com a nova (${newTotal})`, default: true }
    ],
    rejectClose: false
  });
  return answer === "old" ? "old" : "new";
}

async function choosePredationResult(results) {
  if (results.length === 1) return results[0];
  const { DialogV2 } = foundry.applications.api;
  const gm = game.user.isGM;
  const rows = results
    .map((r, i) => `<option value="${escapeHtml(r.skillId)}" ${!r.won && i === results.findIndex(x => !x.won) ? "selected" : ""}>${escapeHtml(gm ? r.name : `Habilidade ${i + 1}`)} — chance ${r.chance}% · d100 = ${r.roll} · ${r.won ? "ganhou" : "perdeu"}</option>`)
    .join("");
  const picked = await DialogV2.wait({
    window: { title: "Rerrolar a Predação" },
    content: `<div class="nihility-reroll-choose"><div class="form-group"><label>Qual d100 refazer?</label><select name="skill">${rows}</select></div></div>`,
    buttons: [{ action: "ok", label: "Rerrolar", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=skill]")?.value }],
    rejectClose: false
  });
  return results.find(r => r.skillId === picked) ?? null;
}

/** Pede ao Mestre a escrita; avisa o motivo se não deu. */
async function applyViaGm(payload) {
  const outcome = await runAsGm("rerollApply", payload, { reply: true });
  if (!outcome.ok) ui.notifications.warn(relayFailureMessage(outcome.reason));
  return outcome.ok;
}

/** Posta o card da rolagem nova (atributo, iniciativa, d100 de passar da Mana). */
async function postNewRoll({ message, info, roll, note, keptNew, byActor }) {
  const flavor = `${message.flavor ?? ""}${message.flavor ? " — " : ""}<em>${escapeHtml(note)}</em>`;
  const flags = keptNew
    ? { [SYSTEM_ID]: { [ROLL_FLAG]: { ...info, formula: roll.formula, total: roll.total } } }
    : { [SYSTEM_ID]: { [DONE_FLAG]: { discarded: true, by: byActor.name } } };
  await roll.toMessage({ speaker: message.speaker, flavor, flags });
}

/**
 * A rolagem de fato, depois que a Skill foi paga. `options.reroll.messageId` = a mensagem a refazer.
 * Devolve true (refeito), false (não deu). O Custo já foi pago em `runSkillEffect`.
 */
export async function performReroll(sourceActor, skill, mech, label, options) {
  const message = game.messages.get(options.reroll?.messageId);
  const info = rerollInfoOf(message);
  if (!message || !info) {
    ui.notifications.warn("Esta rolagem já foi refeita ou sumiu.");
    return false;
  }
  const roller = rollerOf(info, message);
  if (!rerollReaches(mech, { rollKind: info.kind, relation: relationBetween(sourceActor, roller) })) {
    ui.notifications.warn(`${label} não alcança esta rolagem.`);
    return false;
  }
  const { tier } = mechOf(skill, options.subSkillIndex ?? null);
  const keep = rerollKeepFor(mech.rerollKeep, tier);
  const lower = lowerIsBetter(info.kind);
  const common = { skillUuid: skill.uuid, subSkillIndex: options.subSkillIndex ?? null, messageId: message.id, by: sourceActor.name };
  const decide = async (oldTotal, newTotal) => {
    if (keep === "choose") return (await chooseKept({ label, oldTotal, newTotal })) === "new";
    return pickKept({ keep, oldTotal, newTotal, lower }) === "new";
  };
  const noteFor = (oldTotal, newTotal, keptNew) => rerollNoteText({ who: sourceActor.name, keep, oldTotal, newTotal, kept: keptNew ? "new" : "old" });
  let ok = false;

  if (info.kind === "attribute" || info.kind === "overdraw" || info.kind === "initiative") {
    const roll = await new Roll(info.formula).evaluate();
    const oldTotal = Number(info.total) || 0;
    const keptNew = await decide(oldTotal, roll.total);
    await postNewRoll({ message, info, roll, note: noteFor(oldTotal, roll.total, keptNew), keptNew, byActor: sourceActor });
    ok = true;
    if (keptNew) {
      const op = info.kind === "initiative" ? { op: "initiative", combatId: info.combatId, combatantId: info.combatantId, total: roll.total } : { op: "mark" };
      ok = await applyViaGm({ ...common, ...op, keptNew: true });
    } else {
      await applyViaGm({ ...common, op: "used" });
    }
  } else if (info.kind === "damage") {
    const roll = await new Roll(info.formula).evaluate();
    const oldTotal = Number(info.total) || 0;
    const keptNew = await decide(oldTotal, roll.total);
    const keptTotal = keptNew ? roll.total : oldTotal;
    const ratio = damageRatio(oldTotal, keptTotal);
    if (ratio === null) {
      ui.notifications.warn("Não consegui refazer o dano: a rolagem antiga não tem um total para comparar.");
      return false;
    }
    const note = `${noteFor(oldTotal, roll.total, keptNew)}${ratio === 1 ? "" : ` · os números do card foram refeitos (×${(Math.round(ratio * 100) / 100).toString().replace(".", ",")})`}`;
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: sourceActor }), flavor: `<em>${escapeHtml(`${label}: ${note}`)}</em>` });
    ok = ratio === 1 ? (await applyViaGm({ ...common, op: "used" }), true) : await applyViaGm({ ...common, op: "damage", ratio, newRaw: keptTotal });
  } else if (info.kind === "predation") {
    const result = await choosePredationResult(info.results);
    if (!result) return false;
    const predator = roller;
    const roll = await new Roll(applyLuckToFormula("1d100", -luckOf(predator, "chances"))).evaluate();
    const keptNew = await decide(result.roll, roll.total);
    const gm = game.user.isGM;
    const shown = gm ? result.name : "uma Habilidade";
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      flavor: `<em>${escapeHtml(`${label} (Predação, ${shown}): ${noteFor(result.roll, roll.total, keptNew)}`)}</em>`,
      whisper: message.whisper?.length ? message.whisper : undefined
    });
    ok = keptNew ? await applyViaGm({ ...common, op: "predation", resultSkillId: result.skillId, roll: roll.total }) : true;
  }

  if (ok) await grantSkillUseXp(skill, [{ flat: true }]);
  return ok;
}

/* ------------------------------------------------------------------ O Mestre */

/**
 * O lado do Mestre do relay `rerollApply`: refaz as conferências (Skill, alcance) e escreve. Devolve
 * `refuse(...)` com o motivo, ou nada.
 */
export async function rerollApplyAsGm(payload, user) {
  const skill = typeof payload?.skillUuid === "string" ? await fromUuid(payload.skillUuid) : null;
  if (!skill || skill.type !== "skill" || !isRerollEnabled()) return refuse(RELAY_REASONS.invalid);
  const index = Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null;
  const { mech } = mechOf(skill, index);
  if (mech?.effectType !== "reroll") return refuse(RELAY_REASONS.invalid);
  const message = typeof payload.messageId === "string" ? game.messages.get(payload.messageId) : null;
  const info = rerollInfoOf(message);
  if (!message || !info) return refuse("Esta rolagem já foi refeita.");
  const roller = rollerOf(info, message);
  const holder = skill.parent;
  if (!rerollReaches(mech, { rollKind: info.kind, relation: relationBetween(holder, roller) })) return refuse(RELAY_REASONS.permission);

  const by = String(payload.by ?? holder?.name ?? "").slice(0, 80);
  const mark = () => message.setFlag(SYSTEM_ID, DONE_FLAG, { by, userId: user?.id ?? "" });
  switch (payload.op) {
    case "used":
      // Rerrolou e ficou a antiga (ou o dano não mudou): a rolagem não pode ser rerrolada de novo.
      if (info.kind === "predation") return refuse(RELAY_REASONS.invalid);
      await message.setFlag(SYSTEM_ID, USED_FLAG, true);
      return;
    case "mark":
      if (info.kind === "damage" || info.kind === "predation") return refuse(RELAY_REASONS.invalid);
      await mark();
      return;
    case "initiative": {
      if (info.kind !== "initiative") return refuse(RELAY_REASONS.invalid);
      const combat = game.combats.get(info.combatId);
      const total = Number(payload.total);
      if (combat?.combatants.has(info.combatantId) && Number.isFinite(total) && payload.combatantId === info.combatantId) {
        await combat.setInitiative(info.combatantId, total);
      }
      await mark();
      return;
    }
    case "damage": {
      if (info.kind !== "damage") return refuse(RELAY_REASONS.invalid);
      const ratio = Number(payload.ratio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 50) return refuse(RELAY_REASONS.invalid);
      const flags = message.flags?.[SYSTEM_ID] ?? {};
      if (!damageCardRerollable(flags)) return refuse("O dano deste card já foi aplicado.");
      const scaled = scaleDamageFlags({ damageApply: flags.damageApply, damageApplyMany: flags.damageApplyMany }, ratio);
      const update = { [`flags.${SYSTEM_ID}.rerollRaw`]: Math.max(0, Number(payload.newRaw) || 0), [`flags.${SYSTEM_ID}.${USED_FLAG}`]: true };
      if (scaled.damageApply) update[`flags.${SYSTEM_ID}.damageApply`] = scaled.damageApply;
      if (scaled.damageApplyMany) update[`flags.${SYSTEM_ID}.damageApplyMany.entries`] = scaled.damageApplyMany.entries;
      await message.update(update);
      return;
    }
    case "predation": {
      if (info.kind !== "predation") return refuse(RELAY_REASONS.invalid);
      const data = foundry.utils.deepClone(message.flags[SYSTEM_ID].predation);
      if (!data.results.some(r => r.skillId === payload.resultSkillId)) return refuse(RELAY_REASONS.invalid);
      data.results = replacePredationRoll(data.results, payload.resultSkillId, payload.roll);
      const { predationCardUpdate } = await import("./predation.js");
      await message.update(predationCardUpdate(message, data));
      return;
    }
    default:
      return refuse(RELAY_REASONS.invalid);
  }
}

/* ------------------------------------------------------------------ Ganchos */

/**
 * `preCreateChatMessage`: a iniciativa sai pelo Combate do Foundry (botão do tracker ou da ficha), então o
 * flag `nihilityRoll` é posto aqui, em qualquer caminho, com o combatente a que a rolagem pertence.
 */
function tagInitiativeRoll(message) {
  try {
    if (!isRerollEnabled() || !message.getFlag("core", "initiativeRoll")) return;
    const roll = message.rolls?.[0];
    const combat = game.combat;
    if (!roll || !combat) return;
    const speaker = message.speaker ?? {};
    const combatant = combat.combatants.find(c => (speaker.token && c.tokenId === speaker.token)) ?? combat.combatants.find(c => speaker.actor && c.actorId === speaker.actor);
    if (!combatant) return;
    message.updateSource({
      [`flags.${SYSTEM_ID}.${ROLL_FLAG}`]: { kind: "initiative", actorUuid: combatant.actor?.uuid ?? "", combatId: combat.id, combatantId: combatant.id, formula: roll.formula, total: roll.total }
    });
  } catch (err) {
    console.warn("Rerrolar: não consegui marcar a iniciativa", err);
  }
}

export function registerReroll() {
  Hooks.on("preCreateChatMessage", tagInitiativeRoll);
}

export { rerollGroupOf };


// ---------------------------------------------------------------------------
// Ações do relay do Mestre (ver helpers/gm-relay.js). Juntadas em core/relay-actions.js.
// Todas recebem `(payload, user)`; `user` é dito pelo servidor, nunca pelo payload.
// ---------------------------------------------------------------------------
export const RELAY_HANDLERS = {
  /**
   * Rerrolar (8d.2): marca a rolagem antiga, troca a iniciativa, refaz o card de dano ou o d100 da Predação.
   * Quem pede é dono da Skill de Rerrolar; o Mestre confere a Skill e se ela alcança a rolagem.
   */
  async rerollApply(payload, user) {
    if (!(await mayActFor(user, payload?.skillUuid))) return refuse(RELAY_REASONS.permission);
    return rerollApplyAsGm(payload ?? {}, user);
  }
};
