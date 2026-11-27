/**
 * Ver pela Marca (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * Efeito de Skill (alvo `scry`, grupo Sentidos): o alvo tem de ter **uma Marca de quem usa** (o efeito "Marcado", flag
 * `markedBy`). Enquanto dura, a tela de quem usa (os donos dele) e a do Mestre abrem uma fonte de visão no centro do Token
 * do Marcado, com o raio do efeito (metros; 0 = o alcance de visão do Token de quem olha). O efeito mora em **quem olha**
 * (flag `scry`), nunca no Marcado, para não aparecer um ícone na ficha dele.
 *
 * O que a mesa recebe:
 *  - o Marcado com Detecção alta (a curva das ilusões) **sente que está sendo observado**: um aviso só para o dono dele
 *    e o Mestre, sem dizer quem olha;
 *  - o Mestre vê a linha "Kael vê e ouve pela Marca do batedor" (Painel do combate e Janela de Efeitos) e recebe um aviso
 *    quando a visão abre; o que se fala perto é narrado por ele (sem mecânica);
 *  - o Marcado em outra cena não abre visão nenhuma: o Mestre recebe um card e narra.
 */

export const SCRY_FLAG = "scry";

/** A Detecção que enxerga a observação: L + ⌈g·L ÷ (L + g)⌉, com g = a folga máxima (10 por padrão). */
export function detectionNeeded(level, maxGap = 10) {
  const L = Math.max(0, Number(level) || 0);
  const g = Math.max(0, Number(maxGap) || 0);
  if (L <= 0) return 0;
  return L + Math.ceil((g * L) / (L + g));
}

/** O Marcado sente a observação? `detection` é o nível de Detecção dele; `level` o da Skill de quem olha. */
export function senseObserved(detection, level, maxGap = 10) {
  const d = Number(detection);
  if (!Number.isFinite(d) || d <= 0) return false;
  return d >= detectionNeeded(level, maxGap);
}

/** O flag que o efeito de quem olha carrega. `radius` em metros (0 = o de visão do Token de quem olha). */
export function scryFlagFrom({ markedUuid = "", radius = 0, level = 0, nature = {} } = {}) {
  return { markedUuid: String(markedUuid), radius: Math.max(0, Number(radius) || 0), level: Math.max(0, Number(level) || 0), tech: Boolean(nature.tech) };
}

/** Por que o uso não abre visão, ou null se abre. */
export function scryBlockReason({ hasMark = false, sameActor = false, enabled = true } = {}) {
  if (!enabled) return "o recurso Alcance e Marcas está desligado";
  if (sameActor) return "não se olha pela própria Marca";
  if (!hasMark) return "precisa de uma Marca sua no alvo";
  return null;
}

/** Em metros, o raio a abrir: o do efeito, ou o de quem olha (`ownSight`), ou um padrão de 30 m. */
export function scryRadiusMeters(radius, ownSight = 0) {
  const r = Number(radius) || 0;
  if (r > 0) return r;
  const own = Number(ownSight) || 0;
  return own > 0 ? own : 30;
}

/** O texto do Mestre: "Kael vê e ouve pela Marca do batedor". */
export function scryGmLine(viewerName, markedName) {
  return `${viewerName} vê e ouve pela Marca de ${markedName}`;
}

/** O aviso do Marcado que sente: sem dizer quem olha nem de onde. */
export const OBSERVED_NOTICE = "Você sente que está sendo observado.";

/** O card do Mestre quando o Marcado está em outra cena. */
export function scryElsewhereLine(viewerName, markedName, sceneName) {
  return `${viewerName} olha pela Marca de ${markedName}, que está em ${sceneName}. Nenhuma visão abre: narre o que ele vê.`;
}

/** A frase curta do efeito para a Skill numa frase. */
export function scrySentence(entry) {
  const r = Number(entry?.amount) || 0;
  return `vê pela Marca do alvo${r > 0 ? ` (raio ${String(Math.round(r * 100) / 100).replace(".", ",")} m)` : ""}`;
}

/** As visões abertas, a partir dos efeitos ligados de um Ator: `[{effectId, ...flag}]`. */
export function scryRecords(effects) {
  return (effects ?? [])
    .filter(e => e && !e.disabled && e.flags?.scry?.markedUuid)
    .map(e => ({ effectId: e.id, ...e.flags.scry }));
}
