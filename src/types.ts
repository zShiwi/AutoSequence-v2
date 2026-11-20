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
  /**
   * Solo cilindros de tope: sensor (señal tipo Sensor) que detecta la paleta
   * parada en ese tope. El transportador lo coloca en el propio tope.
   */
  presence?: string;
  /**
   * Dirección asignada en el PLC («E 0.3», «A 1.0», «M 2.7»). Se guarda para
   * que no cambie al añadir o borrar otras señales; a un proyecto antiguo que
   * no la trae se le asigna al abrirlo (ver `ensureAddresses`).
   */
  address?: string;
  /** Solo cilindros: dirección (entrada) del inductivo activo. */
  inductivoActivoAddress?: string;
  /** Solo cilindros: dirección (entrada) del inductivo de reposo. */
  inductivoReposoAddress?: string;
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

// ---- Transportador (simulación visual) -------------------------------------

export type ConveyorLine = 'top' | 'bottom';
export type ConveyorKind = 'aereo' | 'suelo';

/**
 * Tope neumático del transportador. Sus inductivos de activo/reposo son los
 * del cilindro y el sensor de presencia está en el propio tope.
 */
export interface LayoutStop {
  /** Señal del cilindro (SET = abre y deja pasar la paleta). */
  cylinder: string;
  /** Sensor de presencia de paleta en el tope. */
  presence?: string;
  line: ConveyorLine;
  /** Distancia desde el extremo izquierdo del transportador (mm). */
  x: number;
  /** Tiempo de recorrido del cilindro (ms). */
  travelMs: number;
}

export type SensorRole = 'paso' | 'acumulacion' | 'otro';

/** Sensor suelto (paso de paleta, acumulación máxima…). */
export interface LayoutSensor {
  signal: string;
  role: SensorRole;
  /** Referencia: el cilindro de un tope, o «left» = extremo izquierdo. */
  ref: string;
  /** Solo con ref = «left»: línea donde está. */
  line?: ConveyorLine;
  /**
   * Distancia en mm. Respecto a un tope: positiva = después del tope (en el
   * sentido de avance), negativa = antes. Respecto al extremo: desde la izquierda.
   */
  offset: number;
}

/** Estación de trabajo (robot u operario) en un tope. */
export interface LayoutStation {
  /** Cilindro del tope donde se para la paleta. */
  stop: string;
  label: string;
  action: 'load' | 'unload';
  /** Señal que la estación activa al terminar (p. ej. «robot OK»). */
  release?: string;
  /** Sensores de pieza que valen 1 con la paleta procesada. */
  okSensors: string[];
  /** Sensores de pieza que valen 0 (pieza mal colocada). */
  nokSensors: string[];
  cycleMs: number;
}

export interface ConveyorLayout {
  /** Longitud del transportador entre ejes de tambores (mm). */
  length: number;
  /** Radio de las curvas (mm). */
  radius: number;
  /** ccw: abajo avanza hacia la derecha y arriba hacia la izquierda. */
  direction: 'ccw' | 'cw';
  palletLength: number;
  /** Separación mínima entre paletas acumuladas (mm). */
  palletGap: number;
  /** Velocidad de la cadena (mm/s). */
  speed: number;
  pallets: number;
  /** Señal del motor; sin motor, la cadena siempre avanza. */
  motor?: string;
  /**
   * Lazo vertical: las paletas van por el ramal de arriba y vuelven colgadas
   * por el de abajo. Aéreo (por defecto): se carga por abajo. De suelo: se
   * carga por arriba.
   */
  kind?: ConveyorKind;
  /** Extremo del motor; por defecto, la curva donde suben las paletas. */
  motorEnd?: 'left' | 'right';
  stops: LayoutStop[];
  sensors: LayoutSensor[];
  stations: LayoutStation[];
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
  /** Transportador para la simulación visual (opcional). */
  layout?: ConveyorLayout;
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
