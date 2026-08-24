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
- **Integração com IA**: `game.nihility.ai` expõe métodos para gerar Skills Únicas/Ultimate via qualquer provedor compatível com o formato *Chat Completions* (OpenAI, OpenRouter, Groq, Together, LM Studio, Ollama `/v1`, etc.) usando uma chave de API, ou para ingerir JSON gerado externamente.
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
| Moedas Dinâmicas (JSON) | Lista de moedas customizadas |
| Presets de Anatomia por Espécie (JSON) | Overrides/adições aos presets padrão (Humano, Elfo, Slime, Ciborgue) |
| Endpoint de IA | URL compatível com Chat Completions |
| Modelo de IA | Nome do modelo (ex: `gpt-4o-mini`) |
| Chave de API de IA | Bearer token do provedor escolhido |

## API pública

```js
game.nihility.ai.fuseSkills(actor, [itemId1, itemId2], { tier: "unique", mode: "manual", manualData: {...} });
game.nihility.ai.ingestExternalSkillJSON(actor, jsonFromExternalSource);
game.nihility.ai.announceVoiceOfTheWorld(actor, { kind: "info", title: "...", body: "..." });
```

## Status

Projeto em desenvolvimento ativo. Próximos passos: expandir automação de dano/combate, presets adicionais de espécie e testes em mundo real no Foundry.
