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
  if (condition?.antimagicLevel) return `a magia dele não sai, a não ser que resista (Manipulação)`;
  if (condition?.suppressesMagic) return "a magia dele para de funcionar";
  if (condition?.interferenceLevel) return `a tecnologia dele não sai`;
  if (condition?.suppressesTech) return "a tecnologia dele para de funcionar";
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
    // Glossário (1.85.0): o link é um <a> com classe; o clique é pego em glossary.js (o diário não roda script).
    parts.push(`<p>Não sabe o que é um termo? <a class="nihility-open-glossary">Abrir o Glossário</a>: todos os termos explicados, com busca.</p>`);
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
    if (d.features.skillRange) {
      parts.push("<h2>Alcance e Marcas</h2>");
      parts.push(`<p>Habilidades, armas e granadas têm um <b>alcance</b> em metros (0 = sem limite), medido do centro do seu Token ao do alvo. Fora dele o uso é recusado. Uma Habilidade de área pode sair do seu Token (o círculo em volta de você, o cone e a linha só giram) ou ser posta livre, dentro do alcance. Granadas vão até uma base mais a sua Força.</p>`);
      parts.push(`<p>Uma <b>Marca</b> é um efeito mágico que você põe em alguém: enquanto durar, você pode lançar Habilidades <i>como se estivesse onde o Marcado está</i> — o alvo, a área e as paredes no caminho contam a partir dele. Custa mais quanto mais longe: o custo vezes (distância ÷ alcance) ao quadrado. A Antimagia desfaz a Marca.</p>`);
    }
    if (d.features.luck) {
      parts.push("<h2>Sorte e azar</h2>");
      parts.push("<p><b>Sorte</b> é uma inclinação, em %, sobre as faces dos dados: positiva puxa para as faces altas, negativa (azar) para as baixas. Não tem teto — +100% leva um d20 a uma média de 13,8 e +300% dá 27% de chance de tirar 20 —, mas nunca vira certeza. Ela vale nos <b>atributos e na iniciativa</b>, no <b>dano</b> de quem ataca e nas <b>chances</b> de %, onde a sorte favorece o sucesso (no Contágio, a sorte de quem pode pegar protege). Vem de Habilidades, Condições, Títulos, da Espécie e de Traços, e soma. Quando você tem sorte (ou azar), a ficha mostra a linha <i>Sorte</i>.</p>");
    }
    if (d.features.weaponMastery && d.mastery) {
      const m = d.mastery;
      parts.push("<h2>Tipos de arma e Maestria</h2>");
      const subtypes = m.detailed ? ", com subtipos como Espadas e Adagas" : "";
      const subtypeNote = m.detailed ? ` — a de um subtipo vale só para ele, mas rende ${esc(m.subtypeFactor)}× por nível` : "";
      parts.push(
        `<p>Cada arma pode ter um <b>tipo</b> (Lâminas, Armas de Fogo, Energia…${subtypes}). Uma <b>Maestria</b> é uma Habilidade passiva de um tipo: dá <b>+${esc(m.percentPerLevel)}% de dano por nível</b> (até o nível ${esc(m.maxLevel)}) com as armas daquele tipo${subtypeNote}. Depois do nível máximo, só a <b>Evolução</b> a leva a +${esc(m.evolvedPercent)}%. Só a melhor Maestria que cobre o ataque conta. Ela cresce com os seus golpes, e o botão 🎲 de ataque soma o nível dela. Sem Maestria, depois de muitos ataques o Mestre pode concedê-la.</p>`
      );
      parts.push("<p>Você sempre pode <b>atacar desarmado</b> (dano baixo, escala pela Força). Soco-inglês e itens parecidos reforçam o golpe; algumas artes marciais contam como ataque desarmado (ou de uma arma) e usam a Maestria também.</p>");
    }
    if (d.features.forcedMovement) {
      parts.push("<h2>Empurrar e puxar</h2>");
      parts.push("<p>Algumas Habilidades e armas de gravidade <b>empurram</b> (afastam de quem usou ou do centro da área) ou <b>puxam</b> o alvo em linha reta. A Defesa Mágica (se for magia), a Resistência do elemento e certos Traços diminuem os metros; o alvo rola Defesa contra quem empurra e, <b>se vencer, anda só metade</b>. O movimento para na primeira parede ou Estrutura, e os metros que sobraram viram <b>dano de impacto</b> (Contundente); a Estrutura também o leva. Não gasta o seu Deslocamento.</p>");
    }
    if (d.features.elevation) {
      parts.push("<h2>Voo, altura e escavação</h2>");
      parts.push("<p>Quem pode voar (Traço Voador ou o efeito Voando) sobe e desce um quadrado por vez pelo menu do Token; quem pode cavar desce abaixo do chão. A <b>altura conta nas distâncias</b> e as áreas são esferas: um círculo de 5 m não pega quem está 6 m acima. <b>Debaixo da terra</b> ninguém na superfície ou no ar alcança você. Quem perde o voo no ar <b>cai</b>: o Mestre calcula o dano (cada metro acima de 3 m vale uma parte da Vida máxima, Contundente).</p>");
    }
    if (d.features.forms) {
      parts.push("<h2>Formas</h2>");
      parts.push("<p>Uma Habilidade de <b>Forma</b> (sempre Ativa) transforma você: enquanto estiver ligada você joga com uma <b>ficha temporária</b> — os <b>atributos, a Vida, a Espécie, as partes do corpo, as armas naturais, a imagem e o tamanho vêm da forma</b>; o <b>nível, o XP, a Mana, os Títulos e as suas Habilidades vão com você</b>. Os itens que você carrega não vão. A forma tem Vida própria: se ela chegar a 0, você volta ao normal e <b>o dano que sobrou passa para você</b>. Desligar a Habilidade, ficar sem Mana ou sofrer Antimagia também fazem você voltar. Ao voltar, a Mana gasta não volta; o XP ganho e as Condições voltam com você. Você pode <b>pedir uma forma</b> ao Mestre: escolhe a Espécie, a imagem e reparte os mesmos pontos de atributo que o seu personagem tem.</p>");
    }
    if (d.features.naming) {
      parts.push("<h2>Nomeação e Corredor de alma</h2>");
      parts.push(`<p>No menu do Token, <b>Nomear</b> dá um nome a uma criatura. Quem nomeia <b>perde ${energy} máxima para sempre</b> (a soma dos atributos da criatura); a criatura ganha ficha própria, a Herança <b>Nomeado</b> e <b>XP nas Habilidades</b>, que podem subir vários níveis de uma vez. Se a ${energy} máxima não chega, a Nomeação falha: a ${energy} vai a 0 e quem nomeava desmaia. O jogador pede e o Mestre aprova.</p>`);
      parts.push(`<p>Os dois ficam ligados pelo <b>Corredor de alma</b>: o nomeado pode usar as Habilidades de quem o nomeou (de uso na hora), com a própria ${energy}, no nível de quem nomeou; o <b>XP de uso vai para quem nomeou</b>, que pode parar de aceitar pedidos. Quem nomeou também recebe uma parte de todo XP que o nomeado ganhar.</p>`);
    }
    if (d.features.analysis) {
      parts.push("<h2>Análise</h2>");
      parts.push("<p>Uma Habilidade de <b>Análise</b> revela a ficha de um alvo. A margem é o <b>nível da Habilidade</b> menos o <b>nível do alvo</b> e a <b>Ocultação</b> dele, mais um degrau a cada 10 pontos que a sua <b>Percepção</b> passa a <b>Furtividade</b> dele. Uma Análise <b>mágica</b> perde nível pela <b>Defesa Mágica</b> do alvo; a tecnológica não. Quanto maior a margem, mais você vê: origem, Traços e elementos; Vida, energia e Condições; Resistências e fraquezas; as Habilidades; e por fim a frase de cada uma e os atributos. Margem negativa: o alvo resistiu e você não vê nada.</p>");
    }
    if (d.features.predation) {
      parts.push("<h2>Predação</h2>");
      parts.push("<p>Uma Habilidade de <b>Predação</b>, usada num alvo <b>derrotado</b> (morto, Caído ou Inconsciente), rola um d100 por Habilidade dele: a chance é <b>50%</b> no mesmo Tier e no mesmo nível, mais 25% por Tier da Predação acima do da Habilidade e menos 25% por Tier abaixo; cada nível que a Habilidade está acima da Predação tira pontos (e cada nível abaixo soma), então uma Predação de nível baixo não pega Habilidades de nível alto. O Mestre confirma. As Habilidades ganhas entram <b>inteiras, no nível 1</b> (a Racial vira Normal). Na <b>1ª, 5ª, 10ª, 20ª, 40ª…</b> criatura da mesma Espécie, uma parte dos atributos dela vira <b>pontos permanentes</b>. Quem tem uma Habilidade de Forma pode ganhar a <b>forma</b> do corpo. O corpo é consumido e o Token some. Não se absorve o que veio de Item, Habilidades de base, Maestrias, Formas nem o que você já tem.</p>");
    }
    if (d.features.reroll) {
      parts.push("<h2>Rerrolar</h2>");
      parts.push("<p>Uma Habilidade de <b>Rerrolar</b> é usada <b>no chat</b>, depois de ver uma rolagem: o botão <b>Rerrolar</b> aparece no card de atributo, iniciativa, dano ainda não aplicado e dos d100 de Predação e de passar da Mana que ela alcança (as suas, as de aliados ou as de qualquer um, conforme a Habilidade). Usar paga o Custo e começa a Recarga como qualquer Habilidade. A Habilidade diz o que fica: o <b>novo</b>, o <b>melhor</b> ou o <b>pior</b> dos dois (uma Habilidade Ultimate pode <b>escolher na hora</b>). Um resultado rerrolado pode ser rerrolado de novo por outra Habilidade, pagando de novo.</p>");
    }
    parts.push("<h2>Dissipar</h2>");
    parts.push("<p>O efeito <b>Dissipar</b> é uma magia para desfazer magia: termina só os efeitos <b>mágicos</b> do alvo (Condições, marcas, bênçãos e maldições) de nível até o <b>nível da Habilidade</b>. Diferente da Antimagia, não suprime o alvo, não desliga as Habilidades Ativas dele, não toca Escudos nem Estruturas e, por ser magia, um Campo de Antimagia o impede. Pode ser só marcas, ou só uma Condição escolhida.</p>");
    if (d.features.pact) {
      parts.push("<h2>Pacto</h2>");
      parts.push(`<p>Num <b>Pacto</b> (criado pelo Mestre), o bruxo usa as Habilidades que o patrono <b>liberou</b>, com a própria ${energy}, no nível do patrono. Alcance, Antimagia e Supressão contam do bruxo; o XP de uso vai para o patrono. O patrono ou o bruxo podem cortar o Pacto, e o patrono pode parar de aceitar pedidos.</p>`);
    }
    if (d.features.senses) {
      parts.push("<h2>Sentidos e visibilidade</h2>");
      parts.push("<p>Quem está <b>debaixo da terra</b> ou <b>Invisível</b> não aparece no mapa nem na lista de iniciativa para quem não tem o sentido certo, e não aparece na escolha de alvo. Quem está debaixo da terra também não enxerga: só percebe os outros com <b>Sentido sísmico</b> ou <b>Sentir tudo</b>. <b>Ver o invisível</b>, <b>Visão verdadeira</b> e <b>Sentir tudo</b> revelam o Invisível. Esses sentidos vêm de Habilidades ou da Espécie, com um alcance em metros.</p>");
    }
    if (d.features.reactions) {
      parts.push("<h2>Reações elementais</h2>");
      parts.push("<p>Um golpe de um elemento <b>reage</b> com o que o alvo carrega: uma <b>marca</b> (uma Condição como Molhado ou Queimadura). Na parte do golpe daquele elemento o dano sobe ou cai, a marca é gasta, e a reação pode espalhar para quem está perto, aplicar ou tirar uma Condição. O nome da reação sobe do Token ao Aplicar. O elemento do corpo (a Espécie) só <b>conduz</b>: nunca multiplica nem é gasto. Dano Absoluto não reage.</p>");
      if (d.reactions?.length) parts.push(`<ul>${d.reactions.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`);
    }
    if (d.features.surfaces) {
      parts.push("<h2>Superfícies</h2>");
      parts.push("<p>Alguns elementos deixam uma <b>superfície no chão</b>: uma poça, chamas, gelo. Quem pisa nela (andando, empurrado ou teleportado) e quem <b>começa o turno</b> em cima leva o que ela faz, a menos que esteja <b>acima da altura</b> que ela alcança ou seja imune. Quem está de pé numa superfície <b>carrega o elemento dela</b>: um golpe de Fogo em quem está numa poça de óleo reage, e a superfície muda (vira Chamas) ou some (Gelo apaga o fogo). Dura rodadas em combate e minutos fora dele. A de matéria a Antimagia não toca; a mágica ela desfaz.</p>");
      if (d.surfaces?.length) parts.push(`<ul>${d.surfaces.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`);
    }
    parts.push("<p>Alguns efeitos de Habilidade têm um <b>\"Só se…\"</b>: só pegam se o alvo (ou quem usou) estiver como pedido, por exemplo só se o alvo estiver Molhado. Quando não vale, o uso diz \"não aplicado\" e o porquê.</p>");
    parts.push("<p>Uma Habilidade <b>Combinada</b> dispara todas as suas partes de uma vez, nos mesmos alvos, pagando o Custo uma vez só. Uma delas pode erguer uma <b>Estrutura em volta de quem usa</b> (ou do alvo), sem clique; a Estrutura pode apanhar menos de fora e mais de dentro, sumir quando a Habilidade desliga e, se for destruída, desligar a Habilidade. Uma Habilidade Ativa pode desligar sozinha se o alvo cair ou se alguém entrar na Estrutura. <b>Magia enfraquecida</b> é um efeito em alguém: cada magia que ele usar tem uma chance de sair com só parte da força.</p>");
    parts.push("<h2>Campo de Antimagia</h2>");
    parts.push(`<p>Magia que vem <b>de fora</b> e cruza um campo de Antimagia gasta a ${energy} e <b>some</b>, se o campo vencer. <b>De dentro</b> do campo, ou sob um Selo de Antimagia, a magia <b>nem sai</b> e não gasta nada. A Habilidade <b>Manipulação de ${energy}</b> muda isso: quanto maior o nível dela diante do campo, menos ele atrapalha — primeiro a magia passa pagando ${energy} a mais, depois passa de graça. Sem a Manipulação, o campo sempre vence. Usá-la contra a Antimagia a faz evoluir.</p>`);
    if (d.features.interference) parts.push("<p>O Campo de Interferência faz o mesmo com a tecnologia, mas não há Habilidade que o vença: o uso tecnológico de fora some, e de dentro nem sai.</p>");
    pages.push({ key: "combat", name: "Combate", html: parts.join("\n") });
  }

  // Tempo: calendário, linhas do tempo e tempo pessoal (J9b).
  if (d.features.worldClock && d.features.calendar) {
    pages.push({
      key: "time",
      name: "Tempo e calendário",
      html: [
        "<p>O mundo tem um <b>calendário</b> próprio (meses, semana, eras). Cada cena está numa <b>linha do tempo</b>: ela diz que época é e a que velocidade o tempo corre ali. Atravessar uma porta para 500 anos atrás é trocar de cena para uma linha do passado.</p>",
        "<p>Cada personagem tem o seu <b>tempo pessoal</b>: é o que ele viveu, e é ele que conta o sono e o descanso. O relógio do seu <b>PAD</b> mostra a data que ele <i>acha</i> que é: depois de uma porta no tempo, ele continua mostrando a data antiga até você tocar em <b>Atualizar</b> e o Mestre aprovar (em lugares com rede o PAD acerta sozinho). Um relógio de bolso é acertado por quem o tem, à mão.</p>",
        "<p>Numa luta em lugar de tempo diferente, o resto do mundo fica parado até o combate acabar (ou passa tudo de uma vez no fim, conforme a linha).</p>",
        "<p>Uma sala do mapa também pode ter o tempo diferente (uma <b>câmara do tempo</b>): quem entra vive no ritmo dela e sai com o relógio e a idade desencontrados do resto do grupo. Se os combatentes de uma luta estão em ritmos diferentes, vale o da maioria. Na ficha, a <b>idade</b> (quando o Mestre a preenche) sobe com o tempo pessoal, não com o tempo do mundo.</p>"
      ].join("\n")
    });
  }

  // 4. Condições e 5. Tipos de dano (catálogos deste mundo).
  if (d.features.statusConditions && d.conditions?.length) {
    pages.push({
      key: "conditions",
      name: "Condições",
      html: `<ul>${d.conditions.map(c => `<li><b>${esc(c.label)}</b> — ${esc(c.sentence)}${c.explanation ? `. <i>Na mesa:</i> ${esc(c.explanation)}` : ""}</li>`).join("")}</ul>`
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
