/**
 * Marca los contenedores con desplazamiento horizontal según quede contenido
 * oculto a la izquierda o a la derecha (`has-more-left` / `has-more-right`).
 * El CSS difumina ese borde para que se vea que el diagrama continúa.
 */

/** Qué bordes tienen contenido oculto, con 2 px de tolerancia por redondeos. */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  if (clientWidth <= 0) return { left: false, right: false };
  return { left: scrollLeft > 2, right: scrollLeft + clientWidth < scrollWidth - 2 };
}

export function watchScrollEdges(root: ParentNode, selector: string): void {
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const update = () => {
      const e = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      el.classList.toggle('has-more-left', e.left);
      el.classList.toggle('has-more-right', e.right);
    };
    el.addEventListener('scroll', update, { passive: true });
    // Al pintar, el contenedor aún puede no estar en la página ni tener ancho.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
    update();
  });
}
