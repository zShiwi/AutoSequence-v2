/**
 * Geometría del transportador en lazo y resolución de posiciones.
 *
 * El lazo es un «estadio»: dos rectas de longitud S (arriba y abajo) unidas
 * por dos semicírculos de radio R. Cada punto se identifica por su distancia
 * s (mm) a lo largo del recorrido, en el sentido de avance de las paletas.
 *
 *   ccw: s = 0 en el extremo izquierdo de la recta de ABAJO, que avanza hacia
 *        la derecha; la de arriba vuelve hacia la izquierda.
 *   cw:  igual pero empezando por la recta de ARRIBA.
 *
 * Coordenadas en mm: x de 0 (eje del tambor izquierdo) a S (derecho);
 * y = +R abajo, y = −R arriba.
 */

import type { ConveyorLayout, ConveyorLine, LayoutSensor, LayoutStation, LayoutStop, Signal } from '../types';
import { validateSignalName } from '../plc/signals';

export function loopLength(l: Pick<ConveyorLayout, 'length' | 'radius'>): number {
  return 2 * l.length + 2 * Math.PI * l.radius;
}

export function wrap(s: number, L: number): number {
  return ((s % L) + L) % L;
}

/** Distancia recorrida desde a hasta b siguiendo el sentido de avance. */
export function ahead(a: number, b: number, L: number): number {
  return wrap(b - a, L);
}

function firstLine(l: ConveyorLayout): ConveyorLine {
  return l.direction === 'cw' ? 'top' : 'bottom';
}

/** Posición s de un punto dado por su línea y su distancia al extremo izquierdo. */
export function sOnLine(l: ConveyorLayout, line: ConveyorLine, x: number): number {
  const S = l.length;
  const xc = Math.max(0, Math.min(S, x));
  return line === firstLine(l) ? xc : S + Math.PI * l.radius + (S - xc);
}

export interface Point {
  x: number;
  y: number;
  /** Rumbo de avance en radianes (0 = hacia la derecha). */
  heading: number;
  line: ConveyorLine | 'curve';
}

export function pointAt(l: ConveyorLayout, s0: number): Point {
  const S = l.length;
  const R = l.radius;
  const L = loopLength(l);
  const s = wrap(s0, L);
  const flip = l.direction === 'cw' ? -1 : 1;
  const first = firstLine(l);
  const second: ConveyorLine = first === 'bottom' ? 'top' : 'bottom';
  let x: number;
  let y: number;
  let heading: number;
  let line: Point['line'];
  if (s < S) {
    x = s;
    y = R;
    heading = 0;
    line = first;
  } else if (s < S + Math.PI * R) {
    const t = (s - S) / R;
    const phi = Math.PI / 2 - t;
    x = S + R * Math.cos(phi);
    y = R * Math.sin(phi);
    heading = -t;
    line = 'curve';
  } else if (s < 2 * S + Math.PI * R) {
    x = S - (s - S - Math.PI * R);
    y = -R;
    heading = Math.PI;
    line = second;
  } else {
    const t = (s - 2 * S - Math.PI * R) / R;
    const phi = -Math.PI / 2 - t;
    x = R * Math.cos(phi);
    y = R * Math.sin(phi);
    heading = Math.PI - t;
    line = 'curve';
  }
  return { x, y: y * flip, heading: heading * flip, line };
}

/** Posición s de un tope. */
export function stopS(l: ConveyorLayout, stop: LayoutStop): number {
  return sOnLine(l, stop.line, stop.x);
}

/** Posición s de un sensor suelto (o null si su referencia no existe). */
export function sensorS(l: ConveyorLayout, sensor: LayoutSensor): number | null {
  if (sensor.ref === 'left') return sOnLine(l, sensor.line ?? firstLine(l), sensor.offset);
  const stop = l.stops.find((t) => t.cylinder === sensor.ref);
  if (!stop) return null;
  return wrap(stopS(l, stop) + sensor.offset, loopLength(l));
}

/** El sensor de presencia está en el propio tope, justo antes del punto de parada. */
export const PRESENCE_BEFORE_STOP = 30;

// ---- Validación -----------------------------------------------------------

export interface LayoutIssue {
  level: 'error' | 'warn';
  text: string;
}

export function validateLayout(l: ConveyorLayout, signals: Signal[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const names = new Map(signals.map((s) => [s.name, s]));
  const L = loopLength(l);
  const need = (name: string | undefined, what: string) => {
    if (name && !names.has(name)) issues.push({ level: 'error', text: `${what}: la señal «${name}» no existe.` });
  };
  if (!(l.length > 0) || !(l.radius > 0)) issues.push({ level: 'error', text: 'La longitud y el radio deben ser mayores que 0.' });
  if (l.palletLength <= 0 || l.speed <= 0) issues.push({ level: 'error', text: 'La paleta y la velocidad deben ser mayores que 0.' });
  const capacity = Math.floor(L / (l.palletLength + l.palletGap));
  if (l.pallets > capacity) issues.push({ level: 'error', text: `Caben como mucho ${capacity} paletas en ${Math.round(L)} mm de lazo.` });
  need(l.motor, 'Motor');

  const seen = new Set<string>();
  l.stops.forEach((t) => {
    need(t.cylinder, 'Tope');
    need(t.presence, `Presencia del tope ${t.cylinder}`);
    if (names.get(t.cylinder) && names.get(t.cylinder)!.type !== 'Cilindro')
      issues.push({ level: 'error', text: `«${t.cylinder}» no es un cilindro.` });
    if (seen.has(t.cylinder)) issues.push({ level: 'error', text: `El tope ${t.cylinder} está repetido.` });
    seen.add(t.cylinder);
    if (t.x < 0 || t.x > l.length) issues.push({ level: 'warn', text: `El tope ${t.cylinder} está fuera de la recta (0–${l.length} mm).` });
    if (!t.presence) issues.push({ level: 'warn', text: `El tope ${t.cylinder} no tiene sensor de presencia.` });
  });
  const sorted = l.stops.map((t) => stopS(l, t)).sort((a, b) => a - b);
  sorted.forEach((s, i) => {
    const next = sorted[(i + 1) % sorted.length];
    if (sorted.length > 1 && ahead(s, next, L) < l.palletLength + l.palletGap)
      issues.push({ level: 'warn', text: 'Hay dos topes más cerca que el largo de una paleta.' });
  });

  l.sensors.forEach((x) => {
    need(x.signal, 'Sensor');
    if (sensorS(l, x) === null) issues.push({ level: 'error', text: `El sensor ${x.signal} se refiere a un tope que no existe.` });
    if (x.ref === 'left' && (x.offset < 0 || x.offset > l.length))
      issues.push({ level: 'warn', text: `El sensor ${x.signal} está fuera de la recta.` });
  });
  l.stations.forEach((st) => {
    if (!l.stops.some((t) => t.cylinder === st.stop)) issues.push({ level: 'error', text: `La estación «${st.label}» está en un tope que no existe.` });
    need(st.release, `Estación «${st.label}»`);
    st.okSensors.forEach((s) => need(s, `Estación «${st.label}»`));
    st.nokSensors.forEach((s) => need(s, `Estación «${st.label}»`));
  });
  return dedupe(issues);
}

function dedupe(list: LayoutIssue[]): LayoutIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}

// ---- Layouts por defecto --------------------------------------------------

export function defaultLayout(signals: Signal[]): ConveyorLayout {
  const cylinders = signals.filter((s) => s.type === 'Cilindro' && !validateSignalName(s.name));
  const motor = signals.find((s) => s.type === 'Motor');
  const length = 6000;
  const perLine = Math.ceil(cylinders.length / 2);
  return {
    length,
    radius: 300,
    direction: 'ccw',
    palletLength: 400,
    palletGap: 20,
    speed: 250,
    pallets: Math.max(2, Math.min(8, cylinders.length + 2)),
    motor: motor?.name,
    stops: cylinders.map((c, i) => {
      const onBottom = i < perLine;
      const k = onBottom ? i : i - perLine;
      const n = onBottom ? perLine : cylinders.length - perLine;
      return {
        cylinder: c.name,
        line: onBottom ? 'bottom' : 'top',
        x: Math.round(((k + 1) * length) / (n + 1)),
        travelMs: 300,
      } satisfies LayoutStop;
    }),
    sensors: [],
    stations: [],
  };
}

/** Layout de la plantilla ACU 4 topes (sensores colocados respecto a sus topes). */
export function acu4Layout(): ConveyorLayout {
  const station = (stop: string, label: string, action: LayoutStation['action'], release: string, ok: string, nok: string): LayoutStation => ({
    stop,
    label,
    action,
    release,
    okSensors: [ok],
    nokSensors: [nok],
    cycleMs: 3000,
  });
  return {
    length: 6000,
    radius: 300,
    direction: 'ccw',
    palletLength: 400,
    palletGap: 20,
    speed: 250,
    pallets: 7,
    motor: 'M01',
    stops: [
      { cylinder: 'C02', presence: 'PX02', line: 'bottom', x: 600, travelMs: 300 },
      { cylinder: 'C03', presence: 'PX05', line: 'bottom', x: 4700, travelMs: 300 },
      { cylinder: 'C04', presence: 'PX06', line: 'bottom', x: 5500, travelMs: 300 },
      { cylinder: 'C01', presence: 'PX01', line: 'top', x: 900, travelMs: 300 },
    ],
    sensors: [
      { signal: 'PX03', role: 'paso', ref: 'C02', offset: 700 },
      { signal: 'PX04', role: 'acumulacion', ref: 'C03', offset: -1500 },
      { signal: 'PX07', role: 'paso', ref: 'C04', offset: 1600 },
      { signal: 'PX08', role: 'acumulacion', ref: 'C01', offset: -1500 },
    ],
    stations: [
      station('C02', 'Robot de carga', 'load', 'ROBOT_CARGA_OK', 'PPE01', 'PPE02'),
      station('C04', 'Robot de descarga', 'unload', 'ROBOT_DESCARGA_OK', 'PPE21', 'PPE22'),
    ],
  };
}
