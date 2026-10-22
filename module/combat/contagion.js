/**
 * Contágio (backlog B3): no início do turno de quem carrega uma Condição com `spread`, cada
 * Personagem dentro do raio rola a chance de pegar. Regras puras em contagion-rules.js.
 *
 *  - Quem rola: Personagens com Token na mesma cena do portador, dentro do raio (centro a centro),
 *    que ainda não têm a Condição e não estão mortos. Um Ator com vários Tokens rola uma vez.
 *  - Proteção: Traço da lista "imune com" → imune; Resistência aos elementos da Condição (o próprio
 *    e os "pais", como no dano) → reduz a chance na mesma proporção.
 *  - Quem pega recebe a Condição com o efeito padrão dela (como "usar o efeito padrão" no Token);
 *    Condição sem efeito padrão entra só como marca.
 *  - Um card no chat diz quem pegou e quem resistiu, com o d100. Se algum Token envolvido estiver
 *    escondido, o card vai só para o Mestre.
 *  - Só o Mestre designado executa (o hook de combate roda em todo cliente de Mestre).
 */
import { SYSTEM_ID, getActiveStatusConditions, isStatusConditionsEnabled, actorTraits, damageElementChain } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { combatantScene } from "../helpers/foundry-compat.js";
import { sceneScale } from "./area-effects.js";
import { tokenDocCenter } from "./area-geometry.js";
import { chainedResistance } from "./damage-rules.js";
import { resistanceSourceFor } from "./resistance.js";
import { isDead } from "./incapacitation.js";
import { normalizeSpread, contagionChance, withinRadius, immuneByTrait } from "./contagion-rules.js";

/** A melhor Resistência do Ator entre os elementos da Condição (cada um com a cadeia de "pais"). */
function elementResistance(actor, elementIds) {
  let best = 0;
  for (const id of elementIds ?? []) {
    const chain = damageElementChain(id).map(el => el.id);
    const ids = chain.length ? chain : [id];
    best = Math.max(best, chainedResistance(ids.map(x => resistanceSourceFor(actor, x).percent)));
  }
  return best;
}

/** Passa a Condição: com o efeito padrão dela, ou só a marca se ela não tiver efeito. */
async function infect(actor, condition) {
  if (condition.effect?.kind) {
    const { applyManualCondition } = await import("../skills/effects-apply.js");
    await applyManualCondition(actor, condition.id, {
      target: "hp", amount: 0, durationRounds: 0, periodic: false, tickUnit: "combatRound",
      damageElements: [], modifierType: "flat", icon: "", hitDamage: 0
    });
    return;
  }
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{ name: condition.label, img: condition.icon, statuses: [condition.id], flags: { [SYSTEM_ID]: { conditionId: condition.id, manual: true } } }],
    { nihilityConfigured: true }
  );
}

/**
 * Início do turno do portador (chamado do `updateCombat`). Mortos não espalham nem pegam.
 * @param {Combatant} combatant
 */
export async function tickContagion(combatant) {
  if (!isDesignatedGm() || !isStatusConditionsEnabled()) return;
  const carrier = combatant?.actor;
  const scene = combatantScene(combatant);
  const from = combatant?.token;
  if (!carrier || !scene || !from || isDead(carrier)) return;

  const spreading = getActiveStatusConditions()
    .map(condition => ({ condition, spread: normalizeSpread(condition.spread) }))
    .filter(({ condition, spread }) => spread && carrier.statuses?.has(condition.id));
  if (!spreading.length) return;

  const esc = foundry.utils.escapeHTML;
  const { pxPerUnit } = sceneScale(scene);
  const gridSize = scene.grid?.size;
  const origin = tokenDocCenter(from, gridSize);
  let secret = Boolean(from.hidden);

  for (const { condition, spread } of spreading) {
    const rows = [];
    const seen = new Set([carrier.uuid]);
    for (const token of scene.tokens) {
      const actor = token.actor;
      if (!actor || actor.type !== "character" || seen.has(actor.uuid)) continue;
      if (!withinRadius(origin, tokenDocCenter(token, gridSize), spread.radius, pxPerUnit)) continue;
      seen.add(actor.uuid);
      if (isDead(actor) || actor.statuses?.has(condition.id)) continue;
      if (token.hidden) secret = true;

      const immune = immuneByTrait(actorTraits(actor), spread.immuneTraits);
      const chance = contagionChance({ chance: spread.chance, resistance: elementResistance(actor, condition.elements), immune });
      if (!chance) {
        rows.push(`<li>${esc(token.name)}: imune</li>`);
        continue;
      }
      const roll = await new Roll("1d100").evaluate();
      const caught = roll.total <= chance;
      if (caught) await infect(actor, condition);
      rows.push(`<li>${esc(token.name)}: ${caught ? "<strong>pegou</strong>" : "resistiu"} (${roll.total} ${caught ? "≤" : ">"} ${chance}%)</li>`);
    }
    if (!rows.length) continue;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: carrier }),
      whisper: secret ? game.users.filter(u => u.isGM).map(u => u.id) : [],
      content: `<p><strong>${esc(condition.label)}</strong> se espalha de ${esc(from.name)} (raio ${spread.radius} m, ${spread.chance}%):</p><ul>${rows.join("")}</ul>`
    });
  }
}
