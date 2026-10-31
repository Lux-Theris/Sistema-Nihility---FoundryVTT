/**
 * Parte pura do pedido-com-resposta do relay do Mestre (ver gm-relay.js): normalizar o que um
 * handler devolveu, casar a resposta com o pedido pendente e escrever o aviso para quem pediu.
 * Sem Foundry — testada em test/gm-relay.test.mjs.
 *
 * A resposta é só para AVISAR na tela ("nenhum Mestre conectado", "o Mestre recusou"). Nada do
 * lado de quem pediu pode tratá-la como prova de que algo aconteceu: o documento é a verdade.
 */

/** Códigos de motivo que o relay conhece. Qualquer outro motivo é texto pronto (pt-BR). */
export const RELAY_REASONS = Object.freeze({
  noGm: "noGm",
  timeout: "timeout",
  permission: "permission",
  invalid: "invalid",
  unknownAction: "unknownAction",
  refused: "refused"
});

const REASON_TEXT = {
  permission: "você não controla quem fez isso",
  invalid: "o pedido chegou incompleto ou inválido",
  unknownAction: "esta versão do sistema no Mestre não conhece o pedido (atualizem os dois lados)",
  refused: "pedido recusado"
};

/**
 * O que um handler devolveu → `{ok, reason}`. Nada (`undefined`/`null`) ou `true` = deu certo
 * (os handlers antigos não devolvem nada); `false` = recusado sem motivo; `{ok, reason}` passa.
 * @param {unknown} result
 * @returns {{ok: boolean, reason: string}}
 */
export function normalizeRelayOutcome(result) {
  if (result === undefined || result === null || result === true) return { ok: true, reason: "" };
  if (result === false) return { ok: false, reason: RELAY_REASONS.refused };
  if (typeof result === "object" && "ok" in result) {
    const ok = Boolean(result.ok);
    return { ok, reason: ok ? "" : String(result.reason || RELAY_REASONS.refused) };
  }
  // Handler que devolve um valor qualquer (ex.: a força do Raio Trator) conta como sucesso.
  return { ok: true, reason: "" };
}

/** Recusa com motivo — açúcar para os handlers. */
export function refuse(reason) {
  return { ok: false, reason: String(reason || RELAY_REASONS.refused) };
}

/**
 * Aviso para quem pediu, ou `null` quando deu certo.
 * @param {{ok: boolean, reason?: string}} outcome
 * @param {string} what  O que se tentou, como complemento de "não deu para…" ("erguer a Estrutura").
 * @returns {string|null}
 */
export function relayFailureMessage(outcome, what) {
  if (!outcome || outcome.ok) return null;
  const reason = String(outcome.reason || RELAY_REASONS.refused);
  if (reason === RELAY_REASONS.noGm) return `Nenhum Mestre conectado: não deu para ${what}.`;
  if (reason === RELAY_REASONS.timeout) return `O Mestre não respondeu a tempo ao pedido para ${what}. Confira no mapa se aconteceu.`;
  return `Não deu para ${what}: ${REASON_TEXT[reason] ?? reason}.`;
}

/**
 * Pedidos esperando resposta, por `requestId`. `setTimer`/`clearTimer` entram como parâmetro
 * para o teste controlar o tempo.
 * @param {{setTimer?: Function, clearTimer?: Function}} [timers]
 */
export function createReplyRegistry({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map();
  return {
    /** Promessa resolvida pela resposta ou, passado `timeout` ms, por `{ok:false, reason:"timeout"}`. */
    wait(requestId, timeout) {
      return new Promise(resolve => {
        const timer = setTimer(() => {
          pending.delete(requestId);
          resolve({ ok: false, reason: RELAY_REASONS.timeout });
        }, timeout);
        pending.set(requestId, { resolve, timer });
      });
    },
    /** Entrega a resposta ao pedido; devolve `false` se ninguém esperava esse id. */
    resolve(requestId, outcome) {
      const entry = pending.get(requestId);
      if (!entry) return false;
      pending.delete(requestId);
      clearTimer(entry.timer);
      entry.resolve(normalizeRelayOutcome(outcome));
      return true;
    },
    get size() {
      return pending.size;
    }
  };
}
