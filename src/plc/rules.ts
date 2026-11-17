/**
 * Numeración global de reglas (R1, R2…) y su texto compacto.
 *
 * El número es la posición de la regla en el programa (bloques en orden) y
 * coincide con la Network del esquema de contactos, así una regla se sigue
 * igual en Lógica, Simulación, AWL, KOP y Documentación.
 */

import type { Block, Rule } from '../types';

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
  const c = rule.conditions.map((x) => `${x.signal} ${EV[x.event] ?? x.event}`).join(' · ');
  const a = rule.actions.map((x) => `${VAL[x.value] ?? x.value} ${x.signal}`).join(', ');
  return `${c}  →  ${a}`;
}
