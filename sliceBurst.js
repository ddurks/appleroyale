// The apple slice burst: a knocked-out apple flies apart in slices.
(function () {
  // The pieces' speeds are measured from an earlier physics-engine version,
  // where the overlapping pieces shoved each other at the start: they end up
  // sharing one upward speed and lose some of their push.
  const HAND_UP = 0.88; // of the upward impulse, shared by the whole burst
  const HAND_UP_SPREAD = 0.8; // ± per piece (m/s)
  const HAND_OUT = 0.72; // of each piece's sideways impulse
  const HAND_SPIN_MIN = 0.3; // rad/s; most pieces barely turn, a few tumble
  const HAND_SPIN_MORE = 4.4;
  const HAND_SPIN_DAMPING = 0.15; // per second

  class AppleSliceBurstEffect {
    constructor(scene, options = {}) {
      this.scene = scene;
      this.assetRoot = options.assetRoot || "./assets/";
      this.fileName = options.fileName || "appleslices.glb";
      this.shadowGenerator = options.shadowGenerator || null;
      this.debug = !!options.debug;

      this.templateRoot = null;
      this._loadPromise = null;
    }

    async preload() {
      if (this.templateRoot) return this.templateRoot;
      if (this._loadPromise) return this._loadPromise;

      this._loadPromise = BABYLON.SceneLoader.ImportMeshAsync(
        "",
        this.assetRoot,
        this.fileName,
        this.scene,
      )
        .then((res) => {
          this.templateRoot = res.meshes[0] || null;
          if (!this.templateRoot) return null;

          this.templateRoot.setEnabled(false);
          this.templateRoot.isVisible = false;

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

          return this.templateRoot;
        })
        .catch((err) => {
          console.warn("Could not load appleslices.glb", err);
          return null;
        })
        .finally(() => {
          this._loadPromise = null;
        });

      return this._loadPromise;
    }

    _selectBurstMeshes(burstRoot) {
      const allRenderableMeshes = burstRoot
        .getChildMeshes(false)
        .filter(
          (m) =>
            typeof m.getTotalVertices === "function" &&
            m.getTotalVertices() > 0,
        );

      const hasPrimitiveSuffix = allRenderableMeshes.some((m) =>
        /_primitive\d+$/i.test(m.name),
      );

      let burstMeshes = allRenderableMeshes;
      if (hasPrimitiveSuffix) {
        burstMeshes = allRenderableMeshes.filter((m) =>
          /_primitive0$/i.test(m.name),
        );

        for (const shell of burstMeshes) {
          const gutsName = shell.name.replace(/_primitive0$/i, "_primitive1");
          const guts = allRenderableMeshes.find((m) => m.name === gutsName);
          if (guts && guts.parent !== shell) {
            guts.setParent(shell);
          }
        }
      }

      if (this.debug) {
        console.group("[Slices Debug] Burst-selected pieces");
        burstMeshes.forEach((m, i) => {
          const mat = m.material?.name || "(none)";
          const parentName = m.parent?.name || "(no parent)";
          const verts = m.getTotalVertices();
          const subMeshCount = m.subMeshes?.length ?? 0;
          console.log(
            `#${i} name=${m.name} parent=${parentName} mat=${mat} verts=${verts} subMeshes=${subMeshCount}`,
          );
        });
        console.groupEnd();
      }

      return burstMeshes;
    }

    // Knock the apple apart at `center`: each piece flies on its own arc and
    // tumbles; nothing collides.
    burst(options = {}) {
      if (!this.templateRoot) {
        void this.preload();
        return null;
      }

      const center = (options.center || BABYLON.Vector3.Zero()).clone();
      const burstRoot = this.templateRoot.clone("appleSlicesBurst", null);
      if (!burstRoot) return null;

      burstRoot.setEnabled(true);
      burstRoot.isVisible = true;
      burstRoot.position.copyFrom(center);
      const meshes = this._selectBurstMeshes(burstRoot);

      const lifetimeMs = options.lifetimeMs ?? 2200;
      const completeBelowY = options.completeBelowY;
      const onComplete = options.onComplete || null;
      const mass = options.mass ?? 0.18;
      const gravity = options.gravity ?? -20;
      const lerp = BABYLON.Scalar.Lerp;
      const planarDir = options.planarDir || null;
      const planarJitter = options.planarJitter ?? 0.35;
      const up = (lerp(options.upMin ?? 2.7, options.upMax ?? 4.1, Math.random()) / mass) * HAND_UP;

      const pieces = meshes.map((mesh) => {
        mesh.isVisible = true;
        mesh.setEnabled(true);
        const p = mesh.getAbsolutePosition();
        let outward;
        if (planarDir && planarDir.lengthSquared() > 0.0001) {
          outward = planarDir.clone();
          outward.y = 0;
          outward.x += (Math.random() - 0.5) * planarJitter;
          outward.z += (Math.random() - 0.5) * planarJitter;
        } else {
          outward = p.subtract(center);
          outward.y = 0;
        }
        if (outward.lengthSquared() < 0.0001) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        const out = (lerp(options.radialMin ?? 1.4, options.radialMax ?? 2.9, Math.random()) / mass) * HAND_OUT;
        const vel = outward.normalize().scale(out);
        vel.y = up + (Math.random() - 0.5) * 2 * HAND_UP_SPREAD;
        const axis = new BABYLON.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const r = Math.random();
        mesh.setParent(null); // moves in world space from here
        return { mesh, vel, axis, spin: HAND_SPIN_MIN + HAND_SPIN_MORE * r * r };
      });

      let finished = false;
      let observer = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(cleanupTimer);
        this.scene.onBeforeRenderObservable.remove(observer);
        for (const piece of pieces) piece.mesh.dispose();
        burstRoot.dispose();
        if (onComplete) onComplete();
      };
      observer = this.scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
        let allBelow = typeof completeBelowY === "number";
        for (const piece of pieces) {
          piece.vel.y += gravity * dt;
          piece.mesh.position.addInPlace(piece.vel.scale(dt));
          piece.mesh.rotate(piece.axis, piece.spin * dt, BABYLON.Space.WORLD);
          piece.spin *= 1 - HAND_SPIN_DAMPING * dt;
          if (piece.mesh.position.y >= completeBelowY) allBelow = false;
        }
        if (allBelow) finish();
      });
      const cleanupTimer = setTimeout(finish, lifetimeMs);

      return { root: burstRoot, bodies: [], dispose: finish };
    }
  }

  window.AppleSliceBurstEffect = AppleSliceBurstEffect;
})();
