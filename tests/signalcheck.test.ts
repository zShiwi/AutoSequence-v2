import { describe, expect, it } from 'vitest';
import { canMoveRefs, signalProblems } from '../src/plc/signalcheck';
import type { Signal } from '../src/types';

const sensor = (name: string): Signal => ({ name, type: 'Sensor', initial: 0, description: '' });
const cyl = (name: string, activo?: string, reposo?: string): Signal => ({
  name,
  type: 'Cilindro',
  initial: 0,
  description: '',
  ...(activo ? { inductivoActivo: activo } : {}),
  ...(reposo ? { inductivoReposo: reposo } : {}),
});

describe('Validación de la tabla de señales', () => {
  it('una tabla correcta no tiene avisos', () => {
    expect(signalProblems([sensor('PX01'), cyl('C01', 'C01PX2', 'C01PX1'), cyl('C02', 'C02PX2', 'C02PX1')]).size).toBe(0);
  });

  it('detecta nombres vacíos, no válidos y repetidos', () => {
    const p = signalProblems([sensor('PX01'), sensor(''), sensor('B 1'), sensor('PX01')]);
    expect(p.get(0)?.text).toBe('«PX01» está repetido');
    expect(p.get(1)?.field).toBe('name');
    expect(p.get(2)?.text).toContain('sin espacios');
    expect(p.get(3)?.text).toBe('«PX01» está repetido');
  });

  it('dos cilindros no pueden compartir inductivo', () => {
    const p = signalProblems([cyl('A', 'X', 'A0'), cyl('B', 'X', 'B0')]);
    expect(p.has(0)).toBe(false);
    expect(p.get(1)).toEqual({ text: 'El inductivo «X» ya es de A', field: 'inductivoActivo' });
  });

  it('el inductivo activo y el de reposo de un cilindro deben ser distintos', () => {
    const p = signalProblems([cyl('A', 'X', 'X')]);
    expect(p.get(0)).toEqual({ text: 'El inductivo «X» no puede ser a la vez activo y de reposo', field: 'inductivoReposo' });
  });

  it('los inductivos cumplen las mismas reglas de nombre que las señales', () => {
    const p = signalProblems([cyl('A', 'mal nombre', 'A0'), cyl('B', 'B1', 'x'.repeat(25))]);
    expect(p.get(0)?.field).toBe('inductivoActivo');
    expect(p.get(0)?.text).toContain('Inductivo activo');
    expect(p.get(1)?.field).toBe('inductivoReposo');
    expect(p.get(1)?.text).toContain('máximo 24');
  });

  it('un inductivo no puede llamarse como una señal, ni al revés', () => {
    const p = signalProblems([sensor('PX01'), cyl('A', 'PX01', 'A0'), sensor('A0')]);
    expect(p.get(1)).toEqual({ text: 'El inductivo «PX01» coincide con otra señal', field: 'inductivoActivo' });
    expect(p.get(2)?.text).toBe('«A0» ya es el nombre de un inductivo');
  });

  it('los inductivos de una señal que ya no es cilindro no cuentan', () => {
    const viejo: Signal = { ...sensor('S'), inductivoActivo: 'X' };
    expect(signalProblems([viejo, cyl('A', 'X', 'A0')]).size).toBe(0);
  });
});

describe('Renombrar: cuándo se llevan las referencias', () => {
  // La tabla se pasa como queda después de escribir el nombre nuevo.
  it('a un nombre libre y válido, sí', () => {
    expect(canMoveRefs([sensor('PX09'), sensor('PX02')], 'PX01', 'PX09')).toBe(true);
    expect(canMoveRefs([cyl('C01', 'C01A', 'C01PX1')], 'C01PX2', 'C01A')).toBe(true);
  });

  it('a un nombre que ya tiene otra señal o un inductivo, no', () => {
    expect(canMoveRefs([sensor('PX02'), sensor('PX02')], 'PX01', 'PX02')).toBe(false);
    expect(canMoveRefs([sensor('C01PX2'), cyl('C01', 'C01PX2', 'C01PX1')], 'PX01', 'C01PX2')).toBe(false);
  });

  it('a un nombre vacío o no válido, no', () => {
    expect(canMoveRefs([sensor('')], 'PX01', '')).toBe(false);
    expect(canMoveRefs([sensor('B 1')], 'PX01', 'B 1')).toBe(false);
  });

  it('si el nombre anterior sigue siendo de otra señal, sus referencias no se tocan', () => {
    // La fila mostraba «PX02» repetido (el original sigue ahí) y se corrige a «PX01».
    expect(canMoveRefs([sensor('PX01'), sensor('PX02')], 'PX02', 'PX01')).toBe(false);
  });
});
