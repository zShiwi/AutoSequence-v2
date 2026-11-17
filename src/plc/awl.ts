/**
 * Generación de código AWL (lista de instrucciones STEP 7, nemotecnia alemana).
 *
 * Corrige el AWL del prototipo original, que comparaba enteros con ==I y
 * saltaba a la etiqueta de "no cumple" justo cuando la condición SÍ se
 * cumplía (lógica invertida), y no implementaba los flancos.
 *
 * Estructura generada (equivalente exacto al simulador):
 *  - Network 1: detección de flancos con FP/FN al inicio del ciclo.
 *  - Una network por regla: cadena Y de condiciones → marca "regla activa"
 *    → SET/RESET/alternar de cada acción.
 */

import type { Block, Condition } from '../types';
import {
  EDGE_MEMORY_BYTE,
  EDGE_PULSE_BYTE,
  RULE_FLAG_BYTE,
  bitAddress,
} from './addresses';

interface EdgeSlot {
  key: string;
  signal: string;
  rising: boolean;
  memory: string;
  pulse: string;
}

const pad = (s: string, n: number) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));

function sym(name: string): string {
  return `"${name}"`;
}

function line(op: string, operand = '', comment = ''): string {
  const body = `      ${pad(op, 6)}${operand}`;
  return comment ? `${pad(body, 44)}// ${comment}` : body;
}

export interface AwlOptions {
  /** Nombre del proyecto para la cabecera. */
  projectName?: string;
}

export function generateAWL(blocks: Block[], opts: AwlOptions = {}): string {
  const out: string[] = [];
  const rules = blocks.flatMap((b, bi) => (b.rules || []).map((r) => ({ r, bi, block: b })));

  // 1) Reservar memorias para cada flanco distinto usado.
  const edges = new Map<string, EdgeSlot>();
  rules.forEach(({ r }) =>
    r.conditions.forEach((c) => {
      if (c.event !== 'Flanco ascendente' && c.event !== 'Flanco descendente') return;
      const rising = c.event === 'Flanco ascendente';
      const key = `${c.signal}|${rising ? 'P' : 'N'}`;
      if (edges.has(key)) return;
      const i = edges.size;
      edges.set(key, {
        key,
        signal: c.signal,
        rising,
        memory: bitAddress('M', i, EDGE_MEMORY_BYTE),
        pulse: bitAddress('M', i, EDGE_PULSE_BYTE),
      });
    }),
  );

  out.push('// ============================================================');
  out.push(`// OB1 - Ciclo principal${opts.projectName ? ` · Proyecto: ${opts.projectName}` : ''}`);
  out.push('// Generado por AutoSequence. Requiere la tabla de símbolos.');
  out.push('// ============================================================');
  out.push('ORGANIZATION_BLOCK OB 1');
  out.push('TITLE = Secuencia autogenerada');
  out.push('VERSION : 0.1');
  out.push('');
  out.push('BEGIN');

  let network = 1;
  if (edges.size) {
    out.push(`NETWORK // ${network++}`);
    out.push('TITLE = Detección de flancos (inicio de ciclo)');
    edges.forEach((e) => {
      out.push(line('U', sym(e.signal)));
      out.push(line(e.rising ? 'FP' : 'FN', e.memory, `memoria flanco ${e.rising ? '↑' : '↓'} ${e.signal}`));
      out.push(line('=', e.pulse, `pulso flanco ${e.rising ? '↑' : '↓'} ${e.signal}`));
    });
    out.push('');
  }

  const condLine = (c: Condition): string => {
    switch (c.event) {
      case '==1':
        return line('U', sym(c.signal), `${c.signal} = 1`);
      case '==0':
        return line('UN', sym(c.signal), `${c.signal} = 0`);
      default: {
        const rising = c.event === 'Flanco ascendente';
        const e = edges.get(`${c.signal}|${rising ? 'P' : 'N'}`)!;
        return line('U', e.pulse, `flanco ${rising ? '↑' : '↓'} ${c.signal}`);
      }
    }
  };

  let currentBlock = -1;
  rules.forEach(({ r, bi, block }, idx) => {
    if (bi !== currentBlock) {
      currentBlock = bi;
      out.push(`// ------------------------------------------------------------`);
      out.push(`// BLOQUE: ${block.name}`);
      out.push(`// ------------------------------------------------------------`);
    }
    const flag = bitAddress('M', idx, RULE_FLAG_BYTE);
    out.push(`NETWORK // ${network++}`);
    out.push(`TITLE = R${idx + 1} · ${r.name}`);
    r.conditions.forEach((c) => out.push(condLine(c)));
    out.push(line('=', flag, 'regla activa'));

    r.actions.forEach((a, ai) => {
      if (a.value === '1') {
        out.push(line('U', flag));
        out.push(line('S', sym(a.signal), `SET ${a.signal}`));
      } else if (a.value === '0') {
        out.push(line('U', flag));
        out.push(line('R', sym(a.signal), `RESET ${a.signal}`));
      } else {
        const label = `T${String(idx + 1).padStart(2, '0')}${ai}`;
        out.push(line('U', flag));
        out.push(line('SPBN', label, `saltar si la regla no está activa`));
        out.push(line('UN', sym(a.signal)));
        out.push(line('=', sym(a.signal), `ALTERNAR ${a.signal}`));
        out.push(`${label}: NOP 0`);
      }
    });
    out.push('');
  });

  if (!rules.length) out.push('      // (sin reglas definidas)');
  out.push('END_ORGANIZATION_BLOCK');
  return out.join('\n') + '\n';
}
