/* ============================================================================
   app.js — CinematicEngine
   Gautham Vijayaraj · AI Systems Engineer · Cinematic 3D Scroll Portfolio

   A procedural low-poly twilight world rendered with vanilla Three.js,
   driven by GSAP ScrollTrigger. No external models, no textures —
   every object in the scene is generated from primitives and math.
   ============================================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Environment capability checks                                      */
  /* ------------------------------------------------------------------ */

  function supportsWebGL() {
    try {
      const canvas = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch (err) {
      return false;
    }
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ------------------------------------------------------------------ */
  /*  CinematicEngine                                                    */
  /* ------------------------------------------------------------------ */

  class CinematicEngine {
    constructor(canvas) {
      this.canvas = canvas;

      // --- World tuning -------------------------------------------------
      this.WORLD_SIZE = 620;          // terrain width/depth
      this.CORRIDOR_HALF_WIDTH = 17;  // flat camera lane half-width
      this.CASTLE_POS = new THREE.Vector3(0, 0, -140);
      this.CASTLE_CLEAR_RADIUS = 46;  // flattened / tree-free radius

      // --- Performance mode --------------------------------------------
      this.perfMode =
        window.innerWidth < 768 ||
        /Mobi|Android/i.test(navigator.userAgent);

      this.config = this.perfMode
        ? { trees: 640, grass: 320, shadows: false, far: 700, shadowMap: 1024 }
        : { trees: 1400, grass: 900, shadows: true, far: 950, shadowMap: 2048 };

      // --- Scroll + camera state ----------------------------------------
      this.scroll = { progress: 0 };
      this.reducedMotion = prefersReducedMotion;

      this._desiredPos = new THREE.Vector3();
      this._desiredLook = new THREE.Vector3();
      this._currentLook = new THREE.Vector3();
      this._tmpPos = new THREE.Vector3();
      this._tmpLook = new THREE.Vector3();
      this._pointer = { x: 0, y: 0 };
      this._pointerSmooth = { x: 0, y: 0 };

      // Shared shader uniform for wind motion (no per-instance updates).
      this.windUniform = { value: 0 };

      this._elapsed = 0;
      this._rafId = null;

      this.nodeNames = ["INTRO", "CORE TECH", "AGENT CASTLE", "ACADEMIC", "ENTERPRISE", "CONTACT"];
      this._nodeLabelIndex = -1;
    }

    /* ================================================================ */
    /*  Bootstrap                                                        */
    /* ================================================================ */

    init() {
      this.clock = new THREE.Clock();

      this.createRenderer();
      this.createScene();
      this.createSkybox();
      this.createTerrain();
      this.createForest();
      this.createCastle();
      this.createMountains();
      this.createLighting();
      this.createCameraPath();

      window.addEventListener("resize", this.onResize.bind(this));

      if (this.reducedMotion) {
        // Static cinematic frame: castle vista, no camera animation.
        document.body.classList.add("static-mode");
        this.updateCamera(0.55);
        this.camera.position.copy(this._desiredPos);
        this._currentLook.copy(this._desiredLook);
        this.camera.lookAt(this._currentLook);
        this.renderer.render(this.scene, this.camera);
        return;
      }

      window.addEventListener("pointermove", (e) => {
        this._pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        this._pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      });

      this.setupScrollTimeline();
      this.animate();
    }

    /* ================================================================ */
    /*  Renderer / Scene                                                 */
    /* ================================================================ */

    createRenderer() {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: !this.perfMode,
        powerPreference: "high-performance"
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.shadowMap.enabled = this.config.shadows;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    createScene() {
      this.scene = new THREE.Scene();

      const fogColor = new THREE.Color(0x140d22); // twilight haze
      this.scene.fog = new THREE.FogExp2(fogColor, 0.0052);
      this.renderer.setClearColor(fogColor, 1);

      this.camera = new THREE.PerspectiveCamera(
        52,
        window.innerWidth / window.innerHeight,
        0.1,
        this.config.far
      );
      this.camera.position.set(0, 6, 235);
      this.scene.add(this.camera);
    }

    /* ================================================================ */
    /*  Skybox — custom twilight gradient shader                         */
    /* ================================================================ */

    createSkybox() {
      const geometry = new THREE.SphereGeometry(640, 28, 18);

      const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          topColor:     { value: new THREE.Color(0x020409) }, // deep indigo peak
          midColor:     { value: new THREE.Color(0x0b1430) }, // muted navy
          horizonColor: { value: new THREE.Color(0x120408) }, // misty twilight amethyst base
          hazeColor:    { value: new THREE.Color(0x4b2a63) }, // amethyst glow
          moonColor:    { value: new THREE.Color(0xaebcf5) },
          moonDir:      { value: new THREE.Vector3(0.42, 0.55, -0.72).normalize() }
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 midColor;
          uniform vec3 horizonColor;
          uniform vec3 hazeColor;
          uniform vec3 moonColor;
          uniform vec3 moonDir;
          varying vec3 vDir;

          void main() {
            vec3 dir = normalize(vDir);
            float h = dir.y;

            // Vertical twilight gradient with atmospheric falloff.
            vec3 sky = mix(midColor, topColor, smoothstep(0.06, 0.72, h));
            sky = mix(horizonColor, sky, smoothstep(-0.12, 0.22, h));

            // Misty amethyst band hugging the horizon.
            float haze = pow(clamp(1.0 - abs(h - 0.05) * 4.2, 0.0, 1.0), 2.2);
            sky += hazeColor * haze * 0.55;

            // Moon disc + broad cold glow.
            float facing = max(dot(dir, moonDir), 0.0);
            sky += moonColor * pow(facing, 420.0) * 1.6;  // disc
            sky += moonColor * pow(facing, 10.0) * 0.10;  // halo

            gl_FragColor = vec4(sky, 1.0);
          }
        `
      });

      this.skybox = new THREE.Mesh(geometry, material);
      this.scene.add(this.skybox);
    }

    /* ================================================================ */
    /*  Terrain — shared height field + low-poly mesh                    */
    /* ================================================================ */

    // Single source of truth for ground height; used by terrain,
    // forest, and grass so everything sits on the same surface.
    getTerrainHeight(x, z) {
      let h =
        Math.sin(x * 0.040) * Math.cos(z * 0.050) * 4.0 +
        Math.sin(x * 0.110 + 2.0) * 1.8 +
        Math.cos(z * 0.085 + 1.2) * 2.2 +
        Math.sin((x + z) * 0.020) * 3.0;

      // Edges grow wilder, the middle stays navigable.
      const edge = THREE.MathUtils.smoothstep(Math.abs(x), 60, 280);
      h *= 1.0 + edge * 1.6;

      // Flatten the central camera corridor.
      const corridor =
        1.0 -
        THREE.MathUtils.smoothstep(
          Math.abs(x),
          this.CORRIDOR_HALF_WIDTH,
          this.CORRIDOR_HALF_WIDTH + 26
        );
      h *= THREE.MathUtils.lerp(1.0, 0.06, corridor);

      // Flatten the castle motte.
      const dx = x - this.CASTLE_POS.x;
      const dz = z - this.CASTLE_POS.z;
      const castleDist = Math.sqrt(dx * dx + dz * dz);
      const motte =
        1.0 -
        THREE.MathUtils.smoothstep(
          castleDist,
          this.CASTLE_CLEAR_RADIUS * 0.65,
          this.CASTLE_CLEAR_RADIUS + 18
        );
      h *= THREE.MathUtils.lerp(1.0, 0.04, motte);

      return h;
    }

    createTerrain() {
      const size = this.WORLD_SIZE;
      const segments = this.perfMode ? 72 : 96;
      const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);

      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, this.getTerrainHeight(x, z));
      }
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: 0x171f2b,
        roughness: 1.0,
        metalness: 0.0,
        flatShading: true
      });

      this.terrain = new THREE.Mesh(geometry, material);
      this.terrain.receiveShadow = this.config.shadows;
      this.scene.add(this.terrain);
    }

    /* ================================================================ */
    /*  Forest — fully instanced trees + grass with shader wind          */
    /* ================================================================ */

    // Injects a cheap vertex-shader sway into an instanced material.
    // Uses the instance's world X as a phase offset — zero per-frame
    // CPU work, one shared uniform.
    applyWind(material, strength) {
      const wind = this.windUniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = wind;
        shader.vertexShader =
          "uniform float uWindTime;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             float windPhase = instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.21;
             float windAmp = smoothstep(0.2, 2.5, transformed.y) * ${strength.toFixed(3)};
             transformed.x += sin(uWindTime * 1.3 + windPhase) * windAmp;
             transformed.z += cos(uWindTime * 0.9 + windPhase * 1.7) * windAmp * 0.6;`
          );
      };
    }

    // Rejection-samples a forest position outside the corridor and
    // castle clearing, biased denser toward the corridor flanks.
    sampleForestPosition(maxOffset) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const lateral =
          this.CORRIDOR_HALF_WIDTH +
          2 +
          Math.pow(Math.random(), 0.62) * maxOffset;
        const x = side * lateral;
        const z = THREE.MathUtils.randFloat(-238, 252);

        const dx = x - this.CASTLE_POS.x;
        const dz = z - this.CASTLE_POS.z;
        if (dx * dx + dz * dz < this.CASTLE_CLEAR_RADIUS * this.CASTLE_CLEAR_RADIUS) {
          continue;
        }
        return { x, z };
      }
      // Safe fallback far on the flank.
      return { x: 120 * (Math.random() < 0.5 ? -1 : 1), z: 200 };
    }

    createForest() {
      const treeCount = this.config.trees;
      const dummy = new THREE.Object3D();

      // --- Geometry / materials (created once, shared) -----------------
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.36, 2.4, 5);
      trunkGeo.translate(0, 1.2, 0);
      const canopyGeo = new THREE.ConeGeometry(1.7, 4.8, 6);
      canopyGeo.translate(0, 4.2, 0);

      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x2e2438, roughness: 1, flatShading: true
      });
      const canopyMatA = new THREE.MeshStandardMaterial({
        color: 0x16323a, roughness: 1, flatShading: true
      });
      const canopyMatB = new THREE.MeshStandardMaterial({
        color: 0x1d3a2f, roughness: 1, flatShading: true
      });
      this.applyWind(canopyMatA, 0.16);
      this.applyWind(canopyMatB, 0.16);

      const countA = Math.ceil(treeCount * 0.55);
      const countB = treeCount - countA;

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
      const canopyA = new THREE.InstancedMesh(canopyGeo, canopyMatA, countA);
      const canopyB = new THREE.InstancedMesh(canopyGeo, canopyMatB, countB);

      let iA = 0;
      let iB = 0;

      for (let i = 0; i < treeCount; i++) {
        const spot = this.sampleForestPosition(240);
        const y = this.getTerrainHeight(spot.x, spot.z);
        const scale = THREE.MathUtils.randFloat(0.8, 2.1);
        const rotY = Math.random() * Math.PI * 2;

        dummy.position.set(spot.x, y - 0.15, spot.z);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();

        trunks.setMatrixAt(i, dummy.matrix);
        if (i % 2 === 0 && iA < countA) {
          canopyA.setMatrixAt(iA++, dummy.matrix);
        } else if (iB < countB) {
          canopyB.setMatrixAt(iB++, dummy.matrix);
        } else {
          canopyA.setMatrixAt(iA++, dummy.matrix);
        }
      }

      trunks.instanceMatrix.needsUpdate = true;
      canopyA.instanceMatrix.needsUpdate = true;
      canopyB.instanceMatrix.needsUpdate = true;

      trunks.castShadow = this.config.shadows;
      canopyA.castShadow = this.config.shadows;
      canopyB.castShadow = this.config.shadows;

      this.scene.add(trunks, canopyA, canopyB);

      // --- Grass clusters ----------------------------------------------
      const grassGeo = new THREE.ConeGeometry(0.5, 1.3, 4);
      grassGeo.translate(0, 0.65, 0);
      const grassMat = new THREE.MeshStandardMaterial({
        color: 0x1f4034, roughness: 1, flatShading: true
      });
      this.applyWind(grassMat, 0.1);

      const grassCount = this.config.grass;
      const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);

      for (let i = 0; i < grassCount; i++) {
        // Grass favors the corridor edges where the camera will see it.
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = side * THREE.MathUtils.randFloat(5, 60);
        const z = THREE.MathUtils.randFloat(-230, 248);
        const dx = x - this.CASTLE_POS.x;
        const dz = z - this.CASTLE_POS.z;
        const inCastle =
          dx * dx + dz * dz <
          this.CASTLE_CLEAR_RADIUS * this.CASTLE_CLEAR_RADIUS * 0.5;

        const y = this.getTerrainHeight(x, z);
        dummy.position.set(inCastle ? x + 70 * side : x, y - 0.05, z);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.setScalar(THREE.MathUtils.randFloat(0.5, 1.4));
        dummy.updateMatrix();
        grass.setMatrixAt(i, dummy.matrix);
      }
      grass.instanceMatrix.needsUpdate = true;
      this.scene.add(grass);
    }

    /* ================================================================ */
    /*  Castle citadel                                                   */
    /* ================================================================ */

    createCastle() {
      const castle = new THREE.Group();

      const stone = new THREE.MeshStandardMaterial({
        color: 0x2a3050, roughness: 1, flatShading: true
      });
      const stoneDark = new THREE.MeshStandardMaterial({
        color: 0x161b33, roughness: 1, flatShading: true
      });
      const roof = new THREE.MeshStandardMaterial({
        color: 0x3c2f63, roughness: 1, flatShading: true
      });
      const gateMat = new THREE.MeshStandardMaterial({
        color: 0x06080f, roughness: 1
      });
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x2b2236, roughness: 1, flatShading: true
      });

      const add = (mesh, x, y, z) => {
        mesh.position.set(x, y, z);
        mesh.castShadow = this.config.shadows;
        mesh.receiveShadow = this.config.shadows;
        castle.add(mesh);
        return mesh;
      };

      // Main keep — stacked boxes.
      add(new THREE.Mesh(new THREE.BoxGeometry(16, 14, 16), stone), 0, 7, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), stone), 0, 18, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(7.4, 6.5, 4), roof), 0, 25.2, 0);

      // Corner towers + cone rooftops.
      const towerOffsets = [
        [-10, -10], [10, -10], [-10, 10], [10, 10]
      ];
      for (let t = 0; t < towerOffsets.length; t++) {
        const tx = towerOffsets[t][0];
        const tz = towerOffsets[t][1];
        add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 20, 6), stone), tx, 10, tz);
        add(new THREE.Mesh(new THREE.ConeGeometry(3.5, 5.6, 6), roof), tx, 22.8, tz);
      }

      // Gatehouse facing the approach (+z) with arch impression.
      add(new THREE.Mesh(new THREE.BoxGeometry(8, 9, 3), stone), 0, 4.5, 9.5);
      add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 5.6, 0.7), gateMat), 0, 2.8, 11.05);

      // Curtain wall stubs beside the gatehouse.
      add(new THREE.Mesh(new THREE.BoxGeometry(9, 6, 2.2), stoneDark), -8.5, 3, 9.5);
      add(new THREE.Mesh(new THREE.BoxGeometry(9, 6, 2.2), stoneDark), 8.5, 3, 9.5);

      // Battlements — one instanced mesh of merlons.
      const merlonSpots = [];
      for (let m = -7; m <= 7; m += 2.4) {
        merlonSpots.push([m, 14.7, -8.2], [m, 14.7, 8.2]);   // keep front/back
        merlonSpots.push([-8.2, 14.7, m], [8.2, 14.7, m]);   // keep sides
      }
      for (let m = -3.2; m <= 3.2; m += 1.7) {
        merlonSpots.push([m, 9.6, 9.5]);                     // gatehouse top
      }
      const merlonGeo = new THREE.BoxGeometry(1.05, 1.2, 1.05);
      const merlons = new THREE.InstancedMesh(merlonGeo, stoneDark, merlonSpots.length);
      const dummy = new THREE.Object3D();
      for (let m = 0; m < merlonSpots.length; m++) {
        dummy.position.set(merlonSpots[m][0], merlonSpots[m][1], merlonSpots[m][2]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        merlons.setMatrixAt(m, dummy.matrix);
      }
      merlons.instanceMatrix.needsUpdate = true;
      merlons.castShadow = this.config.shadows;
      castle.add(merlons);

      // Approach bridge / causeway from the corridor to the gate.
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 32), woodMat);
      bridge.position.set(0, 0.3, 27);
      bridge.receiveShadow = this.config.shadows;
      castle.add(bridge);

      castle.position.copy(this.CASTLE_POS);
      this.castle = castle;
      this.scene.add(castle);
    }

    /* ================================================================ */
    /*  Mountains                                                        */
    /* ================================================================ */

    createMountains() {
      const matA = new THREE.MeshStandardMaterial({
        color: 0x1b1340, roughness: 1, flatShading: true
      });
      const matB = new THREE.MeshStandardMaterial({
        color: 0x241a4a, roughness: 1, flatShading: true
      });

      const ranges = [
        // [x, z, radius, height]
        [-250, -300, 70, 120], [-150, -340, 58, 96], [-60, -380, 80, 132],
        [40, -350, 64, 108],   [140, -320, 72, 124], [250, -290, 60, 100],
        [-310, -240, 48, 78],  [310, -250, 52, 86],  [-200, -400, 88, 142],
        [200, -390, 84, 150],  [0, -430, 96, 160],   [-100, -290, 40, 66],
        [100, -280, 38, 60],   [320, -360, 70, 112]
      ];

      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const jaggedSegments = 5 + (i % 3);
        const peak = new THREE.Mesh(
          new THREE.ConeGeometry(r[2], r[3], jaggedSegments),
          i % 2 === 0 ? matA : matB
        );
        peak.position.set(r[0], r[3] * 0.42 - 6, r[1]);
        peak.rotation.y = (i * 0.7) % Math.PI;
        this.scene.add(peak);
      }
    }

    /* ================================================================ */
    /*  Lighting                                                         */
    /* ================================================================ */

    createLighting() {
      // Deep blue ambient base.
      this.scene.add(new THREE.AmbientLight(0x1b2547, 0.95));

      // Moonlight — the key light. Long dramatic shadows.
      const moon = new THREE.DirectionalLight(0x718df2, 1.25);
      moon.position.set(95, 150, 70);
      moon.target.position.set(0, 0, -130);
      this.scene.add(moon.target);

      if (this.config.shadows) {
        moon.castShadow = true;
        moon.shadow.mapSize.set(this.config.shadowMap, this.config.shadowMap);
        moon.shadow.camera.left = -180;
        moon.shadow.camera.right = 180;
        moon.shadow.camera.top = 180;
        moon.shadow.camera.bottom = -180;
        moon.shadow.camera.near = 10;
        moon.shadow.camera.far = 520;
        moon.shadow.bias = -0.0006;
      }
      this.scene.add(moon);

      // Soft amethyst rim from behind the castle.
      const rim = new THREE.PointLight(0x9a6cff, 0.85, 220, 2);
      rim.position.set(-30, 42, -185);
      this.scene.add(rim);
    }

    /* ================================================================ */
    /*  Camera spine                                                     */
    /* ================================================================ */

    createCameraPath() {
      // Named checkpoints along the journey.
      this.cameraCheckpoints = [
        /* Intro                  */ new THREE.Vector3(0, 6, 235),
        /* CoreTech               */ new THREE.Vector3(7, 6.5, 118),
        /* AgentCastlePivot       */ new THREE.Vector3(-36, 13, -92),
        /* AcademicMountOverview  */ new THREE.Vector3(36, 27, -118),
        /* EnterpriseEndpoint     */ new THREE.Vector3(0, 46, -68)
      ];

      this.lookAtTargets = [
        /* Intro                  */ new THREE.Vector3(0, 14, -140),
        /* CoreTech               */ new THREE.Vector3(-6, 10, -140),
        /* AgentCastlePivot       */ new THREE.Vector3(0, 16, -140),
        /* AcademicMountOverview  */ new THREE.Vector3(-8, 24, -235),
        /* EnterpriseEndpoint     */ new THREE.Vector3(0, 28, -310)
      ];

      this._currentLook.copy(this.lookAtTargets[0]);
      this.camera.position.copy(this.cameraCheckpoints[0]);
      this.camera.lookAt(this._currentLook);
    }

    // Interpolates the desired camera pose from scroll progress.
    updateCamera(progress) {
      const points = this.cameraCheckpoints;
      const looks = this.lookAtTargets;
      const segments = points.length - 1;

      const f = THREE.MathUtils.clamp(progress, 0, 1) * segments;
      const i = Math.min(Math.floor(f), segments - 1);
      let t = f - i;
      t = t * t * (3 - 2 * t); // smoothstep — no snapping between legs

      this._desiredPos.lerpVectors(points[i], points[i + 1], t);
      this._desiredLook.lerpVectors(looks[i], looks[i + 1], t);
    }

    /* ================================================================ */
    /*  ScrollTrigger timeline + HUD coordination                        */
    /* ================================================================ */

    setupScrollTimeline() {
      gsap.registerPlugin(ScrollTrigger);

      const nodeLabel = document.getElementById("progress-node");
      const names = this.nodeNames;

      // Master journey: drives camera progress with scrub smoothing.
      gsap.to(this.scroll, {
        progress: 1,
        ease: "none",
        scrollTrigger: {
          trigger: "#scroll-track",
          start: "top top",
          end: "bottom bottom",
          scrub: 1.2,
          onUpdate: (self) => {
            const idx = Math.min(
              names.length - 1,
              Math.floor(self.progress * names.length)
            );
            if (idx !== this._nodeLabelIndex) {
              this._nodeLabelIndex = idx;
              nodeLabel.textContent = names[idx];
            }
          }
        }
      });

      // Progress rail fill.
      gsap.to("#progress-fill", {
        scaleY: 1,
        ease: "none",
        scrollTrigger: {
          trigger: "#scroll-track",
          start: "top top",
          end: "bottom bottom",
          scrub: 1.2
        }
      });

      // HUD mission panels — one in/hold/out timeline per scroll zone.
      const cards = gsap.utils.toArray(".hud-card");
      cards.forEach((card) => {
        const node = card.getAttribute("data-node");
        const zone = document.querySelector(`.scroll-zone[data-node="${node}"]`);
        if (!zone) return;

        const isFinal = node === "contact";

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: zone,
            start: "top 78%",
            end: isFinal ? "bottom bottom" : "bottom 22%",
            scrub: 1.2
          }
        });

        tl.fromTo(
          card,
          { autoAlpha: 0, y: 70 },
          { autoAlpha: 1, y: 0, duration: 0.34, ease: "none" }
        ).to(card, { y: -12, duration: 0.32, ease: "none" });

        if (!isFinal) {
          tl.to(card, { autoAlpha: 0, y: -80, duration: 0.34, ease: "none" });
        }
      });
    }

    /* ================================================================ */
    /*  Frame loop                                                       */
    /* ================================================================ */

    animate() {
      this._rafId = requestAnimationFrame(this.animate.bind(this));

      const dt = Math.min(this.clock.getDelta(), 0.05);
      this._elapsed += dt;
      const time = this._elapsed;

      // Wind uniform — drives instanced canopy/grass sway in the shader.
      this.windUniform.value = time;

      // Desired pose from scroll.
      this.updateCamera(this.scroll.progress);

      // Subtle handheld float + pointer parallax (preallocated temps).
      this._tmpPos.copy(this._desiredPos);
      this._tmpPos.y += Math.sin(time * 0.6) * 0.5;
      this._tmpPos.x += Math.sin(time * 0.37) * 0.35;

      this._tmpLook.copy(this._desiredLook);
      this._pointerSmooth.x += (this._pointer.x - this._pointerSmooth.x) * 0.04;
      this._pointerSmooth.y += (this._pointer.y - this._pointerSmooth.y) * 0.04;
      this._tmpLook.x += this._pointerSmooth.x * 3.2;
      this._tmpLook.y += -this._pointerSmooth.y * 1.6 + Math.sin(time * 0.5) * 0.3;

      // Critically-damped easing toward the desired pose — frame-rate safe.
      const k = 1 - Math.exp(-3.4 * dt);
      this.camera.position.lerp(this._tmpPos, k);
      this._currentLook.lerp(this._tmpLook, k);
      this.camera.lookAt(this._currentLook);

      // Skybox follows the camera so the gradient never clips.
      this.skybox.position.copy(this.camera.position);

      this.renderer.render(this.scene, this.camera);
    }

    /* ================================================================ */
    /*  Resize                                                           */
    /* ================================================================ */

    onResize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);

      if (this.reducedMotion) {
        this.renderer.render(this.scene, this.camera);
      } else if (window.ScrollTrigger) {
        ScrollTrigger.refresh();
      }
    }

    /* ================================================================ */
    /*  WebGL failure fallback                                           */
    /* ================================================================ */

    static showFallback() {
      document.body.classList.add("static-mode", "no-webgl");
      const banner = document.getElementById("fallback-banner");
      if (banner) banner.hidden = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  function boot() {
    if (!supportsWebGL() || typeof THREE === "undefined") {
      CinematicEngine.showFallback();
      return;
    }

    const canvas = document.getElementById("scene");
    const engine = new CinematicEngine(canvas);

    try {
      engine.init();
    } catch (err) {
      // Any renderer/context failure degrades to the static portfolio.
      CinematicEngine.showFallback();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
