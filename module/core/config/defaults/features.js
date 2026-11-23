/**
 * Blocos de Módulos do Sistema (FEATURES) e presets de campanha.
 * Dados puros, referenciados por NIHILITY (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

/**
 * Blocos do sistema que o Mestre liga/desliga por mundo — a espinha da modularidade: o mesmo
 * sistema roda uma campanha de Fantasia Medieval, uma de Sci-Fi ou uma mistura das duas, e o
 * que a campanha não usa simplesmente some da interface.
 *
 * **Regra que nunca pode ser quebrada: desligar um bloco só ESCONDE a UI (e impede criar
 * conteúdo novo daquele tipo) — nunca apaga nem migra dado já existente.** Religar tem que
 * devolver o mundo exatamente como estava; é isso que torna seguro trocar de preset no meio
 * de uma campanha, ou usar o mesmo mundo pra duas mesas diferentes.
 *
 * Cada entrada: `setting` (chave de storage — as pré-existentes mantêm o nome antigo pra não
 * perder configuração de quem já atualizou), `name`/`hint` (mostrados na tela de Settings e no
 * editor visual), `default` e, opcionalmente, `parent` (a sub-feature só vale se o pai estiver
 * ligado — ver `isFeatureEnabled`, que sobe a cadeia inteira).
 *
 * Pra adicionar um bloco novo: acrescente UMA linha aqui e use `isFeatureEnabled("chave")`
 * onde for gatear. O registro da setting, a tela de configuração e os presets abaixo já varrem
 * esta tabela sozinhos — não existe lista paralela pra manter em sincronia.
 */
export const FEATURES = {
  economy: {
    setting: "economyEnabled",
    name: "Economia / Moedas",
    hint: "Rastreamento de moedas nas fichas, conversão e transferência entre Personagens.",
    default: true
  },
  titles: {
    setting: "titlesEnabled",
    name: "Títulos",
    hint: "Títulos com bônus permanentes de Atributo/HP/Mana e Resistências.",
    default: true
  },
  anatomy: {
    setting: "anatomyEnabled",
    name: "Anatomia / Modificação Corporal",
    hint: "Partes do Corpo com Vida própria, presets por Espécie e próteses/modificações.",
    default: true
  },
  vessels: {
    setting: "vesselsEnabled",
    name: "Naves e Veículos",
    hint: "Naves Espaciais e Veículos Terrestres: Porte, Módulos, Grid de Energia, cascata de dano e reparo. Desligado, nenhuma Nave/Veículo NOVO pode ser criado — as que já existem continuam intactas e abríveis.",
    default: true
  },
  skillFusion: {
    setting: "skillFusionEnabled",
    name: "Fusão de Habilidades",
    hint: "Fundir 2+ Habilidades numa só (com Sub-Skills disparáveis). Desligar esconde a seleção e o botão de Fundir; Evolução (1-pra-1) continua disponível.",
    default: true
  },
  skillPoints: {
    setting: "skillPointsEnabled",
    name: "Pontos de Habilidade",
    hint: "Economia de Pontos de Habilidade: quebra/fusão de pontos, pedido de criação com aprovação do Mestre e ganho automático por nível.",
    default: true
  },
  attributePool: {
    setting: "attributePoolEnabled",
    name: "Pool de Pontos de Atributo",
    hint: "Orçamento de pontos por nível com alocação em duas etapas (pendente → Confirmar). Desligado, os Atributos viram campos de digitação livre.",
    default: true
  },
  resistances: {
    setting: "resistancesEnabled",
    name: "Resistências / Imunidades",
    hint: "Habilidades e Títulos que reduzem dano por tipo (Geral ou Elemental).",
    default: true
  },
  statusConditions: {
    setting: "statusConditionsEnabled",
    name: "Condições de Status",
    hint: "Condições nomeadas (Veneno, Cegueira, Atordoamento...) com ícone no token, em Efeitos de Habilidade.",
    default: true
  },
  areaEffects: {
    setting: "areaEffectsEnabled",
    name: "Habilidades de Emissão (área)",
    hint: "Habilidades que posicionam uma forma no canvas (Círculo/Cone/Linha) em vez de escolher um alvo único.",
    default: true
  },
  aiAssistant: {
    setting: "aiAssistantEnabled",
    name: "Assistente de IA",
    hint: "Geração e edição de conteúdo via IA (só Mestre). Desligado, somem as abas de IA e Geração do Menu Principal.",
    default: true
  },
  pad: {
    setting: "padEnabled",
    name: "PAD — Aplicativo do Personagem",
    hint: "Chave-mestra do PAD (app estilo smartphone). Desligada, nenhuma das sub-funcionalidades abaixo aparece, mesmo que estejam ativas.",
    default: true
  },
  padShip: {
    setting: "padShipEnabled",
    parent: "pad",
    name: "PAD — Conexão com a Nave",
    hint: "Tela de Status da Nave/Veículo tripulada e gestão de Tripulação no PAD.",
    default: true
  },
  padLibrary: {
    setting: "padLibraryEnabled",
    parent: "pad",
    name: "PAD — Biblioteca",
    hint: "Tela de Biblioteca (favoritos pessoais e da Nave) no PAD.",
    default: true
  },
  padMessaging: {
    setting: "padMessagingEnabled",
    parent: "pad",
    name: "PAD — Mensagens",
    hint: "Troca de mensagens privadas (diretas e em grupo) entre Personagens no PAD.",
    default: true
  },
  naturalRegen: {
    setting: "naturalRegenEnabled",
    name: "Regeneração natural de energia",
    hint: "Em combate, no início do turno de cada Personagem, a energia (Mana, Ki…) volta um % da máxima. Fora de combate, quem devolve é o Descanso. Passivos de Skill, Título, Item e Espécie somam por cima — e valem mesmo com este bloco desligado.",
    // Desligado por padrão: mundos que já existem não ganham uma regra nova só por atualizar.
    default: false,
    options: {
      naturalEnergyRegenPercent: { label: "% da energia máxima por rodada", hint: "Mana 240 com 5% = +12 por rodada.", type: "number", default: 5, min: 0 }
    }
  },
  speciesEvolution: {
    setting: "speciesEvolutionEnabled",
    name: "Evolução de Espécie",
    hint: "Espécies podem declarar para onde evoluem (estilo Tensura). O Mestre ganha o botão \"Evoluir…\" na aba Origem; a evolução passa pela prévia e preserva nível, próteses e Heranças.",
    default: true
  },
  bodyPartInjury: {
    setting: "bodyPartInjuryEnabled",
    name: "Ferimentos por parte",
    hint: "As Funções das Partes do Corpo passam a ter efeito: parte destruída aplica a Condição da Função (Cego, Sem mão…), locomoção reduz o Deslocamento, prótese repõe a Função e implantes arrastados só encaixam no slot certo.",
    parent: "anatomy",
    // Desligado por padrão: muda o que acontece com quem leva dano numa parte.
    default: false,
    options: {
      partLossOverflow: {
        label: "Sobra que deixa a parte Perdida (%)",
        hint: "Golpe que passa do 0 com esta sobra (em % da Vida da parte) ou mais arranca a parte: só Regeneração a traz de volta. 0 = nunca por sobra (só pelo efeito Decepar ou pelo Mestre).",
        type: "number",
        default: 50,
        min: 0
      },
      aimBodyPart: {
        label: "Perguntar \"Mirar numa parte?\"",
        hint: "Ao atacar um Personagem com alvo único, quem ataca pode escolher a parte. Sem mirar (ou desligado), o dano cai numa parte sorteada, com chance proporcional ao tamanho dela.",
        type: "boolean",
        default: true
      }
    }
  },
  movement: {
    setting: "movementEnabled",
    name: "Deslocamento por rodada",
    hint: "Em combate, o token só anda até o deslocamento do turno (base + Destreza). O que passa do limite aparece pontilhado na régua e o token para no último ponto que alcança. Fora de combate o movimento é livre.",
    // Desligado por padrão: ligar muda o comportamento dos tokens em combate, e mundos que já
    // existem não devem ganhar uma regra nova só por atualizar o sistema.
    default: false,
    // Campos numéricos/booleanos que moram sob o interruptor na tela "Módulos do Sistema".
    // A chave de cada um é também o nome da setting (world, config:false).
    options: {
      movementBase: { label: "Base (m)", hint: "Metros por rodada com Destreza 0.", type: "number", default: 6, min: 0 },
      movementStep: { label: "Passo de Destreza", hint: "Pontos de Destreza para ganhar +1 m.", type: "number", default: 10, min: 1 },
      movementCap: { label: "Teto (m)", hint: "Máximo alcançável só com Destreza permanente (pontos e Títulos). Destreza vinda de Skills passa por cima.", type: "number", default: 18, min: 0 },
      movementGmIgnores: { label: "Mestre ignora o limite", hint: "O Mestre move tokens sem gastar nem respeitar o deslocamento.", type: "boolean", default: true }
    }
  },
  environment: {
    setting: "environmentEnabled",
    name: "Ambiente da cena e densidade de mana",
    hint: "Perigos de ambiente (vácuo, radiação, gravidade alta…): Condições que a cena inteira ou uma área desenhada (Region com o comportamento 'Ambiente (Nihility)') mantém em quem está lá, com Traços que imunizam e, na cena, visual opcional do FXMaster. E a densidade de mana do lugar, que multiplica a potência das Skills mágicas e a regeneração de Mana (0 = magia não funciona ali).",
    default: true
  },
  radiation: {
    setting: "radiationEnabled",
    parent: "environment",
    name: "Radiação",
    hint: "Cena, área (Region) ou Token emitindo têm um nível de radiação. Quem fica lá vai sendo irradiado (sobe até o nível do lugar, mais rápido em fonte forte) e leva dano por rodada proporcional à irradiação; fora, a irradiação e o dano caem. Fora de combate o Mestre usa 'Passar tempo' na janela Ambiente da Cena.",
    default: true,
    options: {
      radiationGainPercent: { label: "Sobe por rodada (% do nível do lugar)", hint: "Fonte 100 com 20% irradia +20 por rodada até 100.", type: "number", default: 20, min: 1 },
      radiationDecayPercent: { label: "Cai por rodada fora (% da irradiação)", hint: "Irradiação 100 com 10% cai para 90, 81… até zerar (mínimo 1 por rodada).", type: "number", default: 10, min: 1 },
      radiationDamagePerLevel: { label: "Dano por nível de irradiação", hint: "Dano por rodada = irradiação × este número (antes da Resistência a Radiação).", type: "number", default: 1, min: 0 }
    }
  },
  endOfCombat: {
    setting: "endOfCombatEnabled",
    name: "Fim do combate",
    hint: "Ao encerrar o combate, abre uma janela para o Mestre: remover os efeitos com prazo em rodadas que ficariam congelados, distribuir a XP do combate (sugestão pelos NPCs derrotados, dividida entre os PJs) e dar Descanso curto. \"Pular\" fecha sem fazer nada.",
    default: true,
    options: {
      combatXpPercent: { label: "XP sugerida por derrotado (% do nível dele)", hint: "Com 25% e a fórmula padrão (100 × nível), um NPC de nível 4 vale 100 XP. Só sugestão: o Mestre edita.", type: "number", default: 25, min: 0 }
    }
  },
  skillAssist: {
    setting: "skillAssistEnabled",
    name: "Editor de Skill assistido",
    hint: "Na ficha e no editor rápido de Skill: avisos do que não faz nada (Periódico em Força, área de tamanho 0, Escudo mantido sem ser Ativa…) e um Custo sugerido ao lado do Custo, calculado pelo que a Skill faz. Só sugere e avisa: nunca impede de salvar nem muda o Custo. Os Modelos de Skill da \"+ Nova Habilidade\" funcionam sempre.",
    default: true
  },
  creationMode: {
    setting: "creationModeEnabled",
    name: "Ficha em modo criação",
    hint: "O jogador cria o personagem na própria ficha: \"+ Criar personagem\" no Menu › Fichas (o Mestre conectado cria a ficha em branco), uma faixa \"Criando\" diz o que falta (Conceito, Origem, Pontos, Skills) e \"Pronto para jogar\" avisa o Mestre na tela, que libera (confirma os pontos, trava a Espécie, aprova os pedidos de Skill) ou pede ajuste. O Mestre põe qualquer ficha nesse modo pelo menu ⋮ dela. O pedido de Skill com mecânica vale com o bloco desligado também.",
    default: true
  },
  encounterSim: {
    setting: "encounterSimEnabled",
    name: "Simulador de encontro",
    hint: "Ferramenta do Mestre: grupo contra oponentes, quantos golpes médios cada um aguenta do outro (com Escala, Defesa Mágica, Resistências, Escudo, elementos e Nível de NPC) e se a luta está fácil, justa, perigosa ou mortal. Abre pelo Menu › Ferramentas, pelo botão Simular do rastreador de combate e pelo Gerador de NPC. Não rola nada nem muda ficha nenhuma.",
    default: true
  },
  npcGenerator: {
    setting: "npcGeneratorEnabled",
    name: "Gerador de NPC",
    hint: "Botão \"Gerar NPC…\" (Menu › Fichas, só o Mestre): escolhe um arquétipo (Ladrão, Engenheiro, Civil…), nível e quantidade e gera fichas com os pontos de um PJ daquele nível, Skills e equipamento sorteados da lista do arquétipo. Os arquétipos ficam em Configurações Gerais › Personagem.",
    default: true
  },
  npcTiers: {
    setting: "npcTiersEnabled",
    name: "Níveis de NPC (Lacaio, Elite, Chefe)",
    hint: "Campo só do Mestre na ficha de NPC. Lacaio: Vida 1 (cai com qualquer dano que passe pelas defesas). Elite e Chefe: a Vida máxima multiplica. Normal: como sempre. Desligado, todos contam como Normal e o nível salvo fica guardado.",
    default: true,
    options: {
      npcEliteHp: { label: "Vida do Elite (×)", hint: "Multiplica a Vida máxima da fórmula.", type: "number", default: 2, min: 1 },
      npcBossHp: { label: "Vida do Chefe (×)", hint: "Multiplica a Vida máxima da fórmula.", type: "number", default: 4, min: 1 },
      npcEliteSkills: { label: "Skills a mais no Elite (gerador)", hint: "Sorteadas a mais da lista do arquétipo.", type: "number", default: 1, min: 0 },
      npcBossSkills: { label: "Skills a mais no Chefe (gerador)", hint: "Sorteadas a mais da lista do arquétipo.", type: "number", default: 2, min: 0 }
    }
  },
  skillRange: {
    setting: "skillRangeEnabled",
    name: "Alcance de Skill e Marcas",
    hint: "Skills, armas e granadas ganham alcance em metros (0 = sem limite): fora dele o uso é recusado. Uma Marca (efeito \"Marcar\") deixa lançar a partir do Marcado, pagando o custo × (distância ÷ alcance)². Formas de área podem sair de quem lança ou ser postas livres. Sem mapa ou sem Token, nada é conferido. Desligar só esconde os campos e para de conferir; nada salvo se perde.",
    default: true,
    options: {
      throwPerStrength: { label: "Força por metro de arremesso", hint: "Granadas e itens arremessáveis: alcance = base + ⌊Força ÷ este valor⌋ metros.", type: "number", default: 5, min: 1 }
    }
  },
  forcedMovement: {
    setting: "forcedMovementEnabled",
    name: "Empurrar e puxar",
    hint: "O efeito de Skill \"Empurrar/Puxar\" e a arma de gravidade movem o Token do alvo em linha reta, a partir de quem usou (ou do centro da área). O movimento para na primeira parede ou Estrutura; o que sobrou vira dano de impacto (Contundente) e a Estrutura também o leva. Não gasta o Deslocamento do alvo. Desligar só para de mover e esconde os campos; nada salvo se perde.",
    default: true,
    options: {
      collisionPercent: { label: "Dano de impacto (% da Vida máx. por metro)", hint: "Metros que sobraram ao bater × este % da Vida máxima de quem bateu, como dano Contundente.", type: "number", default: 5, min: 0 }
    }
  },
  weaponMastery: {
    setting: "weaponMasteryEnabled",
    name: "Tipos de arma e Maestria",
    hint: "Toda arma pode ter um Tipo (Lâminas, Armas de Fogo, Energia…). Uma Skill de Maestria de um tipo dá +% de dano com as armas daquele tipo (e um 🎲 de ataque que soma o nível dela), sobe com o uso (XP) e, depois do nível máximo, só por Evolução. Depois de N ataques com um tipo sem Maestria, o Mestre recebe a sugestão de dar uma. O ataque desarmado continua existindo com o recurso desligado, só sem Maestria. Desligar só esconde os campos e para o bônus, a XP e a sugestão; nada salvo se perde.",
    default: true,
    options: {
      weaponTypesDetailed: { label: "Lista detalhada de tipos (com subtipos)", hint: "Desligado: só os grupos (Lâminas, Contundentes…); todo subtipo vale como o grupo dele. Ligado: Lâminas › Espadas, Adagas… Trocar nunca apaga o que está salvo.", type: "boolean", default: false },
      masteryPercentPerLevel: { label: "Maestria — % de dano por nível", hint: "Maestria de um grupo (ou da lista simples): este % por nível.", type: "number", default: 5, min: 0 },
      masterySubtypeFactor: { label: "Maestria de subtipo — multiplicador", hint: "Só na lista detalhada: a Maestria de um subtipo vale este múltiplo do % por nível (1,5 = 7,5% por nível), mas só para aquele subtipo.", type: "number", default: 1.5, min: 0 },
      masteryMaxLevel: { label: "Maestria — nível máximo", hint: "Depois dele, só a Evolução dá mais.", type: "number", default: 10, min: 1 },
      masteryEvolvedPercent: { label: "Maestria evoluída — % de dano fixo", hint: "Sem níveis; num subtipo, também × o multiplicador de subtipo.", type: "number", default: 100, min: 0 },
      masteryXpShare: { label: "XP da Maestria — % da XP de uso de Skill", hint: "Cada ataque com a arma rende este % do que o mesmo dano renderia a uma Skill.", type: "number", default: 25, min: 0 },
      masteryLearnThreshold: { label: "Ataques até sugerir uma Maestria", hint: "Depois de tantos ataques com um tipo sem Maestria, o Mestre recebe um card com o botão \"Dar Maestria\". 0 = nunca sugere.", type: "number", default: 25, min: 0 }
    }
  },
  elevation: {
    setting: "elevationEnabled",
    name: "Voo, altura e escavação",
    hint: "A elevação do Token passa a valer: quem tem o Traço Voador ou o efeito \"Voando\" sobe e desce pelo Token HUD; quem cava (Traço Escavador ou efeito \"Escavando\") desce abaixo de 0. As distâncias somam a altura, as áreas viram esferas e quem está debaixo da terra fica protegido de quem está na superfície. Perder o voo no ar avisa o Mestre da queda e oferece calcular o dano. Desligar só esconde e para de conferir; nada salvo se perde.",
    default: true,
    options: {
      fallPercent: { label: "Dano de queda (% da Vida máx. por metro)", hint: "Cada metro de queda acima de 3 m vale este % da Vida máxima de quem caiu, como dano Contundente.", type: "number", default: 3, min: 0 }
    }
  },
  senses: {
    setting: "sensesEnabled",
    name: "Sentidos e visibilidade",
    hint: "Quem está debaixo da terra (elevação abaixo de 0) some do mapa para os outros e não enxerga: só o Sentido sísmico ou o Sentir tudo percebem. Skills e a Espécie podem dar Sentido sísmico, Ver o invisível, Visão verdadeira e Sentir tudo (valor = alcance em metros, 0 = sem limite); Condições podem marcar Invisível ou Cego no mapa. O seletor de alvo e a lista de iniciativa mostram aos jogadores só quem o personagem percebe. Só vale em cena com Visão de Token ligada e com a visão ativa nos Tokens (V14). Desligar só esconde e para de conferir; nada salvo se perde.",
    default: true
  },
  traps: {
    setting: "trapsEnabled",
    name: "Armadilhas",
    hint: "O Mestre desenha uma Região e acrescenta o comportamento \"Armadilha (Nihility)\": quem entra (andando, empurrado ou teleportado) leva dano com elementos (pelas defesas do alvo, com Aplicar no chat) e/ou uma Condição com o efeito padrão. Dispara uma vez ou toda vez, só em quem está no chão ou em qualquer altura, com Traços imunes. Armadilha mágica ou tecnológica é desarmada por um campo de Antimagia/Interferência ou por uma Antimagia/PEM em área. Desligar só deixa de disparar; nada salvo se perde.",
    default: true
  },
  luck: {
    setting: "luckEnabled",
    name: "Sorte e azar",
    hint: "Sorte é uma inclinação em % sobre as faces dos dados (sem teto: +100% leva o d20 a média 13,8; +300% dá 27% de tirar 20). Vem de efeitos de Skill (Sorte), Condições do catálogo, Títulos, passivos de Espécie/Linhagem/Herança e Traços (Sortudo, Azarado), e vale em até três escopos: atributos e iniciativa, dano de quem ataca e chances (d100: Condição ao acertar, Predação…; no Contágio a sorte da vítima a protege). Negativo é azar. Desligar só para de contar e esconde os campos; nada salvo se perde.",
    default: true,
    options: {
      luckCap: { label: "Teto da sorte (± %)", hint: "Limita a soma de cada escopo a ± este valor. 0 = sem teto.", type: "number", default: 0, min: 0 }
    }
  },
  reactions: {
    setting: "reactionsEnabled",
    name: "Reações elementais",
    hint: "Um golpe de um elemento contra alguém que carrega outro (uma Condição com \"Elemento do corpo\", como Molhado) reage: o dano da parte sobe ou cai, a marca é consumida, a reação pode espalhar para quem está perto, aplicar ou tirar uma Condição. A tabela fica em Tipos de Dano › Tabela de reações; o nome da reação sobe do Token ao Aplicar. O corpo da Espécie só conduz (não multiplica nem é consumido), Dano Absoluto não reage e Nave só sofre no Escudo. Desligar só para de reagir; nada salvo se perde.",
    default: true
  },
  surfaces: {
    setting: "surfacesEnabled",
    name: "Superfícies elementais",
    hint: "Um elemento pode deixar uma superfície no chão (poça de água, óleo, chamas, gelo): um círculo na cena, sem dono, que dura rodadas em combate e minutos de relógio do mundo fora dele. Quem pisa (andando, empurrado ou teleportado) e quem começa o turno em cima leva o dano e a Condição dela, a menos que esteja acima da altura que ela alcança ou tenha um Traço imune; e carrega o elemento dela para as Reações. Um golpe cujo alvo está na superfície reage com ela pela Tabela de reações (Fogo no óleo vira Chamas; Gelo apaga o fogo). A natureza (Matéria, Mágica, Da origem) diz se a Antimagia a desfaz. Cada elemento escolhe o que deixa no cartão dele (Tipos de Dano › Deixa no chão). Desligar só esconde e para de agir; nada salvo se perde.",
    default: false
  },
  forms: {
    setting: "formsEnabled",
    name: "Formas",
    hint: "Uma Habilidade Ativa de Forma dá ao personagem uma ficha temporária (a ficha-molde da forma) e ele passa a jogar com ela: atributos, Vida, Espécie e Traços, partes do corpo, Skills Raciais, armas naturais, imagem e tamanho vêm da forma; nível, XP, Mana, Títulos e as Skills dele vão junto. Itens equipados não vão. A forma tem Vida própria: em 0 o personagem volta e o dano que sobrou passa para ele. Ao voltar, a Mana gasta não volta; o XP ganho e as Condições voltam. O jogador pode pedir uma forma ao Mestre. Desligar esconde a Mecânica Forma e impede ligar; quem já está transformado continua até desligar; nada salvo se perde.",
    default: true
  },
  naming: {
    setting: "namingEnabled",
    name: "Nomeação e Corredor de alma",
    hint: "No Token HUD, \"Nomear\" dá um nome a uma criatura: quem nomeia perde Mana máxima para sempre (a soma dos atributos do nomeado × um fator), a criatura passa a ter ficha própria no Diretório e ganha a Herança \"Nomeado\", e a Mana perdida vira XP para as Skills dela (que podem subir vários níveis de uma vez; o que não cabe fica guardado para Evoluir uma Skill). Os dois ficam ligados pelo Corredor de alma: o nomeado usa as Skills de quem o nomeou com a Mana dele (o XP de uso vai para o dono; quem nomeou pode parar de aceitar pedidos), e quem nomeou recebe uma parte do XP que o nomeado ganhar. Se a Mana máxima não chega, a Nomeação falha: a Mana vai a 0 e quem nomeava cai Inconsciente. Jogador pede, o Mestre aprova. Desligar esconde o botão e bloqueia novas Nomeações e o uso emprestado; nada salvo se perde.",
    default: true
  },
  pact: {
    setting: "pactEnabled",
    name: "Pacto",
    hint: "O Mestre cria um Pacto entre um patrono e um bruxo: o patrono marca quais Skills libera, e o bruxo as usa com a própria Mana (no nível do patrono; alcance, Antimagia e Supressão contam do bruxo). Todo o XP de uso vai para o patrono. Qualquer um dos dois, ou o Mestre, corta o Pacto, e o patrono pode parar de aceitar pedidos. Passam só Skills de uso na hora (sem Ativa, Preparo, Resistência, Maestria nem Forma). Desligar esconde a seção e impede usar; nada salvo se perde.",
    default: true
  },
  analysis: {
    setting: "analysisEnabled",
    name: "Análise",
    hint: "Mecânica de Skill \"Analisar\": quem analisa compara o nível da Skill com o nível do alvo (mais a Ocultação dele), a Percepção de quem analisa com a Furtividade do alvo e, se a Análise é mágica, a Defesa Mágica do alvo. A margem decide o que o card (só para quem analisou e o Mestre) revela: Espécie, Traços e elementos; Vida/Mana e Condições; Resistências e fraquezas; a lista de Skills; a frase de cada Skill e os atributos. Desligar esconde a Mecânica e impede usar; nada salvo se perde.",
    default: true
  },
  predation: {
    setting: "predationEnabled",
    name: "Predação",
    hint: "Mecânica de Skill \"Predação\": sobre um alvo derrotado (morto, Caído ou Inconsciente), quem preda rola um d100 por Skill do alvo (a chance depende do Tier da Predação contra o da Skill) e, se o Mestre confirmar, absorve as que ganhou no nível 1. Também pode ganhar pontos permanentes de atributo (uma parte dos do alvo, só na 1ª, 5ª, 10ª, 20ª… criatura da mesma Espécie), a forma do corpo (se tiver uma Skill de Forma) e remover o Token. Desligar esconde a Mecânica e impede usar; nada salvo se perde.",
    default: true
  },
  reroll: {
    setting: "rerollEnabled",
    name: "Rerrolar",
    hint: "Mecânica de Skill \"Rerrolar\": usada no chat DEPOIS de ver uma rolagem (atributo, iniciativa, dano ainda não aplicado, ou os d100 de Predação e de passar da Mana). Quem tem uma Skill dessas vê \"Rerrolar\" no card das rolagens que ela alcança (as suas, as de aliados ou as de qualquer um, conforme a Skill); clicar paga o Custo e a Recarga como qualquer Skill e rola de novo. A Skill diz o que fica: o novo, o melhor ou o pior dos dois (uma Skill Ultimate pode escolher na hora). Desligar esconde a Mecânica e os botões; nada salvo se perde.",
    default: true
  },
  worldClock: {
    setting: "worldClockEnabled",
    name: "Relógio do mundo, dia/noite e escuro",
    hint: "O Mestre tem uma janela para passar o tempo do mundo (hora e dia). O \"Quando → Então\" ganha \"É dia\", \"É noite\" e \"Está escuro\"; cenas marcadas \"Escurece com o relógio\" ficam claras ou escuras pela hora; o Descanso fora de combate deixa o personagem Dormindo até o tempo passar, e o Mestre é avisado quando todos dormem. O jogador nunca vê a hora pela interface do Foundry: só no PAD e em itens que marcam o tempo. Desligar volta o Descanso a ser na hora; nada salvo se perde.",
    default: true
  },
  calendar: {
    setting: "calendarEnabled",
    parent: "worldClock",
    name: "Calendário, linhas do tempo e tempo pessoal",
    hint: "O Relógio do mundo ganha um calendário editável (meses, semana, eras, data estelar) e linhas do tempo: cada cena escolhe a sua (a porta para 500 anos atrás, uma nave em dobra). O personagem tem tempo pessoal e o PAD mostra a data que ELE acha que é, com \"Atualizar\" aprovado pelo Mestre. Desligar volta ao relógio simples (o tempo pessoal é o do mundo); nada salvo se perde.",
    default: true
  },
  timeManipulation: {
    setting: "timeManipulationEnabled",
    name: "Manipulação do tempo (Acelerar e Desacelerar)",
    hint: "Habilita o grupo de efeito \"Tempo\" no editor de Skill, com o efeito \"Ritmo do tempo\": Acelerar (fator maior que 1) e Desacelerar (menor que 1), em si, num alvo ou em área. Em combate, quem está Acelerado ×N tem uma reserva de N de tempo por turno (números por turno, como Veneno e regeneração, passam até N vezes de uma vez; Recarga e Preparo são pagos pela reserva) e anda N vezes o Deslocamento; fora de combate o tempo pessoal anda ×N. Alvo de nível maior que a Skill sofre menos o efeito. Desligar só esconde o grupo e deixa de aplicar efeitos novos; o que já está salvo ou ativo não é apagado.",
    default: true
  },
  skillUndo: {
    setting: "skillUndoEnabled",
    name: "Desfazer uso de Skill",
    hint: "No card de cada uso de Skill o Mestre vê \"Desfazer uso\" até o turno de quem usou acabar (fora de combate: até o personagem usar outra Skill). Desfazer devolve a Mana, tira os efeitos e Escudos que o uso deu, desliga a Skill Ativa que ligou, apaga a Estrutura/Zona, tira a XP de uso e devolve o dano já aplicado. O card fica riscado.",
    default: true
  },
  incapacitation: {
    setting: "incapacitationEnabled",
    name: "Vida 0: Caído e Inconsciente",
    hint: "PJ em 0 de Vida fica Caído (não age nem se move, Skills Ativas desligam) com contador de morte — ao zerar, o Mestre é avisado; o sistema nunca mata sozinho. Qualquer coisa que tire a Vida do 0 (regeneração, cura) troca para Inconsciente por mais algumas rodadas. Regeneração e cura continuam funcionando enquanto caído. NPC em 0 pode morrer direto.",
    default: true,
    options: {
      deathRounds: { label: "Rodadas até a morte (Caído)", hint: "Contadas no turno do caído. Ao zerar, o Mestre recebe o aviso. Estabilizar para o contador.", type: "number", default: 3, min: 1 },
      wakeRounds: { label: "Rodadas Inconsciente ao sair do 0", hint: "Turnos que ele ainda perde depois que a Vida volta; age no seguinte.", type: "number", default: 3, min: 0 },
      npcDiesAtZero: { label: "NPC morre direto em 0", hint: "Conta como NPC quem está marcado NPC na ficha ou não tem jogador dono. Fica Derrotado no combate, sem passar por Caído.", type: "boolean", default: true }
    }
  },
  skillUseXp: {
    setting: "skillUseXpEnabled",
    name: "XP por uso de Skill",
    hint: "A Skill ganha XP pelo que fez: dano e cura pela fração da Vida máxima do alvo; Escudo e Barreira lançados uma vez, um valor fixo, e mantidos, uma parte do dano que seguram; buff/debuff pela fração do valor que mudou, até um teto por alvo; Condição, Estrutura e Zona um valor fixo (Estrutura também pelo dano que segurou). Para no teto do nível — subir continua sendo clique do Mestre.",
    default: true,
    options: {
      skillXpFactor: { label: "XP de um efeito do tamanho de uma Vida", hint: "Um golpe que leva a Vida máxima inteira do alvo vale isto (cada alvo conta no máximo uma vez).", type: "number", default: 100, min: 0 },
      skillXpFlatPercent: { label: "% fixo (Condição, Estrutura, Zona)", hint: "Porcentagem do valor acima dada por Condição aplicada, Estrutura erguida ou Zona criada.", type: "number", default: 10, min: 0 },
      skillXpBuffCapPercent: { label: "Teto de buff/debuff (%)", hint: "Um buff ou debuff rende no máximo esta porcentagem do valor acima por alvo, por maior que seja o aumento (um +3 em quem tem 0 ou 3 bate no teto).", type: "number", default: 25, min: 0 },
      skillXpBlockPercent: { label: "Escudo/Barreira mantidos: % do que seguram", hint: "Escudo de Skill Ativa e Barreira mantida (Skill Ativa ou Barreira de Mana) ganham esta porcentagem da XP do dano que seguraram (dano ÷ Vida de quem protegeram). Lançados uma vez, ganham só o fixo ao surgir.", type: "number", default: 50, min: 0 }
    }
  },
  inventory: {
    setting: "inventoryEnabled",
    name: "Inventário (slots, pilhas e contêineres)",
    hint: "Aba Inventário na ficha: cada pilha ocupa um slot (padrão 20 por pilha), Itens iguais arrastados somam na pilha, contêineres (mochila, bolsa) têm slots próprios e reduzem o peso. Slots e carga base vêm da Espécie; Força e Defesa aumentam a carga. Naves ganham o Porão (Módulos de carga). Passar do limite só avisa — o bloqueio de peso é o bloco abaixo.",
    default: true,
    options: {
      carryPerStrength: { label: "Carga por ponto de Força (kg)", hint: "Quanto cada ponto de Força (total) soma à carga.", type: "number", default: 1, min: 0 },
      carryPerDefense: { label: "Carga por ponto de Defesa (kg)", hint: "Quanto cada ponto de Defesa (total) soma à carga.", type: "number", default: 0.5, min: 0 }
    }
  },
  encumbrance: {
    setting: "encumbranceEnabled",
    parent: "inventory",
    name: "Peso limita o Deslocamento",
    hint: "Acima da carga, o personagem perde Deslocamento na mesma proporção do excesso (20% acima = −20%; o dobro = parado). No Porão da Nave, a carga pesa no Motor (menos Movimento e Evasão) — mais energia nos Motores compensa.",
    default: false
  },
  structures: {
    setting: "structuresEnabled",
    name: "Estruturas (manipulação do ambiente)",
    hint: "Skills que criam paredes e blocos no mapa (Parede de Pedra, Bloco de Gelo, Barreira de Mana), com forma escolhida ou desenhada à mão. As Estruturas bloqueiam movimento e visão como paredes de verdade. Catálogo em Configurações Gerais › Estruturas.",
    default: true
  },
  interference: {
    setting: "interferenceEnabled",
    name: "PEM e Interferência (Antimagia da tecnologia)",
    hint: "O espelho tecnológico da Antimagia: a Skill PEM corta efeitos tecnológicos, desliga Skills Ativas tecnológicas e suprime itens, implantes e próteses Tecnológicos (e desliga Módulos de Nave); Campos e Selos de Interferência fazem o uso tecnológico pagar energia extra. Mágico e Tecnológico são caixas independentes (as duas = tecnomágico, nenhuma = analógico, imune aos dois). Desligar só esconde o alvo PEM e os campos; nada salvo é apagado.",
    default: false
  },
  scale: {
    setting: "scaleEnabled",
    name: "Escala (Personagem × Nave)",
    hint: "Dano entre escalas diferentes (Pessoal, Veículo, Nave, Capital) é multiplicado ou dividido pelo fator a cada degrau: uma pistola faz quase nada numa Nave, um canhão de Nave vaporiza uma pessoa. As escalas e o Porte de cada uma ficam em Configurações Gerais › Escalas.",
    default: false,
    options: {
      scaleFactor: { label: "Fator por degrau", hint: "Quanto o dano muda a cada degrau de diferença (10 = ×10 / ÷10).", type: "number", default: 10, min: 1 }
    }
  },
  shipManeuver: {
    setting: "shipManeuverEnabled",
    name: "Movimento e Evasão de naves",
    hint: "Em combate, Nave/Veículo só anda as casas da rodada (Porte × Motor) e a Manobra vira Evasão: um percentual do dano dos tiros que ele evita antes do Escudo. Motor menor, throttle baixo ou falta de energia diminuem os dois.",
    default: false,
    options: {
      shipMoveMini: { label: "Movimento — Mini (casas)", hint: "Casas por rodada de uma nave Mini com o Motor do tamanho esperado a 100%.", type: "number", default: 8, min: 0, legacy: true },
      shipMovePequeno: { label: "Movimento — Pequeno (casas)", hint: "Casas por rodada de uma nave Pequeno com o Motor do tamanho esperado a 100%.", type: "number", default: 6, min: 0, legacy: true },
      shipMoveMedio: { label: "Movimento — Médio (casas)", hint: "Casas por rodada de uma nave Médio com o Motor do tamanho esperado a 100%.", type: "number", default: 5, min: 0, legacy: true },
      shipMoveGrande: { label: "Movimento — Grande (casas)", hint: "Casas por rodada de uma nave Grande com o Motor do tamanho esperado a 100%.", type: "number", default: 4, min: 0, legacy: true },
      shipMoveCapital: { label: "Movimento — Capital (casas)", hint: "Casas por rodada de uma nave Capital com o Motor do tamanho esperado a 100%.", type: "number", default: 3, min: 0, legacy: true },
      shipEvasionMini: { label: "Evasão — Mini (%)", hint: "Dano evitado por uma nave Mini com o Motor do tamanho esperado a 100%.", type: "number", default: 30, min: 0, legacy: true },
      shipEvasionPequeno: { label: "Evasão — Pequeno (%)", hint: "Dano evitado por uma nave Pequeno com o Motor do tamanho esperado a 100%.", type: "number", default: 22, min: 0, legacy: true },
      shipEvasionMedio: { label: "Evasão — Médio (%)", hint: "Dano evitado por uma nave Médio com o Motor do tamanho esperado a 100%.", type: "number", default: 15, min: 0, legacy: true },
      shipEvasionGrande: { label: "Evasão — Grande (%)", hint: "Dano evitado por uma nave Grande com o Motor do tamanho esperado a 100%.", type: "number", default: 8, min: 0, legacy: true },
      shipEvasionCapital: { label: "Evasão — Capital (%)", hint: "Dano evitado por uma nave Capital com o Motor do tamanho esperado a 100%.", type: "number", default: 3, min: 0, legacy: true },
      shipEvasionCap: { label: "Teto de Evasão (%)", hint: "Nenhuma nave evita mais que isso, nem com overclock.", type: "number", default: 40, min: 0 }
    }
  }
};

/**
 * Combinações prontas de FEATURES por tipo de campanha — aplicadas de uma vez pelo editor
 * visual (ver `applyCampaignPreset`). Só mexem nos blocos listados em `features`; o que não
 * aparece na lista fica como está. Nenhum preset apaga dado: "Naves desligadas" numa campanha
 * medieval significa que a UI some, não que as Naves do mundo sumam.
 */
export const CAMPAIGN_PRESETS = {
  medieval: {
    label: "Fantasia Medieval",
    // Conteúdo que o preset carrega (substitui o catálogo): nome da(s) lista(s) de NIHILITY.
    content: { damageElementsData: ["DEFAULT_DAMAGE_ELEMENTS"] },
    hint: "Isekai/fantasia: Títulos, Anatomia, Fusão e Magia ligados; nada de Naves, Veículos ou PAD.",
    features: {
      economy: true, titles: true, anatomy: true, vessels: false, skillFusion: true,
      skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
      areaEffects: true, aiAssistant: true, pad: false, movement: true, shipManeuver: false, scale: false, structures: true, interference: false
    }
  },
  scifi: {
    label: "Sci-Fi Arcano",
    content: {
      damageElementsData: ["SCIFI_DAMAGE_ELEMENTS", "DEFAULT_DAMAGE_ELEMENTS"],
      moduleCategoriesData: ["SCIFI_MODULE_CATEGORIES"]
    },
    hint: "Naves, Veículos e PAD ligados; Títulos e Fusão de Habilidades desligados (são convenções de isekai).",
    features: {
      economy: true, titles: false, anatomy: true, vessels: true, skillFusion: false,
      skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
      areaEffects: true, aiAssistant: true, pad: true, movement: true, shipManeuver: true, scale: true, structures: true, interference: true
    }
  },
  misto: {
    label: "Misto (tudo ligado)",
    content: {
      damageElementsData: ["DEFAULT_DAMAGE_ELEMENTS", "SCIFI_DAMAGE_ELEMENTS"],
      moduleCategoriesData: ["SCIFI_MODULE_CATEGORIES"]
    },
    hint: "O sistema inteiro disponível — fantasia e sci-fi coexistindo na mesma campanha.",
    features: {
      economy: true, titles: true, anatomy: true, vessels: true, skillFusion: true,
      skillPoints: true, attributePool: true, resistances: true, statusConditions: true,
      areaEffects: true, aiAssistant: true, pad: true, movement: true, shipManeuver: true, scale: true, structures: true, interference: true
    }
  }
};

/**
 * Módulos do Sistema enxuto (backlog K4; canvas "Ferramentas da Mesa", prancha 1): o grupo de cada
 * bloco, uma frase curta (o `hint` longo fica no "mais ▸") e a marca `heavy` — os blocos que o
 * "Deixar leve" (K2) desliga. Sub-bloco herda o grupo do pai. Mesclado em FEATURES logo abaixo.
 */
export const FEATURE_GROUPS = [
  { id: "character", label: "Personagem" },
  { id: "combat", label: "Combate" },
  { id: "world", label: "Mundo" },
  { id: "gm", label: "Ferramentas do Mestre" }
];

const FEATURE_LAYOUT = {
  titles: ["character", "Títulos dão bônus permanentes e aparecem na ficha."],
  anatomy: ["character", "Partes do corpo com Vida própria, próteses e implantes."],
  bodyPartInjury: ["character", "Perder uma parte tira a Função dela (segurar, andar, ver…).", true],
  skillPoints: ["character", "Pontos para comprar e subir Skills, pedidos ao Mestre."],
  attributePool: ["character", "Pontos de atributo por nível, distribuídos pelo jogador."],
  skillFusion: ["character", "Juntar Skills numa só, mais forte (Única/Ultimate)."],
  speciesEvolution: ["character", "A Espécie pode evoluir para outra (estilo Tensura)."],
  inventory: ["character", "Espaços, contêineres e quanto cada um carrega."],
  encumbrance: ["character", "Carregar demais reduz o Deslocamento.", true],
  skillUseXp: ["character", "A Skill ganha XP pelo que faz quando é usada."],
  statusConditions: ["combat", "Condições como Veneno e Lentidão, também pelo HUD do Token."],
  resistances: ["combat", "Skills e Títulos que reduzem dano de um tipo, até a Imunidade."],
  areaEffects: ["combat", "Skills em área: círculo, cone ou linha no mapa, e Zonas."],
  structures: ["combat", "Skills que erguem paredes e barreiras no mapa."],
  interference: ["combat", "PEM: a Antimagia da tecnologia (Skill, campo e selo)."],
  movement: ["combat", "Limita quantos metros o Token anda no turno.", true],
  incapacitation: ["combat", "PJ em 0 cai e tem rodadas até a morte; NPC morre direto."],
  scale: ["combat", "Pessoa contra Nave: o dano cresce ou diminui pela Escala.", true],
  naturalRegen: ["combat", "Mana (e Vida, se configurado) volta um pouco a cada turno.", true],
  skillRange: ["combat", "Alcance em metros para Skills, armas e granadas; Marcas lançam de longe."],
  forcedMovement: ["combat", "Skills e armas de gravidade empurram ou puxam o alvo pelo mapa."],
  weaponMastery: ["combat", "Tipos de arma e Maestria: +% de dano com o tipo que você treina."],
  elevation: ["combat", "Voo, altura e escavação: a elevação do Token entra nas distâncias.", true],
  senses: ["combat", "Debaixo da terra ou invisível, só quem tem o sentido certo percebe."],
  skillUndo: ["combat", "O Mestre desfaz o último uso de uma Skill até o turno acabar."],
  endOfCombat: ["combat", "Ao encerrar: tira efeitos que congelariam, dá XP e descanso."],
  economy: ["world", "Moedas, conversão e transferência entre personagens."],
  environment: ["world", "Perigos da cena ou de uma área, e a densidade de mana."],
  radiation: ["world", "Lugares irradiam; ficar ali acumula e machuca.", true],
  traps: ["world", "Regiões com armadilha: dano e Condição a quem pisa."],
  luck: ["combat", "Sorte e azar: inclinam os dados (atributos, dano e chances) a favor ou contra."],
  reactions: ["combat", "Fogo em quem está Molhado, raio na poça: o golpe reage com o que o alvo carrega."],
  surfaces: ["combat", "Poças e chamas no chão: quem pisa sofre, e o golpe reage com a superfície.", true],
  forms: ["character", "Skill de Forma: o personagem joga com a ficha temporária de outro corpo."],
  naming: ["character", "Nomear uma criatura a liga a você: Corredor de alma, XP e Mana máxima perdida."],
  analysis: ["character", "Skill Analisar: revela a ficha de um alvo conforme a margem de nível."],
  predation: ["character", "Skill Predação: absorve Skills, pontos e forma de um alvo derrotado."],
  pact: ["character", "Pacto entre patrono e bruxo: o bruxo usa as Skills liberadas com a própria Mana."],
  reroll: ["combat", "Skill Rerrolar: refaz uma rolagem do chat (atributo, iniciativa, dano, d100)."],
  worldClock: ["world", "Relógio do mundo: dia/noite, escuro e o Descanso que passa o tempo."],
  calendar: ["world", "Calendário e linhas do tempo: época por cena, tempo pessoal e a data do PAD."],
  timeManipulation: ["combat", "Skills que aceleram ou desaceleram o tempo de alguém (Ritmo do tempo)."],
  vessels: ["world", "Naves e Veículos com Módulos, Grid de Energia e tripulação."],
  shipManeuver: ["world", "Naves se movem por casas e esquivam pela Rotação.", true],
  pad: ["world", "O \"celular\" do personagem: Nave, Biblioteca e Mensagens."],
  padShip: ["world", "Tela da Nave no PAD."],
  padLibrary: ["world", "Favoritos pessoais e da Nave no PAD."],
  padMessaging: ["world", "Conversas e grupos pelo PAD."],
  aiAssistant: ["gm", "Criar e editar fichas, Skills e Itens com IA."],
  npcGenerator: ["gm", "Fichas de NPC prontas a partir de um arquétipo."],
  npcTiers: ["gm", "Lacaio, Elite e Chefe na ficha de NPC."],
  skillAssist: ["gm", "Avisos e custo sugerido no editor de Skill."],
  encounterSim: ["gm", "Diz se a luta está fácil, justa ou mortal antes de começar."],
  creationMode: ["character", "O jogador cria o personagem na ficha; você libera quando estiver pronto."]
};

for (const [key, [group, short, heavy]] of Object.entries(FEATURE_LAYOUT)) {
  if (!FEATURES[key]) continue;
  Object.assign(FEATURES[key], { group, short, heavy: Boolean(heavy) });
}

// "Deixar leve" (K2): vale por cima de qualquer gênero e só desliga os blocos marcados pesado.
CAMPAIGN_PRESETS.leve = {
  label: "Deixar leve",
  light: true,
  hint: "Qualquer gênero: desliga só os blocos marcados \"pesado\". Os outros ficam como estão.",
  features: Object.fromEntries(Object.entries(FEATURES).filter(([, f]) => f.heavy).map(([key]) => [key, false]))
};
