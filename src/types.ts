/**
 * Modelo de dominio de AutoSequence.
 *
 * Portado del index.html original (variables globales `signals`, `rules`,
 * `blocks`, `simulationData`, ...) a tipos explícitos. Los valores de las
 * cadenas (eventos, valores de acción, tipos de señal) se mantienen idénticos
 * a los del original para conservar la compatibilidad de los proyectos ya
 * guardados en `localStorage`.
 */

/** Tipo de una señal del sistema. */
export type SignalType = 'Sensor' | 'Motor' | 'Cilindro' | 'Virtual';

/** Estado lógico de una señal. */
export type SignalLevel = 0 | 1;

/** Una señal (entrada, salida, actuador o señal virtual). */
export interface Signal {
  name: string;
  type: SignalType;
  initial: SignalLevel;
  description: string;
  /** Solo para cilindros: nombre del inductivo en posición extendida. */
  inductivoActivo?: string;
  /** Solo para cilindros: nombre del inductivo en posición retraída. */
  inductivoReposo?: string;
}

/** Evento que evalúa una condición sobre una señal. */
export type ConditionEvent =
  | 'Flanco ascendente'
  | 'Flanco descendente'
  | '==1'
  | '==0';

/** Operador lógico entre condiciones (por ahora siempre AND en el builder). */
export type ConditionOperator = 'AND' | 'OR';

/** Condición de una regla: "SI señal cumple evento". */
export interface Condition {
  signal: string;
  event: ConditionEvent;
  delay: number;
  operator: ConditionOperator;
}

/** Valor que una acción asigna a una señal. */
export type ActionValue = '0' | '1' | 'toggle';

/** Acción de una regla: "ENTONCES señal = valor". */
export interface Action {
  signal: string;
  value: ActionValue;
}

/** Regla de automatización: SI (condiciones AND) ENTONCES (acciones). */
export interface Rule {
  id: number;
  name: string;
  conditions: Condition[];
  actions: Action[];
}

/** Bloque/función que agrupa reglas. */
export interface Block {
  name: string;
  rules: Rule[];
}

/** Proyecto persistido en localStorage. */
export interface Project {
  name: string;
  signals: Signal[];
  rules: Rule[];
  blocks: Block[];
}

/** Evento registrado en un paso de simulación. */
export interface SimEvent {
  signal: string;
  type: string;
  value: SignalLevel;
  fromValue?: SignalLevel;
  description?: string;
}

/** Activación de una regla registrada en un paso de simulación. */
export interface Activation {
  triggerSignals: string[];
  enablingConditions: string[];
  targetSignal: string;
  triggerTime: number;
  fromValue: SignalLevel;
  toValue: SignalLevel;
  ruleName: string;
  ruleIndex: number;
  ruleId: number | string;
  rule: Rule;
}

/** Estado del sistema en un instante de la simulación. */
export interface SimStep {
  time: number;
  states: Record<string, SignalLevel>;
  previousStates: Record<string, SignalLevel>;
  events: SimEvent[];
  activations: Activation[];
}
