/**
 * Zona que escurece o mapa (1.120.0): a Zona cria uma luz NEGATIVA (escuridão) do Foundry no lugar dela, apagada
 * junto com a Zona. Aqui só as contas puras (sem Foundry, testadas em test/environment.test.mjs): onde a luz fica, qual
 * o raio e o bloco `config` do documento. Quem cria e apaga é `combat/zone-darkness.js`.
 */

/** A luz negativa fica no centro da Zona (círculo) ou no meio do eixo (cone e linha), com raio que cobre o desenho. */
export function zoneLightPlan(area, pxPerUnit = 1) {
  if (!area) return null;
  const scale = Number(pxPerUnit) > 0 ? Number(pxPerUnit) : 1;
  const radius = Math.max(0, Number(area.radius) || 0);
  if (!(radius > 0)) return null;
  if (area.shape === "circle") return { x: area.x, y: area.y, radiusUnits: radius / scale };
  // Cone e linha: um círculo no meio do eixo, com metade do alcance de raio (a linha cobre também a metade da largura).
  const rad = ((Number(area.direction) || 0) * Math.PI) / 180;
  const half = radius / 2;
  const reach = area.shape === "ray" ? Math.max(half, (Number(area.width) || 0) / 2) : half;
  return { x: area.x + Math.cos(rad) * half, y: area.y + Math.sin(rad) * half, radiusUnits: reach / scale };
}

/**
 * O bloco `config` de uma AmbientLight negativa. `generation` é a versão do Foundry (13 ou 14): hoje as duas leem
 * `negative`, `dim`, `bright` e `luminosity` do mesmo jeito, mas o parâmetro fica para a V14 mudar sem mexer em quem chama.
 */
export function negativeLightConfig(radiusUnits, { generation = 13 } = {}) {
  const dim = Math.max(0.1, Math.round((Number(radiusUnits) || 0) * 100) / 100);
  return {
    negative: true,
    color: "#000000",
    alpha: 0.5,
    dim,
    bright: Math.round(dim * 0.75 * 100) / 100,
    angle: 360,
    luminosity: 0.6,
    animation: { type: null, speed: 5, intensity: 5 },
    ...(generation >= 14 ? {} : {})
  };
}

/** Os dados do documento AmbientLight negativo de uma Zona. */
export function zoneLightData(area, zoneId, { pxPerUnit = 1, generation = 13, systemId = "nihility-rpg-system" } = {}) {
  const plan = zoneLightPlan(area, pxPerUnit);
  if (!plan) return null;
  return {
    x: plan.x,
    y: plan.y,
    walls: true,
    vision: false,
    config: negativeLightConfig(plan.radiusUnits, { generation }),
    flags: { [systemId]: { zoneLight: String(zoneId ?? "") } }
  };
}
