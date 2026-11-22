# PAD — o celular do jogo

> Parte do guia do projeto. O índice e as regras que valem em todo lugar estão no `CLAUDE.md` da raiz. Quando o texto diz "abaixo"/"acima" ou cita uma seção que não está aqui, procure-a pelo índice.

## PAD — the in-game phone (`module/apps/nihility-pad.js` + `module/pad/`)

A smartphone-style app bound to one Personagem, opened from a button on that Actor's sheet. The button shows for the GM always (it's a GM tool, not physical possession) and for a player only when the Actor owns at least one `type: "item"` Item flagged `isPadDevice: true` — `hasPadDevice()` in `pad-crew.js`; being *equipped* is deliberately not required. Everything is gated by `padEnabled` plus one sub-setting per screen. The app instance uses a per-Actor `id` (`nihility-pad-<actorId>`) so reopening focuses the existing window instead of two PADs fighting over the same DOM node, and the GM can switch "persona" from the Mensagens screen — reassigning `this.actor` re-points *every* screen, not just chat.

Three screens, three deliberately different storage strategies:
- **Nave** — read-only status of the Nave/Veículo whose `crewMembers` include this Actor (Casco/Escudo/Reator/Consumo/Módulos/tripulação), with a picker when the character crews more than one. No storage of its own.
- **Biblioteca** — drag&drop favourites of any document. *Pessoal* is a plain Actor flag (`padLibrary`) — the player already owns their Actor, so permissions are trivially correct. *Da Nave* (written by the designated GM through the `shipLibrary` relay action, because a player cannot write to a compendium even when owning the document) is a `JournalEntry` in a hidden World Compendium (`padLibrary` pack) holding data only in `flags`, with explicit per-document `ownership` recomputed from the current crew (`syncLibraryOwnershipToCrew`). Same pattern as `world-backup.js`; `content` is never used.
- **Mensagens** — direct and group chat built entirely on native `ChatMessage` with `whisper` + structured `flags` (the same trick as Voz do Mundo), so cross-client replication is free and no custom socket is needed. Direct threads get a deterministic id from the two sorted UUIDs (`directThreadId`), so both sides compute the same thread with no lookup table. Groups need a *persisted* entity (an empty conversation can't be derived from messages that don't exist yet), so they're `JournalEntry` documents in a second hidden pack (`padGroups`), again flags-only, with `ownership` synced to the current members. **The GM is whispered into every conversation, always** — an invisible member by convention, same privacy model as Voz do Mundo. Message bodies are escaped on the way in (`escapeHtml`) and rendered with `{{ }}`, never `{{{ }}}`.

Contacts: `getContactsFor()` combines visible PCs, current crewmates (always reachable, even if normal visibility wouldn't cover them), NPCs only when the GM is driving, plus `padContacts` (an Actor flag) — saved contacts override all the other rules on purpose, which is what makes "compartilhar contato com a cena" able to introduce an NPC to a player. Sharing is opt-in on the receiving side: `shareContactWithScene` only posts an offer card, and the recipient clicks to add it.

Live updates come from `updateActor` + `createChatMessage` hooks registered in `_onRender` (guarded so repeated renders don't stack listeners) and removed in `close()`.


## Data do personagem no PAD (J9b, 1.103.0)

Com `FEATURES.calendar` ligado a tela inicial do PAD mostra a hora e a data que **o personagem acha que é** (`deviceView` em `core/world-time.js`; flag `timeSync`, tempo pessoal desde o último acerto), não a do mundo; a barra de status leva a mesma hora. Estados do desenho: na rede (cena "tem rede"), sem rede com "acertado há X (seu tempo)" e **Atualizar**, pedido enviado ("Procurando sinal…"), recusado ("Sem sinal"), e "--:--" sob PEM/campo (Atualizar some). Atualizar vai ao Mestre por `runAsGm("timeSyncRequest")` e vira um card com Aprovar/Recusar. Se o tempo pessoal recuar (Skill de reverter, 8e), o aparelho volta junto. O PAD se redesenha no `updateWorldTime` e quando os flags do Ator mudam. Detalhes e limites em [mundo.md](mundo.md).


- **Sessão 4 (1.103.1):** a aba "Da Nave" repinta no PAD de outro tripulante quando alguém grava (o Mestre toca `libraryTick` na Nave e o PAD escuta os JournalEntry da biblioteca); soltar um documento no PAD mostra uma notificação dizendo onde foi salvo (Pessoal ou Nave); "acertado há agora (seu tempo)" virou "acertado agora".
