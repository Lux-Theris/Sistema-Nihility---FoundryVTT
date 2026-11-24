/**
 * Pilha (Lojas, lote B): um Ator leve que só guarda Itens. Dois usos, pelo campo `kind`:
 *  - "pile": o que alguém largou no mapa (um Token por pilha, NÃO vinculado: some junto com o Token);
 *  - "deposit": o depósito de entregas de um lugar (Ator do mundo, ligado pelo campo "Entregas vão
 *    para" da cena ou da pasta; cada Item dentro leva a marca de entrega de quem pediu).
 * Não tem Vida, atributos nem moedas. Ver docs/claude/lojas.md.
 */
const fields = foundry.data.fields;

export class PileDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: new fields.StringField({ required: false, initial: "pile", choices: ["pile", "deposit"] }),
      /** Quando a pilha foi largada (data real, ms): o Validar Mundo avisa pilha esquecida. */
      createdAt: new fields.NumberField({ required: false, nullable: true, initial: null }),
      /** Quem largou (só informação). */
      madeBy: new fields.StringField({ required: false, initial: "", blank: true })
    };
  }
}
