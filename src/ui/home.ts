/** Pantalla de proyectos. */

import {
  createProject,
  deleteProject,
  duplicateProject,
  exportProjectJSON,
  formatRelative,
  exportAllJSON,
  importFile,
  loadProjects,
  nameTaken,
  previewImport,
  type ImportPreview,
} from '../state/store';
import { lastBackupAt, listTrash, TRASH_DAYS } from '../state/backups';
import { openTrash } from './backups';
import { matchesQuery } from './search';
import { TEMPLATES, templateStats, type Template } from '../data/templates';
import { buildAcu, clampStops, kindLabel, MAX_STOPS, MIN_STOPS, stopName } from '../data/acuwizard';
import type { ConveyorKind } from '../types';
import { confirmDialog, dateStamp, download, esc, exportFileName, h, icon, modal, qs, toast } from './dom';
import type { App } from './app';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Antes de importar: qué proyectos entran, cuáles cambian de nombre por estar
 * repetido y cuáles se descartan. No se guarda nada hasta confirmar.
 */
function confirmImport(fileName: string, preview: Extract<ImportPreview, { ok: true }>): Promise<boolean> {
  const { entries, discarded } = preview;
  const renamed = entries.filter((e) => e.renamed).length;
  const body = h(`
    <div class="import-preview">
      <p class="modal__text">${
        preview.kind === 'backup' ? 'Copia de seguridad' : 'Proyecto'
      } <strong>${esc(fileName)}</strong>. Los proyectos que ya tienes no se modifican.</p>
      <section class="import-preview__group" data-group="in">
        <h3>${icon('check', 15)}<span>Se ${entries.length === 1 ? 'importará' : 'importarán'} ${plural(entries.length, 'proyecto', 'proyectos')}${
          renamed ? `, ${renamed === 1 ? 'uno' : renamed} con otro nombre` : ''
        }</span></h3>
        <ul class="import-preview__list">
          ${entries
            .map(
              (e) => `<li${e.renamed ? ' class="is-renamed"' : ''}>
                <div class="import-preview__name">${
                  e.renamed
                    ? `<span class="import-preview__old">${esc(e.name)}</span><span class="import-preview__arrow" aria-hidden="true">→</span><strong>${esc(e.finalName)}</strong>`
                    : `<strong>${esc(e.finalName)}</strong>`
                }</div>
                <span class="muted small">${plural(e.signals, 'señal', 'señales')} · ${plural(e.rules, 'regla', 'reglas')} · ${plural(e.blocks, 'bloque', 'bloques')}</span>
                ${e.renamed ? `<span class="import-preview__why small">Se renombra porque ya existe «${esc(e.name)}».</span>` : ''}
              </li>`,
            )
            .join('')}
        </ul>
      </section>
      ${
        discarded.length
          ? `<section class="import-preview__group import-preview__group--bad" data-group="out">
              <h3>${icon('alert', 15)}<span>Se ${discarded.length === 1 ? 'descartará' : 'descartarán'} ${plural(discarded.length, 'elemento dañado', 'elementos dañados')}</span></h3>
              <ul class="import-preview__list">
                ${discarded.map((d) => `<li><div class="import-preview__name"><strong>${esc(d.name)}</strong></div><span class="muted small">${esc(d.reason)}</span></li>`).join('')}
              </ul>
            </section>`
          : ''
      }
    </div>`);
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: 'Importar proyectos',
      body,
      wide: true,
      onClose: () => {
        if (!answered) resolve(false);
      },
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: `Importar ${plural(entries.length, 'proyecto', 'proyectos')}`,
          variant: 'primary',
          run: () => {
            answered = true;
            resolve(true);
          },
        },
      ],
    });
  });
}

type WizardKind = ConveyorKind | 'vacio';

/** Nombre libre: «base», o «base (2)», «base (3)»… si ya existe. */
function freeProjectName(base: string): string {
  let name = base;
  let n = 2;
  while (nameTaken(name)) name = `${base} (${n++})`;
  return name;
}

/**
 * Asistente de «Nuevo proyecto»: pregunta si el ACU es aéreo o de suelo y
 * cuántos topes tiene, y crea solo el motor (con su secuencia) y los topes.
 */
function newProjectWizard(app: App): void {
  let kind: WizardKind = 'aereo';
  let stops = 4;
  /** Mientras el usuario no escriba un nombre, se propone uno solo. */
  let nameTouched = false;
  const autoName = () =>
    kind === 'vacio' ? '' : freeProjectName(`ACU ${kindLabel(kind)} ${stops} ${stops === 1 ? 'tope' : 'topes'}`);

  const form = h(`
    <form class="wizard" novalidate>
      <fieldset class="wizard__group">
        <legend class="field__label">¿Qué vas a programar?</legend>
        <div class="segmented wizard__kind" role="radiogroup" aria-label="Tipo de proyecto">
          <button type="button" role="radio" data-kind="aereo" aria-label="ACU aéreo">${icon('conveyor', 15)}<span class="lbl-long">ACU aéreo</span><span class="lbl-short">Aéreo</span></button>
          <button type="button" role="radio" data-kind="suelo" aria-label="ACU de suelo">${icon('conveyor', 15)}<span class="lbl-long">ACU de suelo</span><span class="lbl-short">De suelo</span></button>
          <button type="button" role="radio" data-kind="vacio">${icon('folder', 15)}<span>Vacío</span></button>
        </div>
      </fieldset>
      <div class="field wizard__stops" data-slot="stops">
        <label class="field__label" for="wiz-stops">Número de topes</label>
        <div class="stepper">
          <button type="button" class="icon-btn" data-step="-1" aria-label="Un tope menos">−</button>
          <input id="wiz-stops" class="input stepper__input" type="number" inputmode="numeric" min="${MIN_STOPS}" max="${MAX_STOPS}" value="${stops}" />
          <button type="button" class="icon-btn" data-step="1" aria-label="Un tope más">+</button>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="wiz-name">Nombre del proyecto</label>
        <input id="wiz-name" class="input" autocomplete="off" />
        <p class="field__error" hidden></p>
      </div>
      <div class="wizard__summary" data-slot="summary" aria-live="polite"></div>
    </form>`);
  const nameInput = qs<HTMLInputElement>(form, '#wiz-name');
  const stopsInput = qs<HTMLInputElement>(form, '#wiz-stops');
  const err = qs(form, '.field__error');

  const draw = () => {
    form.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => {
      const on = b.dataset.kind === kind;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
    qs(form, '[data-slot="stops"]').hidden = kind === 'vacio';
    if (!nameTouched) nameInput.value = autoName();
    nameInput.placeholder = kind === 'vacio' ? 'Por ejemplo, el nombre de la máquina o de la estación' : '';
    const last = stopName(stops);
    qs(form, '[data-slot="summary"]').innerHTML =
      kind === 'vacio'
        ? '<p class="muted small">Proyecto sin señales ni reglas: lo defines todo tú.</p>'
        : `<div class="wizard__col">
             <h3>${icon('check', 15)}<span>Se crea solo</span></h3>
             <ul>
               <li><strong>Motor M01</strong> con par (PX21) y los dos inductivos de la cadena: rota (PX22) y longitud (PX23)</li>
               <li><strong>Secuencia del motor</strong>: arranque, fallos de par y cadena, aviso de longitud y reset (7 reglas)</li>
               <li><strong>${stops} ${stops === 1 ? 'tope' : 'topes'}</strong> ${stops === 1 ? 'C01' : `C01–${last}`}, cada uno con sus inductivos de activo (PX2) y reposo (PX1)</li>
               <li>Transportador ${kindLabel(kind)} para la simulación</li>
             </ul>
           </div>
           <div class="wizard__col wizard__col--todo">
             <h3>${icon('plus', 15)}<span>Lo añades tú después</span></h3>
             <ul>
               <li>Inductivos de presencia en cada tope</li>
               <li>Inductivos de paso de paleta y de acumulación máxima</li>
               <li>Las reglas de cada tope</li>
             </ul>
           </div>`;
  };

  const setStops = (n: number) => {
    stops = clampStops(n);
    stopsInput.value = String(stops);
    draw();
  };
  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const k = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as WizardKind | undefined;
    if (k) {
      kind = k;
      draw();
      return;
    }
    const step = t.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (step) setStops(stops + Number(step));
  });
  stopsInput.addEventListener('input', () => {
    const n = Number(stopsInput.value);
    if (stopsInput.value !== '' && Number.isFinite(n)) {
      stops = clampStops(n);
      draw();
    }
  });
  stopsInput.addEventListener('change', () => setStops(Number(stopsInput.value)));
  nameInput.addEventListener('input', () => {
    nameTouched = nameInput.value.trim() !== '';
    err.hidden = true;
    nameInput.removeAttribute('aria-invalid');
  });

  const submit = (): boolean => {
    const name = nameInput.value.trim();
    const problem = !name ? 'Escribe un nombre.' : nameTaken(name) ? 'Ya existe un proyecto con ese nombre.' : null;
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return false;
    }
    const res = createProject(name, kind === 'vacio' ? {} : buildAcu({ kind, stops }));
    if (!res.ok) {
      toast(res.error, 'error');
      return false;
    }
    if (kind !== 'vacio')
      toast(`Creado con el motor y ${stops} ${stops === 1 ? 'tope' : 'topes'}. Añade ahora los inductivos de presencia, paso de paleta y acumulación.`, 'info', 7000);
    app.openProject(res.project.id!);
    return true;
  };

  const m = modal({
    title: 'Nuevo proyecto',
    body: form,
    wide: true,
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      { label: 'Crear proyecto', variant: 'primary', run: submit },
    ],
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit()) m.close();
  });
  // Con dos campos el navegador no envía con Intro: se hace a mano.
  [nameInput, stopsInput].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (el === stopsInput) setStops(Number(stopsInput.value));
      if (submit()) m.close();
    }),
  );
  draw();
  qs<HTMLElement>(form, '[data-kind="aereo"]').focus();
}

export function renderHome(app: App): HTMLElement {
  const page = h(`
    <div class="page page--home">
      <header class="page-head">
        <div>
          <p class="eyebrow">Ingeniería de automatización</p>
          <h1>Proyectos</h1>
          <p class="lede">Define señales y reglas de una máquina, simula su secuencia y genera el código PLC y la documentación.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--ghost" data-act="backup" title="Descargar todos los proyectos en un único archivo">${icon('archive', 16)}<span>Copia de seguridad</span></button>
          <label class="btn btn--ghost" title="Abrir un proyecto (.json) o una copia de seguridad completa">
            ${icon('upload', 16)}<span>Importar</span>
            <input type="file" accept=".json,application/json" hidden data-act="import" />
          </label>
          <button class="btn btn--primary" data-act="new">${icon('plus', 16)}<span>Nuevo proyecto</span></button>
        </div>
      </header>
      <div data-slot="notice"></div>
      <section data-slot="list"></section>
    </div>`);

  const list = qs(page, '[data-slot="list"]');
  /** Texto del buscador de proyectos (se conserva al repintar la lista). */
  let query = '';
  const notice = qs(page, '[data-slot="notice"]');

  const backup = () => {
    void download(`autosequence-copia-${dateStamp()}.json`, exportAllJSON(), 'application/json', 'Copia de seguridad descargada.');
    drawNotice();
  };

  /** Aviso si nunca se ha hecho copia o la última tiene más de 7 días. */
  const drawNotice = () => {
    const count = loadProjects().length;
    const last = lastBackupAt();
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (!count || (days !== null && days < 7)) {
      notice.innerHTML = '';
      return;
    }
    notice.innerHTML = `<div class="callout callout--warn">${icon('alert', 18)}<p>${
      days === null ? 'Aún no has hecho ninguna copia de seguridad.' : `Tu última copia de seguridad es de hace ${days} días.`
    } Los proyectos solo están guardados en este navegador: si se borran sus datos, se pierden. <button class="link" data-act="backup2">Descargar copia ahora</button></p></div>`;
    qs(notice, '[data-act="backup2"]').addEventListener('click', backup);
  };

  const newProject = () => newProjectWizard(app);

  const fromTemplate = (t: Template) => {
    let name = t.projectName;
    let n = 2;
    while (nameTaken(name)) name = `${t.projectName} (${n++})`;
    const res = createProject(name, t.build());
    if (!res.ok) return toast(res.error, 'error');
    toast(`Proyecto «${name}» creado desde la plantilla.`);
    app.openProject(res.project.id!, 'sim');
  };

  const templatesHtml = () => `
    <section class="templates" aria-labelledby="tpl-title">
      <div class="section-head">
        <h2 id="tpl-title">Plantillas</h2>
        <p class="muted small">Proyectos completos, listos para simular, generar código y documentar.</p>
      </div>
      <div class="tpl-grid">
        ${TEMPLATES.map((t) => {
          const s = templateStats(t);
          return `<article class="tpl">
            <h3>${esc(t.name)}</h3>
            <p>${esc(t.description)}</p>
            <dl class="tpl__stats">
              <div><dt>Señales</dt><dd>${s.signals}</dd></div>
              <div><dt>Reglas</dt><dd>${s.rules}</dd></div>
              <div><dt>Bloques</dt><dd>${s.blocks}</dd></div>
            </dl>
            <button class="btn btn--ghost btn--sm" data-template="${t.id}">${icon('plus', 15)}<span>Crear desde plantilla</span></button>
          </article>`;
        }).join('')}
      </div>
    </section>`;

  const bindTemplates = () =>
    list.querySelectorAll<HTMLElement>('[data-template]').forEach((b) =>
      b.addEventListener('click', () => fromTemplate(TEMPLATES.find((t) => t.id === b.dataset.template)!)),
    );

  const draw = () => {
    const projects = loadProjects().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (!projects.length) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty__art" aria-hidden="true">${icon('folder', 34)}</div>
          <h2>Aún no hay proyectos</h2>
          <p>Empieza desde cero o parte de una plantilla de las de abajo.</p>
          <div class="empty__actions">
            <button class="btn btn--primary" data-act="new2">${icon('plus', 16)}<span>Nuevo proyecto vacío</span></button>
          </div>
        </div>
        ${listTrash().length ? `<p class="footnote"><button class="link" data-act="trash">${icon('trash', 14)} Papelera (${listTrash().length})</button></p>` : ''}
        ${templatesHtml()}`;
      qs(list, '[data-act="new2"]').addEventListener('click', newProject);
      list.querySelector('[data-act="trash"]')?.addEventListener('click', () => openTrash(() => { draw(); drawNotice(); }));
      bindTemplates();
      return;
    }

    const trashCount = listTrash().length;
    list.innerHTML = `
      ${
        projects.length > 1
          ? `<div class="filterbar filterbar--home" role="search" aria-label="Buscar proyectos">
               <label class="searchbox">
                 ${icon('search', 16)}
                 <input type="search" class="searchbox__input" data-f="pq" placeholder="Buscar proyecto…" aria-label="Buscar proyectos" title="Buscar proyectos (Ctrl+K)" autocomplete="off" spellcheck="false" value="${esc(query)}" />
                 <button type="button" class="searchbox__clear" data-act="clear-pq" aria-label="Borrar búsqueda" hidden>${icon('x', 14)}</button>
               </label>
               <span class="filterbar__count muted small" data-slot="pcount" aria-live="polite"></span>
             </div>`
          : ''
      }
      <div class="card card--flush"><div class="table-scroll">
        <table class="table table--projects">
          <thead><tr>
            <th>Proyecto</th><th class="num">Señales</th><th class="num">Reglas</th><th class="num">Bloques</th><th>Modificado</th><th class="actions"><span class="sr-only">Acciones</span></th>
          </tr></thead>
          <tbody>
            ${projects
              .map((p) => {
                const rules = p.blocks.reduce((n, b) => n + b.rules.length, 0);
                return `<tr data-id="${esc(p.id)}" class="row-link">
                  <td><button class="link-cell" data-act="open">${icon('folder', 16)}<span>${esc(p.name)}</span></button></td>
                  <td class="num">${p.signals.length}</td>
                  <td class="num">${rules}</td>
                  <td class="num">${p.blocks.length}</td>
                  <td class="muted">${esc(formatRelative(p.updatedAt))}</td>
                  <td class="actions">
                    <button class="icon-btn" data-act="dup" title="Duplicar proyecto" aria-label="Duplicar ${esc(p.name)}">${icon('duplicate', 16)}</button>
                    <button class="icon-btn" data-act="exp" title="Exportar como .json" aria-label="Exportar ${esc(p.name)}">${icon('download', 16)}</button>
                    <button class="icon-btn icon-btn--danger" data-act="del" title="Mover a la papelera" aria-label="Eliminar ${esc(p.name)}">${icon('trash', 16)}</button>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="filter-empty" data-slot="pempty" hidden>
        ${icon('search', 22)}
        <p><strong>Ningún proyecto coincide</strong> con la búsqueda.</p>
      </div></div>
      <p class="footnote">Los proyectos se guardan automáticamente en este navegador, con versiones cada 10 minutos.
        Usa <strong>Copia de seguridad</strong> para guardarlos fuera del navegador o pasarlos a otro equipo.
        ${trashCount ? `<button class="link" data-act="trash">${icon('trash', 14)} Papelera (${trashCount})</button>` : ''}</p>
      ${templatesHtml()}`;

    bindTemplates();
    const pq = list.querySelector<HTMLInputElement>('[data-f="pq"]');
    if (!pq) query = '';
    /** Oculta las filas cuyo nombre no coincide con la búsqueda. */
    const applyQuery = () => {
      let shown = 0;
      list.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
        const ok = matchesQuery([projects.find((x) => x.id === tr.dataset.id)?.name], query);
        tr.hidden = !ok;
        if (ok) shown++;
      });
      const clear = list.querySelector<HTMLElement>('[data-act="clear-pq"]');
      if (clear) clear.hidden = !query;
      const count = list.querySelector('[data-slot="pcount"]');
      if (count) count.textContent = query.trim() ? `Mostrando ${shown} de ${projects.length}` : `${projects.length} proyectos`;
      qs(list, '[data-slot="pempty"]').hidden = shown > 0;
      qs(list, '.table-scroll').hidden = shown === 0;
    };
    pq?.addEventListener('input', () => {
      query = pq.value;
      applyQuery();
    });
    pq?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pq.value) {
        e.preventDefault();
        e.stopPropagation();
        pq.value = query = '';
        applyQuery();
      }
    });
    list.querySelector('[data-act="clear-pq"]')?.addEventListener('click', () => {
      if (pq) pq.value = '';
      query = '';
      applyQuery();
      pq?.focus();
    });
    applyQuery();
    list.querySelector('[data-act="trash"]')?.addEventListener('click', () => openTrash(() => { draw(); drawNotice(); }));
    list.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      const id = tr.dataset.id!;
      const p = projects.find((x) => x.id === id)!;
        tr.addEventListener('click', async (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (act === 'dup') {
          const copy = duplicateProject(id);
          if (copy) toast(`Creado «${copy.name}».`);
          else toast('No se pudo duplicar: el almacenamiento del navegador está lleno.', 'error', 5000);
          draw();
        } else if (act === 'exp') {
          void download(exportFileName(p.name), exportProjectJSON(p), 'application/json', 'Proyecto exportado.');
        } else if (act === 'del') {
          const ok = await confirmDialog(
            'Eliminar proyecto',
            `<strong>${esc(p.name)}</strong> se moverá a la papelera. Podrás recuperarlo durante ${TRASH_DAYS} días.`,
            { confirm: 'Mover a la papelera', danger: true },
          );
          if (!ok) return;
          if (deleteProject(id)) toast('Proyecto movido a la papelera.');
          else
            toast(
              'No se ha eliminado: no cabe en la papelera porque el almacenamiento del navegador está lleno. Exporta una copia y vacía la papelera.',
              'error',
              6000,
            );
          draw();
        } else {
          app.openProject(id);
        }
      });
    });
  };

  qs(page, '[data-act="new"]').addEventListener('click', newProject);
  qs(page, '[data-act="backup"]').addEventListener('click', backup);
  qs<HTMLInputElement>(page, '[data-act="import"]').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text: string;
    let preview: ImportPreview;
    try {
      text = await file.text();
      preview = previewImport(text);
    } catch {
      return toast('No se pudo leer el archivo.', 'error', 5000);
    }
    if (!preview.ok) return toast(preview.error, 'error', 5000);
    if (!(await confirmImport(file.name, preview))) return;
    const res = importFile(text);
    if (!res.ok) return toast(res.error, 'error', 5000);
    const skipped = res.skipped
      ? ` ${res.skipped} no se ${res.skipped === 1 ? 'pudo' : 'pudieron'} importar.`
      : '';
    toast(
      res.imported.length === 1 && !skipped
        ? `Importado «${res.imported[0].name}».`
        : `Copia restaurada: ${res.imported.length} proyecto${res.imported.length === 1 ? '' : 's'} importado${res.imported.length === 1 ? '' : 's'}.${skipped}`,
      skipped ? 'info' : undefined,
      skipped ? 6000 : undefined,
    );
    // Direcciones E/A/M repetidas o no válidas: se han sustituido y se avisa.
    const fixed = res.addressFixes.length;
    if (fixed) {
      const first = res.addressFixes[0];
      toast(
        `${fixed === 1 ? 'Una dirección no era válida o estaba repetida y se ha reasignado' : `${fixed} direcciones no eran válidas o estaban repetidas y se han reasignado`}: ${first.symbol} pasa de «${first.from}» a ${first.to}${fixed > 1 ? ', entre otras' : ''}. Revísalas en Señales.`,
        'warn',
        9000,
      );
    }
    draw();
    drawNotice();
  });

  draw();
  drawNotice();
  return page;
}
