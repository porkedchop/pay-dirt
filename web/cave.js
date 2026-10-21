// the cave you watch. three.js marching cubes carve a chamber + three tunnels out of a metaball field
// geometry comes from the region seed so a replay looks the same. weather drives drips fog draft warmth

import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from './sim.js';

const S = 30; // half size of the field in world units
const RES = 56;
const ISO = 80, SUB = 12;
const w = (n) => S * (2 * n - 1); // field coords 0..1 -> world

const STRATA_COLORS = [
  [0.62, 0.47, 0.44], // granite
  [0.36, 0.40, 0.45], // killas
  [0.72, 0.68, 0.58], // elvan
  [0.26, 0.36, 0.30], // greenstone
];

export const MINER_COLORS = { Oracle: 0x199e70, Apprentice: 0x3987e5, Parrot: 0xd95926, You: 0xd55181 };

const CHAMBER = { x: 0.5, y: 0.44, z: 0.68 };
const TUNNEL_END = [
  { x: 0.2, y: 0.4, z: 0.14 },
  { x: 0.5, y: 0.37, z: 0.1 },
  { x: 0.8, y: 0.4, z: 0.14 },
];

function strengthFor(r) { return r * r * (ISO + SUB); }

export class Cave {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0908);
    this.scene.fog = new THREE.FogExp2(0x0b0908, 0.02);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    this.clock = new THREE.Clock();

    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.02, side: THREE.BackSide });
    this.mc = new MarchingCubes(RES, this.rockMat, false, true, 90000);
    this.mc.isolation = ISO;
    this.mc.scale.setScalar(S);
    this.scene.add(this.mc);

    this.scene.add(new THREE.HemisphereLight(0x8a7a64, 0x141009, 0.7));
    this.lamp = new THREE.SpotLight(0xffd9a0, 4.2, 120, 0.5, 0.55, 0);
    this.lampTarget = new THREE.Object3D();
    this.lamp.target = this.lampTarget;
    this.scene.add(this.lamp, this.lampTarget);
    this.fill = new THREE.PointLight(0xffb070, 0.9, 30, 0);
    this.scene.add(this.fill);

    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.miner = buildMiner();
    this.scene.add(this.miner);
    this.lanterns = {};
    for (const [name, color] of Object.entries(MINER_COLORS)) {
      const g = new THREE.Group();
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color }));
      const light = new THREE.PointLight(color, 2.2, 14, 0);
      g.add(orb, light);
      g.visible = false;
      this.scene.add(g);
      this.lanterns[name] = g;
    }
    this.drips = makePoints(400, 0x9fb4c4, 0.18);
    this.dust = makePoints(300, 0xb8a48a, 0.12);
    this.scene.add(this.drips.points, this.dust.points);

    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.goalPos = new THREE.Vector3();
    this.goalLook = new THREE.Vector3();
    this.effects = [];
    this.weather = { drip: 0.2, fog: 0.02, wind: 0.3, warmth: 0 };
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const wpx = c.clientWidth || 800, hpx = c.clientHeight || 500;
    this.renderer.setSize(wpx, hpx, false);
    this.camera.aspect = wpx / hpx;
    this.camera.updateProjectionMatrix();
  }

  setWeather(wx) {
    if (!wx) return;
    this.weather = {
      drip: Math.min(1, 0.15 + wx.precipitation * 0.6 + (wx.relative_humidity_2m - 50) / 200),
      fog: 0.012 + Math.max(0, wx.relative_humidity_2m - 20) / 4000,
      wind: Math.min(1.5, wx.wind_speed_10m / 25),
      warmth: Math.max(-1, Math.min(1, (wx.temperature_2m - 10) / 15)),
      roomy: Math.max(0.85, Math.min(1.15, wx.surface_pressure / 900)),
    };
    this.scene.fog.density = this.weather.fog;
  }

  // a fresh fork. carve chamber + tunnels + pockets, seed the props
  build(fork, region) {
    const rng = mulberry32((region.seed ^ Math.imul(fork.index + 1, 0x9e3779b1)) >>> 0);
    const noise = createNoise3D(rng);
    const base = STRATA_COLORS[region.strata];
    const warm = this.weather.warmth;
    const tint = (n) => {
      const band = 0.5 + 0.5 * noise(n.x * 3, n.y * 14, n.z * 3);
      const k = 0.65 + 0.5 * band;
      return new THREE.Color(
        Math.min(1, base[0] * k * (1 + 0.12 * warm)),
        Math.min(1, base[1] * k),
        Math.min(1, base[2] * k * (1 - 0.12 * warm)),
      );
    };
    const roomy = this.weather.roomy ?? 1;
    const mc = this.mc;
    mc.reset();
    const ball = (p, r, color) => mc.addBall(p.x, p.y, p.z, strengthFor(r), SUB, color || tint(p));

    for (let i = 0; i < 9; i++) {
      const p = { x: CHAMBER.x + (rng() - 0.5) * 0.18, y: CHAMBER.y + (rng() - 0.5) * 0.08, z: CHAMBER.z + (rng() - 0.5) * 0.14 };
      ball(p, (0.085 + rng() * 0.03) * roomy);
    }
    this.tunnels = TUNNEL_END.map((end, t) => {
      const start = new THREE.Vector3(CHAMBER.x + (t - 1) * 0.08, CHAMBER.y - 0.02, CHAMBER.z - 0.1);
      const mid = new THREE.Vector3((start.x + end.x) / 2 + (rng() - 0.5) * 0.12, (start.y + end.y) / 2 + (rng() - 0.5) * 0.06, (start.z + end.z) / 2);
      const stop = new THREE.Vector3(end.x + (rng() - 0.5) * 0.05, end.y + (rng() - 0.5) * 0.04, end.z);
      const curve = new THREE.CatmullRomCurve3([start, mid, stop]);
      const steps = 34;
      for (let i = 0; i <= steps; i++) {
        const p = curve.getPoint(i / steps);
        const r = 0.04 + 0.012 * noise(p.x * 9, p.y * 9, p.z * 9 + t);
        ball(p, r);
      }
      const pocket = stop.clone();
      ball(pocket, 0.06 + rng() * 0.02);
      for (let i = 0; i < 3; i++) ball({ x: pocket.x + (rng() - 0.5) * 0.06, y: pocket.y + (rng() - 0.5) * 0.04, z: pocket.z + (rng() - 0.5) * 0.05 }, 0.035);
      const toWorld = (v) => new THREE.Vector3(w(v.x), w(v.y), w(v.z));
      return { curve, mouth: toWorld(curve.getPoint(0.28)), deep: toWorld(curve.getPoint(0.8)), pocket: toWorld(pocket) };
    });
    mc.update();

    this.clearDynamic();
    this.tunnels.forEach((tn, t) => {
      const label = makeLabel(['I', 'II', 'III'][t]);
      label.position.copy(tn.mouth).add(new THREE.Vector3(0, 2.6, 0));
      this.dynamic.add(label);
      tn.label = label;
    });
    const seam = this.tunnels[fork.seam];
    seam.ore = buildOre(rng, seam.pocket);
    seam.ore.visible = false;
    this.dynamic.add(seam.ore);

    const floor = new THREE.Vector3(w(CHAMBER.x), w(CHAMBER.y) - 4.5, w(CHAMBER.z) + 3);
    this.floor = floor;
    this.miner.position.copy(floor);
    this.miner.rotation.set(0, 0, 0);
    Object.values(this.lanterns).forEach((l) => { l.visible = false; });
    this.goalPos.set(floor.x, floor.y + 4.5, floor.z + 9);
    this.goalLook.set(floor.x, floor.y + 2, floor.z - 14);
    this.camPos.copy(this.goalPos).add(new THREE.Vector3(0, 1.5, 6));
    this.camLook.copy(this.goalLook);
    this.aimLamp(new THREE.Vector3(floor.x, floor.y, floor.z - 20));
    this.spreadParticles(floor);
  }

  clearDynamic() {
    for (const c of [...this.dynamic.children]) {
      this.dynamic.remove(c);
      c.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    }
    this.effects = [];
  }

  aimLamp(v) { this.lampAim = v.clone(); }

  pick(t) {
    this.aimLamp(this.tunnels[t].mouth);
    this.goalLook.copy(this.tunnels[t].mouth);
    this.tunnels.forEach((tn, i) => tn.label.material.opacity = i === t ? 1 : 0.55);
  }

  knock(t, ring) {
    const tn = this.tunnels[t];
    const rubble = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4038, flatShading: true, roughness: 1 });
    const rng = mulberry32(t * 7919 + 13);
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + rng() * 1.1, 0), mat);
      m.userData.rest = tn.mouth.clone().add(new THREE.Vector3((rng() - 0.5) * 5, (rng() - 0.6) * 4, (rng() - 0.5) * 2));
      m.position.copy(m.userData.rest).add(new THREE.Vector3(0, 9 + rng() * 5, 0));
      m.userData.delay = rng() * 0.5;
      rubble.add(m);
    }
    this.dynamic.add(rubble);
    this.effects.push({ kind: 'fall', group: rubble, t: 0 });
    const pulse = new THREE.PointLight(ring ? 0xffd27a : 0xc7b39a, 0, 18, 0);
    pulse.position.copy(tn.mouth);
    this.dynamic.add(pulse);
    this.effects.push({ kind: 'pulse', light: pulse, t: 0, peak: ring ? 6 : 3 });
    tn.label.material.opacity = 0.25;
    if (ring) {
      const ore = this.tunnels[t].ore;
      if (ore) { ore.visible = true; this.effects.push({ kind: 'ore', group: ore, t: 0, bury: true }); }
    }
  }

  showCalls(calls, f) {
    const order = ['Oracle', 'Apprentice', 'Parrot', 'You'];
    const byTunnel = {};
    for (const name of order) {
      const c = calls[name];
      const l = this.lanterns[name];
      if (!c) { l.visible = false; continue; }
      const t = c.action === 'switch' ? f.target : f.pick;
      byTunnel[t] = (byTunnel[t] || 0) + 1;
      const slot = byTunnel[t] - 1;
      l.position.copy(this.tunnels[t].mouth).add(new THREE.Vector3((slot - 1.5) * 1.5, 0.4 + (slot % 2) * 0.9, 1.5));
      l.visible = true;
    }
  }

  reveal(f) {
    const seam = this.tunnels[f.seam];
    if (seam.ore && !f.ring) {
      seam.ore.visible = true;
      this.effects.push({ kind: 'ore', group: seam.ore, t: 0 });
      this.aimLamp(seam.pocket);
    }
  }

  // walk the apprentice into its tunnel
  advance(t) {
    const tn = this.tunnels[t];
    this.walk = { curve: tn, t: 0 };
    this.goalLook.copy(tn.deep);
  }

  spreadParticles(c) {
    for (const sys of [this.drips, this.dust]) {
      const a = sys.points.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, c.x + (Math.random() - 0.5) * 34, c.y + Math.random() * 16, c.z - Math.random() * 34 + 8);
      a.needsUpdate = true;
    }
  }

  tick() {
    if (!this.floor) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    if (this.walk) {
      this.walk.t = Math.min(1, this.walk.t + dt * 0.45);
      const k = this.walk.t;
      const target = this.floor.clone().lerp(this.walk.curve.deep, k * 0.8);
      this.miner.position.lerp(target, 0.08);
      this.miner.lookAt(this.walk.curve.deep.x, this.miner.position.y, this.walk.curve.deep.z);
      this.miner.rotateY(Math.PI);
      this.goalPos.copy(this.miner.position).add(new THREE.Vector3(0, 5, 9));
    }
    const bob = Math.sin(time * (this.walk ? 9 : 1.6)) * (this.walk ? 0.12 : 0.04);
    this.miner.children[0].position.y = bob;
    this.camPos.lerp(this.goalPos, 0.04);
    this.camLook.lerp(this.goalLook, 0.05);
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(Math.sin(time * 0.4) * 0.3, Math.sin(time * 0.31) * 0.2, 0));
    this.camera.lookAt(this.camLook);

    const head = this.miner.userData.lamp.getWorldPosition(new THREE.Vector3());
    this.lamp.position.copy(head);
    if (this.lampAim) this.lampTarget.position.lerp(this.lampAim, 0.08);
    this.lamp.intensity = 4.2 * (0.96 + 0.04 * Math.sin(time * 23) * Math.sin(time * 7));
    this.fill.position.copy(head).add(new THREE.Vector3(0, 2, 3));

    for (const e of this.effects) {
      e.t += dt;
      if (e.kind === 'fall') {
        e.group.children.forEach((m) => {
          const k = Math.max(0, Math.min(1, (e.t - m.userData.delay) / 0.5));
          m.position.y = m.userData.rest.y + (1 - k * k) * 10;
          m.rotation.x += dt * (1 - k) * 4;
        });
      } else if (e.kind === 'pulse') {
        e.light.intensity = e.peak * Math.max(0, 1 - e.t / 1.2) * (0.6 + 0.4 * Math.sin(e.t * 30));
      } else if (e.kind === 'ore') {
        const s = e.bury ? Math.max(0.01, 1 - e.t / 1.4) : Math.min(1, e.t / 0.6);
        e.group.scale.setScalar(s);
        e.group.rotation.y += dt * 0.4;
        e.group.children.forEach((c) => { if (c.isPointLight) c.intensity = 3 * s * (0.8 + 0.2 * Math.sin(time * 5)); });
      }
    }
    stepParticles(this.drips, dt, (p, i) => {
      p.y -= dt * (9 + (i % 5));
      if (p.y < this.floor.y - 2) { p.y = this.floor.y + 12 + Math.random() * 4; }
    }, this.weather.drip);
    stepParticles(this.dust, dt, (p, i) => {
      p.x += dt * this.weather.wind * (1.5 + (i % 3));
      p.y += Math.sin(time + i) * dt * 0.3;
      if (p.x > this.floor.x + 18) p.x = this.floor.x - 18;
    }, 1);
    for (const l of Object.values(this.lanterns)) if (l.visible) l.children[0].position.y = Math.sin(time * 2 + l.position.x) * 0.25;
    this.renderer.render(this.scene, this.camera);
  }

  stopWalk() { this.walk = null; }
}

function makePoints(n, color, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.7, depthWrite: false });
  return { points: new THREE.Points(g, m), n };
}

function stepParticles(sys, dt, fn, share) {
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
  g.font = '600 84px "IM Fell English SC", Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(236,224,200,0.95)';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 12;
  g.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  s.scale.set(4, 2, 1);
  return s;
}

function buildOre(rng, at) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe7b84f, emissive: 0x8a5a10, emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.25, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 + rng() * 0.9, 0), mat);
    m.position.set((rng() - 0.5) * 4, (rng() - 0.5) * 2.5, (rng() - 0.5) * 3);
    m.scale.y = 1.4 + rng();
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(m);
  }
  const light = new THREE.PointLight(0xffc860, 3, 22, 0);
  g.add(light);
  g.position.copy(at);
  return g;
}

// low poly miner from primitives. carbide lamp on the helmet
function buildMiner() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
  const cloth = mat(0x51463b), skin = mat(0xc89c7c), helmet = mat(0x8c7a3c), wood = mat(0x6b4b2a), iron = mat(0x6f7378);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); body.add(o); return o; };
  add(new THREE.BoxGeometry(0.55, 1.6, 0.6), cloth, -0.35, 0.8, 0);
  add(new THREE.BoxGeometry(0.55, 1.6, 0.6), cloth, 0.35, 0.8, 0);
  add(new THREE.BoxGeometry(1.5, 1.7, 0.9), cloth, 0, 2.45, 0);
  add(new THREE.BoxGeometry(0.4, 1.4, 0.45), cloth, -0.98, 2.4, 0).rotation.z = 0.15;
  add(new THREE.BoxGeometry(0.4, 1.4, 0.45), cloth, 0.98, 2.5, -0.2).rotation.x = -0.6;
  add(new THREE.IcosahedronGeometry(0.55, 1), skin, 0, 3.7, 0);
  add(new THREE.CylinderGeometry(0.62, 0.66, 0.42, 10), helmet, 0, 4.12, 0);
  add(new THREE.CylinderGeometry(0.85, 0.85, 0.07, 12), helmet, 0, 3.93, 0);
  const lamp = add(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }), 0, 4.15, -0.62);
  const pick = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), wood);
  const headM = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.18), iron);
  headM.position.y = 1.25;
  pick.add(handle, headM);
  pick.position.set(1.1, 2.6, -0.6);
  pick.rotation.set(-0.5, 0, -0.3);
  body.add(pick);
  root.userData.lamp = lamp;
  return root;
}
