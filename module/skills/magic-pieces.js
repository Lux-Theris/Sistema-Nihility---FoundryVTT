/**
 * As peças de magia do Lote 1 (1.123.0) que mexem em fichas: Purificar, Reviver e Drenar. As regras puras ficam em
 * `purify-rules.js`, `revive-rules.js` e `drain-rules.js`; aqui só se lê e se grava. Cada função roda no cliente que já
 * tem permissão de escrita no alvo (`applyEffectsToTargets` manda o resto ao Mestre pelo relay `applySkillEffects`), então
 * nenhuma delas abre relay novo.
 */
import { SYSTEM_ID, getActiveStatusConditions, getEffectTargetLabels } from "../core/config.js";
import { createActiveEffects, buildEffectChanges } from "../helpers/foundry-compat.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { makeAnchor } from "../combat/effect-anchors.js";
import { isDead } from "../combat/incapacitation.js";
import { clearConditionExposure } from "../combat/condition-guard.js";
import { resolveEffectChange } from "./effect-targets.js";
import { PURIFY_PROTECTED_FLAGS, pickPurified, exposureToClear, purifyResultText } from "./purify-rules.js";
import { reviveBlockReason, reviveHp, reviveResultText } from "./revive-rules.js";
import { drainGainAmount, drainGainEntry, drainKindOf, drainResultText, linkedDrainEffects } from "./drain-rules.js";
import { restoreVital, rememberAnchoredTarget } from "./effects-apply.js";

const defeatedId = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/* ------------------------------------------------------------------ Purificar */

/** O id de Condição de um efeito: o do flag, ou o primeiro `status` que o catálogo conhece (marcada à mão no HUD). */
function conditionIdOf(effect, catalog) {
  const flags = effect.flags?.[SYSTEM_ID] ?? {};
  return flags.conditionId || [...(effect.statuses ?? [])].find(s => catalog.some(c => c.id === s)) || "";
}

/**
 * Purificar: tira do alvo as Condições de nível até o da Skill, mágicas ou não, e zera o contador de exposição da
 * Resistência a Condição das que saíram. Devolve a linha do resumo.
 * @param {object} entry - a entrada do efeito (`amount` = máximo a tirar, 0 = todas; `conditionId` = só ela)
 */
export async function applyPurifyEntry(entry, { targetActor, sourceLevel, xp }) {
  if (targetActor.type !== "character") return `Purificar: não se aplica a ${targetActor.name}`;
  const catalog = getActiveStatusConditions();
  const rows = targetActor.effects
    .filter(e => !e.disabled)
    .map(e => {
      const flags = e.flags?.[SYSTEM_ID] ?? {};
      return { id: e.id, name: e.name, conditionId: conditionIdOf(e, catalog), sourceLevel: Number(flags.sourceLevel) || 0, protectedFlag: PURIFY_PROTECTED_FLAGS.some(k => flags[k]) };
    })
    .filter(r => r.conditionId);
  const wanted = String(entry.conditionId || "");
  const ids = pickPurified(rows, { level: sourceLevel, max: Math.abs(Number(entry.amount) || 0), conditionId: wanted });
  const blockedByLevel = rows.filter(r => !r.protectedFlag && (!wanted || r.conditionId === wanted) && r.sourceLevel > sourceLevel).length;
  // Irradiado (dono, 27/11): não sai de uma vez; diminui pelo nível da Skill e, se sobrar pouco, cura.
  let radiationText = "";
  if (!wanted || wanted === "irradiated") {
    const { purifyActorRadiation } = await import("../environment/radiation.js");
    radiationText = await purifyActorRadiation(targetActor, sourceLevel);
  }
  const withRadiation = text => (radiationText ? (text && !/^Nada/.test(text) ? `${text} · ${radiationText}` : radiationText) : text);
  if (!ids.length) return withRadiation(purifyResultText([], { blockedByLevel }));
  const removed = rows.filter(r => ids.includes(r.id));
  await targetActor.deleteEmbeddedDocuments("ActiveEffect", ids);
  await clearConditionExposure(targetActor, exposureToClear(removed));
  xp.push(...removed.map(() => ({ flat: true })).slice(0, 5));
  return withRadiation(purifyResultText(removed.map(r => catalog.find(c => c.id === r.conditionId)?.label ?? r.name)));
}

/* ------------------------------------------------------------------ Reviver */

/**
 * Reviver: só em quem está morto. Tira o "morto" (e o Derrotado do combate), limpa o aviso de "morreu ao chegar a 0" e põe a
 * Vida em X (pontos; o "% da máxima" já chegou resolvido em pontos). Recusa com a razão no resumo.
 */
export async function applyReviveEntry(entry, { targetActor, xp }) {
  const isCharacter = targetActor.type === "character" && Boolean(targetActor.system?.attributes?.hp);
  const refusal = reviveBlockReason({ dead: isDead(targetActor), predated: Boolean(targetActor.getFlag?.(SYSTEM_ID, "predated")), isCharacter });
  if (refusal) return reviveResultText({ name: targetActor.name, refusal });
  const hp = reviveHp(entry.amount, { max: targetActor.system.attributes.hp.max });
  await targetActor.toggleStatusEffect(defeatedId(), { active: false });
  for (const combat of game.combats ?? []) {
    for (const combatant of combat.combatants) {
      if (combatant.actor?.uuid === targetActor.uuid && combatant.defeated) await combatant.update({ defeated: false });
    }
  }
  // Quem morreu passando por Caído/Inconsciente não volta com o contador de morte pendurado.
  const stale = targetActor.effects.filter(e => e.statuses?.has?.("fallen") || e.statuses?.has?.("unconscious")).map(e => e.id);
  if (stale.length) await targetActor.deleteEmbeddedDocuments("ActiveEffect", stale);
  if (targetActor.getFlag(SYSTEM_ID, "killedAtZero")) await targetActor.unsetFlag(SYSTEM_ID, "killedAtZero");
  await targetActor.update({ "system.attributes.hp.value": hp });
  xp.push({ flat: true });
  return reviveResultText({ name: targetActor.name, hp });
}

/* ------------------------------------------------------------------ Drenar */

/**
 * Drenar Vida/Mana na hora: o alvo perde (efeito negativo de `heal`/`restoreEnergy` com a caixa "Drenar") e quem usa
 * recupera o que o alvo realmente perdeu. Devolve o texto do resumo.
 */
export async function drainVitalEntry(entry, { targetActor, caster, sourceLevel }) {
  const key = entry.target === "heal" ? "hp" : "energy";
  const attr = targetActor.system?.attributes?.[key];
  if (!attr) return "";
  const { change } = await restoreVital(targetActor, key, Number(entry.amount) || 0, { level: sourceLevel });
  const lost = Math.max(0, -change);
  return drainGiveBack({ key, lost, caster, kind: key === "hp" ? "life" : "mana", level: sourceLevel });
}

/** Dá a `caster` o que foi drenado (Vida ou Mana). Devolve a linha do resumo ("Drenou 8 de Mana: Kael recupera 8"). */
export async function drainGiveBack({ key, lost, caster, kind, level = 0 }) {
  if (!(lost > 0)) return "";
  if (!caster || caster.type !== "character") return `Drenou ${lost}, mas não há quem recupere`;
  const { change } = await restoreVital(caster, key, drainGainAmount(lost), { level });
  return drainResultText({ kind, lost, gained: Math.max(0, change), casterName: caster.name });
}

/**
 * Drenar atributo: depois de o efeito negativo cair no alvo (com `drainId`), cria em quem usa o ganho igual, pelo mesmo
 * tempo. Os dois efeitos levam o mesmo `drainId` e os uuids dos dois, e terminam juntos (`registerDrainLink`).
 */
export async function createDrainGain(entry, { caster, targetActor, origin, mech, subSkillIndex, label, sourceLevel, sourceMagic, sourceTech, appliedBy }) {
  if (!caster || caster.type !== "character" || !entry.drainId) return "";
  const gain = drainGainEntry(entry);
  const change = resolveEffectChange(gain, caster);
  if (!change?.key) return "";
  const tiedToActive = Boolean(mech.hasUpkeep);
  const anchor = makeAnchor({ skillUuid: origin.uuid, skillId: origin.id, subSkillIndex });
  if (tiedToActive) await rememberAnchoredTarget(caster, anchor, caster.uuid);
  const targetLabel = getEffectTargetLabels()[entry.target] ?? entry.target;
  await createActiveEffects(caster, [
    {
      name: `${label}: ${targetLabel} +${gain.amount} (drenado de ${targetActor.name})`,
      img: entry.icon || origin.img || "icons/svg/aura.svg",
      origin: origin.uuid ?? undefined,
      statuses: [],
      duration: !tiedToActive && entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
      ...buildEffectChanges([{ key: change.key, mode: change.mode, value: change.value }]),
      flags: {
        [SYSTEM_ID]: {
          skillEffect: true,
          conditionId: "",
          tiedToActive,
          activeAnchors: tiedToActive ? [anchor] : [],
          sourceSkillId: origin.id,
          sourceSubSkillIndex: subSkillIndex,
          sourceLevel,
          magic: sourceMagic,
          tech: sourceTech,
          appliedBy,
          drainId: entry.drainId,
          drainRole: "gain",
          drainCasterUuid: caster.uuid,
          drainTargetUuid: targetActor.uuid
        }
      }
    }
  ]);
  return `${caster.name} ganha ${gain.amount} de ${targetLabel}${entry.durationRounds > 0 && !tiedToActive ? ` por ${entry.durationRounds} rodada(s)` : ""}`;
}

/** O efeito (de quem perdeu ou de quem ganhou) terminou: o outro lado do mesmo dreno termina junto (Mestre designado). */
async function onDrainEffectDeleted(effect) {
  const flags = effect.flags?.[SYSTEM_ID];
  if (!flags?.drainId || !isDesignatedGm()) return;
  const candidates = [];
  for (const uuid of [flags.drainCasterUuid, flags.drainTargetUuid]) {
    let actor = null;
    try {
      actor = uuid ? fromUuidSync(uuid) : null;
    } catch {
      actor = null;
    }
    if (!actor?.effects) continue;
    for (const e of actor.effects) candidates.push({ id: e.id, drainId: e.flags?.[SYSTEM_ID]?.drainId, actor, effect: e });
  }
  const linked = linkedDrainEffects(candidates, { id: effect.id, drainId: flags.drainId });
  for (const item of linked) {
    try {
      await item.effect.delete();
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Drenar: não consegui encerrar o efeito ligado.`, err);
    }
  }
}

/** Liga o fim de um dreno de atributo ao fim do outro lado (chamado no `init`). */
export function registerDrainLink() {
  Hooks.on("deleteActiveEffect", effect => {
    onDrainEffectDeleted(effect).catch(err => console.warn(`${SYSTEM_ID} | Drenar: falha ao encerrar o efeito ligado.`, err));
  });
}

export { drainKindOf };
