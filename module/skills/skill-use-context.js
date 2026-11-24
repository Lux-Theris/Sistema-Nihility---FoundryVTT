/**
 * O uso de Skill em andamento NESTE cliente (Desfazer uso, skill-undo.js). Enquanto ele dura, as
 * mensagens de chat que este usuário cria levam o id do uso, e a Estrutura/Zona que o uso pede ao
 * Mestre leva o mesmo id — é por ele que o Desfazer as encontra depois.
 *
 * Sem imports de propósito: structures.js e area-effects.js leem isto, e skill-undo.js importa
 * meio sistema.
 */
let current = null;

/** `snapshot(actor)`: a foto "antes" que o Desfazer usa (passada por skill-undo.js, que sabe tirá-la). */
export function beginSkillUse(snapshot = null) {
  current = { id: foundry.utils.randomID(), snapshot, extras: [] };
  return current;
}

export function endSkillUse(context) {
  if (current === context) current = null;
}

/** Id do uso em andamento, ou "" fora de um uso. */
export function currentSkillUseId() {
  return current?.id ?? "";
}

/**
 * Um Ator que o uso vai mexer e que não estava na lista de quem o Desfazer fotografa (o segundo Token de um Trocar, 8f). Tira a
 * foto "antes" AGORA, então tem de ser chamado antes de mexer nele. Sem uso em andamento, não faz nada.
 */
export function noteUseActor(actor) {
  if (!current?.snapshot || !actor?.uuid || current.extras.some(e => e.actor.uuid === actor.uuid)) return;
  try {
    current.extras.push({ actor, before: current.snapshot(actor) });
  } catch (err) {
    console.warn("nihility | Desfazer uso: não consegui fotografar um Ator extra.", err);
  }
}
