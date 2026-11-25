/**
 * Zonas (Emissão que fica no mapa): contagem de rodadas e efeito em quem começa o turno dentro.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID } from "../core/config.js";
import { combatantScene } from "../helpers/foundry-compat.js";
import { zonesOnScene, zoneContainsToken } from "../combat/area-effects.js";
import { areaAffectsTarget } from "../combat/area-geometry.js";
import { rollSkillDamage } from "../combat/damage-roll.js";
import { applySkillEffects, damageXpMeasures } from "./skill-effects.js";
import { grantSkillUseXp } from "./skill-xp.js";

/* -------------------------------------------- */
/*  Zonas (área persistente na cena)             */
/* -------------------------------------------- */

/**
 * Início de um turno: as Zonas de quem está começando o turno perdem 1 rodada e somem quando
 * zeram. GM-only. Roda ANTES dos efeitos do turno.
 *
 * A contagem é pelo turno de QUEM LANÇOU, não pela virada da rodada: a rodada vira no topo da
 * iniciativa, que raramente é o conjurador, e aí uma Zona de 2 rodadas sumia antes de o
 * conjurador ter o segundo turno (achado no primeiro teste na V14). Assim, lançada no turno do
 * conjurador, dura até o começo do turno dele N rodadas depois, e cada outro combatente começa
 * exatamente N turnos dentro dela. Quem lançou e não está no combate (o Mestre pondo uma Zona de
 * um NPC de fora) cai na regra antiga: perde 1 a cada virada de rodada.
 * @param {Scene} scene
 * @param {{combat: Combat, combatant: Combatant, roundChanged: boolean}} turn
 */
export async function advanceZones(scene, { combat, combatant, roundChanged }) {
  for (const zoneDoc of zonesOnScene(scene)) {
    const zone = foundry.utils.deepClone(zoneDoc.getFlag(SYSTEM_ID, "zone"));
    if (zone.untilDeactivated) continue; // vive até a Skill Ativa ser desligada
    const casterFighting = combat?.combatants.some(c => c.actor?.uuid === zone.sourceUuid);
    const casterTurn = combatant?.actor?.uuid === zone.sourceUuid;
    if (casterFighting ? !casterTurn : !roundChanged) continue;
    zone.roundsRemaining -= 1;
    if (zone.roundsRemaining <= 0) await zoneDoc.delete();
    else await zoneDoc.setFlag(SYSTEM_ID, "zone", zone);
  }
}

/**
 * Início do turno de `combatant`: se o Token dele está dentro de alguma Zona da cena, a Skill que
 * criou a Zona é resolvida nele — dano (rolado de novo a cada turno) ou os Efeitos. Sair da Zona
 * antes do próprio turno escapa; ficar nela sofre. Buff/debuff de duração cai pra 1 rodada por
 * aplicação, senão reaplicar todo turno empilharia cópias do mesmo efeito. GM-only.
 */
export async function tickZonesForCombatant(combatant) {
  if (!combatant) return;
  const scene = combatantScene(combatant);
  const tokenDoc = combatant.token;
  const targetActor = combatant.actor;
  // A área é geometria pura sobre documentos: não precisa que o Mestre esteja olhando a cena.
  if (!scene || !tokenDoc || !targetActor) return;

  for (const zoneDoc of zonesOnScene(scene)) {
    if (!zoneContainsToken(zoneDoc, tokenDoc)) continue;
    const zone = zoneDoc.getFlag(SYSTEM_ID, "zone");
    // Zona mantida por quem está Parado no tempo (8e.4): suspensa, não age até ele voltar.
    if (zone.suspended) continue;
    const sourceActor = await fromUuid(zone.sourceUuid);
    const skill = sourceActor?.items.get(zone.skillId);
    const sub = skill && zone.subSkillIndex != null ? skill.system.subSkills?.[zone.subSkillIndex] : null;
    const mech = sub ?? skill?.system;
    // Zona de Skill Ativa cujo dono desligou (ou apagou) a Skill por outro caminho: limpa aqui.
    if (!mech || (zone.untilDeactivated && !mech.active)) {
      if (zone.untilDeactivated) await zoneDoc.delete();
      continue;
    }
    // Quem a Zona atinge: o lado de quem lançou é o do Token dele agora (ou o de quando lançou).
    const casterDoc = scene.tokens.find(t => t.actor?.uuid === sourceActor.uuid);
    const casterDisposition = casterDoc?.disposition ?? zone.casterDisposition ?? null;
    if (!areaAffectsTarget({
      affects: mech.areaAffects,
      isCaster: sourceActor.uuid === targetActor.uuid,
      casterDisposition,
      disposition: tokenDoc.disposition ?? null
    })) continue;
    const label = zone.label;
    // Concentração (1.119.0): a Zona nasceu com um tamanho que trocou potência por área; o nível efetivo dele vale a cada
    // turno (o Mestre o refez na ficha ao criar). Zona de antes não tem o campo e usa o nível da Skill.
    const effectiveLevel = Number(zone.effectiveLevel) || 0;
    const tickMech = effectiveLevel > 0 && effectiveLevel !== mech.level ? { ...(typeof mech.toObject === "function" ? mech.toObject() : mech), level: effectiveLevel } : mech;

    if (mech.effectType === "damage") {
      // XP por uso: o que a Zona fez neste turno vai pra Skill que a criou (efeitos já creditam
      // dentro de applySkillEffects).
      const result = await rollSkillDamage(sourceActor, tickMech, label, targetActor);
      await grantSkillUseXp(skill, damageXpMeasures(result, targetActor));
    } else if (mech.effectType === "temporary") {
      const zoned = {
        ...tickMech,
        effects: (mech.effects ?? []).map(e => (e.periodic ? e : { ...e, durationRounds: 1 }))
      };
      await applySkillEffects(sourceActor, skill, zoned, label, targetActor, zone.subSkillIndex ?? null);
    }
  }
}
