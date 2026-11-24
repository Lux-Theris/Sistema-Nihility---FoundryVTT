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
  ["reaction", "Combate e dano", "Reação elemental", "Um golpe de um elemento reage com o que o alvo carrega: o dano daquela parte sobe ou cai, a marca é gasta e a reação pode espalhar para quem está perto ou aplicar e tirar uma Condição (Fogo em quem está Molhado vira Vapor; raio num molhado passa para quem está ao lado). O nome da reação sobe do Token ao Aplicar. A tabela fica em Tipos de Dano. Dano Absoluto não reage.", "reactions", ["reactionMark", "bodyConducts", "affinity"]],
  ["surface", "Combate e dano", "Superfície", "Um elemento pode deixar uma superfície no chão (poça de água, óleo, chamas, gelo): um círculo no mapa, sem dono. Quem pisa e quem começa o turno em cima leva o dano e a Condição dela, a menos que esteja acima da altura que ela alcança ou seja imune, e carrega o elemento dela para as Reações. Dura rodadas em combate e minutos fora dele; a de matéria a Antimagia não toca, a mágica ela desfaz.", "surfaces", ["reaction", "element"]],
  ["reactionMark", "Combate e dano", "Marca elemental", "Uma Condição com \"Elemento do corpo\" (Molhado = Água, Oleado = Óleo, Queimadura = Fogo, Lentidão = Gelo). É o que o golpe lê para reagir; quando a reação acontece, a marca é gasta (a menos que a reação diga o contrário).", "reactions", ["reaction", "condition"]],
  ["bodyConducts", "Combate e dano", "O corpo conduz", "O elemento da própria Espécie (um elemental de Água) nunca multiplica o dano nem é gasto: só conduz. Numa reação marcada \"o corpo conduz\", o que ela passa para os outros (raio para os molhados ao lado) acontece também quando o alvo É daquele elemento.", "reactions", ["reaction"]],
  ["onlyIf", "Habilidades", "Só se…", "Uma condição num efeito de Habilidade: ele só pega se o alvo (ou quem usou) estiver como pedido — por exemplo, só se o alvo estiver Molhado, tiver um Traço, for uma Nave ou estiver com a Vida baixa. Quando não vale, o resumo do uso diz \"não aplicado\" e o porquê.", "", ["condition"]],
  ["onHit", "Habilidades", "Ao acertar", "Um passivo de uma Habilidade: todo golpe de dano seu (soco, arma, Habilidade de dano ou consumível; não tick de dano nem Estrutura) põe uma Condição no alvo, com uma chance. Ela entra quando o dano é aplicado no card e o Desfazer a tira. Numa Habilidade Ativa vale sempre, só ligada ou só desligada. É a forma de marcar alguém ao bater.", "", ["mark", "onlyIf"]],
  ["complexity", "Habilidades", "Complexidade", "A pontuação de quanta regra uma Habilidade carrega (1 por efeito, +1 por Condição, +2 por \"Só se…\", +2 área ou Zona, +3 Estrutura, +2 empurrão, +1 Ativa, +1 \"ao acertar\", +1 por Sub-Skill). Cada Tier tem um teto (Extra, Normal e Única; Racial e Ultimate não têm). Passar do teto é só um aviso: o Mestre decide.", "", ["onlyIf"]],
  ["combined", "Habilidades", "Combinada", "Uma Habilidade com Sub-Skills que dispara todas de uma vez, em ordem, nos mesmos alvos: o Custo da Habilidade é pago uma vez e as escolhas (o alvo, onde pôr a área) são feitas uma vez só. Numa Habilidade Ativa, ligar liga a de cima e roda as partes; o que as partes prendem (efeitos, Estruturas) fica preso a ela, e desligar solta tudo. Se uma Sub-Skill de área sai de quem usa (círculo em volta), nem pede clique.", "", ["structure", "duel"]],
  ["luck", "Combate e dano", "Sorte", "Uma inclinação, em %, que puxa os dados para as faces altas (sorte) ou baixas (azar). +100% leva o d20 a uma média de 13,8; +300% dá 27% de chance de tirar 20; não tem teto e nunca vira certeza. Vale em até três escopos: atributos e iniciativa, o dano de quem ataca e as chances de %, onde a sorte favorece o sucesso (no Contágio, a sorte da vítima a protege). Vem de efeitos de Habilidade, Condições (Abençoado, Azarado), Títulos, passivos de Espécie, Linhagem e Herança e Traços (Sortudo, Azarado), e tudo soma. A ficha mostra a linha Sorte quando ela não é zero, com o ⓘ de onde vem.", "luck", ["magicDampen"]],
  ["magicDampen", "Habilidades", "Magia enfraquecida", "Um efeito posto em alguém: cada vez que essa pessoa usa uma Habilidade mágica, rola a chance e, se pegar, a magia sai com só uma parte da força (50% = metade). Dura o que o efeito durar; a Antimagia pode desfazer se o efeito for mágico.", "", ["mark", "combined"]],
  ["reroll", "Habilidades", "Rerrolar", "Uma Habilidade de Rerrolar é usada no chat, depois de ver uma rolagem: o botão \"Rerrolar\" aparece no card de atributo, iniciativa, dano ainda não aplicado e dos d100 de Predação e de passar da {E}, nas rolagens que ela alcança (as suas, as de aliados ou as de qualquer um). Paga o Custo e começa a Recarga como qualquer Habilidade, e a rolagem é refeita: fica o novo, o melhor ou o pior dos dois, conforme a Habilidade (uma Ultimate pode escolher na hora). Num card de dano, os números de cada alvo são refeitos pela razão entre o total novo e o antigo.", "reroll", ["luck"]],
  ["dispel", "Habilidades", "Dissipar", "Um efeito de Habilidade que termina os efeitos mágicos do alvo (Condições, marcas, bênçãos, maldições) de nível até o da Habilidade. É uma magia para desfazer magia: não suprime o alvo, não desliga as Habilidades Ativas dele, não toca Escudos nem Estruturas, e um Campo de Antimagia o impede. Pode alcançar tudo o que é mágico, só marcas ou só uma Condição escolhida.", "", ["antimagic", "mark"]],
  ["timeRate", "Habilidades", "Ritmo do tempo", "Um efeito de Habilidade que muda o tempo de alguém por um fator: maior que 1 acelera (Acelerado ×3), menor que 1 desacelera (Desacelerado ×½). Em combate, o Acelerado tem uma reserva de tempo por turno (×3 = 3): o que acontece por turno (Veneno, regeneração, o custo das Ativas, a radiação, a contagem da Vida 0) passa de uma vez, até esse número de turnos e nunca além da duração de cada coisa; Preparo e Recarga saem pela reserva quando ela basta; o Deslocamento anda ×N; buffs e Condições de controle dele andam conforme ele gasta a reserva (o Mestre tira com −1 e −X no Painel do combate). O Desacelerado não tem reserva: tudo anda em parte dos turnos. Fora de combate o tempo pessoal anda ×N. Contra um alvo de nível maior que o da Habilidade o efeito enfraquece, até sumir no dobro. Vale para Personagem, não para Nave nem Estrutura; é mágico ou tecnológico como a Habilidade, e a Antimagia (ou o PEM) pode desfazer.", "timeManipulation", ["dispel", "antimagic"]],
  ["timeStop", "Habilidades", "Parado no tempo", "O efeito Ritmo do tempo no modo Parar. Quem está Parado não age (nem Habilidade, arma, item ou corrida), não se move (empurrão e teleporte também não o movem) e nada nele anda: prazos dos efeitos, recarga, preparo, dano periódico, sono e o tempo pessoal ficam congelados. No turno dele o Mestre só pula. O prazo é em rodadas de quem lançou, descontadas no turno dele; numa Habilidade Ativa dura enquanto ela estiver ligada. A Zona ou Estrutura que ele só colocou, com duração, continua até acabar; a que ele mantém por Habilidade Ativa fica suspensa e volta sozinha, sem cobrar Mana do período. Não vale para Nave nem Estrutura; é mágico ou tecnológico como a Habilidade, e a Antimagia (ou o PEM) pode desfazer.", "timeManipulation", ["timeRate", "timeStopDamage"]],
  ["timeStopDamage", "Habilidades", "Dano acumulado", "O golpe num alvo Parado no tempo não tira Vida nem Escudo na hora: o card mostra \"Acumulado\" e o dano fica guardado. Quando o tempo volta (o prazo acaba, a Antimagia desfaz, o Mestre tira, ou o combate termina), todos os golpes caem um por um, com o Escudo e a Vida do momento, e os efeitos de acerto (Marca, Condição do elemento, Reação) acontecem nessa hora. Cada golpe continua com o próprio Desfazer no card de origem, e um cartão \"O tempo de fulano voltou\" lista tudo.", "timeManipulation", ["timeStop"]],
  ["timeRewind", "Habilidades", "Reverter o tempo", "O efeito Ritmo do tempo no modo Reverter: o alvo volta ao que era N rodadas atrás (o teto está nas Regras desta mesa, padrão 10). Em combate volta o que o sistema fotografa no começo do turno dele: Vida, {E}, Escudo, efeitos (com os prazos recomeçando), partes do corpo (inclusive as perdidas), quantidade de Itens, munição, cargas, carregador, Itens gastos, XP e o lugar no mapa; o que ele fez em outras fichas, o chat, as Estruturas e as Zonas não voltam. Fora de combate volta só os efeitos de status e o tempo de vida (sono, PAD e idade): quem já acordou continua acordado. Alvo de nível maior que o da Habilidade volta menos rodadas. Quem está ligado a outro por Nomeação ou Pacto volta junto e cada um paga o custo da Habilidade; sem {E} para os dois, nada acontece. Uma Forma que mudou desde a foto recusa. Antes de reverter, o sistema guarda um ponto de restauração e o card tem o botão \"Desfazer reversão\" (Mestre). Recarregar a página do Mestre apaga o histórico de fotos.", "timeManipulation", ["timeRate"]],
  ["space", "Habilidades", "Espaço (Saltar, Trocar, Portal, Bolso e Domínio)", "Um efeito de Habilidade que mexe no lugar das pessoas, sem passar pelo caminho: Saltar leva quem usa (ou um aliado) a um ponto do mapa dentro do alcance da Habilidade, ou até uma Marca (como nas formas, dobrar a distância custa mais {E}); Trocar faz o alvo e quem usa (ou outro Token à escolha) trocarem de lugar. Escolhe-se o ponto antes de pagar, atravessa paredes (a não ser que a Habilidade as respeite) e o Token some e aparece, sem deslizar; a elevação de cada um fica como estava. Quem está Parado no tempo não é movido, Nave e Veículo não são teleportados, Antimagia e PEM contam pela natureza da Habilidade e a Âncora bloqueia. A Habilidade ganha a marca \"espacial\" (o selo Espacial na ficha). O Desfazer uso devolve os Tokens ao lugar e o Reverter do tempo devolve a posição que fotografou. Os outros três modos são o Portal, o Bolso e o Domínio.", "spaceManipulation", ["anchor", "mark", "timeStop", "portal", "pocket", "domain"]],
  ["portal", "Habilidades", "Portal", "Um par de pontas no mapa que se levam uma à outra, nos dois sentidos, enquanto durarem (rodadas em combate; fora dele, pelo relógio do mundo). Quem abre escolhe as duas pontas dentro do alcance da Habilidade antes de pagar; com \"pode ligar outra cena\", a ponta B pode cair em outra cena (o ponto inicial dela, ou um Token que você marcou lá) e o Token atravessa e aparece nela, sem deixar ver o outro lado. Cena de outra linha do tempo é viagem no tempo. A Âncora impede abrir (numa ponta, ou em quem abre) e quem está Ancorado não atravessa. Some ao acabar a duração, quando a Habilidade Ativa é desligada ou ao Desfazer o uso; Parar o tempo de quem a mantém a suspende.", "spaceManipulation", ["space", "anchor"]],
  ["pocket", "Habilidades", "Bolso", "Um contêiner dimensional que a Habilidade dá: aparece na aba Inventário com espaços que crescem pelo nível da Habilidade (espaços no nível 1 mais um tanto por nível) e o que está dentro não pesa. Arrastar Itens para dentro ou para fora é como em qualquer contêiner. Quem está Ancorado não o abre (nada se perde). O que acontece com o conteúdo se o dono morre, o Mestre decide.", "spaceManipulation", ["space", "anchor", "grantedSkill"]],
  ["domain", "Habilidades", "Domínio", "Uma área (raio em metros) onde quem está dentro fica Preso: o movimento para fora é recusado e ele não teleporta, a não ser que tenha uma Habilidade de teleporte de nível maior que o do Domínio. Quem o ergueu não fica Preso. Dura pelas rodadas da Habilidade (ou enquanto estiver ligada); pode ter ritmo de tempo próprio (a câmara do tempo, com o bloco do tempo ligado). O Mestre solta quem quiser tirando a Condição Preso, e sempre pode mover o Token.", "spaceManipulation", ["space", "anchor", "timeChamber"]],
  ["anchor", "Habilidades", "Âncora", "O que impede o que é espacial, como a Antimagia impede o que é mágico. Três fontes: a Condição Ancorado (a pessoa não é teleportada nem teleporta), o Campo de Âncora (uma Estrutura, que a Antimagia desfaz) e a Região com o comportamento \"Âncora (Nihility)\" que o Mestre desenha. Saltar ou Trocar que começa, termina ou é de alguém dentro de uma Âncora, ou Ancorado, falha com um aviso na tela e nada é gasto; só passa a Habilidade de nível maior que o da Âncora. O nível da Condição é o da Habilidade que ancorou.", "spaceManipulation", ["space"]],
  ["interdiction", "Naves", "Interdição", "Um Módulo tecnológico de Nave com alcance de interdição: ligado, com energia e inteiro, impede o salto FTL das Naves que estão dentro desse alcance (a ficha da Nave mostra \"INTERDITADO\"). Usa a mesma conta da Âncora, mas é tecnologia, não magia: o PEM derruba o Módulo e a interdição junto. O sistema não tem uma ação de salto FTL; quem a criar deve perguntar à Interdição antes de gastar.", "spaceManipulation", ["anchor"]],
  ["duel", "Habilidades", "Duelo na bolha", "O exemplo de Habilidade Única, Ativa e Combinada: desligada, a pessoa fica fraca e seus golpes põem a Marca do Duelo; com o marcado por perto, liga uma bolha em volta de si que prende os dois e segura quem tenta entrar (apanha pouco de fora e muito de dentro), empurra quem estava junto, dá um buff grande em quem usou e enfraquece a magia do adversário. Desliga se o alvo cai, se a bolha é destruída ou, conforme a regra, se alguém entra nela.", "", ["combined", "magicDampen", "mark"]],
  ["scale", "Combate e dano", "Escala", "Tamanho de quem luta (pessoa, veículo, nave). Atacar um degrau acima tira muito menos; um abaixo, muito mais.", "scale", []],
  ["structure", "Combate e dano", "Estrutura", "Parede ou barreira erguida por uma Habilidade. Bloqueia passagem e apanha os golpes que a atravessam.", "structures", []],
  ["antimagic", "Combate e dano", "Antimagia", "Acaba com o que é mágico: efeitos, Escudos, Habilidades Ativas e Estruturas. Um campo (ou Selo) de Antimagia: a magia que vem de fora e o atravessa gasta {E} e some, se ele vencer; de dentro do campo, ou sob Selo, a magia nem sai e não gasta nada. A Manipulação de {E} enfraquece o campo contra quem a tem. O campo acaba com a magia que já estava dentro.", "", ["manipulation"]],
  ["manipulation", "Combate e dano", "Manipulação de {E}", "Habilidade de base de toda magia. Contra a Antimagia: sem ela, a magia de quem usa some no campo; com ela, quanto maior o nível diante do campo, menos o campo atrapalha — primeiro a magia passa pagando {E} a mais, depois passa de graça. Usá-la contra a Antimagia a faz evoluir.", "", ["antimagic"]],
  ["emp", "Combate e dano", "PEM", "O espelho da Antimagia para a tecnologia: acaba com o que é tecnológico (efeitos, Escudos, Habilidades Ativas, Estruturas), suprime itens, implantes e próteses Tecnológicos, desliga corpo mecânico e derruba Módulos de Nave. Num campo (ou Selo) de interferência o uso tecnológico que vem de fora gasta e some (a arma gasta o disparo), e de dentro nem sai — não há Habilidade que o vença.", "interference", ["antimagic", "nature"]],
  ["nature", "Combate e dano", "Mágico e Tecnológico", "Toda coisa pode ser Mágica, Tecnológica, as duas (tecnomágica: sai mais forte, mas sofre Antimagia e PEM) ou nenhuma (analógica: imune aos dois). A Antimagia pega o mágico; o PEM, o tecnológico. Um Escudo só mágico protege do PEM; um só tecnológico protege da Antimagia.", "", ["antimagic", "emp"]],
  ["range", "Combate e dano", "Alcance", "Até onde uma Habilidade, arma ou granada chega, em metros, do seu Token ao do alvo (0 = sem limite). Fora dele o uso é recusado — a não ser pela Marca. Uma Habilidade de área pode sair de você ou ser posta livre, dentro do alcance.", "skillRange", ["mark"]],
  ["weaponType", "Combate e dano", "Tipo de arma", "A família de uma arma (Lâminas, Armas de Fogo, Energia, Desarmado…). A lista pode ser simples (só grupos) ou detalhada (com subtipos como Espadas e Adagas). O tipo diz qual Maestria vale para o ataque.", "weaponMastery", ["weaponMastery", "unarmedAttack"]],
  ["weaponMastery", "Combate e dano", "Maestria", "Habilidade passiva de um tipo de arma: dá mais dano com as armas dele, um pouco por nível, até um nível máximo; depois, só a Evolução leva mais longe. A Maestria de um grupo vale para todos os subtipos; a de um subtipo, só para ele (e rende mais por nível). Só a melhor que cobre o ataque conta. Cresce com os seus golpes, ou o Mestre a concede depois de muita prática.", "weaponMastery", ["weaponType", "unarmedAttack"]],
  ["unarmedAttack", "Combate e dano", "Ataque desarmado", "Um golpe sempre disponível, sem arma: dano baixo que escala pelo seu atributo (padrão Força). Itens que reforçam o desarmado (soco-inglês) somam o dano deles; uma arte marcial pode contá-lo como outro tipo. Conta como o tipo Desarmado para a Maestria.", "", ["weaponMastery"]],
  ["mark", "Combate e dano", "Marca", "Efeito mágico que você põe em alguém. Com ele você lança Habilidades como se estivesse onde o Marcado está (alvo, área e paredes no caminho contam a partir dele), pagando o custo vezes (distância ÷ alcance) ao quadrado. Só quem marcou usa a Marca; a Antimagia a desfaz. Além dela, qualquer Condição do catálogo marcada como \"É uma marca\" conta como marca: uma Habilidade pode exigir \"o alvo tem qualquer marca\", \"qualquer marca posta por mim\" ou \"a Condição X posta por mim\" (no \"Só se…\" ou no \"Quando → Então\"), e um golpe pode pôr a marca ao acertar.", "skillRange", ["range", "antimagic", "onHit", "onlyIf"]],
  ["push", "Combate e dano", "Empurrar e puxar", "Uma Habilidade ou arma de gravidade move o alvo em linha reta, para longe de quem usou (ou do centro da área) ou na direção dele. Defesa Mágica, Resistência do elemento e Traços imunes diminuem os metros; o alvo rola Defesa contra quem empurra e, se vencer, anda só metade. O movimento para na primeira parede ou Estrutura, e o que sobrou vira dano de impacto Contundente (a Estrutura também o leva). Não gasta o Deslocamento do alvo.", "forcedMovement", ["fall", "structure"]],
  ["flight", "Combate e dano", "Voo e Escavação", "Quem tem o Traço Voador (ou o efeito Voando) sobe e desce pelo Token HUD; quem cava (Traço Escavador ou efeito Escavando) desce abaixo de 0. A altura entra nas distâncias, as áreas viram esferas e quem está debaixo da terra não é alcançado por quem está em cima.", "elevation", ["fall", "push"]],
  ["senseTremor", "Combate e dano", "Sentido sísmico", "Sente, pelo chão, quem está por perto — até debaixo da terra. Não pega quem está voando. Dado por uma Habilidade ou pela Espécie, com um alcance em metros.", "senses", ["senseAll", "flight"]],
  ["senseInvisible", "Combate e dano", "Ver o invisível", "Enxerga quem está Invisível, dentro do alcance em metros. Não revela quem está debaixo da terra.", "senses", ["invisible", "senseTrue"]],
  ["senseTrue", "Combate e dano", "Visão verdadeira", "Enxerga o invisível e o que a visão comum não pega, dentro do alcance em metros. Ainda não vê quem está debaixo da terra.", "senses", ["invisible", "senseInvisible"]],
  ["senseAll", "Combate e dano", "Sentir tudo", "Percebe qualquer um dentro do alcance, mesmo atrás de paredes, invisível ou debaixo da terra.", "senses", ["senseTremor"]],
  ["invisible", "Combate e dano", "Invisível", "Quem está Invisível não é visto por ninguém sem Ver o invisível, Visão verdadeira ou Sentir tudo. Some do mapa e da lista de iniciativa dos jogadores. Debaixo da terra vale o mesmo, mas só o Sentido sísmico e o Sentir tudo percebem.", "senses", ["senseInvisible", "senseTremor"]],
  ["fall", "Combate e dano", "Queda", "Quem perde o voo no ar cai: o Mestre recebe um aviso e calcula o dano (cada metro acima de 3 m vale uma parte da Vida máxima, Contundente). Quem perde a escavação debaixo da terra fica soterrado.", "elevation", ["flight"]],
  ["condition", "Combate e dano", "Condição", "Um estado com ícone no Token (Veneno, Cegueira, Medo…). Cada uma tem o próprio verbete.", "statusConditions", ["tick"]],
  ["tick", "Combate e dano", "Tick", "Cada vez que um efeito contínuo (veneno, cura) age, normalmente no começo do seu turno.", "", []],
  ["fallen", "Combate e dano", "Caído e Inconsciente", "Em 0 de Vida você cai: não age e um contador de morte corre. Curado, fica Inconsciente algumas rodadas.", "incapacitation", ["life"]],
  ["form", "Combate e dano", "Forma", "Uma Habilidade Ativa de Forma transforma o personagem: ele joga com uma ficha temporária (atributos, Vida, Espécie, partes do corpo, armas naturais, imagem e tamanho da forma). Nível, XP, Mana, Títulos e as Habilidades dele vão junto; os itens não. A forma tem Vida própria: em 0 o personagem volta e o dano que sobrou passa para ele. Desligar a Habilidade, ficar sem Mana ou sofrer Antimagia também desfazem. A Mana gasta não volta; o XP ganho e as Condições voltam.", "forms", ["energy"]],
  ["naming", "Corpo e origem", "Nomeação", "Dar um nome a uma criatura (Nomear, no menu do Token). Quem nomeia perde {E} máxima para sempre (a soma dos atributos da criatura × um fator); a criatura ganha ficha própria, a Herança Nomeado e XP nas Habilidades (que podem subir vários níveis). O que não cabe fica guardado para Evoluir uma Habilidade. Se a {E} máxima não chega, a Nomeação falha: a {E} vai a 0 e quem nomeava desmaia. O jogador pede, o Mestre aprova.", "naming", ["energy", "soulrunner", "heritage"]],
  ["soulrunner", "Corpo e origem", "Corredor de alma", "O vínculo entre quem nomeou e o nomeado. O nomeado pode usar as Habilidades de quem o nomeou (de uso na hora), pagando com a própria {E}, no nível de quem nomeou; o XP de uso vai para quem nomeou, e quem nomeou pode parar de aceitar pedidos. Em troca, quem nomeou recebe uma parte de todo XP que o nomeado ganhar. Só o Mestre corta o vínculo.", "naming", ["naming", "energy", "pact"]],
  ["pact", "Corpo e origem", "Pacto", "Um vínculo mais fraco, criado pelo Mestre: o bruxo usa, com a própria {E}, as Habilidades que o patrono libera, no nível dele; alcance, Antimagia e Supressão contam do bruxo e o XP de uso vai para o patrono. Nada de XP compartilhado nem Evolução. O patrono, o bruxo ou o Mestre cortam o Pacto, e o patrono pode parar de aceitar pedidos.", "pact", ["soulrunner", "energy"]],
  ["analysis", "Combate e dano", "Análise", "Uma Habilidade de Análise revela a ficha de um alvo. A margem = nível da Habilidade − (nível do alvo + a Ocultação dele) + a diferença entre a sua Percepção e a Furtividade dele (a cada 10 pontos, 1). Uma Análise mágica perde nível pela Defesa Mágica do alvo; a tecnológica não. Quanto maior a margem, mais o card mostra (só para quem analisou e o Mestre): Espécie, Traços e elementos; Vida, {E} e Condições; Resistências, Imunidades e fraquezas; as Habilidades; a frase de cada uma e os atributos. Margem negativa: o alvo resistiu e nada aparece.", "analysis", ["concealment", "energy"]],
  ["concealment", "Combate e dano", "Ocultação", "Habilidade de base passiva (não se usa): o nível dela soma ao nível do alvo contra a Análise, dificultando que revelem a sua ficha.", "analysis", ["analysis"]],
  ["predation", "Combate e dano", "Predação", "Uma Habilidade de Predação, usada num alvo derrotado (morto, Caído ou Inconsciente), rola um d100 por Habilidade dele: a chance é 50% no mesmo Tier e no mesmo nível, mais 25% por Tier da Predação acima do da Habilidade (menos 25% por Tier abaixo) e menos alguns pontos por nível que a Habilidade está acima da Predação (mais, se estiver abaixo). O Mestre confirma: as ganhas entram inteiras, no nível 1 (Racial vira Normal); na 1ª, 5ª, 10ª, 20ª, 40ª… criatura da mesma Espécie uma parte dos atributos dela vira pontos permanentes; quem tem uma Habilidade de Forma pode ganhar a forma do corpo; e o corpo some. Não se absorve o que veio de Item, Habilidade de base, Maestria, Forma nem o que você já tem.", "predation", ["form", "analysis"]],
  ["sleeping", "Combate e dano", "Dormindo e Descanso", "Descansar fora de combate faz o personagem dormir até o tempo passar (o Mestre controla o relógio): acorda com o descanso feito. Levar dano acorda sem ele. Quando todos dormem, o Mestre pula o tempo e todos acordam. A hora do dia você só vê no PAD e em itens que marcam o tempo.", "worldClock", ["fallen"]],
  ["calendar", "Corpo e origem", "Calendário", "O calendário do mundo: meses, dias da semana, horas por dia e eras (o Mestre edita). Dá o nome às datas, como \"14 de Florescer de 1203\". Quem escreve a data é a linha do tempo da cena.", "calendar", ["timeline", "personalTime"]],
  ["timeline", "Corpo e origem", "Linha do tempo", "A época e a velocidade do tempo de um grupo de cenas. A linha principal é a de sempre; uma cena numa linha do passado fica 500 anos atrás, e uma linha lenta (nave em dobra) passa devagar em relação ao resto. Várias cenas dividem a mesma linha.", "calendar", ["calendar", "personalTime"]],
  ["shop", "Ficha e rolagem", "Loja", "Uma ficha do Mestre que vende: o estoque são os Itens dela. O preço é o preço geral do Item × o multiplicador da loja × um sorteio que cada loja faz (de −25% a +25%, o Mestre escolhe o teto) e que só muda quando a loja reabastece. Comprar sai na hora, em qualquer moeda, convertida; o Mestre confere tudo e pode desfazer a última venda.", "shops", ["shopBuyback", "shopAppraisal"]],
  ["shopBuyback", "Ficha e rolagem", "Compra de volta", "Num ponto automático (máquina, balcão, internet) vender paga uma fração do preço geral do item (padrão 50%). Consumível com cargas vale pelo que resta e arma carregada é descarregada antes. Item equipado e contêiner com coisas dentro não se vendem.", "shops", ["shop", "shopAppraisal"]],
  ["shopAppraisal", "Ficha e rolagem", "Avaliação", "Vender a um vendedor NPC: você marca os itens e pede a avaliação; o Mestre vê o preço padrão de cada um, faz uma oferta e os dois confirmam. Se ele mudar o valor depois, o seu aceite cai e você vê o novo.", "shops", ["shop", "shopBuyback"]],
  ["shopShow", "Ficha e rolagem", "Mostrar a loja", "O Mestre escolhe quem vê cada loja (todos ou alguns jogadores), como o Mostrar dos Diários: quem foi escolhido recebe a Vitrine na hora, um aviso com \"Abrir loja\" no chat e pode clicar no Token da loja. Ninguém ganha permissão na ficha. Uma máquina de venda abre para qualquer um que clique nela a até 2 m.", "shops", ["shop", "vendingMachine"]],
  ["vendingMachine", "Ficha e rolagem", "Máquina de venda", "Um ponto automático com cara de máquina: prateleiras de 16 produtos, cada um com um código (A03). Você aperta a letra e os dois números, vê o preço no visor e compra; o produto cai na gaveta e você pega. Não compra de volta.", "shops", ["shop", "shopShow"]],
  ["playerTrade", "Ficha e rolagem", "Troca entre jogadores", "Dois jogadores a até 2 m um do outro montam, cada um do seu lado, itens e moedas, e os dois aceitam. Qualquer mudança depois de um aceite apaga os dois. Aceitando, tudo troca de dono de uma vez; o Mestre pode desfazer a última troca. Abre pelo \"Trocar com…\" no cabeçalho da ficha.", "shops", ["shop", "loot"]],
  ["shopOnline", "Ficha e rolagem", "Compras online (PAD)", "O app Compras do PAD lista as lojas que o Mestre marcou como online. Precisa de rede (cena \"tem rede\") e de energia no aparelho: sem rede ou sob PEM aparece \"Sem conexão\". Você monta um carrinho com itens de várias lojas e paga em qualquer moeda. Software chega na hora direto no inventário; o resto vai para o depósito do lugar onde você está (ou para o porão da sua nave, se ela estiver atracada ali), no prazo da loja. Sem depósito na cena: \"sem endereço de entrega aqui\". A aba Entregas mostra o que está a caminho e onde retirar.", "shops", ["shop", "loot"]],
  ["loot", "Ficha e rolagem", "Saque, pilha e depósito", "Perto de um corpo caído (NPC em Vida 0 ou morto) qualquer jogador abre o saque e pega itens e moedas. Largar um item da ficha no mapa cria uma pilha que qualquer um perto pega, e que some quando esvazia. O depósito de entregas guarda o que você comprou online: você só vê o que é seu. \"Perto\" é até 2 m, configurável pelo Mestre.", "shops", ["shop", "playerTrade"]],
  ["sceneFolder", "Corpo e origem", "Pasta de cenas", "Uma pasta do Diretório de Cenas que guarda o Ambiente e o tempo das cenas dela (linha do tempo, rede, escuridão pelo relógio, mana, radiação, perigos). Cada cena herda da pasta, ou da pasta de cima; quem edita uma cena fica com valor próprio e pode voltar a herdar. Mover a cena de pasta muda o que ela herda.", "sceneFolders", ["timeline", "manaDensity"]],
  ["personalTime", "Corpo e origem", "Tempo pessoal", "O tempo que o personagem viveu. Ele conta o sono e o descanso. O PAD mostra a data que o personagem acha que é: depois de uma porta no tempo ele só atualiza com o pedido Atualizar, que o Mestre aprova (ou onde há rede).", "calendar", ["calendar", "sleeping", "timeChamber"]],
  ["timeChamber", "Corpo e origem", "Câmara do tempo", "Uma sala do mapa (uma Região com o comportamento \"Ritmo do tempo\") em que o tempo corre diferente: quem está lá dentro vive no ritmo dela, e uma hora ali pode ser anos lá fora (ou o contrário). A data e a escuridão da cena continuam as de sempre; o que muda é o tempo pessoal de quem está dentro. Numa luta lá dentro, o mundo para ou anda no fim, como numa linha do tempo; se os combatentes estão em ritmos diferentes, vale o da maioria. A idade na ficha (se preenchida) sobe com o tempo pessoal: quem passa uma hora numa câmara lenta quase não envelhece.", "calendar", ["timeline", "personalTime"]],
  ["apply", "Combate e dano", "Aplicar", "O dano aparece no chat e só sai da Vida quando o Mestre clica Aplicar (ele pode desfazer).", "", []],
  ["species", "Corpo e origem", "Espécie", "O que você é (Humano, Elfo, Androide…). Dá corpo, Traços e Skills Raciais; a Linhagem é o tipo dentro dela.", "", ["heritage", "trait"]],
  ["heritage", "Corpo e origem", "Herança", "Algo que aconteceu com você (Vampirizado, Ciborgue…). Só o Mestre dá.", "", ["species"]],
  ["trait", "Corpo e origem", "Traço", "Uma marca da criatura (Orgânico, Mecânico, Voador…) que algumas regras leem.", "", []],
  ["bodyPart", "Corpo e origem", "Parte do corpo", "Cabeça, braços, cauda… cada uma com Vida própria.", "anatomy", ["implant"]],
  ["implant", "Corpo e origem", "Prótese e Implante", "Peça instalada numa Parte do corpo. A prótese substitui a parte; o implante soma a ela.", "anatomy", []],
  ["healKinds", "Corpo e origem", "Cura, Regeneração e Reparo", "Cura fecha feridas; Regeneração também refaz partes perdidas; Reparo conserta próteses.", "bodyPartInjury", []],
  ["manaDensity", "Corpo e origem", "Densidade de mana", "A mana do lugar: 1 é normal, mais que isso reforça a magia, 0 é nada. Lançar não depende dela (você usa a sua própria Mana), mas uma Habilidade Ativa mágica não se sustenta onde é 0.", "environment", []],
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
