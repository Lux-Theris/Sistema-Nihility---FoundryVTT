import { isAreaEffectsEnabled } from "../core/config.js";
import { useSkillEffect } from "./skill-effects.js";
import { skillUseMode } from "./skill-use-mode.js";
import { getStructure, pickStructurePlacement } from "../structures/structures.js";
import { areaEffectsSupported, pickAreaTargets, pickZonePlacement } from "../combat/area-effects.js";
import { rollOptionsFromEvent } from "../apps/roll-options-dialog.js";
import { blockIfIncapacitated } from "../combat/incapacitation.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";

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
  if (actor.type === "character") {
    const usingMech = skill.system.subSkills?.length ? null : skill.system;
    if (!(usingMech?.hasUpkeep && usingMech.active) && blockIfIncapacitated(actor, "usar Habilidades")) return;
  }

  const subSkills = skill.system.subSkills ?? [];
  let subSkillIndex = null;
  let mech = skill.system;
  if (subSkills.length) {
    subSkillIndex = await promptSubSkillChoice(skill, subSkills);
    if (subSkillIndex === null) return; // cancelou
    mech = subSkills[subSkillIndex];
  }

  const mode = skillUseMode(mech, { areaEnabled: isAreaEffectsEnabled(), areaSupported: areaEffectsSupported() });

  // Estrutura: posiciona (ou desenha) no mapa e o Mestre ergue — ver structures.js. Sem mapa, a
  // Skill só posta o cartão.
  if (mode === "structure") {
    try {
      let structurePlacement = null;
      if (canvas?.ready && canvas.scene) {
        const structure = getStructure(mech.structureId);
        if (!structure) {
          ui.notifications.warn(`${skill.name} não tem uma Estrutura escolhida.`);
          return;
        }
        structurePlacement = await pickStructurePlacement(structure);
        if (!structurePlacement) return;
      }
      await useSkillEffect(actor, itemId, { structurePlacement, subSkillIndex });
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

  // Shift+clique: modificadores de rolagem — só quando há dano a rolar.
  let rollOptions = null;
  if (mech.effectType === "damage") {
    const asked = await rollOptionsFromEvent(event, `Dano — ${skill.name}`);
    if (asked.cancelled) return;
    rollOptions = asked.options;
  }

  try {
    if (mode === "zone") {
      // Zona: posiciona a área (fica na cena) — quem estiver dentro sofre no início do turno.
      const zonePlacement = await pickZonePlacement({ system: mech });
      if (!zonePlacement) return;
      await useSkillEffect(actor, itemId, { zonePlacement, subSkillIndex, rollOptions });
    } else if (mode === "emission") {
      // Sem alvo manual: a forma posicionada no mapa decide quem é afetado (aplica direto).
      const targetActors = await pickAreaTargets({ system: mech });
      await useSkillEffect(actor, itemId, { targetActors, subSkillIndex, rollOptions });
    } else if (mode === "self") {
      await useSkillEffect(actor, itemId, { targetActor: actor, subSkillIndex, rollOptions });
    } else {
      // Alvo único. Todo dano pode ser reduzido pelo alvo, então dano e efeito temporário pedem
      // alvo — o seletor já vem com quem usa marcado (inclusive a própria nave).
      const targetActor = await pickTarget?.();
      if (!targetActor) return;
      await useSkillEffect(actor, itemId, { targetActor, subSkillIndex, rollOptions });
    }
  } catch (err) {
    reportError("Falha ao usar a Habilidade.", err);
  }
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
