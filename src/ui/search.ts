/**
 * Búsqueda de texto para Señales y Lógica: sin distinguir mayúsculas ni
 * tildes, y con varias palabras (todas deben aparecer).
 *
 * Funciones puras (sin DOM) para poder probarlas.
 */

import type { Rule, Signal } from '../types';

/** Minúsculas y sin tildes ni diéresis: «Máxima» → «maxima». */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Texto en una sola línea: los saltos (al pegar) pasan a ser espacios. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/** Cada palabra de la consulta debe aparecer en alguno de los campos. */
export function matchesQuery(fields: (string | undefined)[], query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(fields.filter(Boolean).join(' \u0001 '));
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

/** Una señal coincide por nombre, descripción o nombre de sus inductivos. */
export function signalMatches(s: Signal, query: string): boolean {
  return matchesQuery([s.name, s.description, s.inductivoActivo, s.inductivoReposo], query);
}

/**
 * Una regla coincide por su nombre, por cualquier señal de condiciones o
 * acciones, o por su número global. «R11» busca exactamente la regla R11
 * (no R110); «R1 PX01» combina ambas cosas.
 */
export function ruleMatches(rule: Rule, label: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const tokens = q.split(/\s+/);
  const signals = [...rule.conditions.map((c) => c.signal), ...rule.actions.map((a) => a.signal)];
  const hay = normalize([rule.name, ...signals].join(' \u0001 '));
  const lab = normalize(label);
  return tokens.every((tok) => (/^r\d+$/.test(tok) ? tok === lab : hay.includes(tok) || lab === tok));
}
