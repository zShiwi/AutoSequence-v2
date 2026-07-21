/**
 * Motor de simulación temporal.
 *
 * Porta fielmente `runSimulation()` y `evaluateRulesAndRecordActivations()`
 * del index.html original, pero como funciones puras: reciben señales y reglas
 * y devuelven el array de pasos, sin tocar el DOM ni variables globales.
 */

import type {
  Activation,
  Rule,
  Signal,
  SignalLevel,
  SimEvent,
  SimStep,
} from '../types';

type States = Record<string, SignalLevel>;

/**
 * Evalúa todas las reglas (AND implícito entre condiciones) sobre el estado
 * actual y registra las activaciones y los cambios de estado en `timeStep`.
 */
export function evaluateRulesAndRecordActivations(
  signalStates: States,
  previousStates: States,
  timeStep: SimStep,
  t: number,
  rulesToEvaluate: Rule[],
): void {
  const processedRuleIds = new Set<string | number>();

  rulesToEvaluate.forEach((rule, ruleIndex) => {
    const conds = rule.conditions || [];
    if (conds.length === 0) return;

    const ruleId = rule.id || `${rule.name}_${ruleIndex}`;
    if (processedRuleIds.has(ruleId)) return;

    const allConditionsMet = conds.every((cond) => {
      const currentVal = signalStates[cond.signal];
      const previousVal = previousStates[cond.signal];
      switch (cond.event) {
        case '==1':
          return currentVal === 1;
        case '==0':
          return currentVal === 0;
        case 'Flanco ascendente':
          return previousVal === 0 && currentVal === 1;
        case 'Flanco descendente':
          return previousVal === 1 && currentVal === 0;
        default:
          return false;
      }
    });

    if (!allConditionsMet) return;
    processedRuleIds.add(ruleId);

    // Señal principal: la que ha tenido transición, o la primera condición.
    const primaryTriggers = rule.conditions
      .filter((cond) => {
        const currentVal = signalStates[cond.signal];
        const previousVal = previousStates[cond.signal];
        if (currentVal === previousVal) return false;
        switch (cond.event) {
          case 'Flanco ascendente':
          case 'Flanco descendente':
            return true;
          case '==1':
            return currentVal === 1;
          case '==0':
            return currentVal === 0;
          default:
            return false;
        }
      })
      .map((c) => c.signal);

    const mainTrigger =
      primaryTriggers.length > 0
        ? primaryTriggers[0]
        : rule.conditions[0].signal;
    if (!mainTrigger) return;

    const enablingConditions = rule.conditions
      .map((c) => c.signal)
      .filter((sig) => sig !== mainTrigger);

    rule.actions.forEach((action) => {
      const targetSig = action.signal;
      const oldValue = signalStates[targetSig];
      const newValue: SignalLevel =
        action.value === 'toggle'
          ? ((1 - oldValue) as SignalLevel)
          : (Number(action.value) as SignalLevel);

      if (newValue !== oldValue) {
        signalStates[targetSig] = newValue;
        const dup = timeStep.activations.some(
          (act) =>
            act.ruleId === ruleId &&
            act.targetSignal === targetSig &&
            act.triggerTime === t,
        );
        if (!dup) {
          const activation: Activation = {
            triggerSignals: [mainTrigger],
            enablingConditions,
            targetSignal: targetSig,
            triggerTime: t,
            fromValue: oldValue,
            toValue: newValue,
            ruleName: rule.name,
            ruleIndex,
            ruleId,
            rule,
          };
          timeStep.activations.push(activation);
        }
      }
    });
  });
}

/**
 * Ejecuta la simulación completa: genera escenarios de prueba a partir de las
 * condiciones de cada regla, aplica los cambios paso a paso, resetea y rellena
 * hasta 20 pasos. Devuelve el array de pasos temporales.
 */
export function runSimulation(signals: Signal[], rules: Rule[]): SimStep[] {
  const simulationData: SimStep[] = [];
  const signalStates: States = {};
  const previousStates: States = {};

  signals.forEach((signal) => {
    signalStates[signal.name] = signal.initial;
    previousStates[signal.name] = signal.initial;
  });

  simulationData.push({
    time: 0,
    states: { ...signalStates },
    previousStates: { ...previousStates },
    events: [],
    activations: [],
  });

  let t = 1;

  const addTimeStep = (events: SimEvent[] = []): void => {
    const timeStep: SimStep = {
      time: t,
      states: { ...signalStates },
      previousStates: { ...previousStates },
      events,
      activations: [],
    };
    evaluateRulesAndRecordActivations(
      signalStates,
      previousStates,
      timeStep,
      t,
      rules,
    );
    simulationData.push(timeStep);
    Object.keys(signalStates).forEach((sig) => {
      previousStates[sig] = signalStates[sig];
    });
    t++;
  };

  // Escenarios de prueba: un paso por condición de cada regla.
  rules.forEach((rule) => {
    rule.conditions.forEach((cond) => {
      const value: SignalLevel =
        cond.event === '==1' || cond.event === 'Flanco ascendente' ? 1 : 0;
      const oldValue = signalStates[cond.signal];
      if (oldValue !== value) {
        signalStates[cond.signal] = value;
        addTimeStep([
          {
            signal: cond.signal,
            type: value === 1 ? 'Activación' : 'Desactivación',
            value,
            fromValue: oldValue,
            description: `${value === 1 ? 'Activar' : 'Desactivar'} ${
              cond.signal
            } para regla ${rule.name}`,
          },
        ]);
      }
    });
    addTimeStep([]);
  });

  // Reset de todas las señales a 0.
  const resetEvents: SimEvent[] = [];
  Object.keys(signalStates).forEach((signal) => {
    if (signalStates[signal] === 1) {
      signalStates[signal] = 0;
      resetEvents.push({ signal, type: 'Reset', value: 0, fromValue: 1 });
    }
  });
  if (resetEvents.length > 0) addTimeStep(resetEvents);

  while (t < 20) addTimeStep([]);

  return simulationData;
}
