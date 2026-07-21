/**
 * Generación de código AWL (STEP 7 / lista de instrucciones Siemens).
 *
 * Portado de `generateAWL()` del index.html original.
 */

import type { Block } from '../types';

export function generateAWL(blocks: Block[]): string {
  let awl = '';
  awl += '      // ==== BLOQUE OB1 AUTOGENERADO ====\n';
  awl += 'VERSION : 5.5\n';
  awl += 'OB1   // Bloque principal\n\n';

  blocks.forEach((bloque, idxBloque) => {
    if (!bloque.rules || bloque.rules.length === 0) return;

    awl += `      // --- BLOQUE: ${bloque.name} ---\n`;
    bloque.rules.forEach((rule, idxRule) => {
      awl += `\n      // Regla ${idxRule + 1}: ${rule.name}\n`;

      const etiquetaSalto = `NO_CUMPLE_B${idxBloque}_R${idxRule}`;
      const etiquetaFin = `FIN_B${idxBloque}_R${idxRule}`;

      // Condiciones (AND): cada una salta a la etiqueta si no se cumple.
      rule.conditions.forEach((cond) => {
        const senal = cond.signal;
        if (cond.event === '==1' || cond.event === '==0') {
          const valor = cond.event === '==1' ? '1' : '0';
          awl += `      L   #${senal}\n`;
          awl += `      L   ${valor}\n`;
          awl += `      ==I\n`;
          awl += `      JC  ${etiquetaSalto}\n`;
        } else if (cond.event === 'Flanco ascendente') {
          awl += `      // Flanco ascendente ${senal}: (previo=0 y actual=1)\n`;
          awl += `      // (Aún no implementado retener estado anterior)\n`;
          awl += `      L   #${senal}\n`;
          awl += `      L   1\n`;
          awl += `      ==I\n`;
          awl += `      JC  ${etiquetaSalto}\n`;
        } else if (cond.event === 'Flanco descendente') {
          awl += `      // Flanco descendente ${senal}: (previo=1 y actual=0)\n`;
          awl += `      // (Aún no implementado retener estado anterior)\n`;
          awl += `      L   #${senal}\n`;
          awl += `      L   0\n`;
          awl += `      ==I\n`;
          awl += `      JC  ${etiquetaSalto}\n`;
        } else {
          awl += `      L   #${senal}\n`;
          awl += `      L   1\n`;
          awl += `      ==I\n`;
          awl += `      JC  ${etiquetaSalto}\n`;
        }
      });

      // Acciones: se ejecutan si todas las condiciones pasaron.
      rule.actions.forEach((act, idxAcc) => {
        const senalAcc = act.signal;
        if (act.value === '1' || act.value === '0') {
          awl += `      L   ${act.value}\n`;
          awl += `      T   #${senalAcc}\n`;
        } else if (act.value === 'toggle') {
          const etTog = `TOG_B${idxBloque}_R${idxRule}_A${idxAcc}`;
          const etTogFin = `FIN_TOG_B${idxBloque}_R${idxRule}_A${idxAcc}`;
          awl += `      // Toggle ${senalAcc}\n`;
          awl += `      L   #${senalAcc}\n`;
          awl += `      L   1\n`;
          awl += `      ==I\n`;
          awl += `      JC  ${etTog}\n`;
          awl += `      L   1\n`;
          awl += `      T   #${senalAcc}\n`;
          awl += `      JU  ${etTogFin}\n`;
          awl += `\n${etTog}:\n`;
          awl += `      L   0\n`;
          awl += `      T   #${senalAcc}\n`;
          awl += `${etTogFin}:\n`;
        }
      });

      awl += `\n${etiquetaSalto}:\n`;
      awl += `      NOP\n`;
      awl += `${etiquetaFin}:\n`;
      awl += `      NOP\n\n`;
    });
  });

  awl += '      // ==== FIN DE BLOQUE OB1 ====\n';
  return awl;
}
