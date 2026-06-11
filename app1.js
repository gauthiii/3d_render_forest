/* ============================================================================
   app1.js — Drone Valley Vista
   Full-screen cinematic mountain valley with free-flight mouse controls.
   Three.js r128 only; remote textures where reliable, procedural fallbacks.
   ============================================================================ */

(function () {
  "use strict";

  const ASSETS = {
    grass: "https://threejs.org/examples/textures/terrain/grasslight-big.jpg",
    rock: "https://threejs.org/examples/textures/terrain/backgrounddetailed6.jpg",
    waterNormal: "https://threejs.org/examples/textures/waternormals.jpg",
    particle: "https://threejs.org/examples/textures/sprites/snowflake1.png"
  };

  const clamp = THREE.MathUtils.clamp;
  const smoothstep = THREE.MathUtils.smoothstep;

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

  function createNoise(seed) {
    const grad = [
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    let s = seed >>> 0;
    const rand = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    return function noise2D(xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const sk = (xin + yin) * F2;
      const i = Math.floor(xin + sk);
      const j = Math.floor(yin + sk);
      const t = (i + j) * G2;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;

      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) {
        t0 *= t0;
        const g = grad[perm[ii + perm[jj]] & 7];
        n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
      }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) {
        t1 *= t1;
        const g = grad[perm[ii + i1 + perm[jj + j1]] & 7];
        n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
      }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) {
        t2 *= t2;
        const g = grad[perm[ii + 1 + perm[jj + 1]] & 7];
        n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
      }
      return 70 * (n0 + n1 + n2);
    };
  }

  class DroneValley {
    constructor(canvas) {
      this.canvas = canvas;
      this.noise = createNoise(90210);
      this.clock = new THREE.Clock();
      this.tmp = new THREE.Vector3();
      this.tmp2 = new THREE.Vector3();
      this.forward = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.keys = Object.create(null);
      this.mouseDown = false;
      this.yaw = -0.04;
      this.pitch = -0.18;
      this.roll = 0;
      this.velocity = new THREE.Vector3();
      this.baseSpeed = 44;
      this.fastSpeed = 135;
      this.slowSpeed = 18;
      this.assets = {};
      this.mistMaterials = [];
      this.cloudMaterials = [];
    }

    init() {
      this.hidePortfolioUi();
      this.createRenderer();
      this.createScene();
      this.loadTextures();
      this.createCamera();
      this.createSky();
      this.createTerrain();
      this.createCliffWalls();
      this.createRiver();
      this.createForestMasses();
      this.createForeground();
      this.createAtmosphere();
      this.createBirds();
      this.createLighting();
      this.createPostProcessing();
      this.createControlsHint();
      this.bindControls();
      this.onResize();
      this.animate();
    }

    hidePortfolioUi() {
      document.body.classList.add("drone-vista");
      ["hud", "scroll-track", "progress", "brand", "fallback-banner"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      });
    }

    createRenderer() {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: "high-performance"
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.82;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    createScene() {
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x9f6a55, 0.00145);
      this.renderer.setClearColor(0x331124, 1);
    }

    loadTextures() {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      const load = (key, url, repeat) => {
        const tex = loader.load(url);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.anisotropy = 8;
        tex.encoding = THREE.sRGBEncoding;
        this.assets[key] = tex;
      };
      load("grass", ASSETS.grass, 34);
      load("rock", ASSETS.rock, 18);
      load("waterNormal", ASSETS.waterNormal, 9);
      load("particle", ASSETS.particle, 1);
    }

    createCamera() {
      this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.2, 4200);
      this.camera.position.set(-165, 92, 330);
      this.scene.add(this.camera);
    }

    fbm(x, z, octaves) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += this.noise(x * freq, z * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.02;
      }
      return sum / norm;
    }

    riverCenter(z) {
      return Math.sin(z * 0.0045) * 65 + Math.sin(z * 0.011) * 20;
    }

    terrainHeight(x, z) {
      const valleyCenter = this.riverCenter(z);
      const dist = Math.abs(x - valleyCenter);
      const valley = smoothstep(dist, 38, 520);
      const broad = this.fbm(x * 0.0018, z * 0.0018, 5) * 96;
      const detail = this.fbm(x * 0.012, z * 0.012, 4) * 13;
      const ridgeLift = Math.pow(valley, 1.7) * 190;
      const banks = Math.exp(-dist * dist / 9000) * -14;
      return broad * (0.22 + valley * 1.05) + detail + ridgeLift + banks - 14;
    }

    createSky() {
      const geo = new THREE.SphereGeometry(3900, 32, 16);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x170722) },
          mid: { value: new THREE.Color(0x5c1633) },
          horizon: { value: new THREE.Color(0xff5a1f) },
          sun: { value: new THREE.Vector3(-0.45, 0.22, -0.68).normalize() }
        },
        vertexShader: `
          varying vec3 vDir;
          void main(){
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 top;
          uniform vec3 mid;
          uniform vec3 horizon;
          uniform vec3 sun;
          varying vec3 vDir;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
          float noise(vec2 p){
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f*f*(3.0-2.0*f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }
          void main(){
            vec3 dir = normalize(vDir);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            vec2 skyUv = vec2(atan(dir.z, dir.x) * 0.1591549 + 0.5, asin(dir.y) * 0.3183099 + 0.5);
            vec3 col = mix(horizon, mid, smoothstep(0.02, 0.42, h));
            col = mix(col, top, smoothstep(0.42, 1.0, h));

            float glow = pow(max(dot(dir, sun), 0.0), 7.0);
            float sunCore = pow(max(dot(dir, sun), 0.0), 120.0);
            col += vec3(1.0, 0.24, 0.02) * glow * 1.25;
            col += vec3(1.0, 0.78, 0.34) * sunCore * 2.0;

            float nebula = noise(skyUv * vec2(8.0, 3.0) + vec2(0.0, 2.7));
            nebula += noise(skyUv * vec2(18.0, 7.0) + 8.0) * 0.55;
            float band = smoothstep(0.22, 0.72, nebula) * smoothstep(0.38, 0.82, h);
            col += vec3(0.88, 0.12, 0.75) * band * 0.24;
            col += vec3(1.0, 0.36, 0.03) * band * (1.0 - h) * 0.38;

            vec2 starGrid = skyUv * vec2(520.0, 260.0);
            vec2 cell = floor(starGrid);
            vec2 local = fract(starGrid) - 0.5;
            float starHash = hash(cell);
            float star = smoothstep(0.045, 0.0, length(local)) * step(0.986, starHash);
            float star2 = smoothstep(0.025, 0.0, length(local)) * step(0.996, hash(cell + 19.7));
            col += vec3(1.0, 0.84, 0.68) * (star * 0.85 + star2 * 1.8) * smoothstep(0.34, 0.75, h);
            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
      this.sky = new THREE.Mesh(geo, mat);
      this.scene.add(this.sky);

      for (let i = 0; i < 5; i++) {
        const cloud = new THREE.Mesh(
          new THREE.PlaneGeometry(2100, 420, 1, 1),
          this.makeCloudMaterial(i)
        );
        cloud.position.set((i - 2) * 260, 520 + i * 18, -500 - i * 270);
        cloud.rotation.x = -Math.PI / 2.8;
        cloud.rotation.z = 0.08 * (i - 2);
        cloud.renderOrder = -1;
        this.scene.add(cloud);
      }
    }

    makeCloudMaterial(seed) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: seed * 17.13 },
          uOpacity: { value: 0.14 + seed * 0.026 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uOpacity;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f*f*(3.0-2.0*f);
            float a = hash(i + uSeed);
            float b = hash(i + vec2(1.0,0.0) + uSeed);
            float c = hash(i + vec2(0.0,1.0) + uSeed);
            float d = hash(i + vec2(1.0,1.0) + uSeed);
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }
          void main(){
            vec2 uv = vUv * vec2(7.0, 2.1) + vec2(uTime * 0.01, 0.0);
            float n = noise(uv) * 0.55 + noise(uv * 2.2 + 9.0) * 0.32 + noise(uv * 5.0) * 0.13;
            float a = smoothstep(0.42, 0.82, n);
            float edge = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
            vec3 col = mix(vec3(0.22,0.07,0.16), vec3(0.96,0.32,0.08), a);
            gl_FragColor = vec4(col, a * edge * uOpacity);
          }
        `
      });
      this.cloudMaterials.push(mat);
      return mat;
    }

    createTerrain() {
      const size = 2300;
      const seg = 220;
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const soil = new THREE.Color(0x6d675a);
      const grass = new THREE.Color(0x253221);
      const moss = new THREE.Color(0x33422d);
      const gravel = new THREE.Color(0x968f80);
      const scree = new THREE.Color(0x5f6365);
      const snowRock = new THREE.Color(0xaeb1b1);
      const col = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = this.terrainHeight(x, z);
        pos.setY(i, h);
      }
      geo.computeVertexNormals();

      const normal = geo.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = pos.getY(i);
        const riverDist = Math.abs(x - this.riverCenter(z));
        const slope = 1 - smoothstep(normal.getY(i), 0.45, 0.86);
        const n = this.noise(x * 0.028, z * 0.028) * 0.5 + 0.5;
        const riverBand = 1.0 - smoothstep(riverDist, 42, 155);
        const dryPatch = this.noise(x * 0.008 + 9.0, z * 0.008 - 4.0) * 0.5 + 0.5;
        col.copy(grass).lerp(moss, n * 0.42);
        col.lerp(soil, smoothstep(riverDist, 70, 220) * 0.22 + dryPatch * 0.18);
        col.lerp(gravel, riverBand * 0.86);
        col.lerp(scree, smoothstep(h, 54, 138) * 0.44 + slope * 0.64);
        col.lerp(snowRock, smoothstep(h, 205, 295) * 0.58);
        col.multiplyScalar(0.58 + n * 0.22);
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.MeshStandardMaterial({
        map: this.assets.grass,
        vertexColors: true,
        roughness: 0.98,
        metalness: 0.0
      });
      this.terrain = new THREE.Mesh(geo, mat);
      this.terrain.receiveShadow = true;
      this.scene.add(this.terrain);
    }

    createCliffWalls() {
      const makeWall = (side) => {
        const length = 2300;
        const rows = 26;
        const cols = 120;
        const positions = [];
        const uvs = [];
        const indices = [];
        for (let zI = 0; zI <= cols; zI++) {
          const z = -length / 2 + (zI / cols) * length;
          const center = this.riverCenter(z);
          for (let yI = 0; yI <= rows; yI++) {
            const t = yI / rows;
            const strata = Math.sin(t * 44.0 + z * 0.018) * 12.0;
            const y = -30 + t * (560 + this.noise(z * 0.002, side * 4) * 96);
            const rough = this.fbm(side * 2 + t * 2.5, z * 0.005, 5) * 78;
            const overhang = Math.sin(t * Math.PI) * (118 + rough * 0.5);
            const x = center + side * (560 + t * 430 + overhang + rough + strata);
            positions.push(x, y, z);
            uvs.push(zI / 12, t * 5);
          }
        }
        for (let zI = 0; zI < cols; zI++) {
          for (let yI = 0; yI < rows; yI++) {
            const a = zI * (rows + 1) + yI;
            const b = a + 1;
            const c = a + (rows + 1);
            const d = c + 1;
            if (side < 0) indices.push(a, c, b, b, c, d);
            else indices.push(a, b, c, b, d, c);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          map: this.assets.rock,
          color: 0x686d72,
          roughness: 1.0,
          metalness: 0.0
        });
        const wall = new THREE.Mesh(geo, mat);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.scene.add(wall);
      };
      makeWall(-1);
      makeWall(1);
    }

    createRiver() {
      const pointsLeft = [];
      const pointsRight = [];
      const pointsCenter = [];
      for (let i = 0; i <= 160; i++) {
        const z = -1060 + (i / 160) * 1960;
        const x = this.riverCenter(z);
        const y = this.terrainHeight(x, z) + 0.9;
        const width = 16 + (this.noise(z * 0.012, 2) * 0.5 + 0.5) * 18;
        pointsLeft.push(new THREE.Vector3(x - width, y, z));
        pointsRight.push(new THREE.Vector3(x + width, y, z));
        pointsCenter.push(new THREE.Vector3(x, y + 0.5, z));
      }
      const shape = pointsLeft.concat(pointsRight.reverse());
      const geo = new THREE.BufferGeometry().setFromPoints(shape);
      const vertices = [];
      for (let i = 1; i < shape.length - 1; i++) {
        vertices.push(shape[0].x, shape[0].y, shape[0].z);
        vertices.push(shape[i].x, shape[i].y, shape[i].z);
        vertices.push(shape[i + 1].x, shape[i + 1].y, shape[i + 1].z);
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geo.computeVertexNormals();

      this.waterMat = new THREE.MeshStandardMaterial({
        color: 0x8aa0a8,
        normalMap: this.assets.waterNormal,
        transparent: true,
        opacity: 0.42,
        roughness: 0.18,
        metalness: 0.02
      });
      this.river = new THREE.Mesh(geo, this.waterMat);
      this.river.renderOrder = 2;
      this.scene.add(this.river);

      const bedGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pointsCenter), 280, 22, 8, false);
      const bed = new THREE.Mesh(
        bedGeo,
        new THREE.MeshStandardMaterial({ color: 0x9b927f, roughness: 0.94, map: this.assets.rock })
      );
      bed.scale.set(1.4, 0.08, 1);
      bed.position.y -= 1.8;
      bed.receiveShadow = true;
      this.scene.add(bed);

      const patchGeo = new THREE.PlaneGeometry(1, 1);
      const gravelMat = new THREE.MeshBasicMaterial({
        color: 0xd2d5cd,
        transparent: true,
        opacity: 0.34,
        depthWrite: false
      });
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xe7ece8,
        transparent: true,
        opacity: 0.24,
        depthWrite: false
      });
      for (let i = 0; i < 95; i++) {
        const z = -1040 + Math.random() * 1920;
        const x = this.riverCenter(z) + (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 34);
        const y = this.terrainHeight(x, z) + 1.15;
        const p = new THREE.Mesh(patchGeo, Math.random() < 0.68 ? gravelMat : foamMat);
        p.position.set(x, y, z);
        p.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
        p.scale.set(16 + Math.random() * 54, 4 + Math.random() * 18, 1);
        p.renderOrder = 3;
        this.scene.add(p);
      }
    }

    createTreeSpriteTexture(kind) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 128, 256);
      const trunk = ctx.createLinearGradient(60, 150, 72, 250);
      trunk.addColorStop(0, "rgba(38,31,24,0.75)");
      trunk.addColorStop(1, "rgba(18,14,10,0.9)");
      ctx.fillStyle = trunk;
      ctx.fillRect(59, 142, 10, 105);
      const colors = kind === "near"
        ? ["rgba(23,45,29,0.92)", "rgba(14,31,22,0.96)", "rgba(44,68,38,0.72)"]
        : ["rgba(11,25,20,0.78)", "rgba(8,18,17,0.82)", "rgba(32,43,36,0.45)"];
      for (let i = 0; i < 34; i++) {
        const y = 18 + i * 4.8;
        const w = 58 - i * 1.15;
        const x = 64 + Math.sin(i * 1.7) * 4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - w * (0.72 + Math.random() * 0.25), y + 44);
        ctx.lineTo(x + w * (0.72 + Math.random() * 0.25), y + 44);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      tex.needsUpdate = true;
      return tex;
    }

    createCrossCardGeometry() {
      const positions = [];
      const uvs = [];
      const indices = [];
      const addCard = (angle, width, height) => {
        const base = positions.length / 3;
        const c = Math.cos(angle) * width * 0.5;
        const s = Math.sin(angle) * width * 0.5;
        positions.push(
          -c, 0, -s,
           c, 0,  s,
          -c, height, -s,
           c, height,  s
        );
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        indices.push(base + 2, base + 1, base, base + 2, base + 3, base + 1);
      };
      addCard(0, 1.0, 1.0);
      addCard(Math.PI / 2, 0.92, 1.0);
      addCard(Math.PI / 4, 0.76, 0.95);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    createForestMasses() {
      const treeCardGeo = this.createCrossCardGeometry();
      const cardMat = new THREE.MeshBasicMaterial({
        map: this.createTreeSpriteTexture("near"),
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        color: 0x6f806e
      });
      const cardCount = 3200;
      const cardTrees = new THREE.InstancedMesh(treeCardGeo, cardMat, cardCount);
      const trunkGeo = new THREE.CylinderGeometry(0.7, 1.2, 9, 5);
      trunkGeo.translate(0, 4.5, 0);
      const crownGeo = new THREE.ConeGeometry(5.2, 18, 7);
      crownGeo.translate(0, 16, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2d2217, roughness: 1 });
      const crownMat = new THREE.MeshStandardMaterial({
        color: 0x111d19,
        roughness: 1,
        flatShading: true,
        transparent: true,
        opacity: 0.38
      });
      const nearCount = 900;
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nearCount);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, nearCount);
      const dummy = new THREE.Object3D();
      let placed = 0;
      let cardPlaced = 0;
      let attempt = 0;
      while ((placed < nearCount || cardPlaced < cardCount) && attempt < cardCount * 16) {
        attempt++;
        const z = -1030 + (this.noise(attempt * 0.61, 9) * 0.5 + 0.5) * 1930;
        const center = this.riverCenter(z);
        const side = this.noise(attempt * 0.91, 2) < 0 ? -1 : 1;
        const x = center + side * (90 + Math.pow(this.noise(3, attempt * 0.47) * 0.5 + 0.5, 0.55) * 470);
        const h = this.terrainHeight(x, z);
        if (h > 150) continue;
        const scale = 0.65 + (this.noise(x * 0.04, z * 0.04) * 0.5 + 0.5) * 1.0;
        dummy.position.set(x, h - 0.4, z);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.45), scale);
        dummy.updateMatrix();
        if (cardPlaced < cardCount) {
          const cardScale = 13 + Math.random() * 24;
          dummy.scale.set(cardScale * 0.7, cardScale, cardScale * 0.7);
          dummy.updateMatrix();
          cardTrees.setMatrixAt(cardPlaced++, dummy.matrix);
        }
        if (placed < nearCount && Math.random() < 0.42) {
          dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.45), scale);
          dummy.updateMatrix();
          trunks.setMatrixAt(placed, dummy.matrix);
          crowns.setMatrixAt(placed, dummy.matrix);
          placed++;
        }
      }
      cardTrees.instanceMatrix.needsUpdate = true;
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      cardTrees.castShadow = false;
      trunks.castShadow = crowns.castShadow = true;
      trunks.receiveShadow = crowns.receiveShadow = true;
      this.scene.add(cardTrees, trunks, crowns);

      const spriteNear = this.createTreeSpriteTexture("near");
      const spriteFar = this.createTreeSpriteTexture("far");
      const makeCards = (count, far) => {
        const group = new THREE.Group();
        for (let i = 0; i < count; i++) {
          const z = -1120 + Math.random() * 2050;
          const center = this.riverCenter(z);
          const side = Math.random() < 0.5 ? -1 : 1;
          const x = center + side * (far ? 250 + Math.random() * 560 : 120 + Math.random() * 360);
          const h = this.terrainHeight(x, z);
          if (h > (far ? 240 : 170)) continue;
          const mat = new THREE.SpriteMaterial({
            map: far ? spriteFar : spriteNear,
            color: far ? 0x9ca4a0 : 0xffffff,
            transparent: true,
            depthWrite: false,
            opacity: far ? 0.42 : 0.72
          });
          const s = new THREE.Sprite(mat);
          const scale = far ? 42 + Math.random() * 55 : 26 + Math.random() * 42;
          s.position.set(x, h + scale * 0.42, z);
          s.scale.set(scale * 0.65, scale, 1);
          group.add(s);
        }
        this.scene.add(group);
      };
      makeCards(900, false);
      makeCards(1450, true);
    }

    createForeground() {
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x85837d,
        map: this.assets.rock,
        roughness: 0.96,
        metalness: 0.0
      });
      const rockGeo = new THREE.IcosahedronGeometry(1, 2);
      const rocks = [
        [-225, 67, 265, 35, 58, 45],
        [-160, 56, 285, 22, 28, 22],
        [110, 42, 245, 15, 10, 28],
        [150, 44, 210, 24, 12, 18]
      ];
      rocks.forEach((r, i) => {
        const m = new THREE.Mesh(rockGeo, rockMat);
        m.position.set(r[0], r[1], r[2]);
        m.scale.set(r[3], r[4], r[5]);
        m.rotation.set(i * 0.7, i * 1.1, i * 0.3);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
      });

      const shrubGeo = new THREE.IcosahedronGeometry(1.2, 1);
      const shrubMat = new THREE.MeshStandardMaterial({ color: 0x253725, roughness: 1, flatShading: true });
      const dummy = new THREE.Object3D();
      const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, 260);
      for (let i = 0; i < 260; i++) {
        const x = -290 + Math.random() * 620;
        const z = 180 + Math.random() * 150;
        const y = this.terrainHeight(x, z) + 1.5;
        dummy.position.set(x, y, z);
        dummy.rotation.set(Math.random(), Math.random() * Math.PI * 2, Math.random() * 0.4);
        const s = 1.8 + Math.random() * 4.8;
        dummy.scale.set(s * 1.4, s * 0.65, s);
        dummy.updateMatrix();
        shrubs.setMatrixAt(i, dummy.matrix);
      }
      shrubs.instanceMatrix.needsUpdate = true;
      shrubs.castShadow = true;
      this.scene.add(shrubs);
    }

    createAtmosphere() {
      const mistGeo = new THREE.PlaneGeometry(2100, 380);
      for (let i = 0; i < 8; i++) {
        const mat = this.makeMistMaterial(i);
        const m = new THREE.Mesh(mistGeo, mat);
        m.position.set(0, 38 + i * 18, -850 + i * 250);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = 0.04 * (i - 3);
        m.renderOrder = 10;
        this.scene.add(m);
      }

      const count = 260;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = -650 + Math.random() * 1300;
        positions[i * 3 + 1] = 35 + Math.random() * 220;
        positions[i * 3 + 2] = -950 + Math.random() * 1300;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      this.dust = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          map: this.assets.particle,
          color: 0xaeb5ba,
          size: 11,
          transparent: true,
          opacity: 0.065,
          depthWrite: false,
          blending: THREE.NormalBlending
        })
      );
      this.scene.add(this.dust);
    }

    createBirdGeometry() {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array([
        0.0, 0.0, 0.0,
        -0.9, 0.04, 0.18,
        -2.2, 0.0, 0.0,
        0.0, 0.0, 0.0,
        0.9, 0.04, 0.18,
        2.2, 0.0, 0.0,
        -0.22, -0.04, -0.18,
        0.22, -0.04, -0.18,
        0.0, 0.18, 0.16
      ]);
      const indices = [
        0, 1, 2,
        3, 5, 4,
        6, 7, 8
      ];
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    createBirds() {
      this.birdFlocks = [];
      const birdMat = new THREE.MeshBasicMaterial({
        color: 0x09060a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88
      });

      const makeFlock = (count, origin, radius, speed, scale, phaseOffset) => {
        const group = new THREE.Group();
        const birds = [];
        for (let i = 0; i < count; i++) {
          const mesh = new THREE.Mesh(this.createBirdGeometry(), birdMat);
          const phase = phaseOffset + i * 0.71;
          const lane = (i / Math.max(1, count - 1) - 0.5) * radius * 0.45;
          mesh.scale.setScalar(scale * (0.72 + Math.random() * 0.55));
          group.add(mesh);
          birds.push({
            mesh,
            phase,
            lane,
            flap: 2.4 + Math.random() * 2.2,
            bob: 0.6 + Math.random() * 1.4
          });
        }
        group.position.copy(origin);
        this.scene.add(group);
        this.birdFlocks.push({ group, birds, origin: origin.clone(), radius, speed, phaseOffset });
      };

      makeFlock(18, new THREE.Vector3(-240, 260, -260), 460, 0.18, 5.4, 0.0);
      makeFlock(11, new THREE.Vector3(310, 340, -620), 520, -0.13, 4.2, 3.1);
      makeFlock(7, new THREE.Vector3(-520, 420, -900), 620, 0.09, 6.6, 6.4);
    }

    updateBirds(time) {
      if (!this.birdFlocks) return;
      for (let f = 0; f < this.birdFlocks.length; f++) {
        const flock = this.birdFlocks[f];
        for (let i = 0; i < flock.birds.length; i++) {
          const b = flock.birds[i];
          const t = time * flock.speed + b.phase;
          const x = Math.cos(t) * flock.radius + b.lane;
          const z = Math.sin(t * 0.82) * flock.radius * 0.45;
          const y = Math.sin(t * 1.7 + b.phase) * 22 + Math.sin(time * b.bob + i) * 6;
          b.mesh.position.set(x, y, z);
          b.mesh.rotation.y = -t + Math.PI * 0.5;
          b.mesh.rotation.z = Math.sin(time * b.flap + b.phase) * 0.34;
          b.mesh.rotation.x = Math.sin(time * b.flap * 1.7 + b.phase) * 0.12;
          const flapScale = 1.0 + Math.sin(time * b.flap + b.phase) * 0.18;
          b.mesh.scale.y = Math.abs(b.mesh.scale.x) * flapScale;
        }
      }
    }

    makeMistMaterial(seed) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: seed * 13.7 },
          uColor: { value: new THREE.Color(seed < 3 ? 0xb7b8b2 : 0x84909b) },
          uOpacity: { value: 0.16 - seed * 0.009 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1))) * 18758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f*f*(3.0-2.0*f);
            float a = hash(i + uSeed);
            float b = hash(i + vec2(1,0) + uSeed);
            float c = hash(i + vec2(0,1) + uSeed);
            float d = hash(i + vec2(1,1) + uSeed);
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }
          void main(){
            vec2 uv = vUv * vec2(6.0, 1.4) + vec2(uTime * 0.012, 0.0);
            float n = noise(uv) * 0.6 + noise(uv * 2.7 + 8.0) * 0.4;
            float band = smoothstep(0.10, 0.42, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
            float a = smoothstep(0.24, 0.76, n) * band * uOpacity;
            gl_FragColor = vec4(uColor, a);
          }
        `
      });
      this.mistMaterials.push(mat);
      return mat;
    }

    createLighting() {
      const hemi = new THREE.HemisphereLight(0xff8a3d, 0x2c1a22, 0.82);
      this.scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xff6a16, 2.55);
      sun.position.set(-380, 520, 220);
      sun.target.position.set(0, 20, -360);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -720;
      sun.shadow.camera.right = 720;
      sun.shadow.camera.top = 720;
      sun.shadow.camera.bottom = -720;
      sun.shadow.camera.near = 10;
      sun.shadow.camera.far = 1500;
      sun.shadow.bias = -0.00045;
      this.scene.add(sun.target, sun);
      const cool = new THREE.DirectionalLight(0x7c3dff, 0.22);
      cool.position.set(480, 260, -600);
      this.scene.add(cool);
    }

    createPostProcessing() {
      const w = Math.max(1, window.innerWidth * Math.min(window.devicePixelRatio, 2));
      const h = Math.max(1, window.innerHeight * Math.min(window.devicePixelRatio, 2));
      this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true
      });
      this.sceneTarget.texture.encoding = THREE.sRGBEncoding;
      this.postScene = new THREE.Scene();
      this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.postQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          depthTest: false,
          depthWrite: false,
          uniforms: {
            tDiffuse: { value: this.sceneTarget.texture },
            uExposure: { value: 0.96 }
          },
          vertexShader: `
            varying vec2 vUv;
            void main(){
              vUv = uv;
              gl_Position = vec4(position.xy, 0.0, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uExposure;
            varying vec2 vUv;
            float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
            void main(){
              vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;
              float l = luma(color);
              vec3 gray = vec3(l);
              color = mix(gray, color, 0.72);
              color = mix(color, vec3(0.055, 0.012, 0.065), (1.0 - l) * 0.20);
              color = mix(color, vec3(1.0, 0.34, 0.04), l * l * 0.16);
              color = pow(max(color, 0.0), vec3(1.04));
              float contrast = 1.13;
              color = (color - 0.5) * contrast + 0.5;
              float vig = 1.0 - smoothstep(0.35, 1.18, length(vUv - 0.5) * 1.85) * 0.42;
              color *= vig;
              gl_FragColor = vec4(color, 1.0);
            }
          `
        })
      );
      this.postScene.add(this.postQuad);
    }

    renderFrame() {
      if (!this.sceneTarget) {
        this.renderer.render(this.scene, this.camera);
        return;
      }
      this.renderer.setRenderTarget(this.sceneTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.postScene, this.postCamera);
    }

    createControlsHint() {
      const panel = document.createElement("div");
      panel.id = "drone-controls";
      panel.innerHTML = "Click scene to fly · Mouse look · WASD move · Space/C rise/fall · Shift boost · Q/E roll";
      Object.assign(panel.style, {
        position: "fixed",
        left: "18px",
        bottom: "16px",
        zIndex: "40",
        padding: "10px 12px",
        font: "12px JetBrains Mono, monospace",
        color: "rgba(235,238,242,0.86)",
        background: "rgba(5,8,12,0.34)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: "8px",
        backdropFilter: "blur(10px)",
        pointerEvents: "none"
      });
      document.body.appendChild(panel);
    }

    bindControls() {
      window.addEventListener("resize", () => this.onResize());
      window.addEventListener("keydown", (e) => {
        this.keys[e.code] = true;
        if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(e.code)) {
          e.preventDefault();
        }
      });
      window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
      this.canvas.addEventListener("click", () => {
        if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
      });
      this.canvas.addEventListener("mousedown", () => { this.mouseDown = true; });
      window.addEventListener("mouseup", () => { this.mouseDown = false; });
      window.addEventListener("mousemove", (e) => {
        const locked = document.pointerLockElement === this.canvas;
        if (!locked && !this.mouseDown) return;
        this.yaw -= e.movementX * 0.0022;
        this.pitch -= e.movementY * 0.0018;
        this.pitch = clamp(this.pitch, -1.25, 0.45);
      });
    }

    updateControls(dt) {
      const speed = this.keys.ShiftLeft || this.keys.ShiftRight ? this.fastSpeed : (this.keys.AltLeft ? this.slowSpeed : this.baseSpeed);
      this.camera.rotation.order = "YXZ";
      this.roll += ((this.keys.KeyQ ? 0.18 : 0) + (this.keys.KeyE ? -0.18 : 0) - this.roll) * Math.min(1, dt * 5);
      this.camera.rotation.set(this.pitch, this.yaw, this.roll);

      this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const move = this.tmp.set(0, 0, 0);
      if (this.keys.KeyW) move.add(this.forward);
      if (this.keys.KeyS) move.sub(this.forward);
      if (this.keys.KeyD) move.add(this.right);
      if (this.keys.KeyA) move.sub(this.right);
      if (this.keys.Space) move.y += 1;
      if (this.keys.KeyC || this.keys.ControlLeft) move.y -= 1;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
      this.velocity.lerp(move, 1 - Math.exp(-dt * 5.0));
      this.camera.position.addScaledVector(this.velocity, dt);

      const ground = this.terrainHeight(this.camera.position.x, this.camera.position.z) + 8;
      this.camera.position.y = Math.max(this.camera.position.y, ground);
      this.camera.position.x = clamp(this.camera.position.x, -880, 880);
      this.camera.position.z = clamp(this.camera.position.z, -1080, 980);
      this.sky.position.copy(this.camera.position);
    }

    animate() {
      requestAnimationFrame(() => this.animate());
      const dt = Math.min(this.clock.getDelta(), 0.04);
      const t = this.clock.elapsedTime;
      this.updateControls(dt);
      if (this.waterMat && this.waterMat.normalMap) {
        this.waterMat.normalMap.offset.x = t * 0.025;
        this.waterMat.normalMap.offset.y = t * 0.012;
      }
      this.mistMaterials.forEach((m) => { m.uniforms.uTime.value = t; });
      this.cloudMaterials.forEach((m) => { m.uniforms.uTime.value = t; });
      this.updateBirds(t);
      if (this.dust) this.dust.rotation.y = Math.sin(t * 0.08) * 0.02;
      this.renderFrame();
    }

    onResize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    static fallback() {
      document.body.classList.add("static-mode", "no-webgl");
      const banner = document.getElementById("fallback-banner");
      if (banner) banner.hidden = false;
    }
  }

  function boot() {
    if (!supportsWebGL() || typeof THREE === "undefined") {
      DroneValley.fallback();
      return;
    }
    try {
      const engine = new DroneValley(document.getElementById("scene"));
      engine.init();
    } catch (err) {
      console.error(err);
      DroneValley.fallback();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
