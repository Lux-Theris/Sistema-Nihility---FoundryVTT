/**
 * Pontos de restauração de ficha (H13) — regras puras (sem Foundry), testadas em
 * test/actor-snapshots.test.mjs. O lado Foundry (compêndio, salvar e restaurar) é actor-snapshots.js.
 */

/** Quantos pontos cada ficha guarda (o mais antigo sai). */
export const MAX_SNAPSHOTS = 10;

/**
 * Quais pontos de UMA ficha apagar para sobrarem só os `max` mais novos.
 * @param {Array<{id:string, when:string}>} entries - os pontos da ficha (qualquer ordem)
 * @returns {string[]} ids a apagar (os mais antigos)
 */
export function snapshotsToPrune(entries, max = MAX_SNAPSHOTS) {
  const keep = Math.max(1, Math.floor(Number(max) || MAX_SNAPSHOTS));
  const sorted = [...(entries ?? [])].sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? "")));
  return sorted.slice(keep).map(e => e.id);
}

/** Pontos de uma ficha, do mais novo para o mais antigo. */
export function snapshotsForActor(entries, actorUuid) {
  return (entries ?? [])
    .filter(e => e?.actorUuid === actorUuid)
    .sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? "")));
}

/**
 * O que fazer com uma coleção embutida (Itens ou Efeitos) para ela voltar ao que o ponto guardou,
 * mantendo os ids: o que não estava no ponto sai; o que faltava volta (`keepId`); o que existe nos
 * dois é reescrito com o salvo.
 * @param {string[]} currentIds - ids que a ficha tem agora
 * @param {Array<{_id:string}>} saved - os documentos do ponto (`toObject()` de cada um)
 * @returns {{remove:string[], create:object[], update:object[]}}
 */
export function embeddedPlan(currentIds, saved) {
  const have = new Set(currentIds ?? []);
  const want = new Map((saved ?? []).filter(d => d?._id).map(d => [d._id, d]));
  return {
    remove: [...have].filter(id => !want.has(id)),
    create: [...want.values()].filter(d => !have.has(d._id)),
    update: [...want.values()].filter(d => have.has(d._id))
  };
}

/** Campos do documento que a restauração nunca reescreve (identidade, pasta, permissões, carimbos). */
const KEEP_OUT = ["_id", "_stats", "folder", "sort", "ownership", "items", "effects", "prototypeToken"];

/**
 * Flags do sistema que a restauração NUNCA reescreve nem apaga (como a posição do Token): o tempo
 * pessoal (J9b) não pode voltar só porque a ficha voltou — quem recua o tempo de alguém é uma Skill.
 */
export const RESTORE_SKIP_FLAGS = ["personalTime", "timeSync", "timeSyncStatus"];

/** Flags de um ITEM que a restauração também preserva: o acerto do relógio analógico (senão a hora do relógio salta). */
export const RESTORE_SKIP_ITEM_FLAGS = ["clockSync"];

/**
 * O Item como a restauração o reescreve: o salvo, mas com os flags de `RESTORE_SKIP_ITEM_FLAGS` iguais aos de AGORA
 * (a atualização é por substituição, então o que não for copiado aqui seria apagado).
 */
export function itemRestoreData(saved, current, systemId) {
  const data = { ...saved, flags: { ...(saved?.flags ?? {}) } };
  const savedFlags = { ...(data.flags[systemId] ?? {}) };
  const currentFlags = current?.flags?.[systemId] ?? {};
  for (const key of RESTORE_SKIP_ITEM_FLAGS) {
    if (key in currentFlags) savedFlags[key] = currentFlags[key];
    else delete savedFlags[key];
  }
  data.flags[systemId] = savedFlags;
  return data;
}

/**
 * O pedaço do `actor.update()` que devolve nome, imagem e dados de sistema ao que o ponto guardou.
 * Flags do sistema voltam inteiras: chave que a ficha tem agora e o ponto não tinha vem em
 * `removeFlagKeys` (o `update` só mescla, então quem chama as apaga).
 * @param {object} saved - `actor.toObject()` do ponto
 * @param {object} current - `actor.toObject()` de agora
 * @param {string} systemId - namespace dos flags do sistema
 * @returns {{update:object, removeFlagKeys:string[]}}
 */
export function actorRestoreUpdate(saved, current, systemId) {
  const update = {};
  for (const key of Object.keys(saved ?? {})) {
    if (KEEP_OUT.includes(key) || key === "flags" || key === "type") continue;
    update[key] = saved[key];
  }
  const withoutSkipped = flags => Object.fromEntries(Object.entries(flags ?? {}).filter(([key]) => !RESTORE_SKIP_FLAGS.includes(key)));
  const savedFlags = withoutSkipped(saved?.flags?.[systemId]);
  const currentFlags = withoutSkipped(current?.flags?.[systemId]);
  if (Object.keys(savedFlags).length) update.flags = { [systemId]: savedFlags };
  const removeFlagKeys = Object.keys(currentFlags).filter(key => !(key in savedFlags));
  return { update, removeFlagKeys };
}

/** Linha do ponto na lista: "16/11 14:05 · Antes de evoluir Bola de Fogo". */
export function snapshotLabel(entry) {
  const when = entry?.when ? new Date(entry.when) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? `${String(when.getDate()).padStart(2, "0")}/${String(when.getMonth() + 1).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
    : "—";
  return `${date} · ${entry?.reason || "Estado salvo"}`;
}

/** Resumo do que o ponto guarda, para a lista ("12 itens · 3 efeitos · nível 4"). */
export function snapshotSummary(data) {
  const items = data?.items?.length ?? 0;
  const effects = data?.effects?.length ?? 0;
  const level = data?.system?.attributes?.level;
  return `${items} item(ns) · ${effects} efeito(s)${Number.isFinite(Number(level)) ? ` · nível ${level}` : ""}`;
}
