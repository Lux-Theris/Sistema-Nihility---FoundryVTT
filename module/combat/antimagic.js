/**
 * Campos de Antimagia/Interferência (e Selos) × um uso (regra do dono, 12/11). Três casos:
 *  - de FORA para dentro: o uso é pago normalmente e depois some, se o campo vence;
 *  - de DENTRO do campo ou sob Selo: nada acontece — não sai e não gasta nada (`fieldGate`);
 *  - a Manipulação de [energia] (Skill pré-feita) decide a força do campo contra quem usa
 *    (`fieldUseOutcome`, a curva do bloqueio de cura): some, passa pagando extra, ou passa de graça.
 * A tecnologia não tem Skill "contra": no campo de Interferência o uso tecnológico sempre some.
 * (Separado de skill-effects.js na reorganização de pastas.)
 */
import { getEnergyLabelForActor, isEnergyPoolEnabled, isInterferenceEnabled, isMagicUse, isTechUse, getHealingRules, actorManipulation, actorSealLevel } from "../core/config.js";
import { antimagicBetween, antimagicFieldLevelAtToken, antimagicLevelAt, enclosingStructureKinds } from "../structures/structures.js";
import { applyAntimagic, applyEmp, releaseFieldSuppression } from "../skills/dispel.js";
import { fieldUseOutcome } from "../core/magic-rules.js";
import { isDead } from "./incapacitation.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { grantSkillUseXp } from "../skills/skill-xp.js";
import { isShipLike } from "../starship/ship-damage.js";
import { energyValuePath, currentEnergyValue } from "../skills/skill-state.js";

/* ------------------------------------------------------------------ Antimagia e Interferência */

/** Tudo que muda entre a antimagia (uso mágico) e a interferência (uso tecnológico, o PEM). */
const FIELD_TEXT = {
  magic: { word: "antimagia", nulled: "anulado pela antimagia", plus: "antimagia", field: "Campo de Antimagia", seal: "Selo Antimagia" },
  tech: { word: "interferência", nulled: "anulado pela interferência", plus: "interferência", field: "Campo de Interferência", seal: "Selo de Interferência" }
};

/** As naturezas do uso que um campo alcança: magia (Nave nunca) e/ou tecnologia (bloco PEM ligado). */
function usedKinds(actor, mech) {
  const kinds = [];
  if (!isShipLike(actor) && isMagicUse(mech, actor)) kinds.push("magic");
  if (isInterferenceEnabled() && isTechUse(mech, actor)) kinds.push("tech");
  return kinds;
}

/** Manipulação de quem usa vale só contra a Antimagia (a tecnologia não tem Skill contra). */
function manipulationFor(kind, actor) {
  return kind === "magic" ? actorManipulation(actor) : { skill: null, level: 0 };
}

/**
 * Quem usa ESTÁ dentro de um campo (ou sob Selo) da natureza do uso? Então não sai nada e nada se
 * gasta, a menos que a Manipulação deixe passar — pagando `extra` a mais de energia (sobre o
 * `baseCost` pago). Chamar duas vezes: cedo (`baseCost` 0) para recusar antes de gastar, e depois
 * de saber o quanto se paga, para o extra.
 * @returns {{blocked: string|null, extra: number, resisted: boolean, skill: Item|null}}
 */
export function fieldGate(actor, mech, { baseCost = 0 } = {}) {
  const gate = { blocked: null, extra: 0, resisted: false, skill: null };
  if (!actor) return gate;
  for (const kind of usedKinds(actor, mech)) {
    const fieldLevel = antimagicLevelAt(actor, kind);
    if (fieldLevel <= 0) continue;
    const manipulation = manipulationFor(kind, actor);
    const outcome = fieldUseOutcome({ inside: true, kind, manipulationLevel: manipulation.level, fieldLevel, baseCost, zeroMultiplier: getHealingRules().zeroMultiplier });
    if (outcome.action === "blocked") {
      const text = FIELD_TEXT[kind];
      gate.blocked ??= actorSealLevel(actor, kind) > 0 ? `Sob o ${text.seal}, a ação de ${actor.name} não sai.` : `Dentro do ${text.field}, a ação de ${actor.name} não sai.`;
      continue;
    }
    gate.extra += outcome.extra;
    if (outcome.resisted) {
      gate.resisted = true;
      gate.skill = manipulation.skill;
    }
  }
  return gate;
}

/** XP por uso da Manipulação: o fixo cada vez que ela deixa um uso passar por um campo. */
export async function creditManipulation(skill) {
  if (skill) await grantSkillUseXp(skill, [{ flat: true }]);
}

/**
 * De um uso da natureza `kind` que vem de FORA (ou, sem `mech.fieldGated`, de dentro) cruzando um
 * campo: decide por `fieldUseOutcome` — some, passa pagando o extra de energia, ou passa de graça.
 * Um TIRO de arma tecnológica não gasta energia, então só some.
 */
async function chargeKind(kind, actor, mech, targets, { origin = null } = {}) {
  const result = { nulled: new Set(), note: "" };
  if (!actor || !usedKinds(actor, mech).includes(kind)) return result;
  const found = new Map(targets.filter(Boolean).map(t => [t.uuid, antimagicBetween(actor, t, { origin, kind })]));
  const levels = new Map([...found].map(([uuid, f]) => [uuid, f.level]));
  const level = Math.max(0, ...levels.values());
  if (level <= 0) return result;
  const inside = antimagicLevelAt(actor, kind) > 0;
  // De dentro, quem passou pelo portão (`fieldGated`) já pagou o extra: aqui não se cobra de novo.
  if (inside && mech.fieldGated) return result;
  const text = FIELD_TEXT[kind];
  const label = getEnergyLabelForActor(actor);
  const shot = kind === "tech" && Boolean(mech.weaponShot);
  const manipulation = manipulationFor(kind, actor);
  const baseCost = shot ? 0 : Number(mech.paidCost ?? mech.cost) || 0;
  const outcome = fieldUseOutcome({ inside, kind, manipulationLevel: manipulation.level, fieldLevel: level, baseCost, zeroMultiplier: getHealingRules().zeroMultiplier });
  let passes = outcome.action === "pass" || outcome.action === "extra";
  if (outcome.action === "extra") {
    const current = currentEnergyValue(actor);
    if (!shot && (isShipLike(actor) || isEnergyPoolEnabled()) && current >= outcome.extra) {
      await actor.update({ [energyValuePath(actor)]: current - outcome.extra });
      result.note = ` — Manipulação (${text.plus} nível ${level}): +${outcome.extra} ${label}`;
    } else {
      passes = false;
    }
  } else if (outcome.action === "pass") {
    result.note = ` — Manipulação atravessa a ${text.word} (nível ${level})`;
  }
  if (passes) {
    await creditManipulation(manipulation.skill);
    return result;
  }
  for (const [uuid, l] of levels) if (l > 0) result.nulled.add(uuid);
  result.note = shot
    ? ` — ${text.nulled} (nível ${level}): a arma não dispara através do campo`
    : outcome.action === "extra"
      ? ` — ${text.nulled} (nível ${level}: faltou ${label} para a Manipulação)`
      : ` — ${text.nulled} (nível ${level})`;
  // XP por uso: cada alvo anulado conta o fixo pra Skill do campo/Selo responsável.
  const credit = new Map();
  for (const uuid of result.nulled) for (const skillUuid of found.get(uuid)?.sources ?? []) credit.set(skillUuid, (credit.get(skillUuid) ?? 0) + 1);
  for (const [skillUuid, count] of credit) await grantSkillUseXp(skillUuid, Array.from({ length: count }, () => ({ flat: true })));
  return result;
}

/**
 * Antimagia / interferência num ataque ou efeito que vem de FORA: se o uso é mágico e/ou
 * tecnológico e há campo do tipo no caminho de algum alvo (campo atravessado ou onde o alvo está),
 * decide por `fieldUseOutcome` (Manipulação). Um uso tecnomágico passa pelos dois. Quem já usou de
 * dentro de um campo passou antes por `fieldGate`.
 * @returns {Promise<{nulled: Set<string>, note: string}>} uuids anulados e o texto pro chat
 */
export async function chargeAntimagic(actor, mech, targets, { origin = null } = {}) {
  const magic = await chargeKind("magic", actor, mech, targets, { origin });
  const tech = await chargeKind("tech", actor, mech, targets, { origin });
  return { nulled: new Set([...magic.nulled, ...tech.nulled]), note: `${magic.note}${tech.note}` };
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
 * Quem está dentro de um campo fechado perde o que é da natureza dele: efeitos, Escudos e
 * Habilidades Ativas de nível até o do campo (sem o multiplicador de alcance da Skill) e fica
 * Suprimido enquanto estiver nele. Campo de antimagia pega o mágico; campo de interferência o
 * tecnológico (e desliga corpo mecânico). Só Personagem, vivo, só o Mestre designado. Sem nada
 * para acabar não escreve nem posta nada. Estrutura do tipo oposto em volta protege.
 */
export async function endMagicInsideFields(tokenDoc, position = null) {
  if (!isDesignatedGm()) return;
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== "character") return;
  const kinds = isInterferenceEnabled() ? ["magic", "tech"] : ["magic"];
  for (const kind of kinds) {
    const { level, sources } = antimagicFieldLevelAtToken(tokenDoc, position, kind);
    // Fora de qualquer campo (ou o campo caiu): a Supressão que veio dele acaba. A de Skill fica.
    if (level <= 0) {
      await releaseFieldSuppression(actor, kind);
      continue;
    }
    if (isDead(actor)) continue;
    // Manipulação que resiste ao campo (a curva não dá bloqueio total): a magia de quem está dentro
    // não acaba e ele não fica Suprimido — as Skills Ativas pagam o extra por rodada na manutenção.
    const manipulation = manipulationFor(kind, actor);
    if (manipulation.level > 0) {
      const outcome = fieldUseOutcome({ inside: true, kind, manipulationLevel: manipulation.level, fieldLevel: level, baseCost: 0, zeroMultiplier: getHealingRules().zeroMultiplier });
      if (outcome.action !== "blocked") {
        await releaseFieldSuppression(actor, kind);
        continue;
      }
    }
    const apply = kind === "tech" ? applyEmp : applyAntimagic;
    const summary = await apply(actor, { reach: level, field: tokenDoc.parent?.id ?? "", structureKinds: enclosingStructureKinds(tokenDoc, position) });
    if (!summary.changed) continue;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> está num campo de ${FIELD_TEXT[kind].word} (nível ${level}): ${summary.map(escapeHtml).join("; ")}.</p>`
    });
    // XP por uso: o fixo por coisa que acabou, pra Skill do campo.
    for (const skillUuid of sources) await grantSkillUseXp(skillUuid, Array.from({ length: summary.changed }, () => ({ flat: true })));
  }
}

/** Terminou um movimento dentro de um campo de antimagia: o que é mágico nele acaba (inclusive fora de combate). */
export function registerFieldAntimagic() {
  Hooks.on("moveToken", async (document, movement) => {
    if (!isDesignatedGm()) return;
    try {
      // O documento só chega ao destino depois da animação: usa o destino do movimento.
      await endMagicInsideFields(document, movement?.destination);
    } catch (err) {
      reportError("Falha ao aplicar o campo de antimagia.", err, { gmOnly: true });
    }
  });
}
