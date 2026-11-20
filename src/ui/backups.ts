/** Diálogos de seguridad de datos: versiones guardadas y papelera. */

import { listTrash, listVersions, purgeFromTrash, TRASH_DAYS, VERSIONS_MAX } from '../state/backups';
import { formatRelative, restoreFromTrash, restoreVersion, saveNamedVersion, session } from '../state/store';
import { confirmDialog, esc, h, icon, modal, promptDialog, toast } from './dom';
import type { App } from './app';

function when(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function openVersions(app: App): void {
  const p = session.project;
  if (!p?.id) return;
  const body = h('<div class="versions"></div>');

  const draw = () => {
    const list = listVersions(p.id!);
    body.innerHTML = `
      <p class="modal__text">Se guarda una versión automática cada 10 minutos de trabajo (las ${VERSIONS_MAX} más recientes). Restaurar una versión no borra nada: el estado actual se guarda antes y puedes volver con <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p>
      ${
        list.length
          ? `<ol class="versions__list">${list
              .map(
                (v) => `<li>
                  <div class="versions__main">
                    <strong>${esc(when(v.ts))}</strong>
                    <span class="muted small">${esc(formatRelative(v.ts))} · ${esc(v.label)} · ${v.signals} señales · ${v.rules} reglas</span>
                  </div>
                  <button class="btn btn--ghost btn--sm" data-restore="${v.ts}">${icon('reset', 15)}<span>Restaurar</span></button>
                </li>`,
              )
              .join('')}</ol>`
          : `<div class="versions__empty">${icon('history', 26)}<p><strong>Todavía no hay versiones guardadas</strong> de este proyecto. La primera se guardará sola a los 10 minutos de trabajo, o puedes guardar una ahora.</p></div>`
      }`;
  };

  const m = modal({ title: `Versiones de «${p.name}»`, body, wide: true, actions: [{ label: 'Cerrar', variant: 'ghost' }] });
  // «Guardar versión ahora» es la acción principal del diálogo: va en el pie.
  const foot = m.root.querySelector<HTMLElement>('.modal__foot');
  const saveBtn = h(`<button class="btn btn--primary" data-act="save">${icon('plus', 16)}<span>Guardar versión ahora</span></button>`);
  if (foot) {
    foot.classList.add('modal__foot--split');
    foot.prepend(saveBtn);
  } else body.prepend(saveBtn);
  saveBtn.addEventListener('click', async () => {
    const label = await promptDialog('Guardar versión', 'Nombre de la versión', 'Revisión', {
      confirm: 'Guardar',
      hint: 'Por ejemplo: «Antes de cambiar la descarga» o «Enviado al cliente».',
    });
    if (label === null) return;
    saveNamedVersion(label);
    toast('Versión guardada.');
    draw();
  });

  body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const ts = t.closest<HTMLElement>('[data-restore]')?.dataset.restore;
    if (!ts) return;
    const ok = await confirmDialog(
      'Restaurar versión',
      `El proyecto volverá a como estaba el <strong>${esc(when(Number(ts)))}</strong>. El estado actual se guarda como versión y puedes deshacerlo.`,
      { confirm: 'Restaurar' },
    );
    if (!ok) return;
    if (restoreVersion(Number(ts))) {
      m.close();
      app.refresh();
      toast('Versión restaurada. Ctrl+Z para deshacer.');
    }
  });

  draw();
}

export function openTrash(onChange: () => void): void {
  const body = h('<div class="versions"></div>');
  const draw = () => {
    const list = listTrash();
    body.innerHTML = `
      <p class="modal__text">Los proyectos eliminados se guardan aquí ${TRASH_DAYS} días antes de borrarse definitivamente.</p>
      ${
        list.length
          ? `<ol class="versions__list">${list
              .map(
                (e) => `<li>
                  <div class="versions__main">
                    <strong>${esc(e.project.name)}</strong>
                    <span class="muted small">Eliminado ${esc(formatRelative(e.deletedAt))} · ${e.project.signals.length} señales · ${e.project.blocks.reduce((n, b) => n + b.rules.length, 0)} reglas</span>
                  </div>
                  <button class="btn btn--ghost btn--sm" data-restore="${esc(e.project.id)}">${icon('reset', 15)}<span>Recuperar</span></button>
                  <button class="icon-btn icon-btn--danger" data-purge="${esc(e.project.id)}" title="Eliminar definitivamente" aria-label="Eliminar definitivamente ${esc(e.project.name)}">${icon('trash', 16)}</button>
                </li>`,
              )
              .join('')}</ol>`
          : `<div class="versions__empty">${icon('trash', 26)}<p>La papelera está vacía.</p></div>`
      }`;
  };
  modal({ title: 'Papelera', body, wide: true, actions: [{ label: 'Cerrar', variant: 'primary' }] });
  body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const restore = t.closest<HTMLElement>('[data-restore]')?.dataset.restore;
    const purge = t.closest<HTMLElement>('[data-purge]')?.dataset.purge;
    if (restore) {
      const p = restoreFromTrash(restore);
      if (p) toast(`«${p.name}» recuperado.`);
    } else if (purge) {
      const ok = await confirmDialog('Eliminar definitivamente', 'El proyecto y sus versiones se borrarán para siempre.', {
        confirm: 'Eliminar para siempre',
        danger: true,
      });
      if (!ok) return;
      purgeFromTrash(purge);
      toast('Proyecto eliminado definitivamente.');
    } else return;
    draw();
    onChange();
  });
  draw();
}
