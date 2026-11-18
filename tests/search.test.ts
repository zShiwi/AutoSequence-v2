import { describe, expect, it } from 'vitest';
import { matchesQuery, normalize, ruleMatches, signalMatches } from '../src/ui/search';
import { acu4Blocks, acu4Signals } from '../src/data/acu4';
import type { Rule } from '../src/types';

describe('Búsqueda', () => {
  it('ignora mayúsculas y tildes', () => {
    expect(normalize('  Máxima ACUMULACIÓN ')).toBe('maxima acumulacion');
    expect(matchesQuery(['Máxima acumulación antes de pre-descarga'], 'maxima')).toBe(true);
    expect(matchesQuery(['Tránsito pre-carga'], 'TRANSITO')).toBe(true);
  });

  it('todas las palabras deben aparecer', () => {
    expect(matchesQuery(['Paleta en tope de carga'], 'paleta carga')).toBe(true);
    expect(matchesQuery(['Paleta en tope de carga'], 'paleta descarga')).toBe(false);
    expect(matchesQuery(['algo'], '   ')).toBe(true);
  });

  it('las señales coinciden por nombre, descripción e inductivos', () => {
    const signals = acu4Signals();
    const c01 = signals.find((s) => s.name === 'C01')!;
    expect(signalMatches(c01, 'c01px2')).toBe(true);
    expect(signalMatches(c01, 'pre-carga')).toBe(true);
    const names = signals.filter((s) => signalMatches(s, 'acumulacion')).map((s) => s.name);
    expect(names).toEqual(['PX04', 'PX08']);
  });

  it('las reglas coinciden por nombre, señal o número exacto', () => {
    const rules: Rule[] = acu4Blocks().flatMap((b) => b.rules);
    const label = (i: number) => `R${i + 1}`;
    const bySignal = rules.filter((r, i) => ruleMatches(r, label(i), 'PX04')).map((r) => r.name);
    expect(bySignal).toEqual(['Abrir carga']);
    const px0 = rules.filter((r, i) => ruleMatches(r, label(i), 'px0')).length;
    expect(px0).toBeGreaterThan(4);
    // R1 no debe coincidir con R10…R19
    const r1 = rules.filter((r, i) => ruleMatches(r, label(i), 'r1')).map((_, i) => i);
    expect(r1).toHaveLength(1);
    expect(ruleMatches(rules[10], 'R11', 'R11')).toBe(true);
    expect(ruleMatches(rules[10], 'R11', 'r11 c02')).toBe(true);
    expect(ruleMatches(rules[10], 'R11', 'r11 c04')).toBe(false);
  });
});
