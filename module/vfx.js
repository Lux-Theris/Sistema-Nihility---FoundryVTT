/**
 * Efeitos visuais leves ao usar uma Skill (`system.animationPath`), via o módulo OPCIONAL
 * "Sequencer" (https://foundryvtt.com/packages/sequencer) — o padrão de fato do Foundry pra
 * tocar vídeo/imagem/som num Token sem o sistema precisar reimplementar nada de canvas/PIXI
 * (já existe module/area-effects.js pra isso, que é o único outro arquivo que toca canvas).
 *
 * Sem o Sequencer instalado/ativo, `playSkillAnimation` não faz NADA — silenciosamente, sem
 * warning nem erro. A Skill continua funcionando 100% normalmente (custo, dano, efeitos), só
 * sem o efeito visual. Nunca deixe isso bloquear ou atrasar "Usar Habilidade".
 */
import { SYSTEM_ID } from "./config.js";

/** true = o módulo Sequencer está instalado e ativo neste mundo. */
export function sequencerAvailable() {
  return typeof Sequence !== "undefined";
}

/**
 * Toca `mech.animationPath` do Ator que usou a Skill até o alvo (se houver um Token pra cada
 * lado) — dispara e esquece, nunca aguardado por quem chama (a animação pode levar segundos
 * pra terminar e não deve atrasar o resto de "Usar Habilidade").
 * @param {Actor} sourceActor
 * @param {object} mech - `skill.system` ou o snapshot de uma Sub-Skill
 * @param {{targetActor?: Actor|null}} [options]
 */
export function playSkillAnimation(sourceActor, mech, options = {}) {
  const path = mech.animationPath?.trim();
  if (!path || !sequencerAvailable()) return;

  try {
    const sourceToken = sourceActor.getActiveTokens()[0];
    if (!sourceToken) return; // sem Token na cena ativa — nada pra animar a partir daqui.

    const seq = new Sequence().effect().file(path).atLocation(sourceToken);
    const targetToken = options.targetActor?.getActiveTokens()[0];
    if (targetToken) seq.stretchTo(targetToken);

    seq.play();
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Falha ao tocar animação da Skill (Sequencer) — ignorando.`, err);
  }
}
