/** Pantalla de proyectos. */

import {
  createProject,
  deleteProject,
  duplicateProject,
  exportProjectJSON,
  formatRelative,
  importProject,
  loadProjects,
  nameTaken,
} from '../state/store';
import { exampleBlocks, exampleCajetin, exampleSignals } from '../data/example';
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
          <label class="btn btn--ghost" title="Abrir un archivo .json exportado desde AutoSequence">
            ${icon('upload', 16)}<span>Importar</span>
            <input type="file" accept=".json,application/json" hidden data-act="import" />
          </label>
          <button class="btn btn--primary" data-act="new">${icon('plus', 16)}<span>Nuevo proyecto</span></button>
        </div>
      </header>
      <section data-slot="list"></section>
    </div>`);

  const list = qs(page, '[data-slot="list"]');

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

  const newExample = () => {
    let name = 'Estación de transferencia (ejemplo)';
    let n = 2;
    while (nameTaken(name)) name = `Estación de transferencia (ejemplo ${n++})`;
    const res = createProject(name, {
      signals: exampleSignals(),
      blocks: exampleBlocks(),
      cajetin: exampleCajetin(),
    });
    if (!res.ok) return toast(res.error, 'error');
    toast('Proyecto de ejemplo creado.');
    app.openProject(res.project.id!, 'sim');
  };

  const draw = () => {
    const projects = loadProjects().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (!projects.length) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty__art" aria-hidden="true">${icon('folder', 34)}</div>
          <h2>Aún no hay proyectos</h2>
          <p>Empieza desde cero o abre un ejemplo completo con una secuencia de dos cilindros, ya simulada y documentada.</p>
          <div class="empty__actions">
            <button class="btn btn--primary" data-act="new2">${icon('plus', 16)}<span>Nuevo proyecto</span></button>
            <button class="btn btn--ghost" data-act="example">${icon('play', 16)}<span>Abrir ejemplo</span></button>
          </div>
        </div>`;
      qs(list, '[data-act="new2"]').addEventListener('click', newProject);
      qs(list, '[data-act="example"]').addEventListener('click', newExample);
      return;
    }

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
      <p class="footnote">Los proyectos se guardan automáticamente en este navegador. Usa <strong>Exportar</strong> para hacer copias o pasarlos a otro equipo.
        <button class="link" data-act="example">Crear el proyecto de ejemplo</button></p>`;

    qs(list, '[data-act="example"]').addEventListener('click', newExample);
    list.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      const id = tr.dataset.id!;
      const p = projects.find((x) => x.id === id)!;
      tr.addEventListener('click', async (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (act === 'dup') {
          const copy = duplicateProject(id);
          if (copy) toast(`Creado «${copy.name}».`);
          draw();
        } else if (act === 'exp') {
          void download(`${slug(p.name)}.autosequence.json`, exportProjectJSON(p), 'application/json', 'Proyecto exportado.');
        } else if (act === 'del') {
          const ok = await confirmDialog(
            'Eliminar proyecto',
            `Se eliminará <strong>${esc(p.name)}</strong> de este navegador. Esta acción no se puede deshacer; si quieres conservarlo, expórtalo antes.`,
            { confirm: 'Eliminar', danger: true },
          );
          if (!ok) return;
          deleteProject(id);
          toast('Proyecto eliminado.');
          draw();
        } else {
          app.openProject(id);
        }
      });
    });
  };

  qs(page, '[data-act="new"]').addEventListener('click', newProject);
  qs<HTMLInputElement>(page, '[data-act="import"]').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const res = importProject(await file.text());
    if (!res.ok) return toast(res.error, 'error', 5000);
    toast(`Importado «${res.project.name}».`);
    draw();
  });

  draw();
  return page;
}
