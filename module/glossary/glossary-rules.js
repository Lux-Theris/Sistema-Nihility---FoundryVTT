/**
 * Glossário do mundo (1.85.0; design aprovado: artefato "Glossário do Mundo", pranchas 1–4) — a
 * parte pura: monta os verbetes, acha os links e busca. Sem Foundry; testado em
 * test/glossary.test.mjs. Quem lê o mundo e grava é glossary.js; a janela é apps/glossary.js.
 *
 * Cada verbete tem uma CHAVE fixa (`energy`, `attr:magic`, `condition:burn`, `custom:eter`…) e
 * mostra o NOME atual do mundo. Renomear a energia, um atributo ou uma Condição muda o título, a
 * lista e os links na próxima vez que a janela abre, sem gravar nada.
 */

/**
 * Termos do sistema: [chave, assunto, termo, explicação, bloco (opcional), veja também].
 * `{E}` = nome da energia da mesa; `{attr:chave}` = nome atual do atributo.
 */
export const SYSTEM_TERMS = [
  ["energy", "Ficha e rolagem", "{E}", "A energia que as Habilidades gastam. O máximo sai de {attr:magic} × {attr:magicalDefense} × um multiplicador (o Mestre pode mudar a fórmula). Quando chega a 0, todas as Habilidades Ativas desligam.", "", ["cost", "variableEnergy"]],
  ["attribute", "Ficha e rolagem", "Atributo", "Uma capacidade geral do personagem ({attr:strength}, {attr:dexterity}, {attr:magic}…). Os pontos dele viram dados no Pool de dados.", "", ["pool", "bonus"]],
  ["bonus", "Ficha e rolagem", "Total e Bônus", "O Total de um Atributo é pontos + Títulos + o que a origem dá. O Bônus é o Total ÷ 3 e decide os dados que você rola.", "", ["pool"]],
  ["pool", "Ficha e rolagem", "Pool de dados", "Os dados de uma rolagem, como 1d20+4 ou 2d20+3. A cada +10 de Bônus entra mais um d20, e todos somam.", "", ["advantage"]],
  ["itemBonus", "Ficha e rolagem", "Bônus de item", "Soma fixa de arma, armadura ou implante, por fora, na hora da rolagem. Não muda Vida nem {E}.", "", []],
  ["advantage", "Ficha e rolagem", "Vantagem", "Shift + clique no botão de rolar: rola o Pool de dados duas vezes e fica com o maior (Desvantagem: o menor). A mesa decide quando vale.", "", []],
  ["life", "Ficha e rolagem", "Vida", "Quanto dano o personagem aguenta. O máximo sai de {attr:strength} × {attr:defense} × um multiplicador (o Mestre pode mudar a fórmula). Em 0 você cai.", "", ["fallen", "shield"]],
  ["attributePoints", "Ficha e rolagem", "Pontos de Atributo", "Pontos que você distribui entre os Atributos e confirma. Ganha mais a cada nível.", "attributePool", ["attribute"]],
  ["skillPoints", "Ficha e rolagem", "Pontos de Habilidade", "Pontos Extra, Normal e Único que compram Habilidades novas e níveis delas, sempre com aprovação do Mestre.", "skillPoints", ["skillRequest"]],
  ["title", "Ficha e rolagem", "Título", "Um feito ou cargo que dá bônus permanente, sempre ativo.", "titles", []],
  ["xp", "Ficha e rolagem", "XP", "Experiência do personagem e de cada Habilidade. Quando a barra enche, o Mestre sobe o nível.", "", []],
  ["voice", "Ficha e rolagem", "Voz do Mundo", "Aviso privado do sistema para você e o Mestre (subiu de nível, Habilidade aprovada…). Aparece no chat e num cartão dourado na tela.", "", []],
  ["skill", "Habilidades", "Habilidade", "Algo que o personagem sabe fazer além de um Atributo: um golpe, uma magia, uma técnica. Usar gasta o Custo em {E}.", "", ["tier", "skillLevel", "active"]],
  ["tier", "Habilidades", "Tier", "A categoria da Habilidade: Extra (técnica humana), Normal (sobrenatural), Racial (da Espécie), Único (da pessoa) e Ultimate (controle sobre a realidade). Não é o nível.", "", ["skillLevel"]],
  ["skillLevel", "Habilidades", "Nível da Habilidade", "Cada nível deixa a Habilidade mais forte (Poder) ou baixa o Custo (Desconto), num ciclo fixo. Quem sobe o nível é o Mestre.", "", ["cost"]],
  ["cost", "Habilidades", "Custo", "O que usar a Habilidade gasta de {E}. Fica menor com o Nível da Habilidade.", "", ["active"]],
  ["active", "Habilidades", "Habilidade Ativa", "Liga e desliga: paga o Custo ao ligar e um custo por rodada enquanto estiver ligada. Os efeitos dela duram até desligar.", "", ["cost"]],
  ["variableEnergy", "Habilidades", "Investimento variável", "Algumas Habilidades deixam você escolher quanto {E} investir ao usar: menos enfraquece, mais fortalece, cada vez rendendo menos.", "", ["cost"]],
  ["subSkill", "Habilidades", "Sub-Skill", "Uma Habilidade dentro de outra, vinda de uma fusão. Ao usar, você escolhe qual delas.", "skillFusion", []],
  ["racialSkill", "Habilidades", "Skill Racial", "Habilidade que vem da Espécie. Não se compra.", "", ["species"]],
  ["grantedSkill", "Habilidades", "Habilidade concedida", "Dada por um item, implante ou módulo enquanto ele está equipado. Some quando ele sai.", "", []],
  ["skillRequest", "Habilidades", "Pedido de Skill", "A Habilidade que você monta e manda ao Mestre. Só vira Habilidade, e só gasta o ponto, quando ele aprova.", "skillPoints", ["skillPoints"]],
  ["initiative", "Combate e dano", "Iniciativa", "Rolagem que decide a ordem dos turnos.", "", []],
  ["movement", "Combate e dano", "Deslocamento", "Quantos metros o Token anda por rodada em combate. Correr dobra o do turno.", "movement", []],
  ["area", "Combate e dano", "Emissão e Zona", "Habilidades de área. A Emissão acerta na hora quem está dentro; a Zona fica no mapa e age em quem começa o turno dentro dela.", "areaEffects", []],
  ["element", "Combate e dano", "Elemento", "O tipo do dano (Fogo, Gelo, Físico…). Um golpe de dois elementos se divide em partes iguais.", "", ["resistance", "affinity"]],
  ["magicDamage", "Combate e dano", "Dano Mágico", "Dano que a {attr:magicalDefense} de quem recebe reduz.", "", []],
  ["resistance", "Combate e dano", "Resistência", "Reduz em % o dano de um Elemento (ou de tudo, se for Geral). Um Elemento em 100% vira Imunidade.", "resistances", ["element"]],
  ["penetration", "Combate e dano", "Penetração", "A parte de um golpe que passa direto pelo Escudo e pela armadura.", "", ["shield"]],
  ["absolute", "Combate e dano", "Dano Absoluto", "Dano que nada resiste: só dá para evitar (desviar, ficar atrás de uma Estrutura).", "", []],
  ["shield", "Combate e dano", "Escudo", "Pontos que apanham antes da Vida. Cada Habilidade de Escudo é uma camada; a mais nova apanha primeiro. A Penetração passa uma parte direto.", "", ["penetration"]],
  ["affinity", "Combate e dano", "Vantagem entre elementos", "Alguns Elementos são mais fortes contra outros (como água contra fogo). Multiplica o dano.", "", ["element"]],
  ["scale", "Combate e dano", "Escala", "Tamanho de quem luta (pessoa, veículo, nave). Atacar um degrau acima tira muito menos; um abaixo, muito mais.", "scale", []],
  ["structure", "Combate e dano", "Estrutura", "Parede ou barreira erguida por uma Habilidade. Bloqueia passagem e apanha os golpes que a atravessam.", "structures", []],
  ["antimagic", "Combate e dano", "Antimagia", "Desfaz efeitos mágicos e faz a magia custar mais (ou não sair) perto de um campo ou selo.", "", []],
  ["condition", "Combate e dano", "Condição", "Um estado com ícone no Token (Veneno, Cegueira, Medo…). Cada uma tem o próprio verbete.", "statusConditions", ["tick"]],
  ["tick", "Combate e dano", "Tick", "Cada vez que um efeito contínuo (veneno, cura) age, normalmente no começo do seu turno.", "", []],
  ["fallen", "Combate e dano", "Caído e Inconsciente", "Em 0 de Vida você cai: não age e um contador de morte corre. Curado, fica Inconsciente algumas rodadas.", "incapacitation", ["life"]],
  ["apply", "Combate e dano", "Aplicar", "O dano aparece no chat e só sai da Vida quando o Mestre clica Aplicar (ele pode desfazer).", "", []],
  ["species", "Corpo e origem", "Espécie", "O que você é (Humano, Elfo, Androide…). Dá corpo, Traços e Skills Raciais; a Linhagem é o tipo dentro dela.", "", ["heritage", "trait"]],
  ["heritage", "Corpo e origem", "Herança", "Algo que aconteceu com você (Vampirizado, Ciborgue…). Só o Mestre dá.", "", ["species"]],
  ["trait", "Corpo e origem", "Traço", "Uma marca da criatura (Orgânico, Mecânico, Voador…) que algumas regras leem.", "", []],
  ["bodyPart", "Corpo e origem", "Parte do corpo", "Cabeça, braços, cauda… cada uma com Vida própria.", "anatomy", ["implant"]],
  ["implant", "Corpo e origem", "Prótese e Implante", "Peça instalada numa Parte do corpo. A prótese substitui a parte; o implante soma a ela.", "anatomy", []],
  ["healKinds", "Corpo e origem", "Cura, Regeneração e Reparo", "Cura fecha feridas; Regeneração também refaz partes perdidas; Reparo conserta próteses.", "bodyPartInjury", []],
  ["manaDensity", "Corpo e origem", "Densidade de mana", "O quanto a magia funciona naquele lugar: 1 é normal, 0 é nada.", "environment", []],
  ["radiation", "Corpo e origem", "Irradiação", "Radiação que você acumulou. Causa dano por rodada e baixa longe da fonte.", "radiation", []],
  ["vesselSize", "Naves", "Porte", "Tamanho de uma nave ou veículo, e de cada Módulo (Compacto → Colossal).", "vessels", []],
  ["module", "Naves", "Módulo", "Uma peça da nave (Reator, Escudo, Motor, Arma…), com Vida própria.", "vessels", ["powerGrid"]],
  ["shipLayers", "Naves", "Escudo, Casco e Integridade", "As três camadas da nave: o dano passa pelo Escudo, depois o Casco, e o resto chega à Integridade Estrutural.", "vessels", []],
  ["powerGrid", "Naves", "Grid de energia", "Reator gera, Distribuidor leva e Bateria guarda. Faltando energia, os Módulos de prioridade mais baixa param primeiro.", "vessels", []],
  ["evasion", "Naves", "Evasão", "A parte do dano que a nave desvia, pela manobrabilidade.", "shipManeuver", []],
  ["crew", "Naves", "Tripulação", "Os personagens a bordo. Qualquer tripulante opera a nave.", "vessels", []]
];

/** Assuntos na ordem da lista; os dos catálogos e "da mesa" vêm depois. */
export const SYSTEM_GROUPS = ["Ficha e rolagem", "Habilidades", "Combate e dano", "Corpo e origem", "Naves"];
export const CATALOG_GROUPS = ["Atributos", "Condições", "Elementos", "Espécies", "Heranças", "Traços"];

/** Minúsculas e sem acento: a busca e os links não ligam para isso. */
export function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function fill(text, ctx) {
  return String(text ?? "")
    .replace(/\{E\}/g, ctx.energyLabel)
    .replace(/\{attr:([a-zA-Z]+)\}/g, (m, key) => ctx.attributeLabel(key));
}

/**
 * Todos os verbetes que este usuário pode ver.
 * @param {object} w - o mundo (ver gatherGlossaryWorld em glossary.js)
 * @param {{isGM?: boolean}} [opts] - `isGM` false também serve para "Ver como jogador"
 * @returns {Array<object>} `{key, term, group, kind, auto, text, see, gmOnly, rewritten, missing, custom, editable}`
 */
export function buildGlossary(w = {}, { isGM = false } = {}) {
  const features = w.features ?? {};
  const overrides = w.overrides ?? {};
  const labels = Object.fromEntries((w.attributes ?? []).map(a => [a.key, a.label]));
  const ctx = { energyLabel: w.energyLabel || "Mana", attributeLabel: key => labels[key] ?? key };
  const out = [];
  const push = entry => {
    const o = overrides[entry.key] ?? {};
    const gmOnly = Boolean(o.gmOnly || entry.gmOnly);
    if (gmOnly && !isGM) return;
    if (entry.playerHidden && !isGM) return;
    const rewritten = entry.kind === "system" && typeof o.text === "string" && o.text.trim() !== "";
    out.push({
      see: [],
      auto: "",
      text: "",
      missing: false,
      custom: false,
      ...entry,
      text: rewritten ? o.text : entry.text ?? "",
      defaultText: entry.kind === "system" ? entry.text : undefined,
      rewritten,
      gmOnly
    });
  };

  for (const [key, group, term, text, feature, see] of SYSTEM_TERMS) {
    if (feature && features[feature] === false) continue;
    push({ key, group, kind: "system", term: fill(term, ctx), text: fill(text, ctx), see, editable: true });
  }
  for (const a of w.attributes ?? []) {
    push({ key: `attr:${a.key}`, group: "Atributos", kind: "attribute", term: a.label, auto: a.purpose ? `Atributo. Serve para: ${a.purpose}.` : "Atributo.", see: ["attribute"] });
  }
  if (features.statusConditions !== false) {
    for (const c of w.conditions ?? []) {
      push({ key: `condition:${c.id}`, group: "Condições", kind: "condition", term: c.label, auto: c.sentence, text: c.explanation ?? "", missing: c.custom && !c.explanation, editable: true, see: ["condition"] });
    }
  }
  for (const e of w.elements ?? []) {
    push({ key: `element:${e.id}`, group: "Elementos", kind: "element", term: e.label, auto: e.sentence, text: e.explanation ?? "", missing: e.custom && !e.explanation, editable: true, see: ["element"] });
  }
  for (const s of w.species ?? []) {
    push({ key: `species:${s.id}`, group: "Espécies", kind: "species", term: s.label, auto: s.sentence, text: s.description ?? "", missing: s.custom && !s.description, playerHidden: !s.playerVisible, see: ["species"] });
  }
  for (const h of w.heritages ?? []) {
    push({ key: `heritage:${h.id}`, group: "Heranças", kind: "heritage", term: h.label, auto: h.sentence, text: h.description ?? "", missing: h.custom && !h.description, playerHidden: !h.playerVisible, see: ["heritage"] });
  }
  for (const t of w.traits ?? []) {
    push({ key: `trait:${t.id}`, group: "Traços", kind: "trait", term: t.label, auto: t.sentence, text: t.explanation ?? "", missing: t.custom && !t.explanation, editable: true, see: ["trait"] });
  }
  for (const c of w.custom ?? []) {
    if (!String(c.term ?? "").trim()) continue;
    push({ key: `custom:${c.id}`, group: c.group?.trim() || "Termos da mesa", kind: "custom", term: c.term, text: c.text ?? "", gmOnly: Boolean(c.gmOnly), custom: true, editable: true });
  }
  return out;
}

/** Assuntos na ordem: sistema, catálogos, depois os da mesa (alfabéticos). */
export function groupOrder(entries) {
  const known = [...SYSTEM_GROUPS, ...CATALOG_GROUPS];
  const extra = [...new Set(entries.map(e => e.group).filter(g => !known.includes(g)))].sort((a, b) => a.localeCompare(b));
  return [...known, ...extra].filter(g => entries.some(e => e.group === g));
}

const LETTER = /[\p{L}\p{N}]/u;

/**
 * O texto de um verbete em pedaços, com cada OUTRO termo citado virando link. Só a primeira
 * menção de cada termo; o plural conta ("Habilidades" linka "Habilidade"); o nome mais longo
 * ganha ("Habilidade Ativa" antes de "Habilidade"); nunca no meio de uma palavra. Quando dois
 * verbetes têm o mesmo nome, ganha o do Mestre (termo da mesa).
 * @returns {Array<{text: string, key?: string}>}
 */
export function linkSegments(text, entries, selfKey = "") {
  const byName = new Map();
  for (const e of entries) {
    if (e.key === selfKey) continue;
    const name = fold(e.term).trim();
    if (name.length < 3) continue;
    const current = byName.get(name);
    if (!current || (e.kind === "custom" && current.kind !== "custom")) byName.set(name, e);
  }
  const names = [...byName.entries()].sort((a, b) => b[0].length - a[0].length);
  let parts = [{ text: String(text ?? "") }];
  const used = new Set();
  for (const [name, entry] of names) {
    if (used.has(entry.key)) continue;
    const next = [];
    let done = false;
    for (const part of parts) {
      if (done || part.key) {
        next.push(part);
        continue;
      }
      // Cada palavra do nome aceita o plural ("Habilidades Ativas" acha "Habilidade Ativa").
      const folded = fold(part.text);
      const pattern = new RegExp(name.split(/\s+/).map(w => `${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?`).join("\\s+"), "g");
      let hit = -1;
      let len = 0;
      let m;
      // Nome com maiúscula só casa com maiúscula: "uma magia" (a palavra comum) não é o atributo Magia.
      const capital = /\p{Lu}/u.test(entry.term.trim()[0] ?? "");
      while ((m = pattern.exec(folded))) {
        const before = m.index > 0 ? folded[m.index - 1] : "";
        const after = folded[m.index + m[0].length] ?? "";
        const caseOk = !capital || /\p{Lu}/u.test(part.text[m.index] ?? "");
        if (caseOk && !LETTER.test(before) && !LETTER.test(after)) {
          hit = m.index;
          len = m[0].length;
          break;
        }
        pattern.lastIndex = m.index + 1;
      }
      if (hit < 0) {
        next.push(part);
        continue;
      }
      if (hit > 0) next.push({ text: part.text.slice(0, hit) });
      next.push({ text: part.text.slice(hit, hit + len), key: entry.key });
      if (hit + len < part.text.length) next.push({ text: part.text.slice(hit + len) });
      used.add(entry.key);
      done = true;
    }
    parts = next;
  }
  return parts;
}

/** Formas de uma palavra buscada: a própria, sem plural e sem a última vogal ("cego" acha "Cegueira"). */
function queryForms(token) {
  const forms = new Set([token]);
  if (token.length >= 4) {
    if (token.endsWith("es")) forms.add(token.slice(0, -2));
    if (token.endsWith("s")) forms.add(token.slice(0, -1));
    const base = [...forms].pop();
    if (/[aeiou]$/.test(base) && base.length >= 4) forms.add(base.slice(0, -1));
  }
  return [...forms];
}

/**
 * Busca: sem acento, maiúscula nem plural. Primeiro os verbetes cujo nome bate, depois os que só
 * citam a palavra na explicação, cada um com o trecho em volta.
 * @returns {Array<{entry: object, inTerm: boolean, snippet: string, matchStart: number, matchLength: number}>}
 */
export function searchGlossary(entries, query) {
  const tokens = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const results = [];
  for (const entry of entries) {
    const term = fold(entry.term);
    const body = [entry.text, entry.auto].filter(Boolean).join(" ");
    const foldedBody = fold(body);
    let inTerm = true;
    let firstBody = -1;
    let firstLen = 0;
    let all = true;
    for (const token of tokens) {
      const forms = queryForms(token);
      const t = forms.some(f => term.includes(f));
      const bodyHit = forms.map(f => ({ at: foldedBody.indexOf(f), len: f.length })).filter(h => h.at >= 0).sort((a, b) => a.at - b.at)[0];
      if (!t) inTerm = false;
      if (!t && !bodyHit) {
        all = false;
        break;
      }
      if (bodyHit && firstBody < 0) {
        firstBody = bodyHit.at;
        firstLen = bodyHit.len;
      }
    }
    if (!all) continue;
    let snippet = "";
    let matchStart = -1;
    if (firstBody >= 0) {
      const start = Math.max(0, firstBody - 30);
      const end = Math.min(body.length, firstBody + firstLen + 50);
      snippet = `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
      matchStart = firstBody - start + (start > 0 ? 1 : 0);
    } else {
      snippet = body.slice(0, 80) + (body.length > 80 ? "…" : "");
    }
    results.push({ entry, inTerm, snippet, matchStart, matchLength: firstLen });
  }
  return results.sort((a, b) => Number(b.inTerm) - Number(a.inTerm) || a.entry.term.localeCompare(b.entry.term));
}

/* ------------------------------------------------------------------ frases dos catálogos */

const LAYER_WORDS = { shield: "no Escudo", casco: "no Casco", hull: "na Integridade" };

/**
 * "O sistema faz" de um Elemento: grupo, de quem é subtipo e o que acontece ao acertar.
 * @param {object} element - entrada do catálogo de Tipos de Dano
 * @param {{elementLabel?: Function, conditionLabel?: Function, traitLabel?: Function}} labels
 */
export function elementSentence(element, { elementLabel = id => id, conditionLabel = id => id, traitLabel = id => id } = {}) {
  const parts = [`Tipo de dano${element?.group ? ` do grupo ${element.group}` : ""}.`];
  if (element?.parent) parts.push(`É um tipo de ${elementLabel(element.parent)}: a Resistência a ${elementLabel(element.parent)} também vale contra ele.`);
  const fx = [];
  for (const e of element?.effects ?? []) {
    const chance = Number(e.chance) > 0 && Number(e.chance) < 100 ? ` (${Number(e.chance)}%)` : "";
    if (e.type === "condition" && e.conditionId) fx.push(`pode deixar ${conditionLabel(e.conditionId)}${chance}`);
    else if (e.type === "traitBonus" && e.trait) fx.push(`tira ${Number(e.percent) || 0}% a mais de quem é ${traitLabel(e.trait)}`);
    else if (e.type === "layer" && e.layer) fx.push(`${Number(e.percent) >= 0 ? "tira mais" : "tira menos"} ${LAYER_WORDS[e.layer] ?? ""}`.trim());
    else if (e.type === "shieldDrain") fx.push("tira mais do Escudo");
    else if (e.type === "penetration") fx.push("atravessa parte das defesas");
    else if (e.type === "sever") fx.push(`pode decepar uma parte do corpo${chance}`);
    else if (e.type === "blockRegen") fx.push(`impede a regeneração${chance}`);
    else if (e.type === "moduleDisable") fx.push("pode derrubar um Módulo de nave");
    else if (e.type === "energyDrain") fx.push("drena a energia de naves");
    else if (e.type === "resistanceDown") fx.push("baixa as defesas de naves");
  }
  if (fx.length) parts.push(`Ao acertar, ${[...new Set(fx)].join("; ")}.`);
  return parts.join(" ");
}

/** "O sistema faz" de um Traço: quem o tem por origem. */
export function traitSentence(trait, speciesLabels = []) {
  const from = speciesLabels.length ? ` Vem de: ${speciesLabels.join(", ")}.` : "";
  return `Uma marca da criatura que algumas regras leem (imunidades, bônus de dano, contágio).${from}`;
}

/** "O sistema faz" de uma Espécie ou Herança: o que ela traz. */
export function originSentence(entry, { kind = "species", traitLabel = id => id } = {}) {
  const bits = [];
  const traits = (entry?.traits ?? []).map(traitLabel);
  if (traits.length) bits.push(`Traços: ${traits.join(", ")}`);
  const skills = (entry?.skills ?? []).map(s => s?.name).filter(Boolean);
  if (skills.length) bits.push(`Skills Raciais: ${skills.join(", ")}`);
  const lineages = (entry?.lineages ?? []).map(l => l?.label).filter(Boolean);
  if (lineages.length) bits.push(`Linhagens: ${lineages.join(", ")}`);
  const head = kind === "heritage" ? "Herança, dada pelo Mestre." : "Espécie.";
  return bits.length ? `${head} ${bits.join(" · ")}.` : head;
}

/** Contagens dos filtros do Mestre (prancha 4). */
export function glossaryCounts(entries) {
  return {
    all: entries.length,
    missing: entries.filter(e => e.missing).length,
    rewritten: entries.filter(e => e.rewritten).length,
    custom: entries.filter(e => e.kind === "custom").length,
    gmOnly: entries.filter(e => e.gmOnly).length
  };
}

/** Os verbetes de um filtro do Mestre. */
export function filterGlossary(entries, filter) {
  if (filter === "missing") return entries.filter(e => e.missing);
  if (filter === "rewritten") return entries.filter(e => e.rewritten);
  if (filter === "custom") return entries.filter(e => e.kind === "custom");
  if (filter === "gmOnly") return entries.filter(e => e.gmOnly);
  return entries;
}

/** Id de um termo da mesa a partir do nome, sem repetir. */
export function customTermId(term, existing = []) {
  const base = fold(term).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "termo";
  let id = base;
  let n = 2;
  while (existing.includes(id)) id = `${base}-${n++}`;
  return id;
}

/** O glossário salvo, normalizado (o texto da configuração pode vir de uma versão antiga). */
export function normalizeGlossaryData(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
  }
  const custom = Array.isArray(data?.custom) ? data.custom.filter(c => c && c.id && c.term) : [];
  const overrides = data?.overrides && typeof data.overrides === "object" ? data.overrides : {};
  return { custom, overrides };
}
