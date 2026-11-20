/**
 * Numeración global de reglas (R1, R2…) y su texto compacto.
 *
 * El número es la posición de la regla en el programa (bloques en orden) y
 * coincide con la Network del esquema de contactos, así una regla se sigue
 * igual en Lógica, Simulación, AWL, KOP y Documentación. En el AWL el número
 * va en el título de la network («R5 · nombre»): si hay flancos, la primera
 * network es la de detección y la cuenta de STEP 7 va una por delante.
 */

import type { Action, Block, Condition, Rule } from '../types';

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

/** Condiciones de una regla (lista vacía si el proyecto viene mal formado). */
export function ruleConditions(rule: Rule): Condition[] {
  return Array.isArray(rule?.conditions) ? rule.conditions : [];
}

/** Acciones de una regla (lista vacía si el proyecto viene mal formado). */
export function ruleActions(rule: Rule): Action[] {
  return Array.isArray(rule?.actions) ? rule.actions : [];
}

/**
 * Una regla solo se ejecuta si tiene al menos una condición y una acción. El
 * editor no deja crear otra cosa, pero pueden llegar por importación o de
 * proyectos antiguos: simulador, AWL y KOP las omiten por igual (sin
 * condiciones, el AWL copiaría el resultado lógico de la network anterior).
 */
export function isRunnable(rule: Rule): boolean {
  return ruleConditions(rule).length > 0 && ruleActions(rule).length > 0;
}

/** Motivo por el que una regla no se ejecuta, para los comentarios del código. */
export function skipReason(rule: Rule): string {
  return ruleConditions(rule).length ? 'sin acciones' : 'sin condiciones';
}

export type RuleLabeler = (ruleId: number | string, ruleIndex: number) => string;

export function ruleLabeler(blocks: Block[]): RuleLabeler {
  const map = new Map<number | string, string>();
  blocks.flatMap((b) => b.rules || []).forEach((r, i) => map.set(r.id, `R${i + 1}`));
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
  const c = conditionGroups(ruleConditions(rule))
    .map((g) => (g.length > 1 ? `(${g.map(one).join(' O ')})` : one(g[0])))
    .join(' · ');
  const a = ruleActions(rule)
    .map((x) => `${VAL[x.value] ?? x.value} ${x.signal}`)
    .join(', ');
  return `${c}  →  ${a}`;
}
