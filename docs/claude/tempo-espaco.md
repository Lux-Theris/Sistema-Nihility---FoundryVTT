# Manipulação do tempo: Acelerar e Desacelerar (8e.1–8e.3, 1.105.0)

> Parte do guia do projeto. O índice e as regras que valem em todo lugar estão no `CLAUDE.md` da raiz. Quando o texto diz "abaixo"/"acima" ou cita uma seção que não está aqui, procure-a pelo índice.

Desenho aprovado pelo dono em 22/11 (`temp/ideias-novos-sistemas.md`, "8e", "Respostas do dono ao 8e/8f" e **"Modelo do Acelerado"**, que vale onde o "repetir N vezes" do mapa de interações diverge). Mockup "Grupo Tempo › Ritmo do tempo" aprovado. **Ainda não testado no Foundry.** Ficam para depois: **Parar** (8e.4–8e.6) e **Reverter** (8e.7–8e.8). Tempo e espaço são separados: este bloco é só o tempo; o do espaço será `FEATURES.spaceManipulation`.

Bloco `FEATURES.timeManipulation` (grupo Combate, ligado, leve; atalho `isTimeManipulationEnabled`). Desligado: o grupo "Tempo" some do seletor de efeitos (a não ser no efeito já escolhido) e **nenhum efeito novo nasce** ("o bloco está desligado" no resumo do uso); o que já está salvo ou ativo continua agindo e nada é apagado.

## Onde mora

- Pura, testada (`test/time-rate.test.mjs`): `combat/time-rate-rules.js` (fator, `timeStrength`, `rateSteps`/`timeTurnPlan`, `allowedTicks`, `simulateTicks`, `spendExtra`, textos).
- Foundry: `combat/time-rate.js` (leitura do fator, reserva, início/fim de turno, estados, pagamentos, aviso, ganchos `registerTimeRate`). O efeito é criado em `skills/effects-apply.js` (`applyTimeRateEntry`); os "números por turno" ganharam o parâmetro `{steps, notes}` em `tickPeriodicEffect`/`tickCombatRoundEffects` (effects-apply), `tickRegeneration`, `tickActorUpkeepSkills` (`drainCharacterUpkeep`), `tickIncapacitation`; o `updateCombat` em `nihility-rpg-system.js` chama `endTimeTurn`/`beginTimeTurn` e passa `steps`.

## O efeito "Ritmo do tempo" (8e.1)

- Alvo de efeito `timeRate` (grupo **Tempo**, só Personagem), campo novo do efeito `timeFactor` (maior que 1 acelera; menor que 1 desacelera; 1 não muda nada; limites 0,01 a 1000). Duração: `durationRounds` do efeito; numa **Ativa** vale "enquanto ligada" (âncora, como os outros). O alvo da Skill (si, alvo, área) é o `targetType` da Skill, como sempre.
- **Campo novo = todas as listas:** a entrada de efeito viaja inteira nas listas de cópia (snapshot, Evolução, pedido de Skill); o campo foi posto em `effectEntrySchema`, no editor rápido (`skill-editor-dialog.js`, lê com `clampTimeFactor`), na ficha (`item-sheet.js` + `effect-cards.hbs`; o `timeFactor` nunca grava 0), na IA (`ai-mechanics.js`, descarta fator 1), na frase (`skill-summary.js`), no custo sugerido (`skill-cost-rules.js`, `timeFlat`) e nos avisos (`timeRateOne`, `timeRateForever`, `timeRateShip`).
- O Active Effect carrega `flags.<sistema>.timeRate = {factor}` (o fator **já enfraquecido**), mais `sourceLevel`/`magic`/`tech`/`appliedBy` como os outros: a Antimagia e o PEM o apagam pelo nível e pela natureza da Skill, o Dissipar também. Sem `changes`. Reaplicar da mesma Skill pelo mesmo autor **renova** (não duplica); Skills diferentes **multiplicam** (×2 e ×3 = ×6, produto limitado a 0,01–1000).
- **Mana investida** (Mana variável) aumenta o fator: `1 + (N − 1) × investPower`.
- **Recusa** em Nave/Veículo ("não se aplica a …"); Estrutura não é Ator e nem chega aqui. Fator 1 e bloco desligado também dão nota no resumo.
- O fator da pessoa é `actorTimeFactor(actor)` (produto dos efeitos ligados). Entra em `personalRateFactors` (world-time.js): linha × Região × efeito.
- Ganchos (Mestre designado): ao **criar/apagar/desligar** o efeito, `syncPersonalTime(actor)` reajusta o trecho do tempo pessoal (como as câmaras); ao criar em quem é o combatente da vez, a reserva já vale neste turno; ao apagar o último efeito, a reserva e a fração somem; no fim do combate (`deleteCombat`) as reservas somem (a fração fica).

## Em combate (8e.2)

No `updateCombat`, uma vez por turno (guarda `turnProcessed`), antes dos ticks: `endTimeTurn` (do combatente **anterior**, por `combat.previous.combatantId`) e `beginTimeTurn` (do atual).

- **Reserva** = o fator (parte inteira), volta a N a cada turno do dono; o que sobra se perde; a **fração acumula** em `flags.timeCarry` (×2,5: 2, 3, 2, 3…, `rateSteps`). Guardada em `flags.timeReserve = {value, max, spent, factor}` no Ator. Aparece na ficha (pílula "Acelerado ×N · 89 / 100 de tempo"), no Token (selo "×3 · 2", `effect-badge-rules.js`) e no Painel do combate (coluna Tempo, botões **−1** e **−X…** só do Mestre, `adjustReserve`).
- **Números por turno passam na hora**, `steps` = N (a reserva não é gasta por eles), **limitados pela própria duração** e simulados em memória, **sem teto de repetições**: periódicos (`allowedTicks` + `simulateTicks`: Veneno de 10 com 5 turnos restantes e ×100 = −50 e acaba; cai a 0 no meio e para ali; uma Ativa segurando o efeito só é limitada pelo N), regeneração (ganho × steps, travado no máximo e no teto das partes), custo das Ativas do próprio alvo (`drainCharacterUpkeep`: volta a volta, as Ativas disputam o pool em ordem; quem não é coberto desliga ali), Radiação (`passRadiationTimeFor([actor], N − 1)` além do tick normal) e Vida 0 (o contador anda N vezes, para ao acordar ou na morte). Cada assunto já tinha o seu card; o **aviso do começo do turno** (`announceTimeTurn`: card no chat + cartão na tela para todos, "X está Acelerado ×N: tem N de tempo neste turno." com a tabela do que passou) resume.
- **Deslocamento × N** (`budgetFor` em movement.js, `scaledMovement`); Desacelerado anda ÷N.
- **Estados** (buff/debuff de atributo, Condições de controle: todo efeito de Skill com prazo em rodadas que não seja periódico, "Preparando", de tempo, mantido por Ativa ou Maldição) andam **por reserva gasta**: o turno do mundo já conta 1 (o núcleo), então só o resto rende rodadas a mais (`spendExtra`: gastar tudo = N − 1). `spendReserve` anda e, **no fim do turno, o que sobrou também conta** (`endTimeTurn`). Prazo reescrito por `effectRoundsUpdate` (apaga se acabou). **Buff lançado em outra pessoa dura no tempo dela** (ela é quem tem a reserva).
- **Preparo e Recarga pagos pela reserva** quando ela basta, automaticamente: Preparo de P rodadas **dispara na hora** pagando o Custo inteiro (−P; `prepByReserve` em `useSkillEffect`); Preparo já em andamento: paga as parcelas que faltam e os turnos que faltam e dispara (`settleTimersByReserve`); Recarga (nova ou de antes): ao usar de novo, paga o valor guardado (o "falta + 1") e a Skill volta. `useBlockReason` e `skillTimersFor` já não barram/desligam o botão quando a reserva cobre. Sem reserva suficiente, a regra normal.
- **Desacelerado** (N < 1): sem reserva. `steps` é `floor(N + sobra)` (×½: 0, 1, 0, 1…): num turno de 0 passos, Recarga/Preparo, periódicos, regeneração, custo das Ativas, radiação e Vida 0 **não andam**; nesses turnos os prazos dos estados ganham +1 rodada (o núcleo contou uma). O mundo (ambiente, Contágio, Estruturas, Zonas, superfícies) segue 1×.
- **Simulador de encontro:** a cadência (golpes por rodada) × o fator, e os usos que cabem na Mana ÷ N (`unitFor.timeFactor`).
- Em combate "o mundo para" numa linha lenta, o tempo pessoal do combatente soma a rodada × o fator.

## Fora de combate e alvo mais forte (8e.3)

- O tempo pessoal anda × o fator (`personalRateFactors`); Passar tempo (radiação etc.) já multiplica por `personalRate`.
- **Alvo mais forte:** `timeStrength(nívelDaSkill, nívelDoAlvo)`: efeito cheio até o nível da Skill; acima, cai em linha reta e zera quando o alvo tem o dobro do nível (o fator vai em direção a 1, `weakenTimeFactor`). **Não** usa `healBlockReduction` (ela só zeraria no 2× de 4/3 do nível). Calculado **ao aplicar**: se o nível do alvo mudar depois, o efeito já posto não é recalculado.

## Limites conhecidos

- Maldições (`tickCurses`), regeneração dos Escudos/Estruturas mantidos, Contágio, Zonas e Estruturas **não** passam N vezes (1× por turno do mundo).
- Os cards de chat da Vida 0 saem um por passo; só os periódicos juntam os N ticks num número. O aviso da tela resume.
- O gasto da reserva não entra no "Desfazer uso"; o botão −X é do Mestre (os jogadores só gastam pelos pagamentos automáticos).
- "Estados" excluem efeitos presos a Ativa (duram enquanto ela estiver ligada) e Maldição; Preparo/Recarga de Skill emprestada (Corredor/Pacto) não usam a reserva.
- A reserva e a fração são flags do Ator (recarregar a página não perde nada). Reserva só em combate iniciado; fora dele, só o tempo pessoal ×N.
