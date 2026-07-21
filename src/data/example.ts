/**
 * Ejemplo de sistema industrial precargado.
 *
 * Portado de `loadIndustrialExample()` del index.html original.
 */

import type { Rule, Signal } from '../types';

export function exampleSignals(): Signal[] {
  return [
    { name: 'VI-2-SCT1', type: 'Sensor', initial: 0, description: 'Torque Monitoring' },
    { name: 'torque_alarm', type: 'Virtual', initial: 0, description: 'Torque Alarm' },
    { name: 'reset_failures', type: 'Motor', initial: 0, description: 'Reset Failures' },
    { name: 'conveyor_motor', type: 'Motor', initial: 0, description: 'Conveyor Motor' },
  ];
}

export function exampleRules(): Rule[] {
  const now = Date.now();
  return [
    {
      id: now + 1,
      name: 'VI-2-SCT1 → torque_alarm+conveyor_motor',
      conditions: [
        { signal: 'VI-2-SCT1', event: 'Flanco ascendente', delay: 0, operator: 'AND' },
      ],
      actions: [
        { signal: 'torque_alarm', value: '1' },
        { signal: 'conveyor_motor', value: '0' },
      ],
    },
    {
      id: now + 2,
      name: 'reset_failures → torque_alarm',
      conditions: [
        { signal: 'reset_failures', event: 'Flanco ascendente', delay: 0, operator: 'AND' },
      ],
      actions: [{ signal: 'torque_alarm', value: '0' }],
    },
  ];
}
