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
 *  - Las reglas sin condiciones o sin acciones se omiten (como en el
 *    simulador) y dejan un comentario; la numeración R1, R2… no se mueve.
 */

import type { Block, Condition, Signal } from '../types';
import { conditionGroups, isRunnable, ruleActions, ruleConditions, skipReason } from './rules';
import { edgeKey, markerPlan } from './addresses';

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
  /**
   * Señales del proyecto: con ellas las marcas auxiliares se colocan
   * después de las marcas virtuales aunque haya muchas.
   */
  signals?: Signal[];
}

/** Etiqueta de salto n-ésima: «T» y tres caracteres en base 36 (STEP 7 admite 4 como máximo). */
export function jumpLabel(n: number): string {
  return `T${n.toString(36).toUpperCase().padStart(3, '0')}`;
}

export function generateAWL(blocks: Block[], opts: AwlOptions = {}): string {
  const out: string[] = [];
  const rules = blocks.flatMap((b, bi) => (b.rules || []).map((r) => ({ r, bi, block: b })));

  // 1) Reservar memorias para cada flanco distinto usado.
  const plan = markerPlan(blocks, opts.signals);
  const edges = plan.edges;

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

  /** Una condición; `or` = dentro de un grupo en paralelo (O / ON). */
  const condLine = (c: Condition, or = false): string => {
    const [pos, neg] = or ? ['O', 'ON'] : ['U', 'UN'];
    switch (c.event) {
      case '==1':
        return line(pos, sym(c.signal), `${c.signal} = 1`);
      case '==0':
        return line(neg, sym(c.signal), `${c.signal} = 0`);
      default: {
        const rising = c.event === 'Flanco ascendente';
        const e = edges.get(edgeKey(c.signal, rising))!;
        return line(pos, e.pulse, `flanco ${rising ? '↑' : '↓'} ${c.signal}`);
      }
    }
  };

  /** Grupo de condiciones: una sola en serie, o varias en paralelo U( O O ). */
  const groupLines = (g: Condition[]): string[] =>
    g.length === 1
      ? [condLine(g[0])]
      : [line('U(', '', 'inicio rama en paralelo (O)'), ...g.map((c) => condLine(c, true)), line(')', '', 'fin rama en paralelo')];

  let currentBlock = -1;
  /** Las etiquetas de salto se numeran seguidas en todo el programa. */
  let labels = 0;
  rules.forEach(({ r, bi, block }, idx) => {
    if (bi !== currentBlock) {
      currentBlock = bi;
      out.push(`// ------------------------------------------------------------`);
      out.push(`// BLOQUE: ${block.name}`);
      out.push(`// ------------------------------------------------------------`);
    }
    if (!isRunnable(r)) {
      out.push(`// R${idx + 1} · ${r.name}: omitida (${skipReason(r)}), no se ejecuta.`);
      out.push('');
      return;
    }
    const flag = plan.ruleFlag(idx);
    out.push(`NETWORK // ${network++}`);
    out.push(`TITLE = R${idx + 1} · ${r.name}`);
    conditionGroups(ruleConditions(r)).forEach((g) => out.push(...groupLines(g)));
    out.push(line('=', flag, 'regla activa'));

    ruleActions(r).forEach((a) => {
      if (a.value === '1') {
        out.push(line('U', flag));
        out.push(line('S', sym(a.signal), `SET ${a.signal}`));
      } else if (a.value === '0') {
        out.push(line('U', flag));
        out.push(line('R', sym(a.signal), `RESET ${a.signal}`));
      } else {
        const label = jumpLabel(labels++);
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
