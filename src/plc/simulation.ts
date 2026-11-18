/**
 * Motor de simulación por ciclos de PLC.
 *
 * Cada ciclo replica cómo se ejecuta el AWL generado:
 *  1. Los flancos se detectan al inicio del ciclo comparando el estado actual
 *     con el del inicio del ciclo anterior (memoria de flanco).
 *  2. Las reglas se evalúan en orden; las condiciones de nivel leen el valor
 *     vivo (una regla anterior del mismo ciclo puede haberlo cambiado).
 *  3. Las acciones son enclavadas (SET/RESET) o alternan la señal.
 *  4. Al final, los inductivos de los cilindros se actualizan.
 *
 * Tras un cambio externo se ejecutan ciclos hasta que el sistema se estabiliza,
 * de modo que las secuencias encadenadas se propagan solas. Si no se estabiliza
 * en MAX_SETTLE ciclos se avisa de una posible oscilación.
 *
 * Mejoras respecto al prototipo original:
 *  - Las reacciones en cadena (una acción que provoca un flanco) ahora se ven.
 *  - Los inductivos de cilindro tienen valor (antes nunca se cumplían).
 *  - El escenario automático fuerza el flanco aunque la señal ya estuviera a 1.
 */

import type { Activation, Condition, Rule, Signal, SignalLevel, SimEvent, SimStep } from '../types';
import { conditionGroups } from './rules';
import { derivedSignals, externalInputs, type DerivedSignal } from './signals';

type States = Record<string, SignalLevel>;

const MAX_SETTLE = 12;

export class Simulator {
  readonly signals: Signal[];
  readonly rules: Rule[];
  readonly derived: DerivedSignal[];
  states: States = {};
  /** Estado al inicio del ciclo anterior (memoria de flancos). */
  private memory: States = {};
  history: SimStep[] = [];
  warnings: string[] = [];
  private t = 0;

  constructor(signals: Signal[], rules: Rule[]) {
    this.signals = signals;
    this.rules = rules;
    this.derived = derivedSignals(signals);
    this.reset();
  }

  /** Vuelve al estado inicial de todas las señales. */
  reset(): void {
    this.states = {};
    this.signals.forEach((s) => (this.states[s.name] = s.initial));
    this.updateDerived();
    this.memory = { ...this.states };
    this.history = [
      {
        time: 0,
        states: { ...this.states },
        previousStates: { ...this.states },
        events: [],
        activations: [],
      },
    ];
    this.warnings = [];
    this.t = 1;
  }

  /** Señales que el usuario puede accionar. */
  inputs(): string[] {
    return externalInputs(this.signals, this.rules);
  }

  /**
   * Aplica cambios externos y ejecuta ciclos hasta estabilizar.
   * Devuelve los pasos añadidos al historial.
   */
  apply(changes: { signal: string; value: SignalLevel }[], description?: string): SimStep[] {
    const events: SimEvent[] = [];
    changes.forEach(({ signal, value }) => {
      const from = this.states[signal] ?? 0;
      if (from === value) return;
      this.states[signal] = value;
      events.push({
        signal,
        value,
        fromValue: from,
        type: value === 1 ? 'Activación' : 'Desactivación',
        description,
      });
    });
    // Los inductivos no se actualizan aquí: el sensor detecta el movimiento
    // al final del ciclo, como en la máquina real.
    return this.settle(events);
  }

  /** Ejecuta un ciclo sin cambios externos y lo registra. */
  idle(): SimStep {
    return this.scan([], true);
  }

  private settle(events: SimEvent[]): SimStep[] {
    const added: SimStep[] = [];
    added.push(this.scan(events, true));
    let scans = 1;
    while (this.lastScanChanged && scans < MAX_SETTLE) {
      const step = this.scan([], false);
      if (step.activations.length > 0) added.push(step);
      scans++;
    }
    if (this.lastScanChanged) {
      const msg =
        'La lógica no se estabiliza tras un cambio: probablemente una regla con "Alternar" se dispara por nivel en cada ciclo.';
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
    }
    return added;
  }

  private lastScanChanged = false;

  private scan(events: SimEvent[], forceRecord: boolean): SimStep {
    const start = { ...this.states };
    const activations: Activation[] = [];

    /** Escrituras de cada salida en este ciclo, en orden de ejecución. */
    type Write = Omit<Activation, 'fromValue' | 'toValue' | 'targetSignal' | 'triggerTime'> & {
      value: SignalLevel;
    };
    const writes = new Map<string, Write[]>();

    this.rules.forEach((rule, ruleIndex) => {
      if (!rule.conditions.length) return;
      const isTrue = (c: Condition): boolean => {
        switch (c.event) {
          case 'Flanco ascendente':
            return this.memory[c.signal] === 0 && start[c.signal] === 1;
          case 'Flanco descendente':
            return this.memory[c.signal] === 1 && start[c.signal] === 0;
          case '==1':
            return this.states[c.signal] === 1;
          case '==0':
            return this.states[c.signal] === 0;
          default:
            return false;
        }
      };
      // Y entre grupos, O dentro de cada grupo (contactos en paralelo).
      const ok = conditionGroups(rule.conditions).every((g) => g.some(isTrue));
      if (!ok) return;

      // Señal que "dispara" la regla: una condición cumplida que ha cambiado;
      // si no hay ninguna, la primera condición cumplida.
      const met = rule.conditions.filter(isTrue);
      const changed = met.map((c) => c.signal).filter((s) => start[s] !== this.memory[s]);
      const trigger = changed[0] ?? met[0]?.signal ?? rule.conditions[0].signal;
      const enabling = rule.conditions.map((c) => c.signal).filter((s) => s !== trigger);

      rule.actions.forEach((a) => {
        const from = this.states[a.signal] ?? 0;
        const to: SignalLevel =
          a.value === 'toggle' ? (from === 1 ? 0 : 1) : a.value === '1' ? 1 : 0;
        this.states[a.signal] = to;
        const list = writes.get(a.signal) ?? [];
        list.push({
          triggerSignals: [trigger],
          enablingConditions: enabling,
          ruleName: rule.name,
          ruleIndex,
          ruleId: rule.id ?? `${rule.name}_${ruleIndex}`,
          value: to,
        });
        writes.set(a.signal, list);
      });
    });

    // Solo cuentan los cambios efectivos al final del ciclo, atribuidos a la
    // última regla que escribió la salida (la que prevalece en el PLC).
    writes.forEach((list, target) => {
      const values = new Set(list.map((w) => w.value));
      if (values.size > 1) {
        const a = list.find((w) => w.value !== list[list.length - 1].value)!;
        const b = list[list.length - 1];
        const msg = `Conflicto en «${target}»: «${a.ruleName}» la pone a ${a.value} y «${b.ruleName}» a ${b.value} en el mismo ciclo. En el PLC prevalece la última (${b.ruleName}); revisa que no puedan cumplirse a la vez.`;
        if (!this.warnings.includes(msg)) this.warnings.push(msg);
      }
      const begin = start[target] ?? 0;
      const end = this.states[target];
      if (begin === end) return;
      const { value: _v, ...w } = list[list.length - 1];
      void _v;
      activations.push({ ...w, targetSignal: target, triggerTime: this.t, fromValue: begin, toValue: end });
    });

    this.updateDerived();
    this.memory = start;
    this.lastScanChanged = Object.keys(this.states).some((k) => this.states[k] !== start[k]);

    const step: SimStep = {
      time: this.t,
      states: { ...this.states },
      previousStates: start,
      events,
      activations,
    };
    if (forceRecord || activations.length > 0) {
      this.history.push(step);
      this.t++;
    }
    return step;
  }

  private updateDerived(): void {
    this.derived.forEach((d) => {
      const v = this.states[d.source] ?? 0;
      this.states[d.name] = (d.inverted ? 1 - v : v) as SignalLevel;
    });
  }
}

/**
 * Escenario automático: recorre las reglas y fuerza las entradas necesarias
 * para que se cumpla cada una, dejando que el sistema reaccione.
 */
export function runAutoScenario(signals: Signal[], rules: Rule[], minSteps = 20): Simulator {
  const sim = new Simulator(signals, rules);
  const inputs = new Set(sim.inputs());

  const isEdge = (e: string) => e === 'Flanco ascendente' || e === 'Flanco descendente';
  const derived = new Set(sim.derived.map((d) => d.name));
  const demonstrated = () =>
    new Set(sim.history.flatMap((h) => h.activations.map((a) => a.ruleId)));

  rules.forEach((rule, ruleIndex) => {
    const id = rule.id ?? `${rule.name}_${ruleIndex}`;
    // Ya se vio su efecto (p. ej. dentro de una secuencia encadenada).
    if (demonstrated().has(id)) return;

    // Forzar las salidas al estado contrario para que el efecto sea visible.
    const prep = rule.actions
      .filter((a) => a.value !== 'toggle' && !derived.has(a.signal))
      .map((a) => ({ signal: a.signal, value: (a.value === '1' ? 0 : 1) as SignalLevel }))
      .filter((x) => sim.states[x.signal] !== x.value);
    if (prep.length) sim.apply(prep, 'Forzado de prueba');

    // De cada grupo «O» basta con cumplir una condición: se usa la primera
    // que sea una entrada libre. Primero los permisivos (nivel) y después
    // los flancos que disparan.
    const chosen = conditionGroups(rule.conditions).map((g) => g.find((c) => inputs.has(c.signal)) ?? g[0]);
    const ordered = [...chosen].sort(
      (a, b) => Number(isEdge(a.event)) - Number(isEdge(b.event)),
    );
    ordered.forEach((c) => {
      if (!inputs.has(c.signal)) return;
      const current = sim.states[c.signal];
      const desc = `Regla «${rule.name}»`;
      if (c.event === 'Flanco ascendente') {
        if (current === 1) sim.apply([{ signal: c.signal, value: 0 }], desc);
        sim.apply([{ signal: c.signal, value: 1 }], desc);
      } else if (c.event === 'Flanco descendente') {
        if (current === 0) sim.apply([{ signal: c.signal, value: 1 }], desc);
        sim.apply([{ signal: c.signal, value: 0 }], desc);
      } else {
        sim.apply([{ signal: c.signal, value: c.event === '==1' ? 1 : 0 }], desc);
      }
    });
    sim.idle();
  });

  // Soltar todas las entradas al final.
  const release = [...inputs]
    .filter((s) => sim.states[s] === 1)
    .map((signal) => ({ signal, value: 0 as SignalLevel }));
  if (release.length) sim.apply(release, 'Reposo de entradas');

  while (sim.history.length < minSteps) sim.idle();
  return sim;
}

/** Compatibilidad: devuelve solo el historial del escenario automático. */
export function runSimulation(signals: Signal[], rules: Rule[]): SimStep[] {
  return runAutoScenario(signals, rules).history;
}
