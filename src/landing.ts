const motion = document.querySelector<HTMLButtonElement>('#tour-motion')!;
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = preference.matches;
const controls = document.querySelector<HTMLElement>('.tour-controls')!;
function updateMotion() {
  document.body.classList.toggle('calm-tour', paused);
  motion.setAttribute('aria-pressed', String(paused));
  motion.textContent = paused ? 'Enable motion' : 'Pause motion';
  window.dispatchEvent(new Event('tour-motion'));
}
motion.addEventListener('click', () => { paused = !paused; updateMotion(); });
preference.addEventListener('change', () => { paused = preference.matches; updateMotion(); });
updateMotion();
new IntersectionObserver(([entry]) => { controls.hidden = !entry.isIntersecting; }, { rootMargin: '-100px 0px 0px' }).observe(document.querySelector('#world-tour')!);
// This visual introduction never creates a session or changes the game world.
import('./landing-world.ts').then(({ startTour }) => startTour()).catch(() => {
  motion.hidden = true;
  document.querySelector('#tour-location')!.textContent = 'Explore the world in the playbook below.';
});
