/**
 * Zonas (Emissão que fica no mapa): contagem de rodadas e efeito em quem começa o turno dentro.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID } from "../core/config.js";
import { zonesOnScene, zoneContainsToken } from "../combat/area-effects.js";
import { rollSkillDamage } from "../combat/damage-roll.js";
import { applySkillEffects } from "./skill-effects.js";

/* -------------------------------------------- */
/*  Zonas (área persistente na cena)             */
/* -------------------------------------------- */

/**
 * Nova rodada de combate: cada Zona da cena perde 1 rodada e some quando zera. GM-only.
 * Roda ANTES de aplicar os efeitos do primeiro turno da rodada, então uma Zona de N rodadas
 * atinge exatamente N rodadas de turnos, contando a do lançamento.
 */
export async function advanceZones(scene) {
  for (const template of zonesOnScene(scene)) {
    const zone = foundry.utils.deepClone(template.getFlag(SYSTEM_ID, "zone"));
    if (zone.untilDeactivated) continue; // vive até a Skill Ativa ser desligada
    zone.roundsRemaining -= 1;
    if (zone.roundsRemaining <= 0) await template.delete();
    else await template.setFlag(SYSTEM_ID, "zone", zone);
  }
}

/**
 * Início do turno de `combatant`: se o Token dele está dentro de alguma Zona da cena, a Skill que
 * criou a Zona é resolvida nele — dano (rolado de novo a cada turno) ou os Efeitos. Sair da Zona
 * antes do próprio turno escapa; ficar nela sofre. Buff/debuff de duração cai pra 1 rodada por
 * aplicação, senão reaplicar todo turno empilharia cópias do mesmo efeito. GM-only.
 */
export async function tickZonesForCombatant(combatant) {
  const scene = combatant.scene;
  const tokenDoc = combatant.token;
  const targetActor = combatant.actor;
  if (!scene || !tokenDoc || !targetActor || scene.id !== canvas?.scene?.id) return;

  for (const template of zonesOnScene(scene)) {
    if (!zoneContainsToken(template, tokenDoc)) continue;
    const zone = template.getFlag(SYSTEM_ID, "zone");
    const sourceActor = await fromUuid(zone.sourceUuid);
    const skill = sourceActor?.items.get(zone.skillId);
    const sub = skill && zone.subSkillIndex != null ? skill.system.subSkills?.[zone.subSkillIndex] : null;
    const mech = sub ?? skill?.system;
    // Zona de Skill Ativa cujo dono desligou (ou apagou) a Skill por outro caminho: limpa aqui.
    if (!mech || (zone.untilDeactivated && !mech.active)) {
      if (zone.untilDeactivated) await template.delete();
      continue;
    }
    const label = zone.label;

    if (mech.effectType === "damage") {
      await rollSkillDamage(sourceActor, mech, label, targetActor);
    } else if (mech.effectType === "temporary") {
      const zoned = {
        ...mech,
        level: mech.level,
        effects: (mech.effects ?? []).map(e => (e.periodic ? e : { ...e, durationRounds: 1 }))
      };
      await applySkillEffects(sourceActor, skill, zoned, label, targetActor, zone.subSkillIndex ?? null);
    }
  }
}
