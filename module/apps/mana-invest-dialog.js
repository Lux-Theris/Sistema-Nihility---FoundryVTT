/**
 * "Quanta Mana investir?" — aparece ao usar uma Skill que aceita variar a Mana. Mostra ao vivo a
 * força resultante e a eficiência (força por Mana), pra quem vai jogar tudo numa explosão saber o
 * que está trocando. A regra da força mora em `manaInvestmentPower` (config.js).
 */
import { manaInvestmentPower } from "../config.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/**
 * @param {object} options
 * @param {string} options.label - nome da Skill
 * @param {number} options.cost - Custo da Skill (já com o desconto de nível)
 * @param {number} options.available - Mana atual de quem usa
 * @param {number} options.minimum - o menos que se pode investir
 * @param {number} options.exponent - expoente da curva (Regras da Mesa)
 * @param {string} options.energyLabel
 * @returns {Promise<number|null>} a Mana investida, ou `null` se cancelou
 */
export async function promptManaInvestment({ label, cost, available, minimum, exponent, energyLabel }) {
  const { DialogV2 } = foundry.applications.api;
  const max = Math.max(minimum, Math.floor(available));
  const start = Math.min(max, Math.max(minimum, cost));
  const describe = invested => {
    const ratio = cost > 0 ? invested / cost : 1;
    const power = manaInvestmentPower(ratio, exponent);
    const efficiency = ratio > 0 ? Math.round((power / ratio) * 100) : 100;
    return `Força <strong>×${power.toFixed(2).replace(".", ",")}</strong> · eficiência ${efficiency}% por ${escapeHtml(energyLabel)}`;
  };

  // `<div>`, nunca `<form>`: o DialogV2 já embrulha o conteúdo num form.
  const content = `
    <div class="nihility-mana-invest">
      <p>Custo de <strong>${escapeHtml(label)}</strong>: ${cost} ${escapeHtml(energyLabel)}. Você tem ${Math.floor(available)}.</p>
      <div class="mana-invest-row">
        <input type="range" class="mana-invest-range" min="${minimum}" max="${max}" step="1" value="${start}"/>
        <input type="number" class="mana-invest-value" min="${minimum}" max="${max}" step="1" value="${start}" aria-label="${escapeHtml(energyLabel)} investida"/>
      </div>
      <p class="mana-invest-power">${describe(start)}</p>
      <p class="hint">Menos que o Custo enfraquece na mesma proporção. Mais que o Custo fortalece sem teto, mas cada ${escapeHtml(energyLabel)} a mais rende menos que a anterior.</p>
    </div>`;

  const result = await DialogV2.wait({
    window: { title: `Investir ${energyLabel} — ${label}` },
    classes: ["nihility-mana-invest-dialog"],
    position: { width: 420 },
    content,
    buttons: [
      {
        action: "use",
        label: "Usar",
        default: true,
        callback: (event, button, dialog) => {
          const value = Math.round(Number(dialog.element.querySelector(".mana-invest-value").value) || 0);
          return Math.min(max, Math.max(minimum, value));
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      const range = root?.querySelector?.(".mana-invest-range");
      const number = root?.querySelector?.(".mana-invest-value");
      const text = root?.querySelector?.(".mana-invest-power");
      if (!range || !number || !text) return;
      const clamp = value => Math.min(max, Math.max(minimum, Math.round(Number(value) || 0)));
      range.addEventListener("input", () => {
        number.value = range.value;
        text.innerHTML = describe(clamp(range.value));
      });
      // Enquanto digita, só atualiza a prévia (travar no mínimo aqui impediria digitar "1000",
      // que começa por "1"); o número é corrigido ao sair do campo.
      number.addEventListener("input", () => {
        const v = clamp(number.value);
        range.value = v;
        text.innerHTML = describe(v);
      });
      number.addEventListener("change", () => {
        number.value = clamp(number.value);
      });
    }
  });

  return typeof result === "number" ? result : null;
}
