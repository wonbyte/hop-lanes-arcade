// Merged voxel meshes: a list of boxes becomes one mesh with vertex colors (one draw call).
// ---------- merged voxel meshes ----------
// Every model is a list of boxes [w, h, d, color, x, y, z] (y = bottom of the box).
// Each list becomes ONE mesh with vertex colors, so a lane or a car is a single draw call.
const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// Two changes to the standard vertex color code (onBeforeCompile sees the shader before its #include parts are
// expanded, so the whole color_vertex part is replaced, not a line inside it):
// - instanced models (world.js Inst) carry a color per instance that tints only the pure white boxes,
//   so one car model serves every paint color while windows and wheels keep their own colors
// - `ao` darkens the bottom of every box a little (baked ambient occlusion): blocks look grounded;
//   a value above 1 is a glow (headlights) that comes on with the night (uniform `glow`, set by gfx.setNight)
const glowU = { value: 0 };
voxelMat.onBeforeCompile = shader => {
  shader.uniforms.glow = glowU;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float ao;\nuniform float glow;')
    .replace('#include <color_vertex>', [
      '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )', 'vColor = vec3( 1.0 );', '#endif',
      '#ifdef USE_COLOR', 'vColor *= color;', '#endif',
      '#ifdef USE_INSTANCING_COLOR',
      'if ( color.r > 0.999 && color.g > 0.999 && color.b > 0.999 ) vColor *= instanceColor;',
      '#endif',
      'vColor *= ao <= 1.0 ? ao : 1.0 + ( ao - 1.0 ) * glow;'
    ].join('\n'));
};
const AO_BOTTOM = 0.72;   // shade at the bottom of a box (the top stays 1); flat boxes get none
// a box may carry an 8th value: its glow at night (1 = twice as bright); a glowing box gets no bottom shade
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const UP = UNIT.attributes.position.array, UN = UNIT.attributes.normal.array, UI = UNIT.index.array;
const UV = UP.length / 3;
const tmpColor = new THREE.Color();

function mergeBoxes(boxes) {
  const n = boxes.length;
  const pos = new Float32Array(n * UV * 3), nor = new Float32Array(n * UV * 3), col = new Float32Array(n * UV * 3), ao = new Float32Array(n * UV);
  const idx = new (n * UV > 65535 ? Uint32Array : Uint16Array)(n * UI.length);
  boxes.forEach(([w, h, d, color, x, y, z, glow = 0], k) => {
    tmpColor.setHex(color);
    const o = k * UV * 3;
    for (let i = 0; i < UV * 3; i += 3) {
      pos[o + i] = UP[i] * w + x;
      pos[o + i + 1] = UP[i + 1] * h + y + h / 2;
      pos[o + i + 2] = UP[i + 2] * d + z;
      col[o + i] = tmpColor.r; col[o + i + 1] = tmpColor.g; col[o + i + 2] = tmpColor.b;
      ao[(o + i) / 3] = glow ? 1 + glow : UP[i + 1] < 0 && h > 0.12 ? AO_BOTTOM : 1;
    }
    nor.set(UN, o);
    for (let i = 0; i < UI.length; i++) idx[k * UI.length + i] = UI[i] + k * UV;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));   // every voxelMat geometry must have it (missing reads as 0: black)
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
function voxelMesh(geo, cast = true) {
  const m = new THREE.Mesh(geo, voxelMat);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}
// shared geometries for models that repeat (never disposed)
const geoCache = new Map();
const cachedGeo = (key, build) => geoCache.get(key) || geoCache.set(key, mergeBoxes(build())).get(key);

export { AO_BOTTOM, cachedGeo, glowU, mergeBoxes, voxelMat, voxelMesh };
