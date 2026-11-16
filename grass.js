// Grass, for Apple Toss's field and Apple Royale's lobby: single blades
// (one mesh, drawn once per blade), bent in the vertex shader: a steady
// lean downwind, gusts rolling across the way the wind blows, and each
// blade's own flutter. Whoever uses it sows the blades (Grass.blade).

const GRASS_SOIL = "#3a7d24"; // the ground between the blades

BABYLON.Effect.ShadersStore.grassVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
#include<instancesDeclaration>
uniform mat4 viewProjection;
uniform float time;
uniform float wind;
uniform vec2 gustAt; // how far the wide gusts and the ripples have travelled
varying float vUp;
varying float vTint;
varying float vGust;
void main() {
#include<instancesVertex>
  vec3 root = finalWorld[3].xyz;
  float tall = length(finalWorld[1].xyz);
  float rnd = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float up = uv.y; // 0 at the root, 1 at the tip
  float hard = abs(wind);
  // Gusts: two bands of waves travelling downwind, a wide one and a ripple.
  float gust = 0.6 * sin(0.22 * root.x + 0.13 * root.z - gustAt.x)
             + 0.4 * sin(0.7 * root.x - 0.45 * root.z - gustAt.y + 6.28 * rnd * 0.15);
  gust = 0.5 + 0.5 * gust;
  float lean = wind * (0.07 + 0.11 * gust) + 0.05 * sin(time * (2.5 + 3.0 * rnd) + 6.28 * rnd) * (0.6 + 0.25 * hard);
  float sway = 0.04 * sin(time * (1.7 + 2.0 * rnd) + 4.0 * rnd);
  vec4 p = finalWorld * vec4(position, 1.0);
  float bend = up * up * tall;
  p.x += lean * bend;
  p.z += sway * bend;
  p.y -= (1.0 - cos(min(abs(lean), 1.3))) * bend; // a bent blade is lower
  vUp = up;
  vTint = rnd;
  vGust = gust * min(hard / 3.0, 1.0);
  gl_Position = viewProjection * p;
}`;
BABYLON.Effect.ShadersStore.grassFragmentShader = `
precision highp float;
varying float vUp;
varying float vTint;
varying float vGust;
void main() {
  vec3 low = vec3(0.09, 0.27, 0.06);
  vec3 high = mix(vec3(0.36, 0.68, 0.18), vec3(0.52, 0.78, 0.24), vTint);
  vec3 c = mix(low, high, vUp * vUp * 0.4 + vUp * 0.6);
  c += vec3(0.10, 0.11, 0.04) * vGust * vUp; // gusts show as paler bands
  gl_FragColor = vec4(c, 1.0);
}`;

class Grass {
  // `matrices`: 16 numbers a blade (a Float32Array filled by Grass.blade).
  constructor(scene, matrices) {
    // One blade: a tapering strip, curved a little, a unit tall and wide.
    const LEVELS = 4;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= LEVELS; i++) {
      const t = i / LEVELS;
      const half = 0.5 * (1 - 0.9 * t);
      positions.push(-half, t, 0.25 * t * t, half, t, 0.25 * t * t);
      uvs.push(0, t, 1, t);
      if (i < LEVELS) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const blade = new BABYLON.Mesh("grass", scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(blade);

    blade.thinInstanceSetBuffer("matrix", matrices, 16, true);
    blade.alwaysSelectAsActiveMesh = true;
    blade.isPickable = false;

    this.mat = new BABYLON.ShaderMaterial("grassMat", scene, "grass", {
      attributes: ["position", "uv"],
      uniforms: ["world", "viewProjection", "time", "wind", "gustAt"],
    });
    this.mat.backFaceCulling = false;
    blade.material = this.mat;
    this.mesh = blade;
    this.time = 0;
    this.wind = 0;
    this.windV = 0; // how fast the wind is changing
    this.gustAt = new BABYLON.Vector2(0, 0);
  }

  // The wind comes round to its new strength smoothly, gathering and then
  // easing off (a critically damped spring), never overshooting. The gusts
  // travel on from wherever they'd got to, only faster or slower (or, as the
  // wind passes through still, gently turning round), so a change never
  // sends the waves racing.
  update(dt, wind) {
    dt = Math.min(dt, 0.05); // a long frame (the tab was away) mustn't fling the wind about
    this.time += dt;
    this.windV += (4 * (wind - this.wind) - 4 * this.windV) * dt;
    this.wind += this.windV * dt;
    const w = this.wind;
    const way = Math.tanh(2 * w); // ±1, passing smoothly through 0
    this.gustAt.x += (0.9 * way + 0.5 * w) * dt;
    this.gustAt.y += (1.6 * way + 0.8 * w) * dt;
    this.mat.setFloat("time", this.time);
    this.mat.setFloat("wind", w);
    this.mat.setVector2("gustAt", this.gustAt);
  }

  dispose() {
    this.mesh.dispose();
    this.mat.dispose();
  }

  // Blade i of `matrices`: rooted at x, y, z, turned any way round.
  static blade(matrices, i, x, y, z, wide, tall) {
    const yaw = 6.28 * Math.random();
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    matrices.set([c * wide, 0, -s * wide, 0, 0, tall, 0, 0, s * tall, 0, c * tall, 0, x, y, z, 1], 16 * i);
  }
}
