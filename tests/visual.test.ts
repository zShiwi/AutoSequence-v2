import { describe, expect, it } from 'vitest';
import { fitDistance, placeTags, type TagBox } from '../src/plant/view3d';
import { scrollEdges } from '../src/ui/scrolledges';
import { renderTimingDiagram } from '../src/diagram/timing';
import type { SimStep } from '../src/types';

const box = (x: number, y: number, w = 120, h = 40): TagBox => ({ x, y, w, h, dx: 0, dy: 0, visible: true });
const rect = (b: TagBox) => ({ l: b.x + b.dx - b.w / 2, r: b.x + b.dx + b.w / 2, t: b.y + b.dy - b.h / 2, b: b.y + b.dy + b.h / 2 });
const clash = (a: TagBox, b: TagBox) => {
  const p = rect(a);
  const q = rect(b);
  return p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
};

describe('Vista 3D: etiquetas', () => {
  it('las etiquetas que caen en el mismo sitio se separan sin pisarse', () => {
    const boxes = [box(300, 200), box(310, 205), box(305, 210), box(600, 200)];
    placeTags(boxes, 1000, 600);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(clash(boxes[i], boxes[j]), `${i}-${j}`).toBe(false);
    // La primera tiene preferencia y la que no molesta no se mueve.
    expect([boxes[0].dx, boxes[0].dy]).toEqual([0, 0]);
    expect([boxes[3].dx, boxes[3].dy]).toEqual([0, 0]);
  });

  it('ninguna etiqueta se sale del contenedor', () => {
    const boxes = [box(-30, 100), box(395, 100), box(200, -10), box(200, 399)];
    placeTags(boxes, 390, 380);
    boxes.forEach((b) => {
      const r = rect(b);
      expect(r.l).toBeGreaterThanOrEqual(0);
      expect(r.r).toBeLessThanOrEqual(390);
      expect(r.t).toBeGreaterThanOrEqual(0);
      expect(r.b).toBeLessThanOrEqual(380);
    });
  });

  it('una etiqueta apartada no baila entre fotogramas y vuelve cuando queda sitio', () => {
    const a = box(300, 200);
    const b = box(305, 205);
    placeTags([a, b], 1000, 600);
    const first = [b.dx, b.dy];
    expect(Math.hypot(b.dx, b.dy)).toBeGreaterThan(0);
    placeTags([a, b], 1000, 600);
    expect([b.dx, b.dy]).toEqual(first);
    a.x = 800;
    placeTags([a, b], 1000, 600);
    expect([b.dx, b.dy]).toEqual([0, 0]);
  });

  it('las ocultas no ocupan sitio', () => {
    const a = { ...box(300, 200), visible: false };
    const b = box(300, 200);
    placeTags([a, b], 1000, 600);
    expect([b.dx, b.dy]).toEqual([0, 0]);
  });
});

describe('Vista 3D: encuadre', () => {
  it('en un contenedor estrecho la cámara se aleja hasta que cabe el lazo', () => {
    const span = 6.6;
    const half = Math.tan((17.5 * Math.PI) / 180);
    [16 / 9, 1, 0.94, 0.6].forEach((aspect) => {
      const d = fitDistance(span, aspect);
      // Ancho visible a esa distancia frente al ancho del lazo.
      expect(2 * d * half * aspect, `aspecto ${aspect}`).toBeGreaterThan(span);
    });
    expect(fitDistance(span, 0.6)).toBeGreaterThan(fitDistance(span, 1));
    expect(fitDistance(span, 1)).toBeGreaterThan(fitDistance(span, 16 / 9));
  });
});

describe('Bordes con desplazamiento', () => {
  it('indica por qué lado queda contenido oculto', () => {
    expect(scrollEdges(0, 300, 300)).toEqual({ left: false, right: false });
    expect(scrollEdges(0, 300, 900)).toEqual({ left: false, right: true });
    expect(scrollEdges(200, 300, 900)).toEqual({ left: true, right: true });
    expect(scrollEdges(600, 300, 900)).toEqual({ left: true, right: false });
    // Sin ancho todavía (no está en la página): nada que marcar.
    expect(scrollEdges(0, 0, 900)).toEqual({ left: false, right: false });
  });
});

describe('Cronograma compacto (móvil)', () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ time: i, states: { M01: i % 2, PX21: 1 }, events: [], activations: [] })) as unknown as SimStep[];
  const rows = [
    { name: 'M01', kind: 'out' as const },
    { name: 'PX21', kind: 'in' as const },
  ];
  const width = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);

  it('la columna de nombres se ajusta al nombre más largo y deja sitio a los ciclos', () => {
    const normal = renderTimingDiagram(rows, history, { stepW: 40 });
    const compact = renderTimingDiagram(rows, history, { stepW: 40, compact: true });
    expect(width(normal) - width(compact)).toBeGreaterThan(90);
    expect(compact).toContain('M01');
    expect(compact).not.toContain('>SAL<');
    expect(normal).toContain('>SAL<');
    // El tipo sigue disponible como texto alternativo.
    expect(compact).toContain('<title>Salida</title>');
  });

  it('con nombres largos no pasa del ancho normal', () => {
    const long = [{ name: 'X'.repeat(24), kind: 'mark' as const }];
    const h2 = [{ time: 0, states: { ['X'.repeat(24)]: 0 }, events: [], activations: [] }] as unknown as SimStep[];
    expect(width(renderTimingDiagram(long, h2, { stepW: 40, compact: true }))).toBeLessThanOrEqual(width(renderTimingDiagram(long, h2, { stepW: 40 })));
  });
});
