import { isAreaEffectsEnabled, isEnergyPoolEnabled, effectiveSkillCost, getEnergyLabelForActor, actorToken } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";
import { currentEnergyValue, warnInsufficientEnergy } from "./skill-state.js";
import { useBlockReason } from "./preparation.js";
import { strikeBlockReason } from "../combat/weapon-mastery.js";
import { useSkillEffect } from "./skill-effects.js";
import { skillUseMode } from "./skill-use-mode.js";
import { getStructure, pickStructurePlacement, structurePlacementAround } from "../structures/structures.js";
import { areaEffectsSupported, pickAreaTargets, pickZonePlacement, pickAreaPlacement, reshapeAreaPlacement, casterAreaPlacement, resolveAreaTargets, zonePlacementFrom } from "../combat/area-effects.js";
import { isCombinedSkill, combinedPlan, combinedPartMech, isCasterBoundCircle } from "./combined-rules.js";
import { rollOptionsFromEvent } from "../apps/roll-options-dialog.js";
import { blockIfIncapacitated } from "../combat/incapacitation.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { reachContext, resolveTargetReach, confirmMarkCost, casterTokenOf } from "../combat/range.js";
import { shapeIsFree } from "../combat/range-rules.js";
import { isWeaponMasteryEnabled } from "../combat/weapon-mastery.js";
import { formUseBlock, formUseCheck } from "./forms.js";
import { analysisBlockReason } from "./analysis.js";
import { predationBlockReason } from "./predation.js";
import { skillOnlyIfBlock } from "./skill-only-if.js";

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
export async function useSkillFlow(actor, itemId, { event = null, pickTarget, borrowedSkill = null, borrowedVia = null } = {}) {
  // Skill emprestada (7a): a Skill é a do DONO (o Item vem de `borrowedSkill`), e quem lança é `actor`.
  const skill = borrowedSkill ?? actor?.items.get(itemId);
  if (!skill) return;
  const useSkill = (opts = {}) => useSkillEffect(actor, skill.id, borrowedSkill ? { ...opts, borrowedSkill, borrowedVia } : opts);

  // Maestria de arma (H6): passiva, só dá o bônus nos ataques com armas do tipo (e vale pela hotbar também).
  if (skill.system.weaponMastery && isWeaponMasteryEnabled()) {
    ui.notifications.info(`${skill.name} é passiva: o bônus vale sozinho nos ataques com armas do tipo.`);
    return;
  }

  // Ocultação (7b): Skill de base passiva, vale sozinha contra a Análise.
  if (skill.system.coreSkill === "concealment") {
    ui.notifications.info(`${skill.name} é passiva: dificulta a Análise sozinha.`);
    return;
  }

  // Caído/Inconsciente (só Personagem): avisa antes de pedir Sub-Skill ou alvo. Desligar uma Ativa
  // continua possível (ela já foi desligada ao cair, mas uma ligada à mão depois pode ser desligada).
  // Com Sub-Skills, a escolha abre se alguma estiver ligada; a escolhida é conferida depois.
  // Combinada (8c.2): um uso dispara todas as Sub-Skills; as escolhas saem uma vez só.
  if (isCombinedSkill(skill.system)) return useCombinedFlow(actor, skill, { event, pickTarget, useSkill });

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
  const blocked = formUseBlock(actor, skill, subSkillIndex) ?? useBlockReason(actor, skill, subSkillIndex) ?? strikeBlockReason(actor, skill, subSkillIndex);
  if (blocked) {
    ui.notifications.warn(blocked);
    return;
  }

  const mode = skillUseMode(mech, { areaEnabled: isAreaEffectsEnabled(), areaSupported: areaEffectsSupported() });

  // "Só se…" da Skill (8c.1): antes de pagar. Sem alvo único (área, Estrutura, Zona, Forma) só vale o que é sobre
  // quem usa; com alvo (único ou "Si mesmo") é conferido logo depois de escolhê-lo. Desligar nunca é barrado.
  const refuseOnlyIf = target => {
    const message = skillOnlyIfBlock(actor, mech, target);
    if (message) ui.notifications.warn(`${skill.name}: ${message}.`);
    return Boolean(message);
  };
  if (!["deactivate", "plain", "self", "targeted"].includes(mode) && refuseOnlyIf(null)) return;

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

  // Daqui em diante cada modo tem o seu tratador (tabela `USE_HANDLERS`, abaixo). Tudo o que vale para vários
  // modos (confere de bloqueio, "Só se…", Shift+clique, energia) já ficou acima, na mesma ordem de sempre.
  const ctx = { actor, skill, mech, subSkillIndex, rollOptions, manaInvested, useSkill, pickTarget, refuseOnlyIf };
  await USE_HANDLERS[mode]?.(ctx);
}

/** Erro de um uso que não é Forma nem Estrutura (essas duas têm a própria mensagem). */
async function guardedUse(fn) {
  try {
    await fn();
  } catch (err) {
    reportError("Falha ao usar a Habilidade.", err);
  }
}

/** Forma (H5): liga a Skill e o Mestre troca a ficha. Confere o molde antes de pagar o Custo. */
async function useForm({ actor, mech, subSkillIndex, manaInvested, useSkill }) {
  const reason = formUseCheck(actor, mech);
  if (reason) {
    ui.notifications.warn(reason);
    return;
  }
  try {
    await useSkill({ subSkillIndex, manaInvested });
  } catch (err) {
    reportError("Falha ao assumir a forma.", err);
  }
}

/** Estrutura: posiciona (ou desenha) no mapa e o Mestre ergue — ver structures.js. Sem mapa, a Skill só posta o cartão. */
async function useStructure({ actor, skill, mech, subSkillIndex, manaInvested, useSkill, pickTarget }) {
  try {
    let structurePlacement = null;
    let viaMark = null;
    let pickedTarget = null;
    if (canvas?.ready && canvas.scene) {
      const structure = getStructure(mech.structureId);
      if (!structure) {
        ui.notifications.warn(`${skill.name} não tem uma Estrutura escolhida.`);
        return;
      }
      const place = mech.structurePlace ?? "click";
      if (place === "click") {
        // Alcance (H4): os pontos têm de estar ao alcance de quem lança ou de uma Marca.
        structurePlacement = await pickStructurePlacement(structure, reachContext(actor, { range: mech.range, free: true }));
        if (!structurePlacement) return;
        viaMark = structurePlacement.viaMark ?? null;
        if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
      } else {
        // Sem clique (8c.2): centrada em quem usa, ou no alvo escolhido.
        let center = null;
        if (place === "target") {
          pickedTarget = await pickTarget?.();
          if (!pickedTarget) return;
          const reach = await resolveTargetReach(actor, pickedTarget, mech, { label: skill.name, baseCost: baseCostOf(actor, mech) });
          if (!reach.ok) return;
          viaMark = reach.viaMark;
          center = actorToken(pickedTarget, [...(game.user?.targets ?? [])])?.center ?? null;
        } else {
          center = casterTokenOf(actor)?.center ?? null;
        }
        structurePlacement = structurePlacementAround(structure, center);
        if (!structurePlacement) {
          ui.notifications.warn(`${skill.name}: não achei o Token ${place === "target" ? "do alvo" : "de quem usa"} nesta cena para centrar a Estrutura.`);
          return;
        }
      }
    }
    await useSkill({ structurePlacement, targetActor: pickedTarget ?? undefined, subSkillIndex, manaInvested, viaMark });
  } catch (err) {
    reportError("Falha ao erguer a Estrutura.", err);
  }
}

/** Ativa já ligada (só desliga) ou Descritiva: sem alvo nem rolagem. */
async function usePlain({ subSkillIndex, useSkill }) {
  await guardedUse(() => useSkill({ subSkillIndex }));
}

async function useEmissionNoCanvas() {
  ui.notifications.warn("Skills de Emissão precisam de acesso ao canvas da cena ativa.");
}

/** Zona: posiciona a área (fica na cena) — quem estiver dentro sofre no início do turno. */
async function useZone({ actor, skill, mech, subSkillIndex, rollOptions, manaInvested, useSkill }) {
  await guardedUse(async () => {
    const zonePlacement = await pickZonePlacement({ system: mech }, areaReach(actor, mech), { caster: actor });
    if (!zonePlacement) return;
    const viaMark = zonePlacement.viaMark ?? null;
    if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
    await useSkill({ zonePlacement, subSkillIndex, rollOptions, manaInvested, viaMark });
  });
}

/** Emissão: sem alvo manual, a forma posicionada no mapa decide quem é afetado (aplica direto). */
async function useEmission({ actor, skill, mech, subSkillIndex, rollOptions, manaInvested, useSkill }) {
  await guardedUse(async () => {
    const targetActors = await pickAreaTargets({ system: mech }, areaReach(actor, mech), { caster: actor });
    // Sem `origin` = cancelou a colocação (pickAreaTargets devolve [] nos dois casos).
    if (!targetActors.origin) return;
    const viaMark = targetActors.viaMark ?? null;
    if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, mech), actor }))) return;
    await useSkill({ targetActors, subSkillIndex, rollOptions, manaInvested, viaMark });
  });
}

async function useSelf({ actor, subSkillIndex, rollOptions, manaInvested, useSkill, refuseOnlyIf }) {
  await guardedUse(async () => {
    if (refuseOnlyIf(actor)) return;
    await useSkill({ targetActor: actor, subSkillIndex, rollOptions, manaInvested });
  });
}

async function useTargeted({ actor, skill, mech, subSkillIndex, rollOptions, manaInvested, useSkill, pickTarget, refuseOnlyIf }) {
  await guardedUse(async () => {
    // Alvo único. Todo dano pode ser reduzido pelo alvo, então dano e efeito temporário pedem
    // alvo — o seletor já vem com quem usa marcado (inclusive a própria nave).
    const targetActor = await pickTarget?.();
    if (!targetActor) return;
    // Alcance (H4): fora dele, só pela Marca (ou o Mestre ignora).
    const reach = await resolveTargetReach(actor, targetActor, mech, { label: skill.name, baseCost: baseCostOf(actor, mech) });
    if (!reach.ok) return;
    if (refuseOnlyIf(targetActor)) return;
    // Análise e Predação (7b): confere o alvo ANTES de pagar o Custo.
    const gate = await targetedMechanicGate(actor, mech, targetActor);
    if (!gate) return;
    await useSkill({ targetActor, subSkillIndex, rollOptions, manaInvested, viaMark: reach.viaMark, ...gate });
  });
}

/**
 * Um tratador por modo de `skillUseMode`. Só são chamados dentro de `useSkillFlow`, nunca na avaliação do
 * módulo (os tratadores são funções declaradas acima; nada aqui chama um import de um irmão).
 */
const USE_HANDLERS = {
  form: useForm,
  structure: useStructure,
  deactivate: usePlain,
  plain: usePlain,
  emissionNoCanvas: useEmissionNoCanvas,
  zone: useZone,
  emission: useEmission,
  self: useSelf,
  targeted: useTargeted,
};

/**
 * Skill Combinada (8c.2): o mesmo fluxo para a Skill-mãe inteira. As escolhas saem UMA vez e antes de pagar: o
 * alvo único (se alguma parte mira alguém, ou a Skill desliga se ele cai), a posição da área (uma colocação
 * serve a todas as partes de área que pedem clique; círculo preso em quem usa não pede nada) e a colocação de
 * cada Estrutura que pede clique. Devolve sem fazer nada se qualquer escolha for cancelada.
 */
async function useCombinedFlow(actor, skill, { event, pickTarget, useSkill }) {
  const system = skill.system;
  const subs = system.subSkills ?? [];
  const isOn = Boolean(system.hasUpkeep && system.active);
  if (actor.type === "character" && !isOn && blockIfIncapacitated(actor, "usar Habilidades")) return;
  const blocked = formUseBlock(actor, skill, null) ?? useBlockReason(actor, skill, null) ?? strikeBlockReason(actor, skill, null);
  if (blocked) {
    ui.notifications.warn(blocked);
    return;
  }
  // Ativa já ligada: o clique só desliga (a Skill-mãe solta tudo o que as partes seguravam).
  if (isOn) {
    try {
      await useSkill({ combined: true });
    } catch (err) {
      reportError("Falha ao desligar a Habilidade.", err);
    }
    return;
  }

  const env = { areaEnabled: isAreaEffectsEnabled(), areaSupported: areaEffectsSupported() };
  const plan = combinedPlan(system, subs, env);
  if (plan.modes.includes("emissionNoCanvas")) {
    ui.notifications.warn("Skills de Emissão precisam de acesso ao canvas da cena ativa.");
    return;
  }

  const refuseOnlyIf = target => {
    const message = skillOnlyIfBlock(actor, system, target);
    if (message) ui.notifications.warn(`${skill.name}: ${message}.`);
    return Boolean(message);
  };

  // Shift+clique: modificadores de rolagem (se alguma parte rola dano) e "Investir Mana".
  let rollOptions = null;
  let manaInvested = null;
  const anyDamage = subs.some(s => s.effectType === "damage");
  const invest = investFor(actor, system);
  if (event?.shiftKey && (anyDamage || invest)) {
    const asked = await rollOptionsFromEvent(event, anyDamage ? `Dano — ${skill.name}` : `Usar — ${skill.name}`, { invest, modifiers: anyDamage });
    if (asked.cancelled) return;
    rollOptions = asked.options;
    manaInvested = asked.invested;
  }

  // Sem energia para o Custo: avisa antes de pedir qualquer escolha.
  if (!isShipLike(actor) && isEnergyPoolEnabled() && !system.variableMana && manaInvested == null) {
    const needed = effectiveSkillCost(system.cost, system.level);
    if (needed > 0 && currentEnergyValue(actor) < needed) {
      await warnInsufficientEnergy(actor, skill.name, needed);
      return;
    }
  }

  try {
    // O alvo único, escolhido uma vez para todas as partes.
    let targetActor = null;
    let viaMark = null;
    if (plan.needsTarget) {
      targetActor = await pickTarget?.();
      if (!targetActor) return;
      const reach = await resolveTargetReach(actor, targetActor, system, { label: skill.name, baseCost: baseCostOf(actor, system) });
      if (!reach.ok) return;
      viaMark = reach.viaMark ?? null;
      if (refuseOnlyIf(targetActor)) return;
    } else if (refuseOnlyIf(null)) {
      return;
    }

    // Área, Zona e Estrutura de cada parte.
    const parts = {};
    let placed = null;
    for (const [index, part] of subs.entries()) {
      const mode = plan.modes[index];
      const partMech = combinedPartMech(system, part, {});
      if (mode === "emission" || mode === "zone") {
        let placement;
        let reach = null;
        if (isCasterBoundCircle(part, system.level)) {
          placement = casterAreaPlacement(partMech, actor);
        } else {
          reach = areaReach(actor, { ...partMech, range: partMech.range || system.range });
          if (!placed) {
            placed = await pickAreaPlacement(partMech, reach, { caster: actor });
            if (!placed) return;
          }
          placement = reshapeAreaPlacement(partMech, placed, { caster: actor });
        }
        if (!placement) {
          ui.notifications.warn(`${skill.name} — ${part.name}: não achei o Token de quem usa nesta cena para centrar a forma.`);
          return;
        }
        if (mode === "emission") {
          const targetActors = resolveAreaTargets(partMech, placement, reach, { caster: actor, target: targetActor });
          parts[index] = { targetActors };
          viaMark ??= targetActors.viaMark ?? null;
        } else {
          parts[index] = { zonePlacement: zonePlacementFrom(placement, reach) };
        }
      } else if (mode === "structure") {
        if (!(canvas?.ready && canvas.scene)) {
          parts[index] = { structurePlacement: null };
          continue;
        }
        const structure = getStructure(part.structureId);
        if (!structure) {
          ui.notifications.warn(`${skill.name} — ${part.name} não tem uma Estrutura escolhida.`);
          return;
        }
        let structurePlacement;
        if (part.structurePlace === "caster") structurePlacement = structurePlacementAround(structure, casterTokenOf(actor)?.center ?? null);
        else if (part.structurePlace === "target") structurePlacement = structurePlacementAround(structure, targetActor ? actorToken(targetActor, [...(game.user?.targets ?? [])])?.center ?? null : null);
        else structurePlacement = await pickStructurePlacement(structure, reachContext(actor, { range: part.range || system.range, free: true }));
        if (!structurePlacement) {
          if (part.structurePlace === "click") return;
          ui.notifications.warn(`${skill.name} — ${part.name}: não achei o Token para centrar a Estrutura.`);
          return;
        }
        viaMark ??= structurePlacement.viaMark ?? null;
        parts[index] = { structurePlacement };
      }
    }
    if (viaMark && !(await confirmMarkCost({ title: `Marca — ${skill.name}`, via: viaMark, baseCost: baseCostOf(actor, system), actor }))) return;

    // Quem foi atingido por alguma área entra na lista de alvos do uso (o Desfazer uso fotografa todos).
    const seen = new Set();
    const targetActors = Object.values(parts).flatMap(p => p.targetActors ?? []).filter(a => (seen.has(a.uuid) ? false : seen.add(a.uuid)));
    await useSkill({ combined: { parts }, targetActor: targetActor ?? undefined, targetActors, rollOptions, manaInvested, viaMark });
  } catch (err) {
    reportError("Falha ao usar a Habilidade.", err);
  }
}

/**
 * Análise e Predação (7b): o alvo serve? Devolve `{}` (segue), `{predationBypass: true}` (o Mestre passou
 * por cima de "ainda de pé") ou null (recusado, com o aviso já dado). Outras mecânicas passam direto.
 */
async function targetedMechanicGate(actor, mech, targetActor) {
  if (mech.effectType === "analysis") {
    const reason = analysisBlockReason(targetActor);
    if (reason) ui.notifications?.warn(reason);
    return reason ? null : {};
  }
  if (mech.effectType !== "predation") return {};
  const block = predationBlockReason(actor, targetActor);
  if (!block) return {};
  if (!(block.soft && game.user.isGM)) {
    ui.notifications?.warn(block.text);
    return null;
  }
  const go = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Predar mesmo assim?" },
    content: `<div class="nihility-predation-confirm"><p>${escapeHtml(block.text)}</p><p>Você é o Mestre: pode predar mesmo assim.</p></div>`,
    rejectClose: false
  });
  return go ? { predationBypass: true } : null;
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
