// ═══════════════════════════════════════════════════════════════════════
// Apple Royale - 3D Rolling Sphere Demo
// Babylon.js + Havok Physics
// ═══════════════════════════════════════════════════════════════════════

const GRAVITY = -24;
const KILL_Y = -35;

const APPLE_RADIUS = 0.72;
const SPAWN_POS = new BABYLON.Vector3(0, 5, 0);

const MAX_ROLL_SPEED = 13.5;
const ROLL_ACCEL = 44;
const AIR_ROLL_ACCEL = 9;
const SIDE_SLIP_DAMP = 9.5;
const STOP_SPIN_DAMP = 3.5;
const MAX_ANGULAR_SPEED = 24;

const JUMP_IMPULSE = 24;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const GROUND_CAST = APPLE_RADIUS + 0.4;
const GROUND_Y_DAMP = 0.88;
const FALL_SPEED_LIMIT = -22;

const CAMERA_LERP = 0.08;
const CAMERA_HEIGHT = 4.2;
const CAMERA_DISTANCE = 9.5;
const CAMERA_Y_DAMP = 0.06;
const CAMERA_DIR_LERP = 0.12;
const CAMERA_DIR_DEADZONE_SPEED = 0.6;

const EYE_MAX_YAW = 0.3;
const EYE_MAX_PITCH = 0.15;
const EYE_LERP = 7;

const HOP_MOVE_IMPULSE = 8;

const NORMAL_JUMP_HEIGHT =
  (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * Math.abs(GRAVITY));
const FALL_SQUISH_START_HEIGHT = NORMAL_JUMP_HEIGHT;
const FALL_FATAL_HEIGHT = NORMAL_JUMP_HEIGHT * 1.5;
const FATAL_SLICE_LIFETIME_MS = 5000;
const FATAL_RESPAWN_DELAY_MS = 5000;

class InputManager3D {
  constructor() {
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;

    this._jumpHeld = false;
    this._jumpRequest = false;

    const gameKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
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
    if (code === "ArrowUp" || code === "KeyW") this.forward = down;
    if (code === "ArrowDown" || code === "KeyS") this.backward = down;
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;

    if (code === "Space") {
      if (down && !this._jumpHeld) this._jumpRequest = true;
      this._jumpHeld = down;
    }
  }

  consumeJump() {
    if (!this._jumpRequest) return false;
    this._jumpRequest = false;
    return true;
  }

  moveAxes() {
    let x = 0;
    let z = 0;
    if (this.left) x -= 1;
    if (this.right) x += 1;
    if (this.forward) z += 1;
    if (this.backward) z -= 1;
    return { x, z };
  }
}

class RollingApplePlayer {
  constructor(scene, input, shadowGenerator = null) {
    this.scene = scene;
    this.input = input;
    this.shadowGenerator = shadowGenerator;

    this.ready = false;
    this.grounded = false;
    this.colliderMode = "sphere";

    this.visualPivot = null;
    this.rootBaseRotation = BABYLON.Quaternion.Identity();
    this.rootForwardFix = BABYLON.Quaternion.FromEulerAngles(0, Math.PI, 0);

    this.moveDir = new BABYLON.Vector3(0, 0, 1);
    this.headingYaw = 0;
    this.leanPitch = 0;
    this.leanRoll = 0;

    this.jumpBuffer = 0;
    this.coyoteTimer = 0;

    this.eyeL = null;
    this.eyeR = null;
    this.eyeLRest = null;
    this.eyeRRest = null;
    this.eyeYaw = 0;
    this.eyePitch = 0;

    this.anims = {};
    this.currentAnim = "";
    this.jumpAnimLock = 0;
    this.hopAnimNames = [];
    this.moveAnimNames = [];
    this.squishAnimNames = [];

    this.hopImpulsePending = false;

    this.hasGroundSample = false;
    this.wasGrounded = false;
    this.airbornePeakY = SPAWN_POS.y;
    this.fallState = "none";
    this.sliceBurst =
      typeof window.AppleSliceBurstEffect === "function"
        ? new window.AppleSliceBurstEffect(scene, {
            shadowGenerator: this.shadowGenerator,
          })
        : null;

    this.bodyMesh = BABYLON.MeshBuilder.CreateSphere(
      "applePhysicsSphere",
      { diameter: APPLE_RADIUS * 2, segments: 20 },
      scene,
    );
    this.bodyMesh.position.copyFrom(SPAWN_POS);
    this.bodyMesh.isVisible = false;

    this.body = new BABYLON.PhysicsBody(
      this.bodyMesh,
      BABYLON.PhysicsMotionType.DYNAMIC,
      false,
      scene,
    );
    this.body.shape = new BABYLON.PhysicsShapeSphere(
      BABYLON.Vector3.Zero(),
      APPLE_RADIUS,
      scene,
    );
    this.body.setMassProperties({ mass: 1.6 });
    this.body.setLinearDamping(0.06);
    this.body.setAngularDamping(0.15);

    this._loadModel();
  }

  async _loadModel() {
    try {
      const res = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        "./assets/",
        "apple.glb",
        this.scene,
      );

      // Keep default rendering group so depth testing decides occlusion correctly.
      if (this.shadowGenerator) {
        for (const m of res.meshes) {
          if (
            m &&
            typeof m.getTotalVertices === "function" &&
            m.getTotalVertices() > 0
          ) {
            this.shadowGenerator.addShadowCaster(m, true);
            m.receiveShadows = true;
          }
        }
      }

      for (const ag of res.animationGroups) {
        this.anims[ag.name] = ag;
        ag.stop();
      }
      this._cacheAnimAliases();
      this._bindHopLoopTriggers();

      this.root = res.meshes[0];
      this.visualPivot = new BABYLON.TransformNode(
        "appleVisualPivot",
        this.scene,
      );
      this.visualPivot.position.set(
        this.bodyMesh.position.x,
        this.bodyMesh.position.y - APPLE_RADIUS,
        this.bodyMesh.position.z,
      );

      const localPos = this.root.position?.clone() ?? BABYLON.Vector3.Zero();
      const localRotQ = this.root.rotationQuaternion
        ? this.root.rotationQuaternion.clone()
        : BABYLON.Quaternion.FromEulerAngles(
            this.root.rotation?.x ?? 0,
            this.root.rotation?.y ?? 0,
            this.root.rotation?.z ?? 0,
          );
      this.rootBaseRotation = localRotQ;

      this.root.parent = this.visualPivot;
      this.root.position.copyFrom(localPos);
      this.root.rotationQuaternion = BABYLON.Quaternion.Identity();
      this.root.scaling.scaleInPlace(1.05);

      if (res.skeletons.length) {
        const sk = res.skeletons[0];
        const bL = sk.bones.find((b) => b.name === "eyeball.l");
        const bR = sk.bones.find((b) => b.name === "eyeball.r");
        if (bL) this.eyeL = bL.getTransformNode();
        if (bR) this.eyeR = bR.getTransformNode();
      }
      this.eyeLRest = this.eyeL?.rotationQuaternion?.clone() ?? null;
      this.eyeRRest = this.eyeR?.rotationQuaternion?.clone() ?? null;

      this._playAnim(["idle"], true);
      if (this.sliceBurst) void this.sliceBurst.preload();

      console.log("3D demo animations:", Object.keys(this.anims));
      console.log("Hop aliases:", this.hopAnimNames);

      this.ready = true;
    } catch (err) {
      console.error("Failed to load apple.glb", err);
      this.ready = true;
    }
  }

  _groundCheck() {
    const p = this.bodyMesh.position;
    const from = new BABYLON.Vector3(p.x, p.y, p.z);
    const to = new BABYLON.Vector3(p.x, p.y - GROUND_CAST, p.z);
    const hit = this.scene.getPhysicsEngine().raycast(from, to);
    this.grounded = hit.hasHit;
  }

  _desiredMoveDir(camera) {
    const axes = this.input.moveAxes();
    const inputVec = new BABYLON.Vector3(axes.x, 0, axes.z);
    if (inputVec.lengthSquared() < 0.0001) return BABYLON.Vector3.Zero();

    const camForward = camera.getTarget().subtract(camera.position);
    camForward.y = 0;
    if (camForward.lengthSquared() < 0.0001) return BABYLON.Vector3.Zero();
    camForward.normalize();

    const camRight = BABYLON.Vector3.Cross(
      BABYLON.Axis.Y,
      camForward,
    ).normalize();

    const move = camRight.scale(axes.x).add(camForward.scale(axes.z));
    move.y = 0;
    if (move.lengthSquared() > 0.0001) move.normalize();

    return move;
  }

  _applyRollingControl(desired) {
    if (desired.lengthSquared() < 0.0001) {
      const av = this.body.getAngularVelocity();
      const planarSpin = new BABYLON.Vector3(av.x, 0, av.z);
      this.body.applyTorque(planarSpin.scale(-STOP_SPIN_DAMP));
      return;
    }

    const torqueAxis = new BABYLON.Vector3(
      desired.z,
      0,
      -desired.x,
    ).normalize();
    const angVel = this.body.getAngularVelocity();

    const targetSpin = MAX_ROLL_SPEED / APPLE_RADIUS;
    const spinAlongAxis = BABYLON.Vector3.Dot(angVel, torqueAxis);
    const spinError = targetSpin - spinAlongAxis;

    const accel = this.grounded ? ROLL_ACCEL : AIR_ROLL_ACCEL;
    this.body.applyTorque(torqueAxis.scale(spinError * accel));

    const linVel = this.body.getLinearVelocity();
    const planarVel = new BABYLON.Vector3(linVel.x, 0, linVel.z);

    const forwardSpeed = BABYLON.Vector3.Dot(planarVel, desired);
    const forwardVec = desired.scale(forwardSpeed);
    const sideSlip = planarVel.subtract(forwardVec);

    if (this.grounded) {
      this.body.applyForce(
        sideSlip.scale(-SIDE_SLIP_DAMP),
        this.bodyMesh.position,
      );
    }
  }

  _applyHopImpulse(desired, didJumpThisFrame) {
    if (
      this.fallState !== "none" ||
      didJumpThisFrame ||
      !this.grounded ||
      desired.lengthSquared() < 0.0001
    ) {
      this.hopImpulsePending = false;
      return;
    }

    if (!this.hopImpulsePending) return;

    const lv = this.body.getLinearVelocity();
    const planarVel = new BABYLON.Vector3(lv.x, 0, lv.z);
    const forwardSpeed = BABYLON.Vector3.Dot(planarVel, desired);
    const speedError = Math.max(0, MAX_ROLL_SPEED - forwardSpeed);
    const impulse = desired.scale(HOP_MOVE_IMPULSE + speedError * 0.05);

    this.body.applyImpulse(impulse, this.bodyMesh.position);
    this.hopImpulsePending = false;
  }

  _clampAngularSpeed() {
    const av = this.body.getAngularVelocity();
    const speed = av.length();
    if (speed > MAX_ANGULAR_SPEED) {
      this.body.setAngularVelocity(av.scale(MAX_ANGULAR_SPEED / speed));
    }
  }

  _updateVisuals(dt, desired) {
    if (!this.root || !this.visualPivot) return;

    const p = this.bodyMesh.position;
    this.visualPivot.position.set(p.x, p.y - APPLE_RADIUS, p.z);

    const vel = this.body.getLinearVelocity();
    const planar = new BABYLON.Vector3(vel.x, 0, vel.z);

    let faceDir = desired;
    if (planar.lengthSquared() > 0.01) faceDir = planar.normalize();

    if (faceDir.lengthSquared() > 0.001) {
      const targetYaw = Math.atan2(faceDir.x, faceDir.z);
      let delta = targetYaw - this.headingYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.headingYaw += delta * (1 - Math.exp(-10 * dt));
      this.moveDir.copyFrom(faceDir);
    }

    const speed = planar.length();

    const headingForward = new BABYLON.Vector3(
      Math.sin(this.headingYaw),
      0,
      Math.cos(this.headingYaw),
    );
    const headingRight = new BABYLON.Vector3(
      headingForward.z,
      0,
      -headingForward.x,
    );

    const leanSource = desired.lengthSquared() > 0.0001 ? desired : faceDir;
    const localForward = BABYLON.Vector3.Dot(leanSource, headingForward);
    const localRight = BABYLON.Vector3.Dot(leanSource, headingRight);
    const hasInput = desired.lengthSquared() > 0.0001;
    const speedFactor = hasInput
      ? Math.max(0.4, Math.min(1, speed / MAX_ROLL_SPEED))
      : Math.min(1, speed / MAX_ROLL_SPEED);

    const targetPitchLean = localForward * 0.82 * speedFactor;
    const targetRollLean = -localRight * 0.68 * speedFactor;

    this.leanPitch +=
      (targetPitchLean - this.leanPitch) * (1 - Math.exp(-8 * dt));
    this.leanRoll += (targetRollLean - this.leanRoll) * (1 - Math.exp(-8 * dt));

    const qYaw = BABYLON.Quaternion.FromEulerAngles(0, this.headingYaw, 0);
    const qLean = BABYLON.Quaternion.FromEulerAngles(
      this.leanPitch,
      0,
      this.leanRoll,
    );

    const leanOffset = headingForward
      .scale(-this.leanPitch * APPLE_RADIUS * 0.34)
      .add(headingRight.scale(this.leanRoll * APPLE_RADIUS * 0.42));
    this.visualPivot.position.addInPlace(leanOffset);

    if (!this.visualPivot.rotationQuaternion) {
      this.visualPivot.rotationQuaternion = BABYLON.Quaternion.Identity();
    }
    this.visualPivot.rotationQuaternion = qYaw
      .multiply(qLean)
      .multiply(this.rootForwardFix)
      .multiply(this.rootBaseRotation);

    this._updateEyes(dt, speed, localRight, localForward);
  }

  _updateEyes(dt, speed, localRight, localForward) {
    if ((!this.eyeL || !this.eyeLRest) && (!this.eyeR || !this.eyeRRest))
      return;

    const localYawTarget = localRight * EYE_MAX_YAW * Math.min(1, speed / 2.5);
    const pitchTarget =
      (this.grounded ? -localForward * EYE_MAX_PITCH * 0.6 : EYE_MAX_PITCH) *
      Math.min(1, speed / 2);

    this.eyeYaw +=
      (localYawTarget - this.eyeYaw) * (1 - Math.exp(-EYE_LERP * dt));
    this.eyePitch +=
      (pitchTarget - this.eyePitch) * (1 - Math.exp(-EYE_LERP * dt));

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

  _playAnim(names, loop = true) {
    if (this.fallState !== "none") return;

    // If the current animation is already one of the requested options,
    // keep it running and avoid switching to a lower-priority fallback.
    for (const name of names) {
      if (name === this.currentAnim && this.anims[name]) return;
    }

    for (const name of names) {
      const ag = this.anims[name];
      if (!ag) continue;

      const wasHop = this.currentAnim
        ? this.currentAnim.toLowerCase().includes("hop")
        : false;

      for (const a of Object.values(this.anims)) a.stop();
      ag.start(loop);

      if (name === "jump") ag.speedRatio = 2;
      else if (name === "idle") ag.speedRatio = 2;
      else if (name.toLowerCase().includes("hop")) ag.speedRatio = 1.6;
      else if (name.includes("move")) ag.speedRatio = 3;
      else ag.speedRatio = 1;

      this.currentAnim = name;
      if (name.toLowerCase().includes("hop") && !wasHop) {
        this.hopImpulsePending = true;
      }
      return;
    }
  }

  _cacheAnimAliases() {
    const names = Object.keys(this.anims);
    const byLower = names.map((n) => ({ original: n, lower: n.toLowerCase() }));

    this.hopAnimNames = byLower
      .filter(
        (x) =>
          x.lower === "hop" ||
          x.lower.startsWith("hop.") ||
          x.lower.includes("hop"),
      )
      .map((x) => x.original);

    this.squishAnimNames = byLower
      .filter(
        (x) =>
          x.lower === "squish" ||
          x.lower.startsWith("squish.") ||
          x.lower.includes("squish"),
      )
      .map((x) => x.original);

    this.moveAnimNames = byLower
      .filter((x) => x.lower.includes("move"))
      .map((x) => x.original);
  }

  _bindHopLoopTriggers() {
    for (const name of this.hopAnimNames) {
      const ag = this.anims[name];
      if (!ag) continue;

      ag.onAnimationGroupLoopObservable.add(() => {
        if (this.currentAnim === name) {
          this.hopImpulsePending = true;
        }
      });
    }
  }

  _startFallSquish(fallDistance) {
    if (this.fallState !== "none") return;
    if (!this.squishAnimNames.length) return;

    const squishName = this.squishAnimNames[0];
    const squish = this.anims[squishName];
    if (!squish) return;

    const severity = BABYLON.Scalar.Clamp(
      (fallDistance - FALL_SQUISH_START_HEIGHT) /
        (FALL_FATAL_HEIGHT - FALL_SQUISH_START_HEIGHT),
      0,
      1,
    );
    const isFatal = fallDistance >= FALL_FATAL_HEIGHT;

    this.fallState = isFatal ? "fatal" : "squish";
    this.hopImpulsePending = false;

    const from = squish.from;
    const to = squish.to;
    const target = BABYLON.Scalar.Lerp(
      from,
      to,
      isFatal ? 1 : Math.max(0.18, severity),
    );

    for (const a of Object.values(this.anims)) a.stop();
    this.currentAnim = squishName;

    const forwardObs = squish.onAnimationGroupEndObservable.add(() => {
      squish.onAnimationGroupEndObservable.remove(forwardObs);

      if (isFatal) {
        this._triggerFatalSliceBurst();
        return;
      }

      this.fallState = "recover";
      const reverseObs = squish.onAnimationGroupEndObservable.add(() => {
        squish.onAnimationGroupEndObservable.remove(reverseObs);
        this.fallState = "none";
        this.currentAnim = "";
      });

      for (const a of Object.values(this.anims)) a.stop();
      squish.start(false, 1.25, target, from);
    });

    squish.start(false, 1.1, from, target);
  }

  _triggerFatalSliceBurst() {
    this.fallState = "fatal";

    const center = this.bodyMesh.position.clone();
    this.body.setLinearVelocity(BABYLON.Vector3.Zero());
    this.body.setAngularVelocity(BABYLON.Vector3.Zero());

    if (this.visualPivot) this.visualPivot.setEnabled(false);
    if (this.sliceBurst) {
      this.sliceBurst.burst({
        center,
        lifetimeMs: FATAL_SLICE_LIFETIME_MS,
        radialMin: 1.4,
        radialMax: 2.9,
        upMin: 2.7,
        upMax: 4.1,
      });
    }

    setTimeout(() => {
      this.respawn();
      if (this.visualPivot) this.visualPivot.setEnabled(true);
      this.fallState = "none";
      this.currentAnim = "";
    }, FATAL_RESPAWN_DELAY_MS);
  }

  update(dt, camera) {
    if (!this.ready) return;

    this._groundCheck();
    if (!this.hasGroundSample) {
      this.hasGroundSample = true;
      this.wasGrounded = this.grounded;
      this.airbornePeakY = this.bodyMesh.position.y;
    }

    if (this.wasGrounded && !this.grounded) {
      this.airbornePeakY = this.bodyMesh.position.y;
    }
    if (!this.grounded) {
      this.airbornePeakY = Math.max(
        this.airbornePeakY,
        this.bodyMesh.position.y,
      );
    }
    if (!this.wasGrounded && this.grounded) {
      const fallDistance = Math.max(
        0,
        this.airbornePeakY - this.bodyMesh.position.y,
      );
      if (fallDistance > FALL_SQUISH_START_HEIGHT) {
        this._startFallSquish(fallDistance);
      }
    }

    if (this.fallState !== "none") {
      const lv = this.body.getLinearVelocity();
      this.body.setLinearVelocity(
        new BABYLON.Vector3(lv.x * 0.82, lv.y, lv.z * 0.82),
      );
      this._updateVisuals(dt, BABYLON.Vector3.Zero());
      if (this.bodyMesh.position.y < KILL_Y) this.respawn();
      this.wasGrounded = this.grounded;
      return;
    }

    let didJumpThisFrame = false;

    if (this.grounded) this.coyoteTimer = COYOTE_TIME;
    else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

    if (this.input.consumeJump()) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    if (this.jumpBuffer > 0 && this.coyoteTimer > 0) {
      this.jumpBuffer = 0;
      this.coyoteTimer = 0;

      const lv = this.body.getLinearVelocity();
      this.body.setLinearVelocity(
        new BABYLON.Vector3(lv.x, Math.max(0, lv.y), lv.z),
      );
      this.body.applyImpulse(
        new BABYLON.Vector3(0, JUMP_IMPULSE, 0),
        this.bodyMesh.position,
      );
      this._playAnim(["jump"], false);
      this.jumpAnimLock = 0.22;
      this.hopImpulsePending = false;
      didJumpThisFrame = true;
    }

    const desired = this._desiredMoveDir(camera);
    this._applyRollingControl(desired);
    this._applyHopImpulse(desired, didJumpThisFrame);
    this._clampAngularSpeed();

    const lv = this.body.getLinearVelocity();
    let vy = lv.y;
    if (this.grounded && vy < 0) vy *= GROUND_Y_DAMP;
    if (vy < FALL_SPEED_LIMIT) vy = FALL_SPEED_LIMIT;
    this.body.setLinearVelocity(new BABYLON.Vector3(lv.x, vy, lv.z));

    this._updateVisuals(dt, desired);

    this.jumpAnimLock = Math.max(0, this.jumpAnimLock - dt);
    const planarSpeed = Math.hypot(lv.x, lv.z);
    if (this.grounded && this.jumpAnimLock <= 0) {
      if (planarSpeed > 0.35) {
        const movingAnims = [
          ...this.hopAnimNames,
          "hop",
          "Hop",
          ...this.moveAnimNames,
          "move.left.001",
          "move.left",
        ];
        this._playAnim(movingAnims, true);
      } else {
        this._playAnim(["idle"], true);
      }
    }

    if (this.bodyMesh.position.y < KILL_Y) this.respawn();

    this.wasGrounded = this.grounded;
  }

  respawn() {
    this.bodyMesh.position.copyFrom(SPAWN_POS);
    this.bodyMesh.rotation.setAll(0);
    if (this.bodyMesh.rotationQuaternion) {
      this.bodyMesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    }
    this.body.setLinearVelocity(BABYLON.Vector3.Zero());
    this.body.setAngularVelocity(BABYLON.Vector3.Zero());
    this.hopImpulsePending = false;
    this.hasGroundSample = false;
    this.fallState = "none";
    if (this.visualPivot) this.visualPivot.setEnabled(true);
  }
}

class DemoWorld {
  constructor(scene, shadowGenerator = null) {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator;
    this.physicsBodies = [];
    this._buildMaterials();
    this._buildBackground();
    this._buildPlatforms();
  }

  _buildMaterials() {
    this.groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
    const groundTex = new BABYLON.Texture(
      "./assets/appletreebg.png",
      this.scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
    );
    groundTex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    groundTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    groundTex.uScale = 9;
    groundTex.vScale = 9;
    this.groundMat.diffuseTexture = groundTex;
    this.groundMat.diffuseColor = BABYLON.Color3.FromHexString("#C8C8C8");
    this.groundMat.specularColor = BABYLON.Color3.Black();

    this.platformMat = new BABYLON.StandardMaterial("platformMat", this.scene);
    this.platformMat.diffuseColor = BABYLON.Color3.FromHexString("#8F674D");
    this.platformMat.specularColor = BABYLON.Color3.Black();
  }

  _buildBackground() {
    this.scene.clearColor = new BABYLON.Color4(0.67, 0.82, 0.95, 1);

    const skybox = BABYLON.MeshBuilder.CreateBox(
      "skyBox3d",
      { size: 260 },
      this.scene,
    );
    skybox.isPickable = false;
    skybox.infiniteDistance = true;

    const skyboxMat = new BABYLON.StandardMaterial("skyBoxMat3d", this.scene);
    skyboxMat.backFaceCulling = false;
    skyboxMat.disableLighting = true;
    skyboxMat.diffuseColor = BABYLON.Color3.Black();
    skyboxMat.specularColor = BABYLON.Color3.Black();

    const skyFaces = new Array(6).fill("./assets/appletreebg.png");
    const skyTex = BABYLON.CubeTexture.CreateFromImages(skyFaces, this.scene);
    skyTex.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    skyTex.level = 1.08;
    skyboxMat.reflectionTexture = skyTex;
    skybox.material = skyboxMat;
  }

  _buildPlatforms() {
    const platforms = [
      { pos: [0, -1, 0], size: [140, 2, 140], ground: true },
      { pos: [7, 1.6, 7], size: [12, 1.4, 12], ground: false },
      { pos: [18, 3.9, 17], size: [12, 1.4, 12], ground: false },
      { pos: [20, 6.1, 29], size: [11, 1.3, 11], ground: false },
      { pos: [13, 8.2, 40], size: [11, 1.3, 11], ground: false },
      { pos: [2, 10.3, 45], size: [11, 1.3, 11], ground: false },
      { pos: [-10, 12.4, 42], size: [11, 1.3, 11], ground: false },
      { pos: [-20, 14.4, 32], size: [11, 1.3, 11], ground: false },
    ];

    for (const p of platforms) {
      const box = BABYLON.MeshBuilder.CreateBox(
        "platform",
        { width: p.size[0], height: p.size[1], depth: p.size[2] },
        this.scene,
      );
      box.position.set(p.pos[0], p.pos[1], p.pos[2]);
      box.material = p.ground ? this.groundMat : this.platformMat;
      box.receiveShadows = true;

      const body = new BABYLON.PhysicsBody(
        box,
        BABYLON.PhysicsMotionType.STATIC,
        false,
        this.scene,
      );
      body.shape = new BABYLON.PhysicsShapeBox(
        BABYLON.Vector3.Zero(),
        BABYLON.Quaternion.Identity(),
        new BABYLON.Vector3(p.size[0], p.size[1], p.size[2]),
        this.scene,
      );
      this.physicsBodies.push(body);
    }

    const ramp = BABYLON.MeshBuilder.CreateBox(
      "ramp",
      { width: 14, height: 1.2, depth: 70 },
      this.scene,
    );
    ramp.position.set(-6, 3.8, 6);
    ramp.rotation.x = BABYLON.Tools.ToRadians(18);
    ramp.material = this.platformMat;
    ramp.receiveShadows = true;

    const rampBody = new BABYLON.PhysicsBody(
      ramp,
      BABYLON.PhysicsMotionType.STATIC,
      false,
      this.scene,
    );
    rampBody.shape = new BABYLON.PhysicsShapeBox(
      BABYLON.Vector3.Zero(),
      BABYLON.Quaternion.Identity(),
      new BABYLON.Vector3(14, 1.2, 70),
      this.scene,
    );
    this.physicsBodies.push(rampBody);
  }
}

class Game3DDemo {
  constructor(canvas) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.input = new InputManager3D();
    this.player = null;
    this.cameraBackDir = new BABYLON.Vector3(0, 0, -1);
    this.physicsViewer = null;
    this.physicsDebugEnabled = false;

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyP") {
        e.preventDefault();
        this._togglePhysicsDebug();
      }
    });

    this._init().then(() => {
      this.engine.runRenderLoop(() => {
        const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
        this._update(dt);
        this.scene.render();
      });
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  async _init() {
    const scene = this.scene;

    const hemi = new BABYLON.HemisphericLight(
      "hemi3d",
      new BABYLON.Vector3(0.2, 1, -0.4),
      scene,
    );
    hemi.intensity = 0.58;

    const dir = new BABYLON.DirectionalLight(
      "dir3d",
      new BABYLON.Vector3(-0.4, -1, 0.25),
      scene,
    );
    dir.position.set(24, 32, -20);
    dir.intensity = 1.15;
    dir.shadowMinZ = 1;
    dir.shadowMaxZ = 120;

    const shadowGen = new BABYLON.ShadowGenerator(2048, dir);
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
    shadowGen.bias = 0.00025;
    shadowGen.normalBias = 0.015;
    shadowGen.setDarkness(0.58);
    this.shadowGen = shadowGen;

    this.camera = new BABYLON.FreeCamera(
      "cam3d",
      new BABYLON.Vector3(0, 8, -14),
      scene,
    );
    this.camera.minZ = 0.1;
    this.camera.fov = 0.85;

    const hk = await HavokPhysics();
    scene.enablePhysics(
      new BABYLON.Vector3(0, GRAVITY, 0),
      new BABYLON.HavokPlugin(true, hk),
    );

    if (BABYLON.PhysicsViewer) {
      this.physicsViewer = new BABYLON.PhysicsViewer(scene);
    }

    this.world = new DemoWorld(scene, this.shadowGen);
    this.player = new RollingApplePlayer(scene, this.input, this.shadowGen);

    const hud = document.getElementById("hud");
    if (hud) {
      hud.textContent = "WASD/Arrows roll  SPACE jump  P physics debug";
    }
  }

  _togglePhysicsDebug() {
    if (!this.physicsViewer || !this.player || !this.world) return;

    this.physicsDebugEnabled = !this.physicsDebugEnabled;

    const bodies = [this.player.body, ...this.world.physicsBodies];
    for (const body of bodies) {
      if (!body) continue;
      if (this.physicsDebugEnabled) this.physicsViewer.showBody(body);
      else this.physicsViewer.hideBody(body);
    }
  }

  _updateCamera() {
    if (!this.player || !this.player.ready) return;

    const p = this.player.bodyMesh.position;
    const vel = this.player.body.getLinearVelocity();
    const planar = new BABYLON.Vector3(vel.x, 0, vel.z);

    const planarSpeed = planar.length();
    if (planarSpeed > CAMERA_DIR_DEADZONE_SPEED) {
      const desiredBack = planar.normalize().scale(-1);
      this.cameraBackDir = BABYLON.Vector3.Lerp(
        this.cameraBackDir,
        desiredBack,
        CAMERA_DIR_LERP,
      );
      if (this.cameraBackDir.lengthSquared() > 0.0001) {
        this.cameraBackDir.normalize();
      }
    }

    const desiredPos = p
      .add(this.cameraBackDir.scale(CAMERA_DISTANCE))
      .add(new BABYLON.Vector3(0, CAMERA_HEIGHT, 0));

    const nextPos = BABYLON.Vector3.Lerp(
      this.camera.position,
      desiredPos,
      CAMERA_LERP,
    );
    this.camera.position.x = nextPos.x;
    this.camera.position.z = nextPos.z;
    this.camera.position.y +=
      (desiredPos.y - this.camera.position.y) * CAMERA_Y_DAMP;
    this.camera.setTarget(p.add(new BABYLON.Vector3(0, 1.2, 0)));
  }

  _update(dt) {
    if (!this.player) return;

    this.player.update(dt, this.camera);
    this._updateCamera();

    const hud = document.getElementById("hud");
    if (hud && this.player.ready) {
      hud.textContent =
        "WASD/Arrows roll  SPACE jump  P physics debug  |  physics: " +
        (this.physicsDebugEnabled ? "on" : "off") +
        "  |  " +
        (this.player.grounded ? "grounded" : "air");
    }
  }
}

function startGame3DDemo() {
  new Game3DDemo(document.getElementById("renderCanvas"));
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startGame3DDemo);
} else {
  startGame3DDemo();
}
