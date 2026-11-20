/**
 * Direcciones de las señales (tabla de símbolos).
 *
 * Cada señal, y cada inductivo de cilindro, guarda su dirección. Se asigna
 * una sola vez (primer hueco libre de su área) y ya no cambia aunque se
 * añadan, borren o reordenen otras señales: así la documentación impresa y
 * el cableado siguen coincidiendo con el programa.
 *
 * Nemotecnia alemana de STEP 7 (la misma que AWL/KOP):
 *  - E: entradas  (sensores e inductivos)
 *  - A: salidas   (motores y cilindros)
 *  - M: marcas    (señales virtuales, memorias de flanco y auxiliares)
 */

import type { Block, Signal, SignalType } from '../types';
import { isRunnable, ruleConditions } from './rules';
import { cleanSignals } from './signals';

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
  const virtuals = signals.filter((s) => s.type === 'Virtual');
  // Por encima de todas las marcas virtuales, también de las puestas a mano.
  const lastVirtual = Math.max(-1, ...virtuals.map((s) => parseAddress(s.address)?.byte ?? -1));
  const memoryByte = Math.max(EDGE_MEMORY_BYTE, MARKER_BASE_BYTE + bytes(virtuals.length), lastVirtual + 1);
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

// ---- Direcciones guardadas -------------------------------------------------

/** Campo de una señal que guarda una dirección. */
export type AddressSlot = 'address' | 'inductivoActivoAddress' | 'inductivoReposoAddress';

const IND_SLOTS: [AddressSlot, 'inductivoActivo' | 'inductivoReposo'][] = [
  ['inductivoActivoAddress', 'inductivoActivo'],
  ['inductivoReposoAddress', 'inductivoReposo'],
];

/** Byte más alto admitido (límite de STEP 7). */
export const MAX_BYTE = 65535;

export interface ParsedAddress {
  area: Area;
  byte: number;
  bit: number;
}

/** Lee «E 0.3», «e0.3»… Devuelve null si no es una dirección de bit válida. */
export function parseAddress(text: unknown): ParsedAddress | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*([EAM])\s*(\d{1,5})\.([0-7])\s*$/i.exec(text);
  if (!m) return null;
  const byte = Number(m[2]);
  if (byte > MAX_BYTE) return null;
  return { area: m[1].toUpperCase() as Area, byte, bit: Number(m[3]) };
}

export function formatAddress(a: ParsedAddress): string {
  return `${a.area} ${a.byte}.${a.bit}`;
}

/** Área que corresponde a cada tipo de señal. */
export function areaOfType(type: SignalType): Area {
  return type === 'Sensor' ? 'E' : type === 'Virtual' ? 'M' : 'A';
}

/** Área de un campo de dirección: los inductivos son siempre entradas. */
export function areaOfSlot(s: Signal, slot: AddressSlot): Area {
  return slot === 'address' ? areaOfType(s.type) : 'E';
}

/**
 * Primer byte que las marcas virtuales no pueden usar: ahí empiezan las
 * marcas auxiliares del programa (ver `markerPlan`). Es M100 salvo que haya
 * tantas marcas virtuales (más de 800) que no quepan por debajo.
 */
export function virtualLimitByte(signals: Signal[]): number {
  const n = signals.filter((s) => s.type === 'Virtual').length;
  return Math.max(EDGE_MEMORY_BYTE, MARKER_BASE_BYTE + Math.ceil(n / 8));
}

/** Campos de dirección que le corresponden a una señal ahora mismo. */
export function addressSlots(s: Signal): AddressSlot[] {
  const out: AddressSlot[] = ['address'];
  if (s.type === 'Cilindro') IND_SLOTS.forEach(([slot, name]) => s[name] && out.push(slot));
  return out;
}

function hasAnyAddress(s: Signal): boolean {
  return s.address !== undefined || s.inductivoActivoAddress !== undefined || s.inductivoReposoAddress !== undefined;
}

/** Nombre con el que se enseña al usuario el dueño de una dirección. */
function slotLabel(s: Signal, slot: AddressSlot): string {
  if (slot === 'address') return s.name || '(sin nombre)';
  return (slot === 'inductivoActivoAddress' ? s.inductivoActivo : s.inductivoReposo) || '(inductivo)';
}

function firstFree(area: Area, used: Set<string>): string {
  for (let i = 0; ; i++) {
    const a = bitAddress(area, i);
    if (!used.has(a)) return a;
  }
}

/** Motivo por el que se descarta una dirección guardada. */
export type AddressFixReason = 'formato' | 'duplicada' | 'area' | 'reservada';

/** Dirección que no se podía usar y la que la sustituye. */
export interface AddressFix {
  symbol: string;
  from: string;
  to: string;
  reason: AddressFixReason;
}

/**
 * Asignación compacta de siempre: sensores, inductivos, salidas y marcas, cada
 * grupo en el orden de la lista y solo con las señales utilizables. Es la que
 * recibe un proyecto que todavía no tiene direcciones guardadas, para que al
 * abrirlo nada cambie respecto a lo que ya estaba impreso o cableado.
 */
function assignCompact(signals: Signal[]): void {
  const clean = cleanSignals(signals);
  // `cleanSignals` conserva el orden y devuelve la misma señal o una copia
  // (cilindro al que se le descarta un inductivo): se empareja con la original.
  const pairs: { orig: Signal; clean: Signal }[] = [];
  let j = 0;
  signals.forEach((orig) => {
    const c = clean[j];
    if (c && (c === orig || (c.type === 'Cilindro' && orig.type === 'Cilindro' && c.name === orig.name))) {
      pairs.push({ orig, clean: c });
      j++;
    }
  });
  let e = 0;
  let a = 0;
  let m = 0;
  pairs.forEach(({ orig, clean: c }) => {
    if (c.type === 'Sensor') orig.address = bitAddress('E', e++);
  });
  pairs.forEach(({ orig, clean: c }) => {
    if (c.type !== 'Cilindro') return;
    if (c.inductivoActivo) orig.inductivoActivoAddress = bitAddress('E', e++);
    if (c.inductivoReposo) orig.inductivoReposoAddress = bitAddress('E', e++);
  });
  pairs.forEach(({ orig, clean: c }) => {
    if (c.type === 'Motor' || c.type === 'Cilindro') orig.address = bitAddress('A', a++);
  });
  pairs.forEach(({ orig, clean: c }) => {
    if (c.type === 'Virtual') orig.address = bitAddress('M', m++, MARKER_BASE_BYTE);
  });
}

/**
 * Deja todas las señales con una dirección válida y única (modifica la lista):
 *
 *  - Las direcciones correctas no se tocan nunca.
 *  - Las que no valen (formato, área que no corresponde al tipo, repetidas o
 *    dentro de las marcas auxiliares) se descartan y se devuelven en la lista.
 *  - Lo que queda sin dirección recibe el primer hueco libre de su área. Un
 *    proyecto sin ninguna dirección recibe la asignación compacta de siempre.
 *  - Los inductivos que ya no existen sueltan la suya.
 */
export function ensureAddresses(signals: Signal[]): AddressFix[] {
  const used = new Set<string>();
  const dropped: { s: Signal; slot: AddressSlot; from: string; reason: AddressFixReason }[] = [];
  const limit = virtualLimitByte(signals);

  signals.forEach((s) => {
    const slots = addressSlots(s);
    IND_SLOTS.forEach(([slot]) => !slots.includes(slot) && delete s[slot]);
    slots.forEach((slot) => {
      const raw: unknown = s[slot];
      if (raw === undefined) return;
      const parsed = parseAddress(raw);
      const canon = parsed ? formatAddress(parsed) : '';
      let reason: AddressFixReason | null = null;
      if (!parsed) reason = 'formato';
      else if (parsed.area !== areaOfSlot(s, slot)) reason = 'area';
      else if (parsed.area === 'M' && parsed.byte >= limit) reason = 'reservada';
      else if (used.has(canon)) reason = 'duplicada';
      if (reason) {
        dropped.push({ s, slot, from: String(raw), reason });
        delete s[slot];
      } else {
        s[slot] = canon;
        used.add(canon);
      }
    });
  });

  if (!signals.some(hasAnyAddress)) assignCompact(signals);
  // Lo asignado en compacto ya cuenta como ocupado al buscar huecos.
  used.clear();
  signals.forEach((s) => addressSlots(s).forEach((slot) => s[slot] !== undefined && used.add(s[slot]!)));
  signals.forEach((s) =>
    addressSlots(s).forEach((slot) => {
      if (s[slot] !== undefined) return;
      const a = firstFree(areaOfSlot(s, slot), used);
      s[slot] = a;
      used.add(a);
    }),
  );

  return dropped.map((d) => ({ symbol: slotLabel(d.s, d.slot), from: d.from, to: d.s[d.slot] ?? '', reason: d.reason }));
}

/**
 * Vuelve a la asignación compacta (sin huecos, en el orden de la lista).
 * Devuelve cuántas direcciones han cambiado.
 */
export function renumberAddresses(signals: Signal[]): number {
  const before = signals.map((s) => [s.address, s.inductivoActivoAddress, s.inductivoReposoAddress]);
  signals.forEach((s) => {
    delete s.address;
    delete s.inductivoActivoAddress;
    delete s.inductivoReposoAddress;
  });
  ensureAddresses(signals);
  let n = 0;
  signals.forEach((s, i) => {
    [s.address, s.inductivoActivoAddress, s.inductivoReposoAddress].forEach((a, k) => {
      if (a !== undefined && a !== before[i][k]) n++;
    });
  });
  return n;
}

const AREA_TEXT: Record<Area, string> = { E: 'entradas (E)', A: 'salidas (A)', M: 'marcas (M)' };

/**
 * Comprueba una dirección escrita a mano para una señal (o uno de sus
 * inductivos). Devuelve la dirección normalizada o el motivo del rechazo.
 */
export function checkAddress(
  signals: Signal[],
  index: number,
  slot: AddressSlot,
  text: string,
): { ok: true; address: string } | { ok: false; error: string } {
  const s = signals[index];
  const t = text.trim();
  if (!t) return { ok: false, error: 'Escribe una dirección, por ejemplo E 0.3' };
  const shape = /^([EAM])\s*(\d+)\.(\d+)$/i.exec(t);
  if (!shape) return { ok: false, error: 'Formato: E, A o M y byte.bit, por ejemplo E 0.3' };
  if (shape[3].length > 1 || Number(shape[3]) > 7) return { ok: false, error: 'El bit va de 0 a 7' };
  if (shape[2].length > 5 || Number(shape[2]) > MAX_BYTE) return { ok: false, error: `El byte va de 0 a ${MAX_BYTE}` };
  const parsed = parseAddress(t)!;
  const area = areaOfSlot(s, slot);
  if (parsed.area !== area) {
    const what = slot === 'address' ? `Una señal de tipo ${s.type}` : 'Un inductivo';
    return { ok: false, error: `${what} va en ${AREA_TEXT[area]}, no en ${parsed.area}` };
  }
  const address = formatAddress(parsed);
  if (area === 'M') {
    const limit = virtualLimitByte(signals);
    if (parsed.byte >= limit) {
      return { ok: false, error: `Desde M ${limit}.0 las marcas están reservadas para el programa (flancos y reglas)` };
    }
  }
  for (let i = 0; i < signals.length; i++) {
    for (const other of addressSlots(signals[i])) {
      if (i === index && other === slot) continue;
      if (signals[i][other] === address) {
        return { ok: false, error: `${address} ya la usa ${slotLabel(signals[i], other)}` };
      }
    }
  }
  return { ok: true, address };
}

const AREA_ORDER: Record<Area, number> = { E: 0, A: 1, M: 2 };

/**
 * Tabla de símbolos con las direcciones guardadas, ordenada por área y
 * dirección. No modifica las señales: si a alguna le falta la dirección se
 * calcula sobre una copia.
 */
export function buildSymbolTable(signals: Signal[]): SymbolEntry[] {
  let list = signals;
  if (signals.some((s) => addressSlots(s).some((slot) => !parseAddress(s[slot])))) {
    list = signals.map((s) => ({ ...s }));
    ensureAddresses(list);
  }
  const out: SymbolEntry[] = [];
  list.forEach((s) => {
    out.push({ symbol: s.name, area: areaOfType(s.type), address: s.address!, comment: s.description });
    if (s.type !== 'Cilindro') return;
    if (s.inductivoActivo) {
      out.push({ symbol: s.inductivoActivo, area: 'E', address: s.inductivoActivoAddress!, comment: `Inductivo activo de ${s.name}` });
    }
    if (s.inductivoReposo) {
      out.push({ symbol: s.inductivoReposo, area: 'E', address: s.inductivoReposoAddress!, comment: `Inductivo reposo de ${s.name}` });
    }
  });
  const order = (t: SymbolEntry) => {
    const p = parseAddress(t.address)!;
    return p.byte * 8 + p.bit;
  };
  return out
    .map((t, i) => ({ t, i }))
    .sort((x, y) => AREA_ORDER[x.t.area] - AREA_ORDER[y.t.area] || order(x.t) - order(y.t) || x.i - y.i)
    .map((x) => x.t);
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
