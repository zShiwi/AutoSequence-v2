/** Paso 1 · Señales del sistema. */

import { commit, project, renameSignalRefs, signalUsage, allRules } from '../state/store';
import { exampleBlocks, exampleSignals } from '../data/example';
import { TYPE_HINT, derivedSignals, presenceOwner } from '../plc/signals';
import { canMoveRefs, signalProblems } from '../plc/signalcheck';
import { areaOfSlot, checkAddress, renumberAddresses, type AddressSlot } from '../plc/addresses';
import type { Signal, SignalType } from '../types';
import { confirmDialog, esc, h, icon, qs, toast } from './dom';
import { oneLine, signalMatches } from './search';
import type { App } from './app';
import { openQuickAdd, quickAddBar, type QuickKind } from './quickadd';

const TYPES: SignalType[] = ['Sensor', 'Motor', 'Cilindro', 'Virtual'];
const TYPE_ICON: Record<SignalType, string> = {
  Sensor: 'sensor',
  Motor: 'motor',
  Cilindro: 'cylinder',
  Virtual: 'virtual',
};

type TypeFilter = 'all' | SignalType;

/** Filtros de la tabla (se conservan al cambiar de sección). */
const filters = { q: '', type: 'all' as TypeFilter, unused: false };

const TYPE_FILTERS: { v: TypeFilter; label: string }[] = [
  { v: 'all', label: 'Todos' },
  { v: 'Sensor', label: 'Sensor' },
  { v: 'Motor', label: 'Motor' },
  { v: 'Cilindro', label: 'Cilindro' },
  { v: 'Virtual', label: 'Virtual' },
];

function filtersActive(): boolean {
  return !!filters.q.trim() || filters.type !== 'all' || filters.unused;
}

const ADDR_LABEL: Record<AddressSlot, string> = {
  address: 'Dirección',
  inductivoActivoAddress: 'Dirección del inductivo activo',
  inductivoReposoAddress: 'Dirección del inductivo de reposo',
};

/** Campo de dirección (E/A/M byte.bit) de una señal o de uno de sus inductivos. */
function addrInput(s: Signal, slot: AddressSlot): string {
  const area = areaOfSlot(s, slot);
  const v = s[slot] ?? '';
  return `<input class="input input--mono input--sm addr addr--${area.toLowerCase()}" data-addr="${slot}" value="${esc(v)}" placeholder="${v ? `${area} 0.0` : ''}" spellcheck="false" autocomplete="off" aria-label="${ADDR_LABEL[slot]}" title="${ADDR_LABEL[slot]} en el PLC. No cambia al añadir o borrar otras señales."${v ? '' : ' disabled'} />`;
}

/** Una señal está en uso si alguna regla la usa a ella o a sus inductivos. */
function isUsed(s: Signal): boolean {
  return [s.name, s.inductivoActivo, s.inductivoReposo].some((n) => !!n && signalUsage(n.trim()).length > 0);
}

/** Reglas que usan la señal o alguno de sus inductivos (sin repetir). */
function usageWithInductivos(s: Signal, names: (string | undefined)[] = [s.name, s.inductivoActivo, s.inductivoReposo]) {
  const seen = new Set<string>();
  return names
    .flatMap((n) => (n?.trim() ? signalUsage(n.trim()) : []))
    .filter((u) => {
      const k = `${u.block}\n${u.rule}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function renderSignals(app: App): HTMLElement {
  const p = project();
  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 1 de 5</p>
          <h1>Señales</h1>
          <p class="lede">Entradas, salidas y marcas que intervienen en la máquina. Cada nombre se usa como símbolo en el PLC.</p>
        </div>
      </header>
      <div data-slot="quick">${quickAddBar()}</div>
      <div class="stats" data-slot="stats"></div>
      <div class="filterbar" data-slot="filters" role="search" aria-label="Filtrar señales">
        <label class="searchbox">
          ${icon('search', 16)}
          <input type="search" class="searchbox__input" data-f="q" placeholder="Buscar por nombre o descripción…" aria-label="Buscar señales" autocomplete="off" spellcheck="false" />
          <button type="button" class="searchbox__clear" data-act="clear-q" aria-label="Borrar búsqueda" hidden>${icon('x', 14)}</button>
        </label>
        <div class="fchips" role="group" aria-label="Filtrar por tipo">
          ${TYPE_FILTERS.map((t) => `<button type="button" class="fchip" data-type="${t.v}" aria-pressed="false">${t.label}</button>`).join('')}
        </div>
        <label class="check"><input type="checkbox" data-f="unused" /> Solo sin usar</label>
        <span class="filterbar__count muted small" data-slot="count" aria-live="polite"></span>
      </div>
      <section data-slot="body"></section>
      <footer class="page-foot">
        <span></span>
        <button class="btn btn--ghost" data-act="next">Continuar a Lógica ${icon('chevronRight', 16)}</button>
      </footer>
    </div>`);

  const body = qs(page, '[data-slot="body"]');
  const stats = qs(page, '[data-slot="stats"]');
  const filterBar = qs(page, '[data-slot="filters"]');
  const qInput = qs<HTMLInputElement>(filterBar, '[data-f="q"]');
  const unusedInput = qs<HTMLInputElement>(filterBar, '[data-f="unused"]');
  /** Fila que se mantiene visible aunque deje de cumplir el filtro (se está editando). */
  let keepVisible: number | null = null;

  /** Refleja el estado de los filtros en los controles. */
  const syncControls = () => {
    if (qInput.value !== filters.q) qInput.value = filters.q;
    unusedInput.checked = filters.unused;
    qs(filterBar, '[data-act="clear-q"]').hidden = !filters.q;
    page.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => {
      const on = b.dataset.type === filters.type;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };

  /** Oculta las filas que no cumplen los filtros (sin volver a pintar la tabla). */
  const applyFilters = () => {
    syncControls();
    const rows = body.querySelectorAll<HTMLTableRowElement>('tr[data-i]');
    let shown = 0;
    rows.forEach((tr) => {
      const i = Number(tr.dataset.i);
      const s = p.signals[i];
      const ok =
        i === keepVisible ||
        ((filters.type === 'all' || s.type === filters.type) &&
          (!filters.unused || !isUsed(s)) &&
          signalMatches(s, filters.q));
      tr.hidden = !ok;
      if (ok) shown++;
    });
    const total = p.signals.length;
    const count = qs(filterBar, '[data-slot="count"]');
    count.textContent = filtersActive() ? `Mostrando ${shown} de ${total}` : `${total} señal${total === 1 ? '' : 'es'}`;
    const empty = body.querySelector<HTMLElement>('[data-slot="fempty"]');
    if (empty) empty.hidden = !(total > 0 && shown === 0);
    const table = body.querySelector<HTMLElement>('.table-scroll');
    if (table) table.hidden = total > 0 && shown === 0;
  };

  const clearFilters = () => {
    filters.q = '';
    filters.type = 'all';
    filters.unused = false;
    keepVisible = null;
    applyFilters();
  };

  const drawStats = () => {
    const s = p.signals;
    const count = (t: SignalType) => s.filter((x) => x.type === t).length;
    const ind = derivedSignals(s).length;
    const items: [SignalType, string, number, string][] = [
      ['Sensor', 'Sensores', count('Sensor'), 'Entradas digitales'],
      ['Motor', 'Motores', count('Motor'), 'Salidas digitales'],
      ['Cilindro', 'Cilindros', count('Cilindro'), `${ind} inductivo${ind === 1 ? '' : 's'}`],
      ['Virtual', 'Virtuales', count('Virtual'), 'Marcas internas'],
    ];
    stats.innerHTML = items
      .map(([t, l, n, d]) => {
        const on = filters.type === t;
        return `<button type="button" class="stat stat--btn${on ? ' is-active' : ''}" data-type="${t}" aria-pressed="${on}" title="${on ? 'Quitar filtro' : `Mostrar solo ${l.toLowerCase()}`}"${s.length ? '' : ' disabled'}><span class="stat__label">${l}</span><span class="stat__value">${n}</span><span class="stat__hint">${d}</span></button>`;
      })
      .join('');
  };

  const refreshValidation = () => {
    const probs = signalProblems(p.signals);
    body.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) => {
      const i = Number(tr.dataset.i);
      const prob = probs.get(i);
      const err = tr.querySelector<HTMLElement>('.cell-error')!;
      err.textContent = prob?.text ?? '';
      err.hidden = !prob;
      (['name', 'inductivoActivo', 'inductivoReposo'] as const).forEach((f) =>
        tr.querySelector<HTMLInputElement>(`input[data-f="${f}"]`)?.toggleAttribute('aria-invalid', prob?.field === f),
      );
      const usage = signalUsage(p.signals[i].name.trim());
      tr.querySelector('.usage')!.innerHTML = usage.length
        ? `<span class="badge badge--neutral" title="${esc(usage.map((u) => `${u.block} › ${u.rule}`).join('\n'))}">${usage.length} regla${usage.length === 1 ? '' : 's'}</span>`
        : '<span class="muted">—</span>';
    });
    refreshAddresses();
    drawStats();
  };

  /**
   * Pone en cada campo la dirección guardada (las señales nuevas y los
   * inductivos recién escritos la reciben al guardar). No toca el campo que
   * se está editando ni el que tiene un valor rechazado a la vista.
   */
  const refreshAddresses = () => {
    body.querySelectorAll<HTMLInputElement>('input[data-addr]').forEach((input) => {
      const s = p.signals[Number(input.closest<HTMLElement>('tr[data-i]')!.dataset.i)];
      const slot = input.dataset.addr as AddressSlot;
      const v = s[slot] ?? '';
      input.disabled = !v;
      input.placeholder = v ? `${areaOfSlot(s, slot)} 0.0` : '';
      if (document.activeElement === input || input.hasAttribute('aria-invalid')) return;
      input.value = v;
    });
  };

  const renumber = async () => {
    const ok = await confirmDialog(
      'Renumerar todas las direcciones',
      `Se volverán a asignar todas las direcciones (<strong>E</strong>, <strong>A</strong> y <strong>M</strong>) seguidas y sin huecos, en el orden de la lista.</p>
       <p class="modal__text">Las que hayas puesto a mano se pierden, y la documentación ya impresa o el cableado pueden dejar de coincidir con el programa.`,
      { confirm: 'Renumerar todo', danger: true },
    );
    if (!ok) return;
    const n = renumberAddresses(p.signals);
    commit({ separate: true });
    toast(
      n ? `Direcciones renumeradas: ${n} ${n === 1 ? 'ha cambiado' : 'han cambiado'}.` : 'Las direcciones ya estaban seguidas y sin huecos.',
      n ? undefined : 'info',
    );
    draw();
  };

  const draw = () => {
    filterBar.hidden = !p.signals.length;
    if (!p.signals.length) {
      body.innerHTML = `
        <div class="empty">
          <div class="empty__art" aria-hidden="true">${icon('signals', 34)}</div>
          <h2>Sin señales todavía</h2>
          <p>Empieza por los topes: con un clic se crean el cilindro, sus inductivos de activo y reposo y el sensor de presencia. Después, los sensores, motores y marcas sueltos.</p>
          <div class="empty__actions">
            <button class="btn btn--primary" data-quick="stop">${icon('cylinder', 16)}<span>Añadir primer tope</span></button>
            <button class="btn btn--ghost" data-act="add">${icon('plus', 16)}<span>Añadir primera señal</span></button>
            <button class="btn btn--ghost" data-act="example">${icon('play', 16)}<span>Cargar ejemplo</span></button>
          </div>
        </div>`;
      qs(body, '[data-act="add"]').addEventListener('click', add);
      qs(body, '[data-act="example"]').addEventListener('click', loadExample);
      drawStats();
      return;
    }

    body.innerHTML = `
      <div class="card card--flush">
        <div class="table-scroll">
          <table class="table table--edit table--signals">
            <thead><tr>
              <th class="col-name">Nombre</th>
              <th class="col-type">Tipo</th>
              <th class="col-init">Inicial</th>
              <th>Descripción</th>
              <th class="col-ind" title="Inductivos de posición y sensor de presencia de cada cilindro">Inductivos</th>
              <th class="col-addr">Dirección</th>
              <th class="col-use">Uso</th>
              <th class="actions"><span class="sr-only">Eliminar</span></th>
            </tr></thead>
            <tbody>
              ${p.signals
                .map(
                  (s, i) => `
                <tr data-i="${i}"${s.type === 'Cilindro' ? ' class="row--stop"' : presenceOwner(p.signals, s.name.trim()) ? ' class="row--presence"' : ''}>
                  <td>
                    <div class="name-cell"><span class="type-ico type-ico--${s.type.toLowerCase()}">${icon(TYPE_ICON[s.type], 16)}</span>
                    <input class="input input--mono" data-f="name" value="${esc(s.name)}" placeholder="p. ej. CIL_A" spellcheck="false" aria-label="Nombre de la señal" /></div>
                    <p class="cell-error" hidden></p>
                    <p class="addr-error" data-slot="addr-error" role="alert" hidden></p>
                  </td>
                  <td>
                    <select class="input" data-f="type" aria-label="Tipo">
                      ${TYPES.map((t) => `<option value="${t}"${t === s.type ? ' selected' : ''}>${t}</option>`).join('')}
                    </select>
                    <span class="cell-hint">${s.type === 'Cilindro' && s.presence ? 'Tope · con presencia' : TYPE_HINT[s.type]}</span>
                  </td>
                  <td>
                    <button class="bit${s.initial ? ' bit--on' : ''}" data-f="initial" aria-pressed="${s.initial === 1}" title="Estado al arrancar">${s.initial}</button>
                  </td>
                  <td><textarea class="input input--area" data-f="description" rows="1" placeholder="Función de la señal" aria-label="Descripción" title="${esc(s.description)}">${esc(s.description)}</textarea></td>
                  <td>
                    ${
                      s.type === 'Cilindro'
                        ? `<div class="ind-pair">
                             <div class="ind-row"><label title="Inductivo activo: tope abierto / cilindro extendido"><span>Act.</span><input class="input input--mono input--sm" data-f="inductivoActivo" value="${esc(s.inductivoActivo ?? '')}" placeholder="${esc(s.name || 'CIL')}PX2" spellcheck="false" aria-label="Inductivo activo" /></label>${addrInput(s, 'inductivoActivoAddress')}</div>
                             <div class="ind-row"><label title="Inductivo de reposo: tope cerrado / cilindro retraído"><span>Rep.</span><input class="input input--mono input--sm" data-f="inductivoReposo" value="${esc(s.inductivoReposo ?? '')}" placeholder="${esc(s.name || 'CIL')}PX1" spellcheck="false" aria-label="Inductivo de reposo" /></label>${addrInput(s, 'inductivoReposoAddress')}</div>
                             <label title="Sensor que detecta la paleta parada en este tope"><span>Pres.</span><select class="input input--mono input--sm" data-f="presence" aria-label="Sensor de presencia del tope">${presenceOptions(p.signals, s.presence)}</select></label>
                           </div>`
                        : presenceChip(p.signals, s)
                    }
                  </td>
                  <td class="addr-cell">${addrInput(s, 'address')}</td>
                  <td class="usage"></td>
                  <td class="actions"><button class="icon-btn icon-btn--danger" data-f="delete" aria-label="Eliminar señal">${icon('trash', 16)}</button></td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="filter-empty" data-slot="fempty" hidden>
          ${icon('search', 22)}
          <p><strong>Ninguna señal coincide</strong> con la búsqueda y los filtros actuales.</p>
          <button type="button" class="btn btn--ghost btn--sm" data-act="clear-filters">${icon('x', 15)}<span>Quitar filtros</span></button>
        </div>
        <div class="card__foot">
          <button class="btn btn--ghost btn--sm" data-act="add">${icon('plus', 16)}<span>Añadir señal</span></button>
          <button class="btn btn--ghost btn--sm" data-act="renumber" title="Volver a asignar todas las direcciones seguidas y sin huecos">${icon('reset', 16)}<span>Renumerar todo</span></button>
          <span class="muted small">Los cambios se guardan automáticamente. Al renombrar una señal se actualizan las reglas que la usan. Cada señal conserva su dirección aunque añadas o borres otras.</span>
        </div>
      </div>`;

    qs(body, '[data-act="add"]').addEventListener('click', add);
    qs(body, '[data-act="renumber"]').addEventListener('click', renumber);
    qs(body, '[data-act="clear-filters"]').addEventListener('click', () => {
      clearFilters();
      qInput.focus();
    });
    body.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) => bindRow(tr));
    refreshValidation();
    applyFilters();
    resizeAreas();
  };

  /** Ajusta la altura de las descripciones (al pintar y al cambiar el ancho). */
  const resizeAreas = () => {
    if (FIELD_SIZING) return;
    requestAnimationFrame(() => body.querySelectorAll<HTMLTextAreaElement>('textarea.input--area').forEach(autosize));
  };
  if (!FIELD_SIZING && typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeAreas).observe(body);

  const bindRow = (tr: HTMLTableRowElement) => {
    const i = Number(tr.dataset.i);
    const s = p.signals[i];

    tr.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-f], textarea[data-f]').forEach((input) => {
      const f = input.dataset.f as 'name' | 'description' | 'inductivoActivo' | 'inductivoReposo';
      input.addEventListener('input', () => {
        if (f === 'description') {
          // La descripción es una sola línea (va a comentarios del AWL y al CSV):
          // el campo crece para verla entera, pero no admite saltos de línea.
          const flat = oneLine(input.value);
          if (flat !== input.value) input.value = flat;
          input.title = flat;
          autosize(input as HTMLTextAreaElement);
        }
        (s as unknown as Record<string, string>)[f] = f === 'description' ? input.value : input.value.trim();
        commit();
        refreshValidation();
      });
      if (f === 'description') {
        input.addEventListener('keydown', (e) => {
          if ((e as KeyboardEvent).key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
      }
      if (f === 'name' || f === 'inductivoActivo' || f === 'inductivoReposo') {
        // Nombre al que apuntan ahora las reglas. Solo cambia cuando el
        // renombrado se aplica: un nombre vacío, no válido u ocupado se queda
        // en el campo (con su aviso) sin tocar las referencias, y al
        // corregirlo se parte otra vez del último nombre bueno.
        let committed = input.value.trim();
        input.addEventListener('change', () => {
          const after = input.value.trim();
          const prev = committed;
          const move = canMoveRefs(p.signals, prev, after);
          if (move) {
            const n = renameSignalRefs(prev, after);
            if (n) toast(`«${prev}» → «${after}»: ${n} referencia${n === 1 ? '' : 's'} actualizada${n === 1 ? '' : 's'} en las reglas.`, 'info');
            commit();
          }
          if (move || !prev || prev === after) committed = after;
          const linked = f === 'name' && move && (s.type === 'Cilindro' || p.signals.some((x) => x.presence === after));
          refreshValidation();
          if (linked) draw();
        });
      }
    });

    // Direcciones: se validan al escribir y se guardan al salir del campo.
    const addrError = qs(tr, '[data-slot="addr-error"]');
    const addrInputs = [...tr.querySelectorAll<HTMLInputElement>('input[data-addr]')];
    const showAddrError = () => {
      const bad = addrInputs.find((x) => x.hasAttribute('aria-invalid'));
      addrError.textContent = bad ? `${ADDR_LABEL[bad.dataset.addr as AddressSlot]}: ${bad.dataset.error}` : '';
      addrError.hidden = !bad;
    };
    addrInputs.forEach((input) => {
      const slot = input.dataset.addr as AddressSlot;
      const check = () => {
        const r = checkAddress(p.signals, i, slot, input.value);
        input.toggleAttribute('aria-invalid', !r.ok);
        input.dataset.error = r.ok ? '' : r.error;
        showAddrError();
        return r;
      };
      const restore = () => {
        input.value = s[slot] ?? '';
        input.removeAttribute('aria-invalid');
        showAddrError();
      };
      input.addEventListener('input', check);
      input.addEventListener('change', () => {
        // Vacío: se vuelve a la dirección guardada (no puede quedar sin ninguna).
        if (!input.value.trim()) return restore();
        const r = check();
        if (!r.ok) return;
        input.value = r.address;
        if (s[slot] === r.address) return;
        s[slot] = r.address;
        commit({ separate: true });
        // Otra fila podía estar marcada por chocar con la dirección que se libera.
        body
          .querySelectorAll<HTMLInputElement>('input[data-addr][aria-invalid]')
          .forEach((x) => x.dispatchEvent(new Event('input')));
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value !== (s[slot] ?? '')) {
          e.preventDefault();
          e.stopPropagation();
          restore();
        }
      });
    });

    tr.querySelector<HTMLSelectElement>('[data-f="presence"]')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v) s.presence = v;
      else delete s.presence;
      // Un sensor solo puede ser la presencia de un tope.
      p.signals.forEach((x) => x !== s && x.presence === v && v && delete x.presence);
      keepVisible = i;
      commit();
      draw();
    });

    qs<HTMLSelectElement>(tr, '[data-f="type"]').addEventListener('change', async (e) => {
      const select = e.target as HTMLSelectElement;
      const next = select.value as SignalType;
      // Dejar de ser cilindro borra sus inductivos: se avisa si hay reglas que los usan.
      const usage = s.type === 'Cilindro' && next !== 'Cilindro' ? usageWithInductivos(s, [s.inductivoActivo, s.inductivoReposo]) : [];
      if (usage.length) {
        const ok = await confirmDialog(
          'Cambiar el tipo de un cilindro en uso',
          `Al dejar de ser un cilindro, <strong>${esc(s.name)}</strong> pierde sus inductivos, que se usan en ${usage.length} regla${usage.length === 1 ? '' : 's'}:</p>
           <ul class="modal__list">${usage.map((u) => `<li>${esc(u.block)} › ${esc(u.rule)}</li>`).join('')}</ul>
           <p class="modal__text">Esas reglas quedarán marcadas como incompletas hasta que las corrijas.`,
          { confirm: 'Cambiar igualmente', danger: true },
        );
        if (!ok) {
          select.value = s.type;
          return;
        }
      }
      s.type = next;
      if (s.type !== 'Cilindro') {
        delete s.inductivoActivo;
        delete s.inductivoReposo;
        delete s.presence;
      }
      keepVisible = i;
      commit();
      draw();
    });

    qs(tr, '[data-f="initial"]').addEventListener('click', () => {
      s.initial = s.initial === 1 ? 0 : 1;
      commit();
      const b = qs(tr, '[data-f="initial"]');
      b.textContent = String(s.initial);
      b.classList.toggle('bit--on', s.initial === 1);
      b.setAttribute('aria-pressed', String(s.initial === 1));
    });

    qs(tr, '[data-f="delete"]').addEventListener('click', async () => {
      // Con un cilindro se van también sus inductivos: cuentan las reglas que los usan.
      const own = signalUsage(s.name.trim()).length;
      const usage = s.type === 'Cilindro' ? usageWithInductivos(s) : signalUsage(s.name.trim());
      if (usage.length) {
        const ok = await confirmDialog(
          'Eliminar señal en uso',
          `<strong>${esc(s.name)}</strong>${usage.length > own ? ' o sus inductivos se usan' : ' se usa'} en ${usage.length} regla${usage.length === 1 ? '' : 's'}:</p>
           <ul class="modal__list">${usage.map((u) => `<li>${esc(u.block)} › ${esc(u.rule)}</li>`).join('')}</ul>
           <p class="modal__text">Esas reglas quedarán marcadas como incompletas hasta que las corrijas.`,
          { confirm: 'Eliminar igualmente', danger: true },
        );
        if (!ok) return;
      }
      p.signals.splice(i, 1);
      p.signals.forEach((x) => x.presence === s.name.trim() && delete x.presence);
      commit();
      draw();
    });
  };

  const add = () => {
    // Con filtros activos la fila nueva podría quedar oculta: se quitan.
    filters.q = '';
    filters.type = 'all';
    filters.unused = false;
    keepVisible = null;
    p.signals.push({ name: '', type: 'Sensor', initial: 0, description: '' });
    commit();
    draw();
    const rows = body.querySelectorAll<HTMLInputElement>('[data-f="name"]');
    rows[rows.length - 1]?.focus();
  };

  const loadExample = async () => {
    const hasRules = allRules().length > 0;
    p.signals = exampleSignals();
    if (!hasRules) p.blocks = exampleBlocks();
    commit();
    toast(hasRules ? 'Señales de ejemplo cargadas.' : 'Ejemplo cargado: señales y reglas de una estación de transferencia.');
    draw();
  };

  /** Tras un alta rápida: quita filtros, repinta y resalta lo creado. */
  const created = (names: string[]) => {
    filters.q = '';
    filters.type = 'all';
    filters.unused = false;
    keepVisible = null;
    draw();
    const rows = names
      .map((n) => p.signals.findIndex((x) => x.name === n))
      .map((i) => body.querySelector<HTMLElement>(`tr[data-i="${i}"]`))
      .filter((x): x is HTMLElement => !!x);
    rows.forEach((tr) => tr.classList.add('is-new'));
    rows[rows.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  page.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-quick]')?.dataset.quick;
    if (k) openQuickAdd(k as QuickKind, created);
  });
  qs(page, '[data-act="next"]').addEventListener('click', () => app.go('logic'));

  // ---- Filtros -------------------------------------------------------------
  qInput.addEventListener('input', () => {
    filters.q = qInput.value;
    keepVisible = null;
    applyFilters();
  });
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qInput.value) {
      e.preventDefault();
      e.stopPropagation();
      filters.q = '';
      applyFilters();
    }
  });
  qs(filterBar, '[data-act="clear-q"]').addEventListener('click', () => {
    filters.q = '';
    applyFilters();
    qInput.focus();
  });
  unusedInput.addEventListener('change', () => {
    filters.unused = unusedInput.checked;
    keepVisible = null;
    applyFilters();
  });
  const pickType = (t: TypeFilter) => {
    // Pulsar el filtro activo lo quita.
    filters.type = filters.type === t && t !== 'all' ? 'all' : t;
    keepVisible = null;
    applyFilters();
  };
  filterBar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-type]')?.dataset.type;
    if (t) pickType(t as TypeFilter);
  });
  stats.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-type]')?.dataset.type;
    if (t) pickType(t as TypeFilter);
  });

  draw();
  return page;
}

/** El navegador ajusta solo la altura del campo al contenido (CSS field-sizing). */
const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

/** Altura del campo según su contenido, donde el navegador no lo hace solo. */
function autosize(ta: HTMLTextAreaElement): void {
  if (FIELD_SIZING || !ta.offsetParent) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

/** Opciones del selector de presencia de un tope: sensores existentes. */
function presenceOptions(signals: Signal[], current: string | undefined): string {
  const sensors = signals.filter((x) => x.type === 'Sensor' && x.name.trim());
  const missing = current && !sensors.some((x) => x.name === current);
  return (
    `<option value=""${current ? '' : ' selected'}>—</option>` +
    sensors
      .map((x) => `<option value="${esc(x.name)}"${x.name === current ? ' selected' : ''}>${esc(x.name)}</option>`)
      .join('') +
    (missing ? `<option value="${esc(current)}" selected>${esc(current)} (no existe)</option>` : '')
  );
}

/** En un sensor: indica de qué tope es la presencia. */
function presenceChip(signals: Signal[], s: Signal): string {
  const owner = s.type === 'Sensor' ? presenceOwner(signals, s.name.trim()) : undefined;
  return owner
    ? `<span class="badge badge--stop" title="Detecta la paleta parada en el tope ${esc(owner.name)}">${icon('cylinder', 13)}Presencia del tope ${esc(owner.name)}</span>`
    : '<span class="muted">—</span>';
}
