# Nihility RPG System

Sistema customizado para [Foundry VTT](https://foundryvtt.com/) (requer **V13+**, verificado até **V14**), construído do zero para suportar tanto campanhas de **Fantasia/Isekai** quanto de **Sci-Fi Arcano**, com automações avançadas via IA e regras profundas de Habilidades e Anatomia.

## Destaques

- **Totalmente modular**: cada bloco do sistema (Economia, Títulos, Anatomia, **Naves e Veículos**, Fusão de Habilidades, Pontos de Habilidade, Pool de Atributos, Resistências, Condições, Habilidades de Área, Assistente de IA e o PAD) liga e desliga por mundo, com **presets de campanha** prontos — Fantasia Medieval, Sci-Fi Arcano ou Misto. Desligar um bloco só esconde a interface e impede criar conteúdo novo daquele tipo: **nada é apagado**, e religar devolve tudo como estava.
- **Fórmula de HP/Mana configurável**: quais Atributos multiplicam cada pool, o multiplicador e o piso são settings — dá até pra desligar o pool de Mana inteiro numa campanha sem magia (as Habilidades continuam funcionando, só deixam de custar recurso).
- **Atributos renomeáveis**: os sete Atributos de Combate podem receber os nomes da sua campanha (ou serem escondidos da ficha) sem quebrar Efeitos, Títulos ou fórmulas já gravados — só o rótulo muda, a chave interna fica.
- **Experiência e progressão**: Personagens **e** Habilidades acumulam XP, com a curva definida por uma fórmula configurável (padrão `100 × nível`). O sistema avisa quando a barra enche; subir de nível continua sendo decisão do Mestre. Cada nível de Habilidade segue um ciclo previsível de **Poder** (multiplica o efeito) e **Desconto** (corta o Custo), e Habilidades podem escalar o dano por um Atributo — numa curva quadrática, a única que acompanha o crescimento do HP.
- **Resistências que aprendem sozinhas**: uma Skill de Resistência ganha XP ao efetivamente bloquear dano — proporcional à fatia da própria Vida que foi salva, então defender um golpe perigoso vale o mesmo no nível 1 e no 50, e arranhão não ensina nada. O sistema também conta quantas vezes o personagem apanhou de cada tipo de dano e **sugere** a Resistência ao Mestre.
- **Iniciativa pelo Atributo**: a iniciativa usa o mesmo pool de d20 escalável do resto do sistema (Atributo configurável, padrão Destreza), em vez do `1d20` solto do Foundry.
- **Dano aplicável pelo chat**: o card de dano ganha botões **Aplicar / Metade / Dobro** (só Mestre) com **Desfazer** — o número já sai com Defesa Mágica e Resistências descontadas, e nada toca a ficha sem clique.
- **Condições no HUD do token**: o catálogo de Condições alimenta a paleta de status do token, então dá pra marcar "Envenenado" clicando no token, com uma tela opcional pra dizer o que a Condição faz (ou nada, e ela vira só o ícone).
- **Moedas e Energia customizáveis**: defina suas próprias moedas (JSON) e o nome do sistema de energia (padrão: *Sistema Eletro-Plasmático (EPS)*).
- **Anatomia por Espécie**: ao trocar a espécie de um personagem, o sistema aplica automaticamente o preset de Partes do Corpo (HP próprio, status Intacto/Danificado/Destruído, próteses/modificações).
- **Fusão de Skills**: funde habilidades da ficha em uma nova, reaproveitando combinações já existentes no Compêndio quando possível. Skills Únicas nascem de gatilhos emocionais/personalidade (modo manual com aprovação do Mestre, ou automático via IA) e **não podem consumir Skills Ultimate**.
- **Compêndios auto-geridos**: Skills, Partes do Corpo, Títulos e Módulos de Nave são registrados automaticamente em Compêndios do Mundo assim que criados — nada se perde ao remover um item de uma ficha.
- **Naves Espaciais e Veículos Terrestres com sistema completo de Módulos**: Porte (Mini→Capital, só o Mestre edita), sete tipos de Módulo de slot único (Reator/Bateria/Distribuidor/Escudo/Motor/Casco/FTL) mais Arma (orçamento de espaço por Porte) e Utilidade, um Grid de Energia inspirado em Elite Dangerous (Reator → Distribuidor → Bateria, com throttle por Módulo e fome de energia por prioridade quando falta capacidade), cascata de dano em 3 camadas (Escudo → Casco → Integridade Estrutural, com Penetração de Arma e Recarga de Escudo), Armas nativas do Módulo (dano/penetração/recarga própria, sobrecarregar bate mais forte mas recarrega mais devagar), ferramentas de ajuste manual do Mestre e uma macro de reparo em campo (`game.nihility.requestShipRepair()`) com rolagem de Destreza. Veículo usa o mesmo sistema, só travado nos dois menores Portes.
- **Editores visuais de Moedas e Presets de Espécie**: sem JSON à mão — telas dedicadas com linhas de add/remover (nas Configurações do Mundo).
- **Assistente de IA (GM)**: janela com botão próprio no diretório de Atores para gerar NPCs, Montarias, Naves Espaciais, Veículos, Notas/Journal e Skills avulsas a partir de um prompt em texto livre, com geração em lote (até 10 de uma vez) e suporte nativo a múltiplos provedores (OpenAI-compatível ou Anthropic/Claude).
- **PAD (celular in-game)**: app estilo smartphone ligado a um Personagem, com status da Nave tripulada, Biblioteca de favoritos (pessoal e compartilhada com a tripulação) e mensagens privadas diretas/em grupo entre personagens. Um jogador só tem acesso se o personagem possuir um Item marcado como dispositivo PAD.
- **Voz do Mundo**: anúncios de nível, fusão e novas habilidades são sempre enviados por *whisper* — nunca publicamente — apenas para o Mestre e o(s) jogador(es) dono(s) do personagem.

## Instalação

### Via manifesto (URL)

No Foundry VTT, aba **Game Systems → Install System**, cole esta URL de manifesto:

```text
https://raw.githubusercontent.com/Lux-Theris/Sistema-Nihility---FoundryVTT/main/system.json
```

### Manual (upload direto)

1. Copie todo o conteúdo deste repositório (system.json, module/, templates/, styles/, lang/) para `Data/systems/nihility-rpg-system/` na instalação do seu Foundry VTT.
2. Reinicie o Foundry (ou atualize a lista de sistemas).
3. Crie um novo Mundo selecionando **Nihility RPG System** como sistema.

## Estrutura do projeto

```text
├── system.json                        # Manifesto do sistema
├── module/
│   ├── nihility-rpg-system.js         # Ponto de entrada (hooks init/ready/combate/chat)
│   ├── config.js                      # Settings, FEATURES, presets de campanha, moedas, espécies
│   ├── dice.js                        # Pool de d20 escalável dos Atributos
│   ├── skill-economy.js               # Fusão, Evolução, Pontos de Habilidade, skills concedidas
│   ├── skill-effects.js               # "Usar Habilidade": dano, efeitos, Condições, upkeep
│   ├── skill-snapshot.js              # Snapshot de Skill em Sub-Skill (compartilhado)
│   ├── area-effects.js                # Habilidades de Emissão (Measured Templates)
│   ├── combat.js                      # Iniciativa pelo pool de Atributo
│   ├── conditions.js                  # Condições na paleta do HUD do token
│   ├── damage-apply.js                # Botões de Aplicar/Desfazer dano no chat
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
│   ├── helpers/                       # foundry-compat.js, world-backup.js,
│   │                                  # gm-relay.js (socket), target-picker.js
│   ├── data/                          # DataModels (character, starship, item)
│   ├── sheets/                        # Fichas de Actor/Item
│   └── apps/                          # Menu, Assistente de IA, PAD e editores de config
├── templates/                         # .hbs de fichas, apps e cards de chat
├── styles/nihility-rpg-system.css
├── test/                              # Testes das funções puras (node --test test/rules.test.mjs)
└── lang/{pt-BR,en}.json
```

> **Idioma**: a interface é escrita em pt-BR direto nos templates. Os arquivos `lang/*.json`
> hoje só valem pelos nomes dos tipos de documento (`TYPES.*`) — o sistema não usa `game.i18n`
> para o resto, então traduzir para outro idioma exigiria uma passada de internacionalização
> de verdade.

## Configuração

Nas **Configurações do Mundo → Configurar Configurações → Nihility RPG System**
(ou pelo botão **Nihility RPG System** no diretório de Atores → aba *Configurações Gerais*):

| Setting | Descrição |
|---|---|
| **Configurar Módulos do Sistema** (botão) | Liga/desliga cada bloco do sistema e aplica um **preset de campanha** (Fantasia Medieval / Sci-Fi Arcano / Misto) |
| Fórmula de HP — 1º/2º Atributo | Quais Atributos são multiplicados para achar o HP Máximo (padrão: Força × Defesa) |
| Usar pool de Mana/Energia | Desligue numa campanha sem magia: a barra some e nenhum Custo de Habilidade é cobrado |
| Fórmula de Mana — 1º/2º Atributo | Idem para a Mana (padrão: Magia × Defesa Mágica) |
| Fórmula de HP/Mana — Multiplicador / Piso | O `×10` e o mínimo de 50 da fórmula, ajustáveis |
| Rótulo de Energia — Personagens / Naves | Nomes customizados para cada energia (ex: Mana, Ki / EPS) |
| Sigla de Energia de Naves | Forma curta usada nas linhas de Módulo, onde o nome inteiro não cabe (padrão: EPS) |
| Pontos de Atributo e de Habilidade (Criação / Por Nível) | Orçamento concedido na criação e a cada nível |
| **Configurar Atributos** (botão) | Renomeia e mostra/esconde cada Atributo de Combate (a chave interna nunca muda) |
| Fórmula de XP | Curva de XP por nível, em texto (padrão `100 * @nivel`); vale para Personagens e Habilidades |
| Atributo de Iniciativa | Qual Atributo rege a iniciativa (padrão: Destreza) |
| Divisor da Escala de Dano | Controla o ritmo da escala quadrática de dano por Atributo (padrão: 10) |
| Habilidade — Poder / Desconto por Nível | Quanto cada nível de Poder multiplica o efeito e cada nível de Desconto corta o Custo |
| Habilidade — Ciclo (Poder / Desconto) e Piso de Custo | Quantos níveis de cada tipo se alternam, e o mínimo a que o Custo pode cair |
| XP de Resistência — Fator | Quanto XP uma Resistência ganha por fração da Vida salva |
| Limiar de Aprendizado de Resistência | Golpes de um mesmo tipo até o sistema sugerir a Resistência ao Mestre (0 = desligado) |
| Permitir alvos fora da cena | Libera a busca no diretório ao escolher alvo — para mesas sem mapa/token |
| **Configurar Moedas** (botão) | Abre o editor visual de moedas (id, nome, ícone, peso, Valor-Base) |
| **Configurar Presets de Espécie** (botão) | Abre o editor visual de espécies e suas Partes do Corpo |
| **Configurar Tipos de Dano** (botão) | Elementos de dano usados por Habilidades e Resistências |
| **Configurar Condições de Status** (botão) | Cegueira, Veneno, Atordoamento e outras condições |
| Provedor de IA | `OpenAI-compatível` (OpenAI, OpenRouter, Groq, Together, LM Studio, Ollama `/v1`...) ou `Anthropic (Claude)` |
| Endpoint de IA | URL Chat Completions — só usado no provedor OpenAI-compatível |
| Modelo de IA | Nome do modelo (ex: `gpt-4o-mini`, ou `claude-sonnet-4-5` no provedor Anthropic) |
| Chave de API de IA | Chave do provedor escolhido |

> **Configurando o Claude**: escolha `Anthropic (Claude)` em Provedor de IA, coloque o nome do modelo (ex: `claude-sonnet-4-5`) e sua chave de `console.anthropic.com` em Chave de API. O Endpoint de IA é ignorado nesse modo.

**Sobre a chave ficar visível a jogadores**: todas as settings de IA acima usam
`scope: "client"` — ficam salvas só no navegador de quem as configura, nunca
sincronizam para outros usuários conectados (diferente de uma setting `scope: "world"`
comum, que vai para todo mundo). Como só o GM usa o Assistente de IA, isso resolve o
vazamento sem precisar de nenhuma infraestrutura extra — mas como efeito colateral,
você precisa reconfigurar essas settings se trocar de navegador ou computador.

## Assistente de IA (GM)

Botão **Nihility RPG System** no rodapé do diretório de Atores → aba *Assistente de IA*. O botão aparece para todo mundo (o Menu tem uma aba *Fichas* que jogadores usam), mas as abas de IA, Geração e Administração são bloqueadas para quem não é Mestre. Se não aparecer em alguma versão do Foundry, abra via macro:

```js
game.nihility.openAssistant();
```

Escolha a tarefa, escreva um prompt em texto livre e clique em Gerar:

| Tarefa | O que cria |
|---|---|
| NPC (Personagem/Criatura) | Actor `character`, com espécie, atributos, biografia e 2–3 skills; aplica o preset de anatomia da espécie automaticamente |
| Montaria | Igual ao NPC, com prompt focado em bestas/montarias |
| Nave Espacial | Actor `starship` já com Porte + um Módulo de cada slot único (Reator/Bateria/Distribuidor/Escudo/Motor/Casco) coerente com o Porte, mais Armas/Utilidade a critério da IA — os números de cada Módulo vêm dos presets do sistema, a IA só escolhe Categoria/Porte |
| Veículo Terrestre | Actor `vehicle` com o mesmo sistema de Módulos acima, travado nos dois Portes menores, mais Velocidade/Combustível |
| Nota / Journal | Uma `JournalEntry` com título e conteúdo |
| Habilidade (Skill avulsa) | Um Item `skill` direto no Compêndio de Habilidades |
| Pergunta Livre | Resposta em texto solto, nada é criado |

O campo **Quantidade** (1–10) gera múltiplos itens da mesma tarefa em sequência — cada um é criado direto (sem prévia individual) e listado no final com um link "Abrir". Atores e Notas gerados vão para uma pasta **IA — Gerado**, mantendo o restante do diretório organizado.

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

O mesmo sistema roda campanhas muito diferentes. Em **Configurar Módulos do Sistema** você liga
e desliga cada bloco, ou aplica um preset inteiro de uma vez:

| Preset | O que fica ligado |
|---|---|
| **Fantasia Medieval** | Títulos, Anatomia, Fusão de Habilidades, Economia, Resistências, Condições e Magia. Sem Naves, Veículos ou PAD. |
| **Sci-Fi Arcano** | Naves, Veículos, PAD, Anatomia (próteses/ciborgues), Economia, Resistências e Condições. Sem Títulos nem Fusão. |
| **Misto** | Tudo ligado — fantasia e sci-fi coexistindo na mesma campanha. |

> **Desligar nunca apaga nada.** O bloco some da interface e para de aceitar conteúdo novo
> (uma Nave nova não pode ser criada com o bloco desligado), mas Atores, Itens e Compêndios que
> já existem continuam intactos e abríveis — religar devolve tudo exatamente como estava. Isso
> vale inclusive para trocar de preset no meio de uma campanha.

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

Os testes cobrem só o que é chamável sem o Foundry: pool de dados e fórmula de iniciativa, curva
de Resistência, curva de XP e XP de Resistência, ciclo de níveis de Habilidade, escala de dano,
presets de Módulo e dano estrutural, conversão de moeda, prompts em lote da IA e snapshot de
fusão. Tudo que envolve documento, ficha ou canvas continua sendo teste manual dentro de um mundo
aberto.

A versão em `system.json` é incrementada **no mesmo commit** da alteração, nunca em um commit
separado — é o que o Foundry compara com o manifesto para oferecer atualização.

## Status

Projeto em desenvolvimento ativo. Próximos passos: presets adicionais de espécie, mais automação
de combate além dos botões de dano e da iniciativa, e testes em mundo real no Foundry.
