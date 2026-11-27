/**
 * Conjuntos (J12, 1.122.0) — as regras puras. Sem Foundry: o catálogo, a contagem de peças, as faixas,
 * os bônus somados, o plano de Habilidades concedidas, os textos e as conferências do Validar Mundo.
 *
 * **Modelo.** Um conjunto é `{id, label, for: "character"|"vessel", pieces: [{key, name, uuid?, kind}],
 * tiers: [{count, bonuses}]}`. A peça é reconhecida no Ator pelo `id` do conjunto gravado no Item
 * (`system.itemSet`; a cópia no Ator leva o campo) e a chave dela é o nome normalizado (`pieceKey`):
 * duas cópias do mesmo Item contam UMA vez. As faixas SOMAM (com 4 peças valem as de 2, 3 e 4).
 * `bonuses` tem a forma dos passivos de origem (assim a ficha lê tudo pelos mesmos leitores):
 * `attributeBonuses`, `statModifiers`, `resistances`, `luck`, `conditionalModifiers`, mais
 * `grantsSkill` (a Habilidade que a faixa concede) e `ship` (`[{target, amount}]`, só no conjunto de Nave).
 */
import { WHEN_LABELS, THEN_LABELS, THEN_KINDS, WHEN_KINDS } from "../combat/conditional-modifiers.js";

export const SET_FOR = Object.freeze(["character", "vessel"]);
export const SET_FOR_LABELS = Object.freeze({ character: "Personagem", vessel: "Nave/Veículo" });

/** Bônus de Nave que uma faixa pode dar (todos em % somado, exceto a Evasão, em pontos percentuais). */
export const SHIP_BONUS_TARGETS = Object.freeze(["evasion", "signature", "shieldCapacity", "shieldRegen", "reactorOutput", "propulsion", "armor"]);
export const SHIP_BONUS_LABELS = Object.freeze({
  evasion: "Evasão",
  signature: "Assinatura",
  shieldCapacity: "Capacidade do Escudo",
  shieldRegen: "Regeneração do Escudo",
  reactorOutput: "Geração de energia",
  propulsion: "Propulsão",
  armor: "Redução do Casco"
});

/** Prefixo da chave de origem das Habilidades concedidas por faixa (`flags.<sistema>.grantedBySource`). */
export const SET_SKILL_PREFIX = "set:";

const int = value => Math.round(Number(value) || 0);
const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/** Texto → id (sem acento, minúsculo, `_`). */
export function setSlug(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A chave de uma peça: o nome sem acento, em minúsculas e sem espaços sobrando. Duas peças com a mesma chave são a mesma. */
export function pieceKey(name) {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ bônus */

/** Os bônus de uma faixa, limpos: só chaves conhecidas, números inteiros, nada vazio. */
export function normalizeBonuses(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  const attributeBonuses = (Array.isArray(src.attributeBonuses) ? src.attributeBonuses : [])
    .map(b => ({ attribute: String(b?.attribute ?? "").trim(), amount: int(b?.amount) }))
    .filter(b => b.attribute && b.amount);
  if (attributeBonuses.length) out.attributeBonuses = attributeBonuses;
  const hp = int(src.statModifiers?.hp);
  const energy = int(src.statModifiers?.energy);
  if (hp || energy) out.statModifiers = { hp, energy };
  const resistances = (Array.isArray(src.resistances) ? src.resistances : [])
    .map(r => ({ target: String(r?.target ?? "").trim(), amount: Math.min(100, Math.max(-300, int(r?.amount))) }))
    .filter(r => r.target && r.amount);
  if (resistances.length) out.resistances = resistances;
  const luck = { attributes: Number(src.luck?.attributes) || 0, damage: Number(src.luck?.damage) || 0, chances: Number(src.luck?.chances) || 0 };
  if (luck.attributes || luck.damage || luck.chances) out.luck = luck;
  const rules = (Array.isArray(src.conditionalModifiers) ? src.conditionalModifiers : [])
    .filter(r => r && typeof r === "object" && THEN_KINDS.includes(r.then?.kind) && WHEN_KINDS.includes(r.when?.kind || "always"))
    .map(r => clone(r));
  if (rules.length) out.conditionalModifiers = rules;
  const skill = src.grantsSkill;
  if (skill && typeof skill === "object" && String(skill.name ?? "").trim()) out.grantsSkill = clone(skill);
  const ship = (Array.isArray(src.ship) ? src.ship : [])
    .map(s => ({ target: String(s?.target ?? ""), amount: Number(s?.amount) || 0 }))
    .filter(s => SHIP_BONUS_TARGETS.includes(s.target) && s.amount);
  if (ship.length) out.ship = ship;
  return out;
}

/** Nenhum bônus. */
export function bonusesEmpty(bonuses) {
  return Object.keys(normalizeBonuses(bonuses)).length === 0;
}

/**
 * Soma os bônus de várias faixas no formato dos passivos de origem (`attributeBonuses`, `statModifiers`,
 * `resistances`, `luck`, `conditionalModifiers`) mais `ship` (`{alvo: total}`) e `grantsSkills`.
 */
export function mergeBonuses(list) {
  const passives = {};
  const ship = {};
  const stat = { hp: 0, energy: 0 };
  const luck = { attributes: 0, damage: 0, chances: 0 };
  for (const raw of list ?? []) {
    const b = normalizeBonuses(raw);
    if (b.attributeBonuses) (passives.attributeBonuses ??= []).push(...clone(b.attributeBonuses));
    if (b.statModifiers) {
      stat.hp += b.statModifiers.hp;
      stat.energy += b.statModifiers.energy;
    }
    if (b.resistances) (passives.resistances ??= []).push(...clone(b.resistances));
    if (b.luck) {
      luck.attributes += b.luck.attributes;
      luck.damage += b.luck.damage;
      luck.chances += b.luck.chances;
    }
    if (b.conditionalModifiers) (passives.conditionalModifiers ??= []).push(...clone(b.conditionalModifiers));
    for (const s of b.ship ?? []) ship[s.target] = (ship[s.target] ?? 0) + s.amount;
  }
  if (stat.hp || stat.energy) passives.statModifiers = stat;
  if (luck.attributes || luck.damage || luck.chances) passives.luck = luck;
  return { passives, ship };
}

/* ------------------------------------------------------------------ catálogo */

/** Uma peça do catálogo: chave pelo nome, `uuid` opcional, `kind` é só uma etiqueta. */
export function normalizePiece(raw) {
  const name = String(raw?.name ?? "").trim();
  if (!name) return null;
  const piece = { key: pieceKey(name), name, kind: String(raw?.kind ?? "").trim() };
  const uuid = String(raw?.uuid ?? "").trim();
  if (uuid) piece.uuid = uuid;
  return piece;
}

/** Um conjunto do catálogo, com todos os campos; `null` sem nome nem id. */
export function normalizeItemSet(raw) {
  if (!raw || typeof raw !== "object") return null;
  const label = String(raw.label ?? "").trim();
  const id = setSlug(raw.id || label);
  if (!id) return null;
  const seen = new Set();
  const pieces = [];
  for (const p of Array.isArray(raw.pieces) ? raw.pieces : []) {
    const piece = normalizePiece(p);
    if (!piece || seen.has(piece.key)) continue;
    seen.add(piece.key);
    pieces.push(piece);
  }
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map(t => ({ count: Math.max(1, int(t?.count) || 1), bonuses: normalizeBonuses(t?.bonuses) }))
    .sort((a, b) => a.count - b.count);
  return { id, label: label || id, for: raw.for === "vessel" ? "vessel" : "character", pieces, tiers };
}

/** O catálogo inteiro: sem entradas inválidas nem ids repetidos (a primeira vence). */
export function normalizeItemSets(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const set = normalizeItemSet(raw);
    if (!set || seen.has(set.id)) continue;
    seen.add(set.id);
    out.push(set);
  }
  return out;
}

/** Os conjuntos de fábrica que o catálogo atual ainda não tem (pelo id): "Trazer do padrão…" nunca sobrescreve. */
export function missingFactorySets(current, factory) {
  const have = new Set((current ?? []).map(s => s?.id));
  return normalizeItemSets(factory).filter(s => !have.has(s.id));
}

/** Acrescenta uma peça (sem repetir a chave). Devolve a lista nova. */
export function addPiece(pieces, raw) {
  const piece = normalizePiece(raw);
  const list = clone(pieces ?? []);
  if (!piece) return list;
  const at = list.findIndex(p => p.key === piece.key);
  if (at >= 0) list[at] = { ...list[at], ...piece, kind: piece.kind || list[at].kind };
  else list.push(piece);
  return list;
}

/** Etiqueta da peça a partir do Item (`{type, system}`): arma, implante, prótese, consumível, módulo… ou "item". */
export function pieceKindOf(item) {
  const sys = item?.system ?? {};
  if (item?.type === "starship_module") return "módulo";
  if (sys.implant?.enabled) return sys.implant.kind === "prosthesis" ? "prótese" : "implante";
  if (sys.weapon?.enabled) return "arma";
  if (sys.consumable?.enabled) return "consumível";
  return "item";
}

/** O conjunto escolhido serve a este Item? Item Geral → de Personagem; Módulo → de Nave/Veículo. */
export function setFitsItemType(set, itemType) {
  if (!set) return false;
  return itemType === "starship_module" ? set.for === "vessel" : set.for === "character";
}

/* ------------------------------------------------------------------ contagem e faixas */

/**
 * O andamento de um conjunto: `owned` = as chaves das peças que contam agora (já sem as suprimidas e as
 * não equipadas). `count` nunca passa do total do catálogo (quando o catálogo tem peças). Pura.
 * @returns {{id:string, label:string, for:string, count:number, total:number, tiers:Array<{count:number, on:boolean, bonuses:object}>, activeTiers:Array, nextTier:object|null}}
 */
export function setProgress(set, owned) {
  const keys = owned instanceof Set ? owned : new Set(owned ?? []);
  const total = set.pieces.length;
  const count = total > 0 ? Math.min(keys.size, total) : keys.size;
  const tiers = set.tiers.map(t => ({ count: t.count, on: count >= t.count, bonuses: t.bonuses }));
  return {
    id: set.id,
    label: set.label,
    for: set.for,
    count,
    total,
    tiers,
    activeTiers: tiers.filter(t => t.on),
    nextTier: tiers.find(t => !t.on) ?? null
  };
}

/**
 * O andamento de todos os conjuntos de um tipo (`for`) que têm ao menos uma peça agora.
 * @param {Array<object>} sets - o catálogo normalizado
 * @param {Array<{setId:string, key:string}>} pieces - as peças que contam no Ator
 * @param {"character"|"vessel"} kind
 */
export function evaluateSets(sets, pieces, kind = "character") {
  const bySet = new Map();
  for (const p of pieces ?? []) {
    if (!p?.setId || !p.key) continue;
    if (!bySet.has(p.setId)) bySet.set(p.setId, new Set());
    bySet.get(p.setId).add(p.key);
  }
  const out = [];
  for (const set of sets ?? []) {
    if (set.for !== kind) continue;
    const owned = bySet.get(set.id);
    if (!owned?.size) continue;
    out.push(setProgress(set, owned));
  }
  return out;
}

/** O nome de um conjunto com o andamento: "Armadura do Dragão (3/4)". */
export function setProgressLabel(progress) {
  return `${progress.label} (${progress.count}/${progress.total || progress.count})`;
}

/**
 * Uma peça de fábrica semeada na 1.122.0 ainda é a versão antiga e vazia do Sensor de Caça (sem função Sensor, alcance nem
 * Resolução)? Só então a 1.122.1 a conserta; se o Mestre mexeu em qualquer um desses campos, fica como está. Pura.
 */
export function isBareSensorPiece(system) {
  const functions = system?.functions ?? [];
  return !functions.length && !(Number(system?.sensorRange) > 0) && !(Number(system?.sensorResolution) > 0);
}

/**
 * A camada de origem de um conjunto (mesmo formato de `originLayers`), ou `null` sem faixa ligada. Fica SEM
 * `attributeBonuses`: o bônus de atributo da Espécie entra no Total (e na Vida/Mana), o do Item não — o do conjunto
 * é do Item e sai por `setAttributeRows`.
 */
export function setLayer(progress) {
  if (!progress?.activeTiers.length) return null;
  const { passives } = mergeBonuses(progress.activeTiers.map(t => t.bonuses));
  delete passives.attributeBonuses;
  if (!Object.keys(passives).length) return null;
  const label = setProgressLabel(progress);
  return {
    kind: "set",
    id: progress.id,
    label,
    kindLabel: "Conjunto",
    passives,
    scale: "",
    movement: null,
    traits: [],
    removesTraits: [],
    elements: [],
    entry: { label, passives }
  };
}

/** As parcelas de bônus de atributo (por fora, como as do Item equipado) de um atributo: uma linha por conjunto. */
export function setAttributeRows(progressList, attribute) {
  const rows = [];
  for (const progress of progressList ?? []) {
    const { passives } = mergeBonuses(progress.activeTiers.map(t => t.bonuses));
    let value = 0;
    for (const b of passives.attributeBonuses ?? []) if (b.attribute === attribute) value += b.amount;
    if (value) rows.push({ label: `Conjunto: ${setProgressLabel(progress)}`, value, setId: progress.id });
  }
  return rows;
}

/** O total de cada bônus de Nave (`{alvo: soma}`) das faixas ligadas. */
export function shipBonusTotals(progressList) {
  const { ship } = mergeBonuses((progressList ?? []).flatMap(p => p.activeTiers.map(t => t.bonuses)));
  return ship;
}

/** A chave de origem da Habilidade concedida por uma faixa. */
export function setSkillKey(setId, count) {
  return `${SET_SKILL_PREFIX}${setId}:${count}`;
}

/**
 * O que fazer com as Habilidades concedidas por faixa: criar as que a faixa ligada pede e ainda não existem,
 * apagar as que sobraram (faixa caiu, conjunto sumiu). Nunca duplica: a chave decide. Pura.
 * @param {Array<object>} progressList
 * @param {string[]} existingKeys - os `grantedBySource` de Skills do Ator que começam com o prefixo
 */
export function grantedSkillPlan(progressList, existingKeys) {
  const wanted = new Map();
  for (const progress of progressList ?? []) {
    for (const tier of progress.activeTiers) {
      const skill = tier.bonuses?.grantsSkill;
      if (skill?.name) wanted.set(setSkillKey(progress.id, tier.count), skill);
    }
  }
  const have = new Set((existingKeys ?? []).filter(k => String(k).startsWith(SET_SKILL_PREFIX)));
  return {
    create: [...wanted].filter(([key]) => !have.has(key)).map(([key, grantsSkill]) => ({ key, grantsSkill })),
    remove: [...have].filter(key => !wanted.has(key))
  };
}

/* ------------------------------------------------------------------ textos */

const sign = n => (n > 0 ? `+${n}` : String(n));

/**
 * As frases de uma faixa ("Resistência a Fogo 20%", "+1 Defesa", "Habilidade concedida: X"…).
 * @param {object} bonuses
 * @param {{attributeLabel?:(key:string)=>string, targetLabel?:(id:string)=>string, energyLabel?:string, shipLabel?:(id:string)=>string}} [labels]
 */
export function describeBonuses(bonuses, labels = {}) {
  const attributeLabel = labels.attributeLabel ?? (k => k);
  const targetLabel = labels.targetLabel ?? (id => id);
  const energyLabel = labels.energyLabel ?? "Energia";
  const b = normalizeBonuses(bonuses);
  const out = [];
  for (const r of b.resistances ?? []) {
    const name = r.target === "general" ? "geral" : targetLabel(r.target);
    out.push(r.amount < 0 ? `Fraqueza a ${name} ${-r.amount}%` : r.target === "general" ? `Resistência geral ${r.amount}%` : `Resistência a ${name} ${r.amount}%`);
  }
  for (const a of b.attributeBonuses ?? []) out.push(`${sign(a.amount)} ${attributeLabel(a.attribute)}`);
  if (b.statModifiers?.hp) out.push(`Vida máx. ${sign(b.statModifiers.hp)}`);
  if (b.statModifiers?.energy) out.push(`${energyLabel} máx. ${sign(b.statModifiers.energy)}`);
  if (b.luck) {
    const parts = [["atributos", b.luck.attributes], ["dano", b.luck.damage], ["chances", b.luck.chances]].filter(([, v]) => v);
    out.push(`Sorte ${parts.map(([n, v]) => `${sign(v)}% ${n}`).join(", ")}`);
  }
  for (const s of b.ship ?? []) out.push(`${(labels.shipLabel ?? (id => SHIP_BONUS_LABELS[id] ?? id))(s.target)} ${sign(s.amount)}%`);
  if (b.grantsSkill) out.push(`Habilidade concedida: ${b.grantsSkill.name}`);
  for (const r of b.conditionalModifiers ?? []) {
    const when = WHEN_LABELS[r.when?.kind || "always"] ?? r.when?.kind;
    const what = r.then?.kind === "attributeFlat" || r.then?.kind === "attributePercent" || r.then?.kind === "rollFlat"
      ? `${sign(Number(r.then.value) || 0)}${r.then.kind === "attributePercent" ? "%" : ""} ${r.then.target && r.then.target !== "any" ? attributeLabel(r.then.target) : "atributo"}`
      : `${sign(Number(r.then?.value) || 0)}${THEN_LABELS[r.then?.kind]?.startsWith("%") ? "%" : ""} ${(THEN_LABELS[r.then?.kind] ?? "").replace(/^% de /, "")}`;
    out.push(`Quando ${String(when).toLowerCase()} → ${what}`);
  }
  return out;
}

/** A faixa do inventário/da ficha de Nave: título, pips e uma linha por faixa (ligada ou esmaecida). */
export function setStripView(progress, labels = {}) {
  const total = progress.total || progress.count;
  return {
    id: progress.id,
    label: progress.label,
    count: progress.count,
    total,
    pips: Array.from({ length: total }, (_, i) => ({ on: i < progress.count })),
    tiers: progress.tiers.map(t => ({ count: t.count, on: t.on, text: describeBonuses(t.bonuses, labels).join(" · ") || "—" }))
  };
}

/* ------------------------------------------------------------------ Validar Mundo */

/**
 * Problemas do catálogo: conjunto sem peças, faixa maior que o número de peças, faixa sem bônus, faixas repetidas,
 * alvo de Resistência/atributo que não existe. `ctx` traz os ids existentes (`elementIds`, `attributeKeys`).
 * @returns {Array<{setId:string, label:string, text:string}>}
 */
export function itemSetIssues(sets, { elementIds = null, attributeKeys = null } = {}) {
  const issues = [];
  const say = (set, text) => issues.push({ setId: set.id, label: set.label, text });
  const seen = new Map();
  for (const set of sets ?? []) {
    seen.set(set.id, (seen.get(set.id) ?? 0) + 1);
    if (!set.pieces.length) say(set, "o conjunto não tem nenhuma peça");
    if (!set.tiers.length) say(set, "o conjunto não tem nenhuma faixa de bônus");
    const counts = new Set();
    for (const tier of set.tiers) {
      if (set.pieces.length && tier.count > set.pieces.length) say(set, `a faixa de ${tier.count} peças é maior que o número de peças (${set.pieces.length}): nunca liga`);
      if (counts.has(tier.count)) say(set, `há duas faixas de ${tier.count} peças (as duas valem)`);
      counts.add(tier.count);
      if (bonusesEmpty(tier.bonuses)) say(set, `a faixa de ${tier.count} peças não dá nenhum bônus`);
      for (const r of tier.bonuses.resistances ?? []) {
        if (elementIds && r.target !== "general" && !elementIds.has(r.target)) say(set, `a faixa de ${tier.count} peças resiste a "${r.target}", que não existe no catálogo de elementos`);
      }
      for (const a of tier.bonuses.attributeBonuses ?? []) {
        if (attributeKeys && !attributeKeys.has(a.attribute)) say(set, `a faixa de ${tier.count} peças dá bônus em "${a.attribute}", que não é um atributo`);
      }
      if (set.for !== "vessel" && tier.bonuses.ship?.length) say(set, `a faixa de ${tier.count} peças tem bônus de Nave num conjunto de Personagem (não vale)`);
      if (set.for === "vessel" && (tier.bonuses.attributeBonuses || tier.bonuses.statModifiers || tier.bonuses.resistances || tier.bonuses.luck || tier.bonuses.conditionalModifiers || tier.bonuses.grantsSkill)) {
        say(set, `a faixa de ${tier.count} peças tem bônus de Personagem num conjunto de Nave (só os bônus de Nave valem)`);
      }
    }
  }
  for (const [id, n] of seen) if (n > 1) issues.push({ setId: id, label: id, text: `o id "${id}" aparece ${n} vezes no catálogo` });
  return issues;
}

/**
 * Itens/Módulos cujo `itemSet` não está no catálogo (ou é de outro tipo de conjunto).
 * @param {Array<{label:string, type:string, setId:string}>} owners
 */
export function itemSetRefIssues(owners, sets) {
  const byId = new Map((sets ?? []).map(s => [s.id, s]));
  const issues = [];
  for (const o of owners ?? []) {
    if (!o.setId) continue;
    const set = byId.get(o.setId);
    if (!set) issues.push({ label: o.label, text: `pertence ao conjunto "${o.setId}", que não existe no catálogo` });
    else if (!setFitsItemType(set, o.type)) issues.push({ label: o.label, text: `pertence ao conjunto "${set.label}", que é de ${SET_FOR_LABELS[set.for]} (não combina com este tipo de Item)` });
  }
  return issues;
}

/* ------------------------------------------------------------------ IA */

/** O texto que explica ao modelo o formato de um conjunto e os ids que existem neste mundo. Puro. */
export function itemSetGuide({ attributes = [], elements = [] } = {}, forKind = "character") {
  const ids = list => list.map(x => `${x.id ?? x.key} (${x.label})`).join(", ") || "nenhum";
  if (forKind === "vessel") {
    return [
      "Crie UM conjunto de Módulos de nave: 2 a 4 Módulos que, instalados juntos na mesma nave, dão bônus por faixa.",
      "Responda só com JSON: {\"label\": string, \"for\": \"vessel\", \"pieces\": [{\"name\": string, \"kind\": \"módulo\"}], \"tiers\": [{\"count\": 2, \"bonuses\": {\"ship\": [{\"target\": string, \"amount\": number}]}}]}.",
      `Alvos de bônus de nave permitidos: ${SHIP_BONUS_TARGETS.map(t => `${t} (${SHIP_BONUS_LABELS[t]})`).join(", ")}. Valores em % (a Evasão e a Redução do Casco em pontos), entre -30 e 30.`,
      "As faixas SOMAM (com 3 peças valem a de 2 e a de 3). Cada faixa tem count de 2 até o número de peças."
    ].join("\n");
  }
  return [
    "Crie UM conjunto de equipamento de personagem: 2 a 6 peças (armadura, roupa, arma, implante, acessório) que, usadas juntas, dão bônus por faixa.",
    "Responda só com JSON: {\"label\": string, \"for\": \"character\", \"pieces\": [{\"name\": string, \"kind\": string}], \"tiers\": [{\"count\": 2, \"bonuses\": {\"attributeBonuses\": [{\"attribute\": string, \"amount\": number}], \"statModifiers\": {\"hp\": number, \"energy\": number}, \"resistances\": [{\"target\": string, \"amount\": number}], \"luck\": {\"attributes\": number, \"damage\": number, \"chances\": number}, \"grantsSkill\": {\"name\": string, \"description\": string, \"cost\": number}}}]}.",
    "Todo campo de bônus é opcional: use só o que faz sentido. Atributo: bônus pequenos (-5 a 5). Vida/Mana máximas: até 200. Resistência: % de 1 a 60 (alvo \"general\" = geral).",
    `Atributos que existem: ${ids(attributes)}.`,
    `Elementos de dano que existem (alvos de Resistência): ${ids(elements)}.`,
    "As faixas SOMAM (com 4 peças valem as de 2, 3 e 4). Cada faixa tem count de 2 até o número de peças. A Habilidade concedida só leva nome, descrição e custo."
  ].join("\n");
}

/**
 * Limpa um conjunto vindo da IA: só atributos e elementos que existem, números sãos, no máximo 6 peças e 4 faixas,
 * sem Habilidade concedida inventada com mecânica quebrada (fica só o nome, a descrição e o custo).
 * @param {object} raw
 * @param {{attributeKeys:Set<string>, elementIds:Set<string>, existingIds?:Set<string>}} ctx
 */
export function sanitizeAISet(raw, { attributeKeys, elementIds, existingIds = new Set() }) {
  if (!raw || typeof raw !== "object") return null;
  const label = String(raw.label ?? raw.name ?? "").trim().slice(0, 60);
  if (!label) return null;
  let id = setSlug(label);
  for (let n = 2; existingIds.has(id); n++) id = `${setSlug(label)}_${n}`;
  const pieces = (Array.isArray(raw.pieces) ? raw.pieces : [])
    .map(p => (typeof p === "string" ? { name: p } : { name: p?.name, kind: p?.kind }))
    .map(p => ({ name: String(p.name ?? "").trim().slice(0, 60), kind: String(p.kind ?? "").trim().slice(0, 20) }))
    .filter(p => p.name)
    .slice(0, 6);
  const vessel = raw.for === "vessel";
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : []).slice(0, 4).map(t => {
    const b = normalizeBonuses(t?.bonuses);
    const clean = {};
    if (!vessel) {
      if (b.attributeBonuses) clean.attributeBonuses = b.attributeBonuses.filter(a => attributeKeys.has(a.attribute)).map(a => ({ ...a, amount: Math.max(-5, Math.min(5, a.amount)) }));
      if (b.statModifiers) clean.statModifiers = { hp: Math.max(-200, Math.min(200, b.statModifiers.hp)), energy: Math.max(-200, Math.min(200, b.statModifiers.energy)) };
      if (b.resistances) clean.resistances = b.resistances.filter(r => r.target === "general" || elementIds.has(r.target)).map(r => ({ ...r, amount: Math.max(-100, Math.min(60, r.amount)) }));
      if (b.luck) clean.luck = { attributes: Math.max(-30, Math.min(30, b.luck.attributes)), damage: Math.max(-30, Math.min(30, b.luck.damage)), chances: Math.max(-30, Math.min(30, b.luck.chances)) };
      if (b.grantsSkill) {
        const s = b.grantsSkill;
        clean.grantsSkill = { name: String(s.name).slice(0, 60), tier: "normal", level: 1, cost: Math.max(0, Math.min(100, int(s.cost))), effectType: "none", description: String(s.description ?? "").slice(0, 600) };
      }
    } else if (b.ship) clean.ship = b.ship.map(s => ({ ...s, amount: Math.max(-50, Math.min(50, s.amount)) }));
    return { count: Math.max(2, int(t?.count) || 2), bonuses: normalizeBonuses(clean) };
  }).filter(t => !bonusesEmpty(t.bonuses));
  const set = normalizeItemSet({ id, label, for: vessel ? "vessel" : "character", pieces, tiers });
  if (!set || !set.pieces.length || !set.tiers.length) return null;
  set.tiers = set.tiers.filter(t => t.count <= set.pieces.length);
  return set.tiers.length ? set : null;
}
