/**
 * O duelo (8c.2): o que acontece DEPOIS que uma Skill Ativa Combinada ligou a bolha.
 *  - `endsWhenTargetFalls`: quando o alvo escolhido ao ligar cai (Caído, Inconsciente, morto), a Skill desliga.
 *  - `intruderRule`: quando alguém além de quem usa e do alvo termina um movimento dentro da Estrutura do duelo,
 *    "break" desliga a Skill e "include" aplica a ele as partes que miram o alvo (presas à Skill).
 *  - Estrutura destruída com `endsSkillOnDestroy` desliga a Skill que a sustentava (`switchOffSkillOfStructure`,
 *    chamada por `removeStructureInstance`).
 * Tudo executado só pelo Mestre designado. As regras puras estão em combined-rules.js.
 */
import { SYSTEM_ID, isMagicUse, isTechUse } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { worldActors } from "../helpers/world-actors.js";
import { escapeHtml } from "../helpers/html.js";
import { isIncapacitated, isDead } from "../combat/incapacitation.js";
import { skillStateUpdate } from "./skill-state.js";
import { removeUpkeepLinkedEffects } from "./upkeep.js";
import { applyEffectsToActor } from "./effects-apply.js";
import { structuresOnScene, instanceInfo, structureSegmentsOf } from "../structures/structures.js";
import { pointInSegments } from "../structures/structure-geometry.js";
import { targetHasFallen, intruderOutcome, isCombinedSkill, combinedPartMech } from "./combined-rules.js";

/** A Skill (ou Sub-Skill) está ligada? */
function isSkillOn(skill, subSkillIndex) {
  const mech = subSkillIndex != null ? skill?.system?.subSkills?.[subSkillIndex] : skill?.system;
  return Boolean(mech?.hasUpkeep && mech?.active);
}

/** Desliga a Skill Ativa, solta o que ela segurava e avisa no chat. Devolve true se estava ligada. */
export async function switchOffSkill(skill, subSkillIndex, reason) {
  if (!isSkillOn(skill, subSkillIndex)) return false;
  await skill.update(skillStateUpdate(skill, subSkillIndex, { active: false, markFactor: 1, activeTargetUuid: "" }));
  await removeUpkeepLinkedEffects(skill, subSkillIndex ?? null);
  const holder = skill.parent;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: holder }),
    content: `<p><strong>${escapeHtml(holder?.name ?? "")}</strong>: <strong>${escapeHtml(skill.name)}</strong> desligou${reason ? ` — ${escapeHtml(reason)}` : ""}.</p>`
  });
  return true;
}

/** A Estrutura sustentava uma Skill Ativa: desliga essa Skill (a bolha destruída desfaz o duelo). */
export async function switchOffSkillOfStructure(instance, reason) {
  const holder = instance?.sourceActorUuid ? await fromUuid(instance.sourceActorUuid) : null;
  const skill = holder?.items?.get(instance.skillId);
  if (!skill) return false;
  return switchOffSkill(skill, instance.subSkillIndex ?? null, reason);
}

/** As Skills ligadas, em todo o mundo, que pedem "desliga se o alvo cair" e escolheram este Ator. */
function skillsWatching(actor) {
  const found = [];
  for (const holder of worldActors()) {
    if (holder.type !== "character") continue;
    for (const skill of holder.items) {
      if (skill.type !== "skill") continue;
      const sys = skill.system;
      if (sys.hasUpkeep && sys.active && sys.endsWhenTargetFalls && sys.activeTargetUuid && sys.activeTargetUuid === actor.uuid) found.push(skill);
    }
  }
  return found;
}

async function checkTargetFell(actor) {
  if (!isDesignatedGm() || actor?.documentName !== "Actor") return;
  const fallen = targetHasFallen({ incapacitated: isIncapacitated(actor), dead: isDead(actor), hp: actor.system?.attributes?.hp?.value ?? null });
  if (!fallen) return;
  for (const skill of skillsWatching(actor)) await switchOffSkill(skill, null, `${actor.name} caiu`);
}

/** Quem entrou na bolha recebe as partes que miram o alvo (a regra "include"), presas à Skill. */
async function includeIntruder(skill, intruder) {
  // Uma vez só: quem já recebeu algo desta Skill não recebe de novo a cada passo dentro da bolha.
  if (intruder.effects.some(e => e.origin === skill.uuid && e.flags?.[SYSTEM_ID]?.skillEffect)) return false;
  const system = skill.system;
  if (!isCombinedSkill(system)) return false;
  const holder = skill.parent;
  const nature = { magic: isMagicUse(system, holder), tech: isTechUse(system, holder) };
  const lines = [];
  for (const part of system.subSkills) {
    if (part.effectType !== "temporary" || part.targetType === "self" || part.targetType === "emission" || part.targetType === "zone") continue;
    const mech = { ...combinedPartMech(system, part, nature), investPower: 1 };
    const summary = await applyEffectsToActor(mech, `${skill.name} — ${part.name}`, skill, intruder, null);
    lines.push(...summary.map(String));
  }
  if (!lines.length) return false;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: holder }),
    content: `<p><strong>${escapeHtml(intruder.name)}</strong> entrou no duelo de <strong>${escapeHtml(holder?.name ?? "")}</strong>: ${lines.map(escapeHtml).join(", ")}.</p>`
  });
  return true;
}

/** O Token terminou o movimento dentro da bolha de um duelo ligado? Aplica a regra de intruso. */
async function onTokenMoved(document, movement) {
  if (!isDesignatedGm()) return;
  const scene = document.parent;
  const actor = document.actor;
  if (!scene || !actor || actor.type !== "character") return;
  const duels = structuresOnScene(scene).filter(i => i.skillId && (i.subSkillIndex ?? null) === null && instanceInfo(i).closed);
  if (!duels.length) return;
  // No gancho `moveToken` o documento ainda está na posição antiga: o destino vem do movimento.
  const dest = movement?.destination ?? { x: document.x, y: document.y };
  const size = scene.grid?.size ?? 100;
  const center = [Number(dest.x) + ((Number(dest.width ?? document.width) || 1) * size) / 2, Number(dest.y) + ((Number(dest.height ?? document.height) || 1) * size) / 2];
  for (const instance of duels) {
    const holder = await fromUuid(instance.sourceActorUuid);
    const skill = holder?.items?.get(instance.skillId);
    const system = skill?.system;
    if (!system?.hasUpkeep || !system.active || !system.intruderRule) continue;
    const outcome = intruderOutcome({
      rule: system.intruderRule,
      isCaster: actor.uuid === holder.uuid,
      isTarget: Boolean(system.activeTargetUuid) && actor.uuid === system.activeTargetUuid,
      inside: pointInSegments(center, structureSegmentsOf(scene, instance))
    });
    if (outcome === "break") await switchOffSkill(skill, null, `${actor.name} entrou na ${instance.label}`);
    else if (outcome === "include") await includeIntruder(skill, actor);
  }
}

/** Liga os ganchos do duelo (Mestre designado). Chamada uma vez no `init`. */
export function registerDuelRules() {
  Hooks.on("moveToken", (document, movement) => {
    onTokenMoved(document, movement).catch(err => console.error(`${SYSTEM_ID} | regra de intruso do duelo`, err));
  });
  Hooks.on("createActiveEffect", effect => {
    const actor = effect.parent;
    if (actor?.documentName !== "Actor") return;
    // O Foundry atualiza `actor.statuses` logo depois do gancho: espera um instante antes de olhar.
    setTimeout(() => checkTargetFell(actor).catch(err => console.error(`${SYSTEM_ID} | alvo do duelo caiu`, err)), 150);
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.attributes.hp.value")) return;
    setTimeout(() => checkTargetFell(actor).catch(err => console.error(`${SYSTEM_ID} | alvo do duelo caiu`, err)), 150);
  });
}

