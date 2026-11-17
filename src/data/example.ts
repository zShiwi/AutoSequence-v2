/**
 * Proyecto de ejemplo: estación de transferencia con dos cilindros.
 *
 * Demuestra una secuencia encadenada: al pulsar marcha con pieza presente,
 * el cilindro B bloquea, el A empuja y retrocede, B libera y arranca la cinta.
 * Cada paso lo dispara el inductivo del paso anterior.
 */

import type { Block, Cajetin, Signal } from '../types';

export function exampleSignals(): Signal[] {
  return [
    { name: 'S1_marcha', type: 'Sensor', initial: 0, description: 'Pulsador de marcha' },
    { name: 'S2_paro', type: 'Sensor', initial: 0, description: 'Pulsador de paro' },
    { name: 'B1_pieza', type: 'Sensor', initial: 0, description: 'Detector de pieza en posición' },
    { name: 'M_ciclo', type: 'Virtual', initial: 0, description: 'Ciclo en marcha' },
    {
      name: 'CIL_A',
      type: 'Cilindro',
      initial: 0,
      description: 'Cilindro de empuje',
      inductivoActivo: 'A_ext',
      inductivoReposo: 'A_ret',
    },
    {
      name: 'CIL_B',
      type: 'Cilindro',
      initial: 0,
      description: 'Cilindro de bloqueo',
      inductivoActivo: 'B_ext',
      inductivoReposo: 'B_ret',
    },
    { name: 'M1_cinta', type: 'Motor', initial: 0, description: 'Motor de cinta de salida' },
  ];
}

export function exampleBlocks(): Block[] {
  const id = Date.now();
  return [
    {
      name: 'Secuencia de transferencia',
      rules: [
        {
          id: id + 1,
          name: 'Inicio de ciclo',
          conditions: [
            { signal: 'B1_pieza', event: '==1', delay: 0, operator: 'AND' },
            { signal: 'S1_marcha', event: 'Flanco ascendente', delay: 0, operator: 'AND' },
          ],
          actions: [
            { signal: 'M_ciclo', value: '1' },
            { signal: 'CIL_B', value: '1' },
          ],
        },
        {
          id: id + 2,
          name: 'Bloqueo listo → empujar',
          conditions: [
            { signal: 'B_ext', event: 'Flanco ascendente', delay: 0, operator: 'AND' },
            { signal: 'M_ciclo', event: '==1', delay: 0, operator: 'AND' },
          ],
          actions: [{ signal: 'CIL_A', value: '1' }],
        },
        {
          id: id + 3,
          name: 'Empuje completado → retroceder',
          conditions: [{ signal: 'A_ext', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
          actions: [{ signal: 'CIL_A', value: '0' }],
        },
        {
          id: id + 4,
          name: 'Liberar y evacuar',
          conditions: [
            { signal: 'A_ret', event: 'Flanco ascendente', delay: 0, operator: 'AND' },
            { signal: 'M_ciclo', event: '==1', delay: 0, operator: 'AND' },
          ],
          actions: [
            { signal: 'CIL_B', value: '0' },
            { signal: 'M1_cinta', value: '1' },
          ],
        },
      ],
    },
    {
      name: 'Paro y seguridad',
      rules: [
        {
          id: id + 5,
          name: 'Paro manual',
          conditions: [{ signal: 'S2_paro', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
          actions: [
            { signal: 'M_ciclo', value: '0' },
            { signal: 'M1_cinta', value: '0' },
            { signal: 'CIL_A', value: '0' },
          ],
        },
        {
          id: id + 6,
          name: 'Pieza retirada',
          conditions: [{ signal: 'B1_pieza', event: 'Flanco descendente', delay: 0, operator: 'AND' }],
          actions: [
            { signal: 'M1_cinta', value: '0' },
            { signal: 'M_ciclo', value: '0' },
          ],
        },
      ],
    },
  ];
}

export function exampleCajetin(): Partial<Cajetin> {
  return {
    designer: 'Ingeniería de automatización',
    responsible: 'Jefe de proyecto',
    company: 'Planta de ensayo',
    companySubtitle: 'Departamento de automatización',
    docType: 'Diagrama funcional',
    funcAssign: 'TRF',
    installation: 'L01',
    installType: 'Célula 1',
    mountLocation: 'Armario A1',
  };
}
