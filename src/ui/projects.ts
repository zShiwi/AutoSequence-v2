/** Selector de proyectos (pantalla inicial). */

import {
  createProject,
  deleteProject,
  loadProjects,
} from '../state/store';
import type { App } from './app';

export function renderProjectSelector(app: App): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.id = 'projectSelector';
  wrapper.innerHTML = `
    <div class="project-box">
      <h2 class="title-centered">Selecciona un Proyecto</h2>
      <ul id="projectsList" class="projects-list"></ul>
      <input id="newProjectName" placeholder="Nuevo proyecto..." class="project-input" />
      <button class="create-project-btn" data-action="create">Crear Proyecto</button>
    </div>
  `;

  const list = wrapper.querySelector<HTMLUListElement>('#projectsList')!;
  const input = wrapper.querySelector<HTMLInputElement>('#newProjectName')!;

  const refresh = (): void => {
    list.replaceChildren();
    loadProjects().forEach((project, index) => {
      const li = document.createElement('li');
      li.style.marginBottom = '12px';

      const openBtn = document.createElement('button');
      openBtn.className = 'project-list-btn';
      openBtn.innerHTML = `<span class="mr-10">📁</span> ${project.name}`;
      openBtn.addEventListener('click', () => app.openProject(index));

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-project-btn';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => {
        if (confirm('¿Seguro que quieres borrar este proyecto?')) {
          deleteProject(index);
          refresh();
        }
      });

      li.append(openBtn, delBtn);
      list.appendChild(li);
    });
  };

  wrapper
    .querySelector('[data-action="create"]')!
    .addEventListener('click', () => {
      const result = createProject(input.value);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      input.value = '';
      refresh();
    });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')
      (wrapper.querySelector('[data-action="create"]') as HTMLButtonElement).click();
  });

  refresh();
  return wrapper;
}
