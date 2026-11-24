# Lojas (G2): comprar, vender e avaliar

> Parte do guia do projeto. O índice e as regras que valem em todo lugar estão no `CLAUDE.md` da raiz. Quando o texto diz "abaixo"/"acima" ou cita uma seção que não está aqui, procure-a pelo índice.

Lote A (1.110.0): núcleo da loja. Lote B (1.111.0): máquina de venda, troca entre jogadores, saque no corpo, pilhas no mapa, depósito de entregas e "Mostrar aos jogadores". Mockups aprovados pelo dono (Design "H20 Pastas e G2 Lojas", quadros 3 a 10). Decisões do dono em `temp/ideias-novos-sistemas.md` (G2). Lote C (1.112.0): app Compras do PAD, destino e prazo de entrega (ver "Lote C" abaixo).

## O que existe

- **Bloco `FEATURES.shops`** ("Lojas", filho de `economy`, grupo Mundo, ligado nos três presets). Desligado: some a aba Loja, a Vitrine e o bloco "Venda em lojas" do Item; **nada salvo é apagado** (estoque, preços, histórico ficam). Leitor: `isShopsEnabled()`.
- **Uma loja é uma ficha de Personagem** com `system.shop.enabled`. Os Itens da ficha são o estoque; as moedas da ficha são o caixa. Campos (`CharacterDataModel.shop`): `enabled`, `kind` (`"vendor"` NPC narrado | `"auto"` ponto automático), `multiplier` (1), `buybackFraction` (0,5, só vale em `auto`), `randomizer` (teto do sorteio em %, 25), `seed`, `limitedFunds` (false), `restockDays` (0 = não), `lastRestock` (relógio do mundo, s), `online` (a loja aparece no app Compras do PAD, lote C), `deliveryHours` (prazo padrão de entrega dos itens físicos, horas do mundo; 0 = na hora), `history` (as últimas 12 transações).
- **Bloco `shop` do Item** (Item Geral **e** Módulo de nave, `shopItemSchema()`): `basePrice` (preço geral de referência; 0 = usa o "Valor" do Item), `currency` (vazio = a moeda do Valor, ou a primeira da lista no Módulo), `stock` (vazio/null = infinito), `restockTo` (quanto o estoque volta a ter ao reabastecer; vazio = não repõe), `priceOverride` (preço fixo nesta loja, vence tudo), `digital` (software: na compra online chega na hora no inventário) e `deliveryHours` (prazo próprio do item; vazio = o da loja), `tags` (viram categorias na vitrine). Editado na ficha do Item (seção "Venda em lojas", partial `nihility.itemShop`; os campos raros ficam num "Avançado ▸"). Etiquetas: texto separado por vírgula, gravado como lista por um ouvinte (`data-shop-tags`).
- **Regras puras** em `economy/shop-rules.js` (testadas em `test/shops.test.mjs`): `normalizeShop`/`normalizeItemShop`, `shopFactor(seed, itemKey, pct)` (hash FNV determinístico entre 1−pct e 1+pct; a chave é o NOME do item), `finalPriceUnits` (base × multiplicador × fator; `priceOverride` vence tudo; nunca 0 por arredondamento quando há preço), `buybackUnits`, `soldUnitsFactor` (consumível com cargas pelo proporcional; vender parte da pilha leva as cheias e deixa a aberta; vender tudo leva a aberta pelas cargas que restam), `openAmmoFactor`, `sellBlockedReason`, estoque (`canBuyStock`, `stockAfter`…), `restockDue`, dinheiro (`payUnits`, `creditUnits`, `walletUpdate`, `formatMoney`), histórico (`pushHistory`, `canUndoEntry`), troca de dois lados (`newTrade`, `tradeSet`, `tradeAccept`, `tradeReady`), categorias/busca da vitrine, `appraisalSuggestion`, `shopSetupIssues`.
- **Dinheiro em unidades base.** Todo preço e saldo vira inteiro em unidades do `baseValue` das moedas. `payUnits` gasta primeiro as moedas exatas (a do preço, depois as maiores sem passar) e, se faltar, as menores que cobrem o resto, devolvendo o troco em moedas; `creditUnits` paga na moeda do preço e o resto nas menores. O catálogo de moedas é o de `getActiveCurrencies()`.
- **Aba "Loja"** na ficha do Personagem (`sheets/shop-tab.js` + `templates/parts/actor-shop.hbs`; só o Mestre; parte `shop` de `NihilityActorSheet`, ações em `SHOP_TAB_ACTIONS`): liga a loja, tipo, multiplicador, sorteio, compra de volta (campo em %, `data-shop-buyback`), moedas limitadas, reposição (dias; "Reabastecer agora"; "Sortear preços de novo"), `online`, lista do estoque (preço padrão em cinza, preço da loja com a diferença em %, "fixo", estoque/∞ e ajuste por linha, ajuste em lote nos marcados), histórico com "Desfazer" só na última venda, botão "Abrir vitrine" (o Mestre vê como cliente) e "Abrir avaliações". Estoque e ajuste por linha são campos sem `name` (ouvintes em `bindShopTab`), porque o `Item` é outro documento.
- **Vitrine** (`apps/shop-storefront.js`): quem o Mestre incluiu em "Mostrar aos jogadores" (ver abaixo) recebe a Vitrine, **nunca a ficha**. Abas Comprar/Vender, categorias, busca, quantidade por linha, destino da compra (inventário ou porão de uma nave de que o personagem é tripulante, `findCrewedShipsForActor`). Vender: `auto` vende direto pela fração; `vendor` mostra "Pedir avaliação".
- **Avaliação** (`apps/shop-appraisal.js`, só o Mestre): fila de pedidos, valor por linha (sugerido = preço padrão × fração, "Reaplicar"), total editável (mexer numa linha refaz o total; mexer no total não muda as linhas), moeda da oferta, "Oferecer N" / "Recusar". Abre sozinha no Mestre designado quando chega um pedido novo.
- **Troca de dois lados é genérica.** O estado da avaliação é um `newTrade()`: lados `a` (itens + moedas) e `b`, aceite de cada lado, `rev`; qualquer mudança real apaga os dois aceites. Guardado nos flags da loja (`flags.<sistema>.shopTrades`), então todos os clientes veem o mesmo. A janela de avaliação é só o lado do Mestre; a troca entre dois jogadores (lote B) reaproveita `newTrade`/`tradeSet`/`tradeAccept`/`tradeReady`.
- **Integrações do dono:** Glossário (`shop`, `shopBuyback`, `shopAppraisal`), Regras desta mesa (seção "Lojas" na página "Como se joga"), Validar Mundo (loja aberta sem estoque ou toda esgotada, item à venda sem preço, ficha que os jogadores não enxergam, ponto automático com compra de volta 0%).

## Transação: tudo pelo Mestre designado

Quatro ações do relay (`RELAY_HANDLERS` de `economy/shops.js`, nomes em `relay-action-names.js`): `shopBuy`, `shopSell`, `shopTrade` (`op`: `open`, `offer`, `accept`, `refuse`, `close`) e `shopUndo`. Os pedidos do cliente vão por `askBuy`/`askSell`/`askTrade`/`askUndo` (`runAsGm(..., {reply: true})` + `relayFailureMessage`). Regras:

- **O cliente só diz "qual item, quantos"**: o Mestre recalcula o preço a partir dos documentos (`shopListing`/`sellValue`), confere estoque, saldo (em qualquer moeda), equipado/contêiner com coisas dentro, descarrega arma carregada antes de vender (`returnLoadedAmmo`, exportada de `consumables.js`: a munição volta ao inventário de quem vende) e só então move itens e moedas. Quem pediu tem de ser dono do comprador/vendedor (`ownedDoc`); `shopUndo` e a oferta da avaliação são só do Mestre (`user.isGM`).
- **Uma transação por vez** (`serialized`): duas compras juntas não leem o mesmo estoque.
- **Card no chat + aviso na tela** pela Voz do Mundo (`announceVoiceOfTheWorld`, `kind: "shop"`): vai ao Mestre e aos donos de quem comprou/vendeu.
- **Desfazer (Mestre)** reverte a última transação ainda não desfeita, a partir do histórico (`ops`: `gain`/`shopGain`/`loss`/`stock`, `partyDelta`/`shopDelta`): confere tudo antes de mexer e recusa com motivo ("já gastou esse dinheiro", "o item já não está com…"). Só a última se desfaz (desfazer uma do meio embaralharia o estoque).
- **O que a loja guarda ao comprar do jogador** entra no estoque dela com `stock` = a quantidade (soma na pilha igual; pilha infinita continua infinita). O Item que o jogador compra nasce sem estoque, sem ajuste e sem `restockTo`.
- **Caixa:** o que o jogador paga entra sempre nas moedas da ficha da loja. Com `limitedFunds` (só `vendor`) a loja só paga o que tiver; sem ele não debita.
- **Reabastecer:** `restockShop` (semente nova + estoque dos Itens com `restockTo` volta a ele + `lastRestock`), no botão e, com `restockDays > 0`, pelo relógio do mundo (`checkRestocks`, no `updateWorldTime` e no `ready`, só no Mestre designado). A semente só muda aí (ou em "Sortear preços de novo"): abrir a loja não muda preço.

## Armadilhas e limites conhecidos

- **Acesso (mudou no lote B):** nenhuma permissão na ficha da loja é necessária nem pedida. O acesso é "Mostrar aos jogadores" (`system.shop.shownTo`, lista de userIds). O Validar Mundo não cobra mais Observador.
- **Ficha vinculada:** loja com Token não vinculado tem seus dados no Ator sintético; use ficha vinculada. A reposição pelo relógio varre só `game.actors`.
- **Estoque finito espelha `system.quantity`** (o `stock` e a `quantity` do Item andam juntos); infinito ignora a quantidade.
- **Módulo de nave** tem o bloco `shop` mas não tem "Valor": o preço sai só de `basePrice`. Comprar para o porão de uma nave passa pelos portões de instalação normais (`preCreateItem`); se recusarem, a compra é recusada sem cobrar.
- **O preço do sorteio é por NOME de item** (dois itens com o mesmo nome têm o mesmo fator).
- Estados de tela (aba, categoria, quantidades, valores da avaliação) não são salvos.
- Não testado dentro do Foundry (só as regras puras são testadas em Node): ver a lista de testes manuais no relatório do lote.

## Lote B (1.111.0)

Mockups aprovados: quadros 6 a 10, mais "Entregas vão para" (Ambiente da pasta e da cena). Tudo sob `FEATURES.shops`; opção **"Perto, em metros"** (`shopLootRange`, padrão 2, `getShopLootRange()`).

### Mostrar aos jogadores (acesso à loja)

- Aba Loja: **"Mostrar aos jogadores"** abre um diálogo no estilo do Mostrar dos Diários (todos ou alguns) e **"Esconder dos jogadores"** limpa a lista. Código em `economy/shop-show.js`.
- Os escolhidos ficam em `system.shop.shownTo`. Quem acabou de entrar na lista recebe a Vitrine aberta na hora (o `updateActor` leva `options.nihilityShow` com os userIds novos; cada cliente abre a sua) e um card no chat só para eles com o botão **"Abrir loja"** (`renderChatMessageHTML`). Clicar no Token da loja (clique perto de um Token) abre a Vitrine para quem está na lista.
- **No relay, comprar/vender/pedir avaliação só vale** para o Mestre, para quem está em `shownTo` ou, numa **máquina de venda**, para quem está a até "perto" do Token dela (`shopAccess` em `shops.js`; o cliente manda `tokenUuid` e o Mestre confere que o Token é da loja e a distância). A compra online do lote C (`shopOrder`) é outra ação e não usa a lista.
- **Caminho de dados (a confirmar no Foundry):** a Vitrine lê a loja localmente pelo documento do mundo, sem pedir permissão ao Mestre. Se o Foundry da mesa **não** entregar o Ator da loja a um jogador sem permissão (o `fromUuid` volta nulo), o plano B é o Mestre mandar um retrato pronto da vitrine; **isto não foi implementado** (não testado em Foundry). Se acontecer, o sintoma é a Vitrine não abrir e o botão "Abrir loja" avisar "não está disponível". Fica no roteiro de testes.
- Não há botão no HUD do Token da loja (só na aba Loja).

### Máquina de venda (quadro 6)

- Aba Loja, ponto automático: campo **Aparência** = "Máquina de venda" (`shop.style = "machine"`; só vale com `kind: "auto"`, senão abre como vitrine comum e o Validar Mundo avisa). `openStorefront` abre `apps/shop-machine.js`.
- Produtos em ordem de nome, 16 por prateleira (A, B, C…, até 26); código `A03` = letra + posição. Teclado (A–D trocam a prateleira, dígitos, ↺), display com saldo e preço, esgotado fica na vitrine com o código. **Mesmo motor de compra** (`askBuy` → `shopBuy`). Não compra de volta (`shopSell` recusa).
- **A gaveta é só visual:** o item entra no inventário na hora da compra e o produto "cai" na bandeja (animação CSS, respeita `prefers-reduced-motion`); PEGAR esvazia a bandeja. Nada fica preso.
- Clique no Token da máquina a até 2 m abre a máquina (qualquer jogador, sem estar em `shownTo`).
- Fora: destino da compra para o porão de uma nave (a máquina entrega só no inventário).

### Troca entre jogadores (quadro 7)

- Abre por **"Trocar com…"** no cabeçalho da ficha de Personagem (dono; não aparece em loja): lista os outros personagens de jogador com a distância; longe ou sem Token na cena aparecem desabilitados. Só convida quem está a até "perto". **Desde a 1.115.0** lojas, depósitos e pilhas do mapa também aparecem e ficam clicáveis só a até 2 m ("como guardar dentro do armário"): abrem a Vitrine ou a janela de saque que já existem, sem convidar ninguém e sem dar permissão na ficha (ver [sensores-abordagem.md](sensores-abordagem.md)).
- `economy/player-trade.js` + `apps/player-trade.js`. Reaproveita `newTrade/tradeSet/tradeAccept/tradeReady`. Cada lado edita só o próprio personagem (itens com quantidade e moedas em qualquer moeda); mudar a oferta apaga os dois aceites e marca `changedBy`; o outro lado vê "X mudou a oferta" (e a janela abre sozinha, mais um aviso na tela).
- Estado: **setting do mundo** `playerTrades` (JSON `{trades, log}`), escrita só pelo Mestre designado; todos leem e redesenham pelo `onChange` (gancho `nihilityPlayerTradesChanged`). Trocas fechadas somem após 10 min.
- Relay `playerTrade` (`op`: `open`, `set`, `accept`, `cancel`, `close`): o Mestre revalida a cada passo (dono do lado, itens, quantidades, equipado/contêiner cheio, saldo) e, no aceite dos dois, **executa de uma vez**; confere a distância de novo. Falhou no meio: `revertOps` devolve os itens e a carteira do primeiro lado volta. Arma carregada é descarregada antes (a munição volta ao dono).
- Card no chat (Voz do Mundo, para o Mestre e os donos dos dois). **Desfazer** (relay `playerTradeUndo`, só Mestre, última troca, confere dinheiro e itens): botão na janela Ambiente da cena, seção "Lojas e pilhas". O log guarda as últimas 6.

### Saque no corpo (quadro 8), pilhas (quadro 9) e depósito (quadro 10)

- **Uma janela só** (`apps/shop-loot.js`, `economy/loot.js`), três fontes (`sourceKind`): `body`, `pile`, `deposit`. Pegar um item (com quantidade), "Pegar tudo" e, no corpo, as moedas (vão para o saldo na mesma moeda). Contêiner leva o que tem dentro (os filhos entram no contêiner novo). Peso: o sistema só **avisa** quando passa dos espaços, como no arrastar para a ficha.
- Relay **`lootTake`** (`op`: `item`, `all`, `coins`). O Mestre resolve a fonte, confere o taker (dono, Personagem, não loja), o corpo (`bodyIsLootable`), a distância borda a borda (não vale para o Mestre) e **o que o jogador pode ver** (no depósito só o que é dele). Item que já saiu: "esse item já foi pego" e a janela se atualiza (banner). Uma transação por vez; falha no meio devolve o que moveu.
- **Corpo saqueável:** NPC com Vida 0 ou qualquer personagem morto (`bodyLootable`); PJ caído **não** (tem contador de morte). Loja nunca. Dono do corpo não saqueia o próprio (usa a ficha). O corpo fica no mapa; o Mestre limpa.
- **Clique perto:** listener nativo de `click` no canvas (captura, só quando a camada ativa é a de Tokens, só jogador; arrasto de mais de 6 px não conta). Acha o Token sob o clique (corpo, pilha, depósito, máquina, loja mostrada) e abre a tela própria **sem precisar de permissão na ficha**. Longe: aviso "Você está a 3,4 m · chegue a 2 m". Mestre: clique duplo no Token abre a mesma janela (a "ficha" do Ator `pile` é só um atalho, `sheets/pile-sheet.js`).
- **Pilha** = Token **não vinculado** de um Ator do tipo novo **`pile`** (`data/pile-model.js`, `kind: "pile"|"deposit"`), criado a partir de um Ator modelo único ("Pilha (modelo do sistema)", criado sob demanda). Arrastar um Item da ficha para o mapa (`dropCanvasData`) pergunta a quantidade e pede `pileDrop`: o Mestre confere dono, equipado/contêiner e distância, **junta** com uma pilha a menos de ¾ de casa ou cria o Token (marcado com a flag `pile`), e move. A pilha **some quando esvazia**. O Mestre arrastando um Item do Diretório para o mapa também cria uma pilha.
- **Limpar pilhas da cena** (relay `pilesClear`, só Mestre): botão na janela Ambiente da cena, com confirmação (quantas pilhas, quantos itens); corpos e depósitos não são tocados; registro na Voz do Mundo (sem desfazer: use o ponto de restauração).
- **Depósito** = Ator `pile` com `kind: "deposit"` (linkado ao Token, **sem** permissão padrão para os jogadores: com Observador eles abririam a ficha e veriam os itens dos outros; o clique a 2 m é tratado pelo sistema e a janela filtra o conteúdo. A pilha também nasce sem permissão). Cada Item leva a flag `delivery` `{ownerUuid, ownerName, from, status: "transit"|"arrived", arriveAt, orderedAt}`. Jogador vê **só o que é dele** (chegou: Pegar / Pegar tudo meu; a caminho: com "chega em 1 dia · 3h"), o Mestre vê tudo e a entrega vai para o dono. Item no depósito sem marca de dono só aparece para o Mestre (e o Validar Mundo avisa).
- **Para o lote C:** `deliverToDeposit(deposit, item, qty, {owner, from, arriveAt})` (Mestre) põe o item marcado; sem `arriveAt` (ou já passado) nasce "chegou" e o dono recebe o aviso na tela ("Seu X chegou ao Depósito Y", Voz do Mundo); com prazo futuro nasce "a caminho" e `settleDeliveries` (no `updateWorldTime` e no `ready`, Mestre designado) vira "chegou" e avisa. `depotForScene(scene)` devolve o depósito da cena (campo herdado da pasta).
- **"Entregas vão para"**: campo **`depotId`** (uuid do Ator) em `SCENE_FIELDS` (H20), na janela Ambiente da pasta e da cena, com herança e "voltar a herdar"; botão **"+ Criar depósito"** cria "Depósito: <nome da pasta/cena>" e **já grava** o campo (só ele). Sem Token no mapa o depósito existe do mesmo jeito.
- **Regras desta mesa, Glossário (`shopShow`, `vendingMachine`, `playerTrade`, `loot`) e Validar Mundo** (cena ou pasta com depósito que sumiu, pilha vazia ou parada há 7+ dias, item sem dono no depósito, máquina em loja de vendedor NPC).

### Ações novas do relay

`lootTake`, `pileDrop`, `pilesClear`, `playerTrade`, `playerTradeUndo` (40 no total antes do lote C; o lote C soma `shopOrder`: 41). Pedidos do cliente: `askLoot`, `askPlayerTrade`, `askUndoLastTrade`, `askClearPiles`.

## Limites conhecidos do lote B

- **Nada disto foi testado dentro do Foundry** (só as regras puras, em `test/loot.test.mjs`).
- Distância é 2D, borda a borda, sem elevação nem paredes; `canvas.canvasCoordinatesFromClient` e o evento `click` do canvas dependem da versão (`canvas.app.canvas` na V14, `.view` na V13).
- Pilha larga só vale numa cena ativa para o Mestre que processa; grade hexagonal/sem grade centraliza o Token no ponto em vez de encaixar na casa.
- No depósito o jogador **não vê** os itens dos outros (o mockup mostrava com botão desabilitado; o dono pediu "só o que é dele").
- Trocas só entre dois personagens com Token na mesma cena; trocar sem Token (narrado) é pelo Mestre movendo os itens.
- Estado de tela (aba, quantidades) não é salvo. Sem botão de "Mostrar" no HUD do Token.

## Lote C (1.112.0): app Compras do PAD

Mockup aprovado: Design "H20 Pastas e G2 Lojas", Pad.dc.html (quadros 1 a 7). Código: `economy/shop-online.js` (relay, leitura, pedidos), `pad/pad-shop.js` (contexto e ações do app dentro do PAD), `templates/apps/nihility-pad.hbs` (seção `pad-sp`), CSS no fim de `18-shops.css`. Regras puras em `shop-rules.js` (bloco "Compras online"), testes em `test/shop-online.test.mjs`. Tudo sob `FEATURES.shops`.

- **O app.** Ícone "Compras" na tela inicial do PAD quando as Lojas estão ligadas e há ao menos uma loja `online` visível para o cliente. Quatro abas de celular: Início (busca, categorias redondas, grade de produtos de todas as lojas), Lojas (cartões com banner, etiquetas "software · na hora" e "entrega 2 dias"; tocar filtra o Início por aquela loja), Carrinho (itens de várias lojas, destino, total, saldo) e Entregas. A página do produto abre por cima (quantidade, "Adicionar ao carrinho · preço"). O carrinho e a aba ficam só no PAD aberto (estado de tela, não salvo).
- **Rede.** `networkFor(actor)`: cena "tem rede" (herdada da pasta, H20) ou Região com rede, e sem a Condição de supressão tecnológica (PEM). Sem isso o app mostra "Sem conexão" + "Tentar de novo" (o ícone fica apagado na tela inicial, mas abre). **Com o bloco Calendário desligado a rede não existe como conceito e vale sempre** (só o PEM bloqueia); lembre disso ao desligar o Calendário numa mesa que usa lojas online.
- **Sem `shownTo`.** A loja online aparece para quem tem rede, sem "Mostrar aos jogadores". Nenhuma tela exige permissão na ficha da loja: o catálogo é lido localmente (`game.actors`), como a Vitrine. **Se o Foundry da mesa não entregar o Ator da loja ao jogador, o ícone nem aparece** (mesmo plano B da Vitrine: o Mestre mandar um retrato; não implementado). A referência do depósito também é lida só pelo campo da cena (o jogador pode não enxergar o Ator do depósito); o nome cai em "Depósito do lugar" se não resolver.
- **Destino obrigatório** (só quando o carrinho tem item físico): `depotForScene(cena do Token do comprador)` (com herança da pasta) ou o porão de uma nave que ele **tripula** (`findCrewedShipsForActor`) **e que está atracada**: a cena da nave aponta para o MESMO depósito (`depotRefForScene` nos dois). Sem destino válido: "sem endereço de entrega aqui" e o botão Comprar fica desligado; o Mestre recusa do mesmo jeito (`chooseDestination`). Carrinho só de software não pede endereço.
- **Entrega.** Software (`shop.digital`) vai direto para o inventário do comprador (`giveItem`), sem prazo (o prazo de um item digital é ignorado; o Validar Mundo avisa). Item físico: prazo = `shop.deliveryHours` do Item se preenchido, senão `deliveryHours` da loja (`deliveryHoursFor`). Sem prazo (0): no depósito "chegou" na hora (`deliverToDeposit`, aviso na tela ao dono), ou direto no porão da nave. Com prazo: o item nasce "a caminho" no depósito com `arriveAt` pelo relógio do mundo e o `settleDeliveries` existente vira "chegou" e avisa. **Para o porão:** a marca `delivery.shipUuid` fica no item do depósito; ao chegar, `forwardToShip` move o item para a nave (pelos portões de instalação normais). Se a nave recusar ou sumiu, fica no depósito como "chegou" (a marca é limpa). A nave não precisa continuar atracada na chegada (só na compra). `copyData` agora tira a marca `delivery` do Item que sai do depósito (para a ficha ou para a nave).
- **Pedidos** (aba Entregas): flag `padOrders` no personagem comprador (últimos 30, o Mestre grava). Cada um guarda nome, imagem, quantidade, loja, destino, `orderedAt`, `arriveAt` e o id do item no depósito. O estado é calculado na hora (`orderState`): "a caminho" com barra e "chega em 1 dia · 3h", "chegou" com onde retirar, e "retirado" quando o depósito é visível ao cliente e o item já não está lá. Depósito não visível = continua "chegou" (nunca marca "retirado" no escuro). O app não tem botão de retirar: o saque é a janela do depósito (clique perto do Token).
- **Relay `shopOrder`** (uma ação nova; 41 no total). O cliente manda `{buyerUuid, lines:[{shopUuid, itemId, qty}], destination: "depot" | uuid da nave}`. O Mestre designado confere: dono do comprador (Personagem que não é loja), **rede e energia pelo Token do comprador** (`networkFor`), cada loja `online`, item e estoque, saldo total e destino; só então executa, **uma loja por vez**, com o motor de compra comum (`completeBuy`, extraído de `shopBuy` no lote C: conta, entrega, caixa, estoque, histórico, aviso do chat). Se uma linha falha, as já entregues dessa loja voltam e nada é cobrado dela; se uma loja anterior já fechou, a resposta diz "o que veio antes já foi comprado". O histórico da loja registra cada compra com o item no depósito/inventário como passo de ganho, então **o Desfazer do Mestre funciona** enquanto o item ainda está lá (se já foi retirado ou já passou ao porão, recusa com motivo).
- **Integrações:** campo "Prazo de entrega" na aba Loja (loja online), "Digital" e "Prazo de entrega" no "Avançado" do bloco "Venda em lojas" do Item, Glossário (`shopOnline`), Regras desta mesa (seção "Compras online (PAD)"), Validar Mundo (loja online com item físico e nenhuma cena/pasta com depósito; item digital com prazo).

## Limites do lote C

- **Não testado dentro do Foundry** (só as regras puras).
- A cena do personagem vem de `actorScene`: personagem sem Token em cena (ou ficha vinculada com Token em várias cenas: vale a cena ativa) não tem rede nem depósito.
- Um carrinho com várias lojas não é atômico entre lojas (ver o relay).
- O app não reserva estoque: dois jogadores comprando juntos passam pela fila do Mestre (`serialized`); o segundo recebe "só há N em estoque".
- Não há mercado negro, avaliação de vendedor nem venda pelo app (só compra).
- Pedidos antigos continuam na lista até passarem de 30 (não há "limpar").

## Fica para depois

- Do lote C ficou de fora: ver "Limites do lote C".
- **Não feito de propósito:** atitude do vendedor (o dono recusou) e item misterioso (mais para frente). Comparação com o item equipado no detalhe da vitrine e "mercado negro" do mockup ficaram de fora.

## Correções da sessão de teste 6 (1.114.1)

- As janelas Vitrine, Máquina e Saque guardam o estado em `this.ui` (`this.state` é getter do `ApplicationV2`; ver achados-foundry.md).
- Carrinho do PAD: total, saldo e falta aparecem na moeda das linhas quando todas cobram a mesma (antes caía em "Caco", a unidade base); a conversão de pagamento não mudou.
- "Chegou ao Depósito": o cartão na tela fica 15 s (`bannerMs` na Voz do Mundo; antes 6 s, fácil de perder). O card no chat continua.
- `askLoot` op `item`: a recusa agora diz o motivo (sem `itemId`: "faltou dizer qual item"; item que sumiu: "não está mais aqui"; de outro dono: "não é seu"). `itemId`/`qty` vão no argumento de cima de `askLoot`, não dentro de `payload`; foi isso que gerou o "já foi pego" falso do teste.
- Troca: o Desfazer do Mestre marca a troca como cancelada ("O Mestre desfez esta troca"); a janela de uma troca encerrada (ou esquecida) fecha sozinha em 12 s e não mostra mais "(item sumiu)" (mostra "(item entregue)" / "(item devolvido)").
- Bolso: o peso e os espaços dos itens dentro do contêiner do Bolso não entram no inventário principal (conferido em `inventoryLoad`); o "12/10" do teste era excesso de itens soltos, não bug.
