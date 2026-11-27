/**
 * Golpes N e a corrente "Saltar entre alvos" (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * - **Golpes N** (`strikes`, 1 a 10): o dano ou os efeitos da Skill saem N vezes no mesmo uso, sem pagar de novo.
 *   Cada golpe é uma rolagem e um card próprios (o Mestre aplica e desfaz cada um).
 * - **Corrente** (`chainChance`, `chainRadius`, `chainRepeat`): com a corrente ligada (chance > 0), depois de cada golpe
 *   cada alvo até X m do último rola a chance; o raio salta para **um** dos que passaram, o mais perto; se ninguém
 *   passou, a corrente para. Golpes N = no máximo N − 1 saltos. "O mesmo alvo de novo" deixa o próprio último alvo
 *   entrar na disputa. Sem corrente, os N golpes caem no mesmo alvo (ou na mesma área).
 *   (O nome do plano é "Saltar"; no jogo a corrente leva o rótulo "Corrente" para não se confundir com o Saltar do
 *   Espaço, o teleporte.)
 */

export const MAX_STRIKES = 10;
export const DEFAULT_CHAIN_RADIUS = 5;

/** Quantos golpes: inteiro de 1 a 10. */
export function strikeCount(mech) {
  const n = Math.floor(Number(mech?.strikes) || 1);
  return Math.min(MAX_STRIKES, Math.max(1, n));
}

/** A chance da corrente (%) com o bônus de nível, até 100. `bonus` = pontos ganhos pela progressão por chance. */
export function chainChance(mech, bonus = 0) {
  const base = Math.max(0, Math.min(100, Number(mech?.chainChance) || 0));
  if (base <= 0 && !(Number(bonus) > 0)) return 0;
  return Math.min(100, Math.round(base + Math.max(0, Number(bonus) || 0)));
}

/** A corrente está ligada nesta mecânica? (só vale com mais de 1 golpe) */
export function hasChain(mech) {
  return strikeCount(mech) > 1 && (Number(mech?.chainChance) || 0) > 0;
}

/** O raio da corrente em metros (0 = o padrão de 5 m). */
export function chainRadius(mech) {
  const r = Number(mech?.chainRadius) || 0;
  return r > 0 ? r : DEFAULT_CHAIN_RADIUS;
}

/**
 * Um salto da corrente.
 * @param {Array<{uuid:string, distance:number}>} neighbors - os possíveis alvos, com a distância (m) ao último alvo
 *   (o próprio último alvo entra com distância 0; quem usa e os mortos já ficam de fora)
 * @param {{lastUuid?: string, radius?: number, chance?: number, allowRepeat?: boolean, roll?: (chance:number)=>boolean}} options
 *   `roll(chance)` devolve se a chance passou (injetável para teste)
 * @returns {{picked: string|null, tried: number, passed: string[]}}
 */
export function chainStep(neighbors, { lastUuid = "", radius = DEFAULT_CHAIN_RADIUS, chance = 0, allowRepeat = false, roll = c => Math.random() * 100 < c } = {}) {
  const eligible = (neighbors ?? [])
    .filter(n => n && n.uuid && Number.isFinite(n.distance) && n.distance <= radius + 1e-9 && (allowRepeat || n.uuid !== lastUuid))
    .sort((a, b) => a.distance - b.distance);
  const passed = eligible.filter(n => roll(chance)).map(n => n.uuid);
  return { picked: passed[0] ?? null, tried: eligible.length, passed };
}

/** Texto da corrente para a frase da Skill: "3 golpes, saltando entre alvos (40%, até 5 m)". */
export function strikesSentence(mech, chance = null) {
  const n = strikeCount(mech);
  if (n <= 1) return "";
  if (!hasChain(mech)) return `${n} golpes`;
  const c = chance ?? chainChance(mech);
  const radius = String(Math.round(chainRadius(mech) * 100) / 100).replace(".", ",");
  return `${n} golpes, saltando entre alvos (${c}%, até ${radius} m${mech.chainRepeat ? ", pode repetir o alvo" : ""})`;
}

/** Avisos do editor: lista de `{code, level, text}`. */
export function strikesLint(mech) {
  const out = [];
  const n = strikeCount(mech);
  if (Number(mech?.chainChance) > 0 && n <= 1) out.push({ code: "chainNoStrikes", level: "soft", text: "A corrente (Saltar entre alvos) precisa de mais de 1 golpe: com 1 golpe só ela não faz nada." });
  if (Number(mech?.strikes) > MAX_STRIKES) out.push({ code: "strikesTooMany", level: "soft", text: `Golpes acima de ${MAX_STRIKES} valem ${MAX_STRIKES}.` });
  if (n > 1 && mech?.hasUpkeep && mech?.effectType === "damage") out.push({ code: "strikesActive", level: "soft", text: "Golpes N numa Habilidade Ativa: os golpes saem só ao ligar." });
  return out;
}
