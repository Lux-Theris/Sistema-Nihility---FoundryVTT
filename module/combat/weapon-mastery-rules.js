/**
 * Tipos de arma, Maestria e ataque desarmado (H6) — a parte pura e testada. Sem imports: tudo
 * recebe o catálogo e a configuração como argumento (quem lê Foundry está em `weapon-mastery.js`).
 *
 * O catálogo é plano, `[{id, label, parent}]` ("Lâminas › Espadas", como os elementos de dano).
 * Há duas leituras, escolhidas no mundo (`weaponTypesDetailed`): na SIMPLES todo id vira o grupo de
 * cima, na DETALHADA vale o id exato. Trocar de uma para a outra nunca reescreve nada salvo.
 */

/** O tipo do ataque desarmado (o catálogo de fábrica o traz; o sistema o conhece pelo id). */
export const UNARMED_TYPE_ID = "unarmed";

/** Teto de profundidade ao subir pelos pais (guarda contra ciclo de dados mal-feitos). */
const MAX_DEPTH = 8;

const clean = list => (Array.isArray(list) ? list.filter(t => t && t.id) : []);
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Configuração padrão da Maestria (os mesmos números dos Módulos do Sistema). */
export const DEFAULT_MASTERY_CONFIG = {
  detailed: false,
  percentPerLevel: 5,
  subtypeFactor: 1.5,
  maxLevel: 10,
  evolvedPercent: 100
};

function configOf(cfg = {}) {
  return {
    detailed: Boolean(cfg.detailed),
    percentPerLevel: Math.max(0, num(cfg.percentPerLevel, DEFAULT_MASTERY_CONFIG.percentPerLevel)),
    subtypeFactor: Math.max(0, num(cfg.subtypeFactor, DEFAULT_MASTERY_CONFIG.subtypeFactor)),
    maxLevel: Math.max(1, Math.floor(num(cfg.maxLevel, DEFAULT_MASTERY_CONFIG.maxLevel))),
    evolvedPercent: Math.max(0, num(cfg.evolvedPercent, DEFAULT_MASTERY_CONFIG.evolvedPercent))
  };
}

/* ------------------------------------------------------------------ Catálogo */

/** O tipo e os ancestrais (do mais próximo ao grupo), sem ciclo. Id desconhecido: lista vazia. */
export function weaponTypeChain(id, types) {
  const list = clean(types);
  const byId = new Map(list.map(t => [t.id, t]));
  const out = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id) && out.length < MAX_DEPTH) {
    out.push(current);
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : null;
  }
  return out;
}

/** O grupo de cima de um tipo (ele mesmo se já é grupo ou se não está no catálogo). */
export function weaponTypeTop(id, types) {
  const chain = weaponTypeChain(id, types);
  return chain.length ? chain[chain.length - 1].id : id;
}

/** É um subtipo (tem um pai que existe no catálogo)? */
export function isWeaponSubtype(id, types) {
  return weaponTypeChain(id, types).length > 1;
}

/**
 * O id como a leitura do mundo o enxerga: na detalhada, o próprio; na simples, o grupo de cima.
 * Vazio continua vazio.
 */
export function resolveWeaponType(id, types, detailed = false) {
  if (!id) return "";
  return detailed ? id : weaponTypeTop(id, types);
}

/** "Lâminas › Espadas" (detalhada) ou "Lâminas" (simples). Desconhecido: o próprio id. */
export function weaponTypeLabel(id, types, { detailed = false } = {}) {
  if (!id) return "";
  const chain = weaponTypeChain(id, types);
  if (!chain.length) return id;
  if (!detailed) return chain[chain.length - 1].label || chain[chain.length - 1].id;
  return chain.map(t => t.label || t.id).reverse().join(" › ");
}

/**
 * Opções para um `<select>`: grupos (e, na detalhada, cada subtipo logo abaixo do pai, com o
 * caminho no rótulo). `current` é mantido na lista mesmo que o catálogo o tenha perdido.
 * @returns {Array<{value:string,label:string}>}
 */
export function weaponTypeOptions(types, { detailed = false, current = "" } = {}) {
  const list = clean(types);
  const ids = new Set(list.map(t => t.id));
  const roots = list.filter(t => !t.parent || !ids.has(t.parent));
  const out = [];
  for (const root of roots) {
    out.push({ value: root.id, label: root.label || root.id });
    if (!detailed) continue;
    for (const child of list.filter(t => t.parent === root.id && t.id !== root.id)) {
      out.push({ value: child.id, label: weaponTypeLabel(child.id, list, { detailed: true }) });
    }
  }
  if (current && !out.some(o => o.value === current)) {
    // Na simples, um subtipo salvo continua com o valor EXATO (o formulário o reenvia sem reescrever o
    // dado) e aparece logo abaixo do grupo dele: "Lâminas (Espadas)". Sem grupo/catálogo, "fora do catálogo".
    const top = weaponTypeTop(current, list);
    const topIndex = out.findIndex(o => o.value === top);
    if (topIndex >= 0 && top !== current) {
      const own = list.find(t => t.id === current);
      out.splice(topIndex + 1, 0, { value: current, label: `${out[topIndex].label} (${own?.label || current})` });
    } else {
      out.push({ value: current, label: `${weaponTypeLabel(current, list, { detailed })} (fora do catálogo)` });
    }
  }
  return out;
}

/**
 * Problemas do catálogo (para o Validar Mundo): pai desconhecido, pai de si mesmo e ciclos.
 * @returns {Array<{id:string, kind:"unknownParent"|"selfParent"|"cycle", parent?:string}>}
 */
export function weaponTypeCatalogIssues(types) {
  const list = clean(types);
  const ids = new Set(list.map(t => t.id));
  const issues = [];
  for (const t of list) {
    if (!t.parent) continue;
    if (t.parent === t.id) issues.push({ id: t.id, kind: "selfParent" });
    else if (!ids.has(t.parent)) issues.push({ id: t.id, kind: "unknownParent", parent: t.parent });
    else {
      const seen = new Set([t.id]);
      let cur = list.find(x => x.id === t.parent);
      let loops = false;
      for (let i = 0; cur && i < MAX_DEPTH + list.length; i++) {
        if (seen.has(cur.id)) {
          loops = true;
          break;
        }
        seen.add(cur.id);
        cur = cur.parent ? list.find(x => x.id === cur.parent) : null;
      }
      if (loops) issues.push({ id: t.id, kind: "cycle" });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ Bônus de Maestria */

/**
 * A Maestria de `mastery` cobre um ataque do tipo `attackType`?
 * Detalhada: o grupo cobre o grupo e todos os subtipos; o subtipo só a si mesmo.
 * Simples: os dois lados viram o grupo (uma Maestria de subtipo vale como a do grupo).
 */
export function masteryCovers(masteryType, attackType, types, detailed = false) {
  if (!masteryType || !attackType) return false;
  if (!detailed) return weaponTypeTop(masteryType, types) === weaponTypeTop(attackType, types);
  return weaponTypeChain(attackType, types).some(t => t.id === masteryType) || masteryType === attackType;
}

/** Nível que conta para a Maestria `{level, rank}`: o do nível (com teto) no rank 1; o teto no rank 2+. */
export function masteryEffectiveLevel({ level = 1, rank = 1 } = {}, cfg = {}) {
  const c = configOf(cfg);
  if ((Math.floor(num(rank, 1)) || 1) >= 2) return c.maxLevel;
  return Math.max(0, Math.min(Math.floor(num(level, 1)), c.maxLevel));
}

/**
 * O % de dano de uma Maestria sobre um ataque (0 se não cobre).
 *  - rank 1: `percentPerLevel` × nível (teto `maxLevel`);
 *  - Maestria de SUBTIPO (só na leitura detalhada): × `subtypeFactor`;
 *  - rank 2+ (evoluída): `evolvedPercent` fixo, sem níveis, também × `subtypeFactor` num subtipo.
 */
export function masteryPercent(mastery, attackType, types, cfg = {}) {
  const c = configOf(cfg);
  if (!mastery || !masteryCovers(mastery.type, attackType, types, c.detailed)) return 0;
  const sub = c.detailed && isWeaponSubtype(mastery.type, types);
  const rank = Math.floor(num(mastery.rank, 1)) || 1;
  const base = rank >= 2 ? c.evolvedPercent : c.percentPerLevel * masteryEffectiveLevel(mastery, c);
  return base * (sub ? c.subtypeFactor : 1);
}

/**
 * A melhor Maestria que cobre o ataque (só a MELHOR conta; não somam).
 * @param {Array<{type:string, level?:number, rank?:number, ref?:*}>} masteries
 * @returns {{mastery:object, percent:number, level:number}|null}
 */
export function bestMastery(masteries, attackType, types, cfg = {}) {
  let best = null;
  for (const mastery of masteries ?? []) {
    const percent = masteryPercent(mastery, attackType, types, cfg);
    if (percent > 0 && (!best || percent > best.percent)) best = { mastery, percent, level: masteryEffectiveLevel(mastery, cfg) };
  }
  return best;
}

/** O multiplicador de dano de um %: +15 → 1,15. */
export function masteryFactor(percent) {
  return 1 + Math.max(0, num(percent)) / 100;
}

/** "7,5" / "15": o número sem casas inúteis, com vírgula. */
export function formatMasteryPercent(percent) {
  const n = Math.round(num(percent) * 10) / 10;
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/** Texto do rastro de dano (só o Mestre vê): "Maestria Lâminas: +15%". */
export function masteryTraceRow(label, percent) {
  return { label: `Maestria ${label}`, value: `+${formatMasteryPercent(percent)}%` };
}

/**
 * A frase da Skill de Maestria: "Maestria: Lâminas · +15% de dano" / "Maestria evoluída: Espadas · +150% de dano".
 * `typeLabel` já vem como o mundo mostra (grupo ou caminho).
 */
export function masterySentence({ typeLabel, level = 1, rank = 1, type = "" }, types, cfg = {}) {
  const c = configOf(cfg);
  const percent = masteryPercent({ type, level, rank }, type, types, c);
  const evolved = (Math.floor(num(rank, 1)) || 1) >= 2;
  return `Maestria${evolved ? " evoluída" : ""}: ${typeLabel} · +${formatMasteryPercent(percent)}% de dano`;
}

/**
 * Pode subir o nível de uma Maestria? Devolve a mensagem (pt-BR) do impedimento, ou null.
 * Rank 1 para no teto; rank 2+ não tem níveis (o próximo passo é Evolução).
 */
export function masteryLevelUpBlock({ rank = 1, level = 1 } = {}, cfg = {}) {
  const c = configOf(cfg);
  if ((Math.floor(num(rank, 1)) || 1) >= 2) return "Maestria evoluída não tem níveis — o próximo passo é a Evolução.";
  if (Math.floor(num(level, 1)) >= c.maxLevel) return `Maestria já está no nível máximo (${c.maxLevel}) — o próximo passo é a Evolução.`;
  return null;
}

/** O rank da Skill nascida da Evolução de uma Maestria (a mesma arma, um degrau acima). */
export function evolvedMasteryRank(sourceRank = 1) {
  return (Math.floor(num(sourceRank, 1)) || 1) + 1;
}

/* ------------------------------------------------------------------ XP da Maestria */

/** Esta Maestria ainda ganha XP? Não no teto do rank 1, nem no rank 2+. */
export function masteryEarnsXp({ level = 1, rank = 1 } = {}, cfg = {}) {
  return masteryLevelUpBlock({ level, rank }, cfg) === null;
}

/**
 * Fator de XP de uma Maestria: o `masteryXpShare`% do que `skillUseXp` daria. Devolvido como
 * multiplicador 0–1 para quem monta a configuração (`factor × fator`).
 */
export function masteryXpFactor(sharePercent) {
  return Math.min(1, Math.max(0, num(sharePercent, 25) / 100));
}

/** `skillUseXp` com a mesma conta, só que `share`% do valor — sem arredondar duas vezes. */
export function masteryXpFromConfig(cfg = {}, sharePercent = 25) {
  return { ...cfg, factor: num(cfg.factor, 100) * masteryXpFactor(sharePercent) };
}

/* ------------------------------------------------------------------ Aprender pela prática */

/** A chave de contagem de um tipo: o grupo (simples) ou o id exato (detalhada). */
export function practiceKey(typeId, types, detailed = false) {
  return resolveWeaponType(typeId, types, detailed);
}

/**
 * Conta mais um ataque do tipo. `state` = `{counts: {chave: n}, suggested: {chave: true}}`.
 * `suggest` fica `true` UMA vez por chave: quando a contagem chega ao limiar (0 = desligado).
 * Pura: devolve um estado novo.
 * @returns {{state:{counts:object, suggested:object}, suggest:boolean, count:number}}
 */
export function bumpPractice(state, key, threshold) {
  const counts = { ...(state?.counts ?? {}) };
  const suggested = { ...(state?.suggested ?? {}) };
  if (!key) return { state: { counts, suggested }, suggest: false, count: 0 };
  counts[key] = Math.min((Math.floor(num(counts[key], 0)) || 0) + 1, 1000000);
  const limit = Math.floor(num(threshold, 0));
  let suggest = false;
  if (limit > 0 && counts[key] >= limit && !suggested[key]) {
    suggested[key] = true;
    suggest = true;
  }
  return { state: { counts, suggested }, suggest, count: counts[key] };
}

/* ------------------------------------------------------------------ Ataque desarmado */

/**
 * A fórmula de dano desarmado: a configurada se o Foundry a aceita, senão `fallback`.
 * `isValid` é injetado (`Roll.validate`) para a função continuar testável sem o Foundry.
 */
export function resolveUnarmedFormula(value, isValid, fallback = "1d4") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  try {
    return isValid(text) ? text : fallback;
  } catch (err) {
    return fallback;
  }
}

/**
 * A arma sintética do ataque desarmado.
 * @param {object} base - `{formula, attribute, element}`: o mundo (Regras da Mesa), já resolvido.
 * @param {Array<{name?:string, formula?:string, elements?:string[], weaponType?:string, magic?:boolean, tech?:boolean, absolute?:boolean}>} augments
 *   itens equipados que "reforçam o desarmado", na ordem em que estão na ficha. As fórmulas SOMAM;
 *   o último com elementos troca o elemento; o último com tipo troca o tipo; mágica/tecnologia/Absoluto
 *   de qualquer um valem.
 * @param {string} [typeOverride] - efeito de Skill "Desarmado vira tipo": vence o item e o `unarmed`.
 * @returns {{name:string, damageFormula:string, scalingAttribute:string, damageElements:string[], weaponType:string, isMagicDamage:boolean, isAbsoluteDamage:boolean, isTech:boolean, range:number, augmentedBy:string[]}}
 */
export function buildUnarmedWeapon(base = {}, augments = [], typeOverride = "") {
  const items = Array.isArray(augments) ? augments.filter(Boolean) : [];
  const formulas = [String(base.formula ?? "1d4").trim() || "1d4"];
  let elements = base.element ? [base.element] : [];
  let weaponType = UNARMED_TYPE_ID;
  for (const aug of items) {
    const formula = String(aug.formula ?? "").trim();
    if (formula) formulas.push(formula);
    if (Array.isArray(aug.elements) && aug.elements.length) elements = [...aug.elements];
    if (aug.weaponType) weaponType = aug.weaponType;
  }
  if (typeOverride) weaponType = typeOverride;
  return {
    name: "Ataque desarmado",
    damageFormula: formulas.join(" + "),
    scalingAttribute: base.attribute ?? "strength",
    damageElements: elements,
    weaponType,
    isMagicDamage: items.some(a => a.magic),
    isAbsoluteDamage: items.some(a => a.absolute),
    isTech: items.some(a => a.tech),
    range: 0,
    augmentedBy: items.map(a => a.name).filter(Boolean)
  };
}

/**
 * O elemento do desarmado do mundo: o configurado se existe, senão o de reserva (`physical`), senão nenhum.
 * @param {(id:string)=>boolean} exists
 */
export function resolveUnarmedElement(configured, exists, fallback = "physical") {
  if (configured && exists(configured)) return configured;
  if (fallback && exists(fallback)) return fallback;
  return "";
}

/* ------------------------------------------------------------------ Rolagem de ataque 🎲 */

/** O bônus fixo do 🎲: o do item (bônus "por fora" do atributo) + o nível da Maestria que cobre. */
export function attackRollFlat({ itemBonus = 0, masteryLevel = 0 } = {}) {
  return num(itemBonus) + Math.max(0, num(masteryLevel));
}

/** O rótulo do 🎲: "Ataque com X (Maestria +N)". */
export function attackRollFlavor(name, masteryLevel = 0) {
  return masteryLevel > 0 ? `Ataque com ${name} (Maestria +${masteryLevel})` : `Ataque com ${name}`;
}

/** Os metros de um empurrão de arma de gravidade com a Maestria (mesmo % do dano). */
export function masteryPushMeters(meters, percent) {
  return Math.max(0, num(meters)) * masteryFactor(percent);
}

/* ------------------------------------------------------------------ Golpe de arma numa Skill (artes marciais) */

/**
 * O tipo do "golpe de arma" de uma Skill de dano (`weaponStrike`): o da própria Skill/Sub-Skill, e
 * uma Sub-Skill com o campo vazio herda o da Skill-mãe. "" = não é golpe de arma. O tipo é FIXO da
 * Skill: item que reforça o desarmado e o efeito "Desarmado vira tipo" não o mudam.
 */
export function resolveWeaponStrike(own, parent = "") {
  return String(own || parent || "");
}

/**
 * O golpe de uma Skill/Sub-Skill com a exigência de arma: a Sub-Skill sem tipo próprio herda o tipo E a
 * marca "Exige arma do tipo equipada" da Skill-mãe; com tipo próprio, vale a marca dela.
 * @returns {{type:string, requiresWeapon:boolean}}
 */
export function resolveStrikeRequirement(own = {}, parent = null) {
  const ownType = String(own?.weaponStrike || "");
  const source = ownType || !parent ? own : parent;
  const type = ownType || String(parent?.weaponStrike || "");
  return { type, requiresWeapon: Boolean(type) && type !== UNARMED_TYPE_ID && source?.strikeRequiresWeapon !== false };
}

/**
 * Há arma compatível equipada para o golpe? Desarmado nunca exige. Compatível = o tipo da arma é o do
 * golpe ou um subtipo dele (detalhada); na simples, o mesmo grupo. `equippedTypes` = tipos das armas
 * equipadas (inclusive itens que reforçam o desarmado com um tipo).
 */
export function strikeWeaponOk(strikeType, equippedTypes, types, detailed = false) {
  if (!strikeType || strikeType === UNARMED_TYPE_ID) return true;
  return (equippedTypes ?? []).some(t => t && masteryCovers(strikeType, t, types, detailed));
}

/** "golpe desarmado" / "golpe de Lâminas" (a frase da Skill). `label` já vem como o mundo mostra. */
export function strikeSentence(typeId, label) {
  if (!typeId) return "";
  return typeId === UNARMED_TYPE_ID ? "golpe desarmado" : `golpe de ${label || typeId}`;
}

/**
 * XP e prática de um golpe: as medidas de dano (fração da Vida do alvo) a partir do resultado de uma
 * rolagem de dano — alvo único (`finalDamage`) ou área (`hits`). `baseOf(actor)` dá a Vida de referência.
 */
export function damageMeasures(result, targetActor, baseOf) {
  if (!result) return [];
  if (Array.isArray(result.hits)) return result.hits.filter(h => h.damage > 0).map(h => ({ value: h.damage, base: baseOf(h.actor) }));
  return targetActor && result.finalDamage > 0 ? [{ value: result.finalDamage, base: baseOf(targetActor) }] : [];
}
