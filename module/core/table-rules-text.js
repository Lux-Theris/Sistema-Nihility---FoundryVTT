/**
 * "Regras desta mesa" (backlog L6; canvas "Ferramentas da Mesa", prancha 3) — a parte pura: dado o
 * que está ligado e os números deste mundo, monta as páginas do Diário em HTML simples, em
 * linguagem de jogador. Testado em test/table-tools.test.mjs. Quem lê as configurações e grava o
 * Diário é core/table-rules-journal.js.
 */
import { escapeHtml as esc } from "../helpers/html.js";

const num = v => `<span class="tr-num">${esc(v)}</span>`;

/** "Força × Defesa × 10" */
function vitalText(pair, multiplier) {
  return `<b>${esc(pair[0])} × ${esc(pair[1])} × ${esc(multiplier)}</b>`;
}

/** Uma frase para o efeito padrão de uma Condição do catálogo. */
export function conditionSentence(condition, { attributeLabel = k => k, energyLabel = "Mana" } = {}) {
  const e = condition?.effect;
  if (condition?.incapacitates) return "não age nem se move";
  if (condition?.curse?.enabled) return `uma maldição: cobra ${energyLabel} todo turno`;
  if (condition?.antimagicLevel) return `magia custa ${energyLabel} extra`;
  if (condition?.suppressesMagic) return "a magia dele para de funcionar";
  const healBlock = condition?.healBlock ?? (condition?.blocksRegeneration ? { kinds: "regen" } : null);
  if (healBlock && !e?.kind) return healBlock.kinds === "all" ? "não pode ser curado" : "não regenera";
  if (!e?.kind) return "o Mestre decide o que ela impede";
  if (e.kind === "tick") {
    const target = e.tickTarget === "energy" ? energyLabel : "Vida";
    const verb = e.tickSign === "heal" ? "ganha" : "perde";
    return `${verb} ${target} no início do turno`;
  }
  if (e.kind === "modifier") {
    const value = Number(e.value) || 0;
    const sign = value > 0 ? "+" : "−";
    if (e.modTarget === "movement") return `Deslocamento ${sign}${Math.abs(value)}%`;
    return `${attributeLabel(e.modTarget)} ${sign}${Math.abs(value)}${e.modMode === "percent" ? "%" : ""}`;
  }
  return "o Mestre decide o que ela impede";
}

/**
 * As páginas geradas (a "Notas da mesa" fica de fora: é do Mestre).
 * @param {object} d - os dados do mundo (ver gatherTableRules em table-rules-journal.js)
 * @returns {Array<{key: string, name: string, html: string}>}
 */
export function buildTableRulesPages(d) {
  const pages = [];
  const energy = esc(d.energyLabel || "Mana");

  // 1. Como se joga: rolar, Vida/Mana, subir de nível.
  {
    const parts = [];
    parts.push(`<p class="tr-stamp">Gerado em ${esc(d.date)} a partir das configurações deste mundo · sistema ${esc(d.systemVersion)}.</p>`);
    parts.push("<h2>Rolar um atributo</h2>");
    parts.push(`<p>Cada <b>3 pontos</b> de um atributo dão <b>+1</b>. A cada <b>+10</b> você ganha mais um d20 e soma todos. Ex.: 12 pontos → ${num("1d20+4")}; 30 pontos → ${num("2d20+10")}. Bônus de item equipado soma por fora, na hora da rolagem.</p>`);
    parts.push(`<p>Atributos desta mesa: ${(d.attributes ?? []).map(esc).join(" · ")}.</p>`);
    parts.push(`<h2>Vida, ${energy} e subir de nível</h2>`);
    parts.push(`<p>Vida máxima = ${vitalText(d.vital.hp, d.vital.multiplier)} (no mínimo ${esc(d.vital.floor)}).${d.vital.energyEnabled ? ` ${energy} máxima = ${vitalText(d.vital.energy, d.vital.multiplier)}.` : ` Esta campanha não usa ${energy}.`}</p>`);
    parts.push(`<p>XP para o próximo nível: ${num(d.xpFormula)}. ${d.attributePool ? `Você começa com <b>${esc(d.pointsStart)}</b> pontos de atributo e ganha <b>${esc(d.pointsPerLevel)}</b> por nível.` : ""} Quem sobe o nível é o Mestre.</p>`);
    pages.push({ key: "basics", name: "Como se joga", html: parts.join("\n") });
  }

  // 2. Habilidades.
  {
    const s = d.skills;
    const parts = ["<h2>Usar uma Habilidade</h2>"];
    parts.push(`<p>Usar gasta o Custo em ${energy}. Uma Habilidade <b>Ativa</b> liga e desliga: paga o Custo ao ligar e um Custo por rodada enquanto estiver ligada. Se a ${energy} chega a 0, as Ativas desligam.</p>`);
    parts.push("<h2>Nível da Habilidade</h2>");
    parts.push(`<p>Os níveis seguem um ciclo: <b>${esc(s.cyclePower)}</b> nível(is) de Poder (cada um deixa o efeito <b>${esc(s.powerPerLevel)}%</b> mais forte) e depois <b>${esc(s.cycleDiscount)}</b> de Desconto (cada um corta <b>${esc(s.discountPerLevel)}%</b> do Custo, até ${esc(s.costFloor)}% do original). Quem sobe o nível é o Mestre.</p>`);
    if (d.features.skillPoints) parts.push("<p>Pontos de Habilidade compram Habilidades novas e níveis: o pedido vai para o Mestre aprovar.</p>");
    if (d.features.skillUseXp) parts.push("<p>Usar uma Habilidade dá XP a ela, pelo tamanho do que ela fez.</p>");
    if (d.features.skillFusion) parts.push("<p>O Mestre pode fundir Habilidades numa só, mais forte.</p>");
    pages.push({ key: "skills", name: "Habilidades", html: parts.join("\n") });
  }

  // 3. Combate.
  {
    const parts = ["<h2>Iniciativa e turno</h2>"];
    parts.push(`<p>Iniciativa: rola <b>${esc(d.initiative)}</b>.</p>`);
    if (d.movement) parts.push(`<p>Deslocamento por rodada: <b>${esc(d.movement.base)} m</b> + 1 m a cada ${esc(d.movement.step)} de Destreza (até ${esc(d.movement.cap)} m). <b>Correr</b> dobra o deslocamento do turno.</p>`);
    if (d.incapacitation) {
      parts.push("<h2>Vida 0</h2>");
      parts.push(`<p>Em 0 de Vida você <b>cai</b>: não age nem se move, e tem <b>${esc(d.incapacitation.deathRounds)} rodadas</b> até a morte (alguém pode te estabilizar). Uma cura te levanta, mas você fica <b>Inconsciente</b> por mais ${esc(d.incapacitation.wakeRounds)} rodada(s).${d.incapacitation.npcDies ? " NPCs morrem direto em 0." : ""}</p>`);
    }
    if (d.features.resistances) parts.push("<p>Resistências reduzem o dano de um tipo; chegando a 100% viram Imunidade.</p>");
    if (d.features.areaEffects) parts.push("<p>Habilidades em área acertam todos dentro do círculo, cone ou linha.</p>");
    pages.push({ key: "combat", name: "Combate", html: parts.join("\n") });
  }

  // 4. Condições e 5. Tipos de dano (catálogos deste mundo).
  if (d.features.statusConditions && d.conditions?.length) {
    pages.push({
      key: "conditions",
      name: "Condições",
      html: `<ul>${d.conditions.map(c => `<li><b>${esc(c.label)}</b> — ${esc(c.sentence)}</li>`).join("")}</ul>`
    });
  }
  if (d.elements?.length) {
    pages.push({
      key: "elements",
      name: "Tipos de dano",
      html: `<p>${d.elements.map(e => (e.parent ? `${esc(e.label)} <i>(${esc(e.parent)})</i>` : `<b>${esc(e.label)}</b>`)).join(" · ")}</p>`
    });
  }

  // 6. Desligado nesta campanha.
  pages.push({
    key: "off",
    name: "Desligado aqui",
    html: d.disabled?.length
      ? `<p>Estas partes do sistema não valem nesta mesa: ${d.disabled.map(esc).join(" · ")}.</p>`
      : "<p>Nada: o sistema inteiro está ligado.</p>"
  });
  return pages;
}
