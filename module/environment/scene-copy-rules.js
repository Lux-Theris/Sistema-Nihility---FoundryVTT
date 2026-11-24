/**
 * "Do Foundry, copiar uma vez" (H20): configurações do próprio Foundry (Visão de Token, grade, escuridão
 * base, luz global, névoa, playlist) copiadas de uma vez para as cenas de uma pasta. Sem herança depois:
 * é uma escrita em lote. Aqui só a parte pura (que campo escreve o quê em cada versão, o que muda em
 * cada cena e o texto da confirmação); quem aplica é `environment/scene-config-apply.js`.
 *
 * Os caminhos dependem da geração do Foundry (a V14 trocou `darkness` por `environment.darknessLevel` e
 * `fog.exploration` por `fog.mode`): a geração é PARÂMETRO, como em `foundry-compat.js`.
 */

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Modo "individual" da névoa de exploração na V14 (`CONST.FOG_EXPLORATION_MODES.INDIVIDUAL`). */
const FOG_INDIVIDUAL = 1;

/**
 * Os campos copiáveis. `read(source, gen)` lê o valor atual de uma cena (`_source`/`toObject`), na
 * mesma forma do valor escolhido; `write(value, gen)` devolve o pedaço de `scene.update()`.
 * `type`: "bool" | "number" | "text" | "scale" | "playlist" (o formulário desenha cada um).
 */
export const SCENE_COPY_FIELDS = [
  {
    key: "tokenVision", label: "Visão de Token", type: "bool", def: true,
    read: s => Boolean(s.tokenVision),
    write: v => ({ tokenVision: Boolean(v) })
  },
  {
    key: "gridScale", label: "Escala da grade (distância e unidade)", type: "scale", def: { distance: 1.5, units: "m" },
    hint: "Só a escala. Tipo e tamanho da grade não são copiados: estragariam o alinhamento do mapa.",
    read: s => ({ distance: Number(get(s, "grid.distance")) || 0, units: String(get(s, "grid.units") ?? "") }),
    write: v => ({ "grid.distance": Number(v?.distance) > 0 ? Number(v.distance) : 1, "grid.units": String(v?.units ?? "").trim() })
  },
  {
    key: "darkness", label: "Escuridão base", type: "number", def: 0, min: 0, max: 1, step: 0.05,
    hint: "0 = claro, 1 = escuro. Cena marcada \"Escurece com o relógio\" volta a ser posta pela hora.",
    read: (s, gen) => Number(gen >= 14 ? get(s, "environment.darknessLevel") : s.darkness) || 0,
    // V14: `environment.cycle: false`, senão o ciclo do núcleo manda na escuridão (como em sceneDarknessUpdate).
    write: (v, gen) => {
      const level = Math.min(1, Math.max(0, Number(v) || 0));
      return gen >= 14 ? { "environment.darknessLevel": level, "environment.cycle": false } : { darkness: level };
    }
  },
  {
    key: "globalLight", label: "Luz global", type: "bool", def: false,
    read: s => Boolean(get(s, "environment.globalLight.enabled")),
    write: v => ({ "environment.globalLight.enabled": Boolean(v) })
  },
  {
    key: "fog", label: "Névoa de exploração", type: "bool", def: true,
    read: (s, gen) => (gen >= 14 ? Number(get(s, "fog.mode")) > 0 : Boolean(get(s, "fog.exploration"))),
    write: (v, gen) => (gen >= 14 ? { "fog.mode": v ? FOG_INDIVIDUAL : 0 } : { "fog.exploration": Boolean(v) })
  },
  {
    key: "playlist", label: "Som ambiente (playlist)", type: "playlist", def: "",
    read: s => String(s.playlist ?? ""),
    write: v => ({ playlist: v ? String(v) : null, playlistSound: null })
  }
];

/** Um campo copiável pelo id. */
export function copyField(key) {
  return SCENE_COPY_FIELDS.find(f => f.key === key) ?? null;
}

/** Valor "igual"? (os valores são booleanos, números, textos e `{distance, units}`). */
function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * O que a cópia faz: por campo marcado, quantas cenas MUDAM (o valor delas é diferente do escolhido) e
 * quantas já estão iguais; mais a gravação de cada cena (só com o que muda).
 * @param {Array<{id:string,name:string,source:object}>} scenes
 * @param {Record<string, any>} picked `{chave: valor}` só dos campos marcados
 * @param {number} generation
 * @returns {{fields: Array<{key:string,label:string,changes:number,same:number}>, updates: Array<{id:string,name:string,update:object}>}}
 */
export function planCopy(scenes = [], picked = {}, generation = 14) {
  const keys = Object.keys(picked).filter(key => copyField(key));
  const fields = keys.map(key => ({ key, label: copyField(key).label, changes: 0, same: 0 }));
  const updates = [];
  for (const scene of scenes) {
    let update = {};
    for (const row of fields) {
      const field = copyField(row.key);
      const current = field.read(scene.source ?? {}, generation);
      if (sameValue(current, field.read(applyWrite({}, field.write(picked[row.key], generation)), generation))) {
        row.same += 1;
      } else {
        row.changes += 1;
        update = { ...update, ...field.write(picked[row.key], generation) };
      }
    }
    if (Object.keys(update).length) updates.push({ id: scene.id, name: scene.name, update });
  }
  return { fields, updates };
}

/** Aplica um pedaço de update (caminhos com ponto) numa cópia de objeto: serve para reler o valor escolhido. */
function applyWrite(base, update) {
  const out = base;
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split(".");
    let node = out;
    keys.slice(0, -1).forEach(k => { node = node[k] ??= {}; });
    node[keys.at(-1)] = value;
  }
  return out;
}

/** O texto da confirmação: uma linha por campo. */
export function copyConfirmLines(plan, total) {
  return plan.fields.map(row => {
    if (!row.changes) return `${row.label}: nenhuma cena muda (as ${total} já estão assim)`;
    return `${row.label}: sobrescreve ${row.changes} de ${total} cena(s)`;
  });
}
