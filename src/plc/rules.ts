/**
 * Numeración global de reglas (R1, R2…) y su texto compacto.
 *
 * El número es la posición de la regla en el programa (bloques en orden) y
 * coincide con la Network del esquema de contactos, así una regla se sigue
 * igual en Lógica, Simulación, AWL, KOP y Documentación.
 */

import type { Block, Condition, Rule } from '../types';

/**
 * Agrupa las condiciones de una regla: una condición con operador «OR» se
 * une (en paralelo) a la anterior. El resultado es una serie de grupos que
 * se evalúan con Y; dentro de cada grupo, con O.
 *
 *   A · (B O C) · D   →   [[A], [B, C], [D]]
 */
export function conditionGroups(conditions: Condition[]): Condition[][] {
  const groups: Condition[][] = [];
  conditions.forEach((c, i) => {
    if (i > 0 && c.operator === 'OR' && groups.length) groups[groups.length - 1].push(c);
    else groups.push([c]);
  });
  return groups;
}

export type RuleLabeler = (ruleId: number | string, ruleIndex: number) => string;

export function ruleLabeler(blocks: Block[]): RuleLabeler {
  const map = new Map<number | string, string>();
  blocks.flatMap((b) => b.rules).forEach((r, i) => map.set(r.id, `R${i + 1}`));
  return (id, idx) => map.get(id) ?? `R${idx + 1}`;
}

const EV: Record<string, string> = {
  '==1': '= 1',
  '==0': '= 0',
  'Flanco ascendente': '↑',
  'Flanco descendente': '↓',
};
const VAL: Record<string, string> = { '1': 'SET', '0': 'RESET', toggle: 'ALT' };

/** «B1_pieza = 1 · S1_marcha ↑  →  SET M_ciclo, SET CIL_B» */
export function ruleLogicText(rule: Rule): string {
  const one = (x: Condition) => `${x.signal} ${EV[x.event] ?? x.event}`;
  const c = conditionGroups(rule.conditions)
    .map((g) => (g.length > 1 ? `(${g.map(one).join(' O ')})` : one(g[0])))
    .join(' · ');
  const a = rule.actions.map((x) => `${VAL[x.value] ?? x.value} ${x.signal}`).join(', ');
  return `${c}  →  ${a}`;
}
