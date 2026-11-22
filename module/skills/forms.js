import { SYSTEM_ID, isFormsEnabled } from "../core/config.js";
import { isDesignatedGm, runAsGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { deleteKeyUpdate } from "../helpers/foundry-compat.js";
import { skillStateUpdate } from "./skill-state.js";
import {
  buildFormSystem, itemsFromOriginal, copiedSkillState, mergeBackPlan, conditionsToCarry, hpAfterCarry, shouldRevert,
  formActorName, tokenOriginalSnapshot, formTokenUpdate, tokenRestoreUpdate, carryDamage, accumulateCarry, itemMapFromStamps
} from "./form-rules.js";

/**
 * Formas (H5): a Skill de Forma dá ao personagem uma ficha temporária (cópia do molde com o nível, o XP,
 * a Mana, os Títulos e as Skills dele) e os Tokens passam a ser dela; quando a Skill desliga ou a Vida
 * da cópia chega a 0, tudo volta ao personagem. Regras puras em form-rules.js. Tudo que grava roda no
 * Mestre designado (relay `transformActor`, ganchos); o cliente só pede e confere o que dá para conferir.
 */

const FOLDER_NAME = "Formas ativas";
const reverting = new Set();
/** Flags de tempo do personagem (J9b) que a Forma leva para a cópia e devolve ao original. */
const TIME_FLAGS = ["personalTime", "timeSync"];

/** A mecânica (Skill ou Sub-Skill) de uma Skill. */
function mechOf(skill, subSkillIndex) {
  return subSkillIndex == null ? skill?.system : skill?.system?.subSkills?.[subSkillIndex];
}

/** A ficha-molde de uma mecânica de Forma, ou null (some, não é molde, não é Personagem). */
export function formTemplateOf(mech) {
  const uuid = String(mech?.formActorUuid ?? "");
  if (!uuid) return null;
  let doc = null;
  try {
    doc = fromUuidSync(uuid);
  } catch {
    doc = null;
  }
  return doc?.documentName === "Actor" && doc.type === "character" && doc.system?.formTemplate ? doc : null;
}

/** O que o Ator está vestindo agora (copia ativa), ou null. */
export function activeFormOf(actor) {
  return actor?.getFlag?.(SYSTEM_ID, "formActive") ?? null;
}

/** Esta ficha é a cópia temporária de uma forma? */
export function isFormActor(actor) {
  return Boolean(actor?.getFlag?.(SYSTEM_ID, "formOf"));
}

/** Molde de forma? Fora das listas dos jogadores e do Simulador. */
export function isFormTemplate(actor) {
  return Boolean(actor?.type === "character" && actor.system?.formTemplate);
}

/**
 * Por que a Skill de Forma não pode ligar agora (cliente), ou null. O Mestre confere tudo de novo.
 * @param {Actor} actor
 * @param {object} mech
 */
export function formUseCheck(actor, mech) {
  if (!isFormsEnabled()) return "O bloco Formas está desligado nesta mesa.";
  if (actor?.type !== "character") return "Só um Personagem se transforma.";
  if (isFormActor(actor) || activeFormOf(actor)) return "Você já está transformado: desligue a forma atual primeiro.";
  if (!mech?.hasUpkeep) return "A Habilidade de Forma precisa ser Ativa (com manutenção).";
  if (!mech?.formActorUuid) return "Esta Habilidade ainda não tem uma ficha de forma (peça uma forma ao Mestre).";
  if (!formTemplateOf(mech)) return "A ficha da forma sumiu ou não está marcada como molde de forma.";
  return null;
}

/** Na ficha do personagem transformado, só a Skill da Forma (para desligar) é usável. */
export function formUseBlock(actor, skill, subSkillIndex = null) {
  const active = activeFormOf(actor);
  if (!active) return null;
  if (skill?.id === active.skillId && (active.subSkillIndex ?? null) === (subSkillIndex ?? null)) return null;
  return `Você está na forma ${active.templateName ?? ""}: use a ficha da forma (ou desligue a Forma).`.replace("  ", " ");
}

/** Pede ao Mestre para transformar. Devolve `{ok, reason}` já com o aviso na tela quando falha. */
export async function requestTransform(actor, skillId, subSkillIndex = null) {
  const outcome = await runAsGm("transformActor", { sourceActorUuid: actor.uuid, skillId, subSkillIndex }, { reply: true, timeout: 20000 });
  const failure = relayFailureMessage(outcome, "transformar");
  if (failure) ui.notifications?.warn(failure);
  return outcome;
}

/* ------------------------------------------------------------------ Ligar (Mestre) */

async function formsFolder() {
  let folder = game.folders.find(f => f.type === "Actor" && f.name === FOLDER_NAME);
  if (!folder) folder = await Folder.create({ name: FOLDER_NAME, type: "Actor" });
  return folder?.id ?? null;
}

/** Os Tokens do personagem (um só se ele é o Ator sintético de um Token não vinculado). */
function tokensOfOriginal(original) {
  if (original.isToken && original.token) return [original.token];
  const out = [];
  // Só os Tokens vinculados: um Token não vinculado da mesma ficha é outra pessoa (outro Ator sintético).
  for (const scene of game.scenes) for (const token of scene.tokens) if (token.actorLink && token.actorId === original.id) out.push(token);
  return out;
}

/**
 * Lado do Mestre de `transformActor`. Quem pede (`user`) tem de ser dono do personagem; o molde, a
 * Skill e o estado são lidos da ficha, nunca do pedido.
 */
export async function transformActorAsGm(payload, user) {
  if (!isFormsEnabled()) return refuse("o bloco Formas está desligado");
  const original = typeof payload?.sourceActorUuid === "string" ? await fromUuid(payload.sourceActorUuid) : null;
  if (original?.documentName !== "Actor" || original.type !== "character") return refuse(RELAY_REASONS.invalid);
  if (!user?.isGM && !original.testUserPermission(user, "OWNER")) return refuse(RELAY_REASONS.permission);
  const skill = original.items.get(String(payload.skillId ?? ""));
  if (skill?.type !== "skill") return refuse(RELAY_REASONS.invalid);
  const subSkillIndex = payload.subSkillIndex == null ? null : Math.floor(Number(payload.subSkillIndex));
  if (subSkillIndex != null && !(subSkillIndex >= 0)) return refuse(RELAY_REASONS.invalid);
  const mech = mechOf(skill, subSkillIndex);
  if (mech?.effectType !== "form") return refuse(RELAY_REASONS.invalid);
  if (!mech.active) return refuse("a Habilidade de Forma precisa estar ligada");
  if (isFormActor(original) || activeFormOf(original)) return refuse("o personagem já está transformado");
  const template = formTemplateOf(mech);
  if (!template) return refuse("a ficha da forma sumiu ou não é um molde de forma");

  const originalData = original.toObject();
  const templateData = template.toObject();
  const originalItems = itemsFromOriginal(originalData.items).map(item => ({ ...item }));
  const itemsToCopy = originalItems.map(item => {
    const copy = copiedSkillState(item, { isFormSkill: item._id === skill.id });
    const originalId = copy._id;
    delete copy._id;
    // A ordem devolvida por createEmbeddedDocuments pode ser outra (sort): o mapa sai deste carimbo, nunca do índice.
    copy.flags = { ...(copy.flags ?? {}), [SYSTEM_ID]: { ...(copy.flags?.[SYSTEM_ID] ?? {}), formSourceId: originalId } };
    return { originalId, data: copy };
  });

  const energyMax = Number(original.system.attributes.energy?.max) || 0;
  const startXp = Number(original.system.attributes.xp) || 0;
  const name = formActorName(original.name, template.name);
  const data = {
    name,
    type: "character",
    img: template.img,
    folder: await formsFolder(),
    system: buildFormSystem(templateData.system, originalData.system),
    items: templateData.items.map(item => {
      const copy = { ...item };
      delete copy._id;
      return copy;
    }),
    effects: [],
    ownership: foundry.utils.deepClone(originalData.ownership ?? {}),
    prototypeToken: { ...foundry.utils.deepClone(templateData.prototypeToken ?? {}), name, actorLink: true },
    flags: {
      [SYSTEM_ID]: {
        // J9b: o tempo pessoal e a data do aparelho viajam com a forma (e voltam ao original ao reverter).
        ...Object.fromEntries(TIME_FLAGS.filter(key => original.getFlag(SYSTEM_ID, key) !== undefined).map(key => [key, foundry.utils.deepClone(original.getFlag(SYSTEM_ID, key))])),
        formOf: {
          originalUuid: original.uuid,
          skillUuid: skill.uuid,
          skillId: skill.id,
          copySkillId: null,
          subSkillIndex,
          templateUuid: template.uuid,
          templateName: template.name,
          startXp,
          energyMax,
          itemMap: {},
          carry: 0,
          startedAt: Date.now()
        }
      }
    }
  };
  delete data.prototypeToken.actorId;

  const copy = await Actor.create(data);
  if (!copy) return refuse("não deu para criar a ficha da forma");
  try {
    const created = itemsToCopy.length ? await copy.createEmbeddedDocuments("Item", itemsToCopy.map(i => i.data)) : [];
    const itemMap = itemMapFromStamps(created.map(doc => ({ id: doc.id, stamp: doc.getFlag?.(SYSTEM_ID, "formSourceId") ?? null })));
    await copy.update({
      "system.attributes.hp.value": copy.system.attributes.hp.max,
      [`flags.${SYSTEM_ID}.formOf.itemMap`]: itemMap,
      [`flags.${SYSTEM_ID}.formOf.copySkillId`]: itemMap[skill.id] ?? null
    });

    // Os Tokens passam a ser da cópia (vinculada), com a imagem e o tamanho do Token do molde.
    const templateToken = {
      textureSrc: templateData.prototypeToken?.texture?.src ?? "",
      width: templateData.prototypeToken?.width,
      height: templateData.prototypeToken?.height
    };
    const tokens = tokensOfOriginal(original);
    for (const token of tokens) {
      const snapshot = tokenOriginalSnapshot({
        actorId: token.actorId,
        actorLink: token.actorLink,
        delta: token.actorLink ? null : token.delta?.toObject?.() ?? null,
        // `_source`: o documento vivo recebe os quadros da animação (tamanho, imagem) e, com a janela em segundo
        // plano, fica com o valor velho (achado da sessão 3, 21/11; mesmo caso da elevação).
        texture: { src: token._source.texture?.src ?? token.texture?.src },
        width: token._source.width ?? token.width,
        height: token._source.height ?? token.height
      });
      await token.update({ ...formTokenUpdate(copy.id, templateToken), [`flags.${SYSTEM_ID}.formOriginal`]: snapshot });
    }
    // Mesmo lugar na iniciativa: o combatente passa a apontar para a cópia.
    const tokenIds = new Set(tokens.map(t => t.id));
    for (const combat of game.combats) {
      for (const combatant of combat.combatants) {
        if (tokenIds.has(combatant.tokenId)) await combatant.update({ actorId: copy.id });
      }
    }
    // Quem jogava com o personagem passa a jogar com a cópia.
    if (!original.isToken) {
      for (const u of game.users) if (u.character?.id === original.id) await u.update({ character: copy.id });
    }
    await original.setFlag(SYSTEM_ID, "formActive", { copyUuid: copy.uuid, skillId: skill.id, subSkillIndex, templateName: template.name });
  } catch (err) {
    await abortTransform(copy, original);
    reportError("Falha ao transformar.", err);
    return refuse("falha ao transformar (nada mudou)");
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: copy }),
    content: `<p><strong>${escapeHtml(original.name)}</strong> assumiu a forma <strong>${escapeHtml(template.name)}</strong>.</p>`
  });
  return true;
}

/** Desfaz uma transformação que falhou no meio: Tokens ao original e a cópia apagada. */
async function abortTransform(copy, original) {
  try {
    await restoreTokensAndUsers(copy, original);
    await copy.delete();
  } catch (err) {
    console.error(err);
  }
}

/** Tokens, combatentes e `user.character` voltam ao personagem. */
async function restoreTokensAndUsers(copy, original) {
  const tokenIds = new Set();
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorId !== copy.id) continue;
      const snapshot = token.getFlag(SYSTEM_ID, "formOriginal");
      if (!snapshot) continue;
      tokenIds.add(token.id);
      await token.update({ ...tokenRestoreUpdate(snapshot), ...deleteKeyUpdate(`flags.${SYSTEM_ID}.formOriginal`) });
    }
  }
  for (const combat of game.combats) {
    for (const combatant of combat.combatants) {
      if (tokenIds.has(combatant.tokenId) && combatant.actorId !== original.id) await combatant.update({ actorId: original.id });
    }
  }
  for (const u of game.users) if (u.character?.id === copy.id) await u.update({ character: original.id });
}

/* ------------------------------------------------------------------ Voltar (Mestre) */

/**
 * Desfaz a forma: o personagem recebe o XP ganho, a Mana que sobrou, o XP das Skills e as Condições;
 * se a Vida da forma chegou a 0, o dano que passou do 0 entra na Vida dele. Roda no Mestre designado.
 * @param {Actor} copy - a ficha temporária
 * @param {{reason?: string}} [options]
 */
export async function revertFormAsGm(copy, { reason = "" } = {}) {
  const formOf = copy?.getFlag?.(SYSTEM_ID, "formOf");
  if (!formOf || reverting.has(copy.uuid)) return false;
  reverting.add(copy.uuid);
  try {
    const original = await fromUuid(formOf.originalUuid);
    if (original?.documentName !== "Actor") {
      ui.notifications?.warn(`O personagem original de ${copy.name} sumiu: a ficha da forma foi mantida.`);
      return false;
    }
    // O vínculo sai primeiro: as gravações abaixo não podem disparar a volta de novo.
    await original.unsetFlag(SYSTEM_ID, "formActive");

    const copySkills = [];
    // O carimbo do Item vence o mapa gravado (fichas criadas antes da 1.102.1 podem ter o mapa trocado).
    const stamped = itemMapFromStamps(copy.items.map(i => ({ id: i.id, stamp: i.getFlag(SYSTEM_ID, "formSourceId") ?? null })));
    for (const [originalId, copyId] of Object.entries({ ...(formOf.itemMap ?? {}), ...stamped })) {
      const copyItem = copy.items.get(copyId);
      if (copyItem?.type !== "skill") continue;
      copySkills.push({
        originalId,
        copyId,
        xp: copyItem.system.xp,
        level: copyItem.system.level,
        cooldownRemaining: copyItem.system.cooldownRemaining
      });
    }
    const plan = mergeBackPlan({
      original: { xp: original.system.attributes.xp, energy: original.system.attributes.energy.value, energyMax: original.system.attributes.energy.max },
      copy: { xp: copy.system.attributes.xp, energy: copy.system.attributes.energy.value },
      startXp: formOf.startXp,
      skills: copySkills,
      formSkillId: formOf.skillId
    });

    const update = { "system.attributes.xp": plan.xp, "system.attributes.energy.value": plan.energy };
    for (const key of TIME_FLAGS) {
      const value = copy.getFlag(SYSTEM_ID, key);
      if (value !== undefined) update[`flags.${SYSTEM_ID}.${key}`] = foundry.utils.deepClone(value);
    }
    const carry = Math.max(0, Number(copy.getFlag(SYSTEM_ID, "formOf")?.carry) || 0);
    if (carry > 0) update["system.attributes.hp.value"] = hpAfterCarry(original.system.attributes.hp.value, carry);
    await original.update(update);

    const itemUpdates = [];
    for (const s of plan.skills) {
      const item = original.items.get(s.id);
      if (!item) continue;
      const patch = { _id: item.id, "system.xp": s.xp, "system.level": s.level, "system.cooldownRemaining": s.cooldownRemaining };
      if (s.isFormSkill) Object.assign(patch, skillStateUpdate(item, formOf.subSkillIndex ?? null, { active: false }));
      itemUpdates.push(patch);
    }
    if (itemUpdates.length) await original.updateEmbeddedDocuments("Item", itemUpdates);

    // Condições da cópia que não nasceram do corpo da forma.
    const carried = conditionsToCarry(copy.effects.map(e => e.toObject()), SYSTEM_ID).map(data => {
      delete data.origin;
      return data;
    });
    if (carried.length) await original.createEmbeddedDocuments("ActiveEffect", carried, { nihilityConfigured: true });

    await restoreTokensAndUsers(copy, original);
    await copy.delete();

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: original }),
      content: `<p><strong>${escapeHtml(original.name)}</strong> voltou à forma normal${reason ? ` (${escapeHtml(reason)})` : ""}${carry > 0 ? `; ${carry} de dano passou para ele` : ""}.</p>`
    });
    // A forma voava e o personagem não: a queda do J4 confere.
    const { scheduleGroundCheck } = await import("../combat/elevation.js");
    scheduleGroundCheck(original);
    return true;
  } finally {
    reverting.delete(copy.uuid);
  }
}

/* ------------------------------------------------------------------ Ganchos */

/** A Skill de Forma desligou (de qualquer jeito) na cópia ou no original? Então volta. */
async function onItemChanged(item) {
  if (item?.type !== "skill" || !isDesignatedGm()) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor") return;
  const formOf = actor.getFlag(SYSTEM_ID, "formOf");
  if (formOf && (item.id === formOf.copySkillId || (formOf.skillId && item.getFlag(SYSTEM_ID, "formSourceId") === formOf.skillId))) {
    const mech = mechOf(item, formOf.subSkillIndex ?? null);
    if (shouldRevert({ formSkillActive: Boolean(mech?.active), hp: actor.system.attributes.hp.value })) await revertFormAsGm(actor, { reason: "a Forma foi desligada" });
    return;
  }
  const active = actor.getFlag(SYSTEM_ID, "formActive");
  if (active && item.id === active.skillId) {
    const mech = mechOf(item, active.subSkillIndex ?? null);
    if (mech?.active) return;
    const copy = await fromUuid(active.copyUuid);
    if (copy) await revertFormAsGm(copy, { reason: "a Forma foi desligada" });
    else await actor.unsetFlag(SYSTEM_ID, "formActive");
  }
}

/** Vida da cópia em 0: o personagem volta e o dano que sobrou passa para ele. */
async function onActorUpdated(actor, changes) {
  if (!isDesignatedGm() || !isFormActor(actor)) return;
  if (!foundry.utils.hasProperty(changes, "system.attributes.hp.value")) return;
  if (actor.system.attributes.hp.value > 0) return;
  await revertFormAsGm(actor, { reason: "a Vida da forma chegou a 0" });
}

/** Chamado uma vez, no `init`. Tudo confere `isFormsEnabled()` ao agir onde cria; voltar nunca é bloqueado. */
export function registerForms() {
  Hooks.on("updateItem", item => {
    onItemChanged(item).catch(err => reportError("Falha ao voltar da forma.", err, { gmOnly: true }));
  });
  Hooks.on("updateActor", (actor, changes) => {
    onActorUpdated(actor, changes).catch(err => reportError("Falha ao voltar da forma.", err, { gmOnly: true }));
  });
}

/**
 * Guarda para o Aplicar do card de dano: se o alvo é uma forma e o golpe passa da Vida dela, devolve o
 * valor novo do `carry` a gravar na MESMA atualização (antes de a Vida chegar a 0 e a volta correr).
 * @param {Actor} actor
 * @param {number} previousHp
 * @param {number} hpDamage - o que chega na Vida (já sem o Escudo e já reduzido)
 * @returns {number|null}
 */
export function formCarryUpdate(actor, previousHp, hpDamage) {
  const formOf = actor?.getFlag?.(SYSTEM_ID, "formOf");
  if (!formOf) return null;
  const extra = carryDamage(previousHp, hpDamage);
  return extra > 0 ? accumulateCarry(formOf.carry, extra) : null;
}

export const FORM_CARRY_PATH = `flags.${SYSTEM_ID}.formOf.carry`;
