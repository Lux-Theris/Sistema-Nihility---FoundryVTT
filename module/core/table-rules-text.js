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
  if (condition?.anchorLevel) return `não é teleportado nem teleporta`;
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
    if (d.features.shops) {
      parts.push("<h2>Lojas</h2>");
      parts.push("<p>Uma <b>loja</b> é a ficha de um vendedor (ou um ponto de venda sem ninguém). O preço de cada item é o preço geral dele × o multiplicador da loja × um <b>sorteio</b> que cada loja faz (até 25% para mais ou para menos, o Mestre escolhe o teto); o sorteio só muda quando a loja reabastece. Comprar sai na hora, pagando em qualquer moeda (a conta converte sozinha). O Mestre confere o preço e o estoque, e pode desfazer a última venda.</p>");
      parts.push("<p>Para <b>vender</b>: num ponto automático (máquina, balcão, internet) o item é comprado por uma fração do preço geral (padrão 50%; consumível com cargas vale pelo que resta, arma carregada é descarregada antes). Com um vendedor NPC você marca os itens e <b>pede uma avaliação</b>: o Mestre faz uma oferta e os dois aceitam. Item equipado e contêiner com coisas dentro não se vende.</p>");
      parts.push("<p>O Mestre escolhe <b>quem vê cada loja</b> (Mostrar aos jogadores): quem foi escolhido recebe a Vitrine, nunca a ficha. Uma <b>máquina de venda</b> tem prateleiras e códigos (A03) e abre para quem clicar nela a até 2 m; ela não compra de volta.</p>");
      parts.push("<h2>Trocar, saquear e largar</h2>");
      parts.push("<p><b>Troca entre jogadores:</b> use \"Trocar com…\" no cabeçalho da ficha; os dois precisam estar a até 2 m, cada um põe itens e moedas do próprio personagem e os dois aceitam. Qualquer mudança depois de um aceite apaga os dois.</p>");
      parts.push("<p><b>Saque:</b> perto (até 2 m) de um NPC caído ou morto, clique no corpo e pegue itens e moedas. <b>Largar:</b> arraste um item da ficha para o mapa; vira uma pilha que qualquer um perto pega e que some quando esvazia. <b>Entregas:</b> as compras online caem no depósito do lugar; você só vê (e só pega) o que é seu.</p>");
      parts.push("<h2>Compras online (PAD)</h2>");
      parts.push("<p>O app <b>Compras</b> do PAD mostra as lojas online. Precisa de <b>rede</b> (a cena \"tem rede\") e de energia no aparelho: sem rede, ou sob PEM, aparece \"Sem conexão\". Você junta itens de várias lojas no carrinho e paga em qualquer moeda. <b>Software</b> chega na hora, direto no inventário. O resto vai para o <b>depósito do lugar</b> onde você está, ou para o porão da sua nave se ela estiver atracada ali, e pode ter prazo de entrega pelo relógio do mundo. Sem depósito na cena não há \"endereço de entrega\" e a compra não sai. A aba <b>Entregas</b> mostra o que está a caminho e onde retirar.</p>");
    }
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
    parts.push("<p>Algumas Habilidades e armas <b>curam quem usa</b> (\"roubo de vida\"): quando o Mestre aplica o dano, quem atacou recupera uma % do dano que realmente entrou na Vida do alvo, depois de resistências, fraquezas e Escudo. O Desfazer do card desfaz a cura.</p>");
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
    if (d.features.resistances) parts.push("<p>Resistências reduzem o dano de um tipo; chegando a 100% viram Imunidade. Uma <b>fraqueza</b> (Resistência negativa que vem da Espécie, Linhagem ou Herança) faz o personagem levar mais dano daquele tipo: −20% = leva 20% a mais, e a pior que dá é o dobro. Habilidades, Títulos e Itens com Resistência continuam valendo, e a fraqueza desconta por cima.</p>");
    if (d.features.statusConditions) parts.push("<p>Algumas Espécies, Linhagens e Heranças são <b>imunes</b> a certas Condições ou <b>resistem</b> a elas: <b>Resistência não é imunidade</b>: cada exposição (uma Habilidade, uma rodada dentro de uma área ou ambiente que a aplica, um contágio) soma 1 − a % da Resistência, e a Condição pega quando a soma chega a 1 (30% pega na 2ª exposição, 75% na 4ª, 90% na 10ª); quando pega, a força e a duração saem reduzidas na mesma %, e uma Condição sem número (Medo, Cegueira) só demora. A conta zera ao pegar e depois de <b>" + esc(d.conditionResistResetRounds ?? 3) + " rodadas</b> sem exposição (fora de combate, 6 s de relógio real por rodada). O Token mostra \"Resistindo: Veneno (1/2)\" ou \"Imune: Sangramento\". Uma Habilidade pode <b>furar imunidade e resistência</b> (por efeito). Âncora e Domínio nunca são resistidos, e o Mestre ainda pode marcar a Condição à mão.</p>");
    if (d.features.areaEffects) parts.push("<p>Habilidades em área acertam todos dentro do círculo, cone ou linha. Cada área pode crescer por nível (o \"+ por nível\" da Habilidade); ao pôr a área, <b>Ctrl+roda</b> muda o tamanho de 1 m até o máximo do nível, <b>sem custo</b>: cada metro a menos que o padrão vale +1 nível do efeito, cada metro a mais, −1 (o máximo é onde o nível do efeito chega a 1, e nunca passa de 5× o padrão). Uma <b>aura</b> (Estrutura \"Segue quem lançou\") anda com o Token de quem a ergueu: quem lançou não é afetado pelo próprio campo, aliados e inimigos dentro dele são, e a Antimagia nunca desliga a Habilidade que o sustenta.</p>");
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
    if (d.features.timeManipulation) {
      parts.push("<h2>Acelerar e Desacelerar</h2>");
      parts.push("<p>O efeito <b>Ritmo do tempo</b> muda o tempo de uma pessoa por um fator: maior que 1 acelera (<b>Acelerado ×3</b>), menor que 1 desacelera (<b>×½</b>). Em combate, quem está Acelerado tem uma <b>reserva de tempo</b> igual ao fator, que volta a esse valor todo turno (o que sobra se perde; fração acumula: ×2,5 dá 2 e 3 em turnos alternados). O que acontece <i>por turno</i> — Veneno e outros efeitos periódicos, regeneração, o custo das Habilidades Ativas, a radiação, a contagem da Vida 0 — passa de uma vez, até esse número de turnos e nunca além da duração de cada coisa. O Deslocamento anda ×N. <b>Preparo</b> e <b>Recarga</b> são pagos pela reserva quando ela basta (Preparo de P rodadas: sai na hora, −P; Recarga: paga o que falta e a Habilidade volta). Buffs, debuffs e Condições de controle dele andam 1 por 1 de reserva gasta, e no fim do turno o que sobrou também conta. Quantas ações ele faz, o Mestre decide: <b>−1</b> e <b>−X</b> no Painel do combate tiram da reserva. O Desacelerado não tem reserva: Recarga, Preparo e os números por turno andam só em parte dos turnos. Fora de combate o tempo pessoal anda ×N. Contra um alvo de <b>nível maior</b> que o da Habilidade o efeito enfraquece em linha reta e some quando o nível dele é o dobro. Não vale para Nave nem Estrutura.</p>");
      parts.push("<h2>Parar o tempo</h2>");
      parts.push("<p>No modo <b>Parar</b>, o efeito deixa o alvo <b>Parado no tempo</b>: não age (nem Habilidade, arma, item ou corrida), não se move (empurrão e teleporte também não) e nada nele anda. O prazo é em rodadas de <b>quem lançou</b>, contadas no turno dele; numa Habilidade Ativa dura enquanto ela estiver ligada. No turno do Parado, o Mestre só pula. O que ele colocou com duração (Zona, Estrutura) continua; o que ele mantém por Habilidade Ativa fica suspenso e volta sozinho, sem cobrar Mana do período. O <b>dano acumula</b>: os golpes num Parado ficam guardados e caem todos, um por um, quando o tempo volta (inclusive se a Antimagia desfaz ou o combate termina). Uma Habilidade de <b>área</b> (\"todos menos quem lança\") para o tempo de todo mundo em volta. E <b>Acelerar</b>, <b>Desacelerar</b> ou <b>Parar</b> numa <b>Zona</b> funciona como uma câmara do tempo temporária: vale para quem começa o turno dentro dela, por 1 rodada renovada a cada turno, e só em combate.</p>");
      parts.push("<h2>Reverter o tempo</h2>");
      parts.push(`<p>No modo <b>Reverter</b>, o efeito faz o alvo voltar ao que era <b>N rodadas atrás</b> (o teto é do Mestre, padrão 10). <b>Em combate</b>, o sistema fotografa cada personagem no começo do turno dele e volta: a Vida, a ${energy}, o Escudo, os efeitos (com os prazos recomeçando), as partes do corpo (inclusive as perdidas), a quantidade de Itens, munição, cargas e carregador, os Itens que foram gastos, o XP e o lugar no mapa. <b>Não volta</b> o chat, o que ele fez em outras fichas, nem Estruturas e Zonas. <b>Fora de combate</b> voltam só os efeitos de status e o <b>tempo de vida</b> (o sono, o relógio do PAD e a idade): quem já acordou continua acordado. Alvo de nível maior que o da Habilidade volta menos rodadas. Quem está ligado a outro por <b>Nomeação</b> ou <b>Pacto</b> volta junto, e cada um paga o custo da Habilidade: sem ${energy} para os dois, nada acontece. Uma <b>Forma</b> que mudou desde a foto recusa. Antes de reverter o sistema guarda um ponto de restauração, e o Mestre tem o botão <b>Desfazer reversão</b> no card. Recarregar a página do Mestre apaga o histórico de fotos.</p>`);
    }
    if (d.features.spaceManipulation) {
      parts.push("<h2>Saltar e Trocar</h2>");
      parts.push(`<p>O efeito <b>Espaço</b> muda o lugar de alguém sem passar pelo caminho. <b>Saltar</b> leva quem usa (ou um aliado) a um ponto do mapa dentro do <b>alcance da Habilidade</b>, ou até uma <b>Marca</b> (dobrar a distância custa mais ${energy}, como nas formas); <b>Trocar</b> faz o alvo e quem usa (ou outro Token à escolha) trocarem de lugar. O ponto é escolhido <b>antes</b> de pagar: se estiver fora do alcance, com uma parede no caminho (só quando a Habilidade respeita paredes), ou preso por uma Âncora, aparece um aviso na tela e <b>nada é gasto</b>. O Token some e aparece, sem deslizar, e a elevação de cada um fica como estava. Quem está <b>Parado</b> no tempo não é movido, e Nave e Veículo não são teleportados. A Habilidade é <b>espacial</b>; a Antimagia e o PEM contam pela natureza dela (mágica, tecnológica). O Desfazer uso devolve os Tokens, e o Reverter do tempo devolve a posição da foto.</p>`);
      parts.push("<h2>Portal, Bolso e Domínio</h2>");
      parts.push(`<p>O <b>Portal</b> abre duas pontas no mapa, dentro do alcance da Habilidade, que se levam uma à outra nos dois sentidos pela duração (rodadas em combate; fora dele, o relógio do mundo). Com "pode ligar outra cena", a ponta B cai em outra cena (o ponto inicial dela ou um Token que você marcou lá); cena de outra linha do tempo é viagem no tempo. Não deixa ver o outro lado. A Âncora impede abrir, e quem está <b>Ancorado</b> não atravessa. O <b>Bolso</b> é um contêiner sem peso na aba Inventário, com espaços que crescem pelo nível da Habilidade; quem está Ancorado não o abre, e o que acontece com o conteúdo se o dono morre é decisão do Mestre. O <b>Domínio</b> é uma área onde quem entra fica <b>Preso</b>: não sai (o movimento para fora é recusado) nem teleporta, a não ser com uma Habilidade de teleporte de nível maior; o tempo lá dentro pode correr em outro ritmo. O Mestre solta quem quiser tirando a Condição Preso. Parar o tempo de quem os mantém por uma Habilidade Ativa suspende o Portal e o Domínio até ele voltar.</p>`);
      parts.push("<h2>Âncora e Interdição</h2>");
      parts.push("<p>A <b>Âncora</b> bloqueia o que é espacial como a Antimagia bloqueia o que é mágico: Saltar ou Trocar que <b>começa</b>, <b>termina</b> ou é de alguém <b>dentro de uma Âncora</b> (ou <b>Ancorado</b>) falha, a não ser que a Habilidade tenha <b>nível maior</b> que o da Âncora. Há três fontes: a Condição <b>Ancorado</b> (o nível é o da Habilidade que ancorou), o <b>Campo de Âncora</b> (uma Estrutura mágica, que a Antimagia desfaz) e a Região com o comportamento <b>Âncora (Nihility)</b>, que você desenha. A <b>Interdição</b> é de Nave: um Módulo tecnológico com alcance de interdição impede o salto FTL das Naves dentro dele (a ficha mostra INTERDITADO); o PEM derruba o Módulo.</p>");
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
        "<p>Uma sala do mapa também pode ter o tempo diferente (uma <b>câmara do tempo</b>): quem entra vive no ritmo dela e sai com o relógio e a idade desencontrados do resto do grupo. Se os combatentes de uma luta estão em ritmos diferentes, vale o da maioria. Na ficha, a <b>idade</b> (quando o Mestre a preenche) sobe com o tempo pessoal, não com o tempo do mundo.</p>",
        ...(d.features.sceneFolders ? ["<p>As cenas de uma mesma <b>pasta</b> do Diretório de Cenas costumam dividir a linha do tempo e o ambiente (mana, radiação, perigos): a cena segue a pasta até o Mestre mudar algo só nela.</p>"] : [])
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

  // Naves: sensores, furtividade e abordagem (F1/F2).
  if (d.features.shipSensors || d.features.boarding) {
    const parts = [];
    const s = d.sensors;
    if (s) {
      parts.push("<h2>Sensores e Assinatura</h2>");
      parts.push(`<p>Uma nave com um Módulo <b>Sensor</b> só vê as outras naves e veículos que ele <b>alcança</b>: a nave A vê a B se a distância for no máximo o <b>alcance do sensor de A × a Assinatura de B</b>. A <b>Assinatura</b> (%) começa pelo Porte (Médio = 100%), soma o consumo de ${energy} (até +${num(s.energyActive)}% no modo ativo e +${num(s.energyPassive)}% no passivo, proporcional ao quanto a nave gasta do que gera) e <b>sobe quando uma arma dispara</b> (+50% por 1 rodada, ou o valor da arma). Um Módulo de <b>Camuflagem</b> ligado troca isso pela Assinatura alvo dele e gasta muita ${energy}. Sem ${energy}, desligado, sob PEM ou numa Interferência, o sensor fica cego.</p>`);
      parts.push(`<p>O sensor é sempre ativo; o <b>modo passivo</b> alcança ${num(`${s.passiveFactor}%`)} do alcance, lê com menos Resolução e gasta menos. A <b>Interferência da cena</b> (ou da pasta de cenas) corta o alcance em %: com 40%, um sensor de 1000 alcança 600.</p>`);
      parts.push("<p>Para a <b>tripulação de uma nave com sensor</b>, a nave que o sensor não detecta <b>some</b> do mapa, da lista de alvos e da iniciativa. Quem não tripula nave vê tudo como sempre, e o Mestre vê tudo. Onde uma nave foi vista pela última vez fica um <b>marcador cinza</b> por algumas rodadas, e some depois.</p>");
      parts.push("<h2>Escanear</h2>");
      parts.push(`<p>O botão <b>Escanear</b> do sensor (ou a Habilidade <b>Analisar</b>) lê uma nave detectada em degraus: 1 Porte e classe; 2 Escudo, Casco e Integridade; 3 Módulos e estado; 4 armas e Penetração; 5 carga e tripulação. A <b>Resolução</b> do sensor menos o <b>Bloqueio de leitura</b> do alvo (a camada mais forte: o Escudo só conta de pé, a blindagem sempre, e um Módulo de Bloqueio de varredura) decide: <b>${num(`${s.cleanMargin} ou mais`)}</b> lê limpo; de <b>0</b> até aí a leitura sai <b>distorcida</b> (números em faixa, e um Módulo pode aparecer com o estado errado); abaixo de 0 fica <b>bloqueada</b> (só o Porte e a classe). No modo passivo a leitura vai no máximo até o degrau 2.</p>`);
    }
    if (d.features.boarding) {
      parts.push("<h2>Acoplar e abordar</h2>");
      parts.push(`<p>Duas naves com os Tokens colados podem <b>acoplar</b>, mas só com o <b>Raio Trator</b> de uma segurando a outra, com o <b>Escudo do alvo em 0</b> ou com o Mestre liberando (um Veículo só com o Mestre liberando). O par fica marcado até <b>Desacoplar</b>. Mover uma nave acoplada faz um teste resistido de propulsão: diferença até <b>${num(d.boardingMargin)}</b> arrasta a outra; maior arranca um pedaço (dano no Casco e no Módulo do ponto de acoplamento) e desacopla.</p>`);
      parts.push("<p>Quem passa para a outra nave entra no <b>grupo de abordagem</b> dela. De lá: <b>Sabotar</b> (o ataque vai direto no Módulo, sem Escudo, sem Casco e sem escala: está nos circuitos), <b>Desligar</b> e <b>Hackear</b> (o Mestre aprova pelo chat). Tomar a nave fica por conta da história. Dá para abordar por <b>teleporte</b> (uma Habilidade de Espaço ou um Módulo Teletransportador) se o alvo estiver <b>detectado pelo sensor</b>; Interdição e Âncora bloqueiam, o PEM corta o teleporte tecnológico e a Antimagia o mágico. Uma <b>Região \"A bordo\"</b> desenhada no mapa põe quem entra no grupo daquela nave, e quem sai da Região sai do grupo.</p>");
    }
    pages.push({ key: "ships", name: "Naves: sensores e abordagem", html: parts.join("\n") });
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
