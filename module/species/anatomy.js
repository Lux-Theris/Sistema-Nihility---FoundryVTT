/**
 * Anatomia com mecânica (board 5) — o lado Foundry: instalar/remover implante (o Item arrastado
 * para a Parte vira uma modificação dela e volta ao inventário ao sair), as Condições que as partes
 * perdidas causam (Mestre designado mantém em dia), o aviso de parte vital, o dano que cai numa
 * parte e a cura por tipo (Cura / Regeneração / Reparo). A conta é pura (anatomy-rules.js) e o estado do corpo sai da preparação da ficha
 * (`system.bodyState`, ver deriveBodyState em character-model.js).
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveStatusConditions, getActiveBodyFunctions, getFeatureOption, getHealingRules, isAnatomyEnabled, isBodyInjuryEnabled } from "../core/config.js";
import { healBlockFactor } from "../core/magic-rules.js";
import { implantFits, legacyFunctionsFor, partDamage, partHealing, pickHitPart, healCap, partHealable } from "./anatomy-rules.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { createGrantedSkill, removeGrantedSkill } from "../skills/skill-economy.js";
import { createActiveEffects } from "../helpers/foundry-compat.js";

const INJURY_FLAG = "bodyInjury";

/* ------------------------------------------------------------------ implantes */

/**
 * Instala um Item (com `implant.enabled`) numa Parte do Corpo. Confere o encaixe (`fitsSlots`),
 * acrescenta a modificação (com o Item guardado para voltar), faz da parte uma prótese quando é
 * prótese, concede a Habilidade do Item e tira 1 do inventário (se o Item era desta ficha).
 * @returns {Promise<boolean>}
 */
export async function installImplant(actor, partId, item) {
  const part = actor.items.get(partId);
  const implant = item?.system?.implant;
  if (!part || part.type !== "body_part" || !implant?.enabled) return false;
  if (!implantFits(implant, part.system.slot)) {
    ui.notifications.warn(`${item.name} não cabe em ${part.name}: só em ${implant.fitsSlots.join(", ")}.`);
    return false;
  }
  const isProsthesis = implant.kind === "prosthesis";
  if (isProsthesis && (part.system.installedMods ?? []).some(m => m.kind === "prosthesis")) {
    ui.notifications.warn(`${part.name} já tem uma prótese. Remova a atual antes.`);
    return false;
  }
  const sourceItem = item.toObject();
  delete sourceItem._id;
  sourceItem.system.quantity = 1;
  const mods = foundry.utils.deepClone(part.system.installedMods ?? []);
  mods.push({
    name: item.name,
    description: item.system.description ?? "",
    grantsSkill: foundry.utils.deepClone(item.system.grantsSkill ?? {}),
    skillGranted: false,
    statModifiers: foundry.utils.deepClone(item.system.statModifiers ?? { hp: 0, energy: 0 }),
    attributeBonuses: foundry.utils.deepClone(item.system.attributeBonuses ?? []),
    kind: isProsthesis ? "prosthesis" : "implant",
    magic: Boolean(item.system.magic),
    location: implant.location ?? "",
    functions: [...(implant.functions ?? [])],
    sourceItem,
    naturalHpMax: isProsthesis ? part.system._source?.hp?.max ?? part.system.hp.max : null,
    naturalHpPercent: isProsthesis ? Number(part.system.hpPercent) || 0 : null,
    naturalIntegrity: isProsthesis ? Number(part.system.integrity ?? 1) : null
  });
  const index = mods.length - 1;
  if (item.system.grantsSkill?.name) {
    const created = await createGrantedSkill(actor, item.system.grantsSkill, `${part.id}:${index}`);
    if (created) mods[index].skillGranted = true;
  }
  const update = { "system.installedMods": mods };
  if (isProsthesis) {
    // Prótese nova chega inteira. Vida em % do portador (padrão) ou fixa (perna de pau).
    const percent = implant.hpMode === "fixed" ? 0 : Number(implant.hp) || 0;
    Object.assign(update, { "system.isProsthetic": true, "system.hpPercent": percent, "system.integrity": 1 });
    if (!percent) Object.assign(update, { "system.hp.max": implant.hp, "system.hp.value": implant.hp });
  }
  await part.update(update);

  // Saiu do inventário desta ficha (de outro lugar — Diretório, Compêndio — é uma cópia).
  if (item.parent?.uuid === actor.uuid) {
    const quantity = Number(item.system.quantity) || 1;
    if (quantity > 1) await item.update({ "system.quantity": quantity - 1 });
    else await item.delete();
  }
  ui.notifications.info(`${item.name} instalado em ${part.name}.`);
  return true;
}

/** Remove a modificação `index` da parte: o Item volta ao inventário; prótese devolve a parte natural. */
export async function uninstallImplant(actor, partId, index) {
  const part = actor.items.get(partId);
  if (!part) return false;
  const mods = foundry.utils.deepClone(part.system.installedMods ?? []);
  const mod = mods[index];
  if (!mod) return false;
  if (mod.skillGranted) await removeGrantedSkill(actor, `${part.id}:${index}`);
  mods.splice(index, 1);
  const update = { "system.installedMods": mods };
  if (mod.kind === "prosthesis") {
    // A parte natural volta como estava antes da prótese (um coto perdido continua perdido).
    const natural = Number(mod.naturalHpMax) || part.system.hp.max;
    const percent = Number(mod.naturalHpPercent) || 0;
    Object.assign(update, { "system.isProsthetic": false, "system.hpPercent": percent, "system.integrity": Number(mod.naturalIntegrity ?? 1) });
    if (!percent) Object.assign(update, { "system.hp.max": natural, "system.hp.value": Math.min(part.system.hp.value, natural) });
  }
  await part.update(update);
  if (mod.sourceItem) await actor.createEmbeddedDocuments("Item", [mod.sourceItem]);
  return true;
}

/* ------------------------------------------------------------------ Condições do corpo */

/**
 * Deixa os Active Effects "do corpo" iguais ao estado atual: cria a Condição de cada Função
 * perdida, atualiza a contagem ("Sem mão (2)") e apaga as que voltaram. Só o Mestre designado.
 */
export async function syncBodyInjuryEffects(actor) {
  if (!actor || actor.type !== "character" || !isDesignatedGm()) return;
  const state = isBodyInjuryEnabled() && isAnatomyEnabled() ? actor.system.bodyState : null;
  const wanted = new Map((state?.conditions ?? []).map(c => [c.functionId, c]));
  const existing = actor.effects.filter(e => e.getFlag(SYSTEM_ID, INJURY_FLAG));
  const catalog = getActiveStatusConditions();

  const remove = existing.filter(e => !wanted.has(e.getFlag(SYSTEM_ID, INJURY_FLAG))).map(e => e.id);
  if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);

  const create = [];
  for (const [functionId, c] of wanted) {
    const condition = catalog.find(x => x.id === c.conditionId);
    const name = `${condition?.label ?? c.conditionId}${c.count > 1 ? ` (${c.count})` : ""}`;
    const current = existing.find(e => e.getFlag(SYSTEM_ID, INJURY_FLAG) === functionId);
    if (current) {
      if (current.name !== name) await current.update({ name });
      continue;
    }
    create.push({
      name,
      img: condition?.icon || "icons/svg/bones.svg",
      statuses: [c.conditionId],
      flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: c.conditionId, [INJURY_FLAG]: functionId } }
    });
  }
  if (create.length) await createActiveEffects(actor, create);
}

/* ------------------------------------------------------------------ dano e cura nas partes */

/** Estado das partes, no formato das regras puras. */
export function partsSnapshot(actor) {
  return actor.items
    .filter(i => i.type === "body_part")
    .map(i => ({ id: i.id, name: i.name, max: i.system.hp.max, value: i.system.hp.value, state: i.system.status, isProsthetic: Boolean(i.system.isProsthetic), lost: i.system.status === "lost" }));
}

/**
 * Escrita de Vida numa parte. Vida em %: grava a proporção (o máximo é calculado); Vida fixa: o valor.
 * @param {Item} part
 * @param {number} value
 * @param {{lost?: boolean}} [extra]
 */
export function partWrite(part, value, { lost } = {}) {
  const update = { _id: part.id };
  if (Number(part.system.hpPercent) > 0) {
    const max = Number(part.system.hp.max) || 0;
    update["system.integrity"] = max > 0 ? Math.min(1, Math.max(0, value / max)) : 1;
  } else {
    update["system.hp.value"] = Math.max(0, Math.round(value));
  }
  if (lost !== undefined) update["system.lost"] = Boolean(lost);
  return update;
}

/** O que guardar para Desfazer exatamente (proporção ou valor, e se estava perdida). */
function partBefore(part) {
  return { id: part.id, hpValue: part.system._source?.hp?.value ?? part.system.hp.value, integrity: part.system.integrity ?? 1, lost: Boolean(part.system.lost) };
}

/**
 * Bloqueios de cura ativos no Ator ("Impede cura" das Condições — Fogo/Ácido, Maldições): o que
 * bloqueiam (`kinds`: "regen" | "all"), onde (`scope`: "body" | "part" + `partId`) e o nível de quem
 * aplicou (`sourceLevel` do efeito; marcado à mão = 0). A antiga marca `blocksRegeneration` e a flag
 * `regenBlocked` (catálogo salvo sem a Condição) valem como "só Regeneração, corpo todo".
 * @returns {Array<{level:number, kinds:string, scope:string, partId:string|null, name:string}>}
 */
export function actorHealBlocks(actor) {
  const catalog = new Map(getActiveStatusConditions().map(c => [c.id, c]));
  const out = [];
  for (const e of actor?.effects ?? []) {
    if (e.disabled) continue;
    const flags = e.flags?.[SYSTEM_ID] ?? {};
    const condition = catalog.get(flags.conditionId) ?? [...(e.statuses ?? [])].map(id => catalog.get(id)).find(Boolean);
    const mark = condition?.healBlock ?? (condition?.blocksRegeneration || flags.regenBlocked ? { kinds: "regen", scope: "body" } : flags.healBlock ?? null);
    if (!mark) continue;
    const partId = mark.scope === "part" ? flags.healBlockPartId || null : null;
    out.push({ level: Number(flags.sourceLevel) || 0, kinds: mark.kinds === "all" ? "all" : "regen", scope: partId ? "part" : "body", partId, name: e.name });
  }
  return out;
}

/** Alguma cura bloqueada (para a faixa da aba Anatomia)? */
export function isRegenerationBlocked(actor) {
  return actorHealBlocks(actor).length > 0;
}

/**
 * Plano de uma cura neste Ator: quanto passa no corpo (`bodyFactor`, bloqueios do corpo todo
 * contra o nível da cura), quanto passa em cada parte (`partFactor`, bloqueios presos na parte),
 * se refaz perdida (Cura de nível alto) e até onde a Vida vai (`cap`). Sem Ferimentos por parte, só
 * o fator do corpo vale.
 * @param {{kind?:string, level?:number, repairsProsthesis?:boolean}} heal
 */
export function healPlan(actor, { kind = "cura", level = 0, repairsProsthesis = false } = {}) {
  const rules = getHealingRules();
  const blocks = actorHealBlocks(actor);
  const bodyFactor = healBlockFactor(blocks.filter(b => b.scope === "body"), level, kind, rules.zeroMultiplier);
  const partFactor = {};
  for (const b of blocks.filter(b => b.scope === "part")) {
    const f = healBlockFactor([b], level, kind, rules.zeroMultiplier);
    partFactor[b.partId] = Math.min(partFactor[b.partId] ?? 1, f);
  }
  const regrowLost = kind === "cura" && level >= rules.cureRegrowLevel;
  const injury = actor?.type === "character" && isBodyInjuryEnabled() && isAnatomyEnabled();
  const cap = injury ? healCap(partsSnapshot(actor), actor.system.attributes?.hp?.max ?? 0, kind, { repairsProsthesis, regrowLost, partFactor }) : 1;
  return { bodyFactor, partFactor, regrowLost, cap, injury };
}

/**
 * Dano que chegou na Vida também cai numa parte (Ferimentos por parte): a mirada (`partId`) ou uma
 * sorteada pelo tamanho. Vira Perdida pela sobra (opção do bloco) ou pelo Decepar. Só o Mestre
 * chama (o Aplicar do chat). Devolve o que mudou, com o estado anterior para Desfazer.
 * @returns {Promise<null|{id:string, name:string, from:number, to:number, max:number, lost:boolean, before:object}>}
 */
export async function damageBodyPart(actor, amount, { partId = null, sever = false } = {}) {
  if (!actor || actor.type !== "character" || !isBodyInjuryEnabled() || !isAnatomyEnabled()) return null;
  if (!(amount > 0)) return null;
  const snapshot = partsSnapshot(actor);
  const aimed = partId ? snapshot.find(p => p.id === partId && p.state !== "lost") : null;
  const id = aimed?.id ?? pickHitPart(snapshot);
  const part = id ? actor.items.get(id) : null;
  if (!part) return null;
  const before = partBefore(part);
  const wasLost = part.system.status === "lost";
  const result = partDamage(
    { value: part.system.hp.value, max: part.system.hp.max, isProsthetic: part.system.isProsthetic, lost: wasLost },
    amount,
    { lossOverflow: getFeatureOption("bodyPartInjury", "partLossOverflow") ?? 50, sever }
  );
  await actor.updateEmbeddedDocuments("Item", [partWrite(part, result.value, { lost: result.lost })]);
  return { id: part.id, name: part.name, from: part.system.hp.value, to: result.value, max: part.system.hp.max, lost: result.lost && !wasLost, before };
}

/**
 * "Mirar numa parte?" — ao atacar um Personagem com alvo único (igual ao "Mirar num sistema" das
 * Naves). Devolve `{id, name}` ou `null` (o Aplicar sorteia a parte). Desligável nas opções do
 * bloco Ferimentos por parte; fechar = não mirar.
 */
export async function promptTargetBodyPart(targetActor) {
  if (targetActor?.type !== "character" || !isBodyInjuryEnabled() || !isAnatomyEnabled()) return null;
  if (!getFeatureOption("bodyPartInjury", "aimBodyPart")) return null;
  const parts = partsSnapshot(targetActor).filter(p => p.state !== "lost");
  if (!parts.length) return null;
  const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
  const options = parts.map(p => `<option value="${p.id}">${esc(p.name)} (${p.value}/${p.max})</option>`).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    window: { title: `Mirar numa parte — ${targetActor.name}` },
    classes: ["nihility-target-module-dialog"],
    content: `
      <div class="nihility-target-module">
        <p>O dano que chegar na Vida também cai na parte escolhida. Sem mirar, cai numa parte sorteada (as maiores têm mais chance).</p>
        <select name="targetPart"><option value="">Nenhuma · golpe no corpo</option>${options}</select>
      </div>`,
    buttons: [
      { action: "aim", label: "Confirmar", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="targetPart"]').value || "" },
      { action: "cancel", label: "Sem mirar", callback: () => "" }
    ],
    rejectClose: false
  });
  const part = typeof chosen === "string" && chosen ? parts.find(p => p.id === chosen) : null;
  return part ? { id: part.id, name: part.name } : null;
}

/**
 * "Focar a cura numa parte?" — ao usar uma Skill de cura (Periódico de Vida positivo) num
 * Personagem com partes que ela conserta. Devolve `{id, name}` ou `null` (cura proporcional).
 */
export async function promptHealFocus(targetActor, mech) {
  const heal = (mech?.effects ?? []).find(e => e?.target === "hp" && e.periodic && Number(e.amount) > 0);
  if (!heal) return null;
  const parts = healableParts(targetActor, heal.healKind || "cura", { repairsProsthesis: heal.healKind === "regeneracao" && ["unique", "ultimate"].includes(mech.tier), level: Number(mech.level) || 0 });
  if (!parts.length) return null;
  const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
  const pct = p => (p.state === "lost" ? "perdida" : `${p.max > 0 ? Math.round((p.value / p.max) * 100) : 0}%`);
  const options = parts.map(p => `<option value="${p.id}">${esc(p.name)} (${pct(p)})</option>`).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    window: { title: `Focar a cura — ${targetActor.name}` },
    classes: ["nihility-target-module-dialog"],
    content: `
      <div class="nihility-target-module">
        <p>A Vida que esta cura devolver vai para as partes feridas: a escolhida enche primeiro, o resto vai proporcional ao que falta em cada uma.</p>
        <select name="focusPart"><option value="">Nenhuma · proporcional</option>${options}</select>
      </div>`,
    buttons: [
      { action: "focus", label: "Confirmar", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="focusPart"]').value || "" },
      { action: "cancel", label: "Sem foco", callback: () => "" }
    ],
    rejectClose: false
  });
  const part = typeof chosen === "string" && chosen ? parts.find(p => p.id === chosen) : null;
  return part ? { id: part.id, name: part.name } : null;
}

/** Desfaz o que `damageBodyPart` fez (estado exato de antes). */
export async function restoreBodyPart(actor, before) {
  const part = before?.id ? actor?.items.get(before.id) : null;
  if (!part) return;
  const update = { _id: part.id, "system.lost": Boolean(before.lost) };
  if (Number(part.system.hpPercent) > 0) update["system.integrity"] = Number(before.integrity ?? 1);
  else update["system.hp.value"] = Number(before.hpValue) || 0;
  await actor.updateEmbeddedDocuments("Item", [update]);
}

/**
 * Até onde uma cura deste tipo leva a Vida (fração da máxima): parte a 0% que ela não conserta
 * bloqueia o % dela (ver healCap). 1 sem Ferimentos por parte.
 */
export function bodyHealCap(actor, kind = "cura", { repairsProsthesis = false, level = 0 } = {}) {
  if (!actor || actor.type !== "character" || !isBodyInjuryEnabled() || !isAnatomyEnabled()) return 1;
  return healPlan(actor, { kind, level, repairsProsthesis }).cap;
}

/** Partes que esta cura consegue consertar agora (para o "Focar a cura numa parte?"). */
export function healableParts(actor, kind = "cura", { repairsProsthesis = false, level = 0 } = {}) {
  if (!actor || actor.type !== "character" || !isBodyInjuryEnabled() || !isAnatomyEnabled()) return [];
  const plan = healPlan(actor, { kind, level, repairsProsthesis });
  return partsSnapshot(actor).filter(p => partHealable(p, kind, { repairsProsthesis, regrowLost: plan.regrowLost, partFactor: plan.partFactor }));
}

/**
 * Cura nas partes: o que a Vida DE FATO subiu (`pool`) é repartido entre as partes que este tipo
 * conserta — a focada primeiro, o resto proporcional ao que falta (ver partHealing). Regeneração
 * bloqueada não faz nada.
 * @returns {Promise<string>} resumo curto para o chat ("" quando nada mudou)
 */
export async function healBodyParts(actor, pool, { kind = "cura", repairsProsthesis = false, focusPartId = null, level = 0 } = {}) {
  if (!actor || actor.type !== "character" || !isBodyInjuryEnabled() || !isAnatomyEnabled()) return "";
  if (!(pool > 0)) return "";
  const plan = healPlan(actor, { kind, level, repairsProsthesis });
  const healed = partHealing(partsSnapshot(actor), pool, { kind, repairsProsthesis, focusId: focusPartId, regrowLost: plan.regrowLost, partFactor: plan.partFactor });
  if (!healed.length) return "";
  await actor.updateEmbeddedDocuments(
    "Item",
    healed.map(h => partWrite(actor.items.get(h.id), h.value, { lost: false }))
  );
  const regrown = healed.filter(h => h.regrow).map(h => actor.items.get(h.id)?.name).filter(Boolean);
  return regrown.length ? `${regrown.join(", ")} voltando a crescer` : `${healed.length} parte(s) recuperada(s)`;
}

/** Mestre marca/desmarca uma parte como Perdida (decepada) à mão. */
export async function setBodyPartLost(actor, partId, lost) {
  const part = actor?.items.get(partId);
  if (!part || part.type !== "body_part") return;
  const update = { ...(lost ? partWrite(part, 0) : {}), _id: part.id, "system.lost": Boolean(lost) };
  await actor.updateEmbeddedDocuments("Item", [update]);
}

const pending = new Map();
function scheduleSync(actor) {
  if (!actor || !isDesignatedGm()) return;
  const key = actor.uuid;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    syncBodyInjuryEffects(actor).catch(err => console.error(`${SYSTEM_ID} | Falha ao atualizar as Condições do corpo.`, err));
  }, 150));
}

/** Liga os hooks (no `ready`). */
export function registerAnatomyHooks() {
  const onPart = item => {
    if (item?.type === "body_part" && item.parent) scheduleSync(item.parent);
  };
  Hooks.on("createItem", onPart);
  Hooks.on("deleteItem", onPart);
  Hooks.on("preUpdateItem", (item, changes, options) => {
    if (item.type === "body_part") options.nihilityPrevHp = item.system.hp.value;
  });
  Hooks.on("updateItem", (item, changes, options) => {
    onPart(item);
    // Parte vital chegou a 0: aviso ao Mestre (o sistema não mata ninguém sozinho).
    if (item.type !== "body_part" || !isBodyInjuryEnabled() || !isDesignatedGm()) return;
    // Vida fixa grava `hp.value`; Vida em % grava a proporção; Perdida zera de qualquer jeito.
    const lostNow = foundry.utils.getProperty(changes, "system.lost") === true;
    const newHp = lostNow ? 0 : foundry.utils.getProperty(changes, "system.hp.value") ?? foundry.utils.getProperty(changes, "system.integrity");
    if (newHp === undefined || newHp > 0 || !(options.nihilityPrevHp > 0)) return;
    const vital = getActiveBodyFunctions().filter(f => f.effect?.kind === "notify").map(f => f.id);
    const functions = item.system.functions?.length ? item.system.functions : [];
    if (!functions.some(f => vital.includes(f))) return;
    ChatMessage.create({
      content: `<p><strong>${foundry.utils.escapeHTML(item.parent.name)}</strong>: ${foundry.utils.escapeHTML(item.name)} (vital) foi ${lostNow ? "perdida" : "inutilizada"}. O Mestre decide o que isso significa.</p>`,
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      speaker: ChatMessage.getSpeaker({ actor: item.parent })
    });
  });
  // Ligar/desligar o bloco, ou mudar algo da ficha que mexe no corpo, também reavalia.
  Hooks.on("updateActor", actor => {
    if (actor.type === "character") scheduleSync(actor);
  });
}

/* ------------------------------------------------------------------ arrastar implante (destaque) */

let draggedImplant = null;

/** Guarda o implante que está sendo arrastado (de qualquer janela) para destacar onde ele cabe. */
export function registerImplantDragTracking() {
  document.addEventListener("dragstart", event => {
    draggedImplant = null;
    try {
      const data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
      if (data?.type !== "Item" || !data.uuid) return;
      const item = fromUuidSync(data.uuid);
      if (item?.system?.implant?.enabled) draggedImplant = { name: item.name, fitsSlots: item.system.implant.fitsSlots ?? [] };
    } catch (err) {
      draggedImplant = null;
    }
  });
  document.addEventListener("dragend", () => {
    draggedImplant = null;
  });
}

/** O que está sendo arrastado agora (ou null). */
export function currentDraggedImplant() {
  return draggedImplant;
}

/* ------------------------------------------------------------------ aba Anatomia */

/** Dados da aba Anatomia (board 5): partes com Vida, Funções (riscadas quando perdidas) e implantes. */
export function anatomyContext(actor) {
  const injury = isBodyInjuryEnabled();
  const catalog = getActiveBodyFunctions();
  const label = id => catalog.find(f => f.id === id)?.label ?? id;
  const state = actor.system.bodyState;
  const conditions = getActiveStatusConditions();
  const parts = actor.items
    .filter(i => i.type === "body_part")
    .map(part => {
      const sys = part.system;
      const mods = sys.installedMods ?? [];
      const prosthesis = mods.find(m => m.kind === "prosthesis");
      // Parte de antes do rework (sem Funções salvas): as do slot, igual à preparação da ficha.
      const natural = sys.functions?.length
        ? sys.functions
        : legacyFunctionsFor(["torso", "core", "head"].includes(sys.slot) ? ["vital", "limb"] : ["limb"], sys.slot, catalog.map(f => f.id));
      const own = sys.isProsthetic && prosthesis?.functions?.length ? prosthesis.functions : natural;
      const implantFns = mods.filter(m => m.kind !== "prosthesis").flatMap(m => m.functions ?? []);
      const lost = (Number(sys.hp.value) || 0) <= 0;
      const state = sys.status ?? (lost ? "destroyed" : "intact");
      return {
        id: part.id,
        name: part.name,
        slot: sys.slot,
        hpValue: sys.hp.value,
        hpMax: sys.hp.max,
        hpPct: sys.hp.max > 0 ? Math.round((sys.hp.value / sys.hp.max) * 100) : 0,
        hpPercent: Number(sys.hpPercent) || 0,
        state,
        stateLabel: MEU_SISTEMA.BODY_PART_STATUS_LABELS[state] ?? state,
        isLost: state === "lost",
        showState: injury && state !== "intact",
        // Quem conserta (prancha 5): prótese só com Reparo; parte inutilizada com Cura.
        fixHint: injury && state !== "intact" && state !== "lost" ? (sys.isProsthetic ? "conserta: Reparo" : state === "destroyed" ? "Cura recupera" : "") : "",
        destroyed: lost,
        prosthetic: Boolean(sys.isProsthetic),
        functions: [...new Set([...own, ...implantFns])].map(id => ({ id, label: label(id), off: injury && lost })),
        implants: mods.map((m, index) => ({ index, name: m.name || "Modificação", prosthesis: m.kind === "prosthesis", location: m.location || "", removable: Boolean(m.sourceItem) }))
      };
    });
  const banner = [];
  if (state) {
    for (const c of state.conditions) banner.push(`${conditions.find(x => x.id === c.conditionId)?.label ?? c.conditionId}${c.count > 1 ? ` (${c.count})` : ""}`);
    if (actor.system.movement?.injuredFrom !== undefined) {
      banner.push(state.movement.crawl !== null ? `arrastando: ${actor.system.movement.total} m por rodada` : `Deslocamento ${actor.system.movement.injuredFrom} → ${actor.system.movement.total} m`);
    }
    for (const t of state.removedTraits) banner.push(`sem o Traço ${t}`);
  }
  const blocks = injury ? actorHealBlocks(actor) : [];
  for (const b of blocks) banner.push(`${b.kinds === "all" ? "cura bloqueada" : "regeneração bloqueada"} (nv ${b.level}${b.partId ? ` · ${actor.items.get(b.partId)?.name ?? "parte"}` : ""})`);
  const regenBlocked = blocks.length > 0;
  return { injury, parts, banner, regenBlocked };
}
