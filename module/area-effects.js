/**
 * Skills de Emissão: em vez de pedir um Ator-alvo via dropdown, o usuário posiciona uma forma
 * (Círculo/Cone/Linha) no canvas e a Skill afeta quem estiver dentro dela. Único arquivo do
 * sistema que toca canvas/Tokens — skill-effects.js e actor-sheet.js só recebem a lista final
 * de Atores já resolvida, sem saber nada de geometria.
 *
 * Depende da API de Scene Regions do Foundry V14 (`canvas.regions.placeRegion` +
 * `RegionDocument#tokens`), que substituiu os antigos Measured Templates (removidos no V14).
 * Não existe em V12/13 — ver `areaEffectsSupported()`.
 *
 * NÍVEL DE CONFIANÇA: a arquitetura (Region efêmera → `.tokens` → limpar) está bem
 * fundamentada em fontes oficiais/da equipe da Foundry, mas a sintaxe exata de
 * `buildRegionShapeConfig` (ângulo do cone, unidades de distância) não foi confirmada em
 * documentação — a própria doc de Scene Regions da Foundry ainda não foi atualizada com as
 * formas novas do V14. Testar contra um Foundry V14 real e ajustar SÓ essa função se o
 * formato esperado for diferente.
 */

/** Foundry V14+ tem `canvas.regions.placeRegion`; V12/13 não. */
export function areaEffectsSupported() {
  return typeof canvas !== "undefined" && !!canvas?.regions?.placeRegion;
}

/**
 * Traduz os campos da Skill (areaShape/areaDistance/areaAngle) pro formato de shape que
 * `canvas.regions.placeRegion` espera. Isolado nesta função de propósito — é a única parte
 * com sintaxe não 100% confirmada.
 */
function buildRegionShapeConfig(skill) {
  const distance = Number(skill.system.areaDistance) || 0;

  switch (skill.system.areaShape) {
    case "circle":
      return { type: "circle", radius: distance };
    case "cone":
      return { type: "cone", distance, angle: Number(skill.system.areaAngle) || 53 };
    case "ray":
      return { type: "ray", distance };
    default:
      throw new Error(`Formato de Área inválido: "${skill.system.areaShape}".`);
  }
}

/**
 * Deixa o usuário posicionar a forma da Skill no canvas e devolve os Atores encontrados
 * dentro dela (Tokens sem Actor associado são ignorados). A Region criada é efêmera — é
 * apagada logo depois de ler `.tokens`, nunca fica salva como parte da cena.
 * @param {Item} skill
 * @returns {Promise<Actor[]>}
 */
export async function pickAreaTargets(skill) {
  if (!areaEffectsSupported()) {
    throw new Error("Skills de Emissão precisam de Foundry V14 (Scene Regions).");
  }

  const shapeConfig = buildRegionShapeConfig(skill);
  const regionDoc = await canvas.regions.placeRegion(shapeConfig);
  if (!regionDoc) return []; // usuário cancelou o posicionamento (ex: Esc)

  try {
    const tokens = Array.from(regionDoc.tokens ?? []);
    return tokens.map(t => t.actor).filter(Boolean);
  } finally {
    await regionDoc.delete();
  }
}
