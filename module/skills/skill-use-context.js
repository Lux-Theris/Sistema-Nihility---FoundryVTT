/**
 * O uso de Skill em andamento NESTE cliente (Desfazer uso, skill-undo.js). Enquanto ele dura, as
 * mensagens de chat que este usuário cria levam o id do uso, e a Estrutura/Zona que o uso pede ao
 * Mestre leva o mesmo id — é por ele que o Desfazer as encontra depois.
 *
 * Sem imports de propósito: structures.js e area-effects.js leem isto, e skill-undo.js importa
 * meio sistema.
 */
let current = null;

export function beginSkillUse() {
  current = { id: foundry.utils.randomID() };
  return current;
}

export function endSkillUse(context) {
  if (current === context) current = null;
}

/** Id do uso em andamento, ou "" fora de um uso. */
export function currentSkillUseId() {
  return current?.id ?? "";
}
