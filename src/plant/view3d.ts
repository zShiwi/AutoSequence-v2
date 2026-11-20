/**
 * Vista 3D del transportador (three.js).
 *
 * El transportador es un lazo VERTICAL: dos cadenas paralelas que pasan por
 * el ramal de arriba, bajan por una curva, vuelven por el ramal de abajo y
 * suben por la otra curva. Las paletas van apoyadas por fuera de la cadena:
 * arriba con el utillaje hacia arriba y abajo colgando boca abajo.
 *
 *  - Aéreo: va alto y se carga por abajo (el ramal de trabajo es el inferior).
 *  - De suelo: va bajo y se carga por arriba.
 *
 * El motor va en la curva donde suben las paletas (salvo que se indique otro
 * extremo). Unidades: metros. X a lo largo, Y hacia arriba, Z hacia el
 * observador.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ConveyorLayout, Signal } from '../types';
import type { Plant } from './engine';
import { PRESENCE_BEFORE_STOP, loopLength, motorEnd, palletEntry, pointAt, sensorS, stopS } from './layout';

export interface PlantView {
  el: HTMLElement;
  update(plant: Plant): void;
  dispose(): void;
  setLabels(on: boolean): void;
  setCamera(preset: CameraPreset): void;
}

export type CameraPreset = 'general' | 'lateral' | 'superior';

const PITCH = 0.05; // paso del dibujo de la cadena (2 eslabones)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Por debajo de este ancho (px) la vista usa etiquetas compactas. */
export const COMPACT_WIDTH = 560;

/**
 * Distancia de la cámara (campo vertical de 35°) para que un lazo de ancho
 * `span` quepa en un contenedor con esa relación de aspecto, con margen para
 * las etiquetas de los extremos.
 */
export function fitDistance(span: number, aspect: number): number {
  const a = Math.max(0.3, aspect || 1);
  const margin = a < 1 ? 1.18 : 1.12;
  return Math.max(3, (span * margin) / (2 * Math.tan((17.5 * Math.PI) / 180) * a) + 0.8);
}

/** Caja de una etiqueta en pantalla: centro, tamaño y desplazamiento aplicado. */
export interface TagBox {
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  visible: boolean;
}

const overlaps = (a: TagBox, ax: number, ay: number, b: TagBox, gap: number) =>
  Math.abs(ax - (b.x + b.dx)) < (a.w + b.w) / 2 + gap && Math.abs(ay - (b.y + b.dy)) < (a.h + b.h) / 2 + gap;

/**
 * Coloca las etiquetas sin que se pisen ni se salgan del contenedor. Las
 * primeras de la lista tienen preferencia; las demás se apartan lo mínimo
 * (primero en vertical). Una etiqueta ya apartada se queda donde está mientras
 * siga libre, para que no baile de un fotograma a otro.
 */
export function placeTags(boxes: TagBox[], width: number, height: number, gap = 3): void {
  const done: TagBox[] = [];
  const pad = 4;
  boxes.forEach((b) => {
    if (!b.visible || !b.w) {
      b.dx = b.dy = 0;
      return;
    }
    // Dentro del contenedor (si cabe).
    const clampX = (x: number) => (b.w + 2 * pad > width ? width / 2 : Math.min(Math.max(x, b.w / 2 + pad), width - b.w / 2 - pad));
    const clampY = (y: number) => (b.h + 2 * pad > height ? y : Math.min(Math.max(y, b.h / 2 + pad), height - b.h / 2 - pad));
    const free = (x: number, y: number, g: number) => !done.some((d) => overlaps(b, x, y, d, g));
    const home = { x: clampX(b.x), y: clampY(b.y) };
    const prev = { x: clampX(b.x + b.dx), y: clampY(b.y + b.dy) };
    let pos: { x: number; y: number } | null = null;
    if (free(home.x, home.y, gap + 6)) pos = home;
    else if ((b.dx || b.dy) && Math.hypot(b.dx, b.dy) < 4 * b.h + 60 && free(prev.x, prev.y, gap)) pos = prev;
    else {
      const stepY = b.h / 2 + gap + 1;
      const stepX = b.w / 2 + gap + 1;
      // En vertical primero, hacia el lado en que ya estaba; luego en diagonal.
      const sign = b.dy < 0 ? -1 : 1;
      search: for (let ring = 1; ring <= 8; ring++) {
        for (const kx of [0, 1, -1, 2, -2]) {
          if (Math.abs(kx) > ring) continue;
          for (const ky of [sign * ring, -sign * ring]) {
            const x = clampX(home.x + kx * stepX);
            const y = clampY(home.y + ky * stepY);
            if (free(x, y, gap)) {
              pos = { x, y };
              break search;
            }
          }
        }
      }
    }
    pos ??= home;
    b.dx = pos.x - b.x;
    b.dy = pos.y - b.y;
    done.push(b);
  });
}

/** Devuelve null si el navegador no puede dibujar WebGL. */
export function createView3d(layout: ConveyorLayout, signals: Signal[], opts: { labels: boolean }): PlantView | null {
  // Sin aceleración gráfica (máquinas virtuales, escritorio remoto…) se
  // arranca en modo ligero: sin reflejos, sin sombras y con menos resolución.
  const soft = softwareRenderer();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !soft, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const desc = new Map(signals.map((s) => [s.name, s]));

  // ---- Contenedor ----------------------------------------------------------
  const el = document.createElement('div');
  el.className = 'plant3d';
  renderer.setPixelRatio(soft ? 0.75 : Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = !soft;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'plant3d__labels';
  el.appendChild(labelRenderer.domElement);
  if (!opts.labels) el.classList.add('no-labels');

  // ---- Medidas -------------------------------------------------------------
  const aerial = (layout.kind ?? 'aereo') === 'aereo';
  const S = layout.length / 1000;
  const R = layout.radius / 1000;
  const Lmm = loopLength(layout);
  const span = S + 2 * R;
  const plen = layout.palletLength / 1000;
  const w = Math.min(Math.max(plen * 0.8, 0.2), 0.6); // separación entre cadenas
  const pw = w + 0.06; // ancho de paleta
  const HC = aerial ? 2.7 + R : 0.42 + R; // altura del eje de las curvas
  const mEnd = motorEnd(layout);

  // ---- Escena --------------------------------------------------------------
  const css = getComputedStyle(document.documentElement);
  const bg = new THREE.Color(css.getPropertyValue('--surface-2').trim() || '#eef2f4');
  const dark = bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.4;
  const scene = new THREE.Scene();
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 22, 70);
  const pmrem = soft ? null : new THREE.PMREMGenerator(renderer);
  const envTex = pmrem ? pmrem.fromScene(new RoomEnvironment(), 0.04).texture : null;
  scene.environment = envTex;
  const fill = new THREE.AmbientLight(0xffffff, soft ? 0.9 : 0);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202830 : 0x6f767c, dark ? 0.5 : 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.6 : 2.1);
  sun.position.set(-span * 0.3, HC + 8, 7);
  sun.castShadow = !soft;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -span / 2 - 2;
  sc.right = span / 2 + 2;
  sc.top = 4;
  sc.bottom = -4;
  sc.near = 1;
  sc.far = 40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI - 0.05;
  controls.minDistance = 0.6;
  controls.maxDistance = Math.max(span * 4 + 12, fitDistance(span, 0.5) * 1.5);

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
  const guide = mat({ color: 0xe8e3d6, metalness: 0, roughness: 0.6 });
  const cylDark = mat({ color: 0x2e3338, metalness: 0.5, roughness: 0.5 });
  // Las paletas llevan color propio: en gris se confundían con el perfil.
  const palletMat = mat({ color: 0x2f7fd6, metalness: 0.15, roughness: 0.5 });
  const palletEdge = mat({ color: 0x16406f, metalness: 0.2, roughness: 0.55 });
  const motorBlue = mat({ color: 0x35536f, metalness: 0.45, roughness: 0.45 });
  const guard = mat({ color: 0xe8901c, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.18, depthWrite: false });
  const floorMat = mat({ color: dark ? 0x232b33 : 0xb9c0c6, metalness: 0, roughness: 0.92 });
  const yellow = mat({ color: 0xf2c200, metalness: 0, roughness: 0.6 });
  const arrowMat = mat({ color: 0xf2c200, roughness: 0.5 });

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

  // ---- Geometría del lazo (en alzado) ----------------------------------------
  /** Punto del lazo: posición, sentido de avance y normal hacia fuera (plano XY). */
  const at = (smm: number) => {
    const p = pointAt(layout, smm);
    const cx = Math.max(0, Math.min(layout.length, p.x));
    let nx = p.x - cx;
    let ny = -p.y; // en el plano, y crece hacia abajo
    const m = Math.hypot(nx, ny) || 1;
    nx /= m;
    ny /= m;
    return { x: p.x / 1000 - S / 2, y: HC - p.y / 1000, dx: Math.cos(p.heading), dy: -Math.sin(p.heading), nx, ny };
  };
  type At = ReturnType<typeof at>;
  /** Orienta un objeto: X local = avance, Y local = hacia fuera del lazo. */
  const orient = (o: THREE.Object3D, p: At) => {
    const xA = new THREE.Vector3(p.dx, p.dy, 0);
    const yA = new THREE.Vector3(p.nx, p.ny, 0);
    const zA = new THREE.Vector3().crossVectors(xA, yA);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    o.position.set(p.x, p.y, 0);
  };
  const world = (p: At, d: number, z: number) => new THREE.Vector3(p.x + p.nx * d, p.y + p.ny * d, z);

  const N = Math.max(120, Math.ceil(Lmm / 20));
  const samples: (At & { s: number })[] = [];
  for (let i = 0; i <= N; i++) {
    const smm = (i / N) * Lmm;
    samples.push({ ...at(i === N ? 0 : smm), s: smm / 1000 });
  }
  /** Cinta que barre el segmento (dA,zA)–(dB,zB) a lo largo del lazo; d = hacia fuera. */
  const ribbon = (dA: number, zA: number, dB: number, zB: number, m: THREE.Material, uScale = 0) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    samples.forEach((p, i) => {
      pos.push(p.x + p.nx * dA, p.y + p.ny * dA, zA, p.x + p.nx * dB, p.y + p.ny * dB, zB);
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
  const P_IN = -0.095; // cara interior del perfil
  const P_OUT = -0.013; // cara exterior del perfil (bajo la cadena)
  [-1, 1].forEach((sg) => {
    const c = (sg * w) / 2;
    const hw = 0.022;
    // Perfil de aluminio que sigue todo el lazo, con ranuras en T.
    conveyor.add(ribbon(P_OUT, c - hw, P_OUT, c + hw, alu));
    conveyor.add(ribbon(P_IN, c - hw, P_IN, c + hw, aluDark));
    conveyor.add(ribbon(P_IN, c + hw, P_OUT, c + hw, alu));
    conveyor.add(ribbon(P_IN, c - hw, P_OUT, c - hw, alu));
    const so = c + sg * (hw + 0.0005);
    conveyor.add(ribbon(-0.07, so, -0.06, so, slot));
    conveyor.add(ribbon(-0.045, so, -0.035, so, slot));
    // Cadena.
    conveyor.add(ribbon(0, c - 0.012, 0, c + 0.012, chainMat, PITCH));
    conveyor.add(ribbon(P_OUT, c - 0.012, 0, c - 0.012, darkSteel));
    conveyor.add(ribbon(P_OUT, c + 0.012, 0, c + 0.012, darkSteel));
    // Guía lateral de las paletas.
    const g = sg * (pw / 2 + 0.012);
    conveyor.add(ribbon(0.004, g, 0.034, g, guide));
    conveyor.add(ribbon(0.034, g, 0.034, sg * (pw / 2 + 0.03), guide));
    conveyor.add(ribbon(-0.004, sg * (pw / 2 + 0.012), 0.004, sg * (pw / 2 + 0.012), aluDark));
  });

  // Separadores entre el perfil de arriba y el de abajo.
  const nSep = Math.max(2, Math.ceil(S / 1.2) + 1);
  for (let i = 0; i < nSep; i++) {
    const x = -S / 2 + 0.1 + (i * (S - 0.2)) / (nSep - 1);
    [-1, 1].forEach((sg) => {
      const sp = box(0.04, 2 * R + 2 * P_IN, 0.04, aluDark);
      sp.position.set(x, HC, (sg * w) / 2);
      conveyor.add(sp);
    });
  }

  // Ruedas dentadas y ejes en las dos curvas; protección naranja en el extremo.
  const wheels: THREE.Object3D[] = [];
  [-S / 2, S / 2].forEach((ex, end) => {
    const shaft = cyl(0.025, pw + 0.4, steel, 16);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(ex, HC, 0);
    conveyor.add(shaft);
    [-1, 1].forEach((sg) => {
      const wheel = new THREE.Group();
      wheel.userData.dyn = true;
      const disc = cyl(R + P_OUT, 0.02, darkSteel, 64);
      disc.rotation.x = Math.PI / 2;
      wheel.add(disc);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const spoke = box(R * 1.6, 0.03, 0.024, steel);
        spoke.rotation.z = a;
        if (i < 5) wheel.add(spoke);
      }
      wheel.position.set(ex, HC, (sg * w) / 2);
      wheels.push(wheel);
      conveyor.add(wheel);
      const bearing = box(0.09, 0.12, 0.05, cylDark);
      bearing.position.set(ex, HC, sg * (pw / 2 + 0.07));
      conveyor.add(bearing);
    });
    // Protección del extremo: chapa curvada por fuera de las paletas.
    const outR = R + 0.16;
    const th = new THREE.CylinderGeometry(outR, outR, pw + 0.12, 40, 1, true, end ? 0 : Math.PI, Math.PI);
    const cover = new THREE.Mesh(th, guard);
    guard.side = THREE.DoubleSide;
    cover.castShadow = false;
    cover.rotation.x = Math.PI / 2;
    cover.position.set(ex, HC, 0);
    conveyor.add(cover);
  });

  // Estructura: columnas a los lados (las paletas pasan entre ellas) y travesaños.
  const colZ = pw / 2 + 0.16;
  const nCol = Math.max(2, Math.ceil(S / 2) + 1);
  for (let i = 0; i < nCol; i++) {
    const x = -S / 2 + 0.3 + (i * (S - 0.6)) / (nCol - 1);
    [-1, 1].forEach((sg) => {
      const col = box(0.08, HC + 0.04, 0.08, alu);
      col.position.set(x, (HC + 0.04) / 2, sg * colZ);
      const foot = box(0.18, 0.015, 0.18, darkSteel);
      foot.position.set(x, 0.0075, sg * colZ);
      conveyor.add(col, foot);
    });
    const cross = box(0.06, 0.06, 2 * colZ + 0.08, aluDark);
    cross.position.set(x, HC, 0);
    conveyor.add(cross);
  }

  // ---- Suelo ---------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span + 30, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(Math.ceil(span + 20), Math.ceil(span + 20), dark ? 0x34404b : 0xbcc3c9, dark ? 0x2a333c : 0xc7cdd2);
  grid.position.y = 0.001;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);
  const mx = span / 2 + 0.8;
  const mz = colZ + (aerial ? 1.4 : 0.9);
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
  const tagBoxes: (TagBox & { obj: CSS2DObject; el: HTMLElement; line: SVGLineElement })[] = [];
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.setAttribute('class', 'plant3d__leaders');
  leaders.setAttribute('aria-hidden', 'true');
  labelRenderer.domElement.appendChild(leaders);
  /** `spread`: la etiqueta se aparta de las demás si se pisan (las de paleta no). */
  const tag = (html: string, cls: string, parent: THREE.Object3D, pos: THREE.Vector3, spread = true) => {
    const div = document.createElement('div');
    div.className = `tag3d ${cls}`;
    div.innerHTML = html;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    parent.add(o);
    if (spread) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      leaders.appendChild(line);
      tagBoxes.push({ obj: o, el: div, line, x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0, visible: false });
    }
    return div;
  };
  const named = (name: string, sub?: string) =>
    `<i class="tag3d__dot"></i><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;

  // ---- Motor (en la curva donde suben las paletas) -----------------------------
  let motorTag: HTMLElement | null = null;
  const fan: THREE.Object3D[] = [];
  {
    const ex = mEnd === 'right' ? S / 2 : -S / 2;
    const g = new THREE.Group();
    g.position.set(ex, HC, pw / 2 + 0.24);
    const gear = box(0.22, 0.24, 0.16, motorBlue);
    const motor = cyl(0.08, 0.32, motorBlue);
    motor.rotation.z = Math.PI / 2;
    motor.position.set((mEnd === 'right' ? -1 : 1) * 0.27, -0.03, 0);
    const finCount = 10;
    for (let i = 0; i < finCount; i++) {
      const fin = box(0.3, 0.008, 0.02, motorBlue);
      const a = (i / finCount) * Math.PI * 2;
      fin.position.set(motor.position.x, -0.03 + Math.sin(a) * 0.08, Math.cos(a) * 0.08);
      g.add(fin);
    }
    const fanCover = cyl(0.085, 0.05, black);
    fanCover.rotation.z = Math.PI / 2;
    fanCover.position.set((mEnd === 'right' ? -1 : 1) * 0.45, -0.03, 0);
    fanCover.userData.dyn = true;
    fan.push(fanCover);
    g.add(gear, motor, fanCover);
    conveyor.add(g);
    if (layout.motor) {
      motorTag = tag(
        named(layout.motor, 'En marcha'),
        'tag3d--motor',
        g,
        new THREE.Vector3(0, aerial ? -0.35 : 0.35, 0.1),
      );
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
    presence?: string;
  }
  const stops: StopObj[] = [];
  const sensorObjs: { signal: string; led: THREE.Mesh; color: number; label: HTMLElement | null }[] = [];

  // Etiquetas cercanas a distinta altura para que no se pisen.
  const placedLabels: { x: number; y: number; d: number }[] = [];
  const labelDepth = (x: number, y: number, base = 0.32) => {
    let d = base;
    while (placedLabels.some((q) => Math.abs(q.x - x) < 1.05 && Math.abs(q.y - y) < 0.2 && Math.abs(q.d - d) < 0.36)) d += 0.4;
    placedLabels.push({ x, y, d });
    return d;
  };
  /** Sensor inductivo M18 en escuadra sobre la guía delantera, mirando a la paleta. */
  const addSensor = (smm: number, signal: string, color: number, sub: string | null) => {
    const p = at(smm);
    const z0 = pw / 2 + 0.035;
    const c = world(p, 0.022, z0 + 0.035);
    const body = cyl(0.009, 0.07, steel, 16);
    body.rotation.x = Math.PI / 2;
    body.position.copy(c);
    const face = cyl(0.0085, 0.006, black, 16);
    face.rotation.x = Math.PI / 2;
    face.position.copy(world(p, 0.022, z0 - 0.002));
    const l = led(0.006);
    l.position.copy(world(p, 0.022, z0 + 0.073));
    const bracket = box(0.03, 0.03, 0.005, steel);
    bracket.position.copy(world(p, 0.022, z0 + 0.03));
    conveyor.add(body, face, l, bracket);
    // La presencia del tope no lleva etiqueta propia: va en la del tope.
    const label = sub === null ? null : tag(named(signal, sub), 'tag3d--sensor', conveyor, world(p, labelDepth(p.x, p.y, 0.16), z0 + 0.1));
    sensorObjs.push({ signal, led: l, color, label });
  };

  layout.stops.forEach((t) => {
    const smm = stopS(layout, t);
    const p = at(smm);
    const g = new THREE.Group();
    orient(g, p);
    // Montaje entre los perfiles (dentro del lazo); la cabeza sale hacia fuera.
    const cross = box(0.05, 0.03, w + 0.04, aluDark);
    cross.position.set(0.03, P_IN - 0.015, 0);
    const body = box(0.075, 0.15, 0.075, cylDark);
    body.position.set(0.03, P_IN - 0.105, 0);
    const cap = box(0.08, 0.02, 0.08, alu);
    cap.position.set(0.03, P_IN - 0.19, 0);
    const rod = cyl(0.008, 0.14, steel, 12);
    rod.position.set(0.03, P_IN + 0.04, 0);
    const headMat = mat({ color: 0xc62828, metalness: 0.2, roughness: 0.5 });
    const head = box(0.035, 0.06, w * 0.5, headMat);
    head.userData.dyn = true;
    head.position.set(0.02, 0.005, 0);
    const lamp = led(0.009);
    lamp.position.set(0.03, P_IN - 0.06, 0.042);
    const ledA = led(0.005);
    ledA.position.set(0.069, P_IN - 0.05, 0.02);
    const ledR = led(0.005);
    ledR.position.set(0.069, P_IN - 0.15, 0.02);
    g.add(cross, body, cap, rod, head, lamp, ledA, ledR);
    conveyor.add(g);
    const sig = desc.get(t.cylinder);
    const label = tag(
      `<i class="tag3d__dot"></i><b>${esc(t.cylinder)}</b><small data-st>tope cerrado</small>` +
        (t.presence ? `<small class="tag3d__pres" data-pres><i></i>${esc(t.presence)} · presencia</small>` : '') +
        (layout.stations.some((x) => x.stop === t.cylinder)
          ? `<small class="tag3d__station" data-station>${esc(layout.stations.find((x) => x.stop === t.cylinder)!.label)}: esperando</small>`
          : '') +
        `<small class="tag3d__why" data-why hidden></small>`,
      `tag3d--stop${layout.stations.some((x) => x.stop === t.cylinder) ? ' tag3d--stop-station' : ''}`,
      conveyor,
      world(p, labelDepth(p.x, p.y), pw / 2 + 0.2),
    );
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
      presence: t.presence,
    });
    if (t.presence) addSensor(smm - PRESENCE_BEFORE_STOP, t.presence, 0xffc400, null);
  });

  layout.sensors.forEach((x) => {
    const smm = sensorS(layout, x);
    if (smm === null) return;
    const role = x.role === 'acumulacion' ? 'acumulación máx.' : x.role === 'paso' ? 'paso paleta' : 'sensor';
    addSensor(smm, x.signal, x.role === 'acumulacion' ? 0xff7a00 : 0x22d36b, role);
  });

  // ---- Estaciones: su estado va en la etiqueta de su tope ----------------------
  const stationTags = layout.stations
    .map((st) => ({ stop: st.stop, label: st.label, tag: stops.find((t) => t.cylinder === st.stop)?.label }))
    .filter((x): x is { stop: string; label: string; tag: HTMLElement } => !!x.tag);

  // ---- Punto de entrada de paletas --------------------------------------------
  const entry = palletEntry(layout);
  if (entry) {
    const p = at(entry.s - layout.palletLength / 2);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(plen * 0.95, 0.006, 0.05), arrowMat);
    orient(mark, p);
    mark.position.copy(world(p, 0.003, -(pw / 2 + 0.06)));
    conveyor.add(mark);
    tag(
      `<i class="tag3d__dot"></i><b><span class="tag3d__long">Entrada de paletas</span><span class="tag3d__short">Entrada</span></b><small>${esc(`cola de ${entry.stop}`)}</small>`,
      'tag3d--entry',
      conveyor,
      world(p, labelDepth(p.x, p.y, 0.25), -(pw / 2 + 0.25)),
    );
  }

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
    // Y local = hacia fuera de la cadena: arriba va de pie, abajo cuelga.
    const plate = box(plen * 0.97, 0.03, pw, palletMat);
    plate.position.y = 0.015;
    const strip = box(plen * 0.97, 0.008, pw * 0.92, palletEdge);
    strip.position.y = 0.034;
    // Utillaje alto: es lo que se ve de la paleta cuando se mira de lado o desde abajo.
    const fixture = box(plen * 0.5, 0.09, pw * 0.6, palletMat);
    fixture.position.y = 0.083;
    const pinA = cyl(0.007, 0.03, steel, 10);
    pinA.position.set(plen * 0.38, 0.053, pw * 0.38);
    const pinB = pinA.clone();
    pinB.position.set(-plen * 0.38, 0.053, -pw * 0.38);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(Math.min(plen, pw) * 0.12, Math.min(plen, pw) * 0.25, 3), arrowMat);
    arrow.rotation.z = -Math.PI / 2;
    arrow.scale.set(1, 1, 0.25);
    arrow.position.set(0, 0.131, 0);
    g.add(plate, strip, fixture, pinA, pinB, arrow);
    mergeStatic(g);
    palletRoot.add(g);
    const label = tag(`<b>P${id}</b>`, 'tag3d--pallet', g, new THREE.Vector3(0, 0.24, 0), false);
    return { g, label };
  };

  // ---- Cámara ------------------------------------------------------------------
  const setCamera = (preset: CameraPreset) => {
    // El campo horizontal depende del ancho del contenedor: en pantallas
    // estrechas (móvil) hay que alejarse para que quepa todo el lazo.
    const d = fitDistance(span, camera.aspect || 1.8);
    if (preset === 'lateral') {
      camera.position.set(0, HC, d);
      controls.target.set(0, HC, 0);
    } else if (preset === 'superior') {
      camera.position.set(-span * 0.08, HC + d * 0.75, d * 0.55);
      controls.target.set(0, HC, 0);
    } else {
      // A la altura de una persona: el aéreo se ve desde abajo, el de suelo desde arriba.
      camera.position.set(-span * 0.12, aerial ? 1.6 : HC + 1.6, d * 0.95);
      controls.target.set(0, aerial ? HC - 0.2 : HC - 0.1, 0);
    }
    controls.update();
  };
  setCamera('general');
  mergeStatic(conveyor);
  if (soft) lighten();

  // ---- Etiquetas que no se pisan -------------------------------------------------
  let sizeAge = 0;
  const proj = new THREE.Vector3();
  const spreadTags = () => {
    const wpx = el.clientWidth;
    const hpx = el.clientHeight;
    // Medir obliga al navegador a recalcular: se hace de vez en cuando.
    const measure = sizeAge-- <= 0;
    if (measure) sizeAge = 20;
    const shown = !el.classList.contains('no-labels');
    tagBoxes.forEach((b) => {
      proj.setFromMatrixPosition(b.obj.matrixWorld).project(camera);
      b.visible = shown && proj.z > -1 && proj.z < 1;
      b.x = (proj.x * 0.5 + 0.5) * wpx;
      b.y = (-proj.y * 0.5 + 0.5) * hpx;
      if (measure || !b.w) {
        b.w = b.el.offsetWidth;
        b.h = b.el.offsetHeight;
      }
    });
    placeTags(tagBoxes, wpx, hpx);
    tagBoxes.forEach((b) => {
      const tr = b.dx || b.dy ? `${Math.round(b.dx)}px ${Math.round(b.dy)}px` : '';
      if (b.el.style.translate !== tr) b.el.style.translate = tr;
      // Línea guía hasta su sitio cuando la etiqueta se ha apartado bastante.
      const far = b.visible && Math.hypot(b.dx, b.dy) > 14;
      b.line.style.display = far ? '' : 'none';
      if (far) {
        b.line.setAttribute('x1', b.x.toFixed(1));
        b.line.setAttribute('y1', b.y.toFixed(1));
        b.line.setAttribute('x2', (b.x + b.dx).toFixed(1));
        b.line.setAttribute('y2', (b.y + b.dy).toFixed(1));
      }
    });
  };

  // ---- Tamaño ------------------------------------------------------------------
  let fitted = false;
  const resize = () => {
    const wpx = el.clientWidth || 800;
    const hpx = el.clientHeight || 520;
    renderer.setSize(wpx, hpx, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    labelRenderer.setSize(wpx, hpx);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    // En estrecho, las etiquetas muestran solo el código; el detalle, al tocarlas.
    el.classList.toggle('plant3d--compact', wpx < COMPACT_WIDTH);
    sizeAge = 0;
    if (!fitted && el.clientWidth) {
      fitted = true;
      setCamera('general');
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  const onTagClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.tag3d');
    if (!t || !el.classList.contains('plant3d--compact')) return;
    const open = !t.classList.contains('is-expanded');
    el.querySelectorAll('.tag3d.is-expanded').forEach((x) => x.classList.remove('is-expanded'));
    t.classList.toggle('is-expanded', open);
    sizeAge = 0;
  };
  labelRenderer.domElement.addEventListener('click', onTagClick);

  // ---- Actualización -----------------------------------------------------------
  let lastTime = -1;
  let travel = 0;
  let lastFrame = 0;
  let ema = 0;
  let slowFrames = 0;
  let skip = 0;
  let frameNo = 0;
  const dirSign = layout.direction === 'cw' ? -1 : 1;
  const update = (plant: Plant) => {
    if (!el.isConnected || !el.clientWidth) return;
    if (renderer.domElement.width === 0) resize();
    const dt = lastTime < 0 ? 0 : Math.max(0, plant.time - lastTime);
    lastTime = plant.time;
    const motor = plant.motorOn();
    if (motor) travel += (layout.speed * dt) / 1000; // mm
    // Si va lento se baja la calidad y, en último caso, se dibujan menos
    // fotogramas para que la página siga respondiendo.
    const now = performance.now();
    if (lastFrame) ema = ema ? ema * 0.9 + (now - lastFrame) * 0.1 : now - lastFrame;
    lastFrame = now;
    if (ema > 45) {
      if (++slowFrames > 30) degrade();
    } else slowFrames = 0;
    if (skip && frameNo++ % (skip + 1) !== 0) return;

    chainTex.offset.x = -((travel / 1000 / PITCH) % 1);
    wheels.forEach((wh) => (wh.rotation.z = (dirSign * (travel / 1000)) / R));
    fan.forEach((f) => (f.rotation.x = travel / 30));
    if (motorTag) {
      motorTag.classList.toggle('is-on', motor);
      motorTag.classList.toggle('is-bad', !motor);
      const small = motorTag.querySelector('small')!;
      const txt = motor ? 'En marcha' : 'Parado';
      if (small.textContent !== txt) small.textContent = txt;
    }

    stationTags.forEach((r) => {
      const sp = plant.stationProgress(r.stop);
      const state = `${r.label}: ${!sp ? 'esperando' : sp.progress >= 1 ? 'terminado' : `trabajando ${Math.round(sp.progress * 100)} %`}`;
      const line = r.tag.querySelector<HTMLElement>('[data-station]')!;
      if (line.textContent !== state) line.textContent = state;
      line.classList.toggle('is-on', !!sp && sp.progress < 1);
      line.classList.toggle('is-done', !!sp && sp.progress >= 1);
    });

    const alive = new Set<number>();
    plant.pallets.forEach((p) => {
      alive.add(p.id);
      let o = pallets.get(p.id);
      if (!o) {
        o = makePallet(p.id);
        pallets.set(p.id, o);
      }
      orient(o.g, at(p.front - layout.palletLength / 2));
      o.label.classList.toggle('is-stopped', !p.moving);
    });
    pallets.forEach((o, id) => {
      if (alive.has(id)) return;
      palletRoot.remove(o.g);
      o.g.traverse((n) => {
        if (n instanceof CSS2DObject) n.element.remove();
        if (n instanceof THREE.Mesh) n.geometry.dispose();
      });
      pallets.delete(id);
    });

    // Por qué no abre un tope que tiene paleta (sin contar lo que espera del robot mientras trabaja).
    const waits = new Map(plant.waitingStops().map((w) => [w.cylinder, w.missing]));
    stops.forEach((t) => {
      const pos = plant.cylinder.get(t.cylinder) ?? 0;
      const why = t.label.querySelector<HTMLElement>('[data-why]')!;
      const st = layout.stations.find((x) => x.stop === t.cylinder);
      const sp = st ? plant.stationProgress(t.cylinder) : null;
      const own = st ? new Set([st.release, ...st.okSensors, ...st.nokSensors].filter(Boolean) as string[]) : new Set<string>();
      const missing = (waits.get(t.cylinder) ?? []).filter((m) => !(sp && sp.progress < 1 && own.has(m.split(' ')[0])));
      const whyTxt = missing.length ? `espera ${missing.join(', ')}` : '';
      if (why.textContent !== whyTxt) {
        why.textContent = whyTxt;
        why.hidden = !whyTxt;
      }
      // Cerrado: la cabeza sobresale de la cadena y frena la paleta.
      t.head.position.y = 0.005 - pos * 0.075;
      const col = pos >= 1 ? 0x2bd46a : pos <= 0 ? 0xff3b30 : 0xffb000;
      setLed(t.lamp, col);
      const hm = t.head.material as THREE.MeshStandardMaterial;
      const hc = pos >= 1 ? 0x2e9d55 : pos <= 0 ? 0xc62828 : 0xe0a100;
      if (hm.color.getHex() !== hc) {
        hm.color.setHex(hc);
        hm.emissive.setHex(col);
        hm.emissiveIntensity = 0.25;
      }
      setLed(t.ledActive, t.active && plant.sim.states[t.active] === 1 ? 0xffc400 : null);
      setLed(t.ledRest, t.rest && plant.sim.states[t.rest] === 1 ? 0xffc400 : null);
      // El estado sale de la orden del PLC y de la posición real del cilindro.
      const cmd = plant.sim.states[t.cylinder] === 1;
      const txt = cmd ? (pos >= 1 ? 'tope abierto' : 'abriendo…') : pos <= 0 ? 'tope cerrado' : 'cerrando…';
      const cls = pos >= 1 ? 'is-open' : pos <= 0 ? 'is-bad' : 'is-moving';
      if (t.label.dataset.state !== cls + txt) {
        t.label.dataset.state = cls + txt;
        t.label.classList.remove('is-open', 'is-bad', 'is-moving');
        t.label.classList.add(cls);
        t.label.querySelector('[data-st]')!.textContent = txt;
      }
      if (t.presence) t.label.querySelector('[data-pres]')!.classList.toggle('is-on', plant.sim.states[t.presence] === 1);
    });
    sensorObjs.forEach((s) => {
      const on = plant.sim.states[s.signal] === 1;
      setLed(s.led, on ? s.color : null);
      s.label?.classList.toggle('is-on', on);
    });

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    spreadTags();
  };

  let quality = soft ? 3 : 6;
  /** Baja la calidad paso a paso: sombras, reflejos, resolución y fotogramas. */
  const degrade = () => {
    slowFrames = 0;
    ema = 0;
    if (quality === 6) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      mats.forEach((m) => (m.needsUpdate = true));
    } else if (quality === 5) lighten();
    else if (quality === 4) renderer.setPixelRatio(Math.min(1, renderer.getPixelRatio()));
    else if (quality === 3) renderer.setPixelRatio(0.6);
    else if (quality === 2) skip = 1;
    else if (quality === 1) skip = 2;
    else return;
    quality--;
    el.dataset.quality = String(quality);
    resize();
  };
  /** Sin mapa de reflejos: menos brillo metálico y más luz ambiente. */
  function lighten() {
    scene.environment = null;
    fill.intensity = 0.9;
    mats.forEach((m) => {
      if (m instanceof THREE.MeshStandardMaterial) m.metalness *= 0.35;
      m.needsUpdate = true;
    });
  }

  const dispose = () => {
    ro.disconnect();
    labelRenderer.domElement.removeEventListener('click', onTagClick);
    controls.dispose();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    mats.forEach((m) => m.dispose());
    chainTex.dispose();
    envTex?.dispose();
    pmrem?.dispose();
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

/** ¿El navegador dibuja WebGL por software (sin tarjeta gráfica)? */
function softwareRenderer(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

/**
 * Une las mallas fijas de un grupo en una por material: muchas menos órdenes
 * de dibujo. Se respetan las piezas que se mueven (marcadas con userData.dyn).
 */
function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, { meshes: THREE.Mesh[]; geos: THREE.BufferGeometry[] }>();
  const dyn = (o: THREE.Object3D | null) => {
    for (let n = o; n && n !== root; n = n.parent) if (n.userData.dyn) return true;
    return false;
  };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material) || dyn(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    Object.keys(g.attributes).forEach((k) => ['position', 'normal', 'uv'].includes(k) || g.deleteAttribute(k));
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    let e = byMat.get(o.material);
    if (!e) byMat.set(o.material, (e = { meshes: [], geos: [] }));
    e.meshes.push(o);
    e.geos.push(g);
  });
  byMat.forEach(({ meshes, geos }, m) => {
    if (meshes.length < 2) return geos.forEach((g) => g.dispose());
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    meshes.forEach((x) => {
      x.parent?.remove(x);
      x.geometry.dispose();
    });
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
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
