/**
 * Vida 0: Caído e Inconsciente (backlog B1). Regras puras em incapacitation-rules.js; aqui só se lê
 * e grava fichas, e se liga aos hooks. Bloco `FEATURES.incapacitation`.
 *
 *  - Caído entra quando a Vida de um PJ chega a 0 (`updateActor`, Mestre designado), com o
 *    contador de morte guardado no flag do próprio efeito. NPC (marcado NPC ou sem jogador dono)
 *    morre direto: Derrotado no combate e o "morto" do core no Token.
 *  - Qualquer coisa que tire a Vida do 0 troca Caído por Inconsciente com N rodadas. O Desfazer
 *    do card de dano (`options.nihilityUndo`) desfaz a queda sem deixar Inconsciente.
 *  - Contagem no início do turno do próprio personagem (`tickIncapacitation`, chamado do
 *    `updateCombat` ANTES de regeneração e ticks — quem regenera para fora do 0 neste turno vira
 *    Inconsciente sem já perder uma rodada). Contado por nós, não pela duração do Foundry: a V14
 *    só "suprime" um efeito vencido e a V13 faz diferente.
 *  - Incapacitado (qualquer Condição do catálogo com `incapacitates`, ou o "morto" do core) não
 *    usa Skill, não ataca, não usa consumível, não corre e não move o Token (o Mestre move). Ao
 *    entrar, todas as Habilidades Ativas desligam. Regeneração, cura periódica e cura de terceiros
 *    continuam — o que para é o que exige agir.
 */
import { SYSTEM_ID, getActiveStatusConditions, getFeatureOption, isIncapacitationEnabled, actorTraits } from "../core/config.js";
import { TECH_SUPPRESSION_FLAG } from "../core/suppression.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { incapacitatingIds, isIncapacitatedBy, zeroHpOutcome, incapacitationTurn } from "./incapacitation-rules.js";

const FLAG = "incapacitation";
const HP_PATH = "system.attributes.hp.value";

function defeatedId() {
  return CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
}

function catalogIds() {
  return incapacitatingIds(getActiveStatusConditions());
}

/** O Ator está Caído, Inconsciente (ou outra Condição que incapacita) ou morto? */
export function isIncapacitated(actor) {
  if (!actor?.statuses || !isIncapacitationEnabled()) return false;
  return isIncapacitatedBy([{ statuses: actor.statuses }], catalogIds(), defeatedId());
}

/** Morto: o "Derrotado" do core no Token (NPC em 0, ou "Marcar como morto"). */
export function isDead(actor) {
  return Boolean(actor?.statuses?.has(defeatedId()));
}

/** Rótulo da Condição que está incapacitando (para o aviso). */
function incapacitationLabel(actor) {
  const ids = catalogIds();
  const id = [...(actor.statuses ?? [])].find(s => ids.has(s));
  return getActiveStatusConditions().find(c => c.id === id)?.label ?? "fora de combate";
}

/** Avisa e devolve true se o Ator não pode agir agora. Usado por Skill, ataque, consumível e Correr. */
export function blockIfIncapacitated(actor, what = "agir") {
  if (!isIncapacitated(actor)) return false;
  ui.notifications?.warn(`${actor.name} está ${incapacitationLabel(actor)} e não pode ${what}.`);
  return true;
}

/** NPC para a regra da Vida 0: marcado NPC na ficha, ou sem nenhum jogador como dono. */
export function countsAsNpc(actor) {
  return actor?.system?.isPlayerCharacter === false || !actor?.hasPlayerOwner;
}

function conditionData(id) {
  const condition = getActiveStatusConditions().find(c => c.id === id);
  const fallback = { fallen: ["Caído", "icons/svg/skull.svg"], unconscious: ["Inconsciente", "icons/svg/unconscious.svg"] }[id];
  return { label: condition?.label ?? fallback?.[0] ?? id, icon: condition?.icon || fallback?.[1] || "icons/svg/aura.svg" };
}

/** O efeito da Condição `id` no Ator, se houver. */
function effectWith(actor, id) {
  return actor.effects.find(e => e.statuses?.has?.(id));
}

async function addIncapacitation(actor, id, state) {
  const { label, icon } = conditionData(id);
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{ name: label, img: icon, statuses: [id], flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: id, [FLAG]: state } } }],
    { nihilityConfigured: true }
  );
}

function ownersOf(actor) {
  return game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
}

function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/* ------------------------------------------------------------------ Vida 0 */

/** PJ em 0: Caído com contador de morte, e o card público com "Estabilizar" para o Mestre. */
async function fall(actor) {
  if (effectWith(actor, "fallen")) return;
  const rounds = Math.max(1, Number(getFeatureOption("incapacitation", "deathRounds")) || 3);
  await effectWith(actor, "unconscious")?.delete();
  await addIncapacitation(actor, "fallen", { kind: "fallen", rounds, stabilized: false, warned: false });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> caiu! Sem ajuda, morre em ${rounds} rodada(s).</p>`,
    flags: { [SYSTEM_ID]: { incapacitationCard: { actorUuid: actor.uuid } } }
  });
}

/** NPC em 0: Derrotado no combate e o "morto" do core no Token. Guarda que foi a regra (Desfazer). */
async function die(actor) {
  if (actor.statuses?.has(defeatedId())) return;
  await actor.toggleStatusEffect(defeatedId(), { active: true, overlay: true });
  for (const combat of game.combats) {
    for (const combatant of combat.combatants) {
      if (combatant.actor?.uuid === actor.uuid && !combatant.defeated) await combatant.update({ defeated: true });
    }
  }
  await actor.setFlag(SYSTEM_ID, "killedAtZero", true);
}

/** Saiu do 0: Caído vira Inconsciente por N rodadas (0 = acorda direto). */
async function wakeToUnconscious(actor) {
  const fallen = effectWith(actor, "fallen");
  if (!fallen) return;
  await fallen.delete();
  const rounds = Math.max(0, Number(getFeatureOption("incapacitation", "wakeRounds")) || 0);
  if (rounds > 0 && !effectWith(actor, "unconscious")) await addIncapacitation(actor, "unconscious", { kind: "unconscious", rounds });
}

/**
 * Passou da Mana (C2, skills/cooldown-rules.js): a pessoa cai Inconsciente pelo contador de acordar
 * (`wakeRounds`, pelo menos 1). Não mexe em quem já está Inconsciente, Caído ou morto.
 * @returns {Promise<boolean>} true se ficou Inconsciente agora
 */
export async function knockUnconscious(actor) {
  if (!actor || actor.type !== "character" || isDead(actor) || effectWith(actor, "unconscious") || effectWith(actor, "fallen")) return false;
  const rounds = Math.max(1, Number(getFeatureOption("incapacitation", "wakeRounds")) || 3);
  await addIncapacitation(actor, "unconscious", { kind: "unconscious", rounds });
  return true;
}

/** Desfazer do card de dano: a queda é revertida inteira, sem Inconsciente. */
async function undoFall(actor) {
  await effectWith(actor, "fallen")?.delete();
  if (actor.getFlag(SYSTEM_ID, "killedAtZero")) {
    await actor.toggleStatusEffect(defeatedId(), { active: false });
    for (const combat of game.combats) {
      for (const combatant of combat.combatants) if (combatant.actor?.uuid === actor.uuid && combatant.defeated) await combatant.update({ defeated: false });
    }
    await actor.unsetFlag(SYSTEM_ID, "killedAtZero");
  }
}

async function onUpdateActor(actor, changed, options) {
  if (!isDesignatedGm() || actor.type !== "character" || !isIncapacitationEnabled()) return;
  if (foundry.utils.getProperty(changed, HP_PATH) === undefined) return;
  const hp = Number(actor.system.attributes?.hp?.value) || 0;
  if (hp <= 0) {
    const npcDies = getFeatureOption("incapacitation", "npcDiesAtZero") !== false;
    if (zeroHpOutcome({ isPlayerCharacter: !countsAsNpc(actor), npcDies }) === "die") await die(actor);
    else await fall(actor);
    return;
  }
  if (options?.nihilityUndo) return undoFall(actor);
  if (options?.nihilityRest) return wakeFully(actor);
  await wakeToUnconscious(actor);
}

/**
 * Descanso com Vida acima de 0: acorda de vez (Caído e o Inconsciente com contador saem). Fora de
 * combate não há turno para contar as rodadas do Inconsciente — sem isto, ficaria até o Mestre tirar.
 * Inconsciente marcado à mão (sem contador) fica: foi decisão do Mestre.
 */
async function wakeFully(actor) {
  await effectWith(actor, "fallen")?.delete();
  const unconscious = effectWith(actor, "unconscious");
  if (unconscious?.getFlag(SYSTEM_ID, FLAG)) await unconscious.delete();
}

/* ------------------------------------------------------------------ PEM: corpo mecânico desliga */

/** Flag do Inconsciente que o PEM causa (sem contador): `{field: bool}`. */
const EMP_FLAG = "empShutdown";

/** O corpo é mecânico (Traço `mechanical`: Androide, Ciborgue…)? */
export function isMechanicalBody(actor) {
  return actor?.type === "character" && actorTraits(actor).includes("mechanical");
}

/**
 * O PEM alcançou um corpo mecânico: fica Inconsciente (sem contador) enquanto a Supressão
 * tecnológica durar — `rounds` do PEM de Skill (0 = até tirar) ou enquanto estiver no campo
 * (`field`). Nunca mexe num Inconsciente que já exista (de Vida 0 ou marcado à mão). Só o Mestre.
 * @returns {Promise<string|null>} linha pro resumo, ou null se nada mudou
 */
export async function applyEmpShutdown(actor, { rounds = 0, field = false } = {}) {
  // Morto não "desliga": já está fora de jogo.
  if (!isMechanicalBody(actor) || isDead(actor) || effectWith(actor, "unconscious")) return null;
  const { label, icon } = conditionData("unconscious");
  const duration = Math.max(0, Math.round(Number(rounds) || 0));
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{
      name: `${label} (PEM)`,
      img: icon,
      statuses: ["unconscious"],
      duration: !field && duration > 0 ? { rounds: duration } : {},
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: "unconscious", [EMP_FLAG]: { field: Boolean(field) } } }
    }],
    { nihilityConfigured: true }
  );
  return `${actor.name} desliga (${label})`;
}

/**
 * Acorda quem o PEM desligou, quando a Supressão tecnológica que causou acabou: `field` = saiu do
 * campo (só o desligamento de campo); sem `field`, o de Skill, se não restou nenhuma Supressão
 * tecnológica. Inconsciente de Vida 0 ou à mão nunca é tocado.
 */
export async function releaseEmpShutdown(actor, { field = false } = {}) {
  if (!actor) return false;
  const ids = actor.effects
    .filter(e => {
      const flag = e.getFlag(SYSTEM_ID, EMP_FLAG);
      return flag && Boolean(flag.field) === Boolean(field);
    })
    .map(e => e.id);
  if (!ids.length) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return true;
}

/* ------------------------------------------------------------------ Turno */

/**
 * Início do turno do personagem (Mestre, do `updateCombat`): contador de morte do Caído e as
 * rodadas do Inconsciente. Chamado ANTES da regeneração do turno.
 */
export async function tickIncapacitation(actor) {
  // O hook de combate roda em todo cliente de Mestre: o contador anda num só.
  if (!isDesignatedGm() || !actor || actor.type !== "character" || !isIncapacitationEnabled()) return;
  for (const id of ["fallen", "unconscious"]) {
    const effect = effectWith(actor, id);
    const state = effect?.getFlag(SYSTEM_ID, FLAG);
    if (!state) continue;
    const { state: next, event } = incapacitationTurn(state);
    if (event === "wake") {
      await effect.delete();
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>${escapeHtml(actor.name)}</strong> recobra a consciência.</p>` });
      continue;
    }
    await effect.setFlag(SYSTEM_ID, FLAG, next);
    if (event === "death") {
      await ChatMessage.create({
        whisper: gmIds(),
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${escapeHtml(actor.name)}</strong> chegou ao fim do contador caído, sem ajuda. Pela regra, morreria agora — a decisão é sua.</p>`,
        flags: { [SYSTEM_ID]: { incapacitationCard: { actorUuid: actor.uuid, death: true } } }
      });
    } else if (id === "fallen" && !next.stabilized) {
      await ChatMessage.create({
        whisper: ownersOf(actor),
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${escapeHtml(actor.name)}</strong> segue caído: ${next.rounds} rodada(s) até a morte.</p>`
      });
    }
  }
}

/* ------------------------------------------------------------------ Card: Estabilizar / Marcar morto */

function renderIncapacitationCard(message, html) {
  const card = message.getFlag(SYSTEM_ID, "incapacitationCard");
  if (!card || !game.user.isGM) return;
  const actor = fromUuidSync(card.actorUuid);
  if (!actor) return;
  const fallen = effectWith(actor, "fallen");
  const state = fallen?.getFlag(SYSTEM_ID, FLAG);
  const bar = document.createElement("div");
  bar.className = "nihility-damage-controls";
  const add = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    bar.append(button);
  };
  if (state && !state.stabilized && !card.stabilized && !card.death) {
    add("Estabilizar", async () => {
      await fallen.setFlag(SYSTEM_ID, FLAG, { ...state, stabilized: true });
      // Grava no card também: só esta mensagem redesenha, e todos veem o ✓.
      await message.setFlag(SYSTEM_ID, "incapacitationCard", { ...card, stabilized: true });
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>${escapeHtml(actor.name)}</strong> foi estabilizado: não corre mais risco de morrer, mas segue caído.</p>` });
    });
  } else if ((state?.stabilized || card.stabilized) && !card.death) {
    const done = document.createElement("span");
    done.className = "damage-applied";
    done.textContent = "✓ Estabilizado";
    bar.append(done);
  }
  if (card.death && !actor.statuses?.has(defeatedId())) add("Marcar como morto", () => die(actor));
  if (bar.childElementCount) html.append(bar);
}

/* ------------------------------------------------------------------ Hooks */

export function registerIncapacitation() {
  Hooks.on("updateActor", onUpdateActor);

  // PEM: quando a Supressão tecnológica que desligou um corpo mecânico some (acabou, o Mestre
  // tirou, saiu do campo), ele acorda. Só o Mestre designado.
  Hooks.on("deleteActiveEffect", async effect => {
    if (!isDesignatedGm()) return;
    const flags = effect.flags?.[SYSTEM_ID];
    if (flags?.[TECH_SUPPRESSION_FLAG] === undefined) return;
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    const field = flags.interferenceField !== undefined;
    const remains = actor.effects.some(e => e.id !== effect.id && !e.disabled && e.flags?.[SYSTEM_ID]?.[TECH_SUPPRESSION_FLAG] !== undefined && (e.flags[SYSTEM_ID].interferenceField !== undefined) === field);
    if (!remains) await releaseEmpShutdown(actor, { field });
  });

  // Entrou numa Condição que incapacita (por esta regra, à mão no Token, por Skill): todas as
  // Habilidades Ativas desligam. Só o Mestre designado executa.
  Hooks.on("createActiveEffect", async effect => {
    if (!isDesignatedGm() || !isIncapacitationEnabled()) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || actor.type !== "character") return;
    const ids = catalogIds();
    if (![...(effect.statuses ?? [])].some(s => ids.has(s) || s === defeatedId())) return;
    const { shutdownActiveSkills } = await import("../skills/upkeep.js");
    await shutdownActiveSkills(actor, { reason: `está ${effect.name}` });
    // Preparo em andamento (H3) também se perde.
    const { cancelAllPreparations } = await import("../skills/preparation.js");
    await cancelAllPreparations(actor, `o personagem ficou ${effect.name}`);
  });

  // Não move o Token (o Mestre move — tirar um corpo do caminho, por exemplo).
  Hooks.on("preMoveToken", (document, movement, operation) => {
    // O empurrão do sistema arrasta até um Caído (nihilityForced); o Mestre também sempre pode.
    if (game.user.isGM || operation?.nihilityForced || !isIncapacitated(document.actor)) return undefined;
    ui.notifications.warn(`${document.actor.name} está ${incapacitationLabel(document.actor)} e não pode se mover.`);
    return false;
  });

  Hooks.on("renderChatMessageHTML", renderIncapacitationCard);
}
