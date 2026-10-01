/**
 * Diálogo de shift+clique: Vantagem/Normal/Desvantagem e modificadores livres antes de rolar.
 * A regra em si (o que cada operação faz, em que ordem) mora em roll-modifiers.js.
 */
import { ROLL_OPERATIONS, ROLL_OPERATION_SYMBOLS, normalizeRollOptions } from "../core/roll-modifiers.js";

const { DialogV2 } = foundry.applications.api;

const OPERATION_LABELS = { add: "Somar", sub: "Subtrair", mul: "Multiplicar", div: "Dividir" };

function modifierRowHtml() {
  const options = ROLL_OPERATIONS.map(op => `<option value="${op}">${ROLL_OPERATION_SYMBOLS[op]} ${OPERATION_LABELS[op]}</option>`).join("");
  return `
    <div class="roll-mod-row">
      <select class="roll-mod-op">${options}</select>
      <input type="number" class="roll-mod-value" step="any" placeholder="Valor"/>
      <input type="text" class="roll-mod-label" placeholder="Motivo (opcional)"/>
      <a class="roll-mod-remove" title="Remover"><i class="fas fa-times"></i></a>
    </div>`;
}

/**
 * Atalho dos botões de rolagem das fichas: sem Shift, rola normal (`options: null`); com Shift,
 * abre o diálogo antes de qualquer outra coisa (inclusive antes de escolher o alvo).
 * @returns {Promise<{cancelled: boolean, options: object|null}>}
 */
export async function rollOptionsFromEvent(event, title) {
  if (!event?.shiftKey) return { cancelled: false, options: null };
  const options = await promptRollOptions({ title });
  return options ? { cancelled: false, options } : { cancelled: true, options: null };
}

/**
 * Abre o diálogo e devolve as opções escolhidas, ou `null` se a pessoa cancelou (e aí a
 * rolagem não acontece).
 * @param {object} [options]
 * @param {string} [options.title] - ex.: "Rolar Destreza", "Dano — Bola de Fogo"
 * @param {boolean} [options.allowAdvantage=true]
 * @returns {Promise<{advantage:string, modifiers:object[]}|null>}
 */
export async function promptRollOptions({ title = "Modificar rolagem", allowAdvantage = true } = {}) {
  const advantageHtml = allowAdvantage
    ? `<div class="form-group roll-advantage">
         <label><input type="radio" name="advantage" value="disadvantage"/> Desvantagem</label>
         <label><input type="radio" name="advantage" value="normal" checked/> Normal</label>
         <label><input type="radio" name="advantage" value="advantage"/> Vantagem</label>
       </div>
       <p class="hint-inline">Vantagem rola o pool inteiro duas vezes e fica com o maior; Desvantagem, com o menor.</p>`
    : "";

  const result = await DialogV2.wait({
    window: { title },
    classes: ["nihility-roll-dialog"],
    content: `
      <div class="nihility-roll-options">
        ${advantageHtml}
        <div class="roll-mod-list"></div>
        <a class="roll-mod-add"><i class="fas fa-plus"></i> Modificador</a>
        <p class="hint-inline">Aplicados na ordem da lista: "+5" e depois "×2" dá (rolagem + 5) × 2.</p>
      </div>`,
    buttons: [
      {
        action: "roll",
        label: "Rolar",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element;
          const modifiers = Array.from(root.querySelectorAll(".roll-mod-row")).map(row => ({
            op: row.querySelector(".roll-mod-op").value,
            value: row.querySelector(".roll-mod-value").value,
            label: row.querySelector(".roll-mod-label").value
          }));
          const advantage = root.querySelector('[name="advantage"]:checked')?.value ?? "normal";
          return normalizeRollOptions({ advantage, modifiers });
        }
      },
      // `false`, não `null`: o DialogV2 troca um retorno nulo pelo nome da ação ("cancel").
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      const list = root?.querySelector?.(".roll-mod-list");
      if (!list) return;
      const addRow = () => {
        list.insertAdjacentHTML("beforeend", modifierRowHtml());
        list.lastElementChild.querySelector(".roll-mod-value").focus();
      };
      root.querySelector(".roll-mod-add").addEventListener("click", addRow);
      list.addEventListener("click", ev => {
        if (ev.target.closest(".roll-mod-remove")) ev.target.closest(".roll-mod-row").remove();
      });
      // Abre já com uma linha: quem deu shift+clique quase sempre quer um modificador.
      addRow();
    }
  });

  return result && typeof result === "object" ? result : null;
}
