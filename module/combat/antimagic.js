/**
 * Antimagia: cobra a Mana extra (ou anula) de um uso mágico que cruza um campo ou está sob Selo.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { getEnergyLabelForActor, isEnergyPoolEnabled, isMagicUse, antimagicSurcharge, getAntimagicConfig } from "../core/config.js";
import { antimagicBetween, antimagicFieldLevelAtToken } from "../structures/structures.js";
import { applyAntimagic, releaseFieldSuppression } from "../skills/dispel.js";
import { effectEndedByField } from "../core/magic-rules.js";
import { actorToken } from "../core/config.js";
import { isDead } from "./incapacitation.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { grantSkillUseXp } from "../skills/skill-xp.js";
import { isShipLike } from "../starship/ship-damage.js";
import { energyValuePath, currentEnergyValue } from "../skills/skill-state.js";

/* ------------------------------------------------------------------ Antimagia */

/**
 * Antimagia num ataque: se o uso é mágico (isMagicUse) e há antimagia no caminho de algum alvo
 * (campo atravessado, de onde sai, onde o alvo está, ou Selo em quem ataca), cobra UMA vez o custo
 * extra do maior nível, da energia do personagem. Sem como pagar, os alvos sob antimagia ficam
 * sem efeito (vale pra Dano Absoluto mágico também).
 * @returns {Promise<{nulled: Set<string>, note: string}>} uuids anulados e o texto pro chat
 */
export async function chargeAntimagic(actor, mech, targets, { origin = null } = {}) {
  const result = { nulled: new Set(), note: "" };
  if (!actor || isShipLike(actor) || !isMagicUse(mech, actor)) return result;
  const found = new Map(targets.filter(Boolean).map(t => [t.uuid, antimagicBetween(actor, t, { origin })]));
  const levels = new Map([...found].map(([uuid, f]) => [uuid, f.level]));
  const level = Math.max(0, ...levels.values());
  if (level <= 0) return result;
  const cost = antimagicSurcharge(Number(mech.cost) || 0, level, getAntimagicConfig());
  const label = getEnergyLabelForActor(actor);
  const current = currentEnergyValue(actor);
  if (isEnergyPoolEnabled() && current >= cost) {
    await actor.update({ [energyValuePath(actor)]: current - cost });
    result.note = ` — antimagia (nível ${level}): +${cost} ${label}`;
  } else {
    for (const [uuid, l] of levels) if (l > 0) result.nulled.add(uuid);
    result.note = ` — anulado pela antimagia (nível ${level}: faltou ${label})`;
    // XP por uso: cada alvo anulado conta o fixo pra Skill do campo/Selo responsável.
    const credit = new Map();
    for (const uuid of result.nulled) for (const skillUuid of found.get(uuid)?.sources ?? []) credit.set(skillUuid, (credit.get(skillUuid) ?? 0) + 1);
    for (const [skillUuid, count] of credit) await grantSkillUseXp(skillUuid, Array.from({ length: count }, () => ({ flat: true })));
  }
  return result;
}

/**
 * Alvos "de mapa" para `chargeAntimagic`: onde uma Estrutura ou Zona vai nascer. Pontos
 * [x, y] ou {x, y}; no máximo 12 (a linha de quem lança até cada um é conferida).
 */
export function placementTargets(points) {
  return (points ?? [])
    .slice(0, 12)
    .map(p => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p?.x), y: Number(p?.y) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((point, i) => ({ uuid: `point:${i}`, point }));
}

/**
 * Quem está dentro de um campo de antimagia fechado perde o que é mágico: efeitos, Escudos e
 * Habilidades Ativas de nível até o do campo (sem o multiplicador de alcance da Skill) e fica
 * Suprimido por 1 rodada. Só Personagem, vivo, só o Mestre designado. Sem nada mágico para acabar
 * não escreve nem posta nada.
 */
export async function endMagicInsideFields(tokenDoc) {
  if (!isDesignatedGm()) return;
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== "character") return;
  const { level, sources } = antimagicFieldLevelAtToken(tokenDoc);
  // Fora de qualquer campo (ou o campo caiu): a Supressão que veio dele acaba. A de Skill fica.
  if (level <= 0) {
    await releaseFieldSuppression(actor);
    return;
  }
  if (isDead(actor)) return;
  const summary = await applyAntimagic(actor, { reach: level, field: tokenDoc.parent?.id ?? "" });
  if (!summary.changed) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> está num campo de antimagia (nível ${level}): ${summary.map(escapeHtml).join("; ")}.</p>`
  });
  // XP por uso: o fixo por coisa que acabou, pra Skill do campo.
  for (const skillUuid of sources) await grantSkillUseXp(skillUuid, Array.from({ length: summary.changed }, () => ({ flat: true })));
}

/**
 * Este Efeito mágico de `actor` (mecânica `mech`) sobre `target` seria desfeito NA HORA pelo campo
 * de antimagia em que o alvo está (nível do campo ≥ nível do Efeito)? Então não vale cobrar o extra.
 */
export function fieldEndsEffectAt(actor, mech, target) {
  if (!target || target.type !== "character" || !isMagicUse(mech, actor)) return false;
  const token = actorToken(target, [...(game.user?.targets ?? [])]);
  if (!token?.document) return false;
  const { level } = antimagicFieldLevelAtToken(token.document);
  return effectEndedByField({ magic: true, level: mech.level, fieldLevel: level });
}

/** Terminou um movimento dentro de um campo de antimagia: o que é mágico nele acaba (inclusive fora de combate). */
export function registerFieldAntimagic() {
  Hooks.on("moveToken", async document => {
    if (!isDesignatedGm()) return;
    try {
      await endMagicInsideFields(document);
    } catch (err) {
      reportError("Falha ao aplicar o campo de antimagia.", err, { gmOnly: true });
    }
  });
}
