/**
 * Ponto de entrada leve do ponto de restauração automático (H13): quem muda a ficha (evoluir,
 * fundir, Espécie, Level Up…) importa SÓ isto. O módulo pesado (janela, compêndio) carrega sob
 * demanda, e só o Mestre chega a carregá-lo — assim nada aqui roda no boot nem nos testes.
 */
export async function autoSnapshot(actor, reason) {
  if (!globalThis.game?.user?.isGM || !actor) return null;
  try {
    const { autoSnapshot: run } = await import("./actor-snapshots.js");
    return await run(actor, reason);
  } catch (err) {
    console.warn("nihility-rpg-system | Ponto de restauração automático falhou.", err);
    return null;
  }
}
