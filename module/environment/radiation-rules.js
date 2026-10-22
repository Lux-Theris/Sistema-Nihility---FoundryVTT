/**
 * Radiação (Ambiente) — a parte pura e testada. Quem lê cenas, Regions, Tokens e fichas é
 * `environment/radiation.js`.
 *
 *  - Fontes: a cena inteira, áreas (Region) e Tokens que emitem (barril, reator, mutante). Cada
 *    fonte tem um NÍVEL; um Token emite num raio e o nível cai com a distância (cheio colado nele,
 *    zero na borda). Fontes somam.
 *  - Irradiação: o quanto o personagem acumulou. Dentro, sobe uma fração do nível do lugar por
 *    rodada (fonte forte irradia mais rápido) até o teto = o nível do lugar. Fora (ou num lugar mais
 *    fraco que a irradiação), cai uma fração da irradiação por rodada até o nível do lugar.
 *  - Dano por rodada = irradiação × pontos por nível. Fixo de propósito: quem fica tempo demais
 *    perto de uma fonte forte acumula irradiação alta e leva milhares de dano num turno.
 */

/** Uma fonte de Token limpa: `{level, radius}` (raio em unidades da cena), ou null. */
export function normalizeRadiationSource(source) {
  const level = Number(source?.level);
  if (!Number.isFinite(level) || level <= 0) return null;
  const radius = Number(source?.radius);
  return { level, radius: Number.isFinite(radius) && radius > 0 ? radius : 0 };
}

/**
 * Nível que uma fonte de Token entrega a uma distância: cheio no centro, caindo em linha reta até
 * zero na borda do raio. Raio 0 = só quem está em cima dela (distância 0).
 */
export function emitterExposure(level, distance, radius) {
  const lvl = Number(level) || 0;
  const r = Number(radius) || 0;
  const d = Math.max(0, Number(distance) || 0);
  if (lvl <= 0) return 0;
  if (r <= 0) return d <= 1e-6 ? lvl : 0;
  if (d >= r) return 0;
  return lvl * (1 - d / r);
}

/**
 * Nível de radiação num ponto: cena + áreas + Tokens emissores, somados (dois barris irradiam mais
 * que um). Inteiro, para baixo.
 * @param {{scene?: number, areas?: number[], emitters?: Array<{level:number, distance:number, radius:number}>}} sources
 */
export function totalExposure({ scene = 0, areas = [], emitters = [] } = {}) {
  let total = Math.max(0, Number(scene) || 0);
  for (const value of areas ?? []) total += Math.max(0, Number(value) || 0);
  for (const e of emitters ?? []) total += emitterExposure(e?.level, e?.distance, e?.radius);
  return Math.floor(total + 1e-9);
}

/**
 * Uma rodada: a irradiação anda em direção ao nível do lugar. Sobe `gainPercent`% do nível do lugar
 * (mínimo 1) sem passar dele; desce `decayPercent`% da irradiação atual (mínimo 1) sem passar dele.
 */
export function radiationStep(current, exposure, { gainPercent = 20, decayPercent = 10 } = {}) {
  const now = Math.max(0, Math.floor(Number(current) || 0));
  const cap = Math.max(0, Math.floor(Number(exposure) || 0));
  if (now < cap) return Math.min(cap, now + Math.max(1, Math.ceil((cap * (Number(gainPercent) || 0)) / 100)));
  if (now > cap) return Math.max(cap, now - Math.max(1, Math.ceil((now * (Number(decayPercent) || 0)) / 100)));
  return now;
}

/** Dano de uma rodada com essa irradiação. */
export function radiationDamage(level, perLevel = 1) {
  return Math.max(0, Math.floor((Number(level) || 0) * (Number(perLevel) || 0)));
}

/**
 * Várias rodadas seguidas no mesmo lugar ("Passar tempo"): cada rodada anda a irradiação e causa o
 * dano do nível novo. Devolve a irradiação final e o dano somado (antes das Resistências).
 */
export function simulateRadiation(current, exposure, rounds, config = {}) {
  let level = Math.max(0, Math.floor(Number(current) || 0));
  let damage = 0;
  const n = Math.max(0, Math.floor(Number(rounds) || 0));
  for (let i = 0; i < n; i++) {
    level = radiationStep(level, exposure, config);
    damage += radiationDamage(level, config.perLevel ?? 1);
    if (level === 0 && (Number(exposure) || 0) <= 0) break;
  }
  return { level, damage };
}
