import { isAreaEffectsEnabled, isEnergyPoolEnabled, effectiveSkillCost, getEnergyLabelForActor } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";
import { currentEnergyValue, warnInsufficientEnergy } from "./skill-state.js";
import { useBlockReason } from "./preparation.js";
import { useSkillEffect } from "./skill-effects.js";
import { skillUseMode } from "./skill-use-mode.js";
import { getStructure, pickStructurePlacement } from "../structures/structures.js";
import { areaEffectsSupported, pickAreaTargets, pickZonePlacement } from "../combat/area-effects.js";
import { rollOptionsFromEvent } from "../apps/roll-options-dialog.js";
import { blockIfIncapacitated } from "../combat/incapacitation.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { reachContext, resolveTargetReach, confirmMarkCost } from "../combat/range.js";
import { shapeIsFree } from "../combat/range-rules.js";

/**
 * "Usar Habilidade" — o MESMO caminho para a ficha de Personagem, a de Nave/Veículo e a hotbar.
 * Até a 1.77 a ficha de Nave tinha uma cópia reduzida: ignorava Sub-Skills, Zona, Emissão e
 * Estrutura, e todo efeito temporário caía na própria nave (não dava para dar buff em outra).
 *
 * @param {Actor} actor
 * @param {string} itemId
 * @param {object} [options]
 * @param {Event|{shiftKey: boolean}|null} [options.event]  Só para o Shift (modificadores de rolagem).
 * @param {() => Promise<Actor|null>} options.pickTarget  O seletor de alvo da ficha (`_promptSkillTarget`).
 */
export async function useSkillFlow(actor, itemId, { event = null, pickTarget } = {}) {
  const skill = actor?.items.get(itemId);
  if (!skill) return;

  // Caído/Inconsciente (só Personagem): avisa antes de pedir Sub-Skill ou alvo. Desligar uma Ativa
  // continua possível (ela já foi desligada ao cair, mas uma ligada à mão depois pode ser desligada).
  // Com Sub-Skills, a escolha abre se alguma estiver ligada; a escolhida é conferida depois.
  const subSkills = skill.system.subSkills ?? [];
  const isOnToggle = m => Boolean(m?.hasUpkeep && m.active);
  const incapacitatedCheck = actor.type === "character";
  if (incapacitatedCheck) {
    const canStillDeactivate = subSkills.length ? subSkills.some(isOnToggle) : isOnToggle(skill.system);
    if (!canStillDeactivate && blockIfIncapacitated(actor, "usar Habilidades")) return;
  }

  let subSkillIndex = null;
  let mech = skill.system;
  if (subSkills.length) {
    subSkillIndex = await promptSubSkillChoice(skill, subSkills);
    if (subSkillIndex === null) return; // cancelou
    mech = subSkills[subSkillIndex];
    if (incapacitatedCheck && !isOnToggle(mech) && blockIfIncapacitated(actor, "usar Habilidades")) return;
  }

  // Recarga ou Preparo em andamento (H3): avisa antes de pedir alvo, área ou rolagem.
  const blocked = useBlockReason(actor, skill, subSkillIndex);
  if (blocked) {
    ui.notifications.warn(blocked);
    return;
  }

  const mode = skillUseMode(mech, { areaEnabled: isAreaEffectsEnabled(), areaSupported: areaEffectsSupported() });

  // Shift+clique: modificadores de rolagem (só quando há dano a rolar) e "Investir Mana" (C2, em toda
  // Skill com Custo que não seja Descritiva). Antes de Estrutura, Zona, área ou alvo.
  let rollOptions = null;
  let manaInvested = null;
  if (mode !== "deactivate" && mode !== "plain" && mode !== "emissionNoCanvas") {
    const isDamage = mech.effectType === "damage";
    const invest = investFor(actor, mech);
    if (event?.shiftKey && (isDamage || invest)) {
      const asked = await rollOptionsFromEvent(event, isDamage ? `Dano — ${skill.name}` : `Usar — ${skill.name}`, { invest, modifiers: isDamage });
      if (asked.cancelled) return;
      rollOptions = asked.options;
      manaInvested = asked.invested;
    }
  }

  // Sem energia para o Custo: avisa ANTES de pedir área, Estrutura ou alvo (o mesmo aviso do uso). Fica de
  // fora quem investe (o diálogo trata), Mana variável, Preparo (paga em partes), Nave e desligar uma Ativa.
  if (mode !== "deactivate" && mode !== "plain" && mode !== "emissionNoCanvas" && !isShipLike(actor) && isEnergyPoolEnabled()
    && !mech.variableMana && manaInvested == null && !(Number(mech.prepTurns) > 0)) {
    const needed = effectiveSkillCost(mech.cost, mech.level);
    if (needed > 0 && currentEnergyValue(actor) < needed) {
      await warnInsufficientEnergy(actor, subSkillIndex != null ? `${skill.name} — ${mech.name}` : skill.name, needed);
      return;
    }
  }

  // Estrutura: posiciona (ou desenha) no mapa e o Mestre ergue — ver structures.js. Sem mapa, a
  // Skill só posta o cartão.
  if (mode === "structure") {
    try {
      let structurePlacement = null;
      let viaMark = null;
      if (canvas?.ready && canvas.scene) {
        const structure = getStructure(mech.structureId);
        if (!structure) {
          ui.notifications.warn(`${skill.name} não tem uma Estrutura escolhida.`);
          return;
        }
        // Alcance (H4): os pontos têm de estar ao alcance de quem lança ou de uma Marca.
        structurePlacement = await pickStructurePlacement(structure, reachContext(actor, { range: mech.range, free: true }));
        if (!structurePlacement) return;
        viaMark = structurePlacement.viaMark ?? null;
        if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
      }
      await useSkillEffect(actor, itemId, { structurePlacement, subSkillIndex, manaInvested, viaMark });
    } catch (err) {
      reportError("Falha ao erguer a Estrutura.", err);
    }
    return;
  }

  // Ativa já ligada (só desliga) ou Descritiva: sem alvo nem rolagem.
  if (mode === "deactivate" || mode === "plain") {
    try {
      await useSkillEffect(actor, itemId, { subSkillIndex });
    } catch (err) {
      reportError("Falha ao usar a Habilidade.", err);
    }
    return;
  }

  if (mode === "emissionNoCanvas") {
    ui.notifications.warn("Skills de Emissão precisam de acesso ao canvas da cena ativa.");
    return;
  }

  try {
    if (mode === "zone") {
      // Zona: posiciona a área (fica na cena) — quem estiver dentro sofre no início do turno.
      const zonePlacement = await pickZonePlacement({ system: mech }, areaReach(actor, mech));
      if (!zonePlacement) return;
      const viaMark = zonePlacement.viaMark ?? null;
      if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
      await useSkillEffect(actor, itemId, { zonePlacement, subSkillIndex, rollOptions, manaInvested, viaMark });
    } else if (mode === "emission") {
      // Sem alvo manual: a forma posicionada no mapa decide quem é afetado (aplica direto).
      const targetActors = await pickAreaTargets({ system: mech }, areaReach(actor, mech), { caster: actor });
      // Sem `origin` = cancelou a colocação (pickAreaTargets devolve [] nos dois casos).
      if (!targetActors.origin) return;
      const viaMark = targetActors.viaMark ?? null;
      if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
      await useSkillEffect(actor, itemId, { targetActors, subSkillIndex, rollOptions, manaInvested, viaMark });
    } else if (mode === "self") {
      await useSkillEffect(actor, itemId, { targetActor: actor, subSkillIndex, rollOptions, manaInvested });
    } else {
      // Alvo único. Todo dano pode ser reduzido pelo alvo, então dano e efeito temporário pedem
      // alvo — o seletor já vem com quem usa marcado (inclusive a própria nave).
      const targetActor = await pickTarget?.();
      if (!targetActor) return;
      // Alcance (H4): fora dele, só pela Marca (ou o Mestre ignora).
      const reach = await resolveTargetReach(actor, targetActor, mech, { label: skill.name, baseCost: baseCostOf(actor, mech) });
      if (!reach.ok) return;
      await useSkillEffect(actor, itemId, { targetActor, subSkillIndex, rollOptions, manaInvested, viaMark: reach.viaMark });
    }
  } catch (err) {
    reportError("Falha ao usar a Habilidade.", err);
  }
}

/** O contexto de alcance de uma forma de área: presa em quem lança, ou livre (a partir do nível). */
function areaReach(actor, mech) {
  const free = shapeIsFree({ areaOrigin: mech.areaOrigin, areaFreeLevel: mech.areaFreeLevel, level: mech.level });
  return reachContext(actor, { range: mech.range, free });
}

/** O Custo normal da Skill (o que a Marca multiplica), para mostrar nos avisos. */
function baseCostOf(actor, mech) {
  if (!isShipLike(actor) && !isEnergyPoolEnabled()) return 0;
  return effectiveSkillCost(mech.cost, mech.level);
}

/**
 * O que o campo "Investir" do Shift+clique precisa saber, ou null quando a Skill não permite (Nave
 * paga da Bateria; sem Custo; Mana variável tem o diálogo dela; campanha sem Mana).
 */
function investFor(actor, mech) {
  if (isShipLike(actor) || !isEnergyPoolEnabled() || mech.variableMana) return null;
  const cost = effectiveSkillCost(mech.cost, mech.level);
  if (!(cost > 0)) return null;
  const energy = actor.system?.attributes?.energy ?? {};
  return { cost, current: Number(energy.value) || 0, max: Number(energy.max) || 0, energyLabel: getEnergyLabelForActor(actor) };
}

/**
 * Skill Fundida: escolhe QUAL componente disparar (cada um com seu próprio efeito) — como as
 * Skills Únicas do Tensura. Devolve o índice em `subSkills`, ou `null` se cancelado.
 */
export async function promptSubSkillChoice(skill, subSkills) {
  const kindLabel = sub => (sub.effectType === "damage" ? "Dano" : sub.effectType === "temporary" ? "Efeito Temporário" : "Descritiva");
  const options = subSkills
    .map((sub, i) => `<option value="${i}">${escapeHtml(sub.name)} — ${kindLabel(sub)}</option>`)
    .join("");

  // Conteúdo num <div>, nunca <form>: o DialogV2 já embrulha num form (ver CLAUDE.md).
  const index = await foundry.applications.api.DialogV2.wait({
    window: { title: `Usar ${skill.name}` },
    content: `<div class="form-group"><label>Qual componente disparar?</label><select name="subSkillIndex">${options}</select></div>`,
    buttons: [
      {
        action: "confirm",
        label: "Usar",
        default: true,
        callback: (event, button, dialog) => Number(dialog.element.querySelector("[name=subSkillIndex]").value)
      },
      // `false` sobrevive ao `result ?? button.action` do DialogV2 (null viraria a string "cancel").
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  // Índice 0 é válido: só null/undefined/false contam como cancelado.
  return index === undefined || index === null || index === false ? null : index;
}
