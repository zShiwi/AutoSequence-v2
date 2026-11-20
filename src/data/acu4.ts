/**
 * Plantilla: acumulador (ACU) de 4 topes neumáticos y 2 acumulaciones máximas.
 *
 * Basada en la especificación «Programación ACU 4 topes», la presentación
 * «Programación de topes neumáticos» y el ciclograma de referencia de un
 * Stauband (hoja de seguridad del motor + zona de carga + zona de descarga).
 *
 * Reglas de diseño:
 *  - Un tope en reposo está cerrado (no deja pasar paletas). SET = abrir,
 *    RESET = cerrar. PX2 = abierto (activo), PX1 = reposo.
 *  - Cada tope tiene su marca de tránsito (SM), que se activa con el flanco
 *    de apertura y se reinicia con el paso de paleta fuera de interferencia.
 *  - Cada tope queda condicionado por que el SIGUIENTE esté en reposo:
 *    C01 → C02PX1, C02 → C03PX1, C03 → C04PX1, C04 → C01PX1 (lazo cerrado).
 *  - C02 y C04 no abren con máxima acumulación (PX04 / PX08), sin pieza
 *    correcta (PPE) ni sin liberación del robot.
 */

import type { Block, Cajetin, Condition, ConditionEvent, Rule, Signal, ActionValue } from '../types';

const c = (signal: string, event: ConditionEvent): Condition => ({ signal, event, delay: 0, operator: 'AND' });
const a = (signal: string, value: ActionValue) => ({ signal, value });
const on = (s: string) => c(s, '==1');
const off = (s: string) => c(s, '==0');
const up = (s: string) => c(s, 'Flanco ascendente');

const cyl = (name: string, description: string, presence: string): Signal => ({
  name,
  type: 'Cilindro',
  initial: 0,
  description,
  inductivoActivo: `${name}PX2`,
  inductivoReposo: `${name}PX1`,
  presence,
});
const sensor = (name: string, description: string, initial: 0 | 1 = 0): Signal => ({
  name,
  type: 'Sensor',
  initial,
  description,
});
const mark = (name: string, description: string): Signal => ({ name, type: 'Virtual', initial: 0, description });

/**
 * Motor del transportador: siempre el mismo en todo ACU. Tres señales propias
 * (par y los dos inductivos de la cadena), los pulsadores y sus alarmas.
 */
export function motorSignals(): Signal[] {
  return [
    { name: 'M01', type: 'Motor', initial: 1, description: 'Motor del transportador' },
    sensor('PX21', 'Control de par del motor (1 = par OK)', 1),
    sensor('PX22', 'Comprobación de cadena rota (1 = cadena OK)', 1),
    sensor('PX23', 'Control de longitud de cadena (1 = alargada)'),
    sensor('RESET_FALLOS', 'Pulsador reset de fallos'),
    sensor('CYCLE_START', 'Pulsador Cycle Start'),
    mark('AL_PAR', 'Alarma control de par al PLC'),
    mark('AL_CADENA_ROTA', 'Alarma cadena rota al PLC'),
    mark('AL_LONG_CADENA', 'Alarma longitud de cadena (mantenimiento)'),
  ];
}

/** Secuencia de seguridad del motor (igual en todos los ACU). */
export function motorBlock(): Block {
  return {
    name: 'Seguridad motor',
    rules: [
      rule('Fallo de par', [on('M01'), off('PX21')], [a('M01', '0'), a('AL_PAR', '1')]),
      rule('Reset alarma de par', [on('PX21'), up('RESET_FALLOS')], [a('AL_PAR', '0')]),
      rule(
        'Arranque transportador',
        [up('CYCLE_START'), off('AL_PAR'), off('AL_CADENA_ROTA'), on('PX21'), on('PX22')],
        [a('M01', '1')],
      ),
      // Nota: la especificación filtra 2 s antes de disparar (t>2s).
      rule('Cadena rota (t>2s)', [on('M01'), off('PX22')], [a('M01', '0'), a('AL_CADENA_ROTA', '1')]),
      rule('Reset alarma cadena rota', [on('PX22'), up('RESET_FALLOS')], [a('AL_CADENA_ROTA', '0')]),
      rule('Cadena alargada (solo aviso)', [on('PX23')], [a('AL_LONG_CADENA', '1')]),
      rule('Reset aviso longitud', [off('PX23'), up('RESET_FALLOS')], [a('AL_LONG_CADENA', '0')]),
    ],
  };
}

export function acu4Signals(): Signal[] {
  return [
    ...motorSignals(),
    // Zona de carga
    sensor('PX01', 'Paleta en tope de pre-carga'),
    cyl('C01', 'Tope de pre-carga · DSBC-40-50-PPSA-N3', 'PX01'),
    mark('SM_C01', 'Tránsito pre-carga (C01 → paso paleta)'),
    sensor('PX02', 'Paleta en tope de carga'),
    sensor('PPE01', 'Control de pieza carga 1 (debe detectar)'),
    sensor('PPE02', 'Control de pieza carga 2 (no debe detectar)'),
    sensor('ROBOT_CARGA_OK', 'Robot: liberación de zona de carga'),
    cyl('C02', 'Tope de carga · DSBC-40-50-PPSA-N3', 'PX02'),
    mark('SM_C02', 'Tránsito carga (C02 → paso paleta)'),
    sensor('PX03', 'Paleta fuera de interferencia (carga)'),
    sensor('PX04', 'Máxima acumulación antes de pre-descarga'),
    // Zona de descarga
    sensor('PX05', 'Paleta en tope de pre-descarga'),
    cyl('C03', 'Tope de pre-descarga · DSBC-40-50-PPSA-N3', 'PX05'),
    mark('SM_C03', 'Tránsito pre-descarga (C03 → paso paleta)'),
    sensor('PX06', 'Paleta en tope de descarga'),
    sensor('PPE21', 'Control de pieza descarga 1 (debe detectar)'),
    sensor('PPE22', 'Control de pieza descarga 2 (no debe detectar)'),
    sensor('ROBOT_DESCARGA_OK', 'Robot: liberación de zona de descarga'),
    cyl('C04', 'Tope de descarga · DSBC-40-50-PPSA-N3', 'PX06'),
    mark('SM_C04', 'Tránsito descarga (C04 → paso paleta)'),
    sensor('PX07', 'Paleta fuera de interferencia (descarga)'),
    sensor('PX08', 'Máxima acumulación antes de pre-carga'),
  ];
}

let seq = 0;
function rule(name: string, conditions: Condition[], actions: Rule['actions']): Rule {
  return { id: Date.now() * 100 + seq++, name, conditions, actions };
}

/** Lógica de una zona (pre-tope + tope) con su paso de paleta. */
function zone(o: {
  pre: string;
  preName: string;
  prePresence: string;
  stop: string;
  stopName: string;
  stopPresence: string;
  partOk: string;
  partNok: string;
  robot: string;
  maxAcc: string;
  outOfInterference: string;
  nextOfStop: string;
}): Rule[] {
  const smPre = `SM_${o.pre}`;
  const smStop = `SM_${o.stop}`;
  return [
    rule(
      `Abrir ${o.preName}`,
      [on(o.prePresence), off(smPre), off(o.stopPresence), on(`${o.stop}PX1`)],
      [a(o.pre, '1')],
    ),
    rule(`Tránsito ${o.preName}`, [up(`${o.pre}PX2`)], [a(smPre, '1')]),
    rule(`Cerrar ${o.preName}`, [off(o.prePresence), on(`${o.pre}PX2`)], [a(o.pre, '0')]),
    rule(
      `Abrir ${o.stopName}`,
      [
        on(o.stopPresence),
        on(o.partOk),
        off(o.partNok),
        on(o.robot),
        off(smStop),
        off(o.maxAcc),
        on(`${o.nextOfStop}PX1`),
      ],
      [a(o.stop, '1')],
    ),
    rule(`Tránsito ${o.stopName}`, [up(`${o.stop}PX2`)], [a(smStop, '1')]),
    rule(`Cerrar ${o.stopName}`, [off(o.stopPresence), on(`${o.stop}PX2`)], [a(o.stop, '0')]),
    rule(`Paso paleta ${o.stopName}`, [up(o.outOfInterference)], [a(smPre, '0'), a(smStop, '0')]),
  ];
}

export function acu4Blocks(): Block[] {
  seq = 0;
  return [
    motorBlock(),
    {
      name: 'Zona de carga',
      rules: zone({
        pre: 'C01',
        preName: 'pre-carga',
        prePresence: 'PX01',
        stop: 'C02',
        stopName: 'carga',
        stopPresence: 'PX02',
        partOk: 'PPE01',
        partNok: 'PPE02',
        robot: 'ROBOT_CARGA_OK',
        maxAcc: 'PX04',
        outOfInterference: 'PX03',
        nextOfStop: 'C03',
      }),
    },
    {
      name: 'Zona de descarga',
      rules: zone({
        pre: 'C03',
        preName: 'pre-descarga',
        prePresence: 'PX05',
        stop: 'C04',
        stopName: 'descarga',
        stopPresence: 'PX06',
        partOk: 'PPE21',
        partNok: 'PPE22',
        robot: 'ROBOT_DESCARGA_OK',
        maxAcc: 'PX08',
        outOfInterference: 'PX07',
        nextOfStop: 'C01',
      }),
    },
  ];
}

export function acu4Cajetin(): Partial<Cajetin> {
  return {
    docType: 'Ciclograma',
    funcAssign: 'ACU',
    installation: 'Acumulador 4 topes',
    installType: '',
    mountLocation: '',
  };
}
