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
import { SYSTEM_ID, getActiveSpeciesPresets, getActiveHeritages, isAnatomyEnabled, isFeatureEnabled, getActiveTraits, getDamageElement } from "../core/config.js";
import { resolveSpeciesTemplate, speciesDiff, racialSkillSystem, normalizeSpeciesEntry, normalizeSpeciesCatalog, isSpeciesLocked, heritageConflicts, evolutionOptions, evolutionResistanceUpgrades } from "./species-rules.js";
import { getHeritageEntry } from "./origin.js";
import { legacyFunctionsFor } from "./anatomy-rules.js";
import { getActiveBodyFunctions } from "../core/config.js";

/** Funções de uma parte do molde (as tags do catálogo; tags antigas viram Funções pelo slot). */
const functionsOf = p => legacyFunctionsFor(p.tags ?? [], p.slot, getActiveBodyFunctions().map(f => f.id));
import { registerItemInCompendium } from "../core/compendium.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";

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
export function speciesTemplateFor(actor, { species, lineage = "", heritages = null } = {}) {
  const entry = getSpeciesEntry(species);
  const lineageEntry = entry && lineage ? entry.lineages.find(l => l.id === lineage) ?? null : null;
  const heritageIds = heritages ?? (actor.system?.heritages ?? []).map(h => h.id);
  const template = resolveSpeciesTemplate({
    species: entry,
    speciesId: species ?? "",
    lineage: lineageEntry,
    heritages: heritageIds.map(id => ({ id, entry: getHeritageEntry(id) })).filter(h => h.entry),
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
    target: { species: target.species ?? "", lineage: target.lineage ?? "", heritages: target.heritages ?? null },
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
      "system.isProsthetic": Boolean(p.isProsthetic),
      "system.functions": functionsOf(p),
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
        system: { slot: p.slot, speciesOrigin: speciesId, hp: { value: p.hpMax, max: p.hpMax }, status: "intact", isProsthetic: Boolean(p.isProsthetic), functions: functionsOf(p), installedMods: [] },
        flags: { [SYSTEM_ID]: { speciesGrant: { kind: p.source?.kind ?? "species", id: p.source?.id ?? "", key: p.key } } }
      }))
    );
    for (const item of created) await registerItemInCompendium(item.toObject());
  }

  // ---- Skills Raciais
  const skillUpdates = [];
  for (const s of diff.skills.keep) if (s.needsMark && !s.fromPrevious) skillUpdates.push({ _id: s.id, ...grantFlag(s.source, s.key, s.hash) });
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
  // Heranças: só gravadas quando a prévia mexe nelas (ganhar/perder); `heritageRecords` traz data/origem.
  const heritageUpdate = Array.isArray(target.heritages)
    ? { "system.heritages": target.heritageRecords ?? target.heritages.map(id => (actor.system.heritages ?? []).find(h => h.id === id) ?? { id, acquiredAt: Date.now(), source: "" }) }
    : {};
  await actor.update({
    ...heritageUpdate,
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
  const { openSpeciesPreview } = await import("../apps/species-preview.js");
  const choice = await openSpeciesPreview(preview);
  if (!choice) return false;
  return applySpeciesPreview(preview, { announce: choice.announce, reason, note: choice.note });
}

/* ------------------------------------------------------------------ sincronização */

/** Atores do mundo que são desta Espécie: Diretório + Tokens não vinculados de todas as cenas. */
export function actorsWithSpecies(speciesId) {
  const seen = new Set();
  const list = [];
  const consider = actor => {
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    if (actor.system.species === speciesId) list.push(actor);
  };
  for (const actor of game.actors) consider(actor);
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink) consider(token.actor);
  return list;
}

/** A ficha está atrás do catálogo? (o diff de sincronização tem algo a fazer) */
export function syncPreviewFor(actor, { removeMissing = false } = {}) {
  if (!actor?.system?.species || !getSpeciesEntry(actor.system.species)) return null;
  const preview = previewSpeciesChange(actor, { species: actor.system.species, lineage: actor.system.lineage || "" }, { mode: "sync", removeMissing });
  return preview.diff.empty ? null : preview;
}

/**
 * Prévia D do canvas: as fichas desatualizadas de uma Espécie (ou uma ficha só), com caixa por
 * ficha e a escolha do que fazer com o que saiu da Espécie (manter é o padrão).
 * @returns {Promise<number>} quantas fichas foram sincronizadas
 */
export async function openSpeciesSync(speciesId, { actors = null, label = null } = {}) {
  const entry = speciesId ? getSpeciesEntry(speciesId) : null;
  const name = label ?? entry?.label ?? speciesId;
  const candidates = (actors ?? actorsWithSpecies(speciesId)).map(actor => ({ actor, preview: syncPreviewFor(actor) })).filter(c => c.preview);
  if (!candidates.length) {
    ui.notifications.info(`Todas as fichas de ${name} já estão em dia.`);
    return 0;
  }
  const { syncDialogHtml } = await import("../apps/species-preview.js");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: `Sincronizar — ${name}${entry ? ` v${entry.version}` : ""}` },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    position: { width: 620 },
    content: syncDialogHtml({ label: name }, candidates),
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      {
        action: "apply",
        label: "Sincronizar",
        default: true,
        callback: (event, button, dialog) => ({
          uuids: [...dialog.element.querySelectorAll('[name="sync-actor"]:checked')].map(el => el.value),
          removeMissing: dialog.element.querySelector('[name="sync-remove"]:checked')?.value === "remove"
        })
      }
    ],
    rejectClose: false
  });
  if (!result || typeof result !== "object") return 0;
  let done = 0;
  for (const { actor } of candidates) {
    if (!result.uuids.includes(actor.uuid)) continue;
    const preview = syncPreviewFor(actor, { removeMissing: result.removeMissing });
    if (!preview) continue;
    await applySpeciesPreview(preview, { reason: "sync" });
    done += 1;
  }
  if (done) ui.notifications.info(`${done} ficha(s) sincronizada(s) com ${name}.`);
  return done;
}

/* ------------------------------------------------------------------ ficha: bloco Origem */

const REASON_LABELS = { change: "trocou", sync: "sincronizou com", evolution: "evoluiu para", lineage: "trocou a Linhagem para", heritage: "ganhou a Herança", "heritage-lost": "perdeu a Herança" };

/**
 * Dados da aba Origem e do cabeçalho (board 4): Espécie · Linhagem · Heranças, o que cada camada
 * dá (ao vivo × copiado), o selo "a Espécie mudou" e o histórico.
 */
export function originContext(actor) {
  const system = actor.system;
  const isGM = game.user.isGM;
  const entry = getSpeciesEntry(system.species);
  const lineage = entry && system.lineage ? entry.lineages.find(l => l.id === system.lineage) ?? null : null;
  const locked = isSpeciesLocked(system);
  const grantOf = item => item.getFlag(SYSTEM_ID, "speciesGrant");
  const parts = actor.items.filter(i => i.type === "body_part");
  const racial = actor.items.filter(i => i.type === "skill" && !i.system.isItemGranted && (grantOf(i) || i.system.tier === "racial"));
  const traitLabel = id => getActiveTraits().find(t => t.id === id)?.label ?? id;
  const elementLabel = id => getDamageElement(id)?.label ?? id;
  const live = [
    ...(entry?.traits ?? []).map(traitLabel),
    ...(entry?.elements ?? []).map(elementLabel)
  ];
  const history = (system.speciesState?.history ?? [])
    .slice(-8)
    .reverse()
    .map(h => {
      const to = getSpeciesEntry(h.to?.species)?.label ?? h.to?.species ?? "—";
      const date = h.at ? new Date(h.at).toLocaleDateString() : "";
      const isHeritage = h.reason === "heritage" || h.reason === "heritage-lost";
      const what = isHeritage ? h.note : `${to}${h.note ? ` (${h.note})` : ""}`;
      const op = h.reason === "sync" ? "~" : h.reason === "evolution" ? "↑" : h.reason === "heritage" ? "+" : h.reason === "heritage-lost" ? "−" : "=";
      return { text: `${date} · ${REASON_LABELS[h.reason] ?? h.reason} ${what}`, by: h.by ?? "", op };
    });
  return {
    speciesId: system.species || "",
    speciesLabel: entry?.label ?? (system.species || ""),
    lineageId: system.lineage || "",
    lineageLabel: lineage?.label ?? "",
    hasLineages: Boolean(entry?.lineages?.length),
    lineageRequired: Boolean(entry?.lineageRequired),
    lineageOptions: (entry?.lineages ?? []).map(l => ({ id: l.id, label: l.label || l.id, selected: l.id === system.lineage })),
    description: lineage?.description || entry?.description || "",
    locked,
    // No cabeçalho: seletores na criação (sem Espécie) e para o jogador antes de travar; senão a linha-resumo.
    canChooseHere: !system.species || (!isGM && !locked),
    outdated: isGM && entry ? Boolean(syncPreviewFor(actor)) : false,
    canEvolve: isGM && isFeatureEnabled("speciesEvolution") && Boolean(entry?.evolvesTo?.length),
    live: live.join(", "),
    partsSummary: parts.length
      ? `${parts.length} parte(s)${parts.filter(p => p.system.isProsthetic).length ? ` · ${parts.filter(p => p.system.isProsthetic).length} prótese(s)` : ""}${parts.reduce((n, p) => n + (p.system.installedMods?.length ?? 0), 0) ? ` · ${parts.reduce((n, p) => n + (p.system.installedMods?.length ?? 0), 0)} modificação(ões)` : ""}`
      : "",
    racial: racial.map(s => ({ name: s.name, level: s.system.level })),
    locked_text: (entry?.skills ?? []).filter(s => (Number(s.unlockLevel) || 0) > (Number(system.attributes?.level) || 1)).map(s => `${s.name} (a partir do Nv ${s.unlockLevel})`),
    lineageAdds: lineage ? [...(lineage.elements ?? []).map(elementLabel), ...(lineage.traits ?? []).map(traitLabel), ...(lineage.skills ?? []).map(s => s.name)].join(" · ") : "",
    lineageReplaces: lineage ? (lineage.replaces?.skills ?? []).map(k => entry.skills.find(s => s.key === k)?.name ?? k).join(", ") : "",
    history,
    heritages: (system.heritages ?? []).map(h => {
      const e = getHeritageEntry(h.id);
      const gives = e
        ? [
            ...(e.traits ?? []).map(t => `+ ${traitLabel(t)}`),
            ...(e.removesTraits ?? []).map(t => `− ${traitLabel(t)}`),
            ...(e.elements ?? []).map(elementLabel),
            ...(e.skills ?? []).map(s => s.name)
          ].join(" · ")
        : "não existe mais no catálogo";
      return { id: h.id, label: e?.label ?? h.id, gives, source: h.source || "", date: h.acquiredAt ? new Date(h.acquiredAt).toLocaleDateString() : "" };
    }),
    isGM
  };
}

/* ------------------------------------------------------------------ Heranças */

const CONFLICT_TEXT = {
  "species-not-allowed": "esta Herança só vale para outras Espécies",
  "species-excluded": "esta Herança não vale para esta Espécie"
};

/** Motivos legíveis de conflito (só aviso: o Mestre aplica mesmo assim se quiser). */
export function heritageWarnings(actor, heritageId, heritageIds) {
  const catalog = getActiveHeritages();
  const entry = catalog.find(h => h.id === heritageId);
  return heritageConflicts(entry, { species: actor.system.species, heritages: heritageIds }, catalog).map(r =>
    r.startsWith("excludes:") ? `não convive com ${catalog.find(h => h.id === r.slice(9))?.label ?? r.slice(9)}` : CONFLICT_TEXT[r] ?? r
  );
}

/**
 * Mestre: o personagem ganha (`add`) ou perde (`remove`) uma Herança. Mesma prévia da troca de
 * Espécie; ganhar avisa as regras de convivência e guarda de onde veio; anúncio pela Voz do Mundo.
 * @returns {Promise<boolean>}
 */
export async function changeActorHeritage(actor, heritageId, { op = "add", source = "" } = {}) {
  if (!game.user.isGM) return false;
  const current = actor.system.heritages ?? [];
  const records = op === "add"
    ? [...current.filter(h => h.id !== heritageId), { id: heritageId, acquiredAt: Date.now(), source: String(source || "") }]
    : current.filter(h => h.id !== heritageId);
  const ids = records.map(h => h.id);
  const preview = previewSpeciesChange(actor, { species: actor.system.species, lineage: actor.system.lineage || "", heritages: ids });
  preview.target.heritageRecords = records;
  const entry = getHeritageEntry(heritageId);
  const warnings = op === "add" ? heritageWarnings(actor, heritageId, ids) : [];
  const { openSpeciesPreview } = await import("../apps/species-preview.js");
  const choice = await openSpeciesPreview(preview, { title: `${op === "add" ? "Ganhar" : "Perder"} Herança — ${actor.name}`, warnings });
  if (!choice) return false;
  const label = entry?.label ?? heritageId;
  await applySpeciesPreview(preview, { reason: op === "add" ? "heritage" : "heritage-lost", note: op === "add" && source ? `${label} — ${source}` : label });
  if (choice.announce) {
    const text = op === "add" && entry?.announce ? entry.announce.split("{nome}").join(actor.name) : `${actor.name} ${op === "add" ? "ganhou" : "perdeu"} a Herança ${label}.`;
    await announceVoiceOfTheWorld(actor, { kind: op === "add" ? "heritage-gained" : "heritage-lost", title: "Herança", body: text });
  }
  return true;
}

/* ------------------------------------------------------------------ Evolução */

/**
 * Mestre: "Evoluir…" na aba Origem. Escolhe o destino (nível mínimo só avisa), mostra a prévia
 * (o que tem par fica, com nível; Linhagem fica se existir no destino e o destino mandar manter;
 * Heranças ficam, com aviso se alguma deixa de valer) e, se o destino pedir, sobe as Resistências
 * Elementais para Imunidade. Anúncio pela Voz do Mundo.
 * @returns {Promise<boolean>}
 */
export async function openEvolution(actor) {
  if (!game.user.isGM || !isFeatureEnabled("speciesEvolution")) return false;
  const entry = getSpeciesEntry(actor.system.species);
  const catalog = normalizeSpeciesCatalog(getActiveSpeciesPresets());
  const options = evolutionOptions(entry, actor.system.attributes?.level, catalog);
  if (!options.length) {
    ui.notifications.info(`${entry?.label ?? "Esta Espécie"} não tem para onde evoluir (aba Evolução do editor de Espécies).`);
    return false;
  }
  const { pickEvolutionDialog, openSpeciesPreview } = await import("../apps/species-preview.js");
  const choice = await pickEvolutionDialog(actor, entry, options);
  if (!choice) return false;

  const target = catalog[choice.species];
  const lineage = choice.keepLineage && target.lineages.some(l => l.id === actor.system.lineage) ? actor.system.lineage : "";
  const preview = previewSpeciesChange(actor, { species: choice.species, lineage }, { mode: "evolution" });

  const heritageCatalog = getActiveHeritages();
  const heritageIds = (actor.system.heritages ?? []).map(h => h.id);
  const warnings = heritageIds.flatMap(id => {
    const h = heritageCatalog.find(x => x.id === id);
    return heritageConflicts(h, { species: choice.species, heritages: [] }, heritageCatalog).map(() => `${h?.label ?? id} deixa de combinar com ${target.label}`);
  });
  if (actor.system.lineage && !lineage) warnings.push(`a Linhagem atual não existe em ${target.label} e sai`);

  const resistanceSkills = actor.items
    .filter(i => i.type === "skill" && i.system.resistanceTarget)
    .map(i => ({ id: i.id, name: i.name, resistanceTarget: i.system.resistanceTarget, level: i.system.level }));
  const upgrades = choice.resistancesToImmunity ? evolutionResistanceUpgrades(resistanceSkills) : [];
  const { computeResistanceName } = await import("../combat/resistance.js");
  const extraSections = upgrades.length
    ? [{ title: "Resistências viram Imunidade", rows: upgrades.map(u => ({ op: "~", text: `${u.name} · Nv ${u.level}`, note: `→ ${computeResistanceName(u.target, u.toLevel)}` })) }]
    : [];

  const decision = await openSpeciesPreview(preview, { title: `Evoluir — ${actor.name}`, warnings, extraSections, confirmLabel: "Evoluir" });
  if (!decision) return false;
  await applySpeciesPreview(preview, { announce: decision.announce, reason: "evolution" });
  if (upgrades.length) {
    await actor.updateEmbeddedDocuments("Item", upgrades.map(u => ({ _id: u.id, name: computeResistanceName(u.target, u.toLevel), "system.level": u.toLevel })));
  }
  return true;
}
