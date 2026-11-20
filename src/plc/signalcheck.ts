/**
 * Comprobaciones de la tabla de señales: nombres válidos y únicos (también
 * los de los inductivos, que acaban como símbolos del PLC) y cuándo es seguro
 * llevar las referencias de un nombre a otro al renombrar.
 */

import type { Signal } from '../types';
import { allSignalNames, validateSignalName } from './signals';

export type SignalField = 'name' | 'inductivoActivo' | 'inductivoReposo';

export interface SignalProblem {
  text: string;
  /** Campo de la fila al que se refiere el aviso. */
  field: SignalField;
}

const IND_LABEL: Record<Exclude<SignalField, 'name'>, string> = {
  inductivoActivo: 'activo',
  inductivoReposo: 'de reposo',
};

/** Primer problema de cada fila (por índice de la señal). */
export function signalProblems(signals: Signal[]): Map<number, SignalProblem> {
  const out = new Map<number, SignalProblem>();
  const names = signals.map((s) => s.name.trim());
  /** Dueño de cada inductivo: el primero que lo declara. */
  const indOwner = new Map<string, string>();
  const inds = (s: Signal): [Exclude<SignalField, 'name'>, string][] =>
    s.type === 'Cilindro'
      ? (['inductivoActivo', 'inductivoReposo'] as const)
          .map((f): [Exclude<SignalField, 'name'>, string] => [f, (s[f] ?? '').trim()])
          .filter(([, n]) => !!n)
      : [];
  signals.forEach((s, i) => inds(s).forEach(([f, n]) => !indOwner.has(n) && indOwner.set(n, `${i}:${f}`)));

  signals.forEach((s, i) => {
    const n = names[i];
    const v = validateSignalName(n);
    if (v) out.set(i, { text: v, field: 'name' });
    // Se marca en todas las filas que lo comparten: también en la que se está editando.
    else if (names.indexOf(n) !== names.lastIndexOf(n)) out.set(i, { text: `«${n}» está repetido`, field: 'name' });
    else if (indOwner.has(n)) out.set(i, { text: `«${n}» ya es el nombre de un inductivo`, field: 'name' });
    if (out.has(i)) return;
    for (const [f, ind] of inds(s)) {
      const bad = validateSignalName(ind);
      let text = '';
      if (bad) text = `Inductivo ${IND_LABEL[f]}: ${bad.charAt(0).toLowerCase()}${bad.slice(1)}`;
      else if (names.includes(ind)) text = `El inductivo «${ind}» coincide con otra señal`;
      else if (indOwner.get(ind) !== `${i}:${f}`) {
        const owner = signals[Number(indOwner.get(ind)!.split(':')[0])];
        text =
          owner === s
            ? `El inductivo «${ind}» no puede ser a la vez activo y de reposo`
            : `El inductivo «${ind}» ya es de ${owner.name.trim() || 'otro cilindro'}`;
      }
      if (text) {
        out.set(i, { text, field: f });
        break;
      }
    }
  });
  return out;
}

/**
 * ¿Se pueden pasar las referencias de `prev` a `after`? Se llama cuando el
 * campo ya contiene `after`. Solo si el nombre nuevo es válido y no lo tiene
 * nadie más (si no, se mezclarían con las de la otra señal) y el anterior ya
 * no es de nadie (si otra señal lo conserva, las referencias son suyas).
 */
export function canMoveRefs(signals: Signal[], prev: string, after: string): boolean {
  if (!prev || !after || prev === after || validateSignalName(after)) return false;
  const all = allSignalNames(signals).map((n) => n.trim());
  return all.filter((n) => n === after).length === 1 && !all.includes(prev);
}
