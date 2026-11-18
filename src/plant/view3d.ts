/**
 * Vista 3D del transportador (three.js).
 *
 * Transportador de doble cadena sobre perfiles de aluminio con patas, módulos
 * de curva con rueda dentada, motorreductor, paletas con utillaje, topes
 * neumáticos que suben y bajan y sensores inductivos con LED. Cada elemento
 * lleva su nombre.
 *
 * Unidades: metros. X a lo largo del transportador (centrado), Z hacia el
 * observador (la recta de abajo del plano queda delante), Y hacia arriba.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ConveyorLayout, Signal } from '../types';
import type { Plant } from './engine';
import { PRESENCE_BEFORE_STOP, loopLength, pointAt, sensorS, stopS } from './layout';

export interface PlantView {
  el: HTMLElement;
  update(plant: Plant): void;
  dispose(): void;
  setLabels(on: boolean): void;
  setCamera(preset: CameraPreset): void;
}

export type CameraPreset = 'general' | 'planta' | 'frontal';

const H = 0.85; // altura de la superficie de las cadenas
const PITCH = 0.05; // paso del dibujo de la cadena (2 eslabones)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Devuelve null si el navegador no puede dibujar WebGL. */
export function createView3d(layout: ConveyorLayout, signals: Signal[], opts: { labels: boolean }): PlantView | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const desc = new Map(signals.map((s) => [s.name, s]));

  // ---- Contenedor ----------------------------------------------------------
  const el = document.createElement('div');
  el.className = 'plant3d';
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'plant3d__labels';
  el.appendChild(labelRenderer.domElement);
  if (!opts.labels) el.classList.add('no-labels');

  // ---- Escena --------------------------------------------------------------
  const css = getComputedStyle(document.documentElement);
  const bg = new THREE.Color(css.getPropertyValue('--surface-2').trim() || '#eef2f4');
  const dark = bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.4;
  const scene = new THREE.Scene();
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 18, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const S = layout.length / 1000;
  const R = layout.radius / 1000;
  const Lmm = loopLength(layout);
  const span = S + 2 * R;
  const w = Math.min(Math.max((layout.palletLength / 1000) * 0.8, 0.2), R * 1.4); // ancho de vía (entre cadenas)
  const pw = w + 0.05; // ancho de paleta
  const plen = layout.palletLength / 1000;

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202830 : 0x6f767c, dark ? 0.5 : 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.6 : 2.1);
  sun.position.set(-span * 0.35, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -span / 2 - 3;
  sc.right = span / 2 + 3;
  sc.top = 2 * R + 4;
  sc.bottom = -2 * R - 4;
  sc.near = 1;
  sc.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 0.8;
  controls.maxDistance = span * 4 + 10;
  controls.target.set(0, 0.6, 0);

  // ---- Materiales -----------------------------------------------------------
  const mats: THREE.Material[] = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(p);
    mats.push(m);
    return m;
  };
  const alu = mat({ color: 0xc8cdd2, metalness: 0.8, roughness: 0.32 });
  const aluDark = mat({ color: 0x8e959c, metalness: 0.75, roughness: 0.4 });
  const slot = mat({ color: 0x3a3f44, metalness: 0.4, roughness: 0.7 });
  const steel = mat({ color: 0x7d868e, metalness: 0.7, roughness: 0.38 });
  const darkSteel = mat({ color: 0x3b4148, metalness: 0.6, roughness: 0.5 });
  const black = mat({ color: 0x1d2125, metalness: 0.2, roughness: 0.75 });
  const guide = mat({ color: 0xe8e3d6, metalness: 0, roughness: 0.6 }); // guía de plástico
  const cylDark = mat({ color: 0x2e3338, metalness: 0.5, roughness: 0.5 });
  const fixtureBlue = mat({ color: 0x2f5f8a, metalness: 0.55, roughness: 0.35 });
  const motorBlue = mat({ color: 0x35536f, metalness: 0.45, roughness: 0.45 });
  const floorMat = mat({ color: dark ? 0x232b33 : 0xb9c0c6, metalness: 0, roughness: 0.92 });
  const yellow = mat({ color: 0xf2c200, metalness: 0, roughness: 0.6 });

  const chainTex = chainTexture();
  chainTex.wrapS = THREE.RepeatWrapping;
  chainTex.wrapT = THREE.ClampToEdgeWrapping;
  chainTex.colorSpace = THREE.SRGBColorSpace;
  const chainMat = mat({ map: chainTex, metalness: 0.7, roughness: 0.42 });

  const box = (x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const cyl = (r: number, h: number, m: THREE.Material, seg = 24) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const led = (r: number) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000, roughness: 0.3 });
    mats.push(m);
    return new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), m);
  };
  const setLed = (mesh: THREE.Mesh, color: number | null) => {
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (color === null) {
      m.color.setHex(0x3a3a3a);
      m.emissive.setHex(0x000000);
    } else {
      m.color.setHex(color);
      m.emissive.setHex(color);
      m.emissiveIntensity = 1.6;
    }
  };

  // ---- Geometría del lazo --------------------------------------------------
  interface Sample {
    x: number;
    z: number;
    nx: number;
    nz: number;
    s: number;
  }
  const at = (smm: number) => {
    const p = pointAt(layout, smm);
    const cx = Math.max(0, Math.min(layout.length, p.x));
    let nx = p.x - cx;
    let nz = p.y;
    const m = Math.hypot(nx, nz) || 1;
    nx /= m;
    nz /= m;
    return { x: p.x / 1000 - S / 2, z: p.y / 1000, h: p.heading, nx, nz, line: p.line };
  };
  const N = Math.max(80, Math.ceil(Lmm / 20));
  const samples: Sample[] = [];
  for (let i = 0; i <= N; i++) {
    const smm = (i / N) * Lmm;
    const p = at(i === N ? 0 : smm);
    samples.push({ x: p.x, z: p.z, nx: p.nx, nz: p.nz, s: smm / 1000 });
  }

  /** Cinta que barre el segmento (dA,yA)–(dB,yB) a lo largo del lazo; d = desplazamiento hacia fuera. */
  const ribbon = (dA: number, yA: number, dB: number, yB: number, m: THREE.Material, uScale = 0) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    samples.forEach((p, i) => {
      pos.push(p.x + p.nx * dA, yA, p.z + p.nz * dA, p.x + p.nx * dB, yB, p.z + p.nz * dB);
      const u = uScale ? p.s / uScale : 0;
      uv.push(u, 0, u, 1);
      if (i < samples.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    if (m instanceof THREE.MeshStandardMaterial) m.side = THREE.DoubleSide;
    return mesh;
  };

  const conveyor = new THREE.Group();
  scene.add(conveyor);
  const railTop = H - 0.012;
  const railBot = H - 0.1;
  [-1, 1].forEach((sg) => {
    const c = (sg * w) / 2;
    const hw = 0.022;
    // Perfil de aluminio con ranura en T.
    conveyor.add(ribbon(c - hw, railTop, c + hw, railTop, alu));
    conveyor.add(ribbon(c + hw, railBot, c + hw, railTop, alu));
    conveyor.add(ribbon(c - hw, railBot, c - hw, railTop, alu));
    conveyor.add(ribbon(c - hw, railBot, c + hw, railBot, aluDark));
    const so = sg > 0 ? c + hw + 0.0005 : c - hw - 0.0005;
    conveyor.add(ribbon(so, railBot + 0.03, so, railBot + 0.042, slot));
    conveyor.add(ribbon(so, railBot + 0.058, so, railBot + 0.07, slot));
    // Cadena sobre el perfil.
    conveyor.add(ribbon(c - 0.012, H, c + 0.012, H, chainMat, PITCH));
    conveyor.add(ribbon(c - 0.012, railTop, c - 0.012, H, darkSteel));
    conveyor.add(ribbon(c + 0.012, railTop, c + 0.012, H, darkSteel));
    // Guía lateral de plástico.
    const g = sg * (pw / 2 + 0.012);
    conveyor.add(ribbon(g, H + 0.004, g, H + 0.03, guide));
    conveyor.add(ribbon(sg * (pw / 2 + 0.012), H + 0.03, sg * (pw / 2 + 0.03), H + 0.03, guide));
    conveyor.add(ribbon(sg * (pw / 2 + 0.03), railTop, sg * (pw / 2 + 0.03), H + 0.03, aluDark));
  });

  // Patas, travesaños y pies.
  const leg = (x: number, z: number) => {
    const l = box(0.045, railBot, 0.045, alu);
    l.position.set(x, railBot / 2, z);
    const foot = box(0.11, 0.012, 0.11, darkSteel);
    foot.position.set(x, 0.006, z);
    conveyor.add(l, foot);
  };
  (['top', 'bottom'] as const).forEach((line) => {
    const z = line === 'bottom' ? R : -R;
    const n = Math.max(2, Math.ceil(S / 1.4) + 1);
    for (let i = 0; i < n; i++) {
      const x = -S / 2 + 0.12 + (i * (S - 0.24)) / (n - 1);
      leg(x, z + w / 2);
      leg(x, z - w / 2);
      const cross = box(0.04, 0.04, w, aluDark);
      cross.position.set(x, 0.22, z);
      const top = box(0.04, 0.04, w, aluDark);
      top.position.set(x, railBot - 0.02, z);
      conveyor.add(cross, top);
    }
  });

  // Módulos de curva: rueda dentada (gira con la cadena) y tapa.
  const wheels: THREE.Object3D[] = [];
  [-S / 2, S / 2].forEach((x) => {
    const wheel = new THREE.Group();
    const disc = cyl(R + w / 2 + 0.015, 0.018, darkSteel, 64);
    wheel.add(disc);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const mark = box(0.05, 0.022, 0.018, steel);
      mark.position.set(Math.cos(a) * R, 0.002, Math.sin(a) * R);
      mark.rotation.y = -a;
      wheel.add(mark);
    }
    wheel.position.set(x, railBot - 0.035, 0);
    wheels.push(wheel);
    conveyor.add(wheel);
    const cover = cyl(Math.max(0.05, R - w / 2 - 0.03), 0.012, alu, 64);
    cover.position.set(x, railTop - 0.004, 0);
    const column = box(0.08, railBot - 0.04, 0.08, alu);
    column.position.set(x, (railBot - 0.04) / 2, 0);
    conveyor.add(cover, column);
  });

  // ---- Suelo ---------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span + 30, 2 * R + 30), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(Math.ceil(span + 20), Math.ceil(span + 20), dark ? 0x34404b : 0xbcc3c9, dark ? 0x2a333c : 0xc7cdd2);
  grid.position.y = 0.001;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);
  // Línea amarilla de zona de seguridad.
  const mx = span / 2 + 0.6;
  const mz = R + w / 2 + 0.9;
  [
    [0, mz, 2 * mx, 0.06],
    [0, -mz, 2 * mx, 0.06],
    [mx, 0, 0.06, 2 * mz],
    [-mx, 0, 0.06, 2 * mz],
  ].forEach(([x, z, a, b]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(a, b), yellow);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, z);
    scene.add(m);
  });

  // ---- Etiquetas -------------------------------------------------------------
  const tag = (html: string, cls: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const div = document.createElement('div');
    div.className = `tag3d ${cls}`;
    div.innerHTML = html;
    const o = new CSS2DObject(div);
    o.position.set(x, y, z);
    parent.add(o);
    return div;
  };
  const named = (name: string, sub?: string) =>
    `<i class="tag3d__dot"></i><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;

  // ---- Motor -----------------------------------------------------------------
  let motorTag: HTMLElement | null = null;
  const fan: THREE.Object3D[] = [];
  {
    const g = new THREE.Group();
    const gear = box(0.2, 0.2, 0.2, motorBlue);
    gear.position.set(0, 0, 0);
    const motor = cyl(0.075, 0.3, motorBlue);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0, -0.02, 0);
    motor.position.z = 0;
    motor.position.x = 0;
    const mg = new THREE.Group();
    mg.add(motor);
    mg.position.set(0, 0, 0.25);
    mg.rotation.y = Math.PI / 2;
    const finCount = 10;
    for (let i = 0; i < finCount; i++) {
      const fin = box(0.28, 0.008, 0.02, motorBlue);
      const a = (i / finCount) * Math.PI * 2;
      fin.position.set(0, -0.02 + Math.sin(a) * 0.075, Math.cos(a) * 0.075);
      mg.add(fin);
    }
    const fanCover = cyl(0.08, 0.05, black);
    fanCover.rotation.z = Math.PI / 2;
    fanCover.position.set(0.17, -0.02, 0);
    mg.add(fanCover);
    fan.push(fanCover);
    const shaft = cyl(0.03, 0.12, steel);
    shaft.position.set(0, 0.14, 0);
    g.add(gear, mg, shaft);
    g.position.set(S / 2, railBot - 0.24, 0);
    conveyor.add(g);
    if (layout.motor) {
      motorTag = tag(named(layout.motor, desc.get(layout.motor)?.description || 'Motor'), 'tag3d--motor', g, 0, -0.25, 0.3);
    }
  }

  // ---- Topes -----------------------------------------------------------------
  interface StopObj {
    cylinder: string;
    head: THREE.Mesh;
    lamp: THREE.Mesh;
    ledActive: THREE.Mesh;
    ledRest: THREE.Mesh;
    active?: string;
    rest?: string;
    label: HTMLElement;
    lastPos: number;
  }
  const stops: StopObj[] = [];
  const sensorObjs: { signal: string; led: THREE.Mesh; color: number; label: HTMLElement }[] = [];

  /** Sensor inductivo M18 en escuadra sobre el perfil exterior, mirando a la paleta. */
  const addSensor = (smm: number, signal: string, color: number, sub: string, small = false) => {
    const p = at(smm);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-p.nz, p.nx); // local +X = hacia fuera
    const bracket = box(0.05, 0.005, 0.03, steel);
    bracket.position.set(pw / 2 + 0.05, H + 0.012, 0);
    const body = cyl(0.009, 0.07, steel, 16);
    body.rotation.z = Math.PI / 2;
    body.position.set(pw / 2 + 0.065, H + 0.022, 0);
    const face = cyl(0.0085, 0.006, black, 16);
    face.rotation.z = Math.PI / 2;
    face.position.set(pw / 2 + 0.028, H + 0.022, 0);
    const l = led(0.006);
    l.position.set(pw / 2 + 0.102, H + 0.022, 0);
    g.add(bracket, body, face, l);
    conveyor.add(g);
    const label = tag(named(signal, sub), small ? 'tag3d--small' : 'tag3d--sensor', g, pw / 2 + 0.12, H + (small ? 0.06 : 0.1), 0);
    sensorObjs.push({ signal, led: l, color, label });
  };

  layout.stops.forEach((t) => {
    const smm = stopS(layout, t);
    const p = at(smm);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = -p.h;
    // Travesaño de montaje, cuerpo neumático, vástago y cabeza.
    const cross = box(0.05, 0.03, w + 0.04, aluDark);
    cross.position.set(0.03, railBot - 0.015, 0);
    const body = box(0.075, 0.15, 0.075, cylDark);
    body.position.set(0.03, railBot - 0.105, 0);
    const cap = box(0.08, 0.02, 0.08, alu);
    cap.position.set(0.03, railBot - 0.19, 0);
    const rod = cyl(0.008, 0.16, steel, 12);
    rod.position.set(0.03, railBot + 0.05, 0);
    const headMat = mat({ color: 0xc62828, metalness: 0.2, roughness: 0.5, emissive: 0x000000 });
    const head = box(0.035, 0.06, w * 0.5, headMat);
    head.position.set(0.02, H + 0.005, 0);
    const lamp = led(0.009);
    lamp.position.set(0.03, railBot - 0.06, 0.042);
    const ledA = led(0.005);
    ledA.position.set(0.069, railBot - 0.05, 0.02);
    const ledR = led(0.005);
    ledR.position.set(0.069, railBot - 0.15, 0.02);
    const senA = cyl(0.005, 0.03, steel, 10);
    senA.rotation.z = Math.PI / 2;
    senA.position.set(0.075, railBot - 0.05, 0);
    const senR = senA.clone();
    senR.position.y = railBot - 0.15;
    g.add(cross, body, cap, rod, head, lamp, ledA, ledR, senA, senR);
    conveyor.add(g);
    const sig = desc.get(t.cylinder);
    const out = Math.atan2(-p.nz, p.nx) + p.h; // ángulo local hacia fuera
    const lx = Math.cos(out) * (pw / 2 + 0.28);
    const lz = -Math.sin(out) * (pw / 2 + 0.28);
    const label = tag(named(t.cylinder, 'tope cerrado'), 'tag3d--stop', g, lx, H + 0.2, lz);
    label.title = sig?.description ?? '';
    stops.push({
      cylinder: t.cylinder,
      head,
      lamp,
      ledActive: ledA,
      ledRest: ledR,
      active: sig?.inductivoActivo || undefined,
      rest: sig?.inductivoReposo || undefined,
      label,
      lastPos: 0,
    });
    if (t.presence) addSensor(smm - PRESENCE_BEFORE_STOP, t.presence, 0xffc400, 'presencia', true);
  });

  layout.sensors.forEach((x) => {
    const smm = sensorS(layout, x);
    if (smm === null) return;
    const role = x.role === 'acumulacion' ? 'acumulación máx.' : x.role === 'paso' ? 'paso paleta' : 'sensor';
    addSensor(smm, x.signal, x.role === 'acumulacion' ? 0xff7a00 : 0x22d36b, role);
  });

  // ---- Paletas -----------------------------------------------------------------
  interface PalletObj {
    g: THREE.Group;
    label: HTMLElement;
  }
  const pallets = new Map<number, PalletObj>();
  const palletRoot = new THREE.Group();
  scene.add(palletRoot);
  const makePallet = (id: number): PalletObj => {
    const g = new THREE.Group();
    const plate = box(plen * 0.97, 0.022, pw, steel);
    plate.position.y = H + 0.011;
    const strip = box(plen * 0.97, 0.008, pw * 0.92, darkSteel);
    strip.position.y = H + 0.026;
    const fixture = box(plen * 0.42, 0.035, pw * 0.5, fixtureBlue);
    fixture.position.y = H + 0.047;
    const pinA = cyl(0.007, 0.03, steel, 10);
    pinA.position.set(plen * 0.3, H + 0.045, pw * 0.3);
    const pinB = pinA.clone();
    pinB.position.set(-plen * 0.3, H + 0.045, -pw * 0.3);
    const bush = cyl(0.016, 0.004, black, 16);
    bush.position.set(plen * 0.3, H + 0.031, pw * 0.3);
    const bush2 = bush.clone();
    bush2.position.set(-plen * 0.3, H + 0.031, -pw * 0.3);
    // Flecha en el utillaje: se ve que la paleta gira bien en las curvas.
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(plen, pw) * 0.12, Math.min(plen, pw) * 0.25, 3),
      mat({ color: 0xf2c200, roughness: 0.5 }),
    );
    arrow.rotation.z = -Math.PI / 2;
    arrow.scale.set(1, 1, 0.25);
    arrow.position.set(0, H + 0.068, 0);
    g.add(plate, strip, fixture, pinA, pinB, bush, bush2, arrow);
    palletRoot.add(g);
    const label = tag(`<b>P${id}</b>`, 'tag3d--pallet', g, 0, H + 0.2, 0);
    return { g, label };
  };

  // ---- Estaciones (solo estado en su tope) -----------------------------------
  const stationTags: { stop: string; tag: HTMLElement; signals: string }[] = [];
  layout.stations.forEach((st) => {
    const t = layout.stops.find((x) => x.cylinder === st.stop);
    if (!t) return;
    const p = at(stopS(layout, t) - layout.palletLength / 2);
    const g = new THREE.Group();
    g.position.set(p.x + p.nx * (pw / 2 + 0.5), 0, p.z + p.nz * (pw / 2 + 0.5));
    conveyor.add(g);
    stationTags.push({
      stop: st.stop,
      tag: tag(named(st.label, 'Esperando paleta'), 'tag3d--station', g, 0, H + 0.12, 0),
      signals: [st.release, ...st.okSensors].filter(Boolean).join(' · '),
    });
  });

  // ---- Cámara ------------------------------------------------------------------
  const setCamera = (preset: CameraPreset) => {
    const aspect = Math.max(1, camera.aspect || 1.8);
    const d = Math.max(3.2, (span * 1.12) / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * aspect) + 0.6);
    if (preset === 'planta') camera.position.set(0, d * 1.05, 0.01);
    else if (preset === 'frontal') camera.position.set(0, 1.9, d + R);
    else camera.position.set(-span * 0.1, d * 0.62, d * 0.8);
    controls.target.set(0, preset === 'planta' ? 0 : 0.55, preset === 'general' ? 0.15 : 0);
    controls.update();
  };
  setCamera('general');

  // ---- Tamaño ------------------------------------------------------------------
  const resize = () => {
    const wpx = el.clientWidth || 800;
    const hpx = el.clientHeight || 520;
    renderer.setSize(wpx, hpx, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    labelRenderer.setSize(wpx, hpx);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    if (!fitted && el.clientWidth) {
      fitted = true;
      setCamera('general');
    }
  };
  let fitted = false;
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  // ---- Actualización -----------------------------------------------------------
  let lastTime = -1;
  let travel = 0;
  const update = (plant: Plant) => {
    if (!el.isConnected) return;
    if (!el.clientWidth) return;
    if (renderer.domElement.width === 0) resize();
    const dt = lastTime < 0 ? 0 : Math.max(0, plant.time - lastTime);
    lastTime = plant.time;
    const motor = plant.motorOn();
    if (motor) travel += (layout.speed * dt) / 1000; // mm
    chainTex.offset.x = -((travel / 1000 / PITCH) % 1);
    const dir = layout.direction === 'cw' ? 1 : -1;
    wheels.forEach((wh) => (wh.rotation.y = dir * ((travel / 1000) / R)));
    fan.forEach((f) => (f.rotation.x = travel / 30));
    if (motorTag) {
      motorTag.classList.toggle('is-on', motor);
      motorTag.classList.toggle('is-bad', !motor);
      motorTag.querySelector('small')!.textContent = motor ? 'En marcha' : 'Parado';
    }

    // Estaciones.
    stationTags.forEach((r) => {
      const sp = plant.stationProgress(r.stop);
      const state = !sp ? 'Esperando paleta' : sp.progress >= 1 ? `Terminado${r.signals ? ` · ${r.signals}` : ''}` : `Trabajando ${Math.round(sp.progress * 100)} %`;
      const small = r.tag.querySelector('small');
      if (small && small.textContent !== state) small.textContent = state;
      r.tag.classList.toggle('is-on', !!sp && sp.progress < 1);
      r.tag.classList.toggle('is-done', !!sp && sp.progress >= 1);
    });

    // Paletas.
    const alive = new Set<number>();
    plant.pallets.forEach((p) => {
      alive.add(p.id);
      let o = pallets.get(p.id);
      if (!o) {
        o = makePallet(p.id);
        pallets.set(p.id, o);
      }
      const c = at(p.front - layout.palletLength / 2);
      o.g.position.set(c.x, 0, c.z);
      o.g.rotation.y = -c.h;
      o.label.classList.toggle('is-stopped', !p.moving);
    });
    pallets.forEach((o, id) => {
      if (alive.has(id)) return;
      palletRoot.remove(o.g);
      o.g.traverse((n) => n instanceof CSS2DObject && n.element.remove());
      pallets.delete(id);
    });

    // Topes.
    stops.forEach((t) => {
      const pos = plant.cylinder.get(t.cylinder) ?? 0;
      t.head.position.y = H + 0.005 - pos * 0.075;
      const col = pos >= 1 ? 0x2bd46a : pos <= 0 ? 0xff3b30 : 0xffb000;
      setLed(t.lamp, col);
      const hm = t.head.material as THREE.MeshStandardMaterial;
      if (hm.color.getHex() !== (pos >= 1 ? 0x2e9d55 : pos <= 0 ? 0xc62828 : 0xe0a100)) {
        hm.color.setHex(pos >= 1 ? 0x2e9d55 : pos <= 0 ? 0xc62828 : 0xe0a100);
        hm.emissive.setHex(col);
        hm.emissiveIntensity = 0.25;
      }
      setLed(t.ledActive, t.active && plant.sim.states[t.active] === 1 ? 0xffc400 : null);
      setLed(t.ledRest, t.rest && plant.sim.states[t.rest] === 1 ? 0xffc400 : null);
      t.label.classList.toggle('is-open', pos >= 1);
      t.label.classList.toggle('is-bad', pos <= 0);
      const txt = pos >= 1 ? 'tope abierto' : pos <= 0 ? 'tope cerrado' : pos > t.lastPos ? 'abriendo…' : 'cerrando…';
      t.lastPos = pos;
      const small = t.label.querySelector('small');
      if (small && small.textContent !== txt) small.textContent = txt;
    });
    sensorObjs.forEach((s) => {
      const on = plant.sim.states[s.signal] === 1;
      setLed(s.led, on ? s.color : null);
      s.label.classList.toggle('is-on', on);
    });

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  const dispose = () => {
    ro.disconnect();
    controls.dispose();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    mats.forEach((m) => m.dispose());
    chainTex.dispose();
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    el.remove();
  };

  return {
    el,
    update,
    dispose,
    setLabels: (on) => el.classList.toggle('no-labels', !on),
    setCamera,
  };
}

/** Textura de cadena de rodillos: dos eslabones por repetición. */
function chainTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b2f33';
  g.fillRect(0, 0, 128, 32);
  for (let i = 0; i < 2; i++) {
    const x = i * 64;
    g.fillStyle = i ? '#8b9399' : '#a3abb1';
    g.beginPath();
    g.roundRect(x + 4, 5, 56, 22, 10);
    g.fill();
    g.fillStyle = '#5c646a';
    g.fillRect(x + 14, 12, 36, 8);
    g.fillStyle = '#d5dbe0';
    [x + 14, x + 50].forEach((cx) => {
      g.beginPath();
      g.arc(cx, 16, 5, 0, Math.PI * 2);
      g.fill();
    });
  }
  return new THREE.CanvasTexture(c);
}
