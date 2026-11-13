/**
 * "Quanta Mana investir?" — aparece ao usar uma Skill que aceita variar a Mana. Mostra ao vivo a
 * força resultante e a eficiência (força por Mana), pra quem vai jogar tudo numa explosão saber o
 * que está trocando. A regra da força mora em `manaInvestmentPower` (config.js).
 */
import { manaInvestmentPower } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";

/**
 * @param {object} options
 * @param {string} options.label - nome da Skill
 * @param {number} options.cost - Custo da Skill (já com o desconto de nível)
 * @param {number} options.available - Mana atual de quem usa
 * @param {number} [options.ceiling] - o mais que se pode investir (2× a Mana máxima); padrão = a Mana atual
 * @param {number} options.minimum - o menos que se pode investir
 * @param {number} options.exponent - expoente da curva (Regras da Mesa)
 * @param {string} options.energyLabel
 * @returns {Promise<number|null>} a Mana investida, ou `null` se cancelou
 */
export async function promptManaInvestment({ label, cost, available, ceiling = null, minimum, exponent, energyLabel }) {
  const { DialogV2 } = foundry.applications.api;
  const max = Math.max(minimum, Math.floor(ceiling ?? available));
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
        <input type="number" class="mana-invest-value" min="${minimum}" max="${max}" step="1" value="${start}" aria-label="${escapeHtml(`Quantidade de ${energyLabel} investida`)}"/>
      </div>
      <p class="mana-invest-power">${describe(start)}</p>
      <p class="hint">Passar da ${escapeHtml(energyLabel)} que você tem (até o dobro da máxima) custa caro: pede confirmação, rola um d100 e deixa você Inconsciente.</p>
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

/**
 * "Vai além do que se tem de Mana": confirma antes de gastar mais do que se tem. Devolve true se confirmou.
 * @param {{label:string, invested:number, current:number, percent:number, energyLabel:string}} info
 */
export async function confirmOverdraw({ label, invested, current, percent, energyLabel }) {
  const { DialogV2 } = foundry.applications.api;
  const energy = escapeHtml(energyLabel);
  const answer = await DialogV2.confirm({
    window: { title: `Além do limite de ${energyLabel} — ${label}` },
    content: `<div class="nihility-mana-invest">
      <p>Você vai investir <strong>${invested}</strong> ${energy} em <strong>${escapeHtml(label)}</strong> e só tem <strong>${Math.floor(current)}</strong> (<strong>+${percent}%</strong> além).</p>
      <p>Vai além do que você tem de ${energy}: rola d100 e você cai <strong>Inconsciente</strong>, com ${energy} em 0. O efeito sai com a força de tudo o que foi investido.</p>
    </div>`,
    yes: { label: "Ir além", default: false },
    no: { label: "Cancelar", default: true },
    rejectClose: false
  });
  return answer === true;
}
