/**
 * Manipulação do tempo, Reverter (8e.7/8e.8): as contas puras. Sem Foundry; o lado Foundry (anel de fotos, registro
 * de efeitos, restauração, vínculos, card) fica em `time-rewind.js`. Testado em test/time-rewind.test.mjs.
 *
 * O modelo do dono (22/11):
 *  - **Em combate**: uma foto do combatente no começo de cada turno dele, em memória (até `cap` rodadas, Regras
 *    desta mesa, padrão 10). Reverter N rodadas devolve a foto do turno dele N rodadas atrás (valores absolutos).
 *  - **Fora de combate**: só os efeitos de status (um registro pequeno por Ator: criados e apagados, com o tempo
 *    pessoal de quando) e o tempo pessoal (que recua de verdade: sono, PAD e idade voltam junto).
 *  - **Alvo mais forte**: as rodadas encolhem pela força (`timeStrength`, a mesma do Acelerar/Parar).
 *  - **Vínculos** (Nomeação/Corredor, Pacto): reverter um reverte os dois, pagando o custo por cada um; sem
 *    energia para os dois, nada acontece. **Forma** que mudou desde a foto recusa.
 */

/** O flag do Ator com o registro de efeitos (fora de combate) e o teto de eventos. */
export const EFFECT_LOG_FLAG = "timeEffectLog";
export const EFFECT_LOG_CAP = 40;

/** Padrão e limites do teto de rodadas que se pode reverter (Regras desta mesa). */
export const REWIND_CAP_DEFAULT = 10;
export const REWIND_CAP_MAX = 100;

/** Segundos de uma rodada fora de combate quando o relógio não define a rodada. */
export const REWIND_ROUND_SECONDS_FALLBACK = 6;

/** O teto de rodadas (inteiro, 1 a 100; lixo vira o padrão). */
export function clampRewindCap(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return REWIND_CAP_DEFAULT;
  return Math.min(REWIND_CAP_MAX, n);
}

/**
 * Quantas rodadas a Skill reverte de fato: o pedido (até o teto) encolhido pela força contra alvo mais forte
 * (`timeStrength`: 1 = cheio, 0 = o alvo escapa). Arredonda para baixo; 0 = nada.
 */
export function rewindRoundsFor(asked, strength = 1, cap = REWIND_CAP_DEFAULT) {
  const want = Math.max(0, Math.floor(Number(asked) || 0));
  if (!want) return 0;
  const limit = clampRewindCap(cap);
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  return Math.floor(Math.min(want, limit) * s + 1e-9);
}

/** Segundos de tempo pessoal de `rounds` rodadas (`roundSeconds` 0 = o relógio não passa tempo em combate). */
export function rewindSeconds(rounds, roundSeconds, { fallback = false } = {}) {
  const r = Math.max(0, Math.floor(Number(rounds) || 0));
  const per = Number(roundSeconds) > 0 ? Number(roundSeconds) : fallback ? REWIND_ROUND_SECONDS_FALLBACK : 0;
  return r * per;
}

/** A mecânica tem o modo Reverter (na Skill ou numa Sub-Skill)? */
export function mechHasRewind(mech) {
  const has = list => (list ?? []).some(e => e?.target === "timeRate" && e.timeRewind);
  return has(mech?.effects) || (mech?.subSkills ?? []).some(s => has(s?.effects));
}

/* ------------------------------------------------------------------ Anel de fotos (em combate) */

/** A chave de uma foto no anel: rodada e turno em que o turno do dono começou. */
const photoKey = p => `${Number(p?.round) || 0}:${Number(p?.turn) || 0}`;

/**
 * Põe uma foto no anel (o anel é a lista em ordem de chegada). A mesma rodada e turno substitui (o turno
 * revisitado); passando de `max`, as mais antigas saem. Devolve uma lista nova.
 */
export function pushPhoto(ring, photo, max = REWIND_CAP_DEFAULT + 1) {
  const keep = Math.max(2, Math.floor(Number(max) || REWIND_CAP_DEFAULT + 1));
  const next = (ring ?? []).filter(p => photoKey(p) !== photoKey(photo));
  next.push(photo);
  return next.length > keep ? next.slice(next.length - keep) : next;
}

/**
 * A foto de `rounds` rodadas atrás: a do turno do dono na rodada `agora − rounds` (ou a mais recente antes dela).
 * Se o anel não alcança tanto, vale a mais antiga e `rounds` reais diz quantas voltaram. `null` = sem o que devolver
 * (anel vazio, ou a única foto é desta rodada).
 * @returns {{photo:object, rounds:number, short:boolean}|null}
 */
export function pickPhoto(ring, rounds, currentRound) {
  const list = (ring ?? []).filter(p => Number.isFinite(Number(p?.round)));
  const want = Math.floor(Number(rounds) || 0);
  const now = Number(currentRound);
  if (!list.length || want < 1 || !Number.isFinite(now)) return null;
  const goal = now - want;
  let chosen = null;
  for (const p of list) if (Number(p.round) <= goal && (!chosen || Number(p.round) >= Number(chosen.round))) chosen = p;
  let short = false;
  if (!chosen) {
    chosen = list.reduce((oldest, p) => (Number(p.round) < Number(oldest.round) ? p : oldest), list[0]);
    short = true;
  }
  const real = now - Number(chosen.round);
  if (real < 1) return null;
  return { photo: chosen, rounds: Math.min(real, want), short };
}

/* ------------------------------------------------------------------ Forma */

/**
 * A "assinatura" da forma de um Ator: a cópia (`formOf`) e o original (`formActive`) ligados. Mudou entre a foto e
 * agora = a Forma ligou, desligou ou trocou: recusa o Reverter.
 */
export function formSignature(flags) {
  const of = flags?.formOf;
  const active = flags?.formActive;
  const copy = of && typeof of === "object" ? `${of.originalUuid ?? ""}|${of.skillId ?? ""}|${of.subSkillIndex ?? ""}` : "";
  const orig = active ? (typeof active === "object" ? JSON.stringify([active.copyUuid ?? "", active.skillId ?? ""]) : String(active)) : "";
  return `${copy}#${orig}`;
}

export function formChanged(photoFlags, nowFlags) {
  return formSignature(photoFlags) !== formSignature(nowFlags);
}

/* ------------------------------------------------------------------ Vínculos */

/**
 * Os Atores ligados a este por Nomeação/Corredor de alma e Pacto (uuids, sem repetir e sem ele mesmo). Lê os
 * flags do sistema: `soulLink {namerUuid}`, `soulLinks [{namedUuid}]`, `borrowLinks [{sourceUuid}]`,
 * `lendLinks [{borrowerUuid}]`. Um nível só (o parceiro do parceiro não entra).
 */
export function bondPartnerUuids(flags, selfUuid = "") {
  const out = new Set();
  const add = uuid => {
    if (typeof uuid === "string" && uuid && uuid !== selfUuid) out.add(uuid);
  };
  add(flags?.soulLink?.namerUuid);
  for (const l of Array.isArray(flags?.soulLinks) ? flags.soulLinks : []) add(l?.namedUuid);
  for (const l of Array.isArray(flags?.borrowLinks) ? flags.borrowLinks : []) add(l?.sourceUuid);
  for (const l of Array.isArray(flags?.lendLinks) ? flags.lendLinks : []) add(l?.borrowerUuid);
  return [...out];
}

/**
 * O custo extra de reverter com vínculos: o custo da Skill vezes quantos parceiros (cada um além do alvo paga o
 * custo uma vez). Quem lança tem de ter para todos.
 * @returns {{extra:number, ok:boolean, missing:number}}
 */
export function bondCost({ unitCost, partners, available, charges = true }) {
  const unit = charges ? Math.max(0, Math.floor(Number(unitCost) || 0)) : 0;
  const extra = unit * Math.max(0, Math.floor(Number(partners) || 0));
  const have = Math.max(0, Number(available) || 0);
  return { extra, ok: extra <= have, missing: Math.max(0, extra - have) };
}

/* ------------------------------------------------------------------ Registro de efeitos (fora de combate) */

/** O efeito entra no registro? Só efeitos de status e de Skill (ligados). */
export function effectLogWorthy(effectFlags, { statuses = [], disabled = false } = {}) {
  if (disabled) return false;
  return Boolean(effectFlags?.skillEffect) || (Array.isArray(statuses) ? statuses.length > 0 : statuses?.size > 0);
}

/** Acrescenta um evento (`op` "c" criado, "d" apagado) ao registro, cortando os mais antigos. */
export function logEffectEvent(log, event, cap = EFFECT_LOG_CAP) {
  const next = [...(Array.isArray(log) ? log : []), event].filter(e => e && (e.op === "c" || e.op === "d") && e.id);
  const keep = Math.max(1, Math.floor(Number(cap) || EFFECT_LOG_CAP));
  return next.length > keep ? next.slice(next.length - keep) : next;
}

/**
 * O que fazer para os efeitos voltarem ao que eram em `since` (tempo pessoal, segundos): o que nasceu depois sai
 * e o que foi apagado depois volta (com os dados que tinha). Nasceu e foi apagado depois de `since`: nada.
 * @returns {{remove:string[], recreate:object[]}}
 */
export function effectLogPlan(log, since) {
  const t = Number(since);
  const recent = (Array.isArray(log) ? log : []).filter(e => Number(e.at) > t);
  const remove = new Set();
  const recreate = new Map();
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.op === "d") {
      if (e.data) recreate.set(e.id, e.data);
    } else if (recreate.has(e.id)) recreate.delete(e.id);
    else remove.add(e.id);
  }
  return { remove: [...remove], recreate: [...recreate.values()] };
}

/** O registro depois de reverter até `since`: só o que aconteceu até lá. */
export function effectLogAfterRewind(log, since) {
  const t = Number(since);
  return (Array.isArray(log) ? log : []).filter(e => Number(e.at) <= t);
}

/* ------------------------------------------------------------------ Textos */

/** "3 rodadas" / "1 rodada". */
export function roundsText(n) {
  const r = Math.max(0, Math.floor(Number(n) || 0));
  return `${r} ${r === 1 ? "rodada" : "rodadas"}`;
}

/**
 * A linha do que volta, para o card: `[{label, before, after}]` → "Vida 12 → 30". Ignora o que não mudou.
 */
export function changeRows(rows) {
  return (rows ?? [])
    .filter(r => r && String(r.before) !== String(r.after))
    .map(r => ({ label: String(r.label), text: `${r.before} → ${r.after}` }));
}
