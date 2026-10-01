/**
 * Mecânica para conteúdo gerado por IA: o texto que ensina o formato ao modelo (com os catálogos
 * DESTE mundo) e o saneamento do que volta. A IA só propõe; o sistema decide o que é válido —
 * id de elemento/Condição/atributo que não existe é descartado, número fora da faixa é limitado,
 * fórmula inválida derruba o dano (a Skill vira Descritiva em vez de quebrar ao usar).
 *
 * As funções `sanitize*` e `mechanicsGuide` são PURAS (testadas): recebem os catálogos como
 * argumento. `currentAICatalogs()` é a ponte com o mundo.
 */
import {
  MEU_SISTEMA,
  getActiveTraits,
  getActiveBodyFunctions,
  getActiveDamageElements,
  getActiveStatusConditions,
  getActiveAttributes,
  getStructures,
  getEffectTargetLabels
} from "../core/config.js";

const clampInt = (value, min, max, fallback = min) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const ids = list => new Set((list ?? []).map(e => (typeof e === "string" ? e : e?.id ?? e?.key)).filter(Boolean));
const pickIds = (value, valid, max = 3) => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(String).filter(v => valid.has(v)))].slice(0, max);

/** Fórmula de dado simples (sem Foundry): números, dN, + − × ÷, parênteses, kh/kl. */
export function simpleFormulaCheck(formula) {
  return typeof formula === "string" && formula.length <= 60 && /^[\s\d+\-*/().dkhlDKHL]+$/.test(formula) && /\d/.test(formula);
}

/**
 * Texto para o prompt: o formato do objeto `mechanics` e os ids que existem neste mundo.
 * @param {{elements:Array, conditions:Array, attributes:Array, structures?:Array, targetLabels?:object}} catalogs
 */
export function mechanicsGuide(catalogs = {}) {
  const list = (arr, label = e => e.label) => (arr ?? []).map(e => `${e.id ?? e.key} (${label(e)})`).join(", ") || "nenhum";
  const targets = Object.entries(catalogs.targetLabels ?? {})
    .filter(([key]) => !key.startsWith("ship"))
    .map(([key, label]) => `${key} (${label})`)
    .join(", ");
  return [
    'Mecânica de Skill, no campo "mechanics": {',
    '  "effectType": "none" (só descritiva) | "damage" | "temporary" (buffs/debuffs/Condições/cura/veneno),',
    '  "cost": número (Mana gasta ao usar), "hasUpkeep": boolean (liga/desliga), "upkeepCost": número por rodada,',
    '  "targetType": "targeted" (um alvo) | "self" | "emission" (área na hora) | "zone" (área que fica),',
    '  "areaShape": "circle"|"cone"|"ray", "areaDistance": número (unidades do grid, 1–30), "areaAngle": graus (cone),',
    '  "damageFormula": fórmula de dados do Foundry ("2d6+3"), "isMagicDamage": boolean, "damageElements": [ids de elemento],',
    '  "scalingAttribute": id de atributo ou "" (multiplica o dano pelo atributo ao quadrado; use em Skills de dano do personagem),',
    '  "effects": [{"target": alvo, "amount": número (negativo = debuff/dano), "durationRounds": rodadas (0 = sem prazo),',
    '               "conditionId": id de Condição ou "", "periodic": boolean (só hp/energy: aplica a cada rodada),',
    '               "damageElements": [ids] (tick de dano), "elementId": id (só weaponElement/bodyElement)}],',
    '  "resistanceTarget": "" | "general" | id de elemento (Skill passiva de Resistência; 10% por nível)',
    "}",
    "Use SÓ estes ids:",
    `- Elementos: ${list(catalogs.elements)}`,
    `- Condições: ${list(catalogs.conditions)}`,
    `- Atributos: ${list(catalogs.attributes)}`,
    `- Alvos de efeito: ${targets || "strength, defense, magic, hp, energy, shield"}`,
    "Prefira mecânica simples e coerente com a descrição. Uma Skill de cura é temporary com hp positivo; um veneno é temporary com hp negativo, periodic e conditionId do veneno."
  ].join("\n");
}

/**
 * Saneia a mecânica de uma Skill vinda da IA. Devolve só campos de `skillMechanicsFields`, todos
 * válidos para o DataModel.
 * @param {object} raw
 * @param {{elements:Array, conditions:Array, attributes:Array, structures?:Array}} catalogs
 * @param {{isValidFormula?:(f:string)=>boolean}} [options]
 */
export function sanitizeSkillMechanics(raw = {}, catalogs = {}, { isValidFormula = simpleFormulaCheck } = {}) {
  const m = raw && typeof raw === "object" ? raw : {};
  const elements = ids(catalogs.elements);
  const conditions = ids(catalogs.conditions);
  const attributes = ids(catalogs.attributes);
  const structures = ids(catalogs.structures);
  const out = {};

  out.cost = clampInt(m.cost, 0, 9999, 0);
  out.hasUpkeep = Boolean(m.hasUpkeep);
  out.upkeepCost = out.hasUpkeep ? clampInt(m.upkeepCost, 0, 9999, 0) : 0;

  let effectType = MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(m.effectType) ? m.effectType : "none";
  if (effectType === "structure") {
    out.structureId = structures.has(m.structureId) ? m.structureId : "";
    if (!out.structureId) effectType = "none";
  }

  const targetType = ["targeted", "self", "emission", "zone"].includes(m.targetType) ? m.targetType : "targeted";
  out.targetType = targetType;
  if (targetType === "emission" || targetType === "zone") {
    out.areaShape = ["circle", "cone", "ray"].includes(m.areaShape) ? m.areaShape : "circle";
    out.areaDistance = clampInt(m.areaDistance, 1, 30, 3);
    out.areaAngle = clampInt(m.areaAngle, 10, 360, 53);
    if (targetType === "zone") out.zoneRounds = clampInt(m.zoneRounds, 1, 20, 3);
  }

  if (effectType === "damage") {
    const formula = typeof m.damageFormula === "string" ? m.damageFormula.trim() : "";
    if (formula && isValidFormula(formula)) {
      out.damageFormula = formula;
      out.isMagicDamage = Boolean(m.isMagicDamage);
      out.damageElements = pickIds(m.damageElements, elements);
      out.scalingAttribute = attributes.has(m.scalingAttribute) ? m.scalingAttribute : "";
    } else {
      effectType = "none";
    }
  }

  if (effectType === "temporary") {
    const effects = [];
    for (const e of Array.isArray(m.effects) ? m.effects.slice(0, 4) : []) {
      if (!e || !MEU_SISTEMA.EFFECT_TARGETS.includes(e.target) || String(e.target).startsWith("ship")) continue;
      const conditionId = conditions.has(e.conditionId) ? e.conditionId : "";
      const amount = clampInt(e.amount, -999, 999, 0);
      if (!amount && !conditionId) continue;
      const periodic = Boolean(e.periodic) && ["hp", "energy"].includes(e.target);
      const entry = {
        target: e.target,
        amount,
        durationRounds: clampInt(e.durationRounds, 0, 20, periodic ? 3 : 1),
        conditionId,
        periodic,
        tickUnit: "combatRound",
        damageElements: periodic && amount < 0 ? pickIds(e.damageElements, elements) : [],
        modifierType: "flat"
      };
      if (["weaponElement", "bodyElement"].includes(e.target)) {
        entry.elementId = elements.has(e.elementId) ? e.elementId : "";
        if (!entry.elementId) continue;
      }
      if (periodic && entry.durationRounds === 0) entry.durationRounds = 3;
      effects.push(entry);
    }
    out.effects = effects;
    if (!effects.length) effectType = "none";
  }

  const resistance = m.resistanceTarget === "general" || elements.has(m.resistanceTarget) ? m.resistanceTarget : "";
  out.resistanceTarget = resistance;
  out.effectType = effectType;
  return out;
}

/** Bloco `weapon` de um Item Geral vindo da IA (null = não é arma). */
export function sanitizeWeapon(raw, catalogs = {}, { isValidFormula = simpleFormulaCheck } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const formula = typeof raw.damageFormula === "string" ? raw.damageFormula.trim() : "";
  if (!formula || !isValidFormula(formula)) return null;
  const attributes = ids(catalogs.attributes);
  return {
    enabled: true,
    damageFormula: formula,
    scalingAttribute: attributes.has(raw.scalingAttribute) ? raw.scalingAttribute : "",
    isMagicDamage: Boolean(raw.isMagicDamage),
    isAbsoluteDamage: false,
    damageElements: pickIds(raw.damageElements, ids(catalogs.elements))
  };
}

/** Bônus enquanto equipado: atributos (rolagem) e Vida/Mana máximas. */
export function sanitizeItemBonuses(raw = {}, catalogs = {}) {
  const attributes = ids(catalogs.attributes);
  const attributeBonuses = (Array.isArray(raw.attributeBonuses) ? raw.attributeBonuses : [])
    .filter(b => attributes.has(b?.attribute))
    .slice(0, 3)
    .map(b => ({ attribute: b.attribute, amount: clampInt(b.amount, -20, 20, 0) }))
    .filter(b => b.amount);
  const stat = raw.statModifiers ?? {};
  return { attributeBonuses, statModifiers: { hp: clampInt(stat.hp, -500, 500, 0), energy: clampInt(stat.energy, -500, 500, 0) } };
}

/** Os catálogos deste mundo, no formato que as funções acima esperam. */
export function currentAICatalogs() {
  return {
    elements: getActiveDamageElements().map(e => ({ id: e.id, label: e.label })),
    conditions: getActiveStatusConditions().map(c => ({ id: c.id, label: c.label })),
    attributes: getActiveAttributes().map(a => ({ id: a.key, label: a.label })),
    structures: getStructures().map(s => ({ id: s.id, label: s.label })),
    targetLabels: getEffectTargetLabels(),
    traits: getActiveTraits().map(t => ({ id: t.id, label: t.label })),
    bodyFunctions: getActiveBodyFunctions().map(f => ({ id: f.id, label: f.label }))
  };
}

/** Validação de fórmula com o Foundry quando disponível; senão a checagem simples. */
export function foundryFormulaCheck(formula) {
  try {
    const RollClass = globalThis.Roll;
    if (typeof RollClass?.validate === "function") return RollClass.validate(formula) && formula.length <= 80;
  } catch (err) {
    return false;
  }
  return simpleFormulaCheck(formula);
}

/* ------------------------------------------------------------------ Espécie / Herança */

const slug = text =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Texto do prompt: o formato de uma Espécie (ou Herança) e os ids deste mundo. */
export function originGuide(catalogs = {}, { kind = "species" } = {}) {
  const list = arr => (arr ?? []).map(e => `${e.id} (${e.label})`).join(", ") || "nenhum";
  const heritage = kind === "heritage";
  return [
    `Responda com um único objeto JSON estrito, sem markdown, descrevendo ${heritage ? "uma Herança (algo que ACONTECEU com o personagem e vale para qualquer Espécie: vampirizado, meio-dragão…)" : "uma Espécie jogável"}:`,
    "{",
    '  "label": nome, "group": "fantasia"|"isekai"|"scifi"|"besta", "description": uma ou duas frases,',
    '  "traits": [ids de Traço], ' + (heritage ? '"removesTraits": [ids de Traço que a Herança TIRA], ' : "") + '"elements": [ids de elemento do corpo, normalmente vazio],',
    '  "parts": [{"label": nome da parte, "slot": "head"|"torso"|"arm"|"leg"|"tail"|"wing"|"core"|"body"|outro, "hpMax": 5–60, "functions": [ids de Função]}],',
    heritage ? '  "replacesSlots": [slots cujas partes da Espécie esta Herança substitui; vazio se não mexe no corpo],' : '  "lineages": [{"label", "description", "elements": [ids], "skills": [Skills como abaixo], "replacesSkills": [nomes de Skills da Espécie que esta Linhagem substitui]}] (0 a 3),',
    '  "resistances": [{"target": "general" ou id de elemento, "amount": 5–30}],',
    `  "skills": [{"name", "description", "level": 1, "mechanics": objeto}] (1 a 3; Skills ${heritage ? "da Herança" : "Raciais"})`,
    "}",
    `Traços: ${list(catalogs.traits)}`,
    `Elementos: ${list(catalogs.elements)}`,
    `Funções de parte: ${list(catalogs.bodyFunctions)}`,
    "Bônus de atributo NÃO existem aqui. Uma criatura humanoide comum tem cabeça, tronco, dois braços e duas pernas.",
    mechanicsGuide(catalogs)
  ].join("\n");
}

/**
 * Saneia uma Espécie/Herança vinda da IA para o formato do catálogo (ids inexistentes saem, Vida
 * limitada, Skills pelo mesmo saneamento das Skills geradas).
 * @returns {{id:string, entry:object}}
 */
export function sanitizeOriginEntry(raw = {}, catalogs = {}, { kind = "species", isValidFormula = simpleFormulaCheck } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const traits = ids(catalogs.traits);
  const elements = ids(catalogs.elements);
  const functions = ids(catalogs.bodyFunctions);
  const groups = ["fantasia", "isekai", "scifi", "besta"];
  const label = String(r.label || r.name || (kind === "heritage" ? "Nova Herança" : "Nova Espécie")).slice(0, 60);
  const skillOf = s => ({
    name: String(s?.name || "Habilidade").slice(0, 60),
    description: String(s?.description || ""),
    level: 1,
    ...sanitizeSkillMechanics(s?.mechanics ?? s, catalogs, { isValidFormula })
  });
  const usedPartKeys = new Set();
  const parts = (Array.isArray(r.parts) ? r.parts.slice(0, 12) : []).map(p => {
    let key = slug(p?.label) || "parte";
    for (let n = 2; usedPartKeys.has(key); n++) key = `${slug(p?.label) || "parte"}_${n}`;
    usedPartKeys.add(key);
    return {
      key,
      label: String(p?.label || key).slice(0, 40),
      slot: slug(p?.slot) || "body",
      hpMax: clampInt(p?.hpMax, 1, 200, 10),
      tags: pickIds(p?.functions, functions, 4)
    };
  });
  const skills = (Array.isArray(r.skills) ? r.skills.slice(0, 4) : []).map(skillOf);
  const resistances = (Array.isArray(r.resistances) ? r.resistances.slice(0, 3) : [])
    .filter(x => x?.target === "general" || elements.has(x?.target))
    .map(x => ({ target: x.target, amount: clampInt(x.amount, 1, 50, 10) }));
  const entry = {
    label,
    group: groups.includes(r.group) ? r.group : "",
    description: String(r.description || ""),
    traits: pickIds(r.traits, traits, 5),
    elements: pickIds(r.elements, elements, 2),
    parts,
    skills,
    passives: resistances.length ? { resistances } : {}
  };
  if (kind === "heritage") {
    entry.removesTraits = pickIds(r.removesTraits, traits, 3);
    entry.replaces = { slots: (Array.isArray(r.replacesSlots) ? r.replacesSlots : []).map(slug).filter(Boolean).slice(0, 4) };
    entry.allowedSpecies = { mode: "any", list: [] };
    entry.excludes = [];
    entry.acquired = "acquired";
  } else {
    entry.availableAtCreation = true;
    entry.lineages = (Array.isArray(r.lineages) ? r.lineages.slice(0, 3) : []).map(l => {
      const lineageSkills = (Array.isArray(l?.skills) ? l.skills.slice(0, 2) : []).map(skillOf);
      const replaced = (Array.isArray(l?.replacesSkills) ? l.replacesSkills : []).map(n => slug(n)).filter(k => skills.some(s => slug(s.name) === k));
      return { id: slug(l?.label) || "linhagem", label: String(l?.label || "Linhagem").slice(0, 40), description: String(l?.description || ""), elements: pickIds(l?.elements, elements, 2), skills: lineageSkills, replaces: { skills: replaced } };
    });
  }
  return { id: slug(r.id || label) || (kind === "heritage" ? "heranca" : "especie"), entry };
}
