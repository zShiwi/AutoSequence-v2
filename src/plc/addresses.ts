/**
 * Asignación automática de direcciones (tabla de símbolos).
 *
 * Nemotecnia alemana de STEP 7 (la misma que AWL/KOP):
 *  - E: entradas  (sensores e inductivos)
 *  - A: salidas   (motores y cilindros)
 *  - M: marcas    (señales virtuales, memorias de flanco y auxiliares)
 */

import type { Block, Signal } from '../types';
import { isRunnable, ruleConditions } from './rules';
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
/** Primer byte habitual de las memorias de flanco. */
export const EDGE_MEMORY_BYTE = 100;
/** Primer byte habitual de los pulsos de flanco. */
export const EDGE_PULSE_BYTE = 110;
/** Primer byte habitual de las marcas de "regla activa". */
export const RULE_FLAG_BYTE = 120;

/** Dirección de bit n-ésima dentro de un área a partir de un byte base. */
export function bitAddress(area: Area, index: number, baseByte = 0): string {
  const byte = baseByte + Math.floor(index / 8);
  return `${area} ${byte}.${index % 8}`;
}

/** Un flanco distinto usado por las reglas, con sus dos marcas. */
export interface EdgeSlot {
  key: string;
  signal: string;
  rising: boolean;
  /** Memoria de flanco (operando de FP/FN). */
  memory: string;
  /** Pulso: vale 1 durante el ciclo en que se detecta el flanco. */
  pulse: string;
}

/**
 * Reparto de las marcas auxiliares del programa. Lo comparten el AWL y la
 * tabla de símbolos para que las direcciones coincidan siempre.
 */
export interface MarkerPlan {
  /** Flancos por clave (ver `edgeKey`), en orden de aparición. */
  edges: Map<string, EdgeSlot>;
  memoryByte: number;
  pulseByte: number;
  flagByte: number;
  /** Último byte de marcas que usa el programa. */
  lastByte: number;
  /** Marca "regla activa" de la regla n-ésima (índice global, desde 0). */
  ruleFlag(index: number): string;
}

export function edgeKey(signal: string, rising: boolean): string {
  return `${signal}|${rising ? 'P' : 'N'}`;
}

/**
 * Reserva las marcas de flanco y de regla activa. Las zonas empiezan en
 * M100, M110 y M120, como siempre; solo si no caben (más de 80 flancos o
 * más de 800 marcas virtuales) se desplazan para que nunca se pisen.
 */
export function markerPlan(blocks: Block[], signals: Signal[] = []): MarkerPlan {
  const rules = blocks.flatMap((b) => b.rules || []);
  const found: { signal: string; rising: boolean }[] = [];
  const seen = new Set<string>();
  rules.filter(isRunnable).forEach((r) =>
    ruleConditions(r).forEach((c) => {
      if (c.event !== 'Flanco ascendente' && c.event !== 'Flanco descendente') return;
      const rising = c.event === 'Flanco ascendente';
      const key = edgeKey(c.signal, rising);
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ signal: c.signal, rising });
    }),
  );

  const bytes = (bits: number) => Math.ceil(bits / 8);
  const virtuals = signals.filter((s) => s.type === 'Virtual').length;
  const memoryByte = Math.max(EDGE_MEMORY_BYTE, MARKER_BASE_BYTE + bytes(virtuals));
  const pulseByte = Math.max(EDGE_PULSE_BYTE, memoryByte + bytes(found.length));
  const flagByte = Math.max(RULE_FLAG_BYTE, pulseByte + bytes(found.length));

  const edges = new Map<string, EdgeSlot>();
  found.forEach((f, i) => {
    const key = edgeKey(f.signal, f.rising);
    edges.set(key, {
      key,
      signal: f.signal,
      rising: f.rising,
      memory: bitAddress('M', i, memoryByte),
      pulse: bitAddress('M', i, pulseByte),
    });
  });
  return {
    edges,
    memoryByte,
    pulseByte,
    flagByte,
    lastByte: flagByte + Math.max(1, bytes(rules.length)) - 1,
    ruleFlag: (index) => bitAddress('M', index, flagByte),
  };
}

/**
 * Marcas auxiliares que usa el AWL (memorias y pulsos de flanco, reglas
 * activas), para que al importar la tabla en STEP 7 queden con símbolo y
 * comentario y nadie las reutilice por error.
 */
export function auxiliarySymbols(blocks: Block[], signals: Signal[] = []): SymbolEntry[] {
  const plan = markerPlan(blocks, signals);
  const taken = new Set(buildSymbolTable(signals).map((t) => t.symbol));
  const free = (name: string): string => {
    let n = name;
    while (taken.has(n)) n += '_';
    taken.add(n);
    return n;
  };
  const num = (i: number) => String(i + 1).padStart(3, '0');
  const arrow = (e: EdgeSlot) => `${e.rising ? '↑' : '↓'} ${e.signal}`;
  const out: SymbolEntry[] = [];
  const edges = [...plan.edges.values()];
  edges.forEach((e, i) =>
    out.push({ symbol: free(`FL_MEM_${num(i)}`), area: 'M', address: e.memory, comment: `Memoria de flanco ${arrow(e)}` }),
  );
  edges.forEach((e, i) =>
    out.push({ symbol: free(`FL_PUL_${num(i)}`), area: 'M', address: e.pulse, comment: `Pulso de flanco ${arrow(e)}` }),
  );
  blocks
    .flatMap((b) => b.rules || [])
    .forEach((r, i) => {
      if (!isRunnable(r)) return;
      out.push({
        symbol: free(`REGLA_${num(i)}`),
        area: 'M',
        address: plan.ruleFlag(i),
        comment: `Regla activa R${i + 1} · ${r.name}`,
      });
    });
  return out;
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
