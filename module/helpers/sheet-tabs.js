/**
 * Editor de texto (`<prose-mirror>`) em aba nativa (PARTS + TABS, Onda 5).
 *
 * A barra do editor mede os próprios botões quando é montada (ProseMirrorMenu#recordSizes, no núcleo) e
 * decide quais cabem. Montada numa aba escondida (`display: none`), tudo mede 0 e a barra perde botões
 * (cor, listas, linha, imagem, link). Antes da Onda 5 isso não acontecia porque clicar na aba
 * redesenhava a ficha inteira com ela já visível.
 *
 * A troca de aba agora não redesenha nada, então: quem desenhou a parte enquanto ela estava visível ganha
 * uma marca (`markVisibleEditorParts`, no `_onRender`); ao abrir uma aba com editor que ainda não tem a
 * marca, redesenha só aquela parte (`refreshEditorOnTabShow`, no `changeTab`).
 */

/** No `_onRender`: marca as partes com editor que foram desenhadas visíveis. */
export function markVisibleEditorParts(root) {
  for (const section of root?.querySelectorAll(".tab.active[data-application-part]") ?? []) {
    if (section.querySelector("prose-mirror")) section.dataset.editorMeasured = "1";
  }
}

/** No `changeTab`, depois do `super`: redesenha a parte da aba aberta se o editor dela foi medido escondido. */
export function refreshEditorOnTabShow(app, tab, group) {
  const section = app.element?.querySelector(`.tab[data-group="${group}"][data-tab="${tab}"][data-application-part]`);
  if (!section || section.dataset.editorMeasured === "1" || !section.querySelector("prose-mirror")) return;
  app.render({ parts: [section.dataset.applicationPart] });
}
