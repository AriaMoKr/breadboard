import './styles.css';
import { App } from './app/app';

new App(document.getElementById('app')!);

// Built site only: the service worker from scripts/sw-dist.mjs keeps the app working offline and
// makes it installable. Copies without sw.js (a wget mirror) just don't get one.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
