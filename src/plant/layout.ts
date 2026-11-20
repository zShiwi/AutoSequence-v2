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

/**
 * Punto de entrada de paletas: siempre el mismo, al principio de la cola del
 * pre-tope que va antes de la carga (o del pre-tope con más sitio). Las paletas
 * nuevas entran ahí y avanzan hasta acumularse; así nunca aparecen dentro de
 * una zona (entre un pre-tope y su tope, o antes de un sensor de paso).
 */
export function palletEntry(l: ConveyorLayout): { stop: string; stopS: number; s: number; slots: number } | null {
  const pitch = l.palletLength + l.palletGap;
  const L = loopLength(l);
  const stops = l.stops.map((t) => ({ c: t.cylinder, s: stopS(l, t) })).sort((a, b) => a.s - b.s);
  if (!stops.length) return null;
  const info = stops.map((t, i) => {
    const prev = stops[(i - 1 + stops.length) % stops.length];
    const upstream = stops.length === 1 ? L : ahead(prev.s, t.s, L);
    const after = l.sensors.filter((x) => x.ref === prev.c && x.offset > 0).reduce((m, x) => Math.max(m, x.offset), 0);
    return { stop: t.c, stopS: t.s, prev: prev.c, room: upstream - after - pitch };
  });
  const withStation = new Set(l.stations.map((s) => s.stop));
  const load = l.stations.find((s) => s.action === 'load');
  const loadPrev = load ? info.find((x) => x.stop === load.stop)?.prev : undefined;
  const byRoom = (list: typeof info) => [...list].sort((a, b) => b.room - a.room)[0];
  const pick =
    info.find((q) => q.stop === loadPrev && !withStation.has(q.stop)) ??
    byRoom(info.filter((q) => !withStation.has(q.stop))) ??
    byRoom(info);
  if (!pick || pick.room < l.palletLength) return null;
  const slots = Math.floor((pick.room - l.palletLength) / pitch) + 1;
  return { stop: pick.stop, stopS: pick.stopS, slots, s: wrap(pick.stopS - (slots - 1) * pitch, L) };
}

/**
 * Colas donde se pueden dejar paletas: los pre-topes y el sitio que tienen
 * detrás (hasta el último sensor de paso del tope anterior). Si ningún
 * pre-tope tiene sitio, valen las colas de los topes con estación.
 */
export function queuePool(l: ConveyorLayout): { cylinder: string; s: number; room: number }[] {
  const len = l.palletLength;
  const pitch = len + l.palletGap;
  const L = loopLength(l);
  const stops = l.stops.map((t) => ({ cylinder: t.cylinder, s: stopS(l, t) })).sort((a, b) => a.s - b.s);
  if (!stops.length) return [];
  const withStation = new Set(l.stations.filter((st) => stops.some((t) => t.cylinder === st.stop)).map((st) => st.stop));
  const queues = stops
    .map((t, i) => {
      const prev = stops[(i - 1 + stops.length) % stops.length];
      const upstream = stops.length === 1 ? L : ahead(prev.s, t.s, L);
      // No invadir la zona del tope anterior: hasta su último sensor de paso.
      const after = l.sensors.filter((x) => x.ref === prev.cylinder && x.offset > 0).reduce((m, x) => Math.max(m, x.offset), 0);
      return { cylinder: t.cylinder, s: t.s, room: upstream - after - pitch, station: withStation.has(t.cylinder) };
    })
    .filter((q) => q.room >= len);
  const pre = queues.filter((q) => !q.station);
  return (pre.length ? pre : queues).map(({ cylinder, s, room }) => ({ cylinder, s, room }));
}

/**
 * Paletas que caben como mucho sin dejar ninguna dentro de una zona. Es la
 * capacidad que usa la planta (`Plant.capacity()`) y la que se valida.
 */
export function layoutCapacity(l: ConveyorLayout): number {
  const len = l.palletLength;
  const pitch = len + l.palletGap;
  if (!(pitch > 0) || !(len > 0)) return 0;
  if (!l.stops.length) return Math.max(0, Math.floor(loopLength(l) / pitch));
  return queuePool(l).reduce((n, q) => n + Math.floor((q.room - len) / pitch) + 1, 0);
}

/** El sensor de presencia está en el propio tope, justo antes del punto de parada. */
export const PRESENCE_BEFORE_STOP = 30;

// ---- Validación -----------------------------------------------------------

export interface LayoutIssue {
  level: 'error' | 'warn';
  text: string;
  /** Campo del editor al que se refiere (para mostrar el aviso junto a él). */
  field?: 'pallets';
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
  // La misma capacidad que usa la planta: si se configuran más paletas, las
  // que sobran no llegan a entrar y hay que decirlo donde se configuran.
  if (l.length > 0 && l.radius > 0 && l.palletLength > 0) {
    const capacity = layoutCapacity(l);
    const whole = Math.floor(L / (l.palletLength + l.palletGap));
    const n = Math.max(0, Math.floor(l.pallets));
    if (n > capacity) {
      const extra = n - capacity;
      const fit = capacity === 1 ? 'solo cabe 1' : capacity === 0 ? 'no cabe ninguna' : `solo caben ${capacity}`;
      const why =
        capacity < whole
          ? ' sin dejar ninguna dentro de una zona (entre un tope y el siguiente sensor de paso). Reduce las paletas o deja más cola antes de los pre-topes.'
          : ` en ${Math.round(L)} mm de lazo. Reduce las paletas o alarga el transportador.`;
      issues.push({
        level: 'warn',
        field: 'pallets',
        text: `Hay ${n} paletas configuradas y ${fit}${why} ${extra === 1 ? 'La que sobra no entrará' : `Las ${extra} que sobran no entrarán`} en el lazo.`,
      });
    }
  }
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
  // Acumulación máxima demasiado cerca de su tope: salta con pocas paletas en
  // cola y las zonas pueden bloquearse entre sí. Debe ir al principio de la
  // cola, justo después del sensor de paso del tope anterior.
  const pitch = l.palletLength + l.palletGap;
  const ordered = l.stops.map((t) => ({ c: t.cylinder, s: stopS(l, t) })).sort((a, b) => a.s - b.s);
  l.sensors
    .filter((x) => x.role === 'acumulacion' && x.ref !== 'left' && x.offset < 0)
    .forEach((x) => {
      const i = ordered.findIndex((t) => t.c === x.ref);
      if (i < 0 || ordered.length < 2) return;
      const prev = ordered[(i - 1 + ordered.length) % ordered.length];
      const after = l.sensors.filter((y) => y.ref === prev.c && y.offset > 0).reduce((m, y) => Math.max(m, y.offset), 0);
      const room = ahead(prev.s, ordered[i].s, L) - after;
      const queue = Math.ceil(-x.offset / pitch);
      if (-x.offset < room * 0.6)
        issues.push({
          level: 'warn',
          text: `${x.signal} (acumulación máxima) está a ${-x.offset} mm de ${x.ref}: con ${queue} paletas en cola ya se activa y las zonas pueden bloquearse entre sí. Colócalo al principio de la cola, a unos ${Math.round((room - pitch) / 100) * 100} mm antes de ${x.ref}.`,
        });
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

/** Curva donde las paletas suben (la que más esfuerzo pide al motor). */
export function liftEnd(l: Pick<ConveyorLayout, 'direction'>): 'left' | 'right' {
  return l.direction === 'cw' ? 'left' : 'right';
}

export function motorEnd(l: ConveyorLayout): 'left' | 'right' {
  return l.motorEnd ?? liftEnd(l);
}

/**
 * Layout inicial. Aéreo: el primer tope (pre-carga) arriba y el resto abajo,
 * donde se carga y descarga. De suelo, al revés.
 */
export function defaultLayout(signals: Signal[], kind: ConveyorLayout['kind'] = 'aereo'): ConveyorLayout {
  const cylinders = signals.filter((s) => s.type === 'Cilindro' && !validateSignalName(s.name));
  const motor = signals.find((s) => s.type === 'Motor');
  const sensors = new Set(signals.filter((s) => s.type === 'Sensor').map((s) => s.name));
  const length = 6000;
  const work: ConveyorLine = kind === 'suelo' ? 'top' : 'bottom';
  const other: ConveyorLine = work === 'top' ? 'bottom' : 'top';
  const onWork = cylinders.length > 1 ? cylinders.length - 1 : cylinders.length;
  return {
    length,
    radius: 300,
    direction: 'ccw',
    kind,
    palletLength: 400,
    palletGap: 20,
    speed: 250,
    pallets: Math.max(2, Math.min(8, cylinders.length + 2)),
    motor: motor?.name,
    stops: cylinders.map((c, i) => {
      const first = i === 0 && cylinders.length > 1; // pre-carga, en el otro ramal
      const k = first ? 0 : cylinders.length > 1 ? i - 1 : i;
      return {
        cylinder: c.name,
        // La presencia enlazada al cilindro en Señales va en el propio tope.
        ...(c.presence && sensors.has(c.presence) ? { presence: c.presence } : {}),
        line: first ? other : work,
        x: first ? Math.round(length * 0.15) : Math.round(((k + 1) * length) / (onWork + 1)),
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
    kind: 'aereo',
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
      { signal: 'PX04', role: 'acumulacion', ref: 'C03', offset: -3100 },
      { signal: 'PX07', role: 'paso', ref: 'C04', offset: 1600 },
      { signal: 'PX08', role: 'acumulacion', ref: 'C01', offset: -4500 },
    ],
    stations: [
      station('C02', 'Robot de carga', 'load', 'ROBOT_CARGA_OK', 'PPE01', 'PPE02'),
      station('C04', 'Robot de descarga', 'unload', 'ROBOT_DESCARGA_OK', 'PPE21', 'PPE22'),
    ],
  };
}
