/**
 * Números flutuantes sobre o Token quando Vida, Escudo ou Mana mudam (Nave: Escudo, Casco e
 * Integridade). A regra do que mostrar é pura, em `vital-deltas.js`; aqui só se lê e se desenha.
 *
 * Por que comparar com o último valor visto, e não usar `preUpdateActor`: o valor anterior só
 * existe no cliente que fez a escrita, e o caminho de Token não vinculado (ActorDelta) não é o
 * mesmo de um Ator do Diretório. Cada cliente guarda o último valor de cada Ator que tem Token
 * desenhado e, a cada `updateActor`, compara — igual para Aplicar, tick de Veneno, regeneração,
 * Descanso, Desfazer ou edição à mão, sem tocar em nenhum desses caminhos.
 *
 * As Condições (entrar/sair) o próprio Foundry já mostra (`ActiveEffect#_displayScrollingStatus`).
 * Tudo isto obedece também ao "texto de status flutuante" do core (world), porque passa por
 * `canvas.interface.createScrollingText`; a opção `floatingNumbers` (client) desliga só os nossos.
 */
import { SYSTEM_ID, MEU_SISTEMA, getEnergyLabelForActor } from "../core/config.js";
import { VITAL_TRACKS, vitalSnapshot, vitalDeltas } from "./vital-deltas.js";

/** uuid do Ator → última leitura. */
const lastSeen = new Map();

function tracksFor(actor) {
  return actor?.type === "starship" || actor?.type === "vehicle" ? VITAL_TRACKS.ship : VITAL_TRACKS.character;
}

function remember(actor) {
  if (!actor?.uuid || !actor.system) return;
  lastSeen.set(actor.uuid, vitalSnapshot(actor.system, tracksFor(actor)));
}

function enabledForMe() {
  try {
    return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.floatingNumbers) !== false;
  } catch {
    return true;
  }
}

function show(token, entries) {
  entries.forEach((entry, i) => {
    // Escudo e Vida do mesmo golpe saem um depois do outro, não empilhados no mesmo ponto.
    setTimeout(() => {
      if (!token.visible || token.destroyed) return;
      canvas.interface.createScrollingText(token.center, entry.text, {
        anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
        direction: CONST.TEXT_ANCHOR_POINTS.TOP,
        distance: 2 * token.h,
        fontSize: entry.key === "hp" || entry.key === "hull" ? 36 : 30,
        fill: entry.fill,
        stroke: 0x000000,
        strokeThickness: 5,
        jitter: 0.25
      });
    }, i * 350);
  });
}

function onUpdateActor(actor, _changed, options) {
  const before = lastSeen.get(actor.uuid);
  if (!before) return; // sem Token desenhado neste cliente: nada a mostrar
  const tracks = tracksFor(actor);
  const after = vitalSnapshot(actor.system, tracks);
  lastSeen.set(actor.uuid, after);
  if (options?.animate === false || !enabledForMe() || !canvas?.ready) return;

  const deltas = vitalDeltas(before, after, tracks, { labels: { energy: getEnergyLabelForActor(actor) } })
    // Mana: só o dono do personagem e o Mestre (o Mestre é dono de tudo).
    .filter(d => !d.ownerOnly || actor.isOwner);
  if (!deltas.length) return;

  for (const token of actor.getActiveTokens(true)) {
    // Mesmo critério do core para as Condições: Token que este usuário não vê não ganha número.
    if (!token.visible || token.document.isSecret) continue;
    show(token, deltas);
  }
}

/** Liga os hooks. Chamado uma vez, no `init`. */
export function registerFloatingNumbers() {
  Hooks.on("drawToken", token => remember(token.actor));
  Hooks.on("updateActor", onUpdateActor);
}
