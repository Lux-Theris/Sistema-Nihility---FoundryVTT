import { SYSTEM_ID } from "../core/config.js";

/**
 * Falha que alguém na mesa precisa ver. Registra no console (com o erro completo, para depurar) e
 * mostra um aviso na tela: numa mesa narrada por voz ninguém abre o console, e uma Skill que falhou
 * em silêncio parece só "não fez nada".
 *
 * - Ação de quem clicou (usar Skill, atacar, recarregar…): `reportError(msg, err)` — o aviso
 *   aparece para quem clicou.
 * - Bastidor que roda no Mestre (ticks de início de turno, relay): `{ gmOnly: true }` — só o
 *   Mestre vê (o cliente que roda isso já é o dele; o filtro protege quem chamar de outro lugar).
 * - Algo que não merece aviso (falha de animação, refresh visual): `{ notify: false }`, ou
 *   continue usando `console.error` direto.
 *
 * @param {string} message  Frase em pt-BR para a tela ("Falha ao usar a Habilidade.").
 * @param {unknown} [err]   O erro capturado.
 * @param {{notify?: boolean, gmOnly?: boolean}} [options]
 */
export function reportError(message, err, { notify = true, gmOnly = false } = {}) {
  console.error(`${SYSTEM_ID} | ${message}`, err ?? "");
  if (!notify) return;
  if (gmOnly && !globalThis.game?.user?.isGM) return;
  const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
  globalThis.ui?.notifications?.error(`${message}${detail}`);
}
