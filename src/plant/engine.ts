/**
 * Simulación de planta del transportador acoplada al PLC simulado.
 *
 * En cada paso de tiempo:
 *  1. Actuadores: el motor y los cilindros siguen las salidas del PLC; cada
 *     cilindro tarda su tiempo de recorrido en abrir o cerrar.
 *  2. Paletas: avanzan a la velocidad de la cadena si el motor está en
 *     marcha; se detienen ante un tope que no esté abierto del todo y se
 *     acumulan detrás de la paleta de delante (sin solaparse).
 *  3. Estaciones: con una paleta parada en su tope, el robot trabaja su
 *     tiempo de ciclo y luego activa su señal de liberación y los sensores
 *     de pieza.
 *  4. Sensores: presencia, paso de paleta, acumulación e inductivos de los
 *     cilindros se calculan de la posición real y se envían al PLC, que
 *     reacciona con sus reglas.
 */

import type { Condition, ConveyorLayout, Rule, Signal, SignalLevel } from '../types';
import { conditionGroups } from '../plc/rules';
import { Simulator } from '../plc/simulation';
import { PRESENCE_BEFORE_STOP, ahead, loopLength, palletEntry, sensorS, stopS, wrap } from './layout';

export interface Pallet {
  id: number;
  /** Posición del frente de la paleta a lo largo del lazo (mm). */
  front: number;
  part: boolean;
  moving: boolean;
}

interface StationState {
  stop: string;
  s: number;
  label: string;
  action: 'load' | 'unload';
  release?: string;
  okSensors: string[];
  nokSensors: string[];
  cycleMs: number;
  pallet: number | null;
  timer: number;
  done: boolean;
  cycles: number;
}

export interface PlantLogEntry {
  t: number;
  ruleId: number | string;
  ruleIndex: number;
  ruleName: string;
  target: string;
  to: SignalLevel;
}

const SUBSTEP_MS = 20;
const AT_STOP_MM = 1;

export class Plant {
  readonly layout: ConveyorLayout;
  readonly sim: Simulator;
  readonly L: number;
  /** Tiempo simulado (ms). */
  time = 0;
  pallets: Pallet[] = [];
  /** Posición de cada cilindro: 0 = cerrado (reposo), 1 = abierto. */
  readonly cylinder = new Map<string, number>();
  readonly stations: StationState[] = [];
  /** Últimas lecturas enviadas al PLC por la planta. */
  readonly readings: Record<string, SignalLevel> = {};
  /** Señales que gobierna la planta (no se pueden accionar a mano). */
  readonly driven = new Set<string>();
  log: PlantLogEntry[] = [];
  /** Punto fijo por donde entran las paletas nuevas. */
  readonly entry: ReturnType<typeof palletEntry> = null;
  /** Paletas pedidas que esperan hueco en el punto de entrada. */
  pending = 0;

  private readonly stopPos: { cylinder: string; s: number; travelMs: number; active?: string; rest?: string }[];
  private readonly points: { signal: string; s: number }[];

  private readonly rules: Rule[];
  /** Tiempo (ms) desde el que ninguna paleta se mueve con el motor en marcha. */
  private stillSince: number | null = null;

  constructor(layout: ConveyorLayout, signals: Signal[], rules: Rule[]) {
    this.layout = layout;
    this.rules = rules;
    this.L = loopLength(layout);
    // La planta mueve los inductivos de los topes; los de los demás
    // cilindros (pinzas, elevadores…) siguen a su cilindro en el simulador.
    this.sim = new Simulator(signals, rules, { externalDerived: layout.stops.map((t) => t.cylinder) });
    const bySignal = new Map(signals.map((s) => [s.name, s]));

    this.stopPos = layout.stops.map((t) => {
      const sig = bySignal.get(t.cylinder);
      return {
        cylinder: t.cylinder,
        s: stopS(layout, t),
        travelMs: Math.max(1, t.travelMs),
        active: sig?.inductivoActivo || undefined,
        rest: sig?.inductivoReposo || undefined,
      };
    });
    this.stopPos.forEach((t) => {
      this.cylinder.set(t.cylinder, this.sim.states[t.cylinder] === 1 ? 1 : 0);
      if (t.active) this.driven.add(t.active);
      if (t.rest) this.driven.add(t.rest);
    });

    this.points = [];
    layout.stops.forEach((t) => {
      if (t.presence) this.points.push({ signal: t.presence, s: wrap(stopS(layout, t) - PRESENCE_BEFORE_STOP, this.L) });
    });
    layout.sensors.forEach((x) => {
      const s = sensorS(layout, x);
      if (s !== null) this.points.push({ signal: x.signal, s });
    });
    this.points.forEach((p) => this.driven.add(p.signal));

    layout.stations.forEach((st) => {
      const stop = this.stopPos.find((t) => t.cylinder === st.stop);
      if (!stop) return;
      this.stations.push({ ...st, s: stop.s, pallet: null, timer: 0, done: false, cycles: 0 });
      if (st.release) this.driven.add(st.release);
      st.okSensors.forEach((s) => this.driven.add(s));
      st.nokSensors.forEach((s) => this.driven.add(s));
    });

    // Paletas acumuladas en las colas de los pre-topes, nunca a medio camino
    // dentro de una zona (eso desajustaría las marcas de tránsito del PLC).
    this.entry = palletEntry(layout);
    const n = Math.max(0, Math.floor(layout.pallets));
    if (this.entry) {
      // Al arrancar, acumuladas en la cola de entrada; las que no caben, en espera.
      const pitch = layout.palletLength + layout.palletGap;
      const placed = Math.min(n, this.entry.slots, this.capacity());
      for (let k = 0; k < placed; k++) {
        this.pallets.push({ id: k + 1, front: wrap(this.entry.stopS - k * pitch, this.L), part: false, moving: false });
      }
      this.pending = Math.min(n, this.capacity()) - placed;
    } else for (let i = 0; i < n && this.addPallet(); i++);
    this.sync();
    this.log = [];
  }

  /** Entradas que el usuario puede accionar (fallos, pulsadores…). */
  manualInputs(): string[] {
    return this.sim.inputs().filter((s) => !this.driven.has(s));
  }

  setManual(signal: string, value: SignalLevel): void {
    this.record(this.sim.apply([{ signal, value }], 'Manual'));
  }

  /** Paletas que caben como mucho sin dejar ninguna dentro de una zona. */
  capacity(): number {
    const { palletLength: len, palletGap: gap } = this.layout;
    if (!this.stopPos.length) return Math.floor(this.L / (len + gap));
    return this.queuePool().reduce((n, q) => n + Math.floor((q.room - len) / (len + gap)) + 1, 0);
  }

  /**
   * Pide una paleta más. Entra siempre por el mismo punto (el principio de la
   * cola de entrada); si ahora está ocupado, espera y entra en cuanto haya
   * hueco. Devuelve false si ya se ha llegado al máximo.
   */
  addPallet(): boolean {
    if (!this.entry) {
      const front = this.largestGapSlot();
      if (front === null) return false;
      this.pallets.push({ id: this.nextId(), front, part: false, moving: false });
      return true;
    }
    if (this.pallets.length + this.pending >= this.capacity()) return false;
    this.pending++;
    this.feed();
    return true;
  }

  private nextId(): number {
    return this.pallets.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  }

  /** Mete una paleta en espera si el punto de entrada está libre. */
  private feed(): void {
    if (!this.pending || !this.entry || !this.free(this.entry.s)) return;
    this.pallets.push({ id: this.nextId(), front: this.entry.s, part: false, moving: false });
    this.pending--;
  }

  /** ¿Cabe una paleta con el frente en f sin tocar a ninguna otra? */
  private free(f: number): boolean {
    const need = this.layout.palletLength + this.layout.palletGap - 1e-6;
    return this.pallets.every((p) => Math.min(ahead(p.front, f, this.L), ahead(f, p.front, this.L)) >= need);
  }

  /** Colas donde se pueden dejar paletas: los pre-topes y el sitio que tienen detrás. */
  private queuePool(): { t: { s: number; cylinder: string }; room: number }[] {
    const { palletLength: len, palletGap: gap } = this.layout;
    const pitch = len + gap;
    const stops = [...this.stopPos].sort((a, b) => a.s - b.s);
    if (!stops.length) return [];
    const withStation = new Set(this.stations.map((s) => s.stop));
    const queues = stops
      .map((t, i) => {
        const prev = stops[(i - 1 + stops.length) % stops.length];
        const upstream = stops.length === 1 ? this.L : ahead(prev.s, t.s, this.L);
        // No invadir la zona del tope anterior: hasta su último sensor de paso.
        const after = this.layout.sensors
          .filter((x) => x.ref === prev.cylinder && x.offset > 0)
          .reduce((m, x) => Math.max(m, x.offset), 0);
        return { t, room: upstream - after - pitch, station: withStation.has(t.cylinder) };
      })
      .filter((q) => q.room >= len);
    const pre = queues.filter((q) => !q.station);
    return pre.length ? pre : queues;
  }

  /** Último recurso: el centro del hueco libre más grande. */
  private largestGapSlot(): number | null {
    const { palletLength: len, palletGap: gap } = this.layout;
    if (!this.pallets.length) return wrap(len + 150, this.L);
    const sorted = [...this.pallets].sort((a, b) => a.front - b.front);
    let best = -1;
    let bestFree = -Infinity;
    sorted.forEach((p, i) => {
      const next = sorted[(i + 1) % sorted.length];
      const free = (sorted.length === 1 ? this.L : ahead(p.front, next.front, this.L)) - len;
      if (free > bestFree) {
        bestFree = free;
        best = i;
      }
    });
    if (bestFree < len + 2 * gap) return null;
    return wrap(sorted[best].front + gap + len + (bestFree - len - 2 * gap) / 2, this.L);
  }

  /**
   * Retira una paleta: primero las que esperan para entrar; si no, la última
   * de la cola de entrada (nunca una que esté dentro de una zona, el PLC se
   * quedaría esperándola). Devuelve false si ahora no hay ninguna que retirar.
   */
  removePallet(): boolean {
    if (this.pending) {
      this.pending--;
      return true;
    }
    if (!this.entry) {
      if (!this.pallets.length) return false;
      const last = this.pallets.reduce((a, b) => (b.id > a.id ? b : a));
      this.pallets = this.pallets.filter((p) => p !== last);
      return true;
    }
    const pitch = this.layout.palletLength + this.layout.palletGap;
    const span = (this.entry.slots - 1) * pitch + 1;
    const inQueue = this.pallets
      .map((p) => ({ p, d: ahead(p.front, this.entry!.stopS + 0.5, this.L) - 0.5 }))
      .filter((x) => x.d <= span)
      .sort((a, b) => b.d - a.d);
    if (!inQueue.length) return false;
    this.pallets = this.pallets.filter((p) => p !== inQueue[0].p);
    return true;
  }

  /** Progreso del trabajo de una estación (0–1), o null si no tiene paleta. */
  stationProgress(stop: string): { pallet: number; progress: number; action: 'load' | 'unload' } | null {
    const st = this.stations.find((s) => s.stop === stop);
    if (!st || st.pallet === null) return null;
    return { pallet: st.pallet, progress: st.done ? 1 : Math.min(1, st.timer / Math.max(1, st.cycleMs)), action: st.action };
  }

  /**
   * Para cada tope con paleta esperando y cerrado: qué condiciones de su regla
   * de apertura faltan (p. ej. «PX08 = 0»). Explica por qué no abre.
   */
  waitingStops(): { cylinder: string; missing: string[] }[] {
    const st = this.sim.states;
    const level = (c: Condition) =>
      c.event === '==1' ? st[c.signal] === 1 : c.event === '==0' ? st[c.signal] === 0 : null; // flancos: no se pueden «esperar»
    const text = (c: Condition) => `${c.signal} = ${c.event === '==0' ? 0 : 1}`;
    return this.layout.stops
      .filter((t) => t.presence && st[t.presence] === 1 && st[t.cylinder] !== 1)
      .map((t) => {
        const openers = this.rules.filter((r) => r.actions.some((a) => a.signal === t.cylinder && a.value === '1'));
        const options = openers.map((r) =>
          conditionGroups(r.conditions)
            .filter((g) => !g.some((c) => level(c) !== false))
            .map((g) => g.map(text).join(' o ')),
        );
        options.sort((a, b) => a.length - b.length);
        return { cylinder: t.cylinder, missing: options[0] ?? [] };
      })
      .filter((x) => x.missing.length);
  }

  /** Segundos que lleva todo parado con el motor en marcha (bloqueo), o 0. */
  blockedFor(): number {
    return this.stillSince === null ? 0 : (this.time - this.stillSince) / 1000;
  }

  motorOn(): boolean {
    return this.layout.motor ? this.sim.states[this.layout.motor] === 1 : true;
  }

  /** Avanza la simulación `ms` milisegundos. */
  step(ms: number): void {
    let left = ms;
    while (left > 0) {
      const h = Math.min(SUBSTEP_MS, left);
      left -= h;
      this.time += h;
      this.moveCylinders(h);
      this.movePallets(h);
      this.runStations(h);
      this.feed();
      this.sync();
      const still = this.motorOn() && this.pallets.length > 0 && this.pallets.every((p) => !p.moving);
      if (!still) this.stillSince = null;
      else if (this.stillSince === null) this.stillSince = this.time;
    }
  }

  // ---- Física -------------------------------------------------------------

  private moveCylinders(h: number): void {
    this.stopPos.forEach((t) => {
      const target = this.sim.states[t.cylinder] === 1 ? 1 : 0;
      const pos = this.cylinder.get(t.cylinder) ?? 0;
      const d = h / t.travelMs;
      this.cylinder.set(t.cylinder, target > pos ? Math.min(1, pos + d) : Math.max(0, pos - d));
    });
  }

  private movePallets(h: number): void {
    const { palletLength: len, palletGap: gap, speed } = this.layout;
    const n = this.pallets.length;
    if (!this.motorOn()) {
      this.pallets.forEach((p) => (p.moving = false));
      return;
    }
    const sorted = [...this.pallets].sort((a, b) => a.front - b.front);
    const next = new Map<number, { move: number; snap?: number }>();
    sorted.forEach((p, i) => {
      let move = (speed * h) / 1000;
      let snap: number | undefined;
      if (n > 1) {
        const front = sorted[(i + 1) % n];
        move = Math.min(move, ahead(p.front, front.front, this.L) - len - gap);
      }
      this.stopPos.forEach((t) => {
        if ((this.cylinder.get(t.cylinder) ?? 0) >= 1) return; // abierto del todo
        const d = this.toStop(p.front, t.s);
        if (d < this.L / 2 && d <= move) {
          move = d;
          snap = t.s; // se detiene exactamente en el tope (sin errores de redondeo)
        }
      });
      next.set(p.id, { move: Math.max(0, move), snap });
    });
    this.pallets.forEach((p) => {
      const { move, snap } = next.get(p.id) ?? { move: 0 };
      p.moving = move > 1e-6;
      p.front = snap !== undefined ? snap : wrap(p.front + move, this.L);
    });
  }

  /**
   * Distancia del frente de una paleta hasta un tope, en el sentido de avance.
   * Un frente que lo ha rebasado por menos de una centésima cuenta como «en el tope».
   */
  private toStop(front: number, stop: number): number {
    const d = ahead(front, stop, this.L);
    return d > this.L - 0.01 ? 0 : d;
  }

  private runStations(h: number): void {
    this.stations.forEach((st) => {
      if (st.pallet === null) {
        const waiting = this.pallets.find((p) => this.toStop(p.front, st.s) < AT_STOP_MM);
        if (waiting) {
          st.pallet = waiting.id;
          st.timer = 0;
          st.done = false;
        }
        return;
      }
      const p = this.pallets.find((x) => x.id === st.pallet);
      const past = p ? ahead(st.s, p.front, this.L) : 0;
      if (!p || (past > 0.01 && past < this.L / 2)) {
        // La paleta se ha ido: la estación queda libre.
        st.pallet = null;
        st.done = false;
        st.timer = 0;
        return;
      }
      if (!st.done) {
        st.timer += h;
        if (st.timer >= st.cycleMs) {
          st.done = true;
          st.cycles++;
          p.part = st.action === 'load';
        }
      }
    });
  }

  // ---- Sensores → PLC -----------------------------------------------------

  /** ¿Hay alguna paleta encima del punto s? */
  covered(s: number): boolean {
    const len = this.layout.palletLength;
    return this.pallets.some((p) => ahead(s, p.front, this.L) <= len);
  }

  private sync(): void {
    const r: Record<string, SignalLevel> = {};
    this.stopPos.forEach((t) => {
      const pos = this.cylinder.get(t.cylinder) ?? 0;
      if (t.active) r[t.active] = pos >= 1 ? 1 : 0;
      if (t.rest) r[t.rest] = pos <= 0 ? 1 : 0;
    });
    this.points.forEach((p) => (r[p.signal] = this.covered(p.s) || r[p.signal] === 1 ? 1 : 0));
    this.stations.forEach((st) => {
      const v: SignalLevel = st.done ? 1 : 0;
      if (st.release) r[st.release] = v;
      st.okSensors.forEach((s) => (r[s] = v));
      st.nokSensors.forEach((s) => (r[s] = 0));
    });
    Object.assign(this.readings, r);
    const changes = Object.entries(r)
      .filter(([k, v]) => this.sim.states[k] !== v)
      .map(([signal, value]) => ({ signal, value }));
    if (changes.length) this.record(this.sim.apply(changes, 'Planta'));
  }

  private record(steps: ReturnType<Simulator['apply']>): void {
    steps.forEach((st) =>
      st.activations.forEach((a) =>
        this.log.push({
          t: this.time,
          ruleId: a.ruleId,
          ruleIndex: a.ruleIndex,
          ruleName: a.ruleName,
          target: a.targetSignal,
          to: a.toValue,
        }),
      ),
    );
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    // El historial del PLC crece con cada cambio: se conserva lo reciente.
    const h = this.sim.history;
    if (h.length > 600) h.splice(0, h.length - 600);
  }

  // ---- Estadísticas -------------------------------------------------------

  stationCycles(): { label: string; cycles: number; perMin: number }[] {
    const min = this.time / 60000;
    return this.stations.map((s) => ({ label: s.label, cycles: s.cycles, perMin: min > 0 ? s.cycles / min : 0 }));
  }
}
