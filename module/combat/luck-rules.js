/**
 * Sorte (item 8d.1) — regras PURAS, testadas (test/luck.test.mjs). Sem imports de propósito.
 *
 * Sorte é uma INCLINAÇÃO em % sobre as faces de um dado: o peso da face i de N é e^(k·t), com
 * t = 2(i−1)/(N−1) − 1 (−1 na face 1, +1 na última) e k = sorte ÷ 100, normalizado. Nunca dá peso
 * negativo, não tem teto e nunca vira certeza. Negativo = azar (puxa para as faces baixas).
 *
 * Três escopos, cada fonte marca os seus: `attributes` (pool de d20 dos atributos e iniciativa),
 * `damage` (dados das fórmulas de dano de quem ataca) e `chances` (os d100 de Condição ao acertar,
 * Predação, Contágio…). Numa chance, sorte favorece o resultado BAIXO (sucesso = ≤ chance).
 */

export const LUCK_SCOPES = ["attributes", "damage", "chances"];

export const LUCK_SCOPE_LABELS = {
  attributes: "Atributos e iniciativa",
  damage: "Dano",
  chances: "Chances (d100)"
};

/** Os três escopos zerados. */
export function emptyLuck() {
  return { attributes: 0, damage: 0, chances: 0 };
}

/** Qualquer coisa → `{attributes, damage, chances}` com números finitos (resto vira 0). */
export function normalizeLuck(value) {
  const out = emptyLuck();
  for (const scope of LUCK_SCOPES) {
    const n = Number(value?.[scope]);
    out[scope] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Tem alguma sorte (≠ 0) em algum escopo? */
export function hasLuck(value) {
  const l = normalizeLuck(value);
  return LUCK_SCOPES.some(s => l[s] !== 0);
}

/**
 * Um efeito "Sorte ±X%" com as caixas dos escopos → `{attributes, damage, chances}`.
 * @param {number} value - % (negativo = azar)
 * @param {{attributes?:boolean, damage?:boolean, chances?:boolean}} scopes
 */
export function luckFromScopes(value, scopes) {
  const v = Number(value);
  const n = Number.isFinite(v) ? v : 0;
  const out = emptyLuck();
  for (const scope of LUCK_SCOPES) out[scope] = scopes?.[scope] ? n : 0;
  return out;
}

/** Quais escopos uma sorte toca (lista de ids). */
export function luckScopesOf(value) {
  const l = normalizeLuck(value);
  return LUCK_SCOPES.filter(s => l[s] !== 0);
}

/**
 * Soma as fontes de sorte. `cap` > 0 limita cada escopo a ±cap (opção `luckCap` do bloco); 0 = sem teto.
 * @param {Array<{attributes?:number, damage?:number, chances?:number}>} sources
 * @param {{cap?:number}} [options]
 */
export function sumLuck(sources = [], { cap = 0 } = {}) {
  const total = emptyLuck();
  for (const source of sources) {
    const l = normalizeLuck(source);
    for (const scope of LUCK_SCOPES) total[scope] += l[scope];
  }
  const limit = Math.max(0, Number(cap) || 0);
  for (const scope of LUCK_SCOPES) {
    if (limit) total[scope] = Math.max(-limit, Math.min(limit, total[scope]));
    total[scope] = Math.round(total[scope] * 100) / 100;
  }
  return total;
}

/**
 * Pesos (somam 1) das `faces` faces de um dado com `luck` % de sorte.
 * @returns {number[]}
 */
export function luckWeights(faces, luck) {
  const n = Math.max(1, Math.floor(Number(faces) || 1));
  if (n === 1) return [1];
  const k = (Number(luck) || 0) / 100;
  // Desloca pelo maior expoente (|k|) para nunca estourar com sorte enorme.
  const raw = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * i) / (n - 1) - 1;
    raw.push(Math.exp(k * t - Math.abs(k)));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => w / sum);
}

/**
 * Sorteia uma face (1..faces) com os pesos da sorte. Sem sorte, é o dado normal.
 * @param {() => number} [rand] - injetável para teste (0 ≤ x < 1)
 */
export function sampleLuckFace(faces, luck, rand = Math.random) {
  const n = Math.max(1, Math.floor(Number(faces) || 1));
  if (!Number(luck)) return Math.min(n, Math.floor(rand() * n) + 1);
  const weights = luckWeights(n, luck);
  let u = rand();
  for (let i = 0; i < n; i += 1) {
    u -= weights[i];
    if (u < 0) return i + 1;
  }
  return n;
}

/** Média de um dado de `faces` faces com `luck` % de sorte (sem sorte: (faces+1)/2). */
export function luckMean(faces, luck) {
  const weights = luckWeights(faces, luck);
  return weights.reduce((sum, w, i) => sum + w * (i + 1), 0);
}

/**
 * Acrescenta o modificador de sorte (`lu30` sorte, `ul30` azar) a cada termo de dado da fórmula,
 * logo depois do dado e antes dos modificadores que ele já tinha (assim `2d6kh` sorteia com a
 * sorte e SÓ depois guarda o maior). Fórmula sem dado, ou sem sorte, volta como está.
 */
export function applyLuckToFormula(formula, luck) {
  const text = String(formula ?? "");
  const amount = Math.round(Math.abs(Number(luck) || 0));
  if (!amount) return text;
  const tag = `${Number(luck) > 0 ? "lu" : "ul"}${amount}`;
  return text.replace(/(?<![A-Za-z_@.\d])(\d*d\d+)(?!\d|(?:lu|ul)\d)/gi, `$1${tag}`);
}

/** O modificador de dado ("lu30"/"ul30"/"") de uma sorte. */
export function luckModifierText(luck) {
  const amount = Math.round(Math.abs(Number(luck) || 0));
  if (!amount) return "";
  return `${Number(luck) > 0 ? "lu" : "ul"}${amount}`;
}

/**
 * Lê `lu<n>`/`ul<n>` (como o Foundry entrega o modificador) → sorte com sinal.
 * @returns {number|null} null se não é um modificador de sorte
 */
export function parseLuckModifier(modifier) {
  const m = String(modifier ?? "").match(/^(lu|ul)(\d+(?:\.\d+)?)?/i);
  if (!m) return null;
  const n = Number(m[2] ?? 0) || 0;
  return m[1].toLowerCase() === "ul" ? -n : n;
}

/**
 * Número em [0, 1) com a mesma inclinação, para chances contínuas: sorte POSITIVA puxa para 0
 * (resultado baixo = sucesso numa chance), negativa para 1. Inversa da CDF de densidade ∝ e^(−2kx).
 */
export function luckUnit(luck, rand = Math.random) {
  const u = rand();
  const k = (Number(luck) || 0) / 100;
  if (!k) return u;
  const a = Math.abs(k);
  const x = -Math.log(1 - u * (1 - Math.exp(-2 * a))) / (2 * a);
  const clamped = Math.min(Math.max(x, 0), 1 - Number.EPSILON);
  return k > 0 ? clamped : 1 - clamped;
}

/** Chance de sucesso (%) de uma chance `percent` com `luck` % de sorte (para mostrar/testar). */
export function luckChanceOdds(percent, luck) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  const k = (Number(luck) || 0) / 100;
  if (!k) return p * 100;
  const a = Math.abs(k);
  const cdf = x => (1 - Math.exp(-2 * a * x)) / (1 - Math.exp(-2 * a));
  return (k > 0 ? cdf(p) : 1 - cdf(1 - p)) * 100;
}

/** Média de uma fórmula (como `averageRoll`) com a sorte nos dados. Só termos `NdM`; o resto soma/subtrai. */
export function averageRollWithLuck(formula, luck = 0) {
  const text = String(formula ?? "").replace(/\s+/g, "").replace(/@[\w.]+/g, "0");
  if (!text) return 0;
  let total = 0;
  const re = /([+-]?)(\d*)d(\d+)[a-z<>=\d]*|([+-]?)(\d+(?:\.\d+)?)/gi;
  let match;
  while ((match = re.exec(text))) {
    if (match[3]) {
      const sign = match[1] === "-" ? -1 : 1;
      const n = match[2] ? Number(match[2]) : 1;
      total += sign * n * luckMean(Number(match[3]), luck);
    } else if (match[5]) {
      total += (match[4] === "-" ? -1 : 1) * Number(match[5]);
    }
  }
  return Math.max(0, total);
}

/** A sorte de um escopo na ficha (`system.luck`), 0 se não tem. */
export function luckOf(actor, scope) {
  const n = Number(actor?.system?.luck?.[scope]);
  return Number.isFinite(n) ? n : 0;
}

/** "+30%" / "−20%" para a ficha. */
export function luckPercentText(value) {
  const n = Math.round(Number(value) || 0);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`;
}

/** Frase curta de uma sorte: "+30% nos atributos · −20% nas chances" (vazio se não há). */
export function describeLuck(value) {
  const l = normalizeLuck(value);
  const names = { attributes: "nos atributos", damage: "no dano", chances: "nas chances" };
  const groups = [];
  for (const scope of LUCK_SCOPES) if (l[scope]) groups.push(`${luckPercentText(l[scope])} ${names[scope]}`);
  if (groups.length === 3 && l.attributes === l.damage && l.damage === l.chances) return `${luckPercentText(l.attributes)} em tudo`;
  return groups.join(" · ");
}
