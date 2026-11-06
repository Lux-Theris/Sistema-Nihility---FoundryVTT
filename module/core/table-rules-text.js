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
 * O glossário da página "Glossário" (1.85.0): os termos do sistema em linguagem de jogador, por
 * assunto. Um termo de um bloco desligado neste mundo não aparece (`feature`). `{E}` vira o nome da
 * energia da mesa.
 */
export const GLOSSARY = [
  ["Ficha e rolagem", [
    ["Atributo", "Uma capacidade geral do personagem (Força, Defesa, Magia, Destreza…). Os pontos dele viram dados na rolagem."],
    ["Total e Bônus", "Total é pontos + Títulos + o que a origem dá. Bônus é o Total ÷ 3 e decide os dados que você rola."],
    ["Pool de dados", "Os dados de uma rolagem, como 1d20+4 ou 2d20+3. A cada +10 de Bônus entra mais um d20, e todos somam."],
    ["Bônus de item", "Soma fixa de arma, armadura ou implante, por fora, na hora da rolagem. Não muda Vida nem {E}."],
    ["Vantagem e Desvantagem", "Shift + clique no botão de rolar: rola o pool duas vezes e fica com o maior (ou o menor). A mesa decide quando vale."],
    ["Pontos de Atributo", "Pontos que você distribui entre os atributos e confirma. Ganha mais a cada nível.", "attributePool"],
    ["Pontos de Habilidade", "Pontos Extra, Normal e Único que compram Habilidades novas e níveis delas, sempre com aprovação do Mestre.", "skillPoints"],
    ["Título", "Um feito ou cargo que dá bônus permanente, sempre ativo.", "titles"],
    ["XP", "Experiência do personagem e de cada Habilidade. Quando a barra enche, o Mestre sobe o nível."],
    ["Voz do Mundo", "Aviso privado do sistema para você e o Mestre (subiu de nível, Habilidade aprovada…). Aparece no chat e num cartão dourado na tela."]
  ]],
  ["Habilidades", [
    ["Habilidade (Skill)", "Algo que o personagem sabe fazer além de um atributo: um golpe, uma magia, uma técnica. Tem Custo, alvo e efeito."],
    ["Tier", "A categoria da Habilidade: Extra (técnica humana), Normal (sobrenatural), Racial (da Espécie), Único (da pessoa) e Ultimate (controle sobre a realidade). Não é o nível."],
    ["Nível da Habilidade", "Cada nível deixa o efeito mais forte (Poder) ou mais barato (Desconto), num ciclo fixo."],
    ["Custo", "O que usar a Habilidade gasta de {E}."],
    ["Habilidade Ativa", "Liga e desliga: paga o Custo ao ligar e um Custo por rodada enquanto estiver ligada. Se a {E} chega a 0, todas desligam."],
    ["Variar a {E}", "Algumas Habilidades deixam você investir mais ou menos {E}: menos enfraquece, mais fortalece, cada vez rendendo menos."],
    ["Sub-Skill", "Uma Habilidade dentro de outra, de uma fusão. Ao usar, você escolhe qual delas.", "skillFusion"],
    ["Skill Racial", "Habilidade que vem da sua Espécie. Não se compra."],
    ["Habilidade concedida", "Dada por um item, implante ou módulo enquanto ele está equipado. Some quando ele sai."],
    ["Pedido de Skill", "A Habilidade que você monta e manda ao Mestre. Só vira Habilidade, e só gasta o ponto, quando ele aprova.", "skillPoints"]
  ]],
  ["Combate e dano", [
    ["Iniciativa", "Rolagem que decide a ordem dos turnos."],
    ["Deslocamento", "Quantos metros o Token anda por rodada em combate. Correr dobra o do turno.", "movement"],
    ["Emissão e Zona", "Habilidades de área. Emissão acerta na hora quem está dentro; Zona fica no mapa e age em quem começa o turno dentro dela.", "areaEffects"],
    ["Elemento", "O tipo do dano (Fogo, Gelo, Físico…). Um golpe de dois elementos se divide em partes iguais."],
    ["Dano Mágico e Defesa Mágica", "Dano Mágico é reduzido pela Defesa Mágica de quem recebe."],
    ["Resistência e Imunidade", "Reduz em % o dano de um elemento (ou de tudo, se for Geral). Um elemento em 100% vira Imunidade.", "resistances"],
    ["Penetração", "A parte de um golpe que passa direto por Escudo e armadura."],
    ["Dano Absoluto", "Dano que nada resiste: só dá para evitar (desviar, se esconder atrás de uma Estrutura)."],
    ["Escudo", "Pontos que apanham antes da Vida. Cada Habilidade de Escudo é uma camada; a mais nova apanha primeiro."],
    ["Vantagem entre elementos", "Alguns elementos são mais fortes contra outros (como água contra fogo). Multiplica o dano."],
    ["Escala", "Tamanho de quem luta (pessoa, veículo, nave). Atacar um degrau acima tira muito menos; um abaixo, muito mais.", "scale"],
    ["Estrutura", "Parede ou barreira erguida por uma Habilidade. Bloqueia passagem e apanha os golpes que a atravessam.", "structures"],
    ["Antimagia", "Desfaz efeitos mágicos e faz a magia custar mais (ou não sair) perto de um campo ou selo."],
    ["Condição", "Um estado com ícone no Token (Veneno, Cegueira, Medo…). A página Condições diz o que cada uma faz.", "statusConditions"],
    ["Tick", "Cada vez que um efeito contínuo (veneno, cura) age, normalmente no começo do seu turno."],
    ["Caído e Inconsciente", "Em Vida 0 você cai: não age e um contador de morte corre. Curado, fica Inconsciente algumas rodadas.", "incapacitation"],
    ["Aplicar", "O dano aparece no chat e só sai da Vida quando o Mestre clica Aplicar (ele pode desfazer)."]
  ]],
  ["Corpo e origem", [
    ["Espécie e Linhagem", "O que você é (Humano, Elfo, Androide…) e o tipo dentro dela. Dão corpo, Traços e Skills Raciais."],
    ["Herança", "Algo que aconteceu com você (Vampirizado, Ciborgue…). Só o Mestre dá."],
    ["Traço", "Uma marca da criatura (Orgânico, Mecânico, Voador…) que algumas regras leem."],
    ["Parte do corpo", "Cabeça, braços, cauda… cada uma com Vida própria.", "anatomy"],
    ["Prótese e Implante", "Peça instalada numa parte do corpo. A prótese substitui a parte; o implante soma a ela.", "anatomy"],
    ["Cura, Regeneração e Reparo", "Cura fecha feridas; Regeneração também refaz partes perdidas; Reparo conserta próteses.", "bodyPartInjury"],
    ["Densidade de mana", "O quanto a magia funciona naquele lugar: 1 é normal, 0 é nada.", "environment"],
    ["Irradiação", "Radiação que você acumulou. Causa dano por rodada e baixa longe da fonte.", "radiation"]
  ]],
  ["Naves", [
    ["Porte", "Tamanho de uma nave ou veículo, e de cada módulo (Compacto → Colossal).", "vessels"],
    ["Módulo", "Uma peça da nave (Reator, Escudo, Motor, Arma…), com Vida própria.", "vessels"],
    ["Escudo, Casco e Integridade", "As três camadas da nave: o dano passa pelo Escudo, depois o Casco, e o resto chega à Integridade Estrutural.", "vessels"],
    ["Grid de energia", "Reator gera, Distribuidor leva e Bateria guarda. Faltando energia, os módulos de prioridade mais baixa param primeiro.", "vessels"],
    ["Evasão", "A parte do dano que a nave desvia, pela manobrabilidade.", "shipManeuver"],
    ["Tripulação", "Os personagens a bordo. Qualquer tripulante opera a nave.", "vessels"]
  ]]
];

/** O glossário filtrado pelos blocos ligados, com o nome da energia. */
export function glossaryGroups({ features = {}, energyLabel = "Mana" } = {}) {
  const fill = text => text.replace(/\{E\}/g, energyLabel);
  return GLOSSARY.map(([group, terms]) => ({
    group,
    terms: terms.filter(([, , feature]) => !feature || features[feature] !== false).map(([term, text]) => ({ term: fill(term), text: fill(text) }))
  })).filter(g => g.terms.length);
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
