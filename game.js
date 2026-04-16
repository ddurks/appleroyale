// ═══════════════════════════════════════════════════════════════════════
// Apple Royale – 2.5D Platformer POC
// Babylon.js + Havok Physics
// ═══════════════════════════════════════════════════════════════════════

// ─── Tuning Constants ────────────────────────────────────────────────

const MOVE_SPEED = 6;
const JUMP_IMPULSE = 12;
const SCENE_GRAVITY = -20;
const GROUND_CAST = 0.75; // raycast distance from capsule center
const KILL_Y = -15;
const SPAWN_X = 0;
const SPAWN_Y = 3;

const EYE_MAX_YAW = 0.25; // radians (~14°)
const EYE_MAX_PITCH = 0.18; // radians (~10°)
const EYE_LERP = 6;

const BRANCH_BREAK_T = 2.0; // seconds standing before break
const BRANCH_WARN_T = 1.0; // seconds before warning visual starts
const BRANCH_COLOR = new BABYLON.Color3(0.4, 0.29, 0.23);
const BRANCH_DANGER = new BABYLON.Color3(0.85, 0.18, 0.1);

// ─── Bark Material ───────────────────────────────────────────────────

function createBarkMaterial(name, scene) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString("#65493A");
  mat.specularColor = BABYLON.Color3.Black();
  mat.roughness = 1;
  return mat;
}

// ─── Fractal Decorative Branches ─────────────────────────────────────

function spawnTwigs(
  root,
  scene,
  barkMat,
  branchWidth,
  branchX,
  rng,
  xOff,
  zOff,
) {
  const branchRadius = 0.25;
  const embed = 0.12;
  const count = 3 + Math.floor(rng() * 6);

  // Twigs reach outward from trunk: sign = dominant direction
  // branchX > 0 → twigs lean right (+angle), branchX < 0 → lean left (-angle)
  const outward = branchX >= 0 ? 1 : -1;

  for (let i = 0; i < count; i++) {
    const side = rng() > 0.5 ? 1 : -1; // sprout up or down
    // Position twig toward the outer half of the branch
    const baseX =
      outward * (rng() * 0.4) * branchWidth + (rng() - 0.5) * branchWidth * 0.2;
    const baseY = side * (branchRadius - embed);

    const len = 1.0 + rng() * 1.4;
    const diam = 0.18 + rng() * 0.1;
    // Bias angle outward from trunk, with small random variation
    const baseAngle = outward * (0.3 + rng() * 0.4);
    const angle = baseAngle + (rng() - 0.5) * 0.25;

    const twig = BABYLON.MeshBuilder.CreateCylinder(
      "twig",
      {
        height: len,
        diameterBottom: diam,
        diameterTop: diam * 0.4,
        tessellation: 6,
      },
      scene,
    );
    twig.material = barkMat;
    twig.parent = root;
    twig.position.set(
      xOff + baseX + Math.sin(angle) * len * 0.5,
      baseY + side * Math.cos(angle) * len * 0.5,
      zOff + (rng() - 0.5) * 0.1,
    );
    twig.rotation.z = side > 0 ? -angle : Math.PI + angle;

    // Tip of this twig — sub-twigs sprout here
    const tipX = baseX + Math.sin(angle) * len;
    const tipY = baseY + side * Math.cos(angle) * len;

    const subCount = 1 + Math.floor(rng() * 2);
    for (let j = 0; j < subCount; j++) {
      const subLen = len * (0.35 + rng() * 0.3);
      const subDiam = diam * 0.55;
      const subEmbed = 0.06;
      // Sub-twigs continue outward with more spread
      const subAngle =
        angle + outward * (0.1 + rng() * 0.4) + (rng() - 0.5) * 0.2;

      const sub = BABYLON.MeshBuilder.CreateCylinder(
        "twig",
        {
          height: subLen,
          diameterBottom: subDiam,
          diameterTop: subDiam * 0.35,
          tessellation: 5,
        },
        scene,
      );
      sub.material = barkMat;
      sub.parent = root;
      sub.position.set(
        xOff +
          tipX +
          Math.sin(subAngle) * subLen * 0.5 -
          Math.sin(subAngle) * subEmbed,
        tipY +
          side *
            (Math.cos(subAngle) * subLen * 0.5 - Math.cos(subAngle) * subEmbed),
        twig.position.z + (rng() - 0.5) * 0.05,
      );
      sub.rotation.z = side > 0 ? -subAngle : Math.PI + subAngle;
    }
  }
}

// ─── InputManager ────────────────────────────────────────────────────

class InputManager {
  constructor() {
    this.left = false;
    this.right = false;
    this._jumpRequest = false;
    this._jumpHeld = false;

    const gameKeys = new Set([
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "KeyA",
      "KeyD",
      "Space",
    ]);

    window.addEventListener("keydown", (e) => {
      if (gameKeys.has(e.code)) e.preventDefault();
      this._key(e.code, true);
    });
    window.addEventListener("keyup", (e) => this._key(e.code, false));
  }

  _key(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;
    if (code === "Space") {
      if (down && !this._jumpHeld) this._jumpRequest = true;
      this._jumpHeld = down;
    }
  }

  consumeJump() {
    if (this._jumpRequest) {
      this._jumpRequest = false;
      return true;
    }
    return false;
  }
}

// ─── BranchPlatform ──────────────────────────────────────────────────

class BranchPlatform {
  constructor(scene, x, y, width, breakable, barkMat) {
    this.scene = scene;
    this.breakable = breakable;
    this.broken = false;
    this.falling = false;
    this.timer = 0;
    this.fallVel = 0;
    this.origX = x;
    this.origY = y;

    // Root node holds everything — no rotation, so twigs use simple XY coords
    this.root = new BABYLON.TransformNode("branchRoot", scene);
    this.root.position.set(x, y, 0);

    // Visual branch: starts 0.6 inside the trunk and extends outward only
    const tipSide = x >= 0 ? 1 : -1;
    const trunkEmbed = 0.6;
    const outerTip = x + tipSide * (width / 2); // world X of outer end
    const innerStart = -tipSide * trunkEmbed; // world X of inner end (inside trunk)
    const visWidth = Math.abs(outerTip - innerStart);
    // Visual center relative to root (root is at world x)
    const visCenterX = (outerTip + innerStart) / 2 - x;

    // Visible tapered cylinder — extends from trunk outward
    this.visual = BABYLON.MeshBuilder.CreateCylinder(
      "branchVis",
      {
        height: visWidth,
        diameterTop: 0.8,
        diameterBottom: 0.4,
        tessellation: 12,
      },
      scene,
    );
    this.visual.parent = this.root;
    this.visual.position.set(visCenterX, 0, 3);
    // Thin end points outward, thick end toward trunk
    this.visual.rotation.z = tipSide > 0 ? Math.PI / 2 : -Math.PI / 2;

    // Breakable branches get own material clone for danger tinting
    if (breakable) {
      this.mat = barkMat.clone("bmat_" + x + "_" + y);
      this.ownsMat = true;
    } else {
      this.mat = barkMat;
      this.ownsMat = false;
    }
    this.visual.material = this.mat;

    // Seeded RNG per branch for deterministic twigs
    let seed = Math.abs(x * 1000 + y * 7 + width * 13) | 0;
    const rng = () => {
      seed = (seed * 16807 + 11) % 2147483647;
      return (seed & 0x7fffffff) / 0x7fffffff;
    };
    spawnTwigs(this.root, scene, barkMat, width, x, rng, visCenterX, 3);

    // Invisible physics mesh — matches visual position at z=0
    this.mesh = BABYLON.MeshBuilder.CreateCylinder(
      "branch",
      {
        height: visWidth,
        diameter: 0.5,
        tessellation: 8,
      },
      scene,
    );
    this.mesh.parent = this.root;
    this.mesh.position.x = visCenterX;
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.isVisible = false;

    // Physics — box approximation (defined in mesh local space, before rotation)
    // Local Y = cylinder axis. After 90° Z-rotation, local Y → world X.
    const shape = new BABYLON.PhysicsShapeBox(
      BABYLON.Vector3.Zero(),
      BABYLON.Quaternion.Identity(),
      new BABYLON.Vector3(0.45, visWidth, 0.45),
      scene,
    );
    this.body = new BABYLON.PhysicsBody(
      this.mesh,
      BABYLON.PhysicsMotionType.STATIC,
      false,
      scene,
    );
    this.body.shape = shape;
  }

  /** Called each frame the player is standing on this branch. Returns 0–1 danger level. */
  playerStanding(dt) {
    if (!this.breakable || this.broken) return 0;
    this.timer += dt;

    const danger = Math.max(
      0,
      (this.timer - BRANCH_WARN_T) / (BRANCH_BREAK_T - BRANCH_WARN_T),
    );
    if (danger > 0) {
      const shake = Math.sin(this.timer * 35) * 0.04 * danger;
      this.root.position.x = this.origX + shake;
      this.root.position.y = this.origY + shake * 0.5;
      this.mat.diffuseColor = BABYLON.Color3.Lerp(
        BRANCH_COLOR,
        BRANCH_DANGER,
        danger,
      );
    }
    if (this.timer >= BRANCH_BREAK_T) this._break();
    return danger;
  }

  /** Called each frame the player is NOT on this branch. Slowly recovers. */
  playerLeft() {
    if (this.broken) return;
    this.timer = Math.max(0, this.timer - 0.4 * (1 / 60));
    this.root.position.x = BABYLON.Scalar.Lerp(
      this.root.position.x,
      this.origX,
      0.1,
    );
    this.root.position.y = BABYLON.Scalar.Lerp(
      this.root.position.y,
      this.origY,
      0.1,
    );
    this.mat.diffuseColor = BABYLON.Color3.Lerp(
      this.mat.diffuseColor,
      BRANCH_COLOR,
      0.05,
    );
  }

  _break() {
    this.broken = true;
    this.falling = true;
    this.body.dispose();
  }

  /** Returns false when the branch should be removed from the list. */
  update(dt) {
    if (this.falling) {
      this.fallVel += 15 * dt;
      this.root.position.y -= this.fallVel * dt;
      this.root.rotation.z += dt * 2;
      if (this.root.position.y < KILL_Y - 20) {
        this.root.dispose();
        if (this.ownsMat && this.mat) this.mat.dispose();
        return false;
      }
    }
    return true;
  }

  dispose() {
    if (!this.broken && this.body) this.body.dispose();
    if (this.root && !this.root.isDisposed?.()) this.root.dispose();
    if (this.ownsMat && this.mat) this.mat.dispose();
  }
}

// ─── PlayerController ────────────────────────────────────────────────

class PlayerController {
  constructor(scene, input) {
    this.scene = scene;
    this.input = input;
    this.ready = false;

    this.grounded = false;
    this.wasGrounded = true;
    this.standingBody = null;
    this.branchDanger = 0;

    // Jump helpers
    this.jumpBuffer = 0;
    this.coyoteTime = 0;
    this.jumpWindup = 0; // countdown before impulse fires

    // Eye glance state
    this.eyeL = null;
    this.eyeR = null;
    this.eyeLRest = null;
    this.eyeRRest = null;
    this.eyeYaw = 0;
    this.eyePitch = 0;

    // Animation state
    this.anims = {};
    this.currentAnim = "";

    // Face expression system
    this.faceMesh = null;
    this.faceMat = null;
    this.faceTextures = {};
    this.currentFace = "default";

    // Invisible capsule for physics
    this.mesh = BABYLON.MeshBuilder.CreateCapsule(
      "player",
      {
        height: 1.2,
        radius: 0.35,
      },
      scene,
    );
    this.mesh.isVisible = false;
    this.mesh.position.set(SPAWN_X, SPAWN_Y, 0);

    const shape = new BABYLON.PhysicsShapeCapsule(
      new BABYLON.Vector3(0, 0.25, 0),
      new BABYLON.Vector3(0, -0.25, 0),
      0.35,
      scene,
    );
    this.body = new BABYLON.PhysicsBody(
      this.mesh,
      BABYLON.PhysicsMotionType.DYNAMIC,
      false,
      scene,
    );
    this.body.shape = shape;
    this.body.setMassProperties({ mass: 1, inertia: BABYLON.Vector3.Zero() });
    this.body.setLinearDamping(0.1);

    this._loadModel();
  }

  async _loadModel() {
    const res = await BABYLON.SceneLoader.ImportMeshAsync(
      "",
      "./assets/",
      "apple.glb",
      this.scene,
    );

    // Put all loaded apple meshes in rendering group 2 (in front of trunk)
    for (const m of res.meshes) {
      m.renderingGroupId = 2;
    }

    this.root = res.meshes[0];
    this.root.parent = this.mesh;
    // Position apple visual so it sits at the bottom of the capsule.
    // Adjust these if the model appears offset.
    this.root.position.set(0, -0.6, 0);

    // Collect animation groups
    for (const ag of res.animationGroups) {
      this.anims[ag.name] = ag;
      ag.stop();
    }
    this._playAnim("idle");

    // Find eye transform nodes via their bones — scene.getTransformNodeByName
    // can return the wrong node; going through the bone gets the linked TN
    // that actually drives the skinned mesh.
    this.eyeL = null;
    this.eyeR = null;
    if (res.skeletons.length) {
      const sk = res.skeletons[0];
      const bL = sk.bones.find((b) => b.name === "eyeball.l");
      const bR = sk.bones.find((b) => b.name === "eyeball.r");
      if (bL) this.eyeL = bL.getTransformNode();
      if (bR) this.eyeR = bR.getTransformNode();
    }

    // Save rest (bind-pose) quaternion for each eye
    this.eyeLRest = this.eyeL?.rotationQuaternion?.clone() ?? null;
    this.eyeRRest = this.eyeR?.rotationQuaternion?.clone() ?? null;

    // Find the face decal mesh and preload face textures
    this.faceMesh =
      res.meshes.find((m) => m.name.toLowerCase().includes("face")) || null;
    if (this.faceMesh) {
      this.faceMat = this.faceMesh.material;
      const faceNames = ["elated", "o", "frown", "grimace", "woah"];
      for (const name of faceNames) {
        const tex = new BABYLON.Texture(
          `./assets/faces/${name}.png`,
          this.scene,
          false,
          false,
          BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
        );
        tex.hasAlpha = true;
        this.faceTextures[name] = tex;
      }
      // Store the default texture
      if (this.faceMat.albedoTexture) {
        this.faceTextures["default"] = this.faceMat.albedoTexture;
      } else if (this.faceMat.diffuseTexture) {
        this.faceTextures["default"] = this.faceMat.diffuseTexture;
      }
      console.log(
        "Face mesh found:",
        this.faceMesh.name,
        "Faces loaded:",
        Object.keys(this.faceTextures).join(", "),
      );
    }

    console.log("Apple loaded. Eyes found:", this.eyeL, this.eyeR);
    console.log("Animations:", Object.keys(this.anims).join(", "));

    // ── Eye debug dump ──────────────────────────────────────────────
    for (const label of ["eyeL", "eyeR"]) {
      const tn = this[label];
      if (!tn) continue;
      console.log(`[EYE DEBUG] ${label}:`, {
        type: tn.constructor.name,
        parent: tn.parent?.name,
        hasRotQ: !!tn.rotationQuaternion,
        restQ: this[label === "eyeL" ? "eyeLRest" : "eyeRRest"]?.toString(),
      });
    }

    // List all skeleton bones so we can see the hierarchy
    if (res.skeletons.length) {
      const sk = res.skeletons[0];
      console.log(
        "[EYE DEBUG] Skeleton bones:",
        sk.bones.map(
          (b) =>
            `${b.name} (idx=${b.getIndex()}, parent=${b.getParent()?.name})`,
        ),
      );
    }

    // List meshes linked to the skeleton to see which are skinned
    const skinnedMeshes = this.scene.meshes.filter((m) => m.skeleton);
    console.log(
      "[EYE DEBUG] Skinned meshes:",
      skinnedMeshes.map((m) => m.name),
    );

    this.ready = true;
  }

  _playAnim(name, loop = true) {
    if (this.currentAnim === name || !this.anims[name]) return;
    for (const a of Object.values(this.anims)) a.stop();
    const ag = this.anims[name];
    ag.start(loop);
    if (name === "move.left" || name === "move.left.001") ag.speedRatio = 4;
    else if (name === "idle") ag.speedRatio = 2;
    else if (name === "jump") ag.speedRatio = 2;
    else ag.speedRatio = 1;
    this.currentAnim = name;
  }

  update(dt) {
    if (!this.ready) return;

    const vel = this.body.getLinearVelocity();
    let vx = 0;
    if (this.input.left) vx -= MOVE_SPEED;
    if (this.input.right) vx += MOVE_SPEED;

    // Ground check — raycast from capsule center downward
    const p = this.mesh.position;
    const from = new BABYLON.Vector3(p.x, p.y, p.z);
    const to = new BABYLON.Vector3(p.x, p.y - GROUND_CAST, p.z);
    const hit = this.scene.getPhysicsEngine().raycast(from, to);

    this.grounded = hit.hasHit;
    this.standingBody = hit.hasHit ? hit.body : null;

    // Coyote time + jump buffer
    if (this.grounded) this.coyoteTime = 0.1;
    else this.coyoteTime -= dt;

    if (this.input.consumeJump()) this.jumpBuffer = 0.15;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    let vy = vel.y;
    const canJump = this.grounded || this.coyoteTime > 0;
    if (this.jumpBuffer > 0 && canJump && this.jumpWindup <= 0) {
      // Start wind-up: play anim at 2x, delay the impulse
      this.jumpWindup = 0.15;
      this.jumpBuffer = 0;
      this.coyoteTime = 0;
      this._playAnim("jump", false);
    }

    if (this.jumpWindup > 0) {
      this.jumpWindup -= dt;
      if (this.jumpWindup <= 0) {
        vy = JUMP_IMPULSE;
      }
    }

    // Apply velocity. Z spring keeps player on the gameplay plane.
    this.body.setLinearVelocity(new BABYLON.Vector3(vx, vy, -p.z * 10));

    // Animations (grounded state drives which anim plays)
    if (this.grounded) {
      if (!this.wasGrounded || this.currentAnim !== "jump") {
        if (vx > 0) this._playAnim("move.left.001");
        else if (vx < 0) this._playAnim("move.left");
        else this._playAnim("idle");
      }
    }
    this.wasGrounded = this.grounded;

    // Face expressions based on state
    if (this.jumpWindup > 0 || (!this.grounded && vel.y > 0)) {
      this._setFace("elated");
    } else if (!this.grounded && vel.y < -JUMP_IMPULSE * 0.7) {
      this._setFace("woah");
    } else if (this.grounded) {
      this._setFace("default");
    }

    // Respawn
    if (p.y < KILL_Y) this.respawn();
  }

  _setFace(name) {
    if (this.currentFace === name || !this.faceMat || !this.faceTextures[name])
      return;
    this.currentFace = name;
    const tex = this.faceTextures[name];
    if (this.faceMat.albedoTexture !== undefined) {
      this.faceMat.albedoTexture = tex;
    } else {
      this.faceMat.diffuseTexture = tex;
    }
  }

  /** Apply eye rotation AFTER animation evaluation so we override bone poses. */
  updateEyes(dt) {
    if (!this.eyeL && !this.eyeR) return;

    const vel = this.body.getLinearVelocity();
    let targetYaw = 0,
      targetPitch = 0;

    // Look in movement direction
    if (this.input.left) targetYaw = -EYE_MAX_YAW;
    if (this.input.right) targetYaw = EYE_MAX_YAW;

    // Look down while falling
    if (!this.grounded && vel.y < -1) {
      targetPitch = EYE_MAX_PITCH * Math.min(1, Math.abs(vel.y) / 8);
    }

    // Glance toward danger when on a breaking branch
    if (this.branchDanger > 0.3) {
      targetPitch = Math.max(targetPitch, EYE_MAX_PITCH * this.branchDanger);
    }

    // Smooth exponential interpolation
    const f = 1 - Math.exp(-EYE_LERP * dt);
    this.eyeYaw += (targetYaw - this.eyeYaw) * f;
    this.eyePitch += (targetPitch - this.eyePitch) * f;

    const gazeQ = BABYLON.Quaternion.FromEulerAngles(
      this.eyePitch,
      this.eyeYaw,
      0,
    );

    if (this.eyeL && this.eyeLRest) {
      this.eyeL.rotationQuaternion = gazeQ.multiply(this.eyeLRest);
    }
    if (this.eyeR && this.eyeRRest) {
      this.eyeR.rotationQuaternion = gazeQ.multiply(this.eyeRRest);
    }
  }

  respawn() {
    this.mesh.position.set(SPAWN_X, SPAWN_Y, 0);
    this.body.setLinearVelocity(BABYLON.Vector3.Zero());
    this.body.setAngularVelocity(BABYLON.Vector3.Zero());
  }
}

// ─── Game ────────────────────────────────────────────────────────────

const BRANCH_DATA = [
  { x: 0, y: 1, w: 8, brk: false }, // start platform (unbreakable)
  { x: -3.5, y: 4, w: 10, brk: true },
  { x: 4, y: 7, w: 12, brk: true },
  { x: -2.5, y: 10, w: 8, brk: true },
  { x: 3, y: 13, w: 10, brk: true },
  { x: -4, y: 16, w: 12, brk: true },
  { x: 2, y: 19, w: 8, brk: true },
];

class Game {
  constructor(canvas) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.branches = [];
    this.input = new InputManager();
    this.player = null;

    this._init().then(() => {
      this.engine.runRenderLoop(() => {
        const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
        this._update(dt);
        this.scene.render();
      });
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
      this._updateOrtho();
      if (this.bgTex) this._buildBgPlane(this.bgTex);
      if (this.treeTex) this._buildTreePlane(this.treeTex);
    });
  }

  _updateOrtho() {
    const aspect = this.engine.getAspectRatio(this.camera);
    const halfH = 15;
    const halfW = halfH * aspect;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
  }

  async _init() {
    const scene = this.scene;

    // Sky
    scene.clearColor = new BABYLON.Color4(0.53, 0.76, 0.96, 1);

    // Lighting
    const hemi = new BABYLON.HemisphericLight(
      "hemi",
      new BABYLON.Vector3(0.2, 1, -0.4),
      scene,
    );
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight(
      "dir",
      new BABYLON.Vector3(-0.5, -1, 0.3),
      scene,
    );
    dir.intensity = 0.4;

    // Havok physics
    const hk = await HavokPhysics();
    scene.enablePhysics(
      new BABYLON.Vector3(0, SCENE_GRAVITY, 0),
      new BABYLON.HavokPlugin(true, hk),
    );

    // Camera — side view, orthographic
    this.camera = new BABYLON.FreeCamera(
      "cam",
      new BABYLON.Vector3(0, 10, -18),
      scene,
    );
    this.camera.setTarget(new BABYLON.Vector3(0, 10, 0));
    this.camera.minZ = 0.1;
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this._updateOrtho();

    // ── Background ───────────────────────────────────────────────────

    // Full-screen background: appletreebg.png (square), covers viewport
    const bgTex = new BABYLON.Texture(
      "./assets/appletreebg.png",
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        this._buildBgPlane(bgTex);
      },
    );
    this.bgTex = bgTex;

    // Mid layer: appletree.png — world-space, just behind gameplay, alpha transparent
    const treeTex = new BABYLON.Texture(
      "./assets/appletree.png",
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        this._buildTreePlane(treeTex);
      },
    );
    treeTex.hasAlpha = true;
    this.treeTex = treeTex;

    this.barkMat = createBarkMaterial("bark", scene);

    // Tree trunk — sits at the tree plane Z, half embedded
    const trunk = BABYLON.MeshBuilder.CreateCylinder(
      "trunk",
      { height: 30, diameter: 1.6, tessellation: 16 },
      scene,
    );
    trunk.position.set(0, 12, 3);
    trunk.material = this.barkMat;

    // Branches
    this._buildBranches();

    // Player
    this.player = new PlayerController(scene, this.input);

    // Eye update runs AFTER animation evaluation to override bone poses
    scene.onAfterAnimationsObservable.add(() => {
      if (this.player?.ready) {
        this.player.updateEyes(this.engine.getDeltaTime() / 1000);
      }
    });
  }

  _buildBranches() {
    for (const b of this.branches) b.dispose();
    this.branches = [];
    for (const d of BRANCH_DATA) {
      this.branches.push(
        new BranchPlatform(this.scene, d.x, d.y, d.w, d.brk, this.barkMat),
      );
    }
  }

  _buildBgPlane(tex) {
    if (this.bgPlane) this.bgPlane.dispose();
    if (this.bgMat) this.bgMat.dispose();

    // Ortho: visible size = ortho bounds
    const halfH = 15;
    const aspect = this.engine.getAspectRatio(this.camera);
    const halfW = halfH * aspect;
    const size = Math.max(halfW * 2, halfH * 2) * 1.05;

    const bgPlane = BABYLON.MeshBuilder.CreatePlane(
      "bg",
      { width: size, height: size },
      this.scene,
    );
    bgPlane.parent = this.camera;
    bgPlane.position.set(0, 0, 40);
    bgPlane.isPickable = false;

    const bgMat = new BABYLON.StandardMaterial("bgMat", this.scene);
    bgMat.diffuseTexture = tex;
    bgMat.emissiveTexture = tex;
    bgMat.emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgPlane.material = bgMat;
    this.bgPlane = bgPlane;
    this.bgMat = bgMat;
  }

  _buildTreePlane(tex) {
    if (this.treePlane) this.treePlane.dispose();
    if (this.treeMat) this.treeMat.dispose();

    const imgSize = tex.getSize();
    if (!imgSize.width || !imgSize.height) return;
    const imgAspect = imgSize.width / imgSize.height;

    // Ortho: fixed world-unit width for the tree image
    const planeWidth = 18;
    const tileHeight = planeWidth / imgAspect;
    const worldHeight = 60;
    const vTiles = Math.ceil(worldHeight / tileHeight);
    const planeHeight = tileHeight * vTiles;

    const treePlane = BABYLON.MeshBuilder.CreatePlane(
      "treeBg",
      { width: planeWidth, height: planeHeight },
      this.scene,
    );
    treePlane.position.set(0, 5, 3);
    treePlane.isPickable = false;

    const treeMat = new BABYLON.StandardMaterial("treeMat", this.scene);
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 1;
    tex.vScale = vTiles;
    treeMat.diffuseTexture = tex;
    treeMat.opacityTexture = tex;
    treeMat.specularColor = BABYLON.Color3.Black();
    treeMat.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    treeMat.backFaceCulling = false;
    treeMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    treePlane.material = treeMat;
    this.treePlane = treePlane;
    this.treeMat = treeMat;
  }

  _update(dt) {
    if (!this.player?.ready) return;

    this.player.update(dt);

    // Branch contact & break logic
    this.player.branchDanger = 0;
    const pBody = this.player.standingBody;

    for (let i = this.branches.length - 1; i >= 0; i--) {
      const b = this.branches[i];
      if (!b.broken && pBody === b.body) {
        const danger = b.playerStanding(dt);
        this.player.branchDanger = Math.max(this.player.branchDanger, danger);
      } else {
        b.playerLeft();
      }
      if (!b.update(dt)) this.branches.splice(i, 1);
    }

    // Respawn → rebuild all branches
    if (this.player.mesh.position.y < KILL_Y) {
      this.player.respawn();
      this._buildBranches();
    }

    // Camera smooth follow — slide only, no rotation
    const pp = this.player.mesh.position;
    const tx = pp.x * 0.4;
    const ty = pp.y + 3;
    this.camera.position.x += (tx - this.camera.position.x) * 0.08;
    this.camera.position.y += (ty - this.camera.position.y) * 0.08;
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  new Game(document.getElementById("renderCanvas"));
});
