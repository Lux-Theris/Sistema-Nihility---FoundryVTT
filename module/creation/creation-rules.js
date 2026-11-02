/**
 * Ficha em modo criação (J10) e pedido de Skill com mecânica — a parte pura, sem Foundry.
 * Design aprovado: artefato "Ficha em Modo Criação" (versão 2), pranchas 1–5.
 * Testado em test/creation.test.mjs.
 */
import { resolveSpeciesTemplate } from "../species/species-rules.js";

/* ------------------------------------------------------------------ Pedido de Skill */

/**
 * O que um pedido de Skill pode trazer de mecânica. Fica de fora o que só nasce de Fusão/Evolução
 * (Sub-Skills, linhagem) e o que a aprovação decide sozinha (Nível 1, desligada, sem XP).
 */
export const REQUEST_MECHANIC_FIELDS = [
  "cost", "hasUpkeep", "upkeepCost", "variableMana", "magicTag", "animationPath", "description", "resistanceTarget",
  "effectType", "damageFormula", "scalingAttribute", "isMagicDamage", "isAbsoluteDamage", "damageScale", "damageElements", "effects",
  "targetType", "structureId", "areaShape", "areaDistance", "areaAngle", "zoneRounds"
];

/** Pedido que ainda pode mudar: aguardando o Mestre, ou devolvido para ajustar. */
export const OPEN_REQUEST_STATUSES = ["pending", "changes"];

export function isOpenRequest(status) {
  return OPEN_REQUEST_STATUSES.includes(status);
}

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const wholeNumber = value => Math.max(0, Math.round(Number(value) || 0));

/**
 * Os dados (`system`) da Skill que um pedido aprovado cria. O pedido veio do jogador: só os campos
 * da lista entram, o Tier é o do ponto gasto, e Nível/estado são os de uma Skill nova.
 * @param {object} mech - o que o editor devolveu (ou o que estava no pedido)
 * @param {string} tier
 */
export function requestSkillSystem(mech = {}, tier = "normal") {
  const system = { tier, level: 1, xp: 0, active: false };
  for (const field of REQUEST_MECHANIC_FIELDS) {
    if (mech?.[field] !== undefined && mech[field] !== null) system[field] = clone(mech[field]);
  }
  system.cost = wholeNumber(system.cost);
  system.hasUpkeep = Boolean(system.hasUpkeep);
  system.upkeepCost = system.hasUpkeep ? wholeNumber(system.upkeepCost) : 0;
  system.description = typeof system.description === "string" ? system.description : "";
  if (!Array.isArray(system.effects)) system.effects = [];
  if (!Array.isArray(system.damageElements)) system.damageElements = [];
  // Estrutura era Tipo de Alvo em 1.37: um pedido antigo que ainda diga isso vira a Mecânica.
  if (system.targetType === "structure") {
    system.effectType = "structure";
    system.targetType = "targeted";
  }
  return system;
}

/**
 * "Skills N/M" da faixa e "1 ponto livre" do botão: Skills compradas com ponto que a ficha já tem,
 * pedidos abertos e pontos que sobram (os pedidos abertos já estão reservados).
 * @param {{owned:number, pending:number, points:number}} counts - `points` = pontos que a ficha tem agora
 */
export function skillSlots({ owned = 0, pending = 0, points = 0 } = {}) {
  const free = Math.max(0, points - pending);
  const used = owned + pending;
  return { used, total: used + free, free, done: used + free > 0 && free === 0 };
}

/* ------------------------------------------------------------------ Faixa "Criando" */

/**
 * Os itens da faixa (prancha 1) e se "Pronto para jogar" já pode. "Pronto" pede só nome e Espécie
 * (quando a campanha tem Espécies); ponto sobrando ou Skill não pedida só ficam em amarelo.
 * @param {object} state
 * @param {string} state.name
 * @param {string} state.concept
 * @param {boolean} state.speciesNeeded - a campanha tem Espécies para escolher
 * @param {string} state.speciesLabel - "" sem Espécie
 * @param {{spent:number,total:number}|null} state.pool - null com o Pool desligado
 * @param {{used:number,total:number,done:boolean}|null} state.skills - null sem Pontos de Habilidade
 */
export function creationSteps({ name = "", concept = "", speciesNeeded = true, speciesLabel = "", pool = null, skills = null } = {}) {
  const steps = [{ id: "concept", label: "Conceito", done: Boolean(String(concept).trim()) }];
  if (speciesNeeded) steps.push({ id: "origin", label: speciesLabel || "Origem", done: Boolean(speciesLabel) });
  if (pool) steps.push({ id: "points", label: `Pontos ${pool.spent}/${pool.total}`, done: pool.total > 0 ? pool.spent >= pool.total : true });
  if (skills) steps.push({ id: "skills", label: `Skills ${skills.used}/${skills.total}`, done: skills.total > 0 ? skills.done : true });

  const canReady = Boolean(String(name).trim()) && (!speciesNeeded || Boolean(speciesLabel));
  const current = steps.find(s => !s.done)?.id ?? "";
  steps.forEach((step, index) => {
    step.number = index + 1;
    step.current = step.id === current;
    // Com o básico pronto, o que falta de pontos/Skills fica em amarelo, sem travar.
    step.warn = !step.done && canReady && (step.id === "points" || step.id === "skills");
  });
  return { steps, current, canReady, doneCount: steps.filter(s => s.done).length, total: steps.length };
}

/** A linha da lista "Em criação" do Mestre (prancha 5 B). */
export function creationStatusRow(status, doneCount, total) {
  if (status === "ready") return { label: "aguardando você", kind: "wait" };
  if (status === "adjust") return { label: "ajuste pedido", kind: "adjust" };
  return { label: `criando · ${doneCount} de ${total}`, kind: "creating" };
}

/* ------------------------------------------------------------------ Atributos */

/**
 * "Começar de um jeito" (prancha 2 D): distribuições prontas. Não são classes — só preenchem os
 * pontos pendentes. Peso 0 = não recebe nada.
 */
export const QUICK_SPREADS = {
  lutador: { label: "Lutador", weights: { strength: 3, defense: 3, dexterity: 2, magic: 1, magicalDefense: 1, perception: 1, precision: 1 } },
  conjurador: { label: "Conjurador", weights: { magic: 3, magicalDefense: 3, defense: 2, strength: 1, perception: 1, dexterity: 1 } },
  agil: { label: "Ágil", weights: { dexterity: 3, stealth: 2, perception: 2, precision: 2, strength: 1, defense: 1 } },
  equilibrado: { label: "Equilibrado", weights: { strength: 1, defense: 1, magic: 1, magicalDefense: 1, dexterity: 1, stealth: 1, perception: 1, precision: 1 } }
};

/**
 * Reparte `total` pontos inteiros pelos pesos (maior resto primeiro; empate na ordem de `keys`).
 * Só os atributos em `keys` entram (os que a campanha mostra).
 * @returns {Record<string, number>}
 */
export function quickSpread(total, weights = {}, keys = Object.keys(weights)) {
  const points = wholeNumber(total);
  const active = keys.filter(key => (Number(weights[key]) || 0) > 0);
  const out = Object.fromEntries(keys.map(key => [key, 0]));
  const sum = active.reduce((s, key) => s + Number(weights[key]), 0);
  if (!points || !sum) return out;
  const shares = active.map((key, order) => {
    const exact = (points * Number(weights[key])) / sum;
    return { key, base: Math.floor(exact), rest: exact - Math.floor(exact), order };
  });
  let left = points - shares.reduce((s, share) => s + share.base, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.order - b.order)) {
    if (left <= 0) break;
    share.base += 1;
    left -= 1;
  }
  for (const share of shares) out[share.key] = share.base;
  return out;
}

/**
 * O painel "Ao confirmar" (prancha 2 B): Vida e Mana de agora e com os pontos pendentes, pela
 * mesma fórmula da ficha (`max(piso, A × B × multiplicador)`). Só a parte da fórmula muda; o que
 * Títulos, Skills e efeitos somam por cima fica igual.
 * @param {object} args
 * @param {Record<string,{total:number, pending:number}>} args.combat
 * @param {{hp:string[], energy:string[], multiplier:number, floor:number, energyEnabled:boolean}} args.formula
 * @param {number} args.hpNow
 * @param {number} args.energyNow
 */
export function vitalPreview({ combat = {}, formula, hpNow = 0, energyNow = 0 } = {}) {
  const total = key => Number(combat[key]?.total) || 0;
  const next = key => total(key) + (Number(combat[key]?.pending) || 0);
  const base = (read, [a, b]) => Math.max(formula.floor, Math.round(read(a) * read(b) * formula.multiplier));
  const line = (pair, now) => ({
    now,
    next: Math.max(0, now - base(total, pair) + base(next, pair)),
    a: { key: pair[0], value: next(pair[0]) },
    b: { key: pair[1], value: next(pair[1]) }
  });
  return {
    hp: line(formula.hp, hpNow),
    energy: formula.energyEnabled ? line(formula.energy, energyNow) : null,
    changed: Object.values(combat).some(attr => (Number(attr?.pending) || 0) > 0)
  };
}

const PURPOSE = {
  strength: "dano corpo a corpo",
  defense: "aguentar golpes",
  magic: "poder das Skills",
  magicalDefense: "menos dano mágico",
  dexterity: "agilidade",
  stealth: "passar despercebido",
  perception: "notar o que está escondido",
  precision: "pontaria"
};

/**
 * Uma frase por atributo (prancha 2 C), com o que ele alimenta NESTE mundo: Vida/Mana pela fórmula
 * configurada, a iniciativa e o deslocamento.
 */
export function attributePurpose(key, { hpKeys = [], energyKeys = [], energyLabel = "Mana", initiativeKey = "", movement = false } = {}) {
  const extras = [];
  if (hpKeys.includes(key)) extras.push("Vida");
  if (energyKeys.includes(key)) extras.push(energyLabel);
  if (key === initiativeKey) extras.push("iniciativa");
  if (movement && key === "dexterity") extras.push("deslocamento");
  // Destreza já diz para que serve pelo que alimenta; "agilidade" só sem nada mais a dizer.
  const base = key === "dexterity" && extras.length ? null : PURPOSE[key] ?? null;
  return [base, ...extras].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ Origem */

const SLOT_WORDS = { tail: "cauda", wing: "asas", horn: "chifres", tentacle: "tentáculos" };
const COMMON_SLOTS = ["head", "torso", "arm", "leg"];

/** "Corpo": o que o corpo tem de diferente de um humanoide ("cauda e asas"), ou quantas partes. */
export function bodySummary(parts = []) {
  const special = [...new Set(parts.filter(p => !COMMON_SLOTS.includes(p?.slot)).map(p => SLOT_WORDS[p.slot] ?? String(p.label ?? p.slot ?? "").toLowerCase()))].filter(Boolean);
  if (special.length) return special.length === 1 ? special[0] : `${special.slice(0, -1).join(", ")} e ${special.at(-1)}`;
  return parts.length ? `${parts.length} partes` : "";
}

/**
 * O painel "X traz" da grade de Espécies (prancha 1 C): o que a Espécie (com a Linhagem) dá,
 * uma linha por coisa. Skill que só chega mais tarde vem marcada `later`.
 * @param {object} entry - Espécie do catálogo
 * @param {object|null} lineage
 * @param {{traitLabel:Function, elementLabel:Function, level?:number}} labels
 * @returns {Array<{label:string, value:string, later?:boolean}>}
 */
export function speciesCardLines(entry, lineage = null, { traitLabel = id => id, elementLabel = id => id, level = 1 } = {}) {
  if (!entry) return [];
  const template = resolveSpeciesTemplate({ species: entry, lineage, level });
  const lines = [];
  if (template.traits.length) lines.push({ label: "Traços", value: template.traits.map(traitLabel).join(" · ") });
  const body = bodySummary(template.parts);
  if (body) lines.push({ label: "Corpo", value: body });
  for (const skill of template.skills) lines.push({ label: skill.name, value: "Racial" });
  for (const skill of template.locked ?? []) lines.push({ label: skill.name, value: `nível ${skill.unlockLevel}`, later: true });
  const resistances = [...(entry.passives?.resistances ?? []), ...(lineage?.passives?.resistances ?? [])];
  for (const r of resistances) {
    if (!r?.target || !(Number(r.amount) > 0)) continue;
    const label = r.target === "general" ? "Resistência Geral" : `Resistência a ${elementLabel(r.target)}`;
    lines.push({ label, value: `${Number(r.amount)}%` });
  }
  return lines;
}

/** Texto curto do cartão da grade: a primeira frase da descrição, ou os Traços. */
export function speciesBlurb(entry, { traitLabel = id => id } = {}) {
  const text = String(entry?.description ?? "").replace(/<[^>]*>/g, "").trim();
  if (text) {
    const first = text.split(/(?<=[.!?])\s/)[0];
    return first.length > 80 ? `${first.slice(0, 77)}…` : first;
  }
  return (entry?.traits ?? []).map(traitLabel).join(" · ");
}
