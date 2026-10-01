/**
 * Regras PURAS de Espécie (testadas em test/rules.test.mjs): normalizar o catálogo, montar o
 * "molde" de um personagem (Espécie → Linhagem → Heranças) e comparar o molde com o que a ficha
 * tem (o diff que a prévia mostra e que species.js aplica). Nada aqui toca Actor/Item.
 *
 * Princípio: a Espécie é um molde com vínculo. O que é dela em si (Traços, elementos, carga…) é
 * lido ao vivo; o que tem estado próprio na ficha (Partes do Corpo com Vida/próteses, Skills
 * Raciais com nível/XP) é COPIADO com chave estável e marca de origem (`speciesGrant`), e só muda
 * por este diff. O que a ficha criou à mão (sem marca de origem) nunca entra na conta.
 */
import { MEU_SISTEMA, isStructureMechanic } from "../core/config.js";

/* ------------------------------------------------------------------ catálogo */

/** "Sopro Dracônico" → "sopro_draconico". Chave estável para Skills e partes sem chave. */
export function speciesSlug(text) {
  return (
    String(text ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "item"
  );
}

/** Dá chave única a cada entrada que não tem (Skills Raciais antigas só tinham nome). */
function ensureKeys(list, labelOf) {
  const used = new Set();
  return (Array.isArray(list) ? list : []).map(entry => {
    let key = entry?.key ? String(entry.key) : speciesSlug(labelOf(entry));
    const base = key;
    let n = 2;
    while (used.has(key)) key = `${base}_${n++}`;
    used.add(key);
    return { ...entry, key };
  });
}

/** Uma entrada do catálogo com todos os campos do rework (dados antigos ganham os padrões). */
export function normalizeSpeciesEntry(entry = {}) {
  return {
    ...entry,
    label: entry.label ?? "",
    version: Math.max(1, Math.round(Number(entry.version) || 1)),
    traits: Array.isArray(entry.traits) ? entry.traits : [],
    elements: Array.isArray(entry.elements) ? entry.elements : [],
    parts: ensureKeys(entry.parts, p => p?.label ?? p?.slot),
    skills: ensureKeys(entry.skills, s => s?.name),
    lineages: Array.isArray(entry.lineages) ? entry.lineages : [],
    evolvesTo: Array.isArray(entry.evolvesTo) ? entry.evolvesTo : [],
    passives: entry.passives && typeof entry.passives === "object" ? entry.passives : {}
  };
}

/** O catálogo inteiro normalizado (mesmas chaves). */
export function normalizeSpeciesCatalog(catalog = {}) {
  const out = {};
  for (const [id, entry] of Object.entries(catalog ?? {})) out[id] = normalizeSpeciesEntry(entry);
  return out;
}

/** O que, quando muda, deixa as fichas desatualizadas: só o que é COPIADO (partes e Skills). */
export function speciesContentFingerprint(entry = {}) {
  const parts = (entry.parts ?? []).map(p => [p.key, p.label, p.slot, Number(p.hpMax) || 0, p.tags ?? []]);
  const skills = (entry.skills ?? []).map(s => [s.key, skillDataHash(s), s.unlockLevel ?? null]);
  return JSON.stringify({ parts, skills, lineages: entry.lineages ?? [] });
}

/**
 * Ao salvar o catálogo: a versão de cada Espécie sobe quando o conteúdo copiado mudou (é o que faz
 * a ficha mostrar "a Espécie mudou"). Espécie nova começa em 1.
 */
export function bumpSpeciesVersions(previous = {}, next = {}) {
  const out = {};
  for (const [id, entry] of Object.entries(next)) {
    const before = previous?.[id];
    const version = Math.max(1, Number(before?.version) || 1);
    const changed = before && speciesContentFingerprint(before) !== speciesContentFingerprint(entry);
    out[id] = { ...entry, version: before ? (changed ? version + 1 : version) : Math.max(1, Number(entry.version) || 1) };
  }
  return out;
}

/** Hash curto e estável da mecânica de uma Skill Racial (sem nível/XP/estado). */
export function skillDataHash(skill = {}) {
  const { key, level, xp, active, unlockLevel, ...rest } = skill ?? {};
  const json = JSON.stringify(rest, Object.keys(rest).sort());
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ molde */

/**
 * Molde do personagem: Espécie, depois Linhagem, depois cada Herança na ordem em que foi ganha.
 * Traços e elementos somam (e `removesTraits` tira); Skills e partes da camada mais nova
 * substituem as de mesma chave (`replaces.skills`/`replaces.parts`) — Herança substitui partes
 * pelo SLOT, porque chaves de parte mudam de Espécie para Espécie.
 * @param {{species?:object|null, speciesId?:string, lineage?:object|null, heritages?:Array<{id:string, entry:object}>, level?:number}} input
 */
export function resolveSpeciesTemplate({ species = null, speciesId = "", lineage = null, heritages = [], level = 1 } = {}) {
  const layers = [];
  if (species) layers.push({ kind: "species", id: speciesId, entry: normalizeSpeciesEntry(species) });
  if (lineage) layers.push({ kind: "lineage", id: lineage.id ?? "", entry: normalizeSpeciesEntry(lineage) });
  for (const h of heritages ?? []) if (h?.entry) layers.push({ kind: "heritage", id: h.id, entry: normalizeSpeciesEntry(h.entry) });

  let parts = [];
  let skills = [];
  const traits = new Set();
  const removedTraits = new Set();
  const elements = new Set();
  const locked = [];

  for (const layer of layers) {
    const source = { kind: layer.kind, id: layer.id };
    const e = layer.entry;
    for (const t of e.traits) traits.add(t);
    for (const t of e.removesTraits ?? []) removedTraits.add(t);
    for (const el of e.elements) elements.add(el);

    const replaceSkills = new Set(e.replaces?.skills ?? []);
    if (replaceSkills.size) skills = skills.filter(s => !replaceSkills.has(s.key));
    const replaceParts = new Set(e.replaces?.parts ?? []);
    const replaceSlots = new Set(e.replaces?.slots ?? []);
    if (replaceParts.size || replaceSlots.size) parts = parts.filter(p => !replaceParts.has(p.key) && !replaceSlots.has(p.slot));

    for (const p of e.parts) {
      parts = parts.filter(existing => existing.key !== p.key);
      parts.push({ key: p.key, label: p.label || p.key, slot: p.slot || "body", hpMax: Math.max(1, Number(p.hpMax) || 1), tags: p.tags ?? [], prosthetic: Boolean(p.prosthetic), source });
    }
    for (const s of e.skills) {
      const unlock = Number(s.unlockLevel) || 0;
      if (unlock > level) {
        locked.push({ key: s.key, name: s.name, unlockLevel: unlock, source });
        continue;
      }
      skills = skills.filter(existing => existing.key !== s.key);
      skills.push({ key: s.key, name: s.name, data: s, hash: skillDataHash(s), source });
    }
  }

  for (const t of removedTraits) traits.delete(t);
  return { speciesId, parts, skills, traits: [...traits], removedTraits: [...removedTraits], elements: [...elements], locked };
}

/* ------------------------------------------------------------------ trava do jogador */

/**
 * A Espécie trava para o jogador no primeiro "Confirmar" de Pontos de Atributo (`lockedAt`), ou
 * quando a ficha já tem pontos confirmados (fichas de antes do rework). O Mestre destrava com
 * `unlocked`, e um novo "Confirmar" trava de novo. O Mestre nunca é travado.
 */
export function isSpeciesLocked(system = {}) {
  const state = system.speciesState ?? {};
  if (state.unlocked) return false;
  if (state.lockedAt) return true;
  const combat = system.attributes?.combat ?? {};
  return Object.values(combat).some(attr => (Number(attr?.points) || 0) > 0);
}

/* ------------------------------------------------------------------ diff */

const lower = s => String(s ?? "").trim().toLowerCase();

/** Parte da ficha que veio de uma camada (marca de origem) ou de um preset antigo (`speciesOrigin`). */
function isGrantedPart(p) {
  return Boolean(p.grant) || Boolean(p.origin);
}

/** Skill Racial da ficha que veio de uma camada (marca) ou de um preset antigo (tier Racial). */
function isGrantedSkill(s) {
  if (s.itemGranted) return false; // Habilidade Concedida por Item/Módulo/Modificação: é da fonte, não da Espécie
  return Boolean(s.grant) || s.tier === "racial";
}

/**
 * Compara o molde com a ficha.
 *
 * Partes, nesta ordem: (1) mesma chave → a parte da ficha é ajustada (nome, slot, Vida máx.; a Vida
 * atual acompanha na proporção, próteses mantêm a própria Vida); (2) mesmo slot → a parte da ficha
 * vira a do molde, levando próteses e modificações junto; (3) o que sobra no molde é criado; (4) o
 * que sobra na ficha: com prótese/modificação fica como parte avulsa (nada se perde), sem nada é
 * removido — no modo "sync", só se `removeMissing`.
 *
 * Skills Raciais: mesma chave (ou mesmo nome, dados antigos) → fica, com nível e XP; no modo "sync"
 * a mecânica é atualizada quando o molde mudou. Sem par → é criada (restaurando nível/XP do
 * histórico, se já esteve nesta ficha). Na ficha sem par no molde → sai e vai para o histórico.
 *
 * @param {{parts:Array, skills:Array, archive?:Array}} current - ver actorSpeciesSnapshot em species.js
 * @param {ReturnType<typeof resolveSpeciesTemplate>} template
 * Modo "evolution" (Evoluir): como "change" para o corpo, mas as Skills Raciais que não têm par
 * na Espécie nova FICAM (com nível e XP) — evoluir soma, não apaga o que já se aprendeu.
 *
 * @param {{mode?:"change"|"sync"|"evolution", removeMissing?:boolean}} [options]
 */
export function speciesDiff(current = {}, template = {}, { mode = "change", removeMissing = false } = {}) {
  const allowRemove = mode !== "sync" || removeMissing;
  const allowRemoveSkills = mode === "evolution" ? false : allowRemove;
  const parts = { update: [], create: [], detach: [], remove: [], keep: [] };
  const skills = { keep: [], update: [], create: [], remove: [] };

  // ---- Partes
  const pending = (current.parts ?? []).filter(isGrantedPart).map(p => ({ ...p }));
  const tplParts = [...(template.parts ?? [])];
  const morph = (cur, tpl, how) => {
    const oldMax = Number(cur.hp?.max) || 0;
    const oldValue = Number(cur.hp?.value) || 0;
    // Prótese que a ficha já tinha mantém a própria Vida. Parte do molde que É prótese (Herança
    // "Convertido em Ciborgue") vira prótese nova; prótese que veio de uma Herança e deixa de
    // estar no molde volta a ser natural.
    const heritageProsthesis = cur.isProsthetic && cur.grant?.kind === "heritage";
    const keepOwnProsthesis = cur.isProsthetic && !heritageProsthesis && !tpl.prosthetic;
    const isProsthetic = tpl.prosthetic ? true : heritageProsthesis ? false : Boolean(cur.isProsthetic);
    const hpMax = keepOwnProsthesis ? oldMax : tpl.hpMax;
    const hpValue = keepOwnProsthesis ? oldValue : tpl.prosthetic && !cur.isProsthetic ? tpl.hpMax : oldMax > 0 ? Math.round((oldValue / oldMax) * tpl.hpMax) : tpl.hpMax;
    // Parte antiga sem marca de origem não conta como "mudou": ela ganha a marca quando a origem for
    // aplicada de novo (as partes "keep" também são gravadas), sem gerar aviso falso de desatualizada.
    const changed = cur.name !== tpl.label || cur.slot !== tpl.slot || hpMax !== oldMax || isProsthetic !== Boolean(cur.isProsthetic) || Boolean(cur.grant?.key && cur.grant.key !== tpl.key);
    const entry = { id: cur.id, key: tpl.key, label: tpl.label, slot: tpl.slot, hpMax, hpValue, source: tpl.source, tags: tpl.tags, from: { name: cur.name, max: oldMax, value: oldValue }, how, carries: cur.mods ?? [], isProsthetic, wasProsthetic: Boolean(cur.isProsthetic) };
    if (changed) parts.update.push(entry);
    else parts.keep.push(entry);
  };
  // (1) mesma chave; dado antigo sem chave: mesmo slot E mesmo nome
  for (const tpl of [...tplParts]) {
    const idx = pending.findIndex(p => (p.grant?.key ? p.grant.key === tpl.key : p.slot === tpl.slot && lower(p.name) === lower(tpl.label)));
    if (idx < 0) continue;
    morph(pending.splice(idx, 1)[0], tpl, "key");
    tplParts.splice(tplParts.indexOf(tpl), 1);
  }
  // (2) mesmo slot — prefere a parte que carrega prótese/modificação
  for (const tpl of [...tplParts]) {
    const candidates = pending.filter(p => p.slot === tpl.slot);
    if (!candidates.length) continue;
    const chosen = candidates.find(p => p.isProsthetic || (p.mods ?? []).length) ?? candidates[0];
    pending.splice(pending.indexOf(chosen), 1);
    morph(chosen, tpl, "slot");
    tplParts.splice(tplParts.indexOf(tpl), 1);
  }
  // (3) criar
  for (const tpl of tplParts) parts.create.push({ key: tpl.key, label: tpl.label, slot: tpl.slot, hpMax: tpl.hpMax, tags: tpl.tags, isProsthetic: tpl.prosthetic, source: tpl.source });
  // (4) sobras da ficha
  for (const cur of pending) {
    if (cur.isProsthetic || (cur.mods ?? []).length) parts.detach.push({ id: cur.id, name: cur.name, carries: cur.mods ?? [], isProsthetic: Boolean(cur.isProsthetic) });
    else if (allowRemove) parts.remove.push({ id: cur.id, name: cur.name, hp: cur.hp });
    else parts.keep.push({ id: cur.id, label: cur.name, outside: true });
  }

  // ---- Skills Raciais
  const pendingSkills = (current.skills ?? []).filter(isGrantedSkill).map(s => ({ ...s }));
  const archive = current.archive ?? [];
  for (const tpl of template.skills ?? []) {
    const idx = pendingSkills.findIndex(s => (s.grant?.key ? s.grant.key === tpl.key : lower(s.name) === lower(tpl.name)));
    if (idx >= 0) {
      const cur = pendingSkills.splice(idx, 1)[0];
      const entry = { id: cur.id, key: tpl.key, name: tpl.name, from: cur.name, level: cur.level, xp: cur.xp, data: tpl.data, hash: tpl.hash, source: tpl.source };
      // Só compara a mecânica quando a Skill já tem marca com hash (dados antigos: sem aviso falso).
      const mechanicsChanged = Boolean(cur.grant?.hash) && cur.grant.hash !== tpl.hash;
      // Sincronizar atualiza a mecânica quando o catálogo mudou; evoluir também (Regeneração Amorfa
      // → Regeneração Demoníaca: mesma chave, mecânica e nome novos, nível mantido).
      if ((mode === "sync" && mechanicsChanged) || (mode === "evolution" && cur.grant?.hash !== tpl.hash)) skills.update.push(entry);
      else skills.keep.push({ ...entry, needsMark: !cur.grant || cur.grant.key !== tpl.key });
      continue;
    }
    const saved = archive.find(a => a.key === tpl.key && a.source?.kind === tpl.source?.kind && a.source?.id === tpl.source?.id);
    skills.create.push({ key: tpl.key, name: tpl.name, data: tpl.data, hash: tpl.hash, source: tpl.source, restored: saved ? { level: saved.level, xp: saved.xp } : null });
  }
  for (const cur of pendingSkills) {
    if (allowRemoveSkills) skills.remove.push({ id: cur.id, name: cur.name, level: cur.level, xp: cur.xp, key: cur.grant?.key ?? speciesSlug(cur.name), source: cur.grant?.source ?? null });
    else if (mode === "evolution") skills.keep.push({ id: cur.id, key: cur.grant?.key ?? speciesSlug(cur.name), name: cur.name, level: cur.level, xp: cur.xp, fromPrevious: true });
  }

  const losses = [
    ...skills.remove.map(s => ({ kind: "skill", name: s.name, level: s.level, xp: s.xp })),
    ...parts.remove.map(p => ({ kind: "part", name: p.name }))
  ];
  const empty = !parts.update.length && !parts.create.length && !parts.detach.length && !parts.remove.length && !skills.update.length && !skills.create.length && !skills.remove.length;
  return { parts, skills, losses, empty, locked: template.locked ?? [] };
}

/* ------------------------------------------------------------------ dados da Skill criada */

/**
 * `system` de uma Skill Racial criada a partir do molde. A Skill Racial do catálogo é uma Skill
 * completa (editada no editor de Skill); aqui só se garantem tier, saneamento e os campos que o
 * DataModel espera. Nível/XP vêm do histórico quando a Skill volta.
 */
export function racialSkillSystem(s = {}, restored = null) {
  const effectType = isStructureMechanic(s) ? "structure" : MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(s.effectType) ? s.effectType : "none";
  const { key, unlockLevel, name, ...rest } = s;
  return {
    ...rest,
    tier: "racial",
    level: Math.max(1, Number(restored?.level ?? s.level) || 1),
    xp: Math.max(0, Number(restored?.xp) || 0),
    cost: Number(s.cost) || 0,
    effectType,
    targetType: MEU_SISTEMA.SKILL_TARGET_TYPES.includes(s.targetType) ? s.targetType : "targeted",
    damageElements: Array.isArray(s.damageElements) ? s.damageElements : [],
    effects: Array.isArray(s.effects) ? s.effects : [],
    description: s.description || "",
    active: false
  };
}

/* ------------------------------------------------------------------ passivos ao vivo */

const LAYER_KIND_LABELS = { species: "Espécie", lineage: "Linhagem", heritage: "Herança" };

/**
 * As camadas de origem de uma ficha, na ordem (Espécie → Linhagem → Heranças), só com o que é
 * lido AO VIVO: passivos, Escala e Deslocamento. Quem monta (species.js / character-model.js)
 * passa as entradas do catálogo já resolvidas.
 * @param {{species?:object|null, lineage?:object|null, heritages?:Array<{id:string, entry:object}>}} input
 */
export function originLayers({ species = null, lineage = null, heritages = [] } = {}) {
  const layers = [];
  const push = (kind, id, e) => {
    if (!e) return;
    layers.push({
      kind,
      id,
      label: e.label || id,
      kindLabel: LAYER_KIND_LABELS[kind],
      passives: e.passives ?? {},
      scale: e.scale ?? "",
      movement: e.movement ?? null,
      traits: e.traits ?? [],
      removesTraits: e.removesTraits ?? [],
      elements: e.elements ?? []
    });
  };
  push("species", "", species);
  push("lineage", lineage?.id ?? "", lineage);
  for (const h of heritages ?? []) push("heritage", h.id, h.entry);
  return layers;
}

/** Bônus de atributo das camadas (entra no Total, como Título): linhas com a fonte. */
export function originAttributeRows(layers, attribute) {
  const rows = [];
  for (const layer of layers ?? []) {
    let value = 0;
    for (const b of layer.passives?.attributeBonuses ?? []) if (b?.attribute === attribute) value += Number(b.amount) || 0;
    if (value) rows.push({ label: `${layer.kindLabel}: ${layer.label}`, value, kind: layer.kind });
  }
  return rows;
}

/** Vida/Mana máxima das camadas. */
export function originStatRows(layers, stat) {
  const rows = [];
  for (const layer of layers ?? []) {
    const value = Number(layer.passives?.statModifiers?.[stat]) || 0;
    if (value) rows.push({ label: `${layer.kindLabel}: ${layer.label}`, value, kind: layer.kind });
  }
  return rows;
}

/** Melhor Resistência (fração) das camadas para um alvo ("general" ou elemento). Conta como Título. */
export function originResistance(layers, target) {
  let best = 0;
  for (const layer of layers ?? []) {
    for (const r of layer.passives?.resistances ?? []) if (r?.target === target) best = Math.max(best, (Number(r.amount) || 0) / 100);
  }
  return best;
}

/** "Quando → Então" das camadas, agrupados pela camada (para "De onde vem"). */
export function originConditionalSources(layers) {
  return (layers ?? [])
    .filter(l => (l.passives?.conditionalModifiers ?? []).length)
    .map(l => ({ item: { name: `${l.kindLabel}: ${l.label}`, uuid: null }, mods: l.passives.conditionalModifiers }));
}

/** Escala: a camada mais nova que define uma vence; "" = nenhuma. */
export function originScale(layers) {
  let scale = "";
  for (const layer of layers ?? []) if (layer.scale) scale = layer.scale;
  return scale;
}

/** Deslocamento: base da camada mais nova que define; % de todas somados. */
export function originMovement(layers) {
  let base = null;
  let percent = 0;
  for (const layer of layers ?? []) {
    const m = layer.movement;
    if (!m) continue;
    if (m.base !== null && m.base !== undefined && m.base !== "") base = Math.max(0, Number(m.base) || 0);
    percent += Number(m.percent) || 0;
  }
  return { base, percent };
}


/* ------------------------------------------------------------------ Heranças: regras de convivência */

/**
 * Pode esta Herança cair neste personagem? Só AVISA (o Mestre arbitra e pode aplicar mesmo assim).
 * @param {object} heritage - entrada do catálogo (`allowedSpecies: {mode: "any"|"only"|"except", list}`, `excludes`)
 * @param {{species:string, heritages:string[]}} target
 * @param {Array<object>} catalog - todas as Heranças (o `excludes` vale nos dois sentidos)
 * @returns {string[]} motivos (vazio = tudo certo)
 */
export function heritageConflicts(heritage, { species = "", heritages = [] } = {}, catalog = []) {
  const reasons = [];
  if (!heritage) return reasons;
  const allowed = heritage.allowedSpecies ?? { mode: "any", list: [] };
  const list = allowed.list ?? [];
  if (allowed.mode === "only" && list.length && !list.includes(species)) reasons.push("species-not-allowed");
  if (allowed.mode === "except" && list.includes(species)) reasons.push("species-excluded");
  for (const other of heritages) {
    if (other === heritage.id) continue;
    const otherEntry = catalog.find(h => h.id === other);
    if ((heritage.excludes ?? []).includes(other) || (otherEntry?.excludes ?? []).includes(heritage.id)) reasons.push(`excludes:${other}`);
  }
  return reasons;
}

/* ------------------------------------------------------------------ Evolução */

/**
 * Destinos de evolução de uma Espécie, com o nível mínimo só como AVISO (`ready`).
 * @param {object} entry - Espécie atual (normalizada)
 * @param {number} level - nível do personagem
 * @param {Record<string, object>} catalog - todas as Espécies (para o nome e para ignorar destino apagado)
 */
export function evolutionOptions(entry, level, catalog = {}) {
  return (entry?.evolvesTo ?? [])
    .filter(e => e?.species && catalog[e.species])
    .map(e => {
      const minLevel = Number(e.minLevel) || 0;
      return {
        species: e.species,
        label: catalog[e.species].label || e.species,
        minLevel,
        ready: !minLevel || (Number(level) || 1) >= minLevel,
        missing: minLevel ? Math.max(0, minLevel - (Number(level) || 1)) : 0,
        hint: e.hint || "",
        keepLineage: e.keepLineage !== false,
        resistancesToImmunity: Boolean(e.resistancesToImmunity)
      };
    });
}

/**
 * Estilo Tensura: na evolução, as Resistências ELEMENTAIS sobem para o nível máximo (Imunidade).
 * A Geral nunca vira Imunidade (para em 50% — regra de computeResistancePercent).
 * @param {Array<{id:string, name:string, resistanceTarget:string, level:number}>} skills
 * @param {number} maxElementLevel
 */
export function evolutionResistanceUpgrades(skills, maxElementLevel = 10) {
  return (skills ?? [])
    .filter(s => s.resistanceTarget && s.resistanceTarget !== "general" && (Number(s.level) || 1) < maxElementLevel)
    .map(s => ({ id: s.id, name: s.name, target: s.resistanceTarget, level: Number(s.level) || 1, toLevel: maxElementLevel }));
}
