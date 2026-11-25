/**
 * A barra de dica da colocação de uma área ou Estrutura (1.118.0), no pé da tela, igual ao quadro 5 do mockup
 * aprovado: "Ctrl+roda: tamanho 4 / 6 m · Roda: gira (Cone/Linha) · Clique: confirma · Esc: cancela". O texto vem
 * pronto de `placementHintText` (area-size-rules.js, puro); aqui só se desenha e se tira. Só presentação:
 * nenhuma falha aqui pode impedir a colocação.
 */
import { placementHintText } from "./area-size-rules.js";

/**
 * Mostra a barra. Devolve `{update(info), remove()}`; `update` recebe os mesmos campos de `placementHintText`.
 * O tamanho vira negrito; `extras` (forma presa, Marca…) vão ao fim.
 */
export function showPlacementHint(info = {}) {
  let element = null;
  const render = current => {
    if (!element) return;
    const text = placementHintText(current);
    // `textContent` só: nada do documento entra como HTML. O tamanho em negrito é montado à parte.
    element.textContent = "";
    const match = /^(Ctrl\+roda: tamanho )(\S+ m)( .*)$/.exec(text);
    if (match) {
      const strong = document.createElement("b");
      strong.textContent = match[2];
      element.append(document.createTextNode(match[1]), strong, document.createTextNode(match[3]));
    } else {
      element.textContent = text;
    }
  };
  try {
    element = document.createElement("div");
    element.className = "nihility-placement-hint";
    document.body.appendChild(element);
    render(info);
  } catch (err) {
    element = null;
  }
  return {
    update(next) {
      try {
        render({ ...info, ...next });
      } catch (err) {
        /* só presentação */
      }
    },
    remove() {
      try {
        element?.remove();
      } catch (err) {
        /* só presentação */
      }
      element = null;
    }
  };
}
