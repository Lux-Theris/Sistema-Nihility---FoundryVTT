/**
 * Gerador de NPC por arquétipo (canvas "Gerador de NPC", aprovado em 01/11) — a parte pura: dividir
 * os pontos de atributo, sortear Skills/equipamento/Espécie/nome e o Nível de NPC (M6). Sem
 * Foundry; testado em test/npc-generator.test.mjs. O sorteio recebe `rng` (uma função que devolve
 * [0, 1)) para o teste ser repetível.
 *
 * Princípio: o NPC usa os MESMOS pontos de um PJ daquele nível, então nunca sai fora da curva — o
 * arquétipo só diz onde eles caem.
 */

/** Peso de cada nível de "favorece": Pouco · Normal · Bastante · Muito ("Muito" ≈ 4× "Pouco"). */
export const WEIGHT_FACTORS = [1, 2, 3, 4];

/** Quanto dois NPCs do mesmo arquétipo diferem ("Sorte na divisão"). */
export const LUCK_SPREAD = { low: 0.15, medium: 0.35, high: 0.7 };

/** Níveis de NPC (M6), na ordem da escolha. */
export const NPC_TIERS = ["minion", "normal", "elite", "boss"];
export const NPC_TIER_LABELS = { minion: "Lacaio", normal: "Normal", elite: "Elite", boss: "Chefe" };

/** Gerador repetível (Mulberry32): mesmo `seed`, mesma sequência. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Um elemento ao acaso (ou `null` com a lista vazia). */
export function pickOne(list, rng = Math.random) {
  if (!list?.length) return null;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/**
 * Pontos de atributo de um PJ do `level` (o mesmo da ficha: inicial + por nível acima do 1), vezes
 * o `percent` do arquétipo (Civil = 50).
 */
export function attributeBudget(level, { starting = 35, perLevel = 5 } = {}, percent = 100) {
  const lvl = Math.max(1, Math.round(Number(level) || 1));
  const full = Math.max(0, Number(starting) || 0) + (lvl - 1) * Math.max(0, Number(perLevel) || 0);
  return Math.max(0, Math.round((full * Math.max(0, Number(percent) || 0)) / 100));
}

/**
 * Divide `budget` pontos entre os atributos, com mais peso no que o arquétipo favorece e um pouco
 * de sorte. A soma é sempre exatamente `budget`.
 * @param {number} budget
 * @param {Record<string, number>} weights - atributo → 0 (Pouco) … 3 (Muito); ausente = 1 (Normal)
 * @param {string[]} keys - os atributos, na ordem
 * @param {{luck?: "low"|"medium"|"high", rng?: () => number}} [options]
 * @returns {Record<string, number>}
 */
export function distributePoints(budget, weights, keys, { luck = "medium", rng = Math.random } = {}) {
  const total = Math.max(0, Math.round(Number(budget) || 0));
  const spread = LUCK_SPREAD[luck] ?? LUCK_SPREAD.medium;
  const raw = keys.map(key => {
    const level = Math.min(3, Math.max(0, Math.round(Number(weights?.[key] ?? 1))));
    const noise = 1 + spread * (2 * rng() - 1);
    return Math.max(0.01, WEIGHT_FACTORS[level] * noise);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  const exact = raw.map(r => (total * r) / sum);
  const points = exact.map(Math.floor);
  let left = total - points.reduce((a, b) => a + b, 0);
  // O que sobrou do arredondamento vai para quem ficou mais perto do próximo ponto.
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) points[order[k][1]] += 1;
  return Object.fromEntries(keys.map((key, i) => [key, points[i]]));
}

/** Nível do NPC: o pedido, ou ±1 com "Variar o nível" (nunca abaixo de 1). */
export function rollNpcLevel(level, vary, rng = Math.random) {
  const base = Math.max(1, Math.round(Number(level) || 1));
  if (!vary) return base;
  return Math.max(1, base + Math.floor(rng() * 3) - 1);
}

/** Nível das Skills: "one" = sempre 1; "follow" = acompanha o NPC (⌈nível ÷ 3⌉). */
export function skillLevelFor(npcLevel, mode = "follow") {
  if (mode === "one") return 1;
  return Math.max(1, Math.ceil((Math.max(1, Number(npcLevel) || 1)) / 3));
}

/**
 * Skills do NPC: as marcadas "sempre" e, por sorteio sem repetir, o resto até um número entre
 * `min` e `max` (+ `extra` do Elite/Chefe). Nunca passa do que a lista tem.
 * @param {Array<{always?: boolean}>} skills
 * @param {{min?: number, max?: number, extra?: number}} counts
 */
export function pickSkills(skills, { min = 0, max = 0, extra = 0 } = {}, rng = Math.random) {
  const list = Array.isArray(skills) ? skills : [];
  const always = list.filter(s => s?.always);
  const pool = list.filter(s => !s?.always);
  const lo = Math.max(0, Math.round(Number(min) || 0));
  const hi = Math.max(lo, Math.round(Number(max) || 0));
  const wanted = lo + Math.floor(rng() * (hi - lo + 1)) + Math.max(0, Math.round(Number(extra) || 0));
  const count = Math.min(list.length, Math.max(always.length, wanted));
  const picked = [...always];
  const bag = [...pool];
  while (picked.length < count && bag.length) picked.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  return picked;
}

/** Equipamento: cada item entra com a sua chance (%). */
export function pickItems(items, rng = Math.random) {
  return (Array.isArray(items) ? items : []).filter(item => {
    const chance = Math.min(100, Math.max(0, Number(item?.chance ?? 100)));
    return chance >= 100 || rng() * 100 < chance;
  });
}

/**
 * Espécie: uma das aceitas pelo arquétipo que exista no catálogo e esteja disponível na criação;
 * lista vazia (ou nenhuma válida) = qualquer disponível.
 * @param {string[]} allowed
 * @param {string[]} available - ids do catálogo com `availableAtCreation`
 */
export function pickSpecies(allowed, available, rng = Math.random) {
  const ok = (Array.isArray(allowed) ? allowed : []).filter(id => available.includes(id));
  return pickOne(ok.length ? ok : available, rng) ?? "";
}

/**
 * Nome sorteado de uma tabela `{first: [], last: []}`; às vezes só o primeiro nome.
 * @param {{first: string[], last: string[]}} table
 */
export function randomName(table, rng = Math.random) {
  const first = pickOne(table?.first, rng) ?? "NPC";
  const last = pickOne(table?.last, rng);
  return last && rng() >= 0.25 ? `${first} ${last}` : first;
}

/** Cultura do nome: Sci-Fi quando o arquétipo ou a Espécie é Sci-Fi; senão Fantasia. */
export function nameCulture(archetypeGroup, speciesGroup) {
  return archetypeGroup === "scifi" || speciesGroup === "scifi" ? "scifi" : "fantasia";
}

/** Vida máxima pelo Nível de NPC: Lacaio = 1; Elite/Chefe multiplicam; Normal fica. */
export function npcTierHp(hpMax, tier, { elite = 2, boss = 4 } = {}) {
  const max = Number(hpMax) || 0;
  if (tier === "minion") return 1;
  if (tier === "elite") return Math.max(1, Math.round(max * Math.max(0, Number(elite) || 0)));
  if (tier === "boss") return Math.max(1, Math.round(max * Math.max(0, Number(boss) || 0)));
  return max;
}

/** Skills a mais que o gerador sorteia para Elite/Chefe. */
export function tierExtraSkills(tier, { elite = 1, boss = 2 } = {}) {
  if (tier === "elite") return Math.max(0, Math.round(Number(elite) || 0));
  if (tier === "boss") return Math.max(0, Math.round(Number(boss) || 0));
  return 0;
}

/** Vida atual depois de trocar o Nível de NPC: a mesma fração da Vida máxima. */
export function rescaleHpValue(value, oldMax, newMax) {
  const v = Math.max(0, Number(value) || 0);
  if (!(oldMax > 0)) return Math.min(v, newMax);
  return Math.min(newMax, Math.max(v > 0 ? 1 : 0, Math.round((v / oldMax) * newMax)));
}

/* ------------------------------------------------------------------ catálogo */

const slug = text =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

export { slug as archetypeSlug };

/**
 * Uma entrada do catálogo de arquétipos com todos os campos e valores válidos.
 * @param {object} entry
 * @param {string[]} attributeKeys
 */
export function normalizeArchetype(entry, attributeKeys = []) {
  const e = entry ?? {};
  const id = slug(e.id || e.label) || "arquetipo";
  const weights = {};
  for (const key of attributeKeys) weights[key] = Math.min(3, Math.max(0, Math.round(Number(e.weights?.[key] ?? 1))));
  const min = Math.max(0, Math.round(Number(e.skillsMin) || 0));
  const usedKeys = new Set();
  const uniqueKey = base => {
    let key = slug(base) || "item";
    for (let n = 2; usedKeys.has(key); n++) key = `${slug(base) || "item"}_${n}`;
    usedKeys.add(key);
    return key;
  };
  return {
    id,
    label: String(e.label || id),
    group: String(e.group ?? ""),
    img: String(e.img || "icons/svg/mystery-man.svg"),
    description: String(e.description ?? ""),
    species: Array.isArray(e.species) ? e.species.filter(s => typeof s === "string" && s) : [],
    pointsPercent: Math.max(0, Math.round(Number(e.pointsPercent ?? 100))),
    weights,
    luck: LUCK_SPREAD[e.luck] ? e.luck : "medium",
    skillsMin: min,
    skillsMax: Math.max(min, Math.round(Number(e.skillsMax) || 0)),
    skillLevel: e.skillLevel === "one" ? "one" : "follow",
    skills: (Array.isArray(e.skills) ? e.skills : []).filter(s => s?.name).map(s => ({ ...s, key: uniqueKey(s.key || s.name), always: Boolean(s.always) })),
    items: (Array.isArray(e.items) ? e.items : [])
      .filter(i => i?.name)
      .map(i => ({ ...i, type: "item", key: uniqueKey(i.key || i.name), chance: Math.min(100, Math.max(0, Math.round(Number(i.chance ?? 100)))) }))
  };
}

/** Comparação por conteúdo, ignorando ordem de chaves. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}

/** "default" (igual ao de fábrica), "edited" (de fábrica, mudado) ou "custom" (criado pelo Mestre). */
export function archetypeStatus(entry, defaults) {
  const original = (defaults ?? []).find(d => d.id === entry?.id);
  if (!original) return "custom";
  return JSON.stringify(stable(entry)) === JSON.stringify(stable(original)) ? "default" : "edited";
}

/** "Trazer do padrão…": os arquétipos de fábrica que ainda não estão no catálogo. */
export function missingDefaultArchetypes(current, defaults) {
  const have = new Set((current ?? []).map(e => e.id));
  return (defaults ?? []).filter(d => !have.has(d.id));
}

/** Só os ids que existem no catálogo (elementos de uma arma Sci-Fi num mundo de Fantasia somem). */
export function keepKnownIds(ids, known) {
  const set = known instanceof Set ? known : new Set(known ?? []);
  return (Array.isArray(ids) ? ids : []).filter(id => set.has(id));
}
