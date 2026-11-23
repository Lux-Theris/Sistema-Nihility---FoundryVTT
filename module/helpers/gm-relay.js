/**
 * Ponte para executar no cliente do Mestre uma escrita que o cliente de quem agiu não tem
 * permissão de fazer.
 *
 * O caso que motivou isto: XP de Resistência. Quem rola o ataque quase nunca é dono da ficha do
 * alvo — um jogador atacando outro jogador, ou atacando um NPC — e `item.update()` num documento
 * alheio simplesmente falha. Antes disso existir, o XP só era creditado quando o próprio Mestre
 * rolava, o que deixava metade das situações de mesa sem progressão nenhuma.
 *
 * O `system.json` já declarava `"socket": true` desde sempre, mas nada no sistema usava — este é
 * o primeiro (e por ora único) uso.
 *
 * **Onde moram as ações:** este arquivo só tem o motor (socket, `runAsGm`, portões `owns`/`ownedDoc`/`mayActFor`/
 * `actorsOwnedBy`) e NÃO importa nenhum subsistema. Cada subsistema exporta as suas ações num objeto
 * `RELAY_HANDLERS`; `core/relay-actions.js` as junta via `registerRelayActions` (que recusa nome repetido e valor
 * que não seja função) e confere contra `RELAY_ACTION_NAMES` (`core/relay-action-names.js`).
 *
 * **Regras ao adicionar uma ação nova** (em `RELAY_HANDLERS` do subsistema) — a ação roda com permissão de Mestre:
 *  - **Quem pediu:** todo handler recebe `(payload, user)`. `user` é quem emitiu, dito pelo
 *    SERVIDOR do Foundry (`handleCustomSocket` reenvia `emit(canal, dados, socket.user.id)`;
 *    conferido na 14.368), nunca um campo do payload — esse o cliente escreveria o que quisesse.
 *    Confira que `user` é dono (`owns`) do documento de ORIGEM da ação: o Ator que ataca, o dono
 *    da Skill, quem lançou a Zona. Até a 1.63.0 nada disso existia, e pelo console (F12) um
 *    jogador apagava Zonas de qualquer um, enchia XP alheia, punha Skills no Compêndio…
 *  - **O payload não é confiável:** resolva UUIDs e valide tudo do lado do Mestre; nunca aceite
 *    um valor que o cliente possa ter inflado (o `gain` de XP é calculado no emissor por
 *    conveniência, mas é re-limitado no destino).
 *  - **Recusar com motivo:** um handler pode devolver `refuse("…")` (motivo em pt-BR, ou um dos
 *    códigos de `RELAY_REASONS`). Só chega a alguém quando o pedido foi feito com `reply: true`
 *    (ver `runAsGm`); devolver nada continua significando "feito".
 */
import { SYSTEM_ID } from "../core/config.js";
import { reportError } from "./report.js";
import { RELAY_REASONS, createReplyRegistry, normalizeRelayOutcome, validateRelayRegistration } from "./gm-relay-rules.js";

const CHANNEL = `system.${SYSTEM_ID}`;

/** Pedidos com `reply: true` deste cliente esperando o Mestre responder. */
const pendingReplies = createReplyRegistry();

/**
 * `user` pode agir em nome de `doc`? Mestre sempre pode (inclusive quando a origem não existe,
 * ex.: Condição marcada à mão, sem Skill por trás). Item embutido herda a permissão do Ator.
 */
export function owns(user, doc) {
  if (!user) return false;
  if (user.isGM) return true;
  return typeof doc?.testUserPermission === "function" && doc.testUserPermission(user, "OWNER");
}

/** Resolve um UUID vindo do payload e devolve o documento só se ele existir e `user` for dono. */
export async function ownedDoc(uuid, user) {
  if (typeof uuid !== "string" || !uuid) return null;
  const doc = await fromUuid(uuid);
  return doc && owns(user, doc) ? doc : null;
}

/** Portão para ações que só precisam da permissão (não do documento): Mestre passa direto. */
export async function mayActFor(user, uuid) {
  if (user?.isGM) return true;
  return Boolean(await ownedDoc(uuid, user));
}

/** Atores do Diretório e sintéticos (Token não vinculado) que `user` possui. */
export function actorsOwnedBy(user) {
  const list = [...game.actors];
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) list.push(token.actor);
  return list.filter(actor => owns(user, actor));
}

/**
 * Ações que o Mestre sabe executar em nome de outro cliente. Todas recebem `(payload, user)`.
 * Começa vazio: cada subsistema exporta as suas em `RELAY_HANDLERS` e `core/relay-actions.js`
 * chama `registerRelayActions` com elas, no `ready`, antes de `registerGmRelay`.
 */
const HANDLERS = {};

/**
 * Copia as ações de um subsistema para o mapa do relay. Lança erro se o valor não for função ou se
 * o nome já existir — melhor quebrar alto no boot do que um subsistema sobrescrever outro.
 * @param {Record<string, (payload: object, user: User) => unknown>} handlers
 */
export function registerRelayActions(handlers) {
  const errors = validateRelayRegistration(Object.keys(HANDLERS), handlers);
  if (errors.length) throw new Error(`Relay do Mestre: ${errors.join("; ")}.`);
  for (const [name, fn] of Object.entries(handlers)) HANDLERS[name] = fn;
}

/**
 * O Mestre "designado": exatamente um entre os Mestres conectados. Com dois Mestres online (um
 * Assistente basta), sem isso os dois executariam a mesma ação — XP em dobro, veneno em dobro.
 *
 * Segue a regra do próprio Foundry (`game.users.activeGM`: o de PAPEL mais alto, depois o menor
 * id), para o relay, os ticks de turno e os eventos de turno do core escolherem a mesma pessoa.
 * Até a 1.77 a regra era só "menor id", e com um Mestre e um Assistente online os dois lados
 * podiam discordar. O fallback cobre uma versão sem `activeGM`.
 */
export function isDesignatedGm() {
  const activeGM = game.users?.activeGM;
  if (activeGM !== undefined) return activeGM?.id === game.user?.id;
  const activeGms = game.users.filter(u => u.isGM && u.active).map(u => u.id).sort();
  return activeGms[0] === game.user.id;
}

/**
 * Liga a escuta do canal. Chamado uma vez, no hook `ready`.
 *
 * O segundo argumento é o id de quem emitiu, posto pelo servidor (não pelo cliente). Sem ele —
 * uma versão futura que mude isso — a ação é recusada: melhor perder um XP do que voltar a
 * executar pedidos anônimos com permissão de Mestre.
 */
export function registerGmRelay() {
  game.socket.on(CHANNEL, async (message = {}, senderId) => {
    // Resposta a um pedido com `reply: true`: só interessa a quem pediu, e só vale vinda de um
    // Mestre (o remetente vem do servidor). Serve apenas para o aviso na tela.
    if (message?.relayReply) {
      if (message.replyTo !== game.user?.id) return;
      if (!game.users.get(senderId)?.isGM) return;
      pendingReplies.resolve(message.requestId, { ok: message.ok, reason: message.reason, ...(message.value !== undefined ? { value: message.value } : {}) });
      return;
    }

    const { action, payload, requestId } = message ?? {};
    if (!isDesignatedGm()) return;
    const user = typeof senderId === "string" ? game.users.get(senderId) : null;
    if (!user) {
      console.warn(`${SYSTEM_ID} | Pedido "${action}" sem remetente identificado pelo servidor; ignorado.`);
      return;
    }

    const outcome = await executeHandler(action, payload, user);
    // `replyTo` sai do remetente que o SERVIDOR informou, nunca do payload.
    if (typeof requestId === "string" && requestId) {
      game.socket.emit(CHANNEL, { relayReply: true, replyTo: user.id, requestId, ok: outcome.ok, reason: outcome.reason, ...(outcome.value !== undefined ? { value: outcome.value } : {}) });
    }
  });
}

/** Roda um handler no Mestre e devolve `{ok, reason}`; um erro vira `{ok:false, reason: mensagem}`. */
async function executeHandler(action, payload, user) {
  const handler = HANDLERS[action];
  if (!handler) return { ok: false, reason: RELAY_REASONS.unknownAction };
  try {
    return normalizeRelayOutcome(await handler(payload ?? {}, user));
  } catch (err) {
    reportError(`Falha ao executar "${action}" como Mestre (pedido de ${user?.name ?? "?"}).`, err, { gmOnly: true });
    return { ok: false, reason: err?.message || "erro no Mestre" };
  }
}

/**
 * Executa a ação: direto, se quem chamou já é o Mestre designado; senão pede pelo socket.
 *
 * **Sem `reply`** (o padrão, e o de quase todo pedido de bastidor): dispara e esquece. Sem nenhum
 * Mestre conectado a ação é perdida — em silêncio de propósito, porque isto é chamado no meio da
 * resolução de dano e um aviso a cada golpe seria pior que a perda do XP. Um erro no caminho
 * direto sobe para quem chamou, como sempre foi.
 *
 * **Com `reply: true`** (o que o jogador espera VER acontecer: Estrutura, Zona, luz de Escudo,
 * Correr, Raio Trator): devolve `Promise<{ok, reason}>` — `noGm` sem Mestre online, `timeout` se
 * ninguém respondeu em `timeout` ms, ou o motivo da recusa. Nunca lança. Use
 * `relayFailureMessage` (gm-relay-rules.js) para o aviso. A resposta só serve para avisar: não é
 * prova de nada.
 *
 * @param {string} action
 * @param {object} [payload]
 * @param {{reply?: boolean, timeout?: number}} [options]
 */
export async function runAsGm(action, payload, { reply = false, timeout = 5000 } = {}) {
  if (!reply) {
    if (isDesignatedGm()) {
      const handler = HANDLERS[action];
      if (handler) await handler(payload ?? {}, game.user);
      return;
    }
    if (!game.users.some(u => u.isGM && u.active)) return;
    game.socket.emit(CHANNEL, { action, payload });
    return;
  }

  if (isDesignatedGm()) return executeHandler(action, payload, game.user);
  if (!game.users.some(u => u.isGM && u.active)) return { ok: false, reason: RELAY_REASONS.noGm };
  const requestId = foundry.utils.randomID();
  const answer = pendingReplies.wait(requestId, timeout);
  game.socket.emit(CHANNEL, { action, payload, requestId, replyTo: game.user.id });
  return answer;
}
