/**
 * Generación de código KOP (diagrama de contactos / Ladder), solo AND en serie.
 *
 * Portado de `generateKOP()` del index.html original.
 */

import type { Block } from '../types';

export function generateKOP(blocks: Block[]): string {
  let kop = '';
  let rungCounter = 1;

  blocks.forEach((bloque) => {
    if (!bloque.rules || bloque.rules.length === 0) return;

    kop += `// ==== BLOQUE: ${bloque.name} ====\n\n`;

    bloque.rules.forEach((rule) => {
      if (!rule.actions || rule.actions.length === 0) return;

      const serieCondiciones = rule.conditions
        .map((c) => {
          switch (c.event) {
            case '==1':
              return `[ ${c.signal} ]`;
            case '==0':
              return `[ /${c.signal} ]`;
            case 'Flanco ascendente':
              return `((↑: ${c.signal}))`;
            case 'Flanco descendente':
              return `((↓: ${c.signal}))`;
            default:
              return `(/*${c.event}: ${c.signal}*/)`;
          }
        })
        .join('──');

      rule.actions.forEach((act) => {
        let coilText: string;
        if (act.value === '1') coilText = `( SET ${act.signal} )`;
        else if (act.value === '0') coilText = `( RESET ${act.signal} )`;
        else if (act.value === 'toggle') coilText = `[ TOGGLE ${act.signal} ]`;
        else coilText = `( ${act.signal} )`;

        kop += `Rung ${rungCounter}:\n`;
        kop += `    ${serieCondiciones}──${coilText}\n\n`;
        rungCounter++;
      });
    });

    kop += `// ==== FIN DE BLOQUE: ${bloque.name} ====\n\n`;
  });

  return kop;
}
