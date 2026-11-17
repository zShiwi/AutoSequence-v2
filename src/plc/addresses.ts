/**
 * Asignación automática de direcciones (tabla de símbolos).
 *
 * Nemotecnia alemana de STEP 7 (la misma que AWL/KOP):
 *  - E: entradas  (sensores e inductivos)
 *  - A: salidas   (motores y cilindros)
 *  - M: marcas    (señales virtuales, memorias de flanco y auxiliares)
 */

import type { Signal } from '../types';
import { derivedSignals } from './signals';

export type Area = 'E' | 'A' | 'M';

export interface SymbolEntry {
  symbol: string;
  area: Area;
  address: string;
  comment: string;
}

/** Primer byte de marcas reservado para señales virtuales. */
export const MARKER_BASE_BYTE = 0;
/** Bytes de marcas reservados para memorias de flanco. */
export const EDGE_MEMORY_BYTE = 100;
/** Bytes de marcas reservados para pulsos de flanco. */
export const EDGE_PULSE_BYTE = 110;
/** Bytes de marcas reservados para "regla activa". */
export const RULE_FLAG_BYTE = 120;

/** Dirección de bit n-ésima dentro de un área a partir de un byte base. */
export function bitAddress(area: Area, index: number, baseByte = 0): string {
  const byte = baseByte + Math.floor(index / 8);
  return `${area} ${byte}.${index % 8}`;
}

export function buildSymbolTable(signals: Signal[]): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  let e = 0;
  let a = 0;
  let m = 0;

  signals.forEach((s) => {
    if (s.type === 'Sensor') {
      out.push({ symbol: s.name, area: 'E', address: bitAddress('E', e++), comment: s.description });
    }
  });
  derivedSignals(signals).forEach((d) => {
    out.push({
      symbol: d.name,
      area: 'E',
      address: bitAddress('E', e++),
      comment: `Inductivo ${d.inverted ? 'reposo' : 'activo'} de ${d.source}`,
    });
  });
  signals.forEach((s) => {
    if (s.type === 'Motor' || s.type === 'Cilindro') {
      out.push({ symbol: s.name, area: 'A', address: bitAddress('A', a++), comment: s.description });
    }
  });
  signals.forEach((s) => {
    if (s.type === 'Virtual') {
      out.push({
        symbol: s.name,
        area: 'M',
        address: bitAddress('M', m++, MARKER_BASE_BYTE),
        comment: s.description,
      });
    }
  });
  return out;
}

export function addressOf(table: SymbolEntry[], symbol: string): string {
  return table.find((t) => t.symbol === symbol)?.address ?? '—';
}

/** CSV de la tabla de símbolos (separador ; para Excel en español). */
export function symbolTableCSV(table: SymbolEntry[]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['Símbolo', 'Dirección', 'Tipo', 'Comentario'].map(q).join(';')];
  table.forEach((t) => rows.push([t.symbol, t.address, 'BOOL', t.comment].map(q).join(';')));
  return rows.join('\r\n') + '\r\n';
}
