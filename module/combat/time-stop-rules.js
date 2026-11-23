/**
 * Manipulação do tempo, Parar (8e.4/8e.5): as contas puras do "Parado no tempo". Sem Foundry; o lado Foundry
 * (efeito, bloqueios, saída, dano acumulado) fica em `time-stop.js`. Testado em test/time-stop.test.mjs.
 *
 * O modelo do dono (22/11):
 *  - **Parado** tem flag próprio (`timeStop`), FORA do `incapacitates`: o incapacitado desliga Ativas e falha o
 *    Preparo; o Parado congela. Não age, não se move (empurrão e teleporte forçado também não), nada nele anda.
 *  - **Duração** em rodadas de quem lançou, descontada no turno de quem lançou (como as Zonas); numa Ativa vale
 *    "enquanto ligada".
 *  - **Dano acumulado**: o golpe num Parado não escreve a Vida; o card guarda `{messageId, index, factor}` e tudo
 *    cai, um por um, na saída. A saída é idempotente.
 */

/** O flag do Active Effect do Parado e o flag do Ator com o dano guardado. */
export const STOP_FLAG = "timeStop";
export const STOP_DAMAGE_FLAG = "timeStopDamage";

/** Máximo de golpes guardados por Ator (um Parado por muito tempo não enche o banco). */
export const STOP_DAMAGE_CAP = 200;

/**
 * Rodadas do Parar contra um alvo mais forte: o prazo sobe e desce com a força (`timeStrength`: cheio até o nível
 * da Skill, zero no dobro). Arredonda para baixo; 0 = o alvo escapa.
 */
export function stopRoundsFor(rounds, strength = 1) {
  const r = Math.max(0, Math.floor(Number(rounds) || 0));
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  return Math.floor(r * s + 1e-9);
}

/** Um turno de quem lançou passou: o que sobra do prazo e se o Parar acabou. `forever` (Ativa) nunca acaba aqui. */
export function stopCountdown(remaining, { forever = false } = {}) {
  if (forever) return { remaining: 0, ended: false };
  const left = Math.max(0, Math.floor(Number(remaining) || 0)) - 1;
  return { remaining: Math.max(0, left), ended: left <= 0 };
}

/**
 * Os prazos dos efeitos de quem está Parado ficam congelados: a cada virada de rodada, o que faltava na rodada
 * que acabou de passar vira o prazo novo, contado daqui. `total` = prazo em rodadas, `start` = rodada em que
 * começou a contar, `round` = a rodada de que se quer o que falta.
 */
export function frozenRoundsLeft({ total, start, round }) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const s = Number(start);
  const r = Number(round);
  if (!Number.isFinite(s) || !Number.isFinite(r)) return t;
  return Math.max(0, t - Math.max(0, r - s));
}

/** O prazo precisa ser regravado agora? (começou antes desta rodada e ainda tem o que congelar) */
export function needsFreeze({ total, start, round }) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const s = Number(start);
  const r = Number(round);
  return t > 0 && Number.isFinite(s) && Number.isFinite(r) && s < r && frozenRoundsLeft({ total: t, start: s, round: r - 1 }) > 0;
}

/* ------------------------------------------------------------------ Dano acumulado */

const sameHit = (a, b) => a?.messageId === b?.messageId && (a?.index ?? null) === (b?.index ?? null);

/** Guarda um golpe (o mesmo card/alvo não entra duas vezes: o novo fator vale). Passa do teto → o mais antigo sai. */
export function stopDamageAdd(list = [], hit) {
  if (!hit?.messageId) return Array.isArray(list) ? list : [];
  const entry = { messageId: String(hit.messageId), index: Number.isInteger(hit.index) ? hit.index : null, factor: Number(hit.factor) || 1 };
  const next = (Array.isArray(list) ? list : []).filter(e => !sameHit(e, entry));
  next.push(entry);
  return next.slice(-STOP_DAMAGE_CAP);
}

/** Tira um golpe da lista (Desfazer do card antes de o tempo voltar). */
export function stopDamageRemove(list = [], hit) {
  return (Array.isArray(list) ? list : []).filter(e => !sameHit(e, hit));
}

/** O fator guardado do golpe (o Mestre pode trocar até lá: o último vale). */
export function stopDamageFactor(list = [], hit) {
  return (Array.isArray(list) ? list : []).find(e => sameHit(e, hit))?.factor ?? null;
}

/**
 * O que o cartão "O tempo de X voltou" mostra: uma linha por golpe e o total.
 * `rows` = `[{label, toShield, toHp, extras?: string[]}]`.
 */
export function stopReturnSummary(rows = []) {
  const list = (rows ?? []).filter(Boolean);
  const toShield = list.reduce((s, r) => s + (Number(r.toShield) || 0), 0);
  const toHp = list.reduce((s, r) => s + (Number(r.toHp) || 0), 0);
  return { count: list.length, toShield, toHp, total: toShield + toHp };
}

/** "10 no Escudo · 25 na Vida" (omite o que for zero; tudo zero vira "sem efeito"). */
export function stopHitText({ toShield = 0, toHp = 0 } = {}) {
  const parts = [];
  if (toShield) parts.push(`${toShield} no Escudo`);
  if (toHp) parts.push(`${toHp} na Vida`);
  return parts.length ? parts.join(" · ") : "sem efeito";
}

/* ------------------------------------------------------------------ Textos */

/** O título e o corpo do aviso do turno do Parado ("pule o turno"). */
export function stopNoticeText(name, { remaining = 0, forever = false, casterName = "" } = {}) {
  const title = `${name} está Parado no tempo`;
  let body = "Pule o turno dele.";
  if (forever) body += casterName ? ` Dura enquanto ${casterName} mantiver a Habilidade.` : " Dura enquanto a Habilidade estiver ligada.";
  else if (remaining > 0) body += casterName ? ` Faltam ${remaining} ${remaining === 1 ? "turno" : "turnos"} de ${casterName}.` : ` Faltam ${remaining} ${remaining === 1 ? "turno" : "turnos"}.`;
  return { title, body };
}

/** Texto do selo do Token: "⏸ 2" ou "⏸ ∞". */
export function stopBadgeText({ remaining = 0, forever = false } = {}) {
  return forever || !(remaining > 0) ? "⏸ ∞" : `⏸ ${Math.ceil(remaining)}`;
}

/** O motivo de recusa de uma ação de quem está Parado (ou "" se não está). */
export function stopActionText(name, what = "agir") {
  return `${name} está Parado no tempo e não pode ${what}.`;
}
