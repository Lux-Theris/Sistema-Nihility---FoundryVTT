/**
 * Vida 0: Caído e Inconsciente (backlog B1) — a parte pura e testada. Quem lê e grava fichas é
 * `combat/incapacitation.js`.
 *
 * Fluxo decidido com o dono:
 *  - PJ chega a 0 → Caído, com contador de morte (N rodadas, contadas no turno dele). Ao zerar, o
 *    sistema AVISA o Mestre; nunca mata sozinho. "Estabilizar" para o contador.
 *  - NPC chega a 0 → morre direto (Derrotado), se a opção estiver ligada.
 *  - Qualquer coisa tira a Vida do 0 (regeneração, cura) → Caído vira Inconsciente por mais N
 *    rodadas sem agir; depois ele volta.
 *  - Caído e Inconsciente (e qualquer Condição marcada "incapacita") fazem a mesma coisa: não age
 *    nem se move, Skills Ativas desligam. O que é do corpo (regeneração, cura periódica, cura de
 *    terceiros) continua — como a Regeneração no D&D (troll) e no Pathfinder.
 */

/** Ids das Condições do catálogo que incapacitam. */
export function incapacitatingIds(conditions) {
  return new Set((conditions ?? []).filter(c => c?.incapacitates && c.id).map(c => c.id));
}

/** Algum efeito ativo (não desligado) carrega uma Condição que incapacita (ou o "morto" do core)? */
export function isIncapacitatedBy(effects, ids, defeatedId = null) {
  for (const effect of effects ?? []) {
    if (effect?.disabled) continue;
    for (const status of effect?.statuses ?? []) if (ids.has(status) || (defeatedId && status === defeatedId)) return true;
  }
  return false;
}

/** O que acontece quando a Vida chega a 0: "fall" (Caído) ou "die" (NPC direto para Derrotado). */
export function zeroHpOutcome({ isPlayerCharacter = true, npcDies = true } = {}) {
  return !isPlayerCharacter && npcDies ? "die" : "fall";
}

/**
 * Início do turno de quem está Caído ou Inconsciente.
 *  - Caído: o contador de morte desce 1 (parado se estabilizado); chegando a 0, evento "death"
 *    (aviso ao Mestre — uma vez só, depois fica em 0).
 *  - Inconsciente com contador: enquanto houver rodadas, perde o turno e desce 1; com 0, evento
 *    "wake" (acorda e age neste turno). Sem contador (marcado à mão), fica até o Mestre tirar.
 * Inconsciente de 3 rodadas perde exatamente 3 turnos e age no 4º.
 * @param {{kind:"fallen"|"unconscious", rounds?:number|null, stabilized?:boolean, warned?:boolean}} state
 * @returns {{state: object, event: "none"|"death"|"wake"}}
 */
export function incapacitationTurn(state) {
  const s = { ...state };
  const rounds = Number.isFinite(Number(s.rounds)) && s.rounds !== null ? Math.max(0, Math.floor(Number(s.rounds))) : null;
  if (s.kind === "fallen") {
    if (s.stabilized || rounds === null || s.warned) return { state: s, event: "none" };
    const next = Math.max(0, rounds - 1);
    s.rounds = next;
    if (next === 0) {
      s.warned = true;
      return { state: s, event: "death" };
    }
    return { state: s, event: "none" };
  }
  if (s.kind === "unconscious") {
    if (rounds === null) return { state: s, event: "none" };
    if (rounds <= 0) return { state: s, event: "wake" };
    s.rounds = rounds - 1;
    return { state: s, event: "none" };
  }
  return { state: s, event: "none" };
}
