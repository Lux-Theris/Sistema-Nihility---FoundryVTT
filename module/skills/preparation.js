/**
 * Recarga e Preparo de Skills (backlog H3) — o lado Foundry. As contas são puras, em
 * `cooldown-rules.js` (testado).
 *
 *  - **Recarga:** `system.cooldownRemaining` na Skill (ou na Sub-Skill, gravado pela lista inteira com
 *    `skillStateUpdate`). Anda 1 no começo de cada turno do dono, só em combate; fora de combate não
 *    bloqueia nem é gravada. Zera quando o combate acaba e no Descanso.
 *  - **Preparo:** a Skill vira uma entrada na lista `preparing` do flag do Ator que a segura
 *    (`{id, skillUuid, skillId, subSkillIndex, label, turnsLeft, payments, paid, investRatio, options}`)
 *    e um Active Effect "Preparando: X" no Token, cujo número é o que falta. `options` guarda o que o
 *    disparo precisa (alvos por uuid, área, posição, rolagem): alvo e área são escolhidos ao COMEÇAR.
 *    No início de cada turno do dono (Mestre designado, depois do Vida 0): paga a parte do turno (faltou
 *    Mana → falha e o pago se perde) e, no turno seguinte à última parte, dispara pelo caminho normal
 *    (`useSkillEffect` com `prepaid`), sem cobrar de novo. Cair incapacitado cancela; Supressão
 *    (Antimagia para mágica, PEM para tecnológica) no começo do turno também.
 */
import { SYSTEM_ID, combatantIsActor, getEnergyLabelForActor, isMagicUse, isTechUse, getManaInvestConfig } from "../core/config.js";
import { suppressionLevel, techSuppressionLevel } from "../core/suppression.js";
import { isIncapacitated } from "../combat/incapacitation.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { refreshMark } from "../combat/range.js";
import { skillStateUpdate, energyValuePath, currentEnergyValue } from "./skill-state.js";
import {
  cooldownMessage,
  cooldownToStore,
  onCooldown,
  tickCooldown,
  totalCooldown,
  preparationStep,
  unpackUseOptions
} from "./cooldown-rules.js";

export const PREPARING_FLAG = "preparing";
const PREP_ICON = "icons/svg/clockwork.svg";

/** O combate já começado em que este Ator está, ou null. */
export function startedCombatOf(actor) {
  return game.combats?.find(c => c.started && c.combatants.some(cb => combatantIsActor(cb, actor))) ?? null;
}

/** Recarga e Preparo só contam (e só se gravam) com o Ator num combate começado. */
export function inStartedCombat(actor) {
  return Boolean(startedCombatOf(actor));
}

/** A mecânica (Skill ou Sub-Skill) e o nome para exibir. */
function mechOf(skill, subSkillIndex) {
  const sub = subSkillIndex != null ? (skill.system.subSkills ?? [])[subSkillIndex] : null;
  return { mech: sub ?? skill.system, label: sub ? `${skill.name} — ${sub.name}` : skill.name };
}

/* ------------------------------------------------------------------ Estado */

export function preparationsOf(actor) {
  const list = actor?.getFlag?.(SYSTEM_ID, PREPARING_FLAG);
  return Array.isArray(list) ? foundry.utils.deepClone(list) : [];
}

function sameSkill(entry, skill, subSkillIndex) {
  return entry.skillUuid === skill.uuid && (entry.subSkillIndex ?? null) === (subSkillIndex ?? null);
}

export function preparationFor(actor, skill, subSkillIndex = null) {
  return preparationsOf(actor).find(e => sameSkill(e, skill, subSkillIndex)) ?? null;
}

/**
 * Por que esta Skill não pode ser usada agora (recarga ou preparo), ou null. Desligar uma Skill
 * Ativa nunca é bloqueado. Só a recarga que está gravada vale — ela só é gravada em combate.
 */
export function useBlockReason(actor, skill, subSkillIndex = null) {
  const { mech, label } = mechOf(skill, subSkillIndex);
  if (mech.hasUpkeep && mech.active) return null;
  if (preparationFor(actor, skill, subSkillIndex)) return `${label} ainda está em preparo.`;
  if (onCooldown(mech.cooldownRemaining)) return cooldownMessage(label, mech.cooldownRemaining);
  return null;
}

/** `{skillId: "livre em 3 turnos"}` para a linha da ficha (botão Usar desligado). Só a Skill inteira, não Sub-Skills. */
export function skillTimersFor(actor) {
  const out = {};
  const prep = preparationsOf(actor);
  for (const skill of actor?.items?.filter(i => i.type === "skill") ?? []) {
    if (skill.system.subSkills?.length) continue;
    if (skill.system.hasUpkeep && skill.system.active) continue;
    const entry = prep.find(e => e.skillUuid === skill.uuid && e.subSkillIndex == null);
    if (entry) out[skill.id] = `preparando (${entry.turnsLeft})`;
    else if (onCooldown(skill.system.cooldownRemaining)) out[skill.id] = (skill.system.cooldownRemaining === 1 ? "livre no próximo turno" : `livre em ${skill.system.cooldownRemaining} turnos`);
  }
  return out;
}

/* ------------------------------------------------------------------ Recarga */

/** Grava a recarga de depois do uso (só em combate). `ratio` = Mana investida ÷ Custo. */
export async function applyCooldownAfterUse(actor, skill, subSkillIndex, ratio = 1) {
  if (!skill || !inStartedCombat(actor)) return;
  const { mech } = mechOf(skill, subSkillIndex);
  const total = totalCooldown(mech.cooldown, ratio, getManaInvestConfig().overcharge);
  if (!total) return;
  await skill.update(skillStateUpdate(skill, subSkillIndex, { cooldownRemaining: cooldownToStore(total) }));
}

function cooldownUpdateFor(skill, transform) {
  const system = skill._source?.system ?? {};
  const patch = {};
  const own = Number(system.cooldownRemaining) || 0;
  if (own > 0) patch["system.cooldownRemaining"] = transform(own);
  const subs = foundry.utils.deepClone(system.subSkills ?? []);
  let changed = false;
  for (const sub of subs) {
    const value = Number(sub?.cooldownRemaining) || 0;
    if (value > 0) {
      sub.cooldownRemaining = transform(value);
      changed = true;
    }
  }
  if (changed) patch["system.subSkills"] = subs;
  return Object.keys(patch).length ? { _id: skill.id, ...patch } : null;
}

async function updateCooldowns(actor, transform) {
  const updates = (actor?.items?.filter(i => i.type === "skill") ?? []).map(skill => cooldownUpdateFor(skill, transform)).filter(Boolean);
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/** Início de um turno do dono: toda recarga anda 1. */
export const tickCooldowns = actor => updateCooldowns(actor, tickCooldown);

/** Fim do combate e Descanso: as recargas somem. */
export const clearCooldowns = actor => updateCooldowns(actor, () => 0);

/* ------------------------------------------------------------------ Preparo */

async function preparingEffectFor(actor, entry) {
  return actor.effects.find(e => e.getFlag(SYSTEM_ID, "preparing")?.entryId === entry.id) ?? null;
}

async function writeList(actor, list) {
  // A lista inteira de novo (array: setFlag substitui), nunca um caminho com índice.
  if (list.length) await actor.setFlag(SYSTEM_ID, PREPARING_FLAG, list);
  else await actor.unsetFlag(SYSTEM_ID, PREPARING_FLAG);
}

/**
 * Começa um Preparo: guarda a entrada e põe o efeito "Preparando" no Ator. O Custo da 1ª parte já foi
 * pago por quem chama.
 * @param {object} args
 * @param {Actor} args.actor
 * @param {Item} args.skill
 * @param {number|null} args.subSkillIndex
 * @param {number[]} args.payments  as partes do Custo (a 1ª já paga)
 * @param {number} args.investRatio
 * @param {object} args.options  `packUseOptions(...)` do uso
 */
export async function startPreparation({ actor, skill, subSkillIndex = null, payments, investRatio = 1, options = {} }) {
  const { mech, label } = mechOf(skill, subSkillIndex);
  const turns = Math.max(1, Number(mech.prepTurns) || 1);
  const entry = {
    id: foundry.utils.randomID(),
    skillUuid: skill.uuid,
    skillId: skill.id,
    subSkillIndex: subSkillIndex ?? null,
    label,
    turnsLeft: turns,
    payments,
    paid: 1,
    investRatio,
    options
  };
  const [effect] = await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{ name: `Preparando: ${label}`, img: skill.img || PREP_ICON, flags: { [SYSTEM_ID]: { skillEffect: true, preparing: { entryId: entry.id, turnsLeft: turns } } } }],
    { nihilityConfigured: true }
  );
  entry.effectId = effect?.id ?? null;
  await writeList(actor, [...preparationsOf(actor), entry]);
  return entry;
}

async function dropEntry(actor, entry) {
  const effect = (entry.effectId && actor.effects.get(entry.effectId)) || (await preparingEffectFor(actor, entry));
  if (effect) await effect.delete();
  await writeList(actor, preparationsOf(actor).filter(e => e.id !== entry.id));
}

/** O Preparo falhou/foi cancelado: some o efeito e o registro; o que foi pago se perde. */
export async function failPreparation(actor, entry, reason) {
  await dropEntry(actor, entry);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>O preparo de <strong>${escapeHtml(entry.label)}</strong> de <strong>${escapeHtml(actor.name)}</strong> falhou: ${escapeHtml(reason)}. O que já foi pago de ${escapeHtml(getEnergyLabelForActor(actor))} se perdeu.</p>`
  });
}

/** Cancela todos os Preparos do Ator (ficou incapacitado). */
export async function cancelAllPreparations(actor, reason) {
  for (const entry of preparationsOf(actor)) await failPreparation(actor, entry, reason);
}

async function bumpEntry(actor, entry, patch) {
  const next = { ...entry, ...patch };
  await writeList(actor, preparationsOf(actor).map(e => (e.id === entry.id ? next : e)));
  const effect = entry.effectId && actor.effects.get(entry.effectId);
  if (effect) await effect.update({ [`flags.${SYSTEM_ID}.preparing.turnsLeft`]: next.turnsLeft });
  return next;
}

async function releasePreparation(actor, entry, skill) {
  await dropEntry(actor, entry);
  const options = unpackUseOptions(entry.options, uuid => {
    try {
      return fromUuidSync(uuid);
    } catch {
      return null;
    }
  });
  if (options.targetUuidMissing) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>O alvo de <strong>${escapeHtml(entry.label)}</strong> sumiu antes de disparar: o preparo foi perdido.</p>`
    });
    return;
  }
  delete options.targetUuidMissing;
  // Pela Marca (H4): se a Marca sumiu antes de disparar (Antimagia, prazo, campo), a Skill falha e o
  // pago se perde. A origem é onde o Marcado está agora (ele pode ter andado); o fator fica o do início.
  if (options.viaMark) {
    const mark = refreshMark(actor.uuid, options.viaMark.markUuid);
    if (!mark) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>A Marca usada por <strong>${escapeHtml(entry.label)}</strong> sumiu antes de disparar: o preparo falhou. O que já foi pago de ${escapeHtml(getEnergyLabelForActor(actor))} se perdeu.</p>`
      });
      return;
    }
    if (mark.point) options.viaMark = { ...options.viaMark, origin: { x: mark.point.x, y: mark.point.y } };
  }
  const { useSkillEffect } = await import("./skill-effects.js");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(entry.label)}</strong> de <strong>${escapeHtml(actor.name)}</strong> ficou pronta!</p>`
  });
  await useSkillEffect(actor, skill.id, { ...options, subSkillIndex: entry.subSkillIndex ?? null, prepaid: { ratio: entry.investRatio ?? 1 } });
}

/** A Supressão que impede o disparo, ou null: Antimagia para mágica, PEM para tecnológica. */
function suppressionReason(actor, mech) {
  if (actor.type !== "character") return null;
  if (isMagicUse(mech, actor) && suppressionLevel(actor) !== null) return "o personagem está Suprimido (Antimagia)";
  if (isTechUse(mech, actor) && techSuppressionLevel(actor) !== null) return "o personagem está Suprimido (Tecnologia)";
  return null;
}

/**
 * Início do turno do dono (Mestre designado, `updateCombat`, logo depois do Vida 0): a recarga anda 1 e
 * cada Preparo paga a parte do turno ou dispara.
 */
export async function tickSkillTimers(actor) {
  if (!isDesignatedGm() || !actor) return;
  try {
    await tickCooldowns(actor);
  } catch (err) {
    reportError("Falha ao andar a recarga das Habilidades.", err, { gmOnly: true });
  }
  for (const entry of preparationsOf(actor)) {
    try {
      const skill = actor.items.get(entry.skillId);
      if (!skill) {
        await dropEntry(actor, entry);
        continue;
      }
      if (isIncapacitated(actor)) {
        await failPreparation(actor, entry, "o personagem está incapacitado");
        continue;
      }
      const { mech } = mechOf(skill, entry.subSkillIndex);
      const blocked = suppressionReason(actor, mech);
      if (blocked) {
        await failPreparation(actor, entry, blocked);
        continue;
      }
      const step = preparationStep({ turnsLeft: entry.turnsLeft, payments: entry.payments, paid: entry.paid });
      if (step.action === "release") {
        await releasePreparation(actor, entry, skill);
        continue;
      }
      const current = currentEnergyValue(actor);
      if (current < step.amount) {
        await failPreparation(actor, entry, `faltou ${getEnergyLabelForActor(actor)} para a parte do turno (${step.amount}, tem ${current})`);
        continue;
      }
      if (step.amount > 0) await actor.update({ [energyValuePath(actor)]: current - step.amount });
      await bumpEntry(actor, entry, { turnsLeft: step.turnsLeft, paid: step.paid });
    } catch (err) {
      reportError(`Falha ao processar o preparo de ${entry.label}.`, err, { gmOnly: true });
    }
  }
}

/** Fim do combate: tira os Preparos (sem aviso de falha) e as recargas dos combatentes. Mestre designado. */
export async function endCombatTimers(combat) {
  if (!isDesignatedGm()) return;
  const seen = new Set();
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    try {
      for (const entry of preparationsOf(actor)) await dropEntry(actor, entry);
      await clearCooldowns(actor);
    } catch (err) {
      reportError(`Falha ao limpar recargas e preparos de ${actor.name}.`, err, { gmOnly: true });
    }
  }
}

export function registerSkillTimers() {
  Hooks.on("deleteCombat", combat => endCombatTimers(combat));
}
