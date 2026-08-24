# Nihility RPG System

Sistema customizado para [Foundry VTT](https://foundryvtt.com/) (compatível com **V12** e **V13+**), construído do zero para suportar tanto campanhas de **Fantasia/Isekai** quanto de **Sci-Fi Arcano**, com automações avançadas via IA e regras profundas de Habilidades e Anatomia.

## Destaques

- **Totalmente modular**: Economia, Títulos e Anatomia podem ser ativados/desativados individualmente pelas Configurações do Mundo.
- **Moedas e Energia customizáveis**: defina suas próprias moedas (JSON) e o nome do sistema de energia (padrão: *Sistema Eletro-Plasmático (EPS)*).
- **Anatomia por Espécie**: ao trocar a espécie de um personagem, o sistema aplica automaticamente o preset de Partes do Corpo (HP próprio, status Intacto/Danificado/Destruído, próteses/modificações).
- **Fusão de Skills**: funde habilidades da ficha em uma nova, reaproveitando combinações já existentes no Compêndio quando possível. Skills Únicas nascem de gatilhos emocionais/personalidade (modo manual com aprovação do Mestre, ou automático via IA) e **não podem consumir Skills Ultimate**.
- **Compêndios auto-geridos**: Skills, Partes do Corpo, Títulos e Módulos de Nave são registrados automaticamente em Compêndios do Mundo assim que criados — nada se perde ao remover um item de uma ficha.
- **Naves Espaciais**: Casco, Escudos, Manobra e um Grid de Energia (Reator + Capacitores) com alerta automático de sobrecarga.
- **Veículos Terrestres**: Integridade, Velocidade, Combustível/Bateria e Peças.
- **Editores visuais de Moedas e Presets de Espécie**: sem JSON à mão — telas dedicadas com linhas de add/remover (nas Configurações do Mundo).
- **Assistente de IA (GM)**: janela com botão próprio no diretório de Atores para gerar NPCs, Montarias, Naves Espaciais, Veículos, Notas/Journal e Skills avulsas a partir de um prompt em texto livre, com geração em lote (até 10 de uma vez) e suporte nativo a múltiplos provedores (OpenAI-compatível ou Anthropic/Claude).
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
│   ├── nihility-rpg-system.js         # Ponto de entrada (hooks init/ready)
│   ├── config.js                      # Settings, moedas, energia, presets de espécie
│   ├── ai-helper.js                   # Fusão de skills, IA, Compêndios, Voz do Mundo
│   ├── data/
│   │   ├── character-model.js         # DataModels de Personagem/Criatura
│   │   ├── starship-model.js          # DataModels de Nave/Veículo
│   │   └── item-models.js             # DataModels de Item (skill, body_part, title, ...)
│   └── sheets/
│       ├── actor-sheet.js
│       ├── starship-sheet.js
│       └── item-sheet.js
├── templates/
│   ├── actor-sheet.hbs
│   ├── starship-sheet.hbs
│   ├── item-sheet.hbs
│   └── chat/voice-of-the-world.hbs
├── styles/nihility-rpg-system.css
└── lang/{pt-BR,en}.json
```

## Configuração

Nas **Configurações do Mundo → Configurar Configurações → Nihility RPG System**:

| Setting | Descrição |
|---|---|
| Sistema de Moedas/Economia | Liga/desliga o rastreamento de moedas na ficha |
| Sistema de Títulos | Liga/desliga Títulos |
| Sistema de Anatomia/Modificação Corporal | Liga/desliga Partes do Corpo e presets por espécie |
| Rótulo do Sistema de Energia | Nome customizado da energia (ex: Mana, EPS, Ki) |
| **Configurar Moedas** (botão) | Abre o editor visual de moedas (id, nome, ícone, peso) |
| **Configurar Presets de Espécie** (botão) | Abre o editor visual de espécies e suas Partes do Corpo |
| Provedor de IA | `Relay Seguro (Cloudflare)` — recomendado — ou `OpenAI-compatível`/`Anthropic (Claude)` diretos |
| URL do Relay / Token do Relay | Só para o provedor Relay Seguro — ver seção abaixo |
| Endpoint de IA | URL Chat Completions — só usado no provedor OpenAI-compatível direto |
| Modelo de IA | Nome do modelo — só usado nos provedores diretos (o Relay define o modelo do lado dele) |
| Chave de API de IA | Chave do provedor escolhido — só usada nos provedores diretos, ⚠️ ver aviso abaixo |

> **Configurando o Claude direto** (sem Relay): escolha `Anthropic (Claude)` em Provedor de IA, coloque o nome do modelo (ex: `claude-sonnet-4-5`) e sua chave de `console.anthropic.com` em Chave de API.
>
> ⚠️ **Segurança da chave de API nos provedores diretos**: settings de mundo (`scope: "world"`) são sincronizadas para **todos os clientes conectados**, não só o Mestre — qualquer jogador consegue ler a chave pelo Console do navegador (F12), mesmo com o Assistente de IA restrito ao GM na interface. Use o **Relay Seguro** para evitar isso, ou só use os provedores diretos com jogadores de confiança / chave com limite de gasto.

### Relay Seguro (recomendado)

Um pequeno Worker do Cloudflare guarda a chave real do provedor de IA fora do
Foundry — o mundo só guarda um token trocável, não a chave de verdade. Gratuito
(plano free da Cloudflare cobre bem mais que o uso de uma mesa de RPG) e sem precisar
manter servidor nenhum ligado. Passo a passo completo em
[`tools/ai-relay/README.md`](tools/ai-relay/README.md) — o código do Worker está em
[`tools/ai-relay/cloudflare-worker.js`](tools/ai-relay/cloudflare-worker.js).

## Assistente de IA (GM)

Botão **🤖 Assistente de IA** no rodapé do diretório de Atores (visível só para o Mestre). Se não aparecer em alguma versão do Foundry, abra via macro:

```js
game.nihility.openAssistant();
```

Escolha a tarefa, escreva um prompt em texto livre e clique em Gerar:

| Tarefa | O que cria |
|---|---|
| NPC (Personagem/Criatura) | Actor `character`, com espécie, atributos, biografia e 2–3 skills; aplica o preset de anatomia da espécie automaticamente |
| Montaria | Igual ao NPC, com prompt focado em bestas/montarias |
| Nave Espacial | Actor `starship` (Casco, Escudos, Grid de Energia) |
| Veículo Terrestre | Actor `vehicle` (Integridade, Velocidade, Combustível/Bateria) |
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
```

## Status

Projeto em desenvolvimento ativo. Próximos passos: expandir automação de dano/combate, presets adicionais de espécie e testes em mundo real no Foundry.
