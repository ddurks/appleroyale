// The logo, for all three games: "apple royale" in 3D (assets/title.glb,
// made by tools/title_glb.py from the Drawvid Hand font) over an idling
// apple. The words swell as the apple rises in its idle, and the apple pulls
// a face now and then. Leaving it, the apple falls (Logo.startFall,
// Logo.fallFrame): it squashes and shrinks to game size, hops, rides down
// the screen as the view falls past the game's backdrop, and drops onto its
// spot. The title is Apple Royale's, drawn in its world: into Royale its
// camera falls down the tree to the lobby; into Apple Toss or Apple Run the
// title's picture fades away (common.js Fader) as their camera swings down
// from the sky, the logo drawn over them (Intro).
//
// Needs common.js. Globals: LOGO_*, FALL_*, fallEase, Logo, INTRO_PITCH, Intro.

const LOGO_PULSE = 0.06; // how much the words swell as the apple rises
const LOGO_APPLE_H = 0.75; // the apple's height, in the words' heights
const LOGO_FACE_EVERY = 2.2; // seconds between faces (±40%)
const LOGO_FACE_HOLD = 1.1;
// The fall (heights as shares of the view's, durations in seconds): the
// apple squashes and shrinks, hops, rides down and, in the last part of the
// ride, falls to its spot, landing at FALL_TIME; then (Royale) bounces twice
// (heights in world units) and settles.
const FALL_TIME = 2.6;
const FALL_SHRINK = 0.35;
const FALL_HOP = 0.07;
const FALL_SLAM = 0.35;
const FALL_BOUNCES = [[1.5, 0.42], [0.45, 0.24]];
const FALL_SETTLE = 0.16;
const FALL_END = FALL_TIME + FALL_BOUNCES.reduce((t, b) => t + b[1], 0) + FALL_SETTLE;

// How far along the view's fall is, f (0…1) of the way in time: slow off,
// fast through the middle, easing to a stop.
function fallEase(f) {
  f = Math.min(Math.max(f, 0), 1);
  return f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
}

class Logo {
  // In `scene`, seen by `camera` (orthographic), from title.glb's and
  // apple.glb's containers, with the face pictures. fit(): the band it's
  // fitted into, { top, bottom } in CSS pixels down from the canvas's top.
  constructor(scene, camera, wordsContainer, appleContainer, faces, fit) {
    this.camera = camera;
    this.fit = fit;
    this.root = new BABYLON.TransformNode("logo", scene);
    const part = (name, container) => {
      const node = new BABYLON.TransformNode(name, scene);
      node.parent = this.root;
      const inst = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
      inst.rootNodes[0].parent = node;
      for (const m of node.getChildMeshes(false)) {
        m.renderingGroupId = 2;
        m.isPickable = false;
        m.computeWorldMatrix(true);
      }
      const { min, max } = node.getHierarchyBoundingVectors();
      return { node, inst, w: max.x - min.x, h: max.y - min.y, mid: (max.y + min.y) / 2 };
    };
    this.words = part("logoWords", wordsContainer);
    this.words.node.rotation.y = Math.PI; // the export faces away from our camera
    this.apple = part("logoApple", appleContainer);
    this.face = new Face(this.apple.node, faces, "logoFace");
    this.faceT = LOGO_FACE_EVERY;
    for (const ag of this.apple.inst.animationGroups) ag.stop();
    this.idle = this.apple.inst.animationGroups.find((ag) => ag.name.toLowerCase().includes("idle"));
    this.scale = 1;
    this.show(false);
  }

  show(on) {
    this.root.setEnabled(on);
    if (!this.idle) return;
    if (on) this.idle.start(true, 2);
    else this.idle.stop();
  }

  // How much of it shows, 0 (none) to 1: fading in, back at the title.
  fade(a) {
    for (const m of this.root.getChildMeshes(false)) m.visibility = a;
  }

  update(dt) {
    this._layout();
    // Where the apple is in its idle: 0 standing tall, ½ crouched lowest.
    const a = this.idle && this.idle.animatables[0];
    const phase = a ? (a.masterFrame - this.idle.from) / (this.idle.to - this.idle.from) : 0;
    this.words.node.scaling.setAll(this.scale * (1 + LOGO_PULSE * Math.cos(2 * Math.PI * phase)));

    this.faceT -= dt;
    if (this.faceT > 0) return;
    if (this.face.name) {
      this.face.set(null);
      this.faceT = LOGO_FACE_EVERY * (0.6 + 0.8 * Math.random());
    } else {
      const others = FACES.filter((f) => f !== this.lastFace);
      this.lastFace = others[Math.floor(Math.random() * others.length)];
      this.face.set(this.lastFace);
      this.faceT = LOGO_FACE_HOLD;
    }
  }

  // Ready the apple to leave the logo: where it is, how big, and how big
  // it's to be in the game (its scale there).
  startFall(gameScale = 1) {
    const n = this.apple.node;
    this.fall = { x0: n.position.x, y0: n.position.y, k0: n.scaling.y, k1: gameScale, off0: 0, prevY: null, face: null };
  }

  // The apple t seconds into the fall, given the camera's height now, at
  // the launch and at the end, where its spot is (its feet) and the view's
  // height. Squash s > 0 is flat and wide, s < 0 tall and thin, pivoting
  // on the feet.
  fallFrame(t, dt, camY, camYAtLaunch, camYEnd, land, viewH) {
    const d = this.fall;
    const n = this.apple.node;
    let x, y, k, s;
    let face = "default";
    if (t < FALL_SHRINK) {
      // Shrink to game size, crouching for the jump.
      const f = t / FALL_SHRINK;
      const e = f * f * (3 - 2 * f);
      x = d.x0;
      y = d.y0;
      k = d.k0 + (d.k1 - d.k0) * e;
      s = 0.4 * f * f;
    } else if (t < FALL_TIME) {
      // Ride down with the camera, holding its place on the screen (a hop
      // first), then fall the rest of the way to the spot, faster and
      // faster, landing as the camera settles.
      if (!d.launched) {
        d.launched = true;
        d.off0 = d.y0 - camYAtLaunch;
        if (this.idle) this.idle.stop();
      }
      const u = (t - FALL_SHRINK) / (FALL_TIME - FALL_SHRINK);
      const off1 = land.y - camYEnd;
      const hop = u < 0.35 ? FALL_HOP * viewH * Math.sin((Math.PI * u) / 0.35) : 0;
      const slam = Math.max(0, (u - (1 - FALL_SLAM)) / FALL_SLAM);
      const off = d.off0 + (off1 - d.off0) * slam * slam + hop;
      const ux = u * u * (3 - 2 * u);
      x = d.x0 + (land.x - d.x0) * ux;
      y = camY + off;
      k = d.k1;
      // Stretched by how fast it's really falling, in game sizes.
      const v = d.prevY === null ? 0 : (y - d.prevY) / Math.max(dt, 1e-3) / d.k1;
      d.prevY = y;
      s = -Math.min(0.32, 0.02 * Math.abs(v));
      face = v > 0 ? "o" : "woah";
    } else {
      // Landed: two bounces, a squash at each touchdown, then settle.
      let tc = FALL_TIME; // the last touchdown
      let h = 0;
      let amp = 0.55;
      let air = 0;
      for (const [bh, bd] of FALL_BOUNCES) {
        if (t < tc + bd) {
          const v = (t - tc) / bd;
          h = 4 * bh * v * (1 - v);
          air = 1 - 2 * v; // rising +1 … falling -1
          break;
        }
        tc += bd;
        amp *= 0.55;
      }
      x = land.x;
      y = land.y + h * d.k1;
      k = d.k1;
      const since = t - tc;
      s = amp * Math.exp(-since / 0.09) - (h > 0 ? 0.12 * Math.abs(air) : 0);
      face = t - FALL_TIME < 0.22 ? "grimace" : "elated";
    }
    n.position.set(x, y, 0);
    n.scaling.set(k * (1 + 0.6 * s), k * (1 - 0.7 * s), k * (1 + 0.6 * s));
    if (face !== d.face) {
      d.face = face;
      this.face.set(face === "default" ? null : face);
    }
  }

  // Fit the logo (words, a gap, the apple) into its band, as big as the
  // screen allows.
  _layout() {
    const cam = this.camera;
    const box = cam.getEngine().getRenderingCanvas().getBoundingClientRect();
    const perPx = (cam.orthoTop - cam.orthoBottom) / box.height;
    const band = this.fit();
    const top = cam.position.y + cam.orthoTop - band.top * perPx;
    const bottom = cam.position.y + cam.orthoTop - band.bottom * perPx;
    const w = this.words;
    const tall = w.h * (1 + LOGO_PULSE) + w.h * (0.08 + LOGO_APPLE_H);
    const s = Math.max(0, Math.min((0.9 * (cam.orthoRight - cam.orthoLeft)) / (w.w * (1 + LOGO_PULSE)), (top - bottom) / tall));
    this.scale = s;
    const blockTop = (top + bottom) / 2 + (s * tall) / 2;
    const wordsMid = blockTop - (s * w.h * (1 + LOGO_PULSE)) / 2;
    w.node.position.set(cam.position.x, wordsMid - s * w.mid, 0);
    const k = (s * w.h * LOGO_APPLE_H) / this.apple.h;
    this.apple.node.scaling.setAll(k);
    this.apple.node.position.set(cam.position.x, blockTop - s * tall - k * (this.apple.mid - this.apple.h / 2), 0);
  }
}

// ─── Intro ───────────────────────────────────────────────────────────
// Into Apple Toss or Apple Run from the title: the logo, drawn over the
// game just where the title's was, sends its apple down as Royale's does,
// the game's camera swinging down from the sky (aim), the words left up
// there; the apple lands on its spot, where the game's own takes over.

const INTRO_PITCH = 1.15; // how far the camera starts tipped up to the sky (radians)

class Intro extends Overlay {
  // Over `game` ({ engine, camera }), loading the logo's models.
  static async create(game) {
    const intro = new Intro(game);
    const scene = intro.scene;
    addLights(scene);
    const [words, apple] = await Promise.all(
      ["title", "apple"].map((n) => BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", `${n}.glb`, scene)),
    );
    intro.logo = new Logo(scene, intro.camera, words, apple, loadFaces(scene), () => intro.band);
    return intro;
  }

  constructor(game) {
    super(game.engine, "intro");
    this.game = game;
    this.t = 0;
    this.running = false;
  }

  // Off, from the logo fitted in `band` (the title's: Logo's fit()).
  start(band) {
    this.band = band;
    this.fit();
    this.logo.show(true);
    this.logo.update(0);
    this.logo.idle && this.logo.idle.stop();
    this.wordsY = this.logo.words.node.position.y;
    this.t = 0;
    this.started = false;
    this.running = true;
  }

  // A frame, with the game's camera where it belongs (before aim): spot is
  // where the game's apple stands (its feet), in the game's world; height,
  // how tall the apple is there.
  update(dt, spot, height) {
    if (!this.running) return;
    this.fit();
    if (!this.started) {
      // The apple's size in the game, on the screen.
      this.started = true;
      const [feet, head] = [this._screen(spot), this._screen(spot.add(new V3(0, height, 0)))];
      this.logo.startFall(Math.abs(head.y - feet.y) / this.logo.apple.h);
    }
    this.t += dt;
    const viewH = this.camera.orthoTop - this.camera.orthoBottom;
    this.logo.words.node.position.y = this.wordsY + 1.3 * viewH * fallEase(this.t / FALL_TIME);
    this.logo.fallFrame(this.t, dt, 0, 0, 0, this._screen(spot), viewH);
    if (this.t >= FALL_TIME) {
      this.running = false;
      this.logo.show(false);
    }
  }

  // Tip the game's camera (placed where it belongs) up to the sky, as far
  // as the fall has yet to bring it down.
  aim(camera) {
    if (this.running) camera.rotation.x -= INTRO_PITCH * (1 - fallEase(this.t / FALL_TIME));
  }

  render() {
    if (this.running) this.scene.render();
  }

  // Where a point in the game's world is on the screen, in the logo's units.
  _screen(p) {
    const cam = this.game.camera;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const vp = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
    const s = V3.Project(p, BABYLON.Matrix.Identity(), vp, new BABYLON.Viewport(0, 0, w, h));
    return { x: s.x - w / 2, y: h / 2 - s.y };
  }
}
