/**
 * Anatomia com mecânica (board 5) — o lado Foundry: instalar/remover implante (o Item arrastado
 * para a Parte vira uma modificação dela e volta ao inventário ao sair), as Condições que as partes
 * perdidas causam (Mestre designado mantém em dia), o aviso de parte vital e a regeneração por
 * rodada. A conta é pura (anatomy-rules.js) e o estado do corpo sai da preparação da ficha
 * (`system.bodyState`, ver deriveBodyState em character-model.js).
 */
import { SYSTEM_ID, getActiveStatusConditions, getActiveBodyFunctions, isAnatomyEnabled, isBodyInjuryEnabled } from "../core/config.js";
import { implantFits, legacyFunctionsFor } from "./anatomy-rules.js";
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
    location: implant.location ?? "",
    functions: [...(implant.functions ?? [])],
    sourceItem,
    naturalHpMax: isProsthesis ? part.system.hp.max : null
  });
  const index = mods.length - 1;
  if (item.system.grantsSkill?.name) {
    const created = await createGrantedSkill(actor, item.system.grantsSkill, `${part.id}:${index}`);
    if (created) mods[index].skillGranted = true;
  }
  const update = { "system.installedMods": mods };
  if (isProsthesis) Object.assign(update, { "system.isProsthetic": true, "system.hp.max": implant.hp, "system.hp.value": implant.hp });
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
    const natural = Number(mod.naturalHpMax) || part.system.hp.max;
    Object.assign(update, { "system.isProsthetic": false, "system.hp.max": natural, "system.hp.value": Math.min(part.system.hp.value, natural) });
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

/** Cura por rodada das partes com Função "regenerativa" (início do turno, Mestre). */
export async function tickBodyRegeneration(actor) {
  if (!actor || !isBodyInjuryEnabled() || !isDesignatedGm()) return;
  const regen = actor.system.bodyState?.regen ?? [];
  if (!regen.length) return;
  await actor.updateEmbeddedDocuments(
    "Item",
    regen.map(r => {
      const part = actor.items.get(r.id);
      return { _id: r.id, "system.hp.value": Math.min(part.system.hp.max, part.system.hp.value + r.amount) };
    })
  );
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
    const newHp = foundry.utils.getProperty(changes, "system.hp.value");
    if (newHp === undefined || newHp > 0 || !(options.nihilityPrevHp > 0)) return;
    const vital = getActiveBodyFunctions().filter(f => f.effect?.kind === "notify").map(f => f.id);
    const functions = item.system.functions?.length ? item.system.functions : [];
    if (!functions.some(f => vital.includes(f))) return;
    ChatMessage.create({
      content: `<p><strong>${foundry.utils.escapeHTML(item.parent.name)}</strong>: ${foundry.utils.escapeHTML(item.name)} (vital) foi destruída. O Mestre decide o que isso significa.</p>`,
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
      return {
        id: part.id,
        name: part.name,
        slot: sys.slot,
        hpValue: sys.hp.value,
        hpMax: sys.hp.max,
        hpPct: sys.hp.max > 0 ? Math.round((sys.hp.value / sys.hp.max) * 100) : 0,
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
  return { injury, parts, banner };
}
