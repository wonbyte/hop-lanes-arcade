// Merged voxel meshes: a list of boxes becomes one mesh with vertex colors (one draw call).
// ---------- merged voxel meshes ----------
// Every model is a list of boxes [w, h, d, color, x, y, z] (y = bottom of the box).
// Each list becomes ONE mesh with vertex colors, so a lane or a car is a single draw call.
const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// instanced models (world.js Inst) can carry a color per instance: it tints only the pure white boxes,
// so one car model serves every paint color while windows and wheels keep their own colors
voxelMat.onBeforeCompile = shader => {
  shader.vertexShader = shader.vertexShader.replace('vColor.xyz *= instanceColor.xyz;',
    'if (color.r > 0.999 && color.g > 0.999 && color.b > 0.999) vColor.xyz *= instanceColor.xyz;');
};
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const UP = UNIT.attributes.position.array, UN = UNIT.attributes.normal.array, UI = UNIT.index.array;
const UV = UP.length / 3;
const tmpColor = new THREE.Color();

function mergeBoxes(boxes) {
  const n = boxes.length;
  const pos = new Float32Array(n * UV * 3), nor = new Float32Array(n * UV * 3), col = new Float32Array(n * UV * 3);
  const idx = new (n * UV > 65535 ? Uint32Array : Uint16Array)(n * UI.length);
  boxes.forEach(([w, h, d, color, x, y, z], k) => {
    tmpColor.setHex(color);
    const o = k * UV * 3;
    for (let i = 0; i < UV * 3; i += 3) {
      pos[o + i] = UP[i] * w + x;
      pos[o + i + 1] = UP[i + 1] * h + y + h / 2;
      pos[o + i + 2] = UP[i + 2] * d + z;
      col[o + i] = tmpColor.r; col[o + i + 1] = tmpColor.g; col[o + i + 2] = tmpColor.b;
    }
    nor.set(UN, o);
    for (let i = 0; i < UI.length; i++) idx[k * UI.length + i] = UI[i] + k * UV;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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

export { UI, UN, UNIT, UP, UV, cachedGeo, geoCache, mergeBoxes, tmpColor, voxelMat, voxelMesh };
