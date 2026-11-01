/**
 * Estado de uma Skill em uso: caminhos de ligado/investido e de onde sai o Custo (Mana do Personagem, Bateria da Nave).
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { getEnergyLabelForActor } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";
import { escapeHtml } from "../helpers/html.js";

/**
 * O update que muda o estado (`active`, `investRatio`…) da Skill ou de UMA Sub-Skill.
 *
 * Sub-Skill regrava a lista inteira: na V14, um update com caminho de índice
 * (`system.subSkills.0.active`) troca o ARRAY por um novo com só aquele campo — ligar uma
 * Sub-Skill Ativa apagava todas as Sub-Skills da Skill fundida (nome, mecânica, tudo).
 * @param {Item} skill
 * @param {number|null} subSkillIndex
 * @param {object} patch - campos da Skill/Sub-Skill, sem o prefixo `system.` (ex.: `{active: true}`)
 */
export function skillStateUpdate(skill, subSkillIndex, patch) {
  if (subSkillIndex == null) return Object.fromEntries(Object.entries(patch).map(([key, value]) => [`system.${key}`, value]));
  const subs = foundry.utils.deepClone(skill?._source?.system?.subSkills ?? skill?.system?.subSkills ?? []);
  if (!subs[subSkillIndex]) return {};
  Object.assign(subs[subSkillIndex], patch);
  return { "system.subSkills": subs };
}

/**
 * Caminho e valor atual do pool de onde sai o Custo ÚNICO de uma Skill (pago uma vez ao usar/
 * ligar): Personagem/Criatura gasta Mana/Energia (`attributes.energy`); Nave e Veículo (mesmo
 * Grid de Energia desde o overhaul de Porte) gastam a reserva do Capacitor
 * (`powerGrid.capacitor.value`).
 *
 * Precisa ser um campo PERSISTIDO — antes isso apontava pra `powerGrid.reactorOutput`, que é
 * recalculado do Módulo de Reator a cada `prepareDerivedData()`: o desconto era sobrescrito na
 * preparação seguinte (Skill de Nave saía de graça) e, sem Módulo de Reator, o valor lido era
 * sempre 0 (nenhuma Skill com custo jamais podia ser usada).
 *
 * O Custo POR RODADA (upkeep) não passa por aqui: ele é descontado direto da geração do Reator,
 * de forma derivada, por `ShipSystemsDataModel.activeUpkeepDrain` — quem controla esse desconto
 * é o próprio estado `active` da Skill, então desligar devolve a energia sem precisar de
 * nenhuma escrita de compensação.
 */
export function energyValuePath(actor) {
  return isShipLike(actor) ? "system.powerGrid.capacitor.value" : "system.attributes.energy.value";
}

export function currentEnergyValue(actor) {
  return isShipLike(actor) ? (actor.system.powerGrid.capacitor.value ?? 0) : (actor.system.attributes.energy.value ?? 0);
}

/** Avisa só quem clicou (whisper individual) que a Energia (nome configurável) atual não cobre o Custo. */
export async function warnInsufficientEnergy(sourceActor, label, cost) {
  const current = currentEnergyValue(sourceActor);
  const energyLabel = getEnergyLabelForActor(sourceActor);
  await ChatMessage.create({
    whisper: [game.user.id],
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p>${energyLabel} insuficiente pra usar <strong>${escapeHtml(label)}</strong> (precisa ${cost}, ${escapeHtml(sourceActor.name)} tem ${current}).</p>`
  });
}
