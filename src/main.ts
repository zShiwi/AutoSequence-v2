/** Punto de entrada de la aplicación. */

import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Falta el contenedor #app');

new App(root).start();
