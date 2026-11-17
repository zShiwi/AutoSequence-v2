/** Punto de entrada de la aplicación. */

import './fonts.css';
import './styles.css';
import { App, initTheme } from './ui/app';

initTheme();

const root = document.getElementById('app');
if (!root) throw new Error('Falta el contenedor #app');

new App(root).start();
