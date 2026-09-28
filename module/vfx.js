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
import { SYSTEM_ID, actorToken } from "./config.js";

/** true = o módulo Sequencer está instalado e ativo neste mundo. */
export function sequencerAvailable() {
  return typeof Sequence !== "undefined";
}

/**
 * Toca `mech.animationPath` do Ator que usou a Skill até o alvo (se houver um Token pra cada
 * lado) — dispara e esquece, nunca aguardado por quem chama (a animação pode levar segundos
 * pra terminar e não deve atrasar o resto de "Usar Habilidade").
 *
 * Com `impact` (uma Estrutura segurou o golpe — ver interceptingStructure), a animação vai só até
 * o ponto de impacto na parede. Com `passesThrough` (sobrou dano depois da parede), uma segunda
 * animação sai do ponto de impacto e segue até o alvo, logo depois da primeira.
 * @param {Actor} sourceActor
 * @param {object} mech - `skill.system` ou o snapshot de uma Sub-Skill
 * @param {{targetActor?: Actor|null, impact?: {x:number,y:number}|null, passesThrough?: boolean}} [options]
 */
export function playSkillAnimation(sourceActor, mech, options = {}) {
  const path = mech.animationPath?.trim();
  if (!path || !sequencerAvailable()) return;

  try {
    const sourceToken = actorToken(sourceActor, canvas.tokens?.controlled ?? []);
    if (!sourceToken) return; // sem Token na cena ativa — nada pra animar a partir daqui.

    const targetToken = actorToken(options.targetActor, [...(game.user.targets ?? [])]);
    const seq = new Sequence().effect().file(path).atLocation(sourceToken);
    if (options.impact) {
      seq.stretchTo(options.impact);
      if (options.passesThrough && targetToken) {
        // O que sobrou atravessa a parede: continua do ponto de impacto até o alvo.
        seq.waitUntilFinished(-300).effect().file(path).atLocation(options.impact).stretchTo(targetToken);
      }
    } else if (targetToken) {
      seq.stretchTo(targetToken);
    }

    seq.play();
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Falha ao tocar animação da Skill (Sequencer) — ignorando.`, err);
  }
}
