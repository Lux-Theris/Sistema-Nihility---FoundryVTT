/**
 * Simulador de encontro (backlog E3; canvas "Simulador de Encontro", aprovado em 01/11) — a parte
 * pura: dado o golpe médio de cada atacante contra cada tipo de alvo (calculado em
 * encounter-sim.js pelo mesmo caminho do dano de verdade), estima as rodadas, quem cai primeiro,
 * o veredito e a menor mudança que deixa a luta "justa". Testado em test/encounter.test.mjs.
 *
 * Modelo, de propósito simples (é uma estimativa pela média):
 *  - cada um faz UM ataque por rodada, com o ataque escolhido; um ataque em área acerta até
 *    `targets` alvos vivos de uma vez;
 *  - "vencer" = a Vida (+ Escudo) de todos do outro lado acabar, com o lado inteiro batendo e
 *    focando quem cai mais rápido;
 *  - "derrubar um PJ" = todos os oponentes indo no PJ que cai mais rápido (o pior caso).
 * Nada de cura, Condição, tática nem posição no mapa.
 */
import { npcTierHp, NPC_TIERS } from "../npc/npc-generator-rules.js";

export const VERDICTS = ["easy", "fair", "dangerous", "deadly"];
export const VERDICT_LABELS = { easy: "fácil", fair: "justo", dangerous: "perigoso", deadly: "mortal" };

/** Limite de rodadas simuladas (uma luta que não acaba conta como "não acaba"). */
export const MAX_ROUNDS = 60;

/**
 * Vida efetiva de uma unidade: Vida máxima (antes do Nível de NPC) ajustada pelo nível, + Escudo.
 * @param {{hpBase: number, tier?: string, shield?: number}} unit
 * @param {{elite?: number, boss?: number}} tiers
 */
export function unitHp(unit, tiers = {}) {
  const base = Math.max(1, Number(unit?.hpBase) || 1);
  const hp = unit?.tier ? npcTierHp(base, unit.tier, tiers) : base;
  return hp + Math.max(0, Number(unit?.shield) || 0);
}

/** Golpes para derrubar: ⌈Vida ÷ golpe⌉ (Infinity se o golpe não passa). */
export function hitsToDrop(hp, hit) {
  const h = Number(hit) || 0;
  if (!(h > 0)) return Infinity;
  return Math.max(1, Math.ceil((Number(hp) || 0) / h - 1e-9));
}

/**
 * Expande as unidades com `count` em indivíduos.
 * @param {Array<{key: string, count?: number}>} units
 */
function expand(units, tiers) {
  const out = [];
  for (const unit of units ?? []) {
    const n = Math.max(0, Math.round(Number(unit.count ?? 1)));
    for (let i = 0; i < n; i++) out.push({ unit, key: unit.key, hp: unitHp(unit, tiers), index: i });
  }
  return out;
}

/**
 * Rodadas para um lado derrubar o outro inteiro, sem o outro revidar. Cada atacante bate uma vez
 * por rodada no alvo vivo que cai mais rápido para ele; área acerta até `targets` vivos.
 * @param {Array} attackers - unidades com `attack: {perTarget: {key: dano}, targets: n, uses, fallback}`
 * @param {Array} defenders
 * @returns {number} rodadas (Infinity se não derruba em MAX_ROUNDS)
 */
export function roundsToDefeat(attackers, defenders, tiers = {}) {
  const atk = expand(attackers, tiers);
  const def = expand(defenders, tiers);
  if (!def.length) return 0;
  if (!atk.length) return Infinity;
  const used = new Map();
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const a of atk) {
      const attack = currentAttack(a, used);
      if (!attack) continue;
      const alive = def.filter(d => d.hp > 0);
      if (!alive.length) break;
      const hitOf = d => Number(attack.perTarget?.[d.key]) || 0;
      // Alvo: quem cai em menos golpes deste atacante (empate: menos Vida).
      alive.sort((x, y) => hitsToDrop(x.hp, hitOf(x)) - hitsToDrop(y.hp, hitOf(y)) || x.hp - y.hp);
      const n = Math.max(1, Math.round(Number(attack.targets) || 1));
      for (const d of alive.slice(0, n)) d.hp -= hitOf(d);
    }
    if (def.every(d => d.hp <= 0)) return round;
  }
  return Infinity;
}

/** O ataque deste indivíduo nesta rodada: o escolhido até acabarem os usos, depois o de reserva. */
function currentAttack(individual, used) {
  const attack = individual.unit.attack;
  if (!attack) return null;
  const id = `${individual.key}#${individual.index}`;
  const count = used.get(id) ?? 0;
  used.set(id, count + 1);
  const uses = attack.uses ?? Infinity;
  return count < uses ? attack : attack.fallback ?? null;
}

/**
 * Rodadas para os `attackers` derrubarem UM defensor, todos indo nele (o pior caso).
 * @returns {{key: string, name: string, rounds: number}[]} um por indivíduo dos defensores (únicos por key)
 */
export function roundsToDropEach(attackers, defenders, tiers = {}) {
  const atk = expand(attackers, tiers);
  return (defenders ?? []).map(unit => {
    const perRound = atk.reduce((sum, a) => sum + (Number(a.unit.attack?.perTarget?.[unit.key]) || 0), 0);
    const hp = unitHp(unit, tiers);
    return { key: unit.key, name: unit.name, rounds: perRound > 0 ? Math.max(1, Math.ceil(hp / perRound - 1e-9)) : Infinity };
  });
}

/**
 * O veredito: fácil (o grupo vence antes de qualquer PJ poder cair), justo (vence mais ou menos
 * quando o mais frágil cairia: até 1 rodada a mais), perigoso (algum PJ cai antes, mas o grupo
 * vence), mortal (o grupo inteiro cai antes de vencer).
 */
export function encounterVerdict({ win, dropFirst, wipe }) {
  if (!Number.isFinite(win)) return Number.isFinite(wipe) ? "deadly" : "dangerous";
  if (!Number.isFinite(dropFirst) || win < dropFirst) return "easy";
  if (win <= dropFirst + 1) return "fair";
  if (!Number.isFinite(wipe) || win < wipe) return "dangerous";
  return "deadly";
}

/**
 * A luta inteira.
 * @param {{allies: Array, foes: Array}} sides - unidades `{key, name, hpBase, shield, tier?, count?, attack}`
 * @param {{elite?: number, boss?: number}} [tiers]
 */
export function evaluateEncounter({ allies, foes }, tiers = {}) {
  const win = roundsToDefeat(allies, foes, tiers);
  const wipe = roundsToDefeat(foes, allies, tiers);
  const drops = roundsToDropEach(foes, allies, tiers);
  const first = drops.reduce((best, d) => (d.rounds < (best?.rounds ?? Infinity) ? d : best), null);
  const dropFirst = first?.rounds ?? Infinity;
  return { win, wipe, dropFirst, weakest: first, verdict: encounterVerdict({ win, dropFirst, wipe }) };
}

/**
 * A menor mudança nos oponentes que leva ao "justo": um Nível de NPC acima/abaixo, ou ±1 na
 * quantidade de um tipo. Devolve `null` se já é justo ou nada simples resolve.
 * @returns {{text: string, foes: Array}|null}
 */
export function suggestAdjustment(sides, tiers = {}) {
  const current = evaluateEncounter(sides, tiers).verdict;
  if (current === "fair") return null;
  const harder = current === "easy";
  const tryFoes = (foes, text) => (evaluateEncounter({ allies: sides.allies, foes }, tiers).verdict === "fair" ? { text, foes } : null);
  const candidates = [];
  sides.foes.forEach((foe, i) => {
    const idx = NPC_TIERS.indexOf(foe.tier || "normal");
    const step = harder ? 1 : -1;
    const nextTier = NPC_TIERS[idx + step];
    if (foe.npc && nextTier) {
      candidates.push(() => tryFoes(sides.foes.map((f, j) => (j === i ? { ...f, tier: nextTier } : f)), `troque ${foe.name} para ${TIER_WORDS[nextTier]}`));
    }
    const count = Math.max(0, Math.round(Number(foe.count ?? 1)));
    if (harder) candidates.push(() => tryFoes(sides.foes.map((f, j) => (j === i ? { ...f, count: count + 1 } : f)), `ponha mais 1 ${foe.name}`));
    else if (count > 0) candidates.push(() => tryFoes(sides.foes.map((f, j) => (j === i ? { ...f, count: count - 1 } : f)), `tire 1 ${foe.name}`));
  });
  for (const make of candidates) {
    const found = make();
    if (found) return found;
  }
  return null;
}

const TIER_WORDS = { minion: "Lacaio", normal: "Normal", elite: "Elite", boss: "Chefe" };

/** "~6 rodadas" / "1 rodada" / "não acaba". */
export function roundsText(rounds) {
  if (!Number.isFinite(rounds)) return "não acaba";
  if (rounds <= 1) return "1 rodada";
  return `~${rounds} rodadas`;
}
