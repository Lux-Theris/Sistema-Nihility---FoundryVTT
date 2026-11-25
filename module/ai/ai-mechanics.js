/**
 * Mecânica para conteúdo gerado por IA: o texto que ensina o formato ao modelo (com os catálogos
 * DESTE mundo) e o saneamento do que volta. A IA só propõe; o sistema decide o que é válido —
 * id de elemento/Condição/atributo que não existe é descartado, número fora da faixa é limitado,
 * fórmula inválida derruba o dano (a Skill vira Descritiva em vez de quebrar ao usar).
 *
 * As funções `sanitize*` e `mechanicsGuide` são PURAS (testadas): recebem os catálogos como
 * argumento. `currentAICatalogs()` é a ponte com o mundo.
 */
import { ATTRIBUTE_PERCENT_TARGETS } from "../economy/consumable-rules.js";
import { sanitizeRerollFields } from "../skills/reroll-rules.js";
import { normalizeOriginConditions } from "../species/species-rules.js";
import { clampTimeFactor, isTimeFactorActive } from "../combat/time-rate-rules.js";
import {
  NIHILITY,
  getActiveTraits,
  getActiveBodyFunctions,
  getActiveWeaponTypes,
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
    '  "cooldown": rodadas de recarga depois de usar (0 = nenhuma), "prepTurns": rodadas de preparo antes de disparar (0 = na hora),',
    '  "range": alcance em metros (0 = sem limite; projéteis 10–30, toque 1.5), "areaOrigin": "caster" (a forma sai de quem lança) | "free" (posta onde quiser), "areaFreeLevel": nível a partir do qual vira livre (0 = nunca), "areaAffects": quem a área/Zona atinge — "all" | "notCaster" | "allies" (quem lança e aliados; curas/buffs) | "enemies" (só inimigos) | "othersExceptTarget" (todos menos quem lança e o alvo escolhido),',
    '  "targetType": "targeted" (um alvo) | "self" | "emission" (área na hora) | "zone" (área que fica),',
    '  "areaShape": "circle"|"cone"|"ray", "areaDistance": número (unidades do grid, 1–30), "areaAngle": graus (cone),',
    '  "damageFormula": fórmula de dados do Foundry ("2d6+3"), "isMagicDamage": boolean, "damageElements": [ids de elemento],',
    '  "scalingAttribute": id de atributo ou "" (multiplica o dano pelo atributo ao quadrado; use em Skills de dano do personagem),',
    '  "effects": [{"target": alvo, "amount": número (negativo = debuff/dano), "durationRounds": rodadas (0 = sem prazo),',
    '               "conditionId": id de Condição ou "", "periodic": boolean (só hp/energy: aplica a cada rodada),',
    '               "damageElements": [ids] (tick de dano), "elementId": id (só weaponElement/bodyElement/createSurface)}],',
    '  "Só se…" num efeito (opcional): "onlyIf": {"kind":"otherCondition","value": id de Condição} (só pega se o alvo a tem) | {"kind":"otherTrait","value": id de Traço} | {"kind":"otherIsShip"} | {"kind":"otherHpBelow","threshold": % de Vida do alvo} | {"kind":"otherConditionMine","value": id de Condição} (o alvo tem a Condição posta por quem usa) | {"kind":"otherAnyMark"} (o alvo tem qualquer Condição marcada como marca) | {"kind":"otherAnyMarkMine"}. O mesmo "onlyIf" na própria Skill (fora dos efeitos) barra o uso inteiro antes de pagar. "% do total": {"target": atributo,"amountMode":"percentMax","amount":% do total do alvo} (−100 tira o total inteiro). "Ao acertar" (passivo, só Skill de dano ou Ativa): "onHit": {"conditionId": id de Condição,"chance": 1-100,"rounds": 0-99,"when":"always"|"on"|"off"}.',
    '  Efeitos de movimento (grupo "Movimento"): {"target":"push","amount": metros,"pushDirection":"push"|"pull"|"choose","immuneTraits":[ids de Traço]} empurra/puxa o alvo em linha reta; {"target":"flight"} e {"target":"burrow"} dão voo/escavação pela "durationRounds" (amount 0).',
    '  Sorte (grupo "Sorte", só Personagem): {"target":"luck","amount": % de sorte nos dados (negativo = azar; 100 = d20 de média 13,8),"luckScopes":{"attributes":true,"damage":true,"chances":true},"durationRounds": rodadas}.',
    '  Dissipar (grupo "Magia"): {"target":"dispelMagic","dispelScope":"all"|"marks"|"condition","conditionId": id de Condição (só no escopo condition)} termina efeitos MÁGICOS do alvo de nível ≤ o da Skill (sem suprimir nem desligar nada).',
    '  Mecânica "reroll" (usada no chat depois de ver uma rolagem; não é Ativa): "rerollWho": "own"|"allies"|"any", "rerollKeep": "new"|"best"|"worst" (|"choose" só em Skill Ultimate), "rerollKinds": {"attribute":bool,"initiative":bool,"damage":bool,"chances":bool}.',
    '  Ritmo do tempo (grupo "Tempo", só Personagem; só se o bloco Manipulação do tempo estiver ligado): {"target":"timeRate","timeFactor": fator (2 = Acelerado ×2; 0.5 = Desacelerado ×½; 1 não muda nada),"durationRounds": rodadas (0 numa Habilidade Ativa = enquanto ligada)}. Para PARAR o tempo do alvo use "timeStop": true (o fator é ignorado; durationRounds = rodadas de quem lança; sempre com duração ou numa Ativa). Para REVERTER o tempo do alvo (voltar N rodadas: Vida, energia, efeitos, Itens e lugar) use "timeRewind": true (o fator é ignorado; durationRounds = quantas rodadas voltam, de 1 em diante; nunca numa Habilidade Ativa).',
    '  Espaço (grupo "Espaço", só Personagem; só se o bloco Manipulação do espaço estiver ligado; a Skill precisa de alvo único ou Si mesmo e de "range" em metros): {"target":"space","spaceMode":"jump"|"swap","spaceWalls": true respeita paredes (padrão false: atravessa),"spaceSwapOther": true (só swap: troca o alvo com outro Token à escolha)}. "jump" (Saltar) leva quem usa (ou o alvo) a um ponto do mapa dentro do alcance, ou até uma Marca; "swap" (Trocar) troca o alvo de lugar com quem usa. Instantâneo, sem durationRounds.',
    '  Magia enfraquecida (grupo "Magia"): {"target":"magicDampen","amount": % da força que sobra (50 = metade),"chance": % de cada uso mágico do alvo ser enfraquecido,"durationRounds": rodadas}.',
    '  Terreno: {"target":"createSurface","elementId": id de elemento que deixa superfície no chão (só vale se o bloco Superfícies estiver ligado),"amount": raio em metros (0 = o do elemento),"durationRounds": rodadas (0 = as do elemento)}.',
    '  Efeitos de sentido (grupo "Sentidos", só Personagem): {"target":"senseTremor"|"senseInvisible"|"senseTrue"|"senseAll","amount": alcance em metros (0 = sem limite),"durationRounds": rodadas} — Sentido sísmico, Ver o invisível, Visão verdadeira, Sentir tudo.',
    '  "resistanceTarget": "" | "general" | id de elemento (Skill passiva de Resistência; 10% por nível),',
    '  "weaponStrike": "" | id de Tipo de arma (só Skill de dano: arte marcial/golpe de arma conta como ataque do tipo; "unarmed" = golpe desarmado),',
    '  "weaponMastery": "" | id de Tipo de arma (Skill passiva de Maestria: +% de dano com armas daquele tipo; sem mecânica de uso),',
    '  Efeito {"target":"unarmedType","weaponTypeId": id de Tipo de arma,"durationRounds": rodadas} faz o ataque desarmado contar como aquele tipo.',
    "}",
    "Use SÓ estes ids:",
    `- Elementos: ${list(catalogs.elements)}`,
    `- Condições: ${list(catalogs.conditions)}`,
    `- Atributos: ${list(catalogs.attributes)}`,
    `- Traços: ${list(catalogs.traits)}`,
    `- Tipos de arma: ${list(catalogs.weaponTypes)}`,
    `- Alvos de efeito: ${targets || "strength, defense, magic, hp, energy, shield"}`,
    "Prefira mecânica simples e coerente com a descrição. Uma Skill de cura é temporary com hp positivo e periodic; um veneno é temporary com hp negativo, periodic e conditionId do veneno.",
    'Numa cura periódica, "healKind": "cura" (fecha feridas), "regeneracao" (também refaz membros perdidos — regeneração de troll, de slime) ou "reparo" (conserta próteses e máquinas).'
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
  const traits = ids(catalogs.traits);
  const weaponTypes = ids(catalogs.weaponTypes);
  const out = {};

  out.cost = clampInt(m.cost, 0, 9999, 0);
  out.hasUpkeep = Boolean(m.hasUpkeep);
  out.upkeepCost = out.hasUpkeep ? clampInt(m.upkeepCost, 0, 9999, 0) : 0;
  out.cooldown = clampInt(m.cooldown, 0, 99, 0);
  out.prepTurns = clampInt(m.prepTurns, 0, 20, 0);
  out.range = clampInt(m.range, 0, 10000, 0);
  out.areaOrigin = ["caster", "free"].includes(m.areaOrigin) ? m.areaOrigin : "free";
  out.areaFreeLevel = clampInt(m.areaFreeLevel, 0, 99, 0);
  // "+ por nível" (1.118.0): metros por nível da área (Emissão, Zona ou Estrutura).
  out.areaPerLevel = Math.min(50, Math.max(0, Math.round((Number(m.areaPerLevel) || 0) * 2) / 2));
  // "Roubo de vida" (1.119.0): % do dano que cura quem usa; só vale numa Skill de dano (abaixo).
  out.lifeSteal = 0;
  out.areaAffects = ["all", "notCaster", "allies", "enemies", "othersExceptTarget"].includes(m.areaAffects) ? m.areaAffects : "all";
  // Duelo (8c.2): só numa Skill Ativa; a IA não monta Combinadas (sem Sub-Skills).
  if (out.hasUpkeep) {
    out.endsWhenTargetFalls = Boolean(m.endsWhenTargetFalls);
    out.intruderRule = ["break", "include"].includes(m.intruderRule) ? m.intruderRule : "";
  }

  let effectType = NIHILITY.SKILL_EFFECT_TYPES.includes(m.effectType) ? m.effectType : "none";
  if (effectType === "structure") {
    out.structureId = structures.has(m.structureId) ? m.structureId : "";
    if (!out.structureId) effectType = "none";
    out.structureRegen = out.hasUpkeep ? clampInt(m.structureRegen, 0, 9999, 0) : 0;
    out.structureRegenCost = out.hasUpkeep ? clampInt(m.structureRegenCost, 0, 9999, 0) : 0;
    out.structurePlace = ["click", "caster", "target"].includes(m.structurePlace) ? m.structurePlace : "click";
    // "Segue quem lançou" (aura): só faz sentido numa Skill Ativa.
    out.structureFollows = out.hasUpkeep ? Boolean(m.structureFollows) : false;
    // "Raio base" da própria Skill (1.119.0); 0 = o do catálogo.
    out.structureSize = Math.min(100, Math.max(0, Math.round((Number(m.structureSize) || 0) * 2) / 2));
  }

  // Rerrolar (8d.2): usada no chat; não é Ativa nem tem Preparo.
  if (effectType === "reroll") {
    Object.assign(out, sanitizeRerollFields(m));
    out.hasUpkeep = false;
    out.prepTurns = 0;
  }

  // Forma (H5): a ficha-molde é do Mestre; a IA não inventa uma. Mecânica Forma vira Descritiva.
  if (effectType === "form") effectType = "none";
  // Análise e Predação (7b): mecânicas do Mestre; a IA não as inventa (vira Descritiva).
  if (effectType === "analysis" || effectType === "predation") effectType = "none";

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
      if (typeof m.isMagic === "boolean") out.isMagic = m.isMagic;
      if (typeof m.isTech === "boolean") out.isTech = m.isTech;
      out.damageElements = pickIds(m.damageElements, elements);
      out.lifeSteal = Math.min(100, Math.max(0, Math.round(Number(m.lifeSteal) || 0)));
      out.scalingAttribute = attributes.has(m.scalingAttribute) ? m.scalingAttribute : "";
      // Golpe de arma (arte marcial): só um tipo que existe neste mundo.
      out.weaponStrike = weaponTypes.has(m.weaponStrike) ? m.weaponStrike : "";
      if (typeof m.strikeRequiresWeapon === "boolean") out.strikeRequiresWeapon = m.strikeRequiresWeapon;
    } else {
      effectType = "none";
    }
  }

  if (effectType === "temporary") {
    const effects = [];
    for (const e of Array.isArray(m.effects) ? m.effects.slice(0, 4) : []) {
      if (!e || !NIHILITY.EFFECT_TARGETS.includes(e.target) || String(e.target).startsWith("ship")) continue;
      const conditionId = conditions.has(e.conditionId) ? e.conditionId : "";
      const movementOnly = ["flight", "burrow", "unarmedType", "dispelMagic", "timeRate", "space"].includes(e.target);
      const surfaceEntry = e.target === "createSurface";
      const senseOnly = String(e.target).startsWith("sense");
      // Empurrar/Puxar: metros, sempre positivos (a direção é o campo pushDirection).
      const amount = surfaceEntry ? clampInt(e.amount, 0, 30, 0) : e.target === "push" ? clampInt(e.amount, 0, 200, 0) : movementOnly ? 0 : senseOnly ? clampInt(e.amount, 0, 1000, 0) : clampInt(e.amount, -999, 999, 0);
      if (!amount && !conditionId && !movementOnly && !senseOnly && !surfaceEntry) continue;
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
      if (["weaponElement", "bodyElement", "createSurface"].includes(e.target)) {
        entry.elementId = elements.has(e.elementId) ? e.elementId : "";
        if (!entry.elementId) continue;
      }
      // Desarmado vira tipo de arma: só com um tipo que existe no catálogo; sem valor numérico.
      if (e.target === "unarmedType") {
        entry.weaponTypeId = weaponTypes.has(e.weaponTypeId) ? e.weaponTypeId : "";
        if (!entry.weaponTypeId) continue;
      }
      // Magia enfraquecida (8c.2): a chance (%) de cada uso mágico de quem o tem sair com `amount` % da força.
      // Sorte (8d.1): `amount` = % de sorte (negativo = azar); escopos onde vale (sem nenhum, vale em tudo).
      if (e.target === "luck") {
        const picked = { attributes: Boolean(e.luckScopes?.attributes), damage: Boolean(e.luckScopes?.damage), chances: Boolean(e.luckScopes?.chances) };
        entry.luckScopes = Object.values(picked).some(Boolean) ? picked : { attributes: true, damage: true, chances: true };
      }
      if (e.target === "magicDampen") entry.chance = clampInt(e.chance, 0, 100, 100);
      // Ritmo do tempo (8e): o fator, nos limites; 1 não muda nada e o efeito cai.
      if (e.target === "timeRate") {
        entry.timeRewind = Boolean(e.timeRewind) && !e.timeStop;
        entry.timeStop = Boolean(e.timeStop);
        entry.timeFactor = clampTimeFactor(e.timeFactor);
        if (entry.timeRewind && !(Number(entry.durationRounds) > 0)) continue;
        if (!entry.timeRewind && !entry.timeStop && !isTimeFactorActive(entry.timeFactor)) continue;
      }
      // Espaço (8f): só Saltar e Trocar existem; o resto do campo de modo fica para os próximos lotes.
      if (e.target === "space") {
        entry.spaceMode = e.spaceMode === "swap" ? "swap" : "jump";
        entry.spaceWalls = Boolean(e.spaceWalls);
        entry.spaceSwapOther = entry.spaceMode === "swap" && Boolean(e.spaceSwapOther);
        entry.durationRounds = 0;
      }
      // Dissipar (8d.2): o que termina; uma Condição que não existe aqui derruba o efeito.
      if (e.target === "dispelMagic") {
        entry.dispelScope = ["all", "marks", "condition"].includes(e.dispelScope) ? e.dispelScope : "all";
        if (entry.dispelScope === "condition" && !entry.conditionId) continue;
      }
      if (e.target === "push") {
        entry.pushDirection = ["push", "pull", "choose"].includes(e.pushDirection) ? e.pushDirection : "push";
        entry.immuneTraits = pickIds(e.immuneTraits, traits, 10);
        entry.damageElements = pickIds(e.damageElements, elements);
        entry.durationRounds = 0;
      }
      if (periodic && entry.durationRounds === 0) entry.durationRounds = 3;
      // "Só se…": só tipos de alvo, com ids que existem neste mundo; o resto é descartado.
      const onlyIf = e.target !== "push" ? sanitizeOnlyIf(e.onlyIf, { conditions, traits }) : null;
      if (onlyIf) entry.onlyIf = onlyIf;
      // "% do total" de um atributo (8c.1).
      if (e.amountMode === "percentMax" && ATTRIBUTE_PERCENT_TARGETS.includes(e.target)) entry.amountMode = "percentMax";
      // Cura periódica: Cura (padrão), Regeneração (refaz partes perdidas) ou Reparo (próteses).
      if (periodic && e.target === "hp" && amount > 0) entry.healKind = ["regeneracao", "reparo"].includes(e.healKind) ? e.healKind : "cura";
      effects.push(entry);
    }
    out.effects = effects;
    if (!effects.length) effectType = "none";
  }

  const resistance = m.resistanceTarget === "general" || elements.has(m.resistanceTarget) ? m.resistanceTarget : "";
  out.resistanceTarget = resistance;
  // Maestria de arma (H6): passiva, de um tipo que existe aqui; vira Descritiva e mundana.
  const mastery = weaponTypes.has(m.weaponMastery) ? m.weaponMastery : "";
  out.weaponMastery = mastery;
  if (mastery) {
    out.masteryRank = 1;
    out.magicTag = "mundane";
    effectType = "none";
  }
  // "Só se…" da Skill inteira e "ao acertar" (8c.1): só ids que existem neste mundo.
  const skillOnlyIf = sanitizeOnlyIf(m.onlyIf, { conditions, traits });
  if (skillOnlyIf) out.onlyIf = skillOnlyIf;
  if (m.onHit && conditions.has(m.onHit.conditionId)) {
    out.onHit = {
      conditionId: m.onHit.conditionId,
      chance: clampInt(m.onHit.chance, 1, 100, 100),
      rounds: clampInt(m.onHit.rounds, 0, 99, 0),
      when: out.hasUpkeep && ["on", "off"].includes(m.onHit.when) ? m.onHit.when : "always"
    };
  }
  out.effectType = effectType;
  return out;
}

/** "Só se…" vindo da IA: só os tipos sobre o alvo e só ids do catálogo. Nulo = sem condição. */
export function sanitizeOnlyIf(raw, { conditions = new Set(), traits = new Set() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  switch (raw.kind) {
    case "otherCondition": return conditions.has(raw.value) ? { kind: "otherCondition", value: raw.value, threshold: 50 } : null;
    case "otherConditionMine": return conditions.has(raw.value) ? { kind: "otherConditionMine", value: raw.value, threshold: 50 } : null;
    case "otherAnyMark": return { kind: "otherAnyMark", value: "", threshold: 50 };
    case "otherAnyMarkMine": return { kind: "otherAnyMarkMine", value: "", threshold: 50 };
    case "otherTrait": return traits.has(raw.value) ? { kind: "otherTrait", value: raw.value, threshold: 50 } : null;
    case "otherIsShip": return { kind: "otherIsShip", value: "", threshold: 50 };
    case "otherHpBelow": return { kind: "otherHpBelow", value: "", threshold: clampInt(raw.threshold, 1, 100, 50) };
    default: return null;
  }
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
    damageElements: pickIds(raw.damageElements, ids(catalogs.elements)),
    // Tipo de arma (H6): só um id que existe no catálogo deste mundo.
    weaponType: ids(catalogs.weaponTypes).has(raw.weaponType) ? raw.weaponType : ""
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
    bodyFunctions: getActiveBodyFunctions().map(f => ({ id: f.id, label: f.label })),
    weaponTypes: getActiveWeaponTypes().map(t => ({ id: t.id, label: t.label }))
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
    '  "parts": [{"label": nome da parte, "slot": "head"|"torso"|"arm"|"leg"|"tail"|"wing"|"core"|"body"|outro, "hpPercent": % da Vida máxima do personagem (cabeça 30, tronco 50, braço 20, perna 25, cauda 15), "functions": [ids de Função]}],',
    heritage ? '  "replacesSlots": [slots cujas partes da Espécie esta Herança substitui; vazio se não mexe no corpo],' : '  "lineages": [{"label", "description", "elements": [ids], "skills": [Skills como abaixo], "replacesSkills": [nomes de Skills da Espécie que esta Linhagem substitui]}] (0 a 3),',
    '  "resistances": [{"target": "general" ou id de elemento, "amount": 5–30 resiste; −5 a −30 é FRAQUEZA (leva mais dano), use 0 a 2 fraquezas que façam sentido}],',
    '  "conditions": [{"conditionId": id de Condição, "mode": "resist" (amount 10–50, %) ou "immune"}] (0 a 3; Condições que o corpo da criatura torna absurdas, como Sangramento num slime),',
    `  "skills": [{"name", "description", "level": 1, "mechanics": objeto}] (1 a 3; Skills ${heritage ? "da Herança" : "Raciais"})`,
    "}",
    `Traços: ${list(catalogs.traits)}`,
    `Elementos: ${list(catalogs.elements)}`,
    `Condições: ${list(catalogs.conditions)}`,
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
      // Vida da parte em % da Vida máxima; sem número, o padrão do slot.
      hpPercent: clampInt(p?.hpPercent, 1, 100, NIHILITY.PART_HP_PERCENT_BY_SLOT?.[slug(p?.slot)] ?? NIHILITY.PART_HP_PERCENT_BY_SLOT?.default ?? 20),
      tags: pickIds(p?.functions, functions, 4)
    };
  });
  const skills = (Array.isArray(r.skills) ? r.skills.slice(0, 4) : []).map(skillOf);
  // Resistência positiva ou FRAQUEZA (negativa, 1.117.0); 0 não diz nada.
  const resistances = (Array.isArray(r.resistances) ? r.resistances.slice(0, 4) : [])
    .filter(x => (x?.target === "general" || elements.has(x?.target)) && Math.round(Number(x?.amount)) !== 0)
    .map(x => ({ target: x.target, amount: clampInt(x.amount, -50, 50, 10) }));
  // Condições da origem: só ids que existem, no máximo 3.
  const validConditions = ids(catalogs.conditions);
  const conditions = normalizeOriginConditions((Array.isArray(r.conditions) ? r.conditions : []).filter(c => validConditions.has(c?.conditionId))).slice(0, 3);
  const entry = {
    label,
    group: groups.includes(r.group) ? r.group : "",
    description: String(r.description || ""),
    traits: pickIds(r.traits, traits, 5),
    elements: pickIds(r.elements, elements, 2),
    parts,
    skills,
    passives: { ...(resistances.length ? { resistances } : {}), ...(conditions.length ? { conditions } : {}) }
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
