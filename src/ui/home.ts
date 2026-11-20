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
} from '../state/store';
import { lastBackupAt, listTrash, TRASH_DAYS } from '../state/backups';
import { openTrash } from './backups';
import { TEMPLATES, templateStats, type Template } from '../data/templates';
import { confirmDialog, download, esc, h, icon, promptDialog, qs, slug, toast } from './dom';
import type { App } from './app';

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
  const notice = qs(page, '[data-slot="notice"]');

  const backup = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    void download(`autosequence-copia-${stamp}.json`, exportAllJSON(), 'application/json', 'Copia de seguridad descargada.');
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

  const newProject = async () => {
    const name = await promptDialog('Nuevo proyecto', 'Nombre del proyecto', '', {
      confirm: 'Crear proyecto',
      hint: 'Por ejemplo, el nombre de la máquina o de la estación.',
      validate: (v) => (!v ? 'Escribe un nombre.' : nameTaken(v) ? 'Ya existe un proyecto con ese nombre.' : null),
    });
    if (name === null) return;
    const res = createProject(name);
    if (!res.ok) return toast(res.error, 'error');
    app.openProject(res.project.id!);
  };

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
                    <button class="icon-btn" data-act="dup" title="Duplicar" aria-label="Duplicar ${esc(p.name)}">${icon('duplicate', 16)}</button>
                    <button class="icon-btn" data-act="exp" title="Exportar JSON" aria-label="Exportar ${esc(p.name)}">${icon('download', 16)}</button>
                    <button class="icon-btn icon-btn--danger" data-act="del" title="Eliminar" aria-label="Eliminar ${esc(p.name)}">${icon('trash', 16)}</button>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div></div>
      <p class="footnote">Los proyectos se guardan automáticamente en este navegador, con versiones cada 10 minutos.
        Usa <strong>Copia de seguridad</strong> para guardarlos fuera del navegador o pasarlos a otro equipo.
        ${trashCount ? `<button class="link" data-act="trash">${icon('trash', 14)} Papelera (${trashCount})</button>` : ''}</p>
      ${templatesHtml()}`;

    bindTemplates();
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
          void download(`${slug(p.name)}.autosequence.json`, exportProjectJSON(p), 'application/json', 'Proyecto exportado.');
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
    let res: ReturnType<typeof importFile>;
    try {
      res = importFile(await file.text());
    } catch {
      res = { ok: false, error: 'No se pudo leer el archivo.' };
    }
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
