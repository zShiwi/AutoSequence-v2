/**
 * Esquema de contactos (KOP / Ladder) en SVG.
 *
 * Una network por regla: barra de alimentación izquierda, contactos en serie
 * (NA, NC, flanco P/N), bobinas SET/RESET/alternar en paralelo y barra derecha.
 * Bajo cada símbolo se muestra su dirección de la tabla de símbolos.
 */

import type { LadderRung, ContactKind, CoilKind } from '../plc/kop';
import { addressOf, type SymbolEntry } from '../plc/addresses';
import { esc } from '../ui/dom';

const SLOT = 118;
const COIL_ZONE = 210;
const BRANCH_GAP = 70;
const HEAD = 34;
const PAD_Y = 26;

const ink = 'var(--lad-ink, #16212B)';
const muted = 'var(--lad-muted, #6B7884)';
const accent = 'var(--lad-accent, #1E4F7A)';
const rail = 'var(--lad-rail, #16212B)';
const font = "'IBM Plex Sans', Arial, sans-serif";
const mono = "'IBM Plex Mono', 'Courier New', monospace";

function contactSymbol(kind: ContactKind, cx: number, y: number): string {
  const s = [
    `<path d="M${cx - 7} ${y - 11}V${y + 11}M${cx + 7} ${y - 11}V${y + 11}" style="stroke:${ink};stroke-width:2"/>`,
  ];
  if (kind === 'NC') {
    s.push(`<path d="M${cx - 11} ${y + 11}L${cx + 11} ${y - 11}" style="stroke:${ink};stroke-width:1.6"/>`);
  }
  if (kind === 'P' || kind === 'N') {
    s.push(
      `<text x="${cx}" y="${y + 4}" text-anchor="middle" style="font:700 11px ${font};fill:${accent}">${kind}</text>`,
    );
  }
  return s.join('');
}

function coilSymbol(kind: CoilKind, cx: number, y: number): string {
  return [
    `<path d="M${cx - 6} ${y - 11}A13 13 0 0 0 ${cx - 6} ${y + 11}M${cx + 6} ${y - 11}A13 13 0 0 1 ${cx + 6} ${y + 11}" style="fill:none;stroke:${ink};stroke-width:2"/>`,
    `<text x="${cx}" y="${y + 4}" text-anchor="middle" style="font:700 11px ${font};fill:${accent}">${kind}</text>`,
  ].join('');
}

function label(x: number, y: number, name: string, address: string): string {
  return (
    `<text x="${x}" y="${y - 18}" text-anchor="middle" style="font:500 11.5px ${mono};fill:${ink}">${esc(name)}</text>` +
    `<text x="${x}" y="${y + 27}" text-anchor="middle" style="font:400 10px ${mono};fill:${muted}">${esc(address)}</text>`
  );
}

export function renderLadder(rungs: LadderRung[], symbols: SymbolEntry[]): { svg: string; width: number; height: number } {
  const maxContacts = Math.max(1, ...rungs.map((r) => r.contacts.length));
  const width = Math.max(720, 28 + maxContacts * SLOT + COIL_ZONE + 28);
  const left = 24;
  const right = width - 24;
  const out: string[] = [];
  let y = 8;
  let lastBlock = '';

  rungs.forEach((rg) => {
    if (rg.block !== lastBlock) {
      lastBlock = rg.block;
      out.push(
        `<text x="${left}" y="${y + 16}" style="font:600 11px ${font};letter-spacing:.08em;fill:${muted}">${esc(rg.block.toUpperCase())}</text>`,
      );
      y += 28;
    }
    const coils = Math.max(1, rg.coils.length);
    const h = HEAD + PAD_Y + (coils - 1) * BRANCH_GAP + PAD_Y + 14;
    const wy = y + HEAD + PAD_Y + 8; // línea principal

    out.push(
      `<rect x="${left - 10}" y="${y}" width="${right - left + 20}" height="${h}" rx="6" style="fill:var(--lad-bg, #FFFFFF);stroke:var(--lad-frame, #DDE3E8)"/>`,
      `<text x="${left + 4}" y="${y + 21}" style="font:600 12px ${font};fill:${ink}">Network ${rg.number}</text>`,
      `<text x="${left + 82}" y="${y + 21}" style="font:400 12px ${font};fill:${muted}">${esc(rg.title)}</text>`,
    );

    // Barras de alimentación.
    const railTop = y + HEAD;
    const railBot = y + h - 8;
    out.push(
      `<path d="M${left} ${railTop}V${railBot}M${right} ${railTop}V${railBot}" style="stroke:${rail};stroke-width:3"/>`,
    );

    // Contactos en serie.
    let x = left;
    rg.contacts.forEach((c) => {
      const cx = x + SLOT / 2;
      out.push(
        `<path d="M${x} ${wy}H${cx - 7}M${cx + 7} ${wy}H${x + SLOT}" style="stroke:${ink};stroke-width:1.6"/>`,
        contactSymbol(c.kind, cx, wy),
        label(cx, wy, c.signal, addressOf(symbols, c.signal)),
      );
      x += SLOT;
    });

    // Bobinas en paralelo.
    const branchX = x + 18;
    const coilX = right - 70;
    out.push(`<path d="M${x} ${wy}H${branchX}" style="stroke:${ink};stroke-width:1.6"/>`);
    if (rg.coils.length > 1) {
      out.push(
        `<path d="M${branchX} ${wy}V${wy + (rg.coils.length - 1) * BRANCH_GAP}" style="stroke:${ink};stroke-width:1.6"/>`,
        `<path d="M${right - 16} ${wy}V${wy + (rg.coils.length - 1) * BRANCH_GAP}" style="stroke:${ink};stroke-width:1.6"/>`,
      );
    }
    rg.coils.forEach((c, i) => {
      const cy = wy + i * BRANCH_GAP;
      out.push(
        `<path d="M${branchX} ${cy}H${coilX - 13}M${coilX + 13} ${cy}H${right - 16}" style="stroke:${ink};stroke-width:1.6"/>`,
        coilSymbol(c.kind, coilX, cy),
        label(coilX, cy, c.signal, addressOf(symbols, c.signal)),
      );
    });
    out.push(`<path d="M${right - 16} ${wy}H${right}" style="stroke:${ink};stroke-width:1.6"/>`);

    y += h + 14;
  });

  const height = y + 4;
  const svg = `<svg class="ladder-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Esquema de contactos">${out.join('')}</svg>`;
  return { svg, width, height };
}

/** Versión autónoma (colores fijos) para descargar como archivo .svg. */
export function standaloneSvg(svg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace(/var\(--[a-z-]+, ([^)]+)\)/g, '$1')}`;
}
