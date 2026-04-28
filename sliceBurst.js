// Shared apple slice burst effect for both demos.
(function () {
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

    burst(options = {}) {
      if (!this.templateRoot) {
        void this.preload();
        return null;
      }

      const center = (options.center || BABYLON.Vector3.Zero()).clone();
      const lifetimeMs = options.lifetimeMs ?? 2200;
      const completeBelowY = options.completeBelowY;
      const onComplete = options.onComplete || null;
      const mass = options.mass ?? 0.18;
      const minPieceSize = options.minPieceSize ?? 0.08;
      const radialMin = options.radialMin ?? 1.4;
      const radialMax = options.radialMax ?? 2.9;
      const upMin = options.upMin ?? 2.7;
      const upMax = options.upMax ?? 4.1;
      const planarDir = options.planarDir || null;
      const planarJitter = options.planarJitter ?? 0.35;

      const burstRoot = this.templateRoot.clone("appleSlicesBurst", null);
      if (!burstRoot) return null;

      burstRoot.setEnabled(true);
      burstRoot.isVisible = true;
      burstRoot.position.copyFrom(center);

      const burstMeshes = this._selectBurstMeshes(burstRoot);
      const burstBodies = [];
      let cleanupTimer = null;
      let observer = null;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;

        if (cleanupTimer !== null) {
          clearTimeout(cleanupTimer);
        }
        if (observer) {
          this.scene.onBeforeRenderObservable.remove(observer);
        }

        for (const body of burstBodies) body.dispose();
        burstRoot.dispose();

        if (onComplete) onComplete();
      };

      for (const mesh of burstMeshes) {
        mesh.isVisible = true;
        mesh.setEnabled(true);

        const ext = mesh.getBoundingInfo().boundingBox.extendSize;
        const size = new BABYLON.Vector3(
          Math.max(minPieceSize, ext.x * 2),
          Math.max(minPieceSize, ext.y * 2),
          Math.max(minPieceSize, ext.z * 2),
        );

        const body = new BABYLON.PhysicsBody(
          mesh,
          BABYLON.PhysicsMotionType.DYNAMIC,
          false,
          this.scene,
        );
        body.shape = new BABYLON.PhysicsShapeBox(
          BABYLON.Vector3.Zero(),
          BABYLON.Quaternion.Identity(),
          size,
          this.scene,
        );
        body.setMassProperties({ mass });

        const p = mesh.getAbsolutePosition();
        let outward;

        if (planarDir && planarDir.lengthSquared() > 0.0001) {
          outward = planarDir.clone();
          outward.y = 0;
          outward.addInPlace(
            new BABYLON.Vector3(
              (Math.random() - 0.5) * planarJitter,
              0,
              (Math.random() - 0.5) * planarJitter,
            ),
          );
        } else {
          outward = p.subtract(center);
          outward.y = 0;
        }

        if (outward.lengthSquared() < 0.0001) {
          outward = new BABYLON.Vector3(
            Math.random() - 0.5,
            0,
            Math.random() - 0.5,
          );
        }
        outward.normalize();

        const radial = BABYLON.Scalar.Lerp(radialMin, radialMax, Math.random());
        const up = BABYLON.Scalar.Lerp(upMin, upMax, Math.random());
        const impulse = outward
          .scale(radial)
          .add(new BABYLON.Vector3(0, up, 0));

        body.applyImpulse(impulse, p);
        burstBodies.push(body);
      }

      if (typeof completeBelowY === "number") {
        observer = this.scene.onBeforeRenderObservable.add(() => {
          if (!burstMeshes.length) {
            finish();
            return;
          }

          const allBelow = burstMeshes.every(
            (mesh) => mesh.getAbsolutePosition().y < completeBelowY,
          );
          if (allBelow) finish();
        });
      }

      cleanupTimer = setTimeout(finish, lifetimeMs);

      return {
        root: burstRoot,
        bodies: burstBodies,
        dispose: finish,
      };
    }
  }

  window.AppleSliceBurstEffect = AppleSliceBurstEffect;
})();
