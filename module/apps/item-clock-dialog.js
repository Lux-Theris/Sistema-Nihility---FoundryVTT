/**
 * "Acertar" o relógio analógico (J9b): o dono do Item "Marca o tempo" não tecnológico põe a data e a
 * hora que quiser (pelo sol, por alguém que disse). Daqui em diante o relógio anda com o tempo pessoal
 * dele. Sem aprovar com o Mestre e sem "tem rede". O tecnológico segue o PAD (Atualizar).
 */
import { itemClockParts, setItemClock } from "../core/world-time.js";
import { dateFieldsContext, readDateFields } from "./world-clock-app.js";
import { timeToDate } from "../core/calendar-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";

/** Abre o diálogo de Acertar para um Item. */
export async function openItemClockDialog(item) {
  const { local } = itemClockParts(item);
  const f = dateFieldsContext(local);
  const months = f.months.map(m => `<option value="${m.index}" ${m.selected ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("");
  const eras = f.hasEras ? `<label>Era <select name="era">${f.eras.map(e => `<option value="${e.index}" ${e.selected ? "selected" : ""}>${escapeHtml(e.name)}</option>`).join("")}</select></label>` : "";
  const content = `<div class="nihility-config-app wc-root">
    <p class="wc-note">Você põe o que quiser (pelo sol, por alguém que disse). Daqui em diante ele anda com o seu tempo pessoal. Sem pedir ao Mestre.</p>
    <div class="wc-row">
      <label>Dia <input type="number" name="day" min="1" step="1" value="${f.day}"/></label>
      <label>Mês <select name="month">${months}</select></label>
      <label>Ano <input type="number" name="year" step="1" value="${f.year}"/></label>
      ${eras}
      <label>Hora <input type="number" name="hour" min="0" step="1" value="${f.hour}"/></label>
      <label>Min <input type="number" name="minute" min="0" step="1" value="${f.minute}"/></label>
    </div>
  </div>`;
  const parts = await foundry.applications.api.DialogV2.wait({
    window: { title: `Acertar o ${item.name}`, icon: "fa-regular fa-clock" },
    content,
    buttons: [
      { action: "set", label: "Acertar", default: true, callback: (event, button, dialog) => ({ local: readDateFields(dialog.element) }) },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  if (!parts) return false;
  try {
    const p = timeToDate((await import("../core/world-time.js")).getCalendar(), parts.local);
    return await setItemClock(item, { year: p.year, month: p.monthIndex + 1, day: p.day, hour: p.hour, minute: p.minute });
  } catch (err) {
    reportError("Não consegui acertar o relógio.", err);
    return false;
  }
}
