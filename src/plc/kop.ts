/**
 * KOP (esquema de contactos / Ladder).
 *
 * `ladderModel` traduce las reglas a segmentos (una network por regla, con los
 * contactos en serie y las bobinas en paralelo). Lo consumen la vista de texto
 * y el renderizador gráfico (diagram/ladder.ts).
 */

import type { Block, ConditionEvent, ActionValue } from '../types';

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
  contacts: LadderContact[];
  coils: LadderCoil[];
}

const CONTACT: Record<ConditionEvent, ContactKind> = {
  '==1': 'NO',
  '==0': 'NC',
  'Flanco ascendente': 'P',
  'Flanco descendente': 'N',
};

const COIL: Record<ActionValue, CoilKind> = { '1': 'S', '0': 'R', toggle: 'T' };

export function ladderModel(blocks: Block[]): LadderRung[] {
  const rungs: LadderRung[] = [];
  blocks.forEach((b) =>
    (b.rules || []).forEach((r) => {
      if (!r.actions.length) return;
      rungs.push({
        number: rungs.length + 1,
        title: r.name,
        block: b.name,
        contacts: r.conditions.map((c) => ({ signal: c.signal, kind: CONTACT[c.event] })),
        coils: r.actions.map((a) => ({ signal: a.signal, kind: COIL[a.value] })),
      });
    }),
  );
  return rungs;
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
  if (!rungs.length) return '// (sin reglas con acciones)\n';
  const out: string[] = [];
  let block = '';
  rungs.forEach((rg) => {
    if (rg.block !== block) {
      block = rg.block;
      out.push(`// ==== BLOQUE: ${block} ====`, '');
    }
    out.push(`Network ${rg.number}: ${rg.title}`);
    const series = rg.contacts.map((c) => CONTACT_TXT[c.kind](c.signal)).join('  ');
    rg.coils.forEach((c, i) => {
      const lead = i === 0 ? `  ║${series}  ` : `  ║${' '.repeat(series.length + 2)}`;
      out.push(`${lead}──${COIL_TXT[c.kind]} ${c.signal}`);
    });
    out.push('');
  });
  return out.join('\n');
}
