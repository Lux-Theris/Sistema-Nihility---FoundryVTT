/**
 * Pontos de restauração de ficha (H13): o Mestre guarda a ficha inteira (`actor.toObject()`: Itens,
 * efeitos, flags) e a devolve depois, com os MESMOS ids. Regras puras em actor-snapshot-rules.js.
 *
 *  - Guardado num compêndio de mundo oculto (JournalEntry, só flags, como world-backup.js), criado
 *    na primeira vez pelo Mestre. Um registro por ponto: `restorePoint` (o resumo, o que a lista lê)
 *    e `restoreData` (a ficha). **10 por ficha**: o mais antigo sai.
 *  - Token não vinculado guarda o Ator do próprio Token (o sintético).
 *  - Automático **antes** de: Evolução e Fusão de Skill, troca/Evolução de Espécie e Herança, Level
 *    Up, Liberar personagem e Zerar pontos (`autoSnapshot`, só o Mestre; nunca falha o que chamou).
 *  - Restaurar: salva um ponto "Antes de restaurar" (dá para voltar), apaga Itens/efeitos que não
 *    estavam no ponto, recria os que faltam (`keepId`) e reescreve os que existem; depois nome,
 *    imagem, dados de sistema e flags do sistema. A posição do Token não volta. Âncoras e escudos
 *    mantidos em outros Atores (uuids de Itens) continuam valendo porque os ids são os mesmos; o
 *    Desfazer de um uso ou de um card de dano anterior fica sem sentido (o aviso diz isso).
 */
import { SYSTEM_ID } from "../core/config.js";
import { compendiumCollectionClass, deleteKeyUpdate } from "../helpers/foundry-compat.js";
import { reportError } from "../helpers/report.js";
import { MAX_SNAPSHOTS, snapshotsToPrune, snapshotsForActor, embeddedPlan, actorRestoreUpdate, itemRestoreData, snapshotLabel, snapshotSummary } from "./actor-snapshot-rules.js";

const PACK_KEY = `${SYSTEM_ID}-restore-points`;
const INDEX_FIELD = `flags.${SYSTEM_ID}.restorePoint`;

/** O compêndio dos pontos; o Mestre o cria na primeira vez (`create`). */
async function restorePack({ create = false } = {}) {
  const collectionId = `world.${PACK_KEY}`;
  const pack = game.packs.get(collectionId);
  if (pack) return pack;
  if (!create || !game.user.isGM) return null;
  return compendiumCollectionClass().createCompendium({
    type: "JournalEntry",
    label: "Nihility — Pontos de restauração de fichas",
    name: PACK_KEY,
    package: "world"
  });
}

/** Os resumos dos pontos de uma ficha (mais novo primeiro), sem carregar os dados. */
export async function listSnapshots(actor) {
  const pack = await restorePack();
  if (!pack || !actor) return [];
  const index = await pack.getIndex({ fields: [INDEX_FIELD] });
  const entries = index
    .map(e => ({ id: e._id, ...(e.flags?.[SYSTEM_ID]?.restorePoint ?? {}) }))
    .filter(e => e.actorUuid);
  return snapshotsForActor(entries, actor.uuid);
}

/**
 * Guarda o estado atual da ficha. Só o Mestre. Devolve o id do ponto, ou null.
 * @param {Actor} actor
 * @param {string} reason - "Antes de evoluir Bola de Fogo", "Salvo à mão"…
 * @param {{auto?:boolean}} [options]
 */
export async function saveSnapshot(actor, reason, { auto = false } = {}) {
  if (!game.user.isGM || !actor) return null;
  const pack = await restorePack({ create: true });
  if (!pack) return null;
  const data = actor.toObject();
  const entry = {
    actorUuid: actor.uuid,
    actorName: actor.name,
    reason: String(reason || "Estado salvo"),
    when: new Date().toISOString(),
    userId: game.user.id,
    auto: Boolean(auto),
    summary: snapshotSummary(data)
  };
  const doc = await JournalEntry.create(
    { name: `${actor.name} — ${entry.reason}`, flags: { [SYSTEM_ID]: { restorePoint: entry, restoreData: data } } },
    { pack: pack.collection }
  );
  // Só os 10 mais novos de cada ficha.
  const all = await listSnapshots(actor);
  const drop = snapshotsToPrune(all, MAX_SNAPSHOTS);
  for (const id of drop) await (await pack.getDocument(id))?.delete();
  return doc?.id ?? null;
}

/**
 * Ponto automático ANTES de uma mudança grande (Skill evoluída/fundida, Espécie, Herança, Level Up,
 * Liberar, Zerar pontos). Só o Mestre guarda; nunca lança — uma falha aqui não pode impedir a
 * mudança que o Mestre pediu.
 */
export async function autoSnapshot(actor, reason) {
  if (!game.user?.isGM || !actor) return null;
  try {
    return await saveSnapshot(actor, reason, { auto: true });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Ponto de restauração automático falhou (${reason}).`, err);
    return null;
  }
}

/** Apaga um ponto. Só o Mestre. */
export async function deleteSnapshot(id) {
  if (!game.user.isGM) return;
  const pack = await restorePack();
  await (await pack?.getDocument(id))?.delete();
}

/** Tira de `ids` o que a ficha não tem mais (um Item apagado levou o concedido junto). */
const stillThere = (collection, ids) => ids.filter(id => collection.has(id));

/** Os documentos embutidos do ponto, sem carimbos que não se reescrevem. */
const withoutStats = doc => {
  const { _stats, ...rest } = doc;
  return rest;
};

/**
 * Devolve a ficha ao ponto `id`. Antes, guarda um ponto "Antes de restaurar" (dá para voltar). Só o
 * Mestre. Efeitos primeiro, Itens depois (os estados Ativos dos Itens por último) e a ficha no fim.
 * @returns {Promise<boolean>}
 */
export async function restoreSnapshot(actor, id) {
  if (!game.user.isGM || !actor) return false;
  const pack = await restorePack();
  const doc = await pack?.getDocument(id);
  const data = doc?.getFlag(SYSTEM_ID, "restoreData");
  const meta = doc?.getFlag(SYSTEM_ID, "restorePoint");
  if (!data || meta?.actorUuid !== actor.uuid) {
    ui.notifications.error("Esse ponto de restauração não é desta ficha ou está vazio.");
    return false;
  }
  await saveSnapshot(actor, `Antes de restaurar "${meta.reason}"`, { auto: true });

  try {
    // Efeitos.
    const effects = embeddedPlan(actor.effects.map(e => e.id), data.effects);
    const goneEffects = stillThere(actor.effects, effects.remove);
    if (goneEffects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", goneEffects, { nihilityRestore: true });
    if (effects.create.length) await actor.createEmbeddedDocuments("ActiveEffect", effects.create.map(withoutStats), { keepId: true, nihilityConfigured: true, nihilityRestore: true });
    if (effects.update.length) await actor.updateEmbeddedDocuments("ActiveEffect", effects.update.map(withoutStats), { recursive: false, diff: false, nihilityRestore: true });

    // Itens.
    const items = embeddedPlan(actor.items.map(i => i.id), data.items);
    const goneItems = stillThere(actor.items, items.remove);
    if (goneItems.length) await actor.deleteEmbeddedDocuments("Item", goneItems, { nihilityRestore: true });
    if (items.create.length) await actor.createEmbeddedDocuments("Item", items.create.map(withoutStats), { keepId: true, nihilityRestore: true });
    if (items.update.length) await actor.updateEmbeddedDocuments("Item", items.update.map(d => itemRestoreData(withoutStats(d), actor.items.get(d._id)?.toObject(), SYSTEM_ID)), { recursive: false, diff: false, nihilityRestore: true });

    // A ficha: nome, imagem, dados de sistema e os flags do sistema (chave que sobrou sai).
    const { update, removeFlagKeys } = actorRestoreUpdate(data, actor.toObject(), SYSTEM_ID);
    for (const key of removeFlagKeys) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${key}`));
    await actor.update(update, { nihilityRestore: true });
  } catch (err) {
    reportError(`Restaurar ${actor.name}: falhou no meio. O ponto "Antes de restaurar" guarda como a ficha estava.`, err);
    return false;
  }

  await ChatMessage.create({
    content: `<p><i class="fa-solid fa-clock-rotate-left"></i> <strong>${foundry.utils.escapeHTML(actor.name)}</strong> foi restaurada para "${foundry.utils.escapeHTML(meta.reason)}" (${foundry.utils.escapeHTML(snapshotLabel(meta))}). Cards de uso ou de dano anteriores a este ponto não servem mais para Desfazer.</p>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
  return true;
}

/* ------------------------------------------------------------------ Janela */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RestorePointsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-restore-points"],
    window: { title: "Pontos de restauração", icon: "fa-solid fa-clock-rotate-left", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      saveNow: RestorePointsApp.#onSaveNow,
      restore: RestorePointsApp.#onRestore,
      remove: RestorePointsApp.#onRemove
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/restore-points.hbs`, scrollable: [".rp-body"] }
  };

  constructor(actor, options = {}) {
    super({ id: `nihility-restore-points-${actor.uuid.replace(/\./g, "-")}`, ...options });
    this.actor = actor;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = await listSnapshots(this.actor);
    return Object.assign(context, {
      actorName: this.actor.name,
      max: MAX_SNAPSHOTS,
      points: list.map(e => ({ id: e.id, label: snapshotLabel(e), summary: e.summary ?? "", auto: Boolean(e.auto) }))
    });
  }

  static async #onSaveNow() {
    await saveSnapshot(this.actor, "Salvo à mão");
    ui.notifications.info(`Estado de ${this.actor.name} salvo.`);
    this.render();
  }

  static async #onRestore(event, target) {
    const id = target.dataset.id;
    const point = (await listSnapshots(this.actor)).find(e => e.id === id);
    if (!point) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Restaurar a ficha" },
      content: `<p>Devolver <strong>${foundry.utils.escapeHTML(this.actor.name)}</strong> ao ponto <strong>${foundry.utils.escapeHTML(snapshotLabel(point))}</strong>? Itens, efeitos, Skills, XP, pontos e flags voltam ao que eram; o que foi criado depois some. O estado de agora é guardado antes ("Antes de restaurar"), então dá para voltar. A posição do Token não muda.</p>`
    });
    if (!ok) return;
    if (await restoreSnapshot(this.actor, id)) ui.notifications.info(`${this.actor.name} restaurada.`);
    this.render();
  }

  static async #onRemove(event, target) {
    await deleteSnapshot(target.dataset.id);
    this.render();
  }
}

/** Abre a lista de pontos da ficha (só o Mestre). */
export function openRestorePoints(actor) {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre mexe nos pontos de restauração.");
  if (!actor) return ui.notifications.warn("Ficha não encontrada.");
  const existing = foundry.applications.instances.get(`nihility-restore-points-${actor.uuid.replace(/\./g, "-")}`);
  if (existing) return existing.render({ force: true });
  return new RestorePointsApp(actor).render({ force: true });
}
