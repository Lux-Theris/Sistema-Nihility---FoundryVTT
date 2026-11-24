/**
 * Lojas (G2, lote A) — a parte PURA: preço, sorteio de preço, compra de volta, dinheiro em
 * qualquer moeda, estoque, reposição pelo relógio, histórico e a máquina de estados da troca.
 * Sem Foundry; todo ajuste entra por parâmetro. Testado em test/shops.test.mjs. Quem lê as fichas
 * e grava é `shops.js`.
 *
 * **Dinheiro em "unidades base":** cada moeda do catálogo tem um `baseValue` (Ouro 100, Prata 10,
 * Cobre 1). Todo preço e todo saldo é convertido para unidades base (inteiros) para a conta, e
 * só na hora de pagar ou receber vira moedas de novo (`payUnits`/`creditUnits`). Assim "qualquer
 * moeda, convertendo sozinha" é uma conta só, sem fração perdida.
 */

export const SHOP_KINDS = Object.freeze(["vendor", "auto"]);
export const SHOP_KIND_LABELS = Object.freeze({ vendor: "Vendedor NPC", auto: "Ponto automático" });
/** Aparência da vitrine de um ponto automático (lote B): lista comum ou máquina de venda com prateleiras e código. */
export const SHOP_STYLES = Object.freeze(["standard", "machine"]);
export const SHOP_STYLE_LABELS = Object.freeze({ standard: "Vitrine comum", machine: "Máquina de venda (prateleiras e código)" });

/** Padrões da loja (decididos pelo dono, 22/11). */
export const SHOP_DEFAULTS = Object.freeze({
  multiplier: 1,
  buybackFraction: 0.5,
  /** Teto do sorteio de preço, em %: cada item varia de −25% a +25% em volta do preço base. */
  randomizer: 25
});

/** Quantas vendas ficam no histórico da loja (cada uma guarda o que precisa para Desfazer). */
export const HISTORY_CAP = 12;

/** Teto do prazo de entrega de uma loja online (horas): 1 ano de 24 h. Só para o campo não aceitar lixo. */
export const MAX_DELIVERY_HOURS = 24 * 365;

const toInt = (value, fallback = 0) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const EPS = 1e-9;

/* ------------------------------------------------------------------ Dados da loja */

/**
 * `system.shop` de um Ator, com tudo no lugar: o que veio torto vira o padrão. Não muta a entrada.
 * @param {object} [raw]
 */
export function normalizeShop(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const multiplier = Number(r.multiplier);
  const buyback = Number(r.buybackFraction);
  const rnd = Number(r.randomizer);
  const days = toInt(r.restockDays, 0);
  return {
    enabled: Boolean(r.enabled),
    kind: SHOP_KINDS.includes(r.kind) ? r.kind : "vendor",
    style: SHOP_STYLES.includes(r.style) ? r.style : "standard",
    multiplier: Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : SHOP_DEFAULTS.multiplier,
    buybackFraction: Number.isFinite(buyback) ? clamp(buyback, 0, 1) : SHOP_DEFAULTS.buybackFraction,
    randomizer: Number.isFinite(rnd) ? clamp(rnd, 0, 100) : SHOP_DEFAULTS.randomizer,
    seed: toInt(r.seed, 0),
    limitedFunds: Boolean(r.limitedFunds),
    restockDays: days > 0 ? days : 0,
    lastRestock: r.lastRestock == null || r.lastRestock === "" || !Number.isFinite(Number(r.lastRestock)) ? null : Number(r.lastRestock),
    online: Boolean(r.online),
    deliveryHours: Number.isFinite(Number(r.deliveryHours)) && Number(r.deliveryHours) > 0 ? Math.min(MAX_DELIVERY_HOURS, Number(r.deliveryHours)) : 0,
    shownTo: Array.isArray(r.shownTo) ? [...new Set(r.shownTo.map(String).filter(Boolean))] : [],
    history: Array.isArray(r.history) ? r.history.filter(h => h && typeof h === "object") : []
  };
}

/**
 * `shop` de um Item (preço base, estoque, ajuste de preço, etiquetas). `stock` vazio/null = infinito.
 * @param {object} [raw]
 */
export function normalizeItemShop(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const num = value => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const stock = num(r.stock);
  const override = num(r.priceOverride);
  const restockTo = num(r.restockTo);
  const base = Number(r.basePrice);
  return {
    basePrice: Number.isFinite(base) && base > 0 ? base : 0,
    currency: typeof r.currency === "string" ? r.currency : "",
    stock: stock == null ? null : Math.max(0, Math.floor(stock)),
    restockTo: restockTo == null ? null : Math.max(0, Math.floor(restockTo)),
    priceOverride: override == null || override < 0 ? null : override,
    digital: Boolean(r.digital),
    deliveryHours: num(r.deliveryHours) == null || num(r.deliveryHours) < 0 ? null : Math.min(MAX_DELIVERY_HOURS, num(r.deliveryHours)),
    tags: Array.isArray(r.tags) ? r.tags.map(t => String(t).trim()).filter(Boolean) : []
  };
}

/**
 * O usuário pode usar a loja (comprar, vender, pedir avaliação)? O Mestre sempre; a loja `online`
 * (lote C) para quem tem rede; senão só quem o Mestre incluiu em "Mostrar aos jogadores" (`shownTo`).
 */
export function canUseShop(shop, userId, { gm = false } = {}) {
  if (gm) return true;
  const s = normalizeShop(shop);
  return s.enabled && s.shownTo.includes(String(userId ?? ""));
}

/** Quem passa a ter acesso e quem sai, ao trocar a lista `before` por `after` (para avisar só os novos). */
export function shownDiff(before, after) {
  const a = new Set(before ?? []);
  const b = new Set(after ?? []);
  return { added: [...b].filter(id => !a.has(id)), removed: [...a].filter(id => !b.has(id)) };
}

/** A loja abre como máquina de venda? Só um ponto automático pode ser máquina (a máquina não avalia nada). */
export function isMachineShop(shop) {
  const s = normalizeShop(shop);
  return s.enabled && s.kind === "auto" && s.style === "machine";
}

/* ------------------------------------------------------------------ Moeda e preço */

/** O valor, em unidades base, de `amount` da moeda `currencyId` (moeda desconhecida vale 1). */
export function toUnits(amount, currencyId, currencies) {
  const bv = (currencies ?? []).find(c => c.id === currencyId)?.baseValue;
  const rate = Number.isFinite(Number(bv)) && Number(bv) > 0 ? Number(bv) : 1;
  return Math.round(Math.max(0, Number(amount) || 0) * rate);
}

/** Unidades base → quantidade da moeda (com até 2 casas), para mostrar e para os campos. */
export function fromUnits(units, currencyId, currencies) {
  const bv = (currencies ?? []).find(c => c.id === currencyId)?.baseValue;
  const rate = Number.isFinite(Number(bv)) && Number(bv) > 0 ? Number(bv) : 1;
  return Math.round(((Number(units) || 0) / rate) * 100) / 100;
}

/** "1.240" / "48,5": número no jeito da mesa (pt-BR), sem casas inúteis. */
export function formatNumber(value) {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** Hash determinístico de um texto (FNV-1a com mistura final), 0..2^32-1. */
export function shopHash(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Fator do sorteio de preço de um item numa loja: sempre o mesmo para a mesma `seed` e o mesmo
 * item (abrir a loja de novo não muda o preço); entre 1 − pct e 1 + pct. A semente só muda ao
 * reabastecer.
 * @param {number} seed
 * @param {string} itemKey - o nome do item (dois itens iguais têm o mesmo fator)
 * @param {number} pct - teto do sorteio, em % (25 = de −25% a +25%)
 */
export function shopFactor(seed, itemKey, pct) {
  const p = clamp(Number(pct) || 0, 0, 100) / 100;
  if (p === 0) return 1;
  const u = shopHash(`${toInt(seed, 0)}|${itemKey}`) / 4294967295;
  return Math.round((1 - p + 2 * p * u) * 10000) / 10000;
}

/** Semente nova (ao reabastecer). `random` entra por parâmetro para o teste. */
export function newSeed(random = Math.random) {
  return Math.floor(random() * 2147483646) + 1;
}

/**
 * Preço de venda de UMA unidade, em unidades base: base × multiplicador × sorteio; o ajuste do
 * Mestre (`overrideUnits`) vence tudo. Nunca vira 0 por arredondamento quando o item tem preço.
 */
export function finalPriceUnits({ baseUnits, multiplier = 1, factor = 1, overrideUnits = null }) {
  if (overrideUnits != null && Number.isFinite(Number(overrideUnits))) return Math.max(0, Math.round(Number(overrideUnits)));
  const base = Math.max(0, Number(baseUnits) || 0);
  if (base === 0) return 0;
  const price = Math.round(base * Math.max(0, Number(multiplier) || 0) * (Number(factor) || 0));
  return Math.max(price > 0 ? price : 0, Number(multiplier) > 0 ? 1 : 0);
}

/** Diferença do preço da loja para o preço padrão, em % inteiros (0 se não há preço padrão). */
export function priceDiffPercent(finalUnits, standardUnits) {
  const std = Number(standardUnits) || 0;
  if (std <= 0) return 0;
  return Math.round(((Number(finalUnits) || 0) / std - 1) * 100);
}

/** "+8%", "−3%", "" (zero). Usa o sinal de menos de verdade. */
export function diffText(percent) {
  const p = Math.round(Number(percent) || 0);
  if (p === 0) return "";
  return `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
}

/**
 * Quanto vale, em unidades-padrão, o que está sendo vendido: unidades inteiras mais a proporção
 * de uma unidade com cargas já usadas. Vendendo parte da pilha saem as unidades cheias (a aberta
 * fica com o dono); vendendo tudo a aberta vai junto, pela proporção das cargas que restam.
 * @param {{quantity:number, sell:number, charges?:number, used?:number}} p
 * @returns {{factor:number, sell:number, openGoes:boolean}}
 */
export function soldUnitsFactor({ quantity, sell, charges = 0, used = 0 }) {
  const qty = Math.max(0, toInt(quantity, 0));
  const n = clamp(toInt(sell, 0), 0, qty);
  const per = Math.max(0, toInt(charges, 0));
  const spent = per > 1 ? clamp(toInt(used, 0), 0, per - 1) : 0;
  if (n === 0) return { factor: 0, sell: 0, openGoes: false };
  if (per <= 1 || spent === 0) return { factor: n, sell: n, openGoes: false };
  if (n < qty) return { factor: n, sell: n, openGoes: false };
  return { factor: n - 1 + (per - spent) / per, sell: n, openGoes: true };
}

/** Munição aberta (`ammo.rounds` > 0) vale só os disparos que tem sobre a Carga da unidade cheia. */
export function openAmmoFactor(rounds, capacity) {
  const r = Math.max(0, toInt(rounds, 0));
  const cap = Math.max(0, toInt(capacity, 0));
  if (r <= 0 || cap <= 0) return 1;
  return Math.min(1, r / cap);
}

/**
 * Quanto a loja paga pelo que o jogador vende (ponto automático), em unidades base: preço base ×
 * fração × o proporcional do item (cargas, munição aberta). Usa o preço GERAL do item, não o
 * multiplicador nem o sorteio da loja.
 */
export function buybackUnits({ baseUnits, fraction, factor = 1 }) {
  const base = Math.max(0, Number(baseUnits) || 0);
  const f = clamp(Number(fraction) || 0, 0, 1);
  return Math.max(0, Math.round(base * f * Math.max(0, Number(factor) || 0)));
}

/**
 * Motivo para o item NÃO poder ser vendido agora (texto para a mesa), ou "" se pode. Item
 * equipado e contêiner com coisas dentro ficam de fora: a venda não mexe no que está em uso.
 */
export function sellBlockedReason({ equipped = false, isContainer = false, containerHasItems = false, shopEnabled = true } = {}) {
  if (!shopEnabled) return "a loja não está aberta";
  if (equipped) return "está equipado: desequipe antes de vender";
  if (isContainer && containerHasItems) return "tem itens dentro: esvazie antes de vender";
  return "";
}

/* ------------------------------------------------------------------ Vitrine */

/** A categoria de um item para as abas da vitrine (Arma, Consumível, Munição…). */
export function itemKind({ type, system } = {}) {
  if (type === "starship_module") return "Módulo";
  if (system?.weapon?.enabled) return "Arma";
  if (system?.consumable?.enabled) return "Consumível";
  if (system?.ammo?.enabled) return "Munição";
  if (system?.container?.enabled) return "Contêiner";
  return "Equipamento";
}

/** "Todos" + as categorias e etiquetas que existem nas linhas, na ordem em que aparecem. */
export function shopCategories(rows) {
  const seen = new Set();
  for (const row of rows ?? []) {
    seen.add(row.kind);
    for (const tag of row.tags ?? []) seen.add(tag);
  }
  return ["Todos", ...[...seen].filter(Boolean)];
}

/** A linha passa na categoria e na busca (sem diferenciar maiúsculas nem acentos)? */
export function rowMatches(row, { category = "Todos", search = "" } = {}) {
  if (category !== "Todos" && row.kind !== category && !(row.tags ?? []).includes(category)) return false;
  const norm = text => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(search).trim();
  return !q || norm(row.name).includes(q);
}

/**
 * Valor sugerido de cada linha de uma avaliação: o preço padrão da linha (já com o proporcional
 * das cargas) × a fração sugerida. O total é a soma; mexer numa linha refaz o total, mexer no total
 * não mexe nas linhas (decisão do desenho aprovado).
 * @param {number[]} standardUnits - o preço padrão de cada linha, em unidades base
 * @param {number} fraction - 0..1
 */
export function appraisalSuggestion(standardUnits, fraction) {
  const f = clamp(Number(fraction) || 0, 0, 1);
  const values = (standardUnits ?? []).map(u => Math.max(0, Math.round((Number(u) || 0) * f)));
  return { values, total: values.reduce((a, b) => a + b, 0) };
}

/* ------------------------------------------------------------------ Estoque */

/** Estoque de um item da loja: `null` = infinito, senão inteiro ≥ 0. */
export function stockLeft(stock) {
  if (stock == null || stock === "") return null;
  const n = Number(stock);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** "∞", "5" ou "esgotado". */
export function stockText(stock) {
  const s = stockLeft(stock);
  if (s === null) return "∞";
  return s === 0 ? "esgotado" : String(s);
}

/** Dá para comprar `quantity`? Devolve o motivo em texto quando não. */
export function canBuyStock({ stock, quantity }) {
  const q = toInt(quantity, 0);
  if (q < 1) return { ok: false, reason: "quantidade inválida" };
  const s = stockLeft(stock);
  if (s === null) return { ok: true, reason: "" };
  if (s === 0) return { ok: false, reason: "esgotado" };
  if (q > s) return { ok: false, reason: `só há ${s} em estoque` };
  return { ok: true, reason: "" };
}

/** Estoque depois de vender `quantity` (infinito continua infinito). */
export function stockAfter(stock, quantity) {
  const s = stockLeft(stock);
  return s === null ? null : Math.max(0, s - Math.max(0, toInt(quantity, 0)));
}

/** Estoque depois de a loja comprar `quantity` (infinito continua infinito). */
export function stockAfterBuyback(stock, quantity) {
  const s = stockLeft(stock);
  return s === null ? null : s + Math.max(0, toInt(quantity, 0));
}

/** Ao reabastecer: com `restockTo` o estoque volta a ele; sem, fica como está. */
export function restockedStock({ stock, restockTo }) {
  const to = stockLeft(restockTo);
  return to === null ? stockLeft(stock) : to;
}

/* ------------------------------------------------------------------ Reposição pelo relógio */

/**
 * O reabastecimento por tempo está vencido? `lastRestock` é o relógio do mundo (segundos) do
 * último; sem ele (nunca marcado) a conta começa agora (`init`) em vez de reabastecer já.
 * @param {{restockDays:number, lastRestock:(number|null), now:number, dayLength?:number}} p
 * @returns {{due:boolean, init:boolean, nextAt:(number|null)}}
 */
export function restockDue({ restockDays, lastRestock, now, dayLength = 86400 }) {
  const days = toInt(restockDays, 0);
  if (days <= 0) return { due: false, init: false, nextAt: null };
  if (lastRestock == null) return { due: false, init: true, nextAt: null };
  const len = Math.max(1, Number(dayLength) || 86400);
  const nextAt = Number(lastRestock) + days * len;
  return { due: Number(now) >= nextAt, init: false, nextAt };
}

/* ------------------------------------------------------------------ Dinheiro em qualquer moeda */

const walletAmount = value => Math.max(0, Math.floor(Number(value) || 0));

/** O saldo inteiro, em unidades base. */
export function walletUnits(wallet, currencies) {
  let total = 0;
  for (const c of currencies ?? []) total += walletAmount(wallet?.[c.id]) * (Number(c.baseValue) > 0 ? Number(c.baseValue) : 1);
  return Math.round(total);
}

const rateOf = c => (Number(c.baseValue) > 0 ? Number(c.baseValue) : 1);
const byValueDesc = currencies => [...(currencies ?? [])].sort((a, b) => rateOf(b) - rateOf(a));

/** Divide `units` em moedas, as maiores primeiro (a preferida antes de todas). Devolve `{id: n}`. */
export function composeUnits(units, currencies, preferredId = "") {
  const list = byValueDesc(currencies);
  const first = list.find(c => c.id === preferredId);
  const order = first ? [first, ...list.filter(c => c !== first)] : list;
  const out = {};
  let rest = Math.max(0, Number(units) || 0);
  for (const c of order) {
    const n = Math.floor(rest / rateOf(c) + EPS);
    if (n > 0) {
      out[c.id] = n;
      rest -= n * rateOf(c);
    }
  }
  return out;
}

/** O que sobra de um troco em moedas (para mostrar "1 Ouro e 2 Prata"). */
export function formatMoney(units, currencies, preferredId = "") {
  const parts = composeUnits(units, currencies, preferredId);
  const labels = (currencies ?? []).filter(c => parts[c.id]).sort((a, b) => rateOf(b) - rateOf(a));
  const text = labels.map(c => `${formatNumber(parts[c.id])} ${c.label ?? c.id}`);
  if (!text.length) return "0";
  return text.length === 1 ? text[0] : `${text.slice(0, -1).join(", ")} e ${text.at(-1)}`;
}

/**
 * Tira `cost` unidades base do saldo, gastando primeiro as moedas exatas (a preferida, depois as
 * maiores sem passar do valor) e, se faltar, as menores que cobrem o resto, devolvendo o troco em
 * moedas. Não muta nada.
 * @returns {{ok:boolean, delta:Object<string,number>, reason?:string}} `delta` por moeda (negativo = pagou)
 */
export function payUnits(wallet, currencies, cost, preferredId = "") {
  const price = Math.max(0, Math.round(Number(cost) || 0));
  const total = walletUnits(wallet, currencies);
  if (total < price) return { ok: false, delta: {}, reason: "saldo insuficiente" };
  if (price === 0) return { ok: true, delta: {} };
  const list = byValueDesc(currencies);
  const pref = list.find(c => c.id === preferredId);
  const exact = pref ? [pref, ...list.filter(c => c !== pref)] : list;
  const taken = {};
  let remaining = price;
  const take = (c, wanted) => {
    const left = walletAmount(wallet?.[c.id]) - (taken[c.id] ?? 0);
    const n = Math.max(0, Math.min(left, wanted));
    if (n > 0) {
      taken[c.id] = (taken[c.id] ?? 0) + n;
      remaining -= n * rateOf(c);
    }
  };
  for (const c of exact) take(c, Math.floor(remaining / rateOf(c) + EPS));
  if (remaining > EPS) for (const c of [...list].reverse()) if (remaining > EPS) take(c, Math.ceil(remaining / rateOf(c) - EPS));
  if (remaining > EPS) return { ok: false, delta: {}, reason: "saldo insuficiente" };
  const change = composeUnits(Math.max(0, -remaining), currencies);
  const delta = {};
  for (const [id, n] of Object.entries(taken)) delta[id] = -n;
  for (const [id, n] of Object.entries(change)) delta[id] = (delta[id] ?? 0) + n;
  for (const id of Object.keys(delta)) if (delta[id] === 0) delete delta[id];
  return { ok: true, delta };
}

/** Quanto entra no saldo ao receber `units`: a moeda preferida primeiro, o resto nas menores. */
export function creditUnits(currencies, units, preferredId = "") {
  return composeUnits(units, currencies, preferredId);
}

/** O saldo depois de aplicar `delta` (vezes `sign`: −1 desfaz). `ok` é falso se alguma moeda ficar negativa. */
export function applyDelta(wallet, delta, sign = 1) {
  const next = { ...(wallet ?? {}) };
  for (const [id, n] of Object.entries(delta ?? {})) {
    const value = walletAmount(next[id]) + sign * (Number(n) || 0);
    if (value < 0) return { ok: false, wallet: next, reason: "saldo insuficiente" };
    next[id] = value;
  }
  return { ok: true, wallet: next };
}

/** Só as moedas que mudam (o que vai para o `update` do Ator): `{"system.currencies.gold": 5}`. */
export function walletUpdate(wallet, delta, sign = 1) {
  const result = applyDelta(wallet, delta, sign);
  if (!result.ok) return { ok: false, update: {}, reason: result.reason };
  const update = {};
  for (const id of Object.keys(delta ?? {})) update[`system.currencies.${id}`] = result.wallet[id];
  return { ok: true, update };
}

/** O contrário de um `delta` (para Desfazer). */
export function invertDelta(delta) {
  const out = {};
  for (const [id, n] of Object.entries(delta ?? {})) out[id] = -(Number(n) || 0);
  return out;
}

/* ------------------------------------------------------------------ Histórico (Desfazer) */

/** Põe a venda no fim do histórico e corta o que passa do teto (as mais antigas saem). */
export function pushHistory(history, entry, cap = HISTORY_CAP) {
  const list = [...(history ?? []), entry];
  return list.length > cap ? list.slice(list.length - cap) : list;
}

/** A última venda que ainda pode ser desfeita (a de baixo, que não foi desfeita). */
export function lastUndoable(history) {
  const list = history ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (!list[i]?.undone) return list[i];
  return null;
}

/** Só a última venda desfazível se desfaz (desfazer uma do meio embaralharia o estoque). */
export function canUndoEntry(history, id) {
  const last = lastUndoable(history);
  return Boolean(last) && last.id === id;
}

/** O histórico com a entrada marcada como desfeita. */
export function markUndone(history, id) {
  return (history ?? []).map(entry => (entry?.id === id ? { ...entry, undone: true } : entry));
}

/* ------------------------------------------------------------------ Troca (dois lados) */

/**
 * Itens de um lado da troca, limpos: `{id, qty}` com qty inteiro ≥ 1, o mesmo id somado.
 * @param {Array<{id:string, qty:number}>} list
 */
export function normalizeTradeItems(list) {
  const map = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    const qty = toInt(entry?.qty, 0);
    if (!id || qty < 1) continue;
    map.set(id, (map.get(id) ?? 0) + qty);
  }
  return [...map].map(([id, qty]) => ({ id, qty }));
}

/** Moedas de um lado da troca: `{amount, currency}` ou null. */
export function normalizeTradeCoins(coins) {
  const amount = Number(coins?.amount);
  if (!coins || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount: Math.round(amount * 100) / 100, currency: typeof coins.currency === "string" ? coins.currency : "" };
}

/**
 * Uma troca vazia entre dois lados ("a" e "b"): cada lado põe itens e moedas, e os dois têm de
 * aceitar. Serve à avaliação (jogador põe itens, Mestre põe a oferta) e, no lote B, à troca entre
 * dois jogadores.
 */
export function newTrade(extra = {}) {
  return {
    ...extra,
    a: { items: [], coins: null },
    b: { items: [], coins: null },
    accepted: { a: false, b: false },
    rev: 0
  };
}

const tradeSides = ["a", "b"];
const sameSide = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/**
 * Muda um lado da troca. Qualquer mudança de verdade apaga os DOIS aceites (a regra de quem já
 * aceitou: "qualquer mudança depois de um aceite apaga os dois"); repetir o que já está não faz nada.
 * @returns {{trade:object, changed:boolean}}
 */
export function tradeSet(trade, side, patch = {}) {
  if (!tradeSides.includes(side)) return { trade, changed: false };
  const current = trade[side] ?? { items: [], coins: null };
  const next = {
    items: patch.items !== undefined ? normalizeTradeItems(patch.items) : current.items,
    coins: patch.coins !== undefined ? normalizeTradeCoins(patch.coins) : current.coins
  };
  if (sameSide(next, current)) return { trade, changed: false };
  return { trade: { ...trade, [side]: next, accepted: { a: false, b: false }, rev: (trade.rev ?? 0) + 1 }, changed: true };
}

/** Um lado aceita (ou retira o aceite). */
export function tradeAccept(trade, side, accepted = true) {
  if (!tradeSides.includes(side)) return trade;
  return { ...trade, accepted: { ...trade.accepted, [side]: Boolean(accepted) } };
}

/** Os dois lados aceitaram e há algo na mesa? */
export function tradeReady(trade) {
  if (!trade?.accepted?.a || !trade?.accepted?.b) return false;
  const filled = side => (trade[side]?.items?.length ?? 0) > 0 || Boolean(trade[side]?.coins);
  return filled("a") || filled("b");
}

/* ------------------------------------------------------------------ Validar Mundo */

/**
 * Problemas de uma loja ligada, em texto. Pura: recebe o que o validador já leu.
 * @param {{shop:object, stock:Array<{name:string, hasPrice:boolean, stock:(number|null)}>, shopsEnabled?:boolean}} p
 * @returns {Array<{where:string, message:string}>}
 */
export function shopSetupIssues({ shop, stock = [], shopsEnabled = true, depotAnywhere = true }) {
  const s = normalizeShop(shop);
  if (!s.enabled || !shopsEnabled) return [];
  const issues = [];
  if (!stock.length) issues.push({ where: "Loja", message: "está aberta mas não tem nenhum item no estoque" });
  else if (stock.every(i => i.stock === 0)) issues.push({ where: "Loja", message: "todos os itens estão esgotados" });
  for (const item of stock) {
    if (!item.hasPrice) issues.push({ where: `Loja › ${item.name}`, message: "à venda sem preço base (sai de graça): preencha o preço na ficha do Item ou ajuste na aba Loja" });
  }
  if (s.style === "machine" && s.kind !== "auto") issues.push({ where: "Loja", message: "aparência de máquina de venda só vale para ponto automático: com vendedor NPC ela abre como vitrine comum" });
  if (s.kind === "auto" && s.buybackFraction <= 0) issues.push({ where: "Loja", message: "ponto automático com compra de volta em 0%: jogador vende de graça" });
  if (s.online) {
    if (!depotAnywhere && stock.some(i => !i.digital)) issues.push({ where: "Loja", message: "é online mas nenhuma cena (nem pasta de cenas) tem um depósito em \"Entregas vão para\": o que não for software não tem para onde ser entregue" });
  }
  for (const item of stock) {
    if (item.digital && Number(item.deliveryHours) > 0) issues.push({ where: `Loja › ${item.name}`, message: "item digital com prazo de entrega: software chega na hora, o prazo é ignorado" });
  }
  return issues;
}

/* ------------------------------------------------------------------ Compras online (lote C) */

const MAX_LINE_QTY = 999;
export const MAX_ORDER_LINES = 30;
/** Quantos pedidos o PAD guarda no personagem (os mais novos primeiro). */
export const ORDERS_CAP = 30;

/**
 * O aparelho consegue comprar online agora? Sem energia (PEM/campo) não; com o bloco Calendário
 * ligado precisa da cena "tem rede" (ou Região com rede); com o Calendário desligado a rede não
 * existe como conceito e vale sempre.
 * @returns {{ok:boolean, state:"ok"|"suppressed"|"noNetwork", reason:string}}
 */
export function shopNetworkState({ calendarOn = false, network = false, suppressed = false } = {}) {
  if (suppressed) return { ok: false, state: "suppressed", reason: "o aparelho está sem energia (PEM ou campo de supressão)" };
  if (calendarOn && !network) return { ok: false, state: "noNetwork", reason: "sem rede aqui" };
  return { ok: true, state: "ok", reason: "" };
}

/** Horas de entrega de uma linha: software chega na hora; senão vale o prazo do item, senão o da loja. */
export function deliveryHoursFor({ digital = false, itemHours = null, shopHours = 0 } = {}) {
  if (digital) return 0;
  const own = itemHours == null || itemHours === "" ? null : Number(itemHours);
  const hours = own !== null && Number.isFinite(own) && own >= 0 ? own : Number(shopHours);
  return Number.isFinite(hours) && hours > 0 ? Math.min(MAX_DELIVERY_HOURS, hours) : 0;
}

/** Quando a entrega chega (relógio do mundo, segundos), ou `null` = na hora. */
export function arriveAtFor(now, hours) {
  const h = Number(hours);
  return Number.isFinite(h) && h > 0 ? Math.round(Number(now) || 0) + Math.round(h * 3600) : null;
}

/** "na hora", "2 dias", "1,5 dia", "6 h": o prazo como a etiqueta do produto mostra. `dayLength` em segundos. */
export function deliveryLabel(hours, dayLength = 86400) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "na hora";
  const days = (h * 3600) / Math.max(1, Number(dayLength) || 86400);
  if (days >= 0.95) {
    const rounded = Math.round(days);
    if (Math.abs(days - rounded) < 0.05) return `${rounded} ${rounded === 1 ? "dia" : "dias"}`;
    return `${formatNumber(Math.round(days * 10) / 10)} dias`;
  }
  return `${formatNumber(Math.round(h * 10) / 10)} h`;
}

/**
 * Onde entregar: o depósito do lugar ou o porão de uma nave tripulada e atracada ali.
 * @param {{requested?:string, needsAddress?:boolean, depot?:({uuid:string,name:string}|null), ships?:Array<{uuid:string,name:string,docked:boolean}>}} p
 * @returns {{ok:boolean, mode:"none"|"depot"|"ship", shipUuid:string, reason:string}}
 */
export function chooseDestination({ requested = "", needsAddress = true, depot = null, ships = [] } = {}) {
  if (!needsAddress) return { ok: true, mode: "none", shipUuid: "", reason: "" };
  const want = String(requested ?? "");
  if (want && want !== "depot") {
    const ship = (ships ?? []).find(s => s.uuid === want);
    if (!ship) return { ok: false, mode: "none", shipUuid: "", reason: "essa nave não é uma das que você tripula" };
    if (!ship.docked || !depot) return { ok: false, mode: "none", shipUuid: "", reason: `${ship.name} não está atracada aqui` };
    return { ok: true, mode: "ship", shipUuid: ship.uuid, reason: "" };
  }
  if (!depot) return { ok: false, mode: "none", shipUuid: "", reason: "sem endereço de entrega aqui" };
  return { ok: true, mode: "depot", shipUuid: "", reason: "" };
}

/** As opções de destino do carrinho (depósito e porões), com o motivo de cada uma desligada. */
export function destinationOptions({ depot = null, ships = [], selected = "" } = {}) {
  const options = [{
    value: "depot",
    label: depot ? depot.name : "Depósito do lugar",
    hint: depot ? "onde você está" : "esta cena não aponta para um depósito",
    disabled: !depot
  }];
  for (const ship of ships ?? []) {
    const ok = Boolean(ship.docked && depot);
    options.push({ value: ship.uuid, label: `Porão da ${ship.name}`, hint: ok ? "nave atracada aqui" : "a nave não está atracada aqui", disabled: !ok });
  }
  const pick = options.find(o => o.value === selected && !o.disabled) ?? options.find(o => !o.disabled) ?? null;
  return options.map(o => ({ ...o, selected: o === pick }));
}

/** O pedido do carrinho que chega pelo relay: linhas `{shopUuid, itemId, qty}` válidas, iguais somadas, no máximo 30. */
export function normalizeOrderLines(raw) {
  const out = [];
  for (const line of Array.isArray(raw) ? raw : []) {
    const shopUuid = typeof line?.shopUuid === "string" ? line.shopUuid : "";
    const itemId = typeof line?.itemId === "string" ? line.itemId : "";
    const qty = Math.min(MAX_LINE_QTY, Math.floor(Number(line?.qty ?? line?.quantity)));
    if (!shopUuid || !itemId || !Number.isFinite(qty) || qty < 1) continue;
    const same = out.find(l => l.shopUuid === shopUuid && l.itemId === itemId);
    if (same) same.qty = Math.min(MAX_LINE_QTY, same.qty + qty);
    else if (out.length < MAX_ORDER_LINES) out.push({ shopUuid, itemId, qty });
  }
  return out;
}

/** Agrupa as linhas por loja, na ordem em que as lojas aparecem. */
export function groupByShop(lines) {
  const groups = [];
  for (const line of lines ?? []) {
    let group = groups.find(g => g.shopUuid === line.shopUuid);
    if (!group) groups.push((group = { shopUuid: line.shopUuid, lines: [] }));
    group.lines.push(line);
  }
  return groups;
}

/** Soma `delta` à linha do carrinho (cria se faltar, apaga se chegar a 0). Não muta. */
export function cartChange(cart, key, delta) {
  const list = Array.isArray(cart) ? cart.map(l => ({ ...l })) : [];
  const line = list.find(l => l.shopUuid === key.shopUuid && l.itemId === key.itemId);
  if (!line) return delta > 0 ? [...list, { shopUuid: key.shopUuid, itemId: key.itemId, qty: Math.min(MAX_LINE_QTY, Math.floor(delta)) }] : list;
  line.qty = Math.min(MAX_LINE_QTY, Math.floor(line.qty + delta));
  return line.qty < 1 ? list.filter(l => l !== line) : list;
}

/** Pedidos novos na frente, no máximo `ORDERS_CAP`. */
export function pushOrders(list, records) {
  const fresh = (records ?? []).filter(r => r && typeof r === "object");
  return [...fresh, ...(Array.isArray(list) ? list : [])].slice(0, ORDERS_CAP);
}

/**
 * Como um pedido aparece na aba Entregas, pelo relógio do mundo.
 * `gone`: o item físico já não está no depósito (alguém retirou).
 * @returns {{state:"transit"|"arrived"|"taken", progress:number, remaining:number}}
 */
export function orderState(order, now, { gone = false } = {}) {
  const arriveAt = order?.arriveAt == null ? null : Number(order.arriveAt);
  const orderedAt = Number(order?.orderedAt) || 0;
  const t = Number(now) || 0;
  if (order?.mode === "digital" || arriveAt === null || t >= arriveAt) {
    return { state: order?.mode === "depot" && gone ? "taken" : "arrived", progress: 1, remaining: 0 };
  }
  const span = Math.max(1, arriveAt - orderedAt);
  return { state: "transit", progress: clamp((t - orderedAt) / span, 0, 1), remaining: arriveAt - t };
}
