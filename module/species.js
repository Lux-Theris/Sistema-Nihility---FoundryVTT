/**
 * Aplicação de Espécie numa ficha — o ÚNICO caminho (ficha, geração por IA, Agente, e depois
 * Linhagem/Evolução/Herança). A conta é pura (species-rules.js); aqui só se lê a ficha, se mostra a
 * prévia (apps/species-preview.js) e se grava.
 *
 * Marca de origem: tudo o que uma camada concede leva `flags.<sistema>.speciesGrant =
 * { kind, id, key, hash? }`. É o que permite trocar de Espécie sem perder próteses (a parte é
 * transformada, não apagada) e devolver uma Skill Racial com o nível que tinha (histórico em
 * `flags.<sistema>.speciesArchive`).
 */
import { SYSTEM_ID, getActiveSpeciesPresets, isAnatomyEnabled } from "./config.js";
import { resolveSpeciesTemplate, speciesDiff, racialSkillSystem, normalizeSpeciesEntry } from "./species-rules.js";
import { registerItemInCompendium } from "./compendium.js";
import { announceVoiceOfTheWorld } from "./voice-of-the-world.js";

const ARCHIVE_LIMIT = 60;

/** A entrada do catálogo já normalizada (chaves estáveis, campos novos com padrão), ou null. */
export function getSpeciesEntry(id) {
  const raw = id ? getActiveSpeciesPresets()?.[id] : null;
  return raw ? normalizeSpeciesEntry(raw) : null;
}

/** Nome para mostrar ("—" sem Espécie). */
export function speciesLabel(id) {
  return getSpeciesEntry(id)?.label || id || "—";
}

/** O que a ficha tem hoje, em objetos simples (entrada do diff). */
export function actorSpeciesSnapshot(actor) {
  const grantOf = item => item.getFlag?.(SYSTEM_ID, "speciesGrant") ?? null;
  const parts = actor.items
    .filter(i => i.type === "body_part")
    .map(i => ({
      id: i.id,
      name: i.name,
      slot: i.system.slot,
      grant: grantOf(i),
      origin: i.system.speciesOrigin || "",
      hp: { value: i.system.hp.value, max: i.system.hp.max },
      isProsthetic: Boolean(i.system.isProsthetic),
      mods: (i.system.installedMods ?? []).map(m => m.name || "Modificação")
    }));
  const skills = actor.items
    .filter(i => i.type === "skill")
    .map(i => ({ id: i.id, name: i.name, tier: i.system.tier, grant: grantOf(i), itemGranted: Boolean(i.system.isItemGranted), level: i.system.level, xp: i.system.xp ?? 0 }));
  return { parts, skills, archive: actor.getFlag(SYSTEM_ID, "speciesArchive") ?? [] };
}

/**
 * O molde para um alvo (Espécie/Linhagem). Sem o bloco Anatomia, as partes ficam de fora dos dois
 * lados: nada é criado nem removido, e as partes já salvas continuam lá.
 */
export function speciesTemplateFor(actor, { species, lineage = "" } = {}) {
  const entry = getSpeciesEntry(species);
  const lineageEntry = entry && lineage ? entry.lineages.find(l => l.id === lineage) ?? null : null;
  const template = resolveSpeciesTemplate({
    species: entry,
    speciesId: species ?? "",
    lineage: lineageEntry,
    level: Number(actor.system?.attributes?.level) || 1
  });
  if (!isAnatomyEnabled()) template.parts = [];
  return { entry, template };
}

/**
 * Prévia de uma mudança: molde + diff, sem gravar nada.
 * @param {Actor} actor
 * @param {{species:string, lineage?:string}} target
 * @param {{mode?:"change"|"sync", removeMissing?:boolean}} [options]
 */
export function previewSpeciesChange(actor, target, options = {}) {
  const { entry, template } = speciesTemplateFor(actor, target);
  const snapshot = actorSpeciesSnapshot(actor);
  if (!isAnatomyEnabled()) snapshot.parts = [];
  const diff = speciesDiff(snapshot, template, options);
  return {
    actor,
    target: { species: target.species ?? "", lineage: target.lineage ?? "" },
    from: { species: actor.system.species || "", lineage: actor.system.lineage || "" },
    fromEntry: getSpeciesEntry(actor.system.species),
    entry,
    template,
    diff,
    mode: options.mode ?? "change"
  };
}

/** Ficha "nova": nada concedido por Espécie ainda — a escolha na criação aplica direto, sem prévia. */
function isFreshOrigin(actor) {
  const snap = actorSpeciesSnapshot(actor);
  return !snap.parts.some(p => p.grant || p.origin) && !snap.skills.some(s => !s.itemGranted && (s.grant || s.tier === "racial"));
}

const grantFlag = (source, key, hash = null) => ({ [`flags.${SYSTEM_ID}.speciesGrant`]: { kind: source?.kind ?? "species", id: source?.id ?? "", key, ...(hash ? { hash } : {}) } });

/**
 * Grava uma prévia. Ordem pensada para nunca perder nada: primeiro transforma/cria, depois guarda no
 * histórico o que vai sair, só então apaga.
 * @param {ReturnType<typeof previewSpeciesChange>} preview
 * @param {{announce?:boolean, reason?:string, note?:string}} [options]
 */
export async function applySpeciesPreview(preview, { announce = false, reason = "change", note = "" } = {}) {
  const { actor, diff, target, entry } = preview;
  const speciesId = target.species;

  // ---- Partes
  const partUpdates = diff.parts.update
    .concat(diff.parts.keep.filter(p => p.id && !p.outside))
    .map(p => ({
      _id: p.id,
      name: p.label,
      "system.slot": p.slot,
      "system.hp.max": p.hpMax,
      "system.hp.value": Math.min(p.hpValue, p.hpMax),
      "system.speciesOrigin": speciesId,
      ...grantFlag(p.source, p.key)
    }));
  const detach = diff.parts.detach.map(p => ({ _id: p.id, "system.speciesOrigin": "", [`flags.${SYSTEM_ID}.speciesGrant`]: null }));
  if (partUpdates.length || detach.length) await actor.updateEmbeddedDocuments("Item", [...partUpdates, ...detach]);
  if (diff.parts.create.length) {
    const created = await actor.createEmbeddedDocuments(
      "Item",
      diff.parts.create.map(p => ({
        name: p.label,
        type: "body_part",
        system: { slot: p.slot, speciesOrigin: speciesId, hp: { value: p.hpMax, max: p.hpMax }, status: "intact", isProsthetic: false, installedMods: [] },
        flags: { [SYSTEM_ID]: { speciesGrant: { kind: p.source?.kind ?? "species", id: p.source?.id ?? "", key: p.key } } }
      }))
    );
    for (const item of created) await registerItemInCompendium(item.toObject());
  }

  // ---- Skills Raciais
  const skillUpdates = [];
  for (const s of diff.skills.keep) if (s.needsMark) skillUpdates.push({ _id: s.id, ...grantFlag(s.source, s.key, s.hash) });
  for (const s of diff.skills.update) {
    const current = actor.items.get(s.id);
    const system = racialSkillSystem(s.data, { level: current?.system.level, xp: current?.system.xp });
    system.active = Boolean(current?.system.active);
    skillUpdates.push({ _id: s.id, name: s.name, system, ...grantFlag(s.source, s.key, s.hash) });
  }
  if (skillUpdates.length) await actor.updateEmbeddedDocuments("Item", skillUpdates);
  if (diff.skills.create.length) {
    const created = await actor.createEmbeddedDocuments(
      "Item",
      diff.skills.create.map(s => ({
        name: s.name,
        type: "skill",
        system: racialSkillSystem(s.data, s.restored),
        flags: { [SYSTEM_ID]: { speciesGrant: { kind: s.source?.kind ?? "species", id: s.source?.id ?? "", key: s.key, hash: s.hash } } }
      }))
    );
    for (const item of created) await registerItemInCompendium(item.toObject());
  }

  // ---- Histórico do que sai (volta com nível/XP se a Espécie voltar), depois remove
  let archive = actor.getFlag(SYSTEM_ID, "speciesArchive") ?? [];
  for (const s of diff.skills.remove) {
    const item = actor.items.get(s.id);
    const source = s.source ?? { kind: "species", id: actor.system.species || "" };
    archive = archive.filter(a => !(a.key === s.key && a.source?.kind === source.kind && a.source?.id === source.id));
    archive.push({ key: s.key, source, name: s.name, level: s.level, xp: s.xp, system: item?.toObject().system ?? null, at: Date.now() });
  }
  archive = archive.slice(-ARCHIVE_LIMIT);
  const removeIds = [...diff.skills.remove.map(s => s.id), ...diff.parts.remove.map(p => p.id)].filter(id => actor.items.has(id));
  if (removeIds.length) await actor.deleteEmbeddedDocuments("Item", removeIds);

  // ---- A ficha
  const state = actor.system.speciesState ?? {};
  const history = [...(state.history ?? []), {
    at: Date.now(),
    reason,
    from: { species: actor.system.species || "", lineage: actor.system.lineage || "" },
    to: { species: speciesId, lineage: target.lineage || "" },
    by: game.user?.name ?? "",
    note: String(note || "")
  }].slice(-50);
  await actor.update({
    "system.species": speciesId,
    "system.lineage": target.lineage || "",
    "system.lastAppliedSpeciesPreset": speciesId,
    "system.speciesState.appliedVersion": entry?.version ?? 0,
    "system.speciesState.history": history,
    [`flags.${SYSTEM_ID}.speciesArchive`]: archive
  });

  if (announce) {
    const verb = reason === "evolution" ? "evoluiu para" : reason === "sync" ? "foi atualizado conforme" : "agora é";
    await announceVoiceOfTheWorld(actor, {
      kind: reason === "evolution" ? "species-evolution" : "species-change",
      title: reason === "evolution" ? "Evolução" : "Origem",
      body: `${actor.name} ${verb} ${entry?.label ?? (speciesId || "sem Espécie")}.`
    });
  }
  return true;
}

/**
 * Trocar a Espécie (e/ou a Linhagem) de uma ficha. Na criação (nada concedido ainda) aplica direto;
 * senão abre a prévia. Devolve true se aplicou.
 * @param {Actor} actor
 * @param {{species:string, lineage?:string}} target
 * @param {{interactive?:boolean, reason?:string}} [options]
 */
export async function changeActorSpecies(actor, target, { interactive = true, reason = "change" } = {}) {
  const preview = previewSpeciesChange(actor, target);
  if (!interactive || isFreshOrigin(actor)) return applySpeciesPreview(preview, { reason });
  const { openSpeciesPreview } = await import("./apps/species-preview.js");
  const choice = await openSpeciesPreview(preview);
  if (!choice) return false;
  return applySpeciesPreview(preview, { announce: choice.announce, reason, note: choice.note });
}
