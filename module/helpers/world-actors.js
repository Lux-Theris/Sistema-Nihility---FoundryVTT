/**
 * Todos os Atores do mundo que podem carregar um efeito: os do Diretório E os sintéticos dos
 * Tokens não vinculados de todas as cenas (que não estão em `game.actors` — varrer só o Diretório
 * deixava o efeito para sempre num Drone não vinculado). Cada Ator aparece uma vez (por uuid).
 *
 * É caro num mundo grande: ler `token.actor` cria o ator sintético de cada Token não vinculado.
 * Use só quando não há uma lista melhor (ver `anchoredTargets` em effect-anchors.js).
 */
export function worldActors() {
  const seen = new Set();
  const list = [];
  const push = actor => {
    if (!actor || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    list.push(actor);
  };
  for (const actor of game.actors) push(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (!token.actorLink) push(token.actor);
  }
  return list;
}

/**
 * Resolve uuids de Ator (inclusive o sintético "Scene.x.Token.y.Actor.z"), ignorando o que não
 * existe mais e o que não é Ator. Sem duplicar.
 * @param {string[]} uuids
 * @returns {Actor[]}
 */
export function actorsFromUuids(uuids) {
  const seen = new Set();
  const list = [];
  for (const uuid of Array.isArray(uuids) ? uuids : []) {
    if (typeof uuid !== "string" || !uuid) continue;
    let doc = null;
    try {
      doc = fromUuidSync(uuid);
    } catch (err) {
      doc = null;
    }
    if (doc?.documentName === "Token") doc = doc.actor;
    if (doc?.documentName !== "Actor" || seen.has(doc.uuid)) continue;
    seen.add(doc.uuid);
    list.push(doc);
  }
  return list;
}
