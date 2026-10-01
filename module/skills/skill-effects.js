/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { getEnergyLabelForActor, isEnergyPoolEnabled, effectiveSkillCost, isStructureMechanic, manaInvestmentPower, getManaInvestConfig } from "../core/config.js";
import { createZoneTemplate } from "../combat/area-effects.js";
import { playSkillAnimation } from "../core/vfx.js";
import { requestStructure } from "../structures/structures.js";
import { promptManaInvestment } from "../apps/mana-invest-dialog.js";
import { rollSkillDamage, rollSkillDamageArea } from "../combat/damage-roll.js";
import { applyEffectsToActor } from "./effects-apply.js";
import { isShipLike } from "../starship/ship-damage.js";
import { activeStatePath, investRatioPath, energyValuePath, currentEnergyValue, warnInsufficientEnergy } from "./skill-state.js";
import { removeUpkeepLinkedEffects } from "./upkeep.js";

/**
 * Ponto de entrada único de "Usar Habilidade".
 *  - `targetType: "targeted"` (padrão): usa `options.targetActor` (1 Ator, escolhido via
 *    dropdown em actor-sheet.js) — comportamento de sempre.
 *  - `targetType: "emission"`: usa `options.targetActors` (lista já resolvida pela forma
 *    posicionada no canvas via module/area-effects.js) — sem alvo único envolvido.
 *  - `options.subSkillIndex`: quando a Skill tem Sub-Skills (só existe em Skills Fundidas —
 *    ver skill-economy.js#fuseSkills), a mecânica usada é a daquele componente específico
 *    (`system.subSkills[i]`, que carrega seu próprio effectType/damageFormula/effects/
 *    targetType/etc.) em vez da mecânica própria da Skill — igual as Skills Únicas do
 *    Tensura, que têm várias sub-habilidades nomeadas dentro de uma só Skill "guarda-chuva".
 *    `actor-sheet.js` já resolve qual índice antes de chamar isto (ver `_promptSubSkillChoice`).
 *
 * Custo de Energia (`mech.cost`) é cobrado UMA VEZ aqui, sempre — inclusive em Skills
 * "Descritiva" (effectType "none"), que agora também são "usáveis" (postam um anúncio simples
 * no chat em vez de só um toast). Skills "Ativas" (`mech.hasUpkeep`) alternam ligado/desligado a
 * cada clique: ligar cobra `cost` e passa a drenar `upkeepCost` por rodada (ver
 * `tickActorUpkeepSkills`, chamada do hook `updateCombat`); desligar (clique com `mech.active`
 * já true) nunca cobra de novo nem re-executa a mecânica — só para o dreno.
 * @param {Actor} sourceActor - dono da skill
 * @param {string} skillId
 * @param {{targetActor?: Actor, targetActors?: Actor[], subSkillIndex?: number}} [options]
 */
export async function useSkillEffect(sourceActor, skillId, options = {}) {
  const skill = sourceActor.items.get(skillId);
  if (!skill) return null;

  let mech = skill.system;
  let label = skill.name;
  if (options.subSkillIndex != null) {
    const sub = (skill.system.subSkills ?? [])[options.subSkillIndex];
    if (sub) {
      mech = sub;
      label = `${skill.name} — ${sub.name}`;
    }
  }

  if (mech.hasUpkeep && mech.active) {
    await skill.update({ [activeStatePath(options.subSkillIndex)]: false });
    await removeUpkeepLinkedEffects(skill, options.subSkillIndex ?? null);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${sourceActor.name}</strong> desativou <strong>${label}</strong>.</p>`
    });
    return true;
  }

  // Numa campanha sem pool de Mana/Energia (setting `energyPoolEnabled`), Personagem/Criatura
  // não paga Custo nenhum — a Habilidade continua funcionando, o recurso é que não existe.
  // Nave/Veículo ignora esse desligamento: o Grid de Energia é um sistema à parte.
  const chargesEnergy = isShipLike(sourceActor) || isEnergyPoolEnabled();
  // O Custo escrito na Skill é o do nível 1; o ciclo de nível vai descontando dele (ver
  // skillLevelBonuses em config.js). Sub-Skill usa o nível dela própria, não o da Skill-mãe.
  const cost = chargesEnergy ? effectiveSkillCost(mech.cost, mech.level) : 0;

  // Mana variável: quem usa escolhe quanto investir (sem teto; mínimo nas Regras da Mesa), e a
  // força da Skill segue `manaInvestmentPower`. Só pra quem paga com Mana (Nave paga com a Bateria).
  let paid = cost;
  let investRatio = 1;
  const investConfig = getManaInvestConfig();
  if (cost > 0 && mech.variableMana && !isShipLike(sourceActor)) {
    const available = currentEnergyValue(sourceActor);
    const minimum = Math.max(1, Math.ceil((cost * investConfig.minPercent) / 100));
    if (available < minimum) {
      await warnInsufficientEnergy(sourceActor, label, minimum);
      return null;
    }
    const invested =
      options.manaInvested ??
      (await promptManaInvestment({
        label,
        cost,
        available,
        minimum,
        exponent: investConfig.exponent,
        energyLabel: getEnergyLabelForActor(sourceActor)
      }));
    if (invested == null) return null;
    paid = invested;
    investRatio = invested / cost;
  }

  if (paid > 0) {
    const current = currentEnergyValue(sourceActor);
    if (current < paid) {
      await warnInsufficientEnergy(sourceActor, label, paid);
      return null;
    }
    await sourceActor.update({ [energyValuePath(sourceActor)]: current - paid });
  }
  if (mech.hasUpkeep) {
    // A razão investida fica guardada: o Custo por rodada é cobrado vezes ela enquanto ligada.
    await skill.update({ [activeStatePath(options.subSkillIndex)]: true, [investRatioPath(options.subSkillIndex)]: investRatio });
  }
  // Daqui pra frente a Skill carrega a força do investimento (dano, Efeitos, Vida de Estrutura).
  const investPower = manaInvestmentPower(investRatio, investConfig.exponent);
  if (investPower !== 1) mech = { ...(typeof mech.toObject === "function" ? mech.toObject() : mech), investPower };

  // Dispara e esquece — nunca aguardado, a animação não deve atrasar a mecânica/chat. Dano em alvo
  // único toca a animação dentro de `rollSkillDamage`, que sabe se uma Estrutura segurou o golpe
  // (a animação para na parede) e se sobrou dano pra seguir até o alvo.
  const damagesOneTarget = mech.effectType === "damage" && mech.targetType !== "emission" && mech.targetType !== "zone" && !isStructureMechanic(mech);
  if (!damagesOneTarget) playSkillAnimation(sourceActor, mech, { targetActor: options.targetActor ?? options.targetActors?.[0] ?? null });

  if (isStructureMechanic(mech)) {
    // Estrutura: a Skill ergue parede/bloco no mapa (ver structures.js). Sem mapa, só o cartão.
    return requestStructure({
      sourceActor,
      skillId,
      subSkillIndex: options.subSkillIndex ?? null,
      structureId: mech.structureId,
      placement: options.structurePlacement ?? null,
      untilDeactivated: mech.hasUpkeep,
      label,
      power: mech.investPower ?? 1
    });
  }

  if (mech.targetType === "zone") {
    // Zona: nada é aplicado agora — o efeito só cai em quem estiver DENTRO dela no início do
    // próprio turno (ver `tickZonesForCombatant`). Aqui só nasce a área na cena.
    if (!options.zonePlacement) return null;
    await createZoneTemplate(options.zonePlacement, {
      sourceActor,
      skillId,
      subSkillIndex: options.subSkillIndex ?? null,
      label,
      rounds: mech.zoneRounds,
      untilDeactivated: mech.hasUpkeep
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${sourceActor.name}</strong> criou a zona <strong>${label}</strong> (${mech.hasUpkeep ? "até desativar" : `${mech.zoneRounds} rodada(s)`}) — afeta quem permanecer nela no início do próprio turno.</p>`
    });
    return true;
  }

  const isEmission = mech.targetType === "emission";

  if (mech.effectType === "damage") {
    return isEmission
      ? rollSkillDamageArea(sourceActor, mech, label, options.targetActors ?? [], options.rollOptions ?? null)
      : rollSkillDamage(sourceActor, mech, label, options.targetActor ?? null, options.rollOptions ?? null);
  }
  if (mech.effectType === "temporary") {
    return isEmission
      ? applySkillEffectsArea(sourceActor, skill, mech, label, options.targetActors ?? [], options.subSkillIndex ?? null)
      : applySkillEffects(sourceActor, skill, mech, label, options.targetActor ?? sourceActor, options.subSkillIndex ?? null);
  }

  const upkeepNote = mech.hasUpkeep
    ? ` (ativada — drena ${effectiveSkillCost(mech.upkeepCost, mech.level)} de ${getEnergyLabelForActor(sourceActor)} por rodada)`
    : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong>${upkeepNote}.</p>`
  });
  return true;
}

export async function applySkillEffects(sourceActor, skill, mech, label, targetActor, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  const summary = await applyEffectsToActor(mech, label, skill, targetActor, subSkillIndex);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> em <strong>${targetActor.name}</strong>: ${summary.join(", ")}.</p>`
  });

  return true;
}

/**
 * Versão em Emissão (área) de `applySkillEffects`: aplica a mesma lista de `effects` em cada
 * Ator encontrado na área, numa única mensagem de chat consolidada.
 * @param {Actor} sourceActor
 * @param {Item} skill
 * @param {object} mech
 * @param {string} label
 * @param {Actor[]} targetActors
 */
async function applySkillEffectsArea(sourceActor, skill, mech, label, targetActors, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }
  if (!targetActors.length) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  const rows = [];
  for (const targetActor of targetActors) {
    const summary = await applyEffectsToActor(mech, label, skill, targetActor, subSkillIndex);
    rows.push(`<li><strong>${targetActor.name}</strong>: ${summary.join(", ")}</li>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> (Emissão) em ${targetActors.length} alvo(s):</p><ul>${rows.join("")}</ul>`
  });

  return true;
}
