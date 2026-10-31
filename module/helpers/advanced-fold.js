/**
 * "Avançado ▸" dobrado nos editores de Skill (backlog K1; mockup aprovado: Design "Avançado nos
 * Editores de Skill"). Pura e testada.
 *
 * Cada seção (e cada card de Efeito) diz quais campos raros tem e se cada um está em uso. A linha
 * lista todos pelo nome; abre sozinha quando algum tem valor; o que o usuário abriu/fechou à mão
 * vale até a janela fechar (estado de tela, nada é salvo). Sem campo nenhum, a linha some.
 *
 * @param {{label: string, used?: boolean}[]} fields - os campos da seção (os que não se aplicam já fora)
 * @param {boolean} [userOpen] - o que o usuário escolheu nesta janela, se escolheu
 * @returns {{show: boolean, labels: string, used: string, open: boolean}}
 */
export function advancedFold(fields, userOpen) {
  const list = (fields ?? []).filter(f => f?.label);
  const used = list.filter(f => f.used).map(f => f.label);
  return {
    show: list.length > 0,
    labels: list.map(f => f.label).join(" · "),
    used: used.join(" · "),
    open: typeof userOpen === "boolean" ? userOpen : used.length > 0
  };
}
