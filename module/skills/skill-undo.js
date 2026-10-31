/**
 * Desfazer o uso de uma Skill (backlog L12; mockup aprovado: Design "Desfazer Uso de Skill").
 *
 * Quem desfaz: só o Mestre. Até quando: em combate, enquanto o turno for o mesmo do uso; fora de
 * combate, enquanto for o último uso daquele personagem. O dano já aplicado volta junto (o mesmo
 * Desfazer do card de dano).
 *
 * Como: `recordSkillUse` fotografa quem usou e os alvos antes e depois do uso (skill-undo-rules.js
 * diz o que mudou) e guarda o registro no card do uso (`flags.<sistema>.skillUse`). Toda mensagem
 * criada durante o uso leva `skillUseId`; Estrutura e Zona pedidas ao Mestre levam `useId`.
 * Só vale para usos feitos depois desta versão — os de antes não guardaram nada.
 */
import { SYSTEM_ID, isFeatureEnabled, getEnergyLabelForActor, combatantIsActor, actorDisplayName } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";
import { damageCardHits, undoDamageCard } from "../combat/damage-apply.js";
import { structuresOnScene, removeStructureInstance } from "../structures/structures.js";
import { zonesOnScene } from "../combat/area-effects.js";
import { beginSkillUse, endSkillUse, currentSkillUseId } from "./skill-use-context.js";
import { reportError } from "../helpers/report.js";
import {
  UNDO_VITAL_PATHS,
  UNDO_ITEM_PATHS,
  UNDO_FLAG_KEYS,
  diffFields,
  fieldPairs,
  revertFields,
  revertPools,
  diffEffects,
  actorEntryHasChanges,
  undoWindowOpen,
  undoPreviewRows
} from "./skill-undo-rules.js";

const POOLS_PATH = "system.attributes.shield.pools";
const SHIELD_PATH = "system.attributes.shield.value";

export function isSkillUndoEnabled() {
  return isFeatureEnabled("skillUndo");
}

/* ------------------------------------------------------------------ Fotografia */

function itemFields(item) {
  const out = {};
  for (const path of UNDO_ITEM_PATHS) {
    const value = foundry.utils.getProperty(item._source, path);
    if (value !== undefined) out[path] = foundry.utils.deepClone(value);
  }
  const subs = item._source?.system?.subSkills;
  if (Array.isArray(subs) && subs.length) out.subSkillsActive = subs.map(s => Boolean(s?.active));
  return out;
}

function vitalFields(actor, kind) {
  const out = {};
  for (const path of UNDO_VITAL_PATHS[kind]) {
    const value = foundry.utils.getProperty(actor._source, path);
    if (typeof value === "number") out[path] = value;
  }
  return out;
}

function snapshotActor(actor) {
  const kind = isShipLike(actor) ? "ship" : "character";
  const items = {};
  for (const item of actor.items) items[item.id] = { name: item.name, fields: itemFields(item) };
  const flags = {};
  for (const key of UNDO_FLAG_KEYS) flags[key] = foundry.utils.deepClone(actor.getFlag(SYSTEM_ID, key) ?? null);
  return {
    kind,
    vitals: vitalFields(actor, kind),
    pools: kind === "character" ? foundry.utils.deepClone(foundry.utils.getProperty(actor._source, POOLS_PATH) ?? []) : null,
    effects: actor.effects.map(e => e.toObject()),
    items,
    flags
  };
}

function actorEntry(actor, before, after, isSource) {
  const items = [];
  for (const [id, b] of Object.entries(before.items)) {
    const a = after.items[id];
    if (!a) continue; // o uso consumiu o Item: não há o que restaurar nele
    const changes = diffFields(b.fields, a.fields);
    if (Object.keys(changes).length) items.push({ id, name: b.name, changes: fieldPairs(changes) });
  }
  const samePools = JSON.stringify(before.pools ?? null) === JSON.stringify(after.pools ?? null);
  return {
    uuid: actor.uuid,
    name: actorDisplayName(actor),
    kind: before.kind,
    isSource,
    energyLabel: getEnergyLabelForActor(actor),
    vitals: fieldPairs(diffFields(before.vitals, after.vitals)),
    pools: samePools ? null : { before: before.pools ?? [], after: after.pools ?? [] },
    effects: diffEffects(before.effects, after.effects),
    items,
    flags: fieldPairs(diffFields(before.flags, after.flags))
  };
}

function uniqueActors(list) {
  const seen = new Set();
  return list.filter(a => a?.uuid && !seen.has(a.uuid) && seen.add(a.uuid));
}

/** O combate começado em que este Ator está, ou null. */
function combatOf(actor) {
  return game.combats?.find(c => c.started && c.combatants.some(cb => combatantIsActor(cb, actor))) ?? null;
}

/**
 * Embrulha um uso de Skill (`run`) e, se ele aconteceu, guarda o registro no card. Desligar uma
 * Skill Ativa não é registrado (não há o que desfazer). Um erro aqui nunca derruba o uso.
 */
export async function recordSkillUse(sourceActor, skillId, options, run) {
  const skill = sourceActor?.items?.get(skillId);
  const sub = options?.subSkillIndex != null ? skill?.system?.subSkills?.[options.subSkillIndex] : null;
  const mech = sub ?? skill?.system;
  if (!skill || !mech || (mech.hasUpkeep && mech.active) || !isSkillUndoEnabled()) return run();

  let actors;
  let before;
  try {
    actors = uniqueActors([sourceActor, options.targetActor, ...(options.targetActors ?? [])]);
    before = actors.map(snapshotActor);
  } catch (err) {
    reportError("Desfazer uso: não consegui fotografar antes do uso — este uso não terá o botão Desfazer.", err, { gmOnly: true });
    return run();
  }

  const context = beginSkillUse();
  const startedAt = Date.now();
  let result;
  try {
    result = await run();
  } finally {
    endSkillUse(context);
  }
  if (!result) return result;

  try {
    const entries = actors.map((actor, i) => actorEntry(actor, before[i], snapshotActor(actor), i === 0)).filter(actorEntryHasChanges);
    const messages = game.messages.filter(m => m.getFlag(SYSTEM_ID, "skillUseId") === context.id);
    const hasDamage = messages.some(m => damageCardHits(m).length);
    const placed = {
      structure: Boolean(options.structurePlacement),
      zone: Boolean(options.zonePlacement)
    };
    if (!entries.length && !hasDamage && !placed.structure && !placed.zone) return result;

    const combat = combatOf(sourceActor);
    const label = sub ? `${skill.name} — ${sub.name}` : skill.name;
    const record = {
      v: 1,
      useId: context.id,
      actorUuid: sourceActor.uuid,
      actorName: actorDisplayName(sourceActor),
      skillUuid: skill.uuid,
      label,
      time: startedAt,
      combat: combat ? { id: combat.id, round: combat.round, turn: combat.turn } : null,
      actors: entries,
      placed
    };

    let card = messages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).at(-1);
    if (!card) {
      card = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
        content: `<p><strong>${foundry.utils.escapeHTML(record.actorName)}</strong> usou <strong>${foundry.utils.escapeHTML(label)}</strong>.</p>`,
        flags: { [SYSTEM_ID]: { skillUseId: context.id } }
      });
    }
    await card?.setFlag(SYSTEM_ID, "skillUse", record);
  } catch (err) {
    reportError("Desfazer uso: não consegui registrar o uso — ele não terá o botão Desfazer.", err, { gmOnly: true });
  }
  return result;
}

/* ------------------------------------------------------------------ Botão no card */

function recordOf(message) {
  return message?.getFlag?.(SYSTEM_ID, "skillUse") ?? null;
}

function windowOpen(message, record) {
  const live = record.combat ? game.combats.get(record.combat.id) : null;
  const combat = live ? { id: live.id, round: live.round, turn: live.turn } : null;
  // Fora de combate: há um uso mais novo do mesmo personagem? (só as mensagens depois desta)
  let newerUse = false;
  if (!record.combat) {
    const all = game.messages.contents;
    for (let i = all.length - 1; i >= 0 && all[i].id !== message.id; i--) {
      const other = recordOf(all[i]);
      if (other?.actorUuid === record.actorUuid && (other.time ?? 0) > (record.time ?? 0)) {
        newerUse = true;
        break;
      }
    }
  }
  return undoWindowOpen(record, { combat, newerUse });
}

const UNDO_ICON =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path></svg>';

/**
 * Card já desfeito: riscado, com a faixa "Uso desfeito pelo Mestre" (todos veem). Card com
 * registro ainda no prazo: rodapé "Desfazer uso" (só o Mestre vê). Chamado no
 * `renderChatMessageHTML`, depois dos botões de dano.
 */
export function renderSkillUndo(message, html) {
  if (message.getFlag(SYSTEM_ID, "skillUndone")) {
    html.classList.add("nihility-use-undone");
    const strip = document.createElement("div");
    strip.className = "nihility-use-undone-strip";
    strip.innerHTML = `${UNDO_ICON}<span>Uso desfeito pelo Mestre</span>`;
    html.append(strip);
    return;
  }
  const record = recordOf(message);
  if (!record || !game.user.isGM || !isSkillUndoEnabled() || !windowOpen(message, record)) return;
  const footer = document.createElement("div");
  footer.className = "nihility-use-undo";
  footer.innerHTML = `<span class="hint">só o Mestre vê</span><button type="button">${UNDO_ICON}<span>Desfazer uso</span></button>`;
  footer.querySelector("button").addEventListener("click", () => confirmSkillUndo(message));
  html.append(footer);
}

/** Redesenha os cards com registro ainda não desfeito (o botão aparece/some com o turno). */
function refreshUndoCards(exceptId = null) {
  if (!game.user.isGM) return;
  for (const m of game.messages.contents.slice(-60)) {
    const record = recordOf(m);
    if (!record || m.id === exceptId || m.getFlag(SYSTEM_ID, "skillUndone")) continue;
    ui.chat?.updateMessage?.(m);
  }
}

/* ------------------------------------------------------------------ Confirmar e desfazer */

function taggedMessages(record) {
  return game.messages.filter(m => m.getFlag(SYSTEM_ID, "skillUseId") === record.useId);
}

async function confirmSkillUndo(message) {
  const record = recordOf(message);
  if (!record || !windowOpen(message, record)) {
    ui.notifications.warn("O prazo para desfazer este uso já passou.");
    return;
  }
  const damage = taggedMessages(record).flatMap(m => damageCardHits(m));
  const rows = undoPreviewRows(record, { damage, skillLabel: record.label });
  const esc = foundry.utils.escapeHTML;
  const list = rows.length
    ? `<ul class="undo-rows">${rows.map(r => `<li><span class="undo-tag tone-${r.tone}">${esc(r.tag)}</span><span>${esc(r.text)}</span></li>`).join("")}</ul>`
    : `<p class="undo-empty">Nada além do card a reverter.</p>`;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Desfazer uso — ${record.label} (${record.actorName})` },
    classes: ["nihility-undo-dialog"],
    content: `<div class="nihility-undo-confirm"><p class="undo-lead">Isto vai ser revertido:</p>${list}<p class="undo-foot">O card fica no chat, riscado.</p></div>`,
    yes: { label: "Desfazer", default: true },
    no: { label: "Cancelar" }
  });
  if (!ok) return;
  // O turno pode ter virado com a janela aberta.
  if (!windowOpen(message, recordOf(message) ?? record)) {
    ui.notifications.warn("O turno virou: o prazo para desfazer este uso passou.");
    return;
  }
  await performSkillUndo(message, record);
}

async function revertActor(entry) {
  const actor = await fromUuid(entry.uuid);
  if (!actor) return;
  // Um objeto NOVO por gravação: o Foundry escreve no objeto de operação (parentUuid, updates…)
  // e, reaproveitado, o actor.update do fim era tratado como gravação embutida e recusado.
  const options = () => ({ nihilityUndo: true });

  // Active Effects: os criados saem, os mudados voltam como eram, os apagados voltam.
  const created = (entry.effects?.created ?? []).map(e => e.id).filter(id => actor.effects.has(id));
  if (created.length) await actor.deleteEmbeddedDocuments("ActiveEffect", created, options());
  const changed = (entry.effects?.changed ?? []).filter(e => actor.effects.has(e._id));
  if (changed.length) await actor.updateEmbeddedDocuments("ActiveEffect", changed, { ...options(), recursive: false });
  const deleted = (entry.effects?.deleted ?? []).filter(e => !actor.effects.has(e._id));
  if (deleted.length) await actor.createEmbeddedDocuments("ActiveEffect", deleted, { ...options(), keepId: true, nihilityConfigured: true });

  // Itens: Skill que ligou desliga, XP de uso sai, Vida de parte/Módulo volta.
  const itemUpdates = [];
  for (const item of entry.items ?? []) {
    const doc = actor.items.get(item.id);
    if (!doc) continue;
    const reverted = revertFields(itemFields(doc), item.changes);
    const update = { _id: doc.id };
    for (const [key, value] of Object.entries(reverted)) {
      if (key === "subSkillsActive") {
        const subs = foundry.utils.deepClone(doc._source.system.subSkills ?? []);
        subs.forEach((s, i) => {
          if (typeof value?.[i] === "boolean") s.active = value[i];
        });
        update["system.subSkills"] = subs;
      } else {
        update[key] = value;
      }
    }
    itemUpdates.push(update);
  }
  if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates, options());

  // Vitais (pela diferença) e pools de Escudo.
  const update = revertFields(vitalFields(actor, entry.kind), entry.vitals);
  if (entry.pools) {
    const current = foundry.utils.deepClone(foundry.utils.getProperty(actor._source, POOLS_PATH) ?? []);
    const pools = revertPools(current, entry.pools.before, entry.pools.after);
    update[POOLS_PATH] = pools;
    const total = update[SHIELD_PATH] ?? foundry.utils.getProperty(actor._source, SHIELD_PATH) ?? 0;
    const sum = pools.reduce((s, p) => s + (p.value ?? 0), 0);
    if (sum > total) update[SHIELD_PATH] = sum;
  }
  for (const [key, [before]] of fieldPairs(entry.flags)) {
    if (before === null) update[`flags.${SYSTEM_ID}.-=${key}`] = null;
    else update[`flags.${SYSTEM_ID}.${key}`] = before;
  }
  if (Object.keys(update).length) await actor.update(update, options());
}

async function performSkillUndo(message, record) {
  const tagged = taggedMessages(record);
  try {
    // 1) Dano já aplicado volta (o Desfazer do próprio card de dano).
    for (const m of tagged) await undoDamageCard(m);
    // 2) Cada Ator envolvido volta.
    for (const entry of record.actors ?? []) {
      try {
        await revertActor(entry);
      } catch (err) {
        reportError(`Desfazer uso: ${entry.name} não pôde ser revertido por inteiro.`, err);
      }
    }
    // 3) Estrutura/Zona que este uso ergueu somem do mapa.
    for (const scene of game.scenes) {
      for (const instance of structuresOnScene(scene)) {
        if (instance.useId && instance.useId === record.useId) await removeStructureInstance(scene, instance.id, "dismissed");
      }
      for (const doc of zonesOnScene(scene)) {
        if (doc.getFlag(SYSTEM_ID, "zone")?.useId === record.useId) await doc.delete();
      }
    }
  } catch (err) {
    reportError("Desfazer uso: parte não pôde ser revertida.", err);
  }
  // 4) Todos os cards deste uso ficam riscados.
  for (const m of new Set([message, ...tagged])) {
    await m.update({ [`flags.${SYSTEM_ID}.skillUndone`]: true, ...(recordOf(m) ? { [`flags.${SYSTEM_ID}.skillUse.undone`]: true } : {}) });
  }
  ui.notifications.info(`Uso de ${record.label} desfeito.`);
}

/* ------------------------------------------------------------------ Registro */

/** Chamado no `init`. */
export function registerSkillUndo() {
  // Mensagens criadas por este usuário durante um uso levam o id dele (menos a Voz do Mundo).
  Hooks.on("preCreateChatMessage", (doc, data, options, userId) => {
    if (userId !== game.user.id) return;
    const useId = currentSkillUseId();
    if (!useId || doc.getFlag(SYSTEM_ID, "voiceOfTheWorld") || doc.getFlag(SYSTEM_ID, "skillUseId")) return;
    doc.updateSource({ [`flags.${SYSTEM_ID}.skillUseId`]: useId });
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if ("turn" in changes || "round" in changes) refreshUndoCards();
  });
  Hooks.on("deleteCombat", () => refreshUndoCards());
  Hooks.on("updateChatMessage", (message, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${SYSTEM_ID}.skillUse`)) refreshUndoCards(message.id);
  });
}
