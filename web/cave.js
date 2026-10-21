// the mine you watch. one fixed room, camera always inside, three arched tunnels with a pocket at the end of each
// the room is built once. a new region re-roughs the walls and re-scatters props. a fork only adds rubble and ore
// fixed light count so shaders never recompile

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from './sim.js';

export const MINER_COLORS = { Oracle: 0x199e70, Apprentice: 0x3987e5, Parrot: 0xd95926 };

const W = 36, H = 16, BACK = -14, FRONT = 20;
const ARCH_X = [-10, 0, 10], ARCH_W = 5, ARCH_H = 6;
const ROCKS = [[0.55, 0.45, 0.42], [0.38, 0.41, 0.46], [0.6, 0.5, 0.36], [0.33, 0.38, 0.33]];

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, ...extra });
const MAT = {
  wood: flat(0x6b4a2b), woodDark: flat(0x4a321d), iron: flat(0x62666b, { metalness: 0.5, roughness: 0.5 }),
  rock: flat(0x4b4239), rubble: flat(0x3e3630), stem: flat(0xd8ccb4),
  cap: flat(0x7fd6c9, { emissive: 0x1f8f86, emissiveIntensity: 0.9 }),
  crystal: flat(0xb79cf0, { emissive: 0x4b2a8a, emissiveIntensity: 0.7, roughness: 0.3 }),
  ore: flat(0xe7b84f, { emissive: 0x8a5a10, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.25 }),
  tnt: flat(0xc0392b, { roughness: 0.6 }), fuse: flat(0x2b2118),
  puddle: new THREE.MeshStandardMaterial({ color: 0x0d1820, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.85 }),
};

const glowTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const glow = (color, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  return s;
};

export class Cave {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070605);
    this.scene.fog = new THREE.FogExp2(0x070605, 0.018);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.clock = new THREE.Clock();

    this.scene.add(new THREE.HemisphereLight(0x9a8a72, 0x1a140c, 0.75));
    this.lamp = new THREE.SpotLight(0xffdcaa, 3.6, 70, 0.22, 0.5, 0);
    this.lamp.target = new THREE.Object3D();
    this.lantern = new THREE.PointLight(0xffb866, 2.2, 26, 0);
    this.lantern.position.set(ARCH_X[0] + 4, 5.2, BACK + 1.2);
    this.oreLight = new THREE.PointLight(0xffc860, 0, 18, 0);
    this.pulse = new THREE.PointLight(0xd9c4a0, 0, 18, 0);
    this.scene.add(this.lamp, this.lamp.target, this.lantern, this.oreLight, this.pulse);

    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    this.room = new THREE.Group();
    this.regionProps = new THREE.Group();
    this.forkProps = new THREE.Group();
    this.scene.add(this.room, this.regionProps, this.forkProps);
    this.buildShell();

    this.miner = buildMiner();
    this.scene.add(this.miner);
    const beamGeo = new THREE.ConeGeometry(2.4, 22, 18, 1, true);
    beamGeo.translate(0, -11, 0);
    beamGeo.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.scene.add(this.beam);

    this.lanterns = {};
    for (const [name, color] of Object.entries(MINER_COLORS)) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color })), glow(color, 2.6));
      g.visible = false;
      this.scene.add(g);
      this.lanterns[name] = g;
    }
    this.labels = ARCH_X.map((x, i) => {
      const s = makeLabel(['I', 'II', 'III'][i]);
      s.position.set(x, ARCH_H + 1.6, BACK + 0.6);
      this.scene.add(s);
      return s;
    });
    this.drips = makePoints(260, 0x9fb4c4, 0.16);
    this.dust = makePoints(200, 0xb8a48a, 0.1);
    this.scene.add(this.drips.points, this.dust.points);

    this.home = new THREE.Vector3(0, 0, 6);
    this.camPos = new THREE.Vector3(0, 6.5, 16);
    this.camLook = new THREE.Vector3(0, 3.5, -10);
    this.goalPos = this.camPos.clone();
    this.goalLook = this.camLook.clone();
    this.lampAim = new THREE.Vector3(0, 2, BACK);
    this.effects = [];
    this.weather = { drip: 0.3, wind: 0.4, warmth: 0 };
    this.regionSeed = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 800, h = c.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep about 76 degrees side to side so all three tunnels fit on a tall phone screen
    const vfov = (2 * Math.atan(Math.tan((38 * Math.PI) / 180) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(100, Math.max(60, vfov));
    this.camera.updateProjectionMatrix();
  }

  // walls floor ceiling as subdivided planes facing in, back wall with three arches. made once, re-roughed per region
  buildShell() {
    const plane = (w, h, sx, sy) => new THREE.PlaneGeometry(w, h, sx, sy);
    const parts = [
      { geo: plane(W + 4, FRONT - BACK + 4, 18, 18), rot: [-Math.PI / 2, 0, 0], pos: [0, 0, (FRONT + BACK) / 2], amp: 0.25 },
      { geo: plane(W + 4, FRONT - BACK + 4, 18, 18), rot: [Math.PI / 2, 0, 0], pos: [0, H, (FRONT + BACK) / 2], amp: 1.6 },
      { geo: plane(FRONT - BACK + 4, H + 4, 16, 8), rot: [0, Math.PI / 2, 0], pos: [-W / 2, H / 2, (FRONT + BACK) / 2], amp: 1.4 },
      { geo: plane(FRONT - BACK + 4, H + 4, 16, 8), rot: [0, -Math.PI / 2, 0], pos: [W / 2, H / 2, (FRONT + BACK) / 2], amp: 1.4 },
      { geo: plane(W + 4, H + 4, 16, 8), rot: [0, Math.PI, 0], pos: [0, H / 2, FRONT], amp: 1.2 },
    ];
    this.shell = parts.map((p) => {
      p.geo.rotateX(p.rot[0]); p.geo.rotateY(p.rot[1]);
      p.geo.translate(...p.pos);
      p.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.geo.attributes.position.count * 3), 3));
      p.base = Float32Array.from(p.geo.attributes.position.array);
      p.normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...p.rot));
      const m = new THREE.Mesh(p.geo, this.rockMat);
      this.room.add(m);
      return p;
    });
    const wall = new THREE.Shape();
    wall.moveTo(-W / 2 - 2, -1); wall.lineTo(W / 2 + 2, -1); wall.lineTo(W / 2 + 2, H + 2); wall.lineTo(-W / 2 - 2, H + 2); wall.lineTo(-W / 2 - 2, -1);
    for (const x of ARCH_X) {
      const hole = new THREE.Path();
      hole.moveTo(x - ARCH_W / 2, -1); hole.lineTo(x - ARCH_W / 2, ARCH_H - ARCH_W / 2);
      hole.absarc(x, ARCH_H - ARCH_W / 2, ARCH_W / 2, Math.PI, 0, true);
      hole.lineTo(x + ARCH_W / 2, -1); hole.lineTo(x - ARCH_W / 2, -1);
      wall.holes.push(hole);
    }
    const wallGeo = new THREE.ExtrudeGeometry(wall, { depth: 2, bevelEnabled: false, curveSegments: 8 });
    wallGeo.translate(0, 0, BACK - 2);
    this.backWall = new THREE.Mesh(wallGeo, flat(0x4d433a));
    this.room.add(this.backWall);
  }

  // new region: rough the walls, dig three tunnels of different depths, scatter props
  setRegion(region, weather) {
    if (weather) this.setWeather(weather);
    if (this.regionSeed === region.seed) return;
    this.regionSeed = region.seed;
    const rng = mulberry32(region.seed ^ 0x5bd1e995);
    const noise = createNoise3D(rng);
    const base = ROCKS[Math.floor(rng() * ROCKS.length)];
    const warm = this.weather.warmth;
    const tint = (x, y, z) => {
      const k = 0.62 + 0.5 * (0.5 + 0.5 * noise(x * 0.08, y * 0.35, z * 0.08));
      return [base[0] * k * (1 + 0.1 * warm), base[1] * k, base[2] * k * (1 - 0.1 * warm)];
    };
    this.rockTint = tint;
    for (const p of this.shell) {
      const pos = p.geo.attributes.position, col = p.geo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        const x = p.base[i * 3], y = p.base[i * 3 + 1], z = p.base[i * 3 + 2];
        const d = p.amp * noise(x * 0.12, y * 0.12, z * 0.12) + p.amp * 0.4 * noise(x * 0.4, y * 0.4, z * 0.4);
        pos.setXYZ(i, x + p.normal.x * d, y + p.normal.y * d, z + p.normal.z * d);
        col.setXYZ(i, ...tint(x, y, z));
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      p.geo.computeVertexNormals();
    }
    this.backWall.material.color.setRGB(base[0] * 0.8, base[1] * 0.8, base[2] * 0.8);

    for (const c of [...this.regionProps.children]) { this.regionProps.remove(c); c.traverse((o) => o.geometry?.dispose()); }
    const add = (o) => { this.regionProps.add(o); return o; };
    this.tunnels = ARCH_X.map((x, t) => {
      const depth = 8 + rng() * 9, bend = (rng() - 0.5) * 6;
      const g = new THREE.Group();
      const walls = this.tunnelMat(base, 0.85);
      walls.side = THREE.BackSide;
      // box faces are +x -x +y -y +z -z. drop both ends so the arch and the pocket stay open
      const tube = new THREE.Mesh(new THREE.BoxGeometry(ARCH_W + 0.6, ARCH_H + 0.6, depth, 3, 3, 6), [walls, walls, walls, walls, HIDDEN, HIDDEN]);
      tube.geometry.translate(0, ARCH_H / 2 + 0.2, -depth / 2);
      roughen(tube.geometry, noise, 0.5);
      const pocketAt = new THREE.Vector3(x + bend, 2.6, BACK - 2 - depth - 1.5);
      const pocket = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 1), this.tunnelMat(base, 0.75));
      pocket.material.side = THREE.BackSide;
      pocket.scale.set(1.2, 0.85, 1);
      roughen(pocket.geometry, noise, 0.6);
      pocket.position.copy(pocketAt);
      tube.position.set(x + bend * 0.3, 0, BACK - 2);
      tube.rotation.y = -Math.atan2(bend * 0.7, depth);
      g.add(tube, pocket);
      add(g);
      return { x, mouth: new THREE.Vector3(x, 2.4, BACK + 0.5), deep: new THREE.Vector3(x + bend * 0.5, 2.4, BACK - 2 - depth * 0.6), pocket: pocketAt };
    });

    // timber sets, rails, lantern
    this.tunnels.forEach((tn) => {
      for (const side of [-1, 1]) {
        const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, ARCH_H + 0.4, 0.5), MAT.wood));
        post.position.set(tn.x + side * (ARCH_W / 2 - 0.1), (ARCH_H + 0.4) / 2, BACK + 0.4);
      }
      const cap = add(new THREE.Mesh(new THREE.BoxGeometry(ARCH_W + 1.4, 0.55, 0.6), MAT.woodDark));
      cap.position.set(tn.x, ARCH_H + 0.5, BACK + 0.4);
      const from = new THREE.Vector3(this.home.x + (tn.x - this.home.x) * 0.15, 0.06, this.home.z - 2);
      const to = new THREE.Vector3(tn.x, 0.06, BACK - 4);
      const len = from.distanceTo(to);
      const track = new THREE.Group();
      for (const off of [-0.55, 0.55]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, len), MAT.iron);
        rail.position.set(off, 0.12, 0);
        track.add(rail);
      }
      for (let s = 0.5; s < len; s += 1.3) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.32), MAT.woodDark);
        tie.position.z = s - len / 2;
        track.add(tie);
      }
      track.position.copy(from).add(to).multiplyScalar(0.5);
      track.lookAt(to);
      add(track);
    });
    const lan = new THREE.Group();
    lan.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.4), MAT.iron), glow(0xffc070, 3));
    lan.position.copy(this.lantern.position);
    add(lan);

    // ring of clutter, kept off the walkway in front of the miner
    const clear = (x, z) => Math.abs(x) < 4 || (z < BACK + 3 && ARCH_X.some((ax) => Math.abs(x - ax) < 3.5));
    for (let i = 0; i < 22; i++) {
      const x = (rng() - 0.5) * (W - 4), z = BACK + 2 + rng() * (FRONT - BACK - 8);
      if (clear(x, z)) continue;
      const k = rng();
      if (k < 0.45) {
        const m = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rng() * 1.1, 0), MAT.rock));
        m.position.set(x, 0.3, z); m.scale.y = 0.6 + rng() * 0.4; m.rotation.y = rng() * 3;
      } else if (k < 0.75) {
        const h = 1 + rng() * 2.6;
        const m = add(new THREE.Mesh(new THREE.ConeGeometry(0.35 + rng() * 0.4, h, 6), MAT.rock));
        m.position.set(x, h / 2 - 0.1, z);
      } else {
        for (let j = 0; j < 3; j++) {
          const s = 0.6 + rng() * 0.6, g = new THREE.Group();
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.1 * s, 0.6 * s, 5), MAT.stem);
          stem.position.y = 0.3 * s;
          const capm = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), MAT.cap);
          capm.position.y = 0.6 * s;
          g.add(stem, capm);
          g.position.set(x + (rng() - 0.5), 0, z + (rng() - 0.5));
          add(g);
        }
      }
    }
    for (let i = 0; i < 18; i++) {
      const h = 0.8 + rng() * 2.6;
      const m = add(new THREE.Mesh(new THREE.ConeGeometry(0.25 + rng() * 0.35, h, 6), MAT.rock));
      m.rotation.x = Math.PI;
      m.position.set((rng() - 0.5) * (W - 3), H - h / 2 + 0.4, BACK + 1 + rng() * (FRONT - BACK - 6));
    }
    for (let i = 0; i < 4; i++) {
      const side = rng() < 0.5 ? -1 : 1, cl = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + rng() * 0.3, 0), MAT.crystal);
        c.scale.y = 2 + rng() * 1.5;
        c.position.set(0, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.8);
        c.rotation.set(0, 0, side * (0.9 + (rng() - 0.5) * 0.6));
        cl.add(c);
      }
      cl.position.set(side * (W / 2 - 1.2), 2 + rng() * 6, BACK + 3 + rng() * 16);
      add(cl);
    }
    if (this.weather.drip > 0.35) {
      for (let i = 0; i < 3; i++) {
        const m = add(new THREE.Mesh(new THREE.CircleGeometry(0.8 + rng() * 1.2, 10), MAT.puddle));
        m.rotation.x = -Math.PI / 2; m.scale.y = 0.6;
        m.position.set((rng() < 0.5 ? -1 : 1) * (5 + rng() * 9), 0.04, BACK + 4 + rng() * 14);
      }
    }
    const cart = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.95, 1.1, 4, 1, true), flat(0x6a6e72, { metalness: 0.4, side: THREE.DoubleSide }));
    tub.rotation.y = Math.PI / 4; tub.position.y = 1.05; tub.scale.set(1.25, 1, 0.8);
    cart.add(tub);
    for (const [x, z] of [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 8), MAT.iron);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(x, 0.3, z);
      cart.add(wheel);
    }
    for (let j = 0; j < 6; j++) {
      const n = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rng() * 0.15, 0), MAT.ore);
      n.position.set((rng() - 0.5) * 1.2, 1.45, (rng() - 0.5) * 0.7);
      cart.add(n);
    }
    cart.position.set(-5.5, 0, 8.5); cart.rotation.y = 0.35;
    add(cart);
  }

  tunnelMat(base, k) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(base[0] * k, base[1] * k, base[2] * k), flatShading: true, roughness: 0.95 });
  }

  setWeather(wx) {
    this.weather = {
      drip: Math.min(1, 0.15 + wx.precipitation * 0.6 + (wx.relative_humidity_2m - 50) / 200),
      wind: Math.min(1.5, wx.wind_speed_10m / 25),
      warmth: Math.max(-1, Math.min(1, (wx.temperature_2m - 10) / 15)),
    };
    this.scene.fog.density = 0.012 + Math.max(0, wx.relative_humidity_2m - 20) / 6000;
  }

  // a fork: put the ore in its pocket, reset the miner and camera
  build(f) {
    for (const c of [...this.forkProps.children]) { this.forkProps.remove(c); c.traverse((o) => o.geometry?.dispose()); }
    this.effects = [];
    const rng = mulberry32((this.regionSeed ^ Math.imul(f.index + 1, 0x9e3779b1)) >>> 0);
    this.ore = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.4 + rng() * 0.8, 0), MAT.ore);
      m.position.set((rng() - 0.5) * 3.5, (rng() - 0.6) * 2, (rng() - 0.5) * 3);
      m.scale.y = 1.4 + rng();
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      this.ore.add(m);
    }
    this.ore.position.set(this.tunnels[f.ore].x, 1.4, BACK - 4.5); // just inside the arch so it shows through
    this.ore.visible = false;
    this.forkProps.add(this.ore);
    this.oreLight.intensity = 0;
    this.oreLight.position.set(this.tunnels[f.ore].x, 3, BACK - 2);
    this.pulse.intensity = 0;
    this.shakeUntil = 0;
    this.labels.forEach((l) => { l.material.opacity = 0.7; });
    Object.values(this.lanterns).forEach((l) => { l.visible = false; });
    this.walk = null;
    this.miner.position.copy(this.home);
    this.miner.rotation.set(0, 0, 0);
    this.goalPos.set(0, 6.5, 16);
    this.goalLook.set(0, 3.5, -10);
    this.lampAim = new THREE.Vector3(0, 2, BACK);
  }

  // the headlamp always points where the rookie is about to go
  aim(t) { this.lampAim = this.inside(t); }

  // a point a few meters down the tunnel so the beam goes in, not onto the pillar beside it
  inside(t) { return new THREE.Vector3(this.tunnels[t].x, 2, BACK - 5); }

  // light up the pile of rubble so you can see the tunnel is blocked. also lands any rock still in the air
  inspect(t) {
    this.lampAim = new THREE.Vector3(this.tunnels[t].x, 1.6, BACK + 1); // the rubble pile
    this.goalLook.set(this.tunnels[t].x * 0.12, 3, -10);
    this.settle();
  }

  settle() {
    for (const e of [...this.effects]) if (e.kind === 'fuse' && !e.done) { e.done = true; this.explode(e.t0, e.ring, e.tnt); }
    for (const e of this.effects) if (e.kind === 'fall') e.group.children.forEach((m) => { m.visible = true; m.position.copy(m.userData.rest); });
    this.effects = this.effects.filter((e) => e.kind !== 'fall');
  }

  pick(t) {
    this.lampAim = this.inside(t);
    this.goalLook.set(this.tunnels[t].x * 0.12, 3.5, -10); // a small nod, not a swing
    this.labels.forEach((l, i) => { l.material.opacity = i === t ? 1 : 0.5; });
  }

  // someone lights dynamite at the mouth of tunnel t. the fuse burns, then boom
  blast(t, ring) {
    const tn = this.tunnels[t];
    const tnt = new THREE.Group();
    for (const [x, z] of [[-0.28, 0], [0.28, 0], [0, 0.3]]) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 8), MAT.tnt);
      stick.position.set(x, 0.65, z);
      tnt.add(stick);
    }
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4), MAT.fuse);
    fuse.position.set(0, 1.6, 0.1); fuse.rotation.z = 0.4;
    const spark = glow(0xffd27a, 1.2);
    spark.position.set(-0.15, 2, 0.1);
    tnt.add(fuse, spark);
    tnt.position.set(tn.x, 0, BACK + 1.6);
    this.forkProps.add(tnt);
    this.effects.push({ kind: 'fuse', start: performance.now(), tnt, spark, t0: t, ring });
  }

  explode(t, ring, tnt) {
    const tn = this.tunnels[t];
    this.forkProps.remove(tnt);
    const now = performance.now();
    const rubble = new THREE.Group();
    const rng = mulberry32(t * 7919 + 13);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + rng() * 1.1, 0), MAT.rubble);
      m.userData.rest = new THREE.Vector3(tn.x + (rng() - 0.5) * 4.2, 0.3 + rng() * 4.2, BACK + 0.4 + rng() * 1.2); // piled in the mouth
      m.position.copy(m.userData.rest).add(new THREE.Vector3(0, 5, 0));
      m.visible = false;
      m.userData.delay = 0.05 + rng() * 0.35;
      rubble.add(m);
    }
    this.forkProps.add(rubble);
    this.effects.push({ kind: 'fall', group: rubble, start: now });
    this.pulse.color.setHex(0xffa040);
    this.pulse.position.copy(tn.mouth).add(new THREE.Vector3(0, 0, 2.5));
    this.effects.push({ kind: 'pulse', start: now, peak: 14 });
    const burst = makeBurst(tn.mouth);
    this.forkProps.add(burst.points);
    this.effects.push({ kind: 'burst', start: now, burst });
    const flash = glow(0xffc070, 16);
    flash.position.copy(tn.mouth).add(new THREE.Vector3(0, 0.5, 1));
    this.forkProps.add(flash);
    this.effects.push({ kind: 'flash', start: now, flash });
    this.shakeUntil = now + 600;
    this.labels[t].material.opacity = 0.2;
    if (ring) { this.ore.visible = true; this.effects.push({ kind: 'ore', start: now, bury: true }); }
  }

  showCalls(calls, f) {
    const count = {};
    for (const name of Object.keys(MINER_COLORS)) {
      const c = calls[name], l = this.lanterns[name];
      if (!c) { l.visible = false; continue; }
      const t = c.action === 'switch' ? f.target : f.pick;
      const slot = (count[t] = (count[t] || 0) + 1) - 1;
      l.position.copy(this.tunnels[t].mouth).add(new THREE.Vector3((slot - 1) * 1.4, 1.8 + (slot % 2) * 0.8, 1.6));
      l.visible = true;
    }
  }

  reveal(f) {
    if (f.ring) return;
    this.ore.visible = true;
    this.ore.scale.setScalar(1);
    this.oreLight.intensity = 4;
    this.effects.push({ kind: 'shine', start: performance.now() });
  }

  // camera moves in on the miner for the between-parts recap
  closeUp(on) {
    this.close = on;
    if (on) { this.goalPos.set(2.6, 4.6, this.home.z - 3.4); this.goalLook.set(0, 3.7, this.home.z); }
    else { this.goalPos.set(0, 6.5, 16); this.goalLook.set(0, 3.5, -10); }
  }

  advance(t) {
    this.walk = { tn: this.tunnels[t], t: 0 };
    this.goalLook.set(this.tunnels[t].deep.x * 0.3, 3, this.tunnels[t].deep.z);
  }

  stopWalk() { this.walk = null; }

  tick() {
    if (!this.tunnels) return;
    const dt = Math.min(0.05, this.clock.getDelta()), time = this.clock.elapsedTime;
    if (this.walk) {
      this.walk.t = Math.min(1, this.walk.t + dt * 0.35);
      const target = this.home.clone().lerp(new THREE.Vector3(this.walk.tn.x, 0, BACK + 1), this.walk.t);
      this.miner.position.lerp(target, 0.1);
      this.miner.lookAt(this.walk.tn.x, 0, BACK - 10);
      this.miner.rotateY(Math.PI);
      this.goalPos.set(this.miner.position.x * 0.2, 6.2, Math.max(BACK + 11, this.miner.position.z + 10));
    }
    this.miner.children[0].position.y = Math.sin(time * (this.walk ? 9 : 1.6)) * (this.walk ? 0.1 : 0.04);
    this.camPos.lerp(this.goalPos, 0.05);
    this.camLook.lerp(this.goalLook, 0.05);
    const shake = this.shakeUntil > performance.now() ? (this.shakeUntil - performance.now()) / 600 : 0;
    this.camera.position.set(this.camPos.x + Math.sin(time * 0.4) * 0.1 + (Math.random() - 0.5) * shake * 0.8,
      this.camPos.y + Math.sin(time * 0.31) * 0.08 + (Math.random() - 0.5) * shake * 0.6, this.camPos.z);
    this.camera.lookAt(this.camLook);

    const head = this.miner.userData.lamp.getWorldPosition(new THREE.Vector3());
    this.lamp.position.copy(head);
    this.lamp.target.position.lerp(this.lampAim, 0.14);
    if (!this.walk) { // turn to face where the lamp is going
      const want = Math.atan2(-(this.lampAim.x - this.miner.position.x), -(this.lampAim.z - this.miner.position.z));
      this.miner.rotation.y += (want - this.miner.rotation.y) * 0.12;
    }
    this.lamp.intensity = 3.2 * (0.96 + 0.04 * Math.sin(time * 23) * Math.sin(time * 7));
    this.beam.position.copy(head);
    this.beam.lookAt(this.lamp.target.position);

    for (const e of [...this.effects]) {
      e.t = (performance.now() - e.start) / 1000; // real clock so slow frames dont stall an effect
      if (e.kind === 'fuse') {
        e.spark.scale.setScalar(0.8 + Math.random() * 0.9);
        e.spark.position.y = 2 - e.t * 0.35;
        if (e.t > 0.9 && !e.done) { e.done = true; this.explode(e.t0, e.ring, e.tnt); }
      } else if (e.kind === 'burst') {
        stepBurst(e.burst, e.t);
      } else if (e.kind === 'flash') {
        const k = Math.max(0, 1 - e.t / 0.45);
        e.flash.material.opacity = k; e.flash.scale.setScalar(10 + 14 * (1 - k));
      } else if (e.kind === 'fall') {
        e.group.children.forEach((m) => {
          const k = Math.max(0, Math.min(1, (e.t - m.userData.delay) / 0.4));
          m.visible = e.t >= m.userData.delay;
          m.position.y = m.userData.rest.y + (1 - k * k) * 5;
          m.rotation.x += dt * (1 - k) * 4;
        });
      } else if (e.kind === 'pulse') {
        this.pulse.intensity = e.peak * Math.max(0, 1 - e.t / 0.9);
      } else if (e.kind === 'shine') {
        this.ore.rotation.y += dt * 0.5;
        this.oreLight.intensity = 3.4 + 0.8 * Math.sin(time * 5);
      } else if (e.kind === 'ore') {
        const s = e.bury ? Math.max(0.01, 1 - e.t / 1.4) : Math.min(1, e.t / 0.6);
        this.ore.scale.setScalar(s);
        this.ore.rotation.y += dt * 0.4;
        this.oreLight.intensity = 3 * s;
      }
    }
    stepPoints(this.drips, this.weather.drip, (p, i) => { p.y -= dt * (9 + (i % 5)); if (p.y < 0) p.y = H - 0.5; });
    stepPoints(this.dust, 1, (p, i) => { p.x += dt * this.weather.wind * (1 + (i % 3)); p.y += Math.sin(time + i) * dt * 0.3; if (p.x > W / 2 - 1) p.x = -W / 2 + 1; });
    for (const l of Object.values(this.lanterns)) if (l.visible) l.children[0].position.y = Math.sin(time * 2 + l.position.x) * 0.2;
    this.renderer.render(this.scene, this.camera);
  }
}

function makeBurst(at) {
  const n = 90, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos.set([at.x, at.y, at.z + 1], i * 3);
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 10 + 2, Math.random() * 9));
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb060, size: 0.35, transparent: true, depthWrite: false }));
  return { points, vel, at: at.clone().add(new THREE.Vector3(0, 0, 1)) };
}

function stepBurst(b, t) {
  const a = b.points.geometry.attributes.position;
  b.vel.forEach((v, i) => a.setXYZ(i, b.at.x + v.x * t, Math.max(0.1, b.at.y + v.y * t - 9 * t * t), b.at.z + v.z * t));
  a.needsUpdate = true;
  b.points.material.opacity = Math.max(0, 1 - t / 1.4);
  b.points.material.color.setHSL(0.08, 1, Math.max(0.25, 0.65 - t * 0.3));
}

function roughen(geo, noise, amp) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x + amp * noise(x * 0.3, y * 0.3, z * 0.3 + 7), y + amp * noise(x * 0.3 + 3, y * 0.3, z * 0.3), z + amp * noise(x * 0.3, y * 0.3 + 5, z * 0.3));
  }
  geo.computeVertexNormals();
}

function makePoints(n, color, size) {
  const g = new THREE.BufferGeometry();
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * (W - 2); a[i * 3 + 1] = Math.random() * H; a[i * 3 + 2] = BACK + 1 + Math.random() * (FRONT - BACK - 4); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  return { points: new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.7, depthWrite: false })), n };
}

function stepPoints(sys, share, fn) {
  const a = sys.points.geometry.attributes.position;
  const active = Math.floor(sys.n * share);
  sys.points.geometry.setDrawRange(0, active);
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < active; i++) {
    p.x = a.getX(i); p.y = a.getY(i); p.z = a.getZ(i);
    fn(p, i);
    a.setXYZ(i, p.x, p.y, p.z);
  }
  a.needsUpdate = true;
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.font = '64px "Press Start 2P", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 10;
  g.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  s.scale.set(3.6, 1.8, 1);
  return s;
}

// low poly miner from primitives. carbide lamp on the helmet
function buildMiner() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9, ...extra });
  const denim = mat(0x3c4a63), shirt = mat(0x9a5b3a), skin = mat(0xd2a07c), beard = mat(0x5a3b26), boot = mat(0x2a1f17),
    leather = mat(0x5b3a22), helmet = mat(0xc9a23c, { roughness: 0.5, metalness: 0.2 }), wood = mat(0x7a5532), iron = mat(0x7d8288, { metalness: 0.5, roughness: 0.45 });
  const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  for (const sx of [-0.36, 0.36]) {
    add(new THREE.BoxGeometry(0.5, 0.42, 0.78), boot, sx, 0.21, -0.08);
    add(new THREE.CylinderGeometry(0.25, 0.23, 1.35, 7), denim, sx, 1.08, 0);
  }
  add(new THREE.CylinderGeometry(0.68, 0.6, 0.6, 8), denim, 0, 1.95, 0);
  add(new THREE.CylinderGeometry(0.72, 0.68, 1.15, 8), shirt, 0, 2.75, 0);
  add(new THREE.CylinderGeometry(0.7, 0.7, 0.16, 8), leather, 0, 2.2, 0);
  for (const sx of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.12, 1.1, 0.06), leather, sx, 2.7, -0.69);
  const arm = (sx, rot) => {
    const g = new THREE.Group(); g.position.set(sx, 3.2, 0); body.add(g);
    add(new THREE.CylinderGeometry(0.2, 0.17, 1.2, 6), shirt, 0, -0.55, 0, g);
    add(new THREE.IcosahedronGeometry(0.19, 0), skin, 0, -1.2, 0, g);
    g.rotation.set(...rot);
    return g;
  };
  arm(-0.86, [0, 0, 0.12]);
  const armR = arm(0.86, [-0.9, 0, -0.15]);
  add(new THREE.IcosahedronGeometry(0.55, 1), skin, 0, 3.86, 0);
  add(new THREE.IcosahedronGeometry(0.42, 0), beard, 0, 3.6, -0.3).scale.set(1.1, 0.9, 0.7);
  add(new THREE.SphereGeometry(0.66, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), helmet, 0, 4.1, 0);
  add(new THREE.CylinderGeometry(0.88, 0.88, 0.07, 14), helmet, 0, 4.12, 0);
  const lamp = add(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }), 0, 4.36, -0.7);
  // pickaxe slung across his back, head up over the right shoulder so it reads from behind
  const steel = mat(0xdfe4ea, { metalness: 0.3, roughness: 0.4, emissive: 0x2a2d31 }), handleWood = mat(0xa8743f);
  const pick = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.4, 8), handleWood);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), steel);
  collar.position.y = 1.62;
  pick.add(handle, collar);
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 6), steel);
    blade.rotation.z = side * -(Math.PI / 2 - 0.28); // tips droop a little, the classic curve
    blade.position.set(side * 0.82, 1.5, 0);
    pick.add(blade);
  }
  pick.position.set(0.25, 2.9, 0.62);
  pick.rotation.set(0, 0, -0.62);
  body.add(pick);
  armR.rotation.set(-0.2, 0, -0.55); // hand up on the handle
  root.userData.lamp = lamp;
  return root;
}
