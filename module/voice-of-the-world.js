/**
 * "Voz do Mundo" — canal de anúncio privado do sistema (level-up, fusão, nova skill,
 * transferência de moeda...): sempre em whisper pros Mestres + dono(s) do Ator, nunca público.
 * Extraído de ai-helper.js (Fase 4 do refactor) — usado por skill-economy.js, currency.js e
 * diretamente pelo hook `preUpdateActor` de level-up.
 */
import { SYSTEM_ID } from "./config.js";

/**
 * Publica um anúncio "Voz do Mundo" no chat, sempre em whisper para os
 * Mestres e para o(s) jogador(es) dono(s) do Ator. NUNCA é público.
 * @param {Actor|null} actor
 * @param {{kind?:string, title?:string, body?:string}} data
 */
export async function announceVoiceOfTheWorld(actor, data = {}) {
  const { kind = "info", title = "", body = "" } = data;

  const templateData = {
    kind,
    title,
    body,
    actorName: actor?.name ?? "",
    timestamp: new Date().toLocaleString()
  };

  const content = await renderTemplate(
    `systems/${SYSTEM_ID}/templates/chat/voice-of-the-world.hbs`,
    templateData
  );

  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = actor
    ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id)
    : [];
  const whisper = Array.from(new Set([...gmIds, ...ownerIds]));

  return ChatMessage.create({
    content,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: actor ?? undefined }),
    flags: { [SYSTEM_ID]: { voiceOfTheWorld: true, kind } }
  });
}

/** Atalho para notificar ganho de nível. */
export async function announceLevelUp(actor, newLevel) {
  return announceVoiceOfTheWorld(actor, {
    kind: "level-up",
    title: "Evolução",
    body: `${actor.name} alcançou o nível ${newLevel}.`
  });
}
