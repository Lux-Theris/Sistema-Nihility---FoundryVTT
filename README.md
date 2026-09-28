# Nihility RPG System

Sistema customizado para [Foundry VTT](https://foundryvtt.com/) (requer **V13+**, verificado até **V14**), construído do zero para suportar tanto campanhas de **Fantasia/Isekai** quanto de **Sci-Fi Arcano**, com automações avançadas via IA e regras profundas de Habilidades e Anatomia.

## Destaques

### Campanha e configuração

- **Totalmente modular**: cada bloco do sistema liga e desliga por mundo, com **presets de campanha** prontos: Fantasia Medieval, Sci-Fi Arcano ou Misto. Os blocos são:
  - Economia, Títulos, Anatomia, Naves e Veículos;
  - Fusão de Habilidades, Pontos de Habilidade, Pool de Atributos;
  - Resistências, Condições, Habilidades de Área, Estruturas;
  - Deslocamento, Movimento e Evasão de naves, Escala;
  - Assistente de IA e PAD.

  Desligar um bloco só esconde a interface e impede criar conteúdo novo daquele tipo: **nada é apagado**, e religar devolve tudo como estava. Os presets também carregam conteúdo pronto (elementos de energia e categorias de módulo estilo Star Trek no Sci-Fi).
- **Tudo configurável no jogo, sem JSON à mão**: moedas, espécies, Traços, tipos de dano, Condições, Escalas, Estruturas, categorias de módulo, classes de nave e de veículo, e postos de tripulação têm editores visuais próprios.
  - As regras numéricas (XP, pontos por nível, fórmulas de Vida/Mana, iniciativa…) ficam juntas em **Regras da Mesa**.
- **Exportar/Importar tudo**: leva catálogos, Módulos do Sistema e regras de um mundo para outro, escolhendo o que vai e vendo o que muda antes de importar. A chave de IA nunca entra no arquivo.
- **Fórmula de HP/Mana configurável**: quais Atributos multiplicam cada pool, o multiplicador e o piso são settings. Dá até para desligar o pool de Mana numa campanha sem magia: as Habilidades continuam funcionando, só deixam de custar recurso.
- **Atributos renomeáveis**: os oito Atributos de Combate podem receber os nomes da sua campanha, ou ser escondidos da ficha, sem quebrar Efeitos, Títulos ou fórmulas já gravados. Os oito são Força, Defesa, Magia, Defesa Mágica, Destreza, Furtividade, Percepção e Precisão.
- **Pontos de Atributo extras do Mestre**, por personagem, somados ao orçamento do nível.

### Personagens e combate

- **Rolagem com modificadores**: **Shift+clique** em qualquer rolagem abre Vantagem/Desvantagem e modificadores livres (somar, subtrair, multiplicar, dividir, com o motivo). Vale para atributo, iniciativa, dano de Habilidade, ataque com arma e disparo de nave. Vantagem rola o pool inteiro duas vezes e fica com o maior.
- **Iniciativa pelo Atributo**: usa o mesmo pool de d20 escalável do resto do sistema, em vez do `1d20` solto do Foundry. O Atributo é configurável; o padrão é Destreza.
- **Experiência e progressão**:
  - Personagens **e** Habilidades acumulam XP numa curva configurável (padrão `100 × nível`). O sistema avisa quando a barra enche; subir de nível continua sendo decisão do Mestre.
  - Cada nível de Habilidade segue um ciclo previsível de **Poder** (multiplica o efeito) e **Desconto** (corta o Custo).
  - O dano pode escalar por um Atributo, numa curva quadrática — a única que acompanha o crescimento do HP.
- **Deslocamento por rodada**: base + Destreza, com teto só na Destreza permanente (Skills passam por cima). Em combate, a régua do token mostra o alcance, o que passa do limite fica pontilhado e o token para no último ponto que alcança. Botão **Correr** dobra o deslocamento do turno.
- **Dano por elemento**:
  - Um golpe com vários elementos é dividido em partes iguais, e cada parte sofre só a Resistência do seu elemento. Imunidade a Fogo não zera a parte de Gelo.
  - Cada elemento pode ter **efeitos ao acertar**: aplicar Condição com chance, dano extra contra um Traço, dreno de Escudo, Penetração.
- **Antimagia**: Skills que custam Mana são Mágicas; Campo Antimagia (Estrutura) e Selo Antimagia (Condição) cobram Mana extra por nível, ou anulam a magia. Estruturas podem ter elementos (Fogo derrete Gelo mais rápido) e dano ao contato (Muralha de Fogo).
- **Dano Absoluto**: é o dano inteiro, com qualquer elemento junto — não pode ser resistido nem alterado pelos elementos, só desviado (Evasão de nave) ou barrado por uma Estrutura.
- **Escala Personagem × Nave**: dano entre escalas diferentes é multiplicado ou dividido pelo fator a cada degrau. Pistola quase não arranha uma nave; canhão de nave vaporiza uma pessoa.
- **Condições com efeito padrão**: Queimadura em % do dano do golpe, Lentidão em % do deslocamento…, definido uma vez e usado por elementos, Skills e pela marcação no token. Reaplicar renova a duração, não soma.
- **Bônus Condicionais ("Quando → Então")** em Títulos, Skills e Itens. Por exemplo, Caçador de Dragões dá +25% de dano contra quem tem o Traço Dracônico. Também podem depender de Vida baixa, Condições, elemento ou estar em combate.
- **Traços de criatura** (Dracônico, Voador, Orgânico…) vindos da Espécie, ajustáveis na ficha.
- **Resistências que aprendem sozinhas**: uma Skill de Resistência ganha XP ao efetivamente bloquear dano, proporcional à fatia da própria Vida que foi salva. O sistema também **sugere** Resistências ao Mestre depois de muitos golpes do mesmo tipo.
- **Dano aplicável pelo chat**:
  - O card de dano ganha botões **Aplicar / Metade / Dobro** (só Mestre) com **Desfazer**.
  - O Escudo pessoal absorve antes da Vida.
  - As Condições do elemento só entram quando o acerto é confirmado.
- **Armas de Personagem**: qualquer Item vira arma. Só arma **equipada** ataca. Skills podem **aprimorar as armas equipadas**: mais dano, trocar o elemento, dano mágico ou absoluto.
- **Habilidades Ativas** com custo por rodada. Mana em 0 desliga todas as Habilidades Ativas do personagem; os efeitos somem no início do próximo turno.
- **Estruturas**: Skills cuja Mecânica ao Usar é *Estrutura* erguem Parede de Pedra, Bloco de Gelo, Barreira de Mana… como paredes de verdade no mapa.
  - Formas: linha, círculo, quadrado ou **desenhada à mão**, até o tamanho máximo.
  - Vida 0 = barreira de mana: o dano sai da Mana de quem conjurou.
  - **Bloqueiam ataques**: um golpe que atravessa a Estrutura bate nela primeiro; só o que sobra da Vida dela (ou da Mana, numa barreira) chega no alvo. Quem ergueu atira de dentro da própria Estrutura.
  - Visível pra todos no mapa (faixa na cor da Estrutura, nome e barra de Vida) e, se quiser, com **luz animada** (Campo de Energia, Domo Hexagonal…), com pré-visualização no mapa antes de salvar.
- **Escudo pessoal com luz**: um Efeito de Escudo pode acender uma luz no Token de quem recebe; ela é apagada quando o Escudo acaba ou a Skill é desligada.
- **Condições no HUD do token**: marque "Envenenado" clicando no token, usando o efeito padrão da Condição ou outro valor.
- **Anatomia por Espécie**: ao trocar a espécie, o sistema aplica o preset de Partes do Corpo (HP próprio, próteses/modificações), as Skills Raciais e os Traços.
- **Fusão e Evolução de Skills** (só Mestre). Sub-Skills são sempre uma lista plana que o jogador escolhe ao usar.
- **Habilidade Concedida completa** por Item, Módulo ou Modificação, editada no mesmo editor de Skill. É fixa: não ganha XP nem sobe de nível.

### Janela de Efeitos

- **✦ Efeitos** na ficha de Personagem e de Nave: tudo o que está agindo sobre o Ator, em palavras, com quanto falta — e o Mestre encerra dali.
- Compatível com o formato novo de Active Effect da V14 (`system.changes`), sem perder a V13.

### Inventário

- **Aba Inventário** com slots por Espécie, pilhas (padrão 20, arrastar item igual soma), dividir pilha, contêineres (mochila, bolsa; Skills podem dar bolsa dimensional ilimitada), peso com moedas e carga por Força/Defesa, e perda de Deslocamento por excesso (bloco opcional).
- **Porão da Nave** (Módulos de Porão, carga pesando no Motor) e **Munição** para lançadores (Torpedo Fotônico, Quântico…).

### Naves e Veículos

- **Porte e Classe**: Porte é o tamanho, com listas editáveis e separadas para Nave (Mini→Capital) e Veículo (Mini→Colossal); Classe é o tipo, com faixa de Porte aceita (Caça até Pequeno, Dreadnought a partir de Capital).
  - Classes de Nave: Encouraçado, Cruzador, Cargueiro…; Classes de Veículo: Tanque, Carro, Moto…
  - A Classe muda vagas, espaço de arma, evasão e movimento.
- **Categorias de Módulo personalizáveis**: cada categoria aponta para uma **Função** (Geração de Energia, Propulsão, FTL, Escudo, Blindagem, Arma…).
  - Dois núcleos de dobra somam; impulso + manobradores somam; dobra e transdobra são independentes.
  - Comunicações, Defletor e afins existem só se a campanha quiser (Função Utilidade).
- **Grid de Energia** inspirado em Elite Dangerous (Reator → Distribuidor → Bateria): throttle por Módulo e **grupos de prioridade P1…P5** (chip em cada Módulo da ficha da Nave): quando falta energia, P1 recebe primeiro e o mesmo grupo divide o que sobra por igual. Atalhos de **foco de energia** (Escudos / Armas / Motores / Equilibrado) na ficha e no PAD.
- **Ações da Nave**: Preparar para impacto, Energia auxiliar → Escudos, Reparo de emergência e Reiniciar sistemas, com a lista de efeitos de sistema ativos (Módulo derrubado, energia drenada…).
- **Escudo adaptativo** (aprende elemento + frequência de quem atira) e a ação **Modular frequência** para furá-lo.
- **Raio Trator**: um Módulo que prende outra nave e corta o deslocamento dela conforme a diferença de Porte.
- **Cascata de dano** em 3 camadas (Escudo → Casco → Integridade Estrutural), com Penetração, Recarga de Escudo e **Evasão** (a Manobra da nave vira dano evitado).
- **Movimento por rodada** (Porte × Motor), com o mesmo limite na régua do personagem.
- **Tripulação com postos** (Capitão, Piloto, Engenheiro…) que são só "quem está onde". Qualquer tripulante opera a nave inteira e troca o próprio posto na hora.
- **Armas nativas do Módulo** (sobrecarregar bate mais forte mas recarrega mais devagar), ajuste manual do Mestre e reparo em campo (`game.nihility.requestShipRepair()`).

### Ferramentas

- **Assistente de IA (GM)**: gera NPCs, Montarias, Naves, Veículos, Notas, Itens e Skills a partir de texto livre.
  - Tem geração em lote, edição de documentos existentes e um modo Agente que cria vários documentos de uma vez, com desfazer.
  - Suporta OpenAI-compatível ou Anthropic/Claude.
- **PAD (celular in-game)**: status da Nave tripulada, Biblioteca de favoritos e mensagens privadas entre personagens.
- **Voz do Mundo**: anúncios de nível, fusão e novas habilidades são sempre enviados por *whisper*, só para o Mestre e o dono do personagem.
- **Compêndios auto-geridos**: Skills, Partes do Corpo, Títulos, Itens e Módulos de Nave.

## Instalação

### Via manifesto (URL)

No Foundry VTT, aba **Game Systems → Install System**, cole esta URL de manifesto:

```text
https://raw.githubusercontent.com/Lux-Theris/Sistema-Nihility---FoundryVTT/main/system.json
```

### Manual (upload direto)

1. Copie `system.json`, `module/`, `templates/`, `styles/` e `lang/` deste repositório para `Data/systems/nihility-rpg-system/` na instalação do seu Foundry VTT.
2. Reinicie o Foundry (ou atualize a lista de sistemas).
3. Crie um novo Mundo selecionando **Nihility RPG System** como sistema.

## Estrutura do projeto

```text
├── system.json                        # Manifesto do sistema
├── module/
│   ├── nihility-rpg-system.js         # Ponto de entrada (hooks init/ready/combate/chat)
│   ├── config.js                      # Settings, FEATURES, presets, catálogos e seus leitores
│   ├── dice.js                        # Pool de d20 escalável dos Atributos
│   ├── roll-modifiers.js              # Vantagem e modificadores do shift+clique (regra pura)
│   ├── damage-rules.js                # Dano por elemento, Imunidade, Escala, efeito de Condição (regra pura)
│   ├── conditional-modifiers.js       # Bônus "Quando → Então" (regra pura)
│   ├── conditional-context.js         # …e a ponte com Atores/combate
│   ├── skill-economy.js               # Fusão, Evolução, Pontos de Habilidade, skills concedidas
│   ├── skill-effects.js               # "Usar Habilidade": dano, efeitos, Condições, upkeep, Mana em 0
│   ├── skill-snapshot.js              # Snapshot de Skill em Sub-Skill e Habilidade Concedida
│   ├── area-effects.js                # Habilidades de Emissão e Zonas (Measured Templates)
│   ├── structures.js                  # Estruturas no mapa (paredes, blocos, barreiras)
│   ├── structure-geometry.js          # …e a geometria delas (regra pura)
│   ├── movement.js                    # Deslocamento por rodada e Correr
│   ├── combat.js                      # Iniciativa pelo pool de Atributo
│   ├── conditions.js                  # Condições na paleta do HUD do token
│   ├── damage-apply.js                # Aplicar/Desfazer dano no chat (Escudo pessoal primeiro)
│   ├── config-transfer.js             # Exportar/Importar configurações
│   ├── starship-power.js              # Tick de energia/sobrecarga/recarga de Nave
│   ├── starship-repair.js             # Macro de reparo em campo
│   ├── currency.js                    # Conversão e transferência de moedas
│   ├── compendium.js                  # Compêndios de World auto-geridos
│   ├── voice-of-the-world.js          # Canal de anúncio privado
│   ├── vfx.js                         # Animações via Sequencer (opcional)
│   ├── ai-generation.js               # Geração/edição de conteúdo via IA
│   ├── ai-helper.js                   # Montagem da API pública game.nihility.ai
│   ├── ai/                            # Provedores, loop de agente e tools
│   ├── pad/                           # PAD: tripulação, biblioteca e mensagens
│   ├── helpers/                       # foundry-compat, gm-relay (socket), target-picker,
│   │                                  # world-backup, traits-ui, crew-ownership
│   ├── data/                          # DataModels (character, starship, item)
│   ├── sheets/                        # Fichas de Actor/Item
│   └── apps/                          # Menu, Assistente de IA, PAD e editores de catálogo
├── templates/                         # .hbs de fichas, apps, partials (parts/) e cards de chat
├── styles/nihility-rpg-system.css
├── test/                              # Testes das regras puras (node --test test/rules.test.mjs)
└── lang/{pt-BR,en}.json
```

> **Idioma**: a interface é escrita em pt-BR direto nos templates. Os arquivos `lang/*.json`
> hoje só valem pelos nomes dos tipos de documento (`TYPES.*`) — o sistema não usa `game.i18n`
> para o resto, então traduzir para outro idioma exigiria uma passada de internacionalização
> de verdade.

## Configuração

Tudo parte do **Menu Principal**: botão **Nihility RPG System** no diretório de Atores (ou
`game.nihility.openAssistant()` numa macro). A aba **Configurações Gerais** é uma lista com busca,
em seções, e cada linha mostra o que já está configurado ("14 tipos · 4 grupos"):

| Seção | O que tem |
|---|---|
| **Campanha** | **Módulos do Sistema** (liga/desliga blocos, campos de cada bloco e presets de campanha) e **Regras da Mesa** (todas as regras numéricas, agrupadas) |
| **Personagem** | Atributos (renomear/esconder), Espécies (Partes do Corpo, Skills Raciais, Traços), Traços, Moedas, Compêndio de Títulos, Compêndio de Itens |
| **Combate e Dano** | Tipos de Dano (grupo e efeitos ao acertar), Condições (efeito padrão), Escalas, Estruturas |
| **Naves** | Categorias de Módulo (Função e vagas), Classes de Nave, Classes de Veículo, Postos de Tripulação |

Blocos desligados na campanha somem da lista e aparecem citados no rodapé. Em **Ferramentas de
Admin** ficam Exportar/Importar Configurações, Sincronizar Compêndios, Macros do Sistema e
Conteúdo de Exemplo.

**Regras da Mesa** reúne, por assunto:

- **Progressão:** fórmula de XP; pontos de Atributo e de Habilidade na criação e por nível; ciclo de níveis de Habilidade; XP e aprendizado de Resistência.
- **Vida e Energia:** fórmulas de HP/Mana (atributos, multiplicador, piso), pool de Mana ligado ou não, rótulos e sigla de energia.
- **Combate:** atributo de iniciativa, divisor da escala de dano, alvos fora da cena.

Os campos de Deslocamento, Escala e Movimento/Evasão de naves ficam dentro dos próprios blocos, em
Módulos do Sistema.

As settings de IA ficam na tela nativa de Configurações do Foundry:

| Setting | Descrição |
|---|---|
| Provedor de IA | `OpenAI-compatível` (OpenAI, OpenRouter, Groq, Together, LM Studio, Ollama `/v1`...) ou `Anthropic (Claude)` |
| Endpoint de IA | URL Chat Completions — só usado no provedor OpenAI-compatível |
| Modelo de IA | Nome do modelo (ex: `gpt-4o-mini`, ou um modelo Claude no provedor Anthropic) |
| Chave de API de IA | Chave do provedor escolhido |

> **Configurando o Claude**: escolha `Anthropic (Claude)` em Provedor de IA, coloque o nome do modelo e sua chave de `console.anthropic.com` em Chave de API. O Endpoint de IA é ignorado nesse modo.

**Sobre a chave ficar visível a jogadores**: todas as settings de IA usam `scope: "client"`.
Ficam salvas só no navegador de quem as configura e nunca sincronizam para outros usuários
conectados, e por isso também nunca entram no Exportar Configurações. Como efeito colateral, você
precisa reconfigurá-las se trocar de navegador ou computador.

## Criar com IA (GM)

Menu Principal → aba **Criar com IA**. O botão do Menu aparece para todo mundo, porque a aba
*Fichas* é usada por jogadores. As abas do Mestre aparecem com cadeado para quem não é Mestre.

| Tarefa | O que cria |
|---|---|
| Personagem / NPC | Actor `character`, com espécie, pontos de atributo, biografia e skills; aplica o preset da espécie automaticamente |
| Montaria | Igual, com prompt focado em bestas/montarias |
| Nave Espacial | Actor `starship` com Porte e Módulos escolhidos a partir do catálogo de Categorias do mundo, respeitando as vagas. Os números de cada Módulo vêm dos presets do sistema; a IA só escolhe Categoria e Porte |
| Veículo Terrestre | Actor `vehicle` com o mesmo sistema, nos dois Portes menores |
| Habilidade | Um Item `skill` direto no Compêndio de Habilidades |
| Item | Itens e equipamentos |
| Nota | Uma `JournalEntry` com título e conteúdo |
| Pergunta Livre | Resposta em texto solto, nada é criado |
| Assistente Completo | Os modos **Editar Existente** (arraste um documento e descreva a mudança) e **Agente** (vários documentos numa única pergunta, revisados antes de aplicar e desfeitos em lote) |

O campo **Quantidade** (1–10) gera vários itens da mesma tarefa em sequência. Atores e Notas
gerados vão para uma pasta **IA — Gerado**.

## API pública

```js
game.nihility.ai.fuseSkills(actor, [itemId1, itemId2], { tier: "unique", mode: "manual", manualData: {...} });
game.nihility.ai.ingestExternalSkillJSON(actor, jsonFromExternalSource);
game.nihility.ai.announceVoiceOfTheWorld(actor, { kind: "info", title: "...", body: "..." });

// Geração via IA (usadas internamente pelo Assistente, também chamáveis via macro)
game.nihility.ai.generateActorFromAI("um mercador anão desconfiado...", { isMount: false });
game.nihility.ai.generateVesselFromAI("uma corveta de reconhecimento rápida...", "starship");
game.nihility.ai.generateNoteFromAI("um evento estranho na vila de Ashcroft...");
game.nihility.ai.generateSkillFromAI("uma habilidade de cura baseada em luz estelar...");
game.nihility.ai.generateFreeform("sugira 5 nomes para uma guilda de mercenários...");

// Reparo de Nave/Veículo em campo — abre um diálogo pro jogador escolher Nave, Módulo/pool e
// engenheiro; cria um pedido no chat pro Mestre rolar Destreza e aplicar o reparo
game.nihility.requestShipRepair();
```

> Não precisa criar essas macros à mão: **Menu Principal → Ferramentas de Admin → Macros do
> Sistema → Criar** gera as duas na sua barra de macros (não duplica as que já existirem). A
> macro de Reparo nasce executável por jogadores, já que pedir reparo é ação deles.

## Modularidade por campanha

O mesmo sistema roda campanhas muito diferentes. Em **Módulos do Sistema** você liga e desliga
cada bloco, ou aplica um preset inteiro de uma vez:

| Preset | O que fica ligado | Conteúdo que carrega |
|---|---|---|
| **Fantasia Medieval** | Títulos, Anatomia, Fusão, Economia, Resistências, Condições, Magia, Deslocamento, Estruturas. Sem Naves, Veículos ou PAD. | Tipos de Dano de fantasia |
| **Sci-Fi Arcano** | Naves, Veículos, PAD, Anatomia (próteses/ciborgues), Economia, Resistências, Condições, Deslocamento, Movimento/Evasão de naves, Escala, Estruturas. Sem Títulos nem Fusão. | Elementos de energia estilo Star Trek (Phaser, Disruptor, Plasma, Pólaron, Táquion, Antiprótons, Transfásico, Cinético) mais os de fantasia; Categorias de Módulo estilo Star Trek (Núcleo de Dobra, Impulso, Manobradores, Transdobra…) |
| **Misto** | Tudo ligado — fantasia e sci-fi coexistindo na mesma campanha. | Os dois conjuntos de elementos e as Categorias estilo Star Trek |

> **Desligar nunca apaga nada.** O bloco some da interface e para de aceitar conteúdo novo, mas
> Atores, Itens e Compêndios que já existem continuam intactos e abríveis — religar devolve tudo
> exatamente como estava. Isso vale inclusive para trocar de preset no meio de uma campanha.
>
> **Presets com conteúdo substituem catálogos.** Aplicar Sci-Fi ou Misto troca a lista de Tipos
> de Dano e de Categorias de Módulo do mundo pelas do preset. Use **Exportar Configurações** antes
> se quiser guardar as atuais.

Deslocamento, Movimento/Evasão de naves e Escala vêm **desligados** num mundo que só atualizou o
sistema — mudam como os tokens se comportam em combate, então só entram quando você liga ou aplica
um preset.

## Desenvolvimento

Não há build nem dependências: o Foundry carrega os arquivos estáticos direto. As duas
verificações locais disponíveis são:

```bash
node --check module/caminho/do/arquivo.js   # sintaxe de um arquivo
node --test test/rules.test.mjs             # testes das funções puras de regra
```

O `system.json` declara `flags.hotReload` para `styles/`, `templates/` e `lang/`: editar um
`.css`, `.hbs` ou `.json` de idioma aplica na hora, sem reiniciar o mundo. Mudança em `.js`
ainda exige recarregar (F5).

Os testes cobrem só o que é chamável sem o Foundry. Entram:

- **Dados e rolagem:** pool de d20 e iniciativa; Vantagem e modificadores de rolagem.
- **Progressão:** curva de Resistência, curva de XP e XP de Resistência, ciclo de níveis de Habilidade, escala de dano.
- **Dano:** divisão por elemento, Penetração, Imunidade, Dano Absoluto, Escala; efeito padrão e renovação de Condição; Escudo pessoal no Aplicar.
- **Bônus e Traços:** Modificadores Condicionais e Traços.
- **Movimento:** deslocamento por rodada; movimento e Evasão de naves.
- **Naves:** presets e categorias de Módulo, vagas por Classe, dano estrutural.
- **Estruturas:** geometria.
- **Configuração:** Exportar/Importar e presets de campanha.
- **Outros:** conversão de moeda, prompts em lote da IA, snapshot de fusão e Habilidade Concedida.

Tudo que envolve documento, ficha ou canvas continua sendo teste manual dentro de um mundo aberto.

A versão em `system.json` é incrementada **no mesmo commit** da alteração, nunca em um commit
separado — é o que o Foundry compara com o manifesto para oferecer atualização.

## Status

Projeto em desenvolvimento ativo. Próximos passos:

- adaptar os Active Effects ao formato novo da V14 (`system.changes`);
- bônus por posto de tripulação (ex.: o Piloto somando Destreza à Evasão);
- mais testes em mundo real no Foundry.
