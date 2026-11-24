/**
 * "Ficha" de uma Pilha ou Depósito (Lojas, lote B): não há ficha de verdade, abrir a ficha abre a
 * janela de saque (`apps/shop-loot.js`). Para o Mestre ela mostra tudo; para o jogador só o que é
 * dele (e só perto, pelo clique no Token).
 */
const { ActorSheetV2 } = foundry.applications.sheets;

export class NihilityPileSheet extends ActorSheetV2 {
  /** @override Em vez de desenhar uma ficha, abre a janela de saque desta pilha. */
  async render(options = {}, _options = {}) {
    const { openLootForActor } = await import("../economy/loot.js");
    await openLootForActor(this.actor);
    return this;
  }
}
