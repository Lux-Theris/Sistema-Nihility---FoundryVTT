/**
 * Log de "desfazer" persistido no mundo (substitui o antigo BackupHelper de localStorage,
 * que não sincronizava entre GM/jogadores e só guardava 1 documento por vez). Cada operação
 * em lote do Assistente de IA (Parte 3 do plano) vira uma entrada aqui, agrupando todos os
 * documentos criados/editados naquela rodada — pra poder desfazer tudo de uma vez.
 */
import { SYSTEM_ID } from "../config.js";

const BACKUP_PACK_KEY = `${SYSTEM_ID}-ai-backups`;

async function ensureBackupPack() {
  const collectionId = `world.${BACKUP_PACK_KEY}`;
  let pack = game.packs.get(collectionId);
  if (pack) return pack;
  if (!game.user.isGM) return null;

  pack = await CompendiumCollection.createCompendium({
    type: "JournalEntry",
    label: "Nihility — Backups do Assistente de IA",
    name: BACKUP_PACK_KEY,
    package: "world"
  });
  return pack;
}

/**
 * Registra uma operação em lote (ex: N documentos criados/editados por uma execução do
 * Assistente de IA) como uma única entrada revertível.
 * @param {Array<{action:"create"|"update", uuid:string, previousData?:object}>} entries
 * @returns {Promise<string|null>} id da entrada de backup (para `undoBatchOperation`)
 */
export async function recordBatchOperation(entries) {
  if (!entries?.length) return null;
  const pack = await ensureBackupPack();
  if (!pack) return null;

  const timestamp = new Date().toISOString();
  const doc = await JournalEntry.create(
    {
      name: `Operação IA — ${new Date(timestamp).toLocaleString()} (${entries.length} documento(s))`,
      flags: { [SYSTEM_ID]: { operation: { timestamp, userId: game.user.id, entries } } }
    },
    { pack: pack.collection }
  );
  return doc?.id ?? null;
}

/**
 * Desfaz uma operação em lote: apaga os documentos que ela criou e restaura o estado
 * anterior dos que ela editou. A própria entrada de backup é apagada ao final.
 * @param {string} operationId
 */
export async function undoBatchOperation(operationId) {
  const pack = await ensureBackupPack();
  if (!pack) throw new Error("Compêndio de backups do Assistente de IA não encontrado.");

  const doc = await pack.getDocument(operationId);
  if (!doc) throw new Error("Operação de backup não encontrada.");

  const operation = doc.getFlag(SYSTEM_ID, "operation");
  if (!operation?.entries?.length) throw new Error("Operação de backup sem dados válidos.");

  for (const entry of operation.entries) {
    const target = await fromUuid(entry.uuid);
    if (!target) continue;
    if (entry.action === "create") {
      await target.delete();
    } else if (entry.action === "update" && entry.previousData) {
      await target.update(entry.previousData);
    }
  }

  await doc.delete();
}

/**
 * Lista as operações de backup mais recentes (mais nova primeiro).
 * @param {number} [limit=20]
 * @returns {Promise<Array<{id:string, name:string, operation:object}>>}
 */
export async function listRecentBatchOperations(limit = 20) {
  const pack = await ensureBackupPack();
  if (!pack) return [];

  const index = await pack.getIndex({ fields: ["flags"] });
  return index
    .map(e => ({ id: e._id, name: e.name, operation: e.flags?.[SYSTEM_ID]?.operation }))
    .filter(e => e.operation)
    .sort((a, b) => (b.operation.timestamp ?? "").localeCompare(a.operation.timestamp ?? ""))
    .slice(0, limit);
}
