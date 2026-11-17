/**
 * Modelo de dominio de AutoSequence.
 *
 * Los valores de las cadenas (eventos, valores de acción, tipos de señal) se
 * mantienen idénticos a los del prototipo original para conservar la
 * compatibilidad con los proyectos ya guardados en localStorage.
 */

/** Tipo de una señal del sistema. */
export type SignalType = 'Sensor' | 'Motor' | 'Cilindro' | 'Virtual';

/** Estado lógico de una señal. */
export type SignalLevel = 0 | 1;

/** Una señal (entrada, salida, actuador o marca virtual). */
export interface Signal {
  name: string;
  type: SignalType;
  initial: SignalLevel;
  description: string;
  /** Solo cilindros: inductivo de posición extendida (sigue al cilindro). */
  inductivoActivo?: string;
  /** Solo cilindros: inductivo de posición retraída (inverso del cilindro). */
  inductivoReposo?: string;
}

/** Evento que evalúa una condición sobre una señal. */
export type ConditionEvent =
  | 'Flanco ascendente'
  | 'Flanco descendente'
  | '==1'
  | '==0';

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

/** Regla: SI (todas las condiciones) ENTONCES (todas las acciones). */
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

/** Datos del cajetín de la hoja industrial. */
export interface Cajetin {
  pageName: string;
  designer: string;
  creationDate: string;
  modDate: string;
  responsible: string;
  company: string;
  companySubtitle: string;
  docType: string;
  funcAssign: string;
  installation: string;
  installType: string;
  mountLocation: string;
}

/** Proyecto persistido en localStorage. */
export interface Project {
  /** Identificador estable (los proyectos antiguos lo reciben al abrirse). */
  id?: string;
  name: string;
  signals: Signal[];
  /** Copia plana de las reglas de todos los bloques (compatibilidad). */
  rules: Rule[];
  blocks: Block[];
  cajetin?: Partial<Cajetin>;
  createdAt?: number;
  updatedAt?: number;
}

/** Cambio externo aplicado a una señal durante la simulación. */
export interface SimEvent {
  signal: string;
  type: string;
  value: SignalLevel;
  fromValue?: SignalLevel;
  description?: string;
}

/** Disparo de una regla registrado en un ciclo de simulación. */
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
}

/** Estado del sistema al final de un ciclo de simulación. */
export interface SimStep {
  time: number;
  /** Estados al terminar el ciclo. */
  states: Record<string, SignalLevel>;
  /** Estados al empezar el ciclo. */
  previousStates: Record<string, SignalLevel>;
  events: SimEvent[];
  activations: Activation[];
}
