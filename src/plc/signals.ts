/**
 * Utilidades sobre el conjunto de señales.
 *
 * Los inductivos de un cilindro no son señales independientes: siguen la
 * posición del cilindro (el activo vale lo mismo que el cilindro y el de
 * reposo, lo contrario). Modelarlos así permite encadenar secuencias del tipo
 * "cilindro A sale → inductivo A+ → cilindro B sale".
 */

import type { Rule, Signal, SignalType } from '../types';

export interface DerivedSignal {
  name: string;
  /** Cilindro del que depende. */
  source: string;
  /** true para el inductivo de reposo (inverso del cilindro). */
  inverted: boolean;
}

export function derivedSignals(signals: Signal[]): DerivedSignal[] {
  const out: DerivedSignal[] = [];
  signals.forEach((s) => {
    if (s.type !== 'Cilindro') return;
    if (s.inductivoActivo) out.push({ name: s.inductivoActivo, source: s.name, inverted: false });
    if (s.inductivoReposo) out.push({ name: s.inductivoReposo, source: s.name, inverted: true });
  });
  return out;
}

/** Todos los nombres utilizables en condiciones: señales + inductivos. */
export function allSignalNames(signals: Signal[]): string[] {
  return [...signals.map((s) => s.name), ...derivedSignals(signals).map((d) => d.name)];
}

/** Señales escritas por alguna acción. */
export function actionTargets(rules: Rule[]): Set<string> {
  return new Set(rules.flatMap((r) => r.actions.map((a) => a.signal)));
}

/**
 * Señales que se pueden forzar desde fuera en la simulación: las que no son
 * inductivos derivados y no las escribe ninguna regla.
 */
export function externalInputs(signals: Signal[], rules: Rule[]): string[] {
  const targets = actionTargets(rules);
  const derived = new Set(derivedSignals(signals).map((d) => d.name));
  return signals
    .map((s) => s.name)
    .filter((n) => !targets.has(n) && !derived.has(n));
}

/** Tipos que pueden ser destino de una acción. */
export function isActuatorType(type: SignalType): boolean {
  return type === 'Motor' || type === 'Cilindro' || type === 'Virtual';
}

export const TYPE_LABEL: Record<SignalType, string> = {
  Sensor: 'Sensor',
  Motor: 'Motor',
  Cilindro: 'Cilindro',
  Virtual: 'Virtual',
};

export const TYPE_HINT: Record<SignalType, string> = {
  Sensor: 'Entrada digital',
  Motor: 'Salida digital',
  Cilindro: 'Salida con inductivos',
  Virtual: 'Marca interna',
};

/** Nombres de señal referenciados por un conjunto de reglas. */
export function signalsUsedBy(rules: Rule[]): Set<string> {
  const used = new Set<string>();
  rules.forEach((r) => {
    r.conditions.forEach((c) => used.add(c.signal));
    r.actions.forEach((a) => used.add(a.signal));
  });
  return used;
}

/**
 * Señales utilizables por simulación y generación de código: con nombre
 * válido y sin duplicados (se queda la primera aparición).
 */
export function cleanSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const n = s.name.trim();
    if (!n || validateSignalName(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

// ---- Alta rápida ------------------------------------------------------------

/** Todos los nombres ocupados: señales e inductivos. */
export function takenNames(signals: Signal[]): Set<string> {
  return new Set(allSignalNames(signals).map((n) => n.trim()).filter(Boolean));
}

/**
 * Primer nombre libre con un prefijo y numeración de `digits` cifras
 * (C05, PX09…): rellena los huecos empezando por 1.
 */
export function nextFreeName(prefix: string, taken: Set<string>, digits = 2, extra: string[] = []): string {
  const all = new Set([...taken, ...extra]);
  let i = 1;
  const name = () => `${prefix}${String(i).padStart(digits, '0')}`;
  while (all.has(name())) i++;
  return name();
}

/** Inductivos por convención: activo = <nombre>PX2 (abierto), reposo = <nombre>PX1 (cerrado). */
export function stopInductivos(cylinder: string): { activo: string; reposo: string } {
  return { activo: `${cylinder}PX2`, reposo: `${cylinder}PX1` };
}

export interface StopDraft {
  name: string;
  description: string;
  activo: string;
  reposo: string;
  /** Sensor de presencia a crear (vacío = sin presencia). */
  presence: string;
  presenceDescription: string;
}

/** Valores propuestos para un tope nuevo: con escribir solo el nombre basta. */
export function proposeStop(signals: Signal[]): StopDraft {
  const taken = takenNames(signals);
  const name = nextFreeName('C', taken);
  const presence = nextFreeName('PX', taken);
  const ind = stopInductivos(name);
  return {
    name,
    description: '',
    activo: ind.activo,
    reposo: ind.reposo,
    presence,
    presenceDescription: `Paleta en tope ${name}`,
  };
}

/** Errores de un tope nuevo, por campo. */
export function stopDraftErrors(d: StopDraft, signals: Signal[]): Partial<Record<'name' | 'activo' | 'reposo' | 'presence', string>> {
  const taken = takenNames(signals);
  const out: Partial<Record<'name' | 'activo' | 'reposo' | 'presence', string>> = {};
  const fields: ['name' | 'activo' | 'reposo' | 'presence', string][] = [
    ['name', d.name.trim()],
    ['activo', d.activo.trim()],
    ['reposo', d.reposo.trim()],
    ['presence', d.presence.trim()],
  ];
  const seen = new Map<string, string>();
  fields.forEach(([f, n]) => {
    if (f === 'presence' && !n) return;
    const v = validateSignalName(n);
    if (v) out[f] = v;
    else if (taken.has(n)) out[f] = `«${n}» ya existe`;
    else if (seen.has(n)) out[f] = `«${n}» se repite`;
    seen.set(n, f);
  });
  return out;
}

/** Señales que crea un tope: el cilindro (con sus inductivos) y su presencia. */
export function buildStop(d: StopDraft): Signal[] {
  const name = d.name.trim();
  const presence = d.presence.trim();
  const cyl: Signal = {
    name,
    type: 'Cilindro',
    initial: 0,
    description: d.description.trim() || `Tope ${name}`,
    inductivoActivo: d.activo.trim(),
    inductivoReposo: d.reposo.trim(),
    ...(presence ? { presence } : {}),
  };
  if (!presence) return [cyl];
  return [
    { name: presence, type: 'Sensor', initial: 0, description: d.presenceDescription.trim() || `Paleta en tope ${name}` },
    cyl,
  ];
}

/** Cilindro de tope al que está enlazado un sensor de presencia. */
export function presenceOwner(signals: Signal[], sensor: string): Signal | undefined {
  return signals.find((s) => s.type === 'Cilindro' && s.presence === sensor);
}

/** Regla válida para un nombre de señal (se usa como símbolo PLC). */
export function validateSignalName(name: string): string | null {
  if (!name.trim()) return 'El nombre no puede estar vacío';
  if (name.length > 24) return 'Máximo 24 caracteres (límite de símbolo en STEP 7)';
  if (!/^[A-Za-z0-9_\-.+]+$/.test(name))
    return 'Usa solo letras, números, guion, punto, + o guion bajo (sin espacios)';
  return null;
}
