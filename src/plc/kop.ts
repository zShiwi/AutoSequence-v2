/**
 * KOP (esquema de contactos / Ladder).
 *
 * `ladderModel` traduce las reglas a segmentos (una network por regla, con los
 * contactos en serie y las bobinas en paralelo). Lo consumen la vista de texto
 * y el renderizador gráfico (diagram/ladder.ts).
 */

import type { Block, ConditionEvent, ActionValue } from '../types';
import { conditionGroups, isRunnable, ruleActions, ruleConditions, skipReason } from './rules';

export type ContactKind = 'NO' | 'NC' | 'P' | 'N';
export type CoilKind = 'S' | 'R' | 'T';

export interface LadderContact {
  signal: string;
  kind: ContactKind;
}

export interface LadderCoil {
  signal: string;
  kind: CoilKind;
}

export interface LadderRung {
  number: number;
  title: string;
  block: string;
  /** Posiciones en serie; cada una con uno o varios contactos en paralelo. */
  contacts: LadderContact[][];
  coils: LadderCoil[];
}

const CONTACT: Record<ConditionEvent, ContactKind> = {
  '==1': 'NO',
  '==0': 'NC',
  'Flanco ascendente': 'P',
  'Flanco descendente': 'N',
};

const COIL: Record<ActionValue, CoilKind> = { '1': 'S', '0': 'R', toggle: 'T' };

/**
 * El número de network es el de la regla (R1 = Network 1). Las reglas sin
 * condiciones o sin acciones no se ejecutan y no se dibujan, pero conservan
 * su número para que las demás no se desplacen.
 */
export function ladderModel(blocks: Block[]): LadderRung[] {
  const rungs: LadderRung[] = [];
  let number = 0;
  blocks.forEach((b) =>
    (b.rules || []).forEach((r) => {
      number++;
      if (!isRunnable(r)) return;
      rungs.push({
        number,
        title: r.name,
        block: b.name,
        contacts: conditionGroups(ruleConditions(r)).map((g) =>
          g.map((c) => ({ signal: c.signal, kind: CONTACT[c.event] })),
        ),
        coils: ruleActions(r).map((a) => ({ signal: a.signal, kind: COIL[a.value] })),
      });
    }),
  );
  return rungs;
}

/** Reglas que no se dibujan, con su número y el motivo. */
export function skippedRules(blocks: Block[]): { number: number; title: string; reason: string }[] {
  const out: { number: number; title: string; reason: string }[] = [];
  blocks
    .flatMap((b) => b.rules || [])
    .forEach((r, i) => {
      if (!isRunnable(r)) out.push({ number: i + 1, title: r.name, reason: skipReason(r) });
    });
  return out;
}

const CONTACT_TXT: Record<ContactKind, (s: string) => string> = {
  NO: (s) => `─┤ ├─ ${s}`,
  NC: (s) => `─┤/├─ ${s}`,
  P: (s) => `─┤P├─ ${s}`,
  N: (s) => `─┤N├─ ${s}`,
};

const COIL_TXT: Record<CoilKind, string> = { S: '(S)', R: '(R)', T: '(T)' };

/** Representación de texto del esquema de contactos. */
export function generateKOP(blocks: Block[]): string {
  const rungs = ladderModel(blocks);
  const skipped = skippedRules(blocks).map(
    (k) => `// Network ${k.number}: ${k.title} (omitida: ${k.reason}, no se ejecuta)`,
  );
  if (!rungs.length) return ['// (sin reglas con acciones)', ...skipped].join('\n') + '\n';
  const out: string[] = [];
  let block = '';
  rungs.forEach((rg) => {
    if (rg.block !== block) {
      block = rg.block;
      out.push(`// ==== BLOQUE: ${block} ====`, '');
    }
    out.push(`Network ${rg.number}: ${rg.title}`);
    const series = rg.contacts
      .map((g) =>
        g.length === 1
          ? CONTACT_TXT[g[0].kind](g[0].signal)
          : `(${g.map((c) => CONTACT_TXT[c.kind](c.signal)).join(' ║ ')})`,
      )
      .join('  ');
    rg.coils.forEach((c, i) => {
      const lead = i === 0 ? `  ║${series}  ` : `  ║${' '.repeat(series.length + 2)}`;
      out.push(`${lead}──${COIL_TXT[c.kind]} ${c.signal}`);
    });
    out.push('');
  });
  if (skipped.length) out.push(...skipped, '');
  return out.join('\n');
}
