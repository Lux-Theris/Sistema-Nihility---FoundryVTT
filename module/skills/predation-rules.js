/**
 * Predação (7b.2): as contas PURAS (testadas em test/predation.test.mjs). Sem Foundry, sem imports.
 */

/** Rank de cada Tier: extra 0; normal e racial 1; único 2; ultimate 3. */
export const PREDATION_RANKS = { extra: 0, normal: 1, racial: 1, unique: 2, ultimate: 3 };

export const tierRank = tier => PREDATION_RANKS[tier] ?? 1;

/**
 * Chance (0–100) de absorver uma Skill (dono, 17/11): 50 no mesmo Tier e mesmo nível; ±25 por rank de
 * Tier de diferença; −`levelStep` por nível que a Skill alvo está acima da Predação (+`levelStep` por
 * nível abaixo: a mais fraca é mais fácil de pegar); mais os pontos de Chance (`bonus`, Lote 1e da magia).
 * Uma Predação nível 1 não rouba uma Skill de nível alto. Para o nível máximo pela chance, a base é sempre
 * os 50 do mesmo nível (ver `PREDATION_BASE_FOR_MAX`).
 */
export function predationChance(predatorRank, skillRank, { predatorLevel = 1, skillLevel = 1, levelStep = 5, bonus = 0 } = {}) {
  const tiers = 25 * ((Number(predatorRank) || 0) - (Number(skillRank) || 0));
  const levels = (Number(levelStep) || 0) * ((Number(predatorLevel) || 1) - (Number(skillLevel) || 1));
  const raw = 50 + tiers + levels + (Number(bonus) || 0);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/** A base usada para o nível máximo pela chance (Lote 1e): a do mesmo Tier e mesmo nível. */
export const PREDATION_BASE_FOR_MAX = 50;

/** Ganhou? Um d100 (1–100) vale se ficar até a chance. Chance 0 nunca ganha; 100 sempre. */
export function predationWins(roll, chance) {
  return Number(roll) <= Number(chance);
}

/** Nome para comparar: sem acento, caixa nem espaços repetidos. */
export function normalizeSkillName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Alguma mecânica (principal ou Sub-Skill) é Forma? */
export function hasFormMechanic(skill) {
  return skill?.effectType === "form" || (skill?.subSkills ?? []).some(s => s?.effectType === "form");
}

/**
 * Por que uma Skill do alvo não pode ser absorvida, ou null.
 * @param {{name?: string, key?: string, isItemGranted?: boolean, coreSkill?: string, weaponMastery?: string, effectType?: string, subSkills?: object[]}} skill
 * @param {{names: Set<string>, keys: Set<string>}} owned - o que quem preda já tem (nomes normalizados e chaves)
 */
export function predationSkip(skill, owned = { names: new Set(), keys: new Set() }) {
  if (skill?.isItemGranted) return "concedida por Item";
  if (skill?.coreSkill) return "Skill de base do sistema";
  if (skill?.weaponMastery) return "Maestria";
  if (hasFormMechanic(skill)) return "Forma";
  if (skill?.key && owned.keys?.has(skill.key)) return "já tem";
  if (owned.names?.has(normalizeSkillName(skill?.name))) return "já tem";
  return null;
}

/** O que quem preda já tem, para `predationSkip`. */
export function ownedIndex(skills = []) {
  return {
    names: new Set(skills.map(s => normalizeSkillName(s?.name)).filter(Boolean)),
    keys: new Set(skills.map(s => s?.key).filter(Boolean))
  };
}

/**
 * Separa as Skills do alvo em elegíveis (com a chance) e puladas (com o motivo).
 * @param {Array<object>} targetSkills
 * @param {number} predatorRank
 * @param {{names: Set<string>, keys: Set<string>}} owned
 * @param {{predatorLevel?: number, levelStep?: number}} [opts]
 */
export function predationCandidates(targetSkills = [], predatorRank = 1, owned = ownedIndex(), { predatorLevel = 1, levelStep = 5 } = {}) {
  const eligible = [];
  const skipped = [];
  for (const skill of targetSkills) {
    const reason = predationSkip(skill, owned);
    if (reason) skipped.push({ id: skill.id, name: skill.name, reason });
    else eligible.push({ id: skill.id, name: skill.name, tier: skill.tier, level: Number(skill.level) || 1, chance: predationChance(predatorRank, tierRank(skill.tier), { predatorLevel, skillLevel: skill.level, levelStep }) });
  }
  return { eligible, skipped };
}

/** 1ª, 5ª, 10ª, 20ª, 40ª, 80ª… criatura da mesma Espécie dão pontos de atributo. */
export function predationMilestone(n) {
  const count = Math.floor(Number(n));
  if (!(count >= 1)) return false;
  if (count === 1 || count === 5) return true;
  if (count < 10 || count % 10 !== 0) return false;
  const k = count / 10;
  return (k & (k - 1)) === 0;
}

/** A chave do contador: a Espécie, ou "nome:<ficha base>" sem Espécie. */
export function predationCounterKey(species, baseName) {
  const id = String(species ?? "").trim();
  return id || `nome:${normalizeSkillName(baseName)}`;
}

/** Pontos por atributo: floor(total × percent ÷ 100). @param {Record<string, number>} totals */
export function predationAttrGain(totals = {}, percent = 5) {
  const pct = Math.max(0, Number(percent) || 0);
  const out = {};
  for (const [key, total] of Object.entries(totals)) {
    const gain = Math.floor(((Number(total) || 0) * pct) / 100);
    if (gain > 0) out[key] = gain;
  }
  return out;
}

/**
 * Pontos da Predação "Só formas" (1.120.0): a fração (Regra da Mesa, padrão 50%) dos pontos que a Predação normal daria,
 * arredondada para baixo, por atributo; o que chega a 0 some. Pura. @param {Record<string, number>} gain
 */
export function predationFormsGain(gain = {}, percent = 50) {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const out = {};
  for (const [key, value] of Object.entries(gain)) {
    const half = Math.floor(((Number(value) || 0) * pct) / 100);
    if (half > 0) out[key] = half;
  }
  return out;
}

/**
 * Por que os pontos da Predação "Só formas" saíram vazios (1.122.1), para o card dizer em vez de só "nenhum": o alvo é fraco
 * demais até para a Predação normal (o % do total arredonda para 0), ou só a metade é que arredonda para 0. "" quando há
 * pontos. Pura.
 */
export function predationFormsEmptyReason(fullGain = {}, formsGain = {}, percent = 50) {
  if (Object.keys(formsGain ?? {}).length) return "";
  if (!Object.keys(fullGain ?? {}).length) return "o alvo tem atributos baixos demais: até a Predação normal arredondaria tudo para 0";
  return `a fração de ${Math.min(100, Math.max(0, Number(percent) || 0))}% dos pontos normais arredonda para 0 (arredonda para baixo, por atributo)`;
}

/** O modo da Predação: "forms" (só formas) ou "all" (tudo, o padrão e o de toda Skill salva antes). */
export const predationTakesOf = mech => (mech?.predationTakes === "forms" ? "forms" : "all");

/**
 * As Sub-Skills de uma Skill de Predação "Só formas" depois de guardar uma forma nova (1.120.0). Uma Skill com
 * Sub-Skills só usa as Sub-Skills, então a primeira vez a mecânica de Predação da Skill vira a Sub-Skill "Predar"
 * (`predateSub`, o snapshot dela) e a forma entra como Sub-Skill de Forma ("Forma: X", Ativa, o molde em `formActorUuid`).
 * Uma forma que já está guardada (mesmo molde) não duplica. Pura.
 * @param {object[]} subs - as Sub-Skills de agora
 * @param {object} predateSub - o snapshot da mecânica de Predação da Skill
 * @param {{uuid: string, name: string}} template
 * @returns {{subs: object[], added: boolean}}
 */
export function withStoredForm(subs = [], predateSub, template) {
  const list = JSON.parse(JSON.stringify(Array.isArray(subs) ? subs : []));
  if (list.some(s => s?.effectType === "form" && s.formActorUuid === template?.uuid)) return { subs: list, added: false };
  if (!list.length && predateSub) list.push({ ...JSON.parse(JSON.stringify(predateSub)), name: "Predar", effectType: "predation", predationTakes: "forms" });
  list.push({
    name: `Forma: ${template?.name ?? "?"}`,
    tier: predateSub?.tier ?? "normal",
    effectType: "form",
    formActorUuid: template?.uuid ?? "",
    hasUpkeep: true,
    upkeepCost: Number(predateSub?.upkeepCost) || 0,
    cost: 0,
    targetType: "self",
    active: false
  });
  return { subs: list, added: true };
}

/** Soma dois mapas de pontos. */
export function addPoints(current = {}, gain = {}) {
  const out = { ...current };
  for (const [key, value] of Object.entries(gain)) out[key] = (Number(out[key]) || 0) + (Number(value) || 0);
  return out;
}

/**
 * Os dados do Item que nasce em quem preda: a Skill inteira (mecânica + Sub-Skills) no nível 1, XP 0, sem
 * estado de uso. Racial vira Normal. Nunca leva `coreSkill`, `isItemGranted` nem a marca de Espécie.
 * @param {{name: string, img?: string, system: object}} source - `skill.toObject()` do alvo
 * @param {{systemId: string, from: string}} ctx - `from` = nome da criatura predada
 */
export function predationSkillData(source, { systemId = "nihility-rpg-system", from = "" } = {}) {
  const system = JSON.parse(JSON.stringify(source?.system ?? {}));
  const resetMech = m => {
    m.level = 1;
    m.active = false;
    m.cooldownRemaining = 0;
    m.investRatio = 1;
    m.markFactor = 1;
    if (m.tier === "racial") m.tier = "normal";
    return m;
  };
  resetMech(system);
  system.xp = 0;
  system.isItemGranted = false;
  system.coreSkill = "";
  system.subSkills = (system.subSkills ?? []).map(sub => {
    resetMech(sub);
    if ("xp" in sub) sub.xp = 0;
    return sub;
  });
  return {
    name: source?.name ?? "Skill",
    type: "skill",
    img: source?.img,
    system,
    flags: { [systemId]: { predatedFrom: from } }
  };
}
