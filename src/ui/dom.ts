/** Pequeños helpers de DOM tipados para las vistas. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  children.forEach((c) =>
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c),
  );
  return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} no encontrado`);
  return node as T;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
