import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildRepublicHarbor, buildMerchantCutter, buildFrontierOutpost } from './drift-art';
import { updateArtWeather } from './art-weather';

export async function startTour(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#tour-canvas')!;
  if (!Engine.isSupported()) throw new Error('3D is unavailable. The playbook remains accessible.');
  const engine = new Engine(canvas, true, { powerPreference: 'low-power', preserveDrawingBuffer: true });
  engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#28535eff');
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = .0018; scene.fogColor = Color3.FromHexString('#28535e');
  const camera = new ArcRotateCamera('tour-camera', -.9, .86, 215, new Vector3(0, 3, 0), scene);
  camera.minZ = .5; camera.maxZ = 1400;
  const sky = new HemisphericLight('tour-sky', new Vector3(0, 1, 0), scene); sky.intensity = 1.45; sky.groundColor = Color3.FromHexString('#4c7775');
  const sun = new DirectionalLight('tour-sun', new Vector3(-.4, -1, .6), scene); sun.intensity = 2.8; sun.diffuse = Color3.FromHexString('#ffdeb2');
  const sea = CreateGround('tour-sea', { width: 1800, height: 1800 }, scene);
  const water = new StandardMaterial('tour-water', scene); water.diffuseColor = Color3.FromHexString('#326771'); water.specularColor = Color3.FromHexString('#5c989e'); sea.material = water; sea.position.y = -1.4;
  const lines: Vector3[][] = [];
  for (let row = -18; row < 19; row++) for (let column = -15; column < 16; column++) {
    const x = column * 22 + (row % 2) * 9, z = row * 18;
    lines.push([new Vector3(x, -1.15, z), new Vector3(x + 3, -1.15, z + .9), new Vector3(x + 7, -1.15, z)]);
  }
  const ripples = CreateLineSystem('tour-ripples', { lines }, scene); ripples.color = Color3.FromHexString('#79aba8'); ripples.alpha = .23;
  const cities: { root: TransformNode; art: ReturnType<typeof buildRepublicHarbor> }[] = [];
  for (const place of [
    { id: 'reedhaven' as const, x: -115, z: 0 },
    { id: 'ironwake' as const, x: 100, z: 65 },
    { id: 'bastion' as const, x: 25, z: -125 },
  ]) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const root = new TransformNode('tour-' + place.id, scene);
    const art = buildRepublicHarbor(root, place.id, null); root.position.set(place.x, 0, place.z);
    cities.push({ root, art });
  }
  const boat = new TransformNode('tour-cutter', scene), cutter = buildMerchantCutter(boat, null);
  cutter.stock(['timber', 'timber', 'timber', 'timber']); boat.scaling.setAll(1.6); boat.position.set(-76, 0, -60); boat.rotation.y = 1.3;
  const frontier = new TransformNode('tour-corsair', scene), outpost = buildFrontierOutpost(frontier);
  frontier.position.set(230, 0, -130); outpost.stock.forEach((crate, i) => crate.setEnabled(i < 6));
  const stops = [
    { x: 5, z: -40, radius: 335, alpha: -.9, beta: .83, name: 'The Outer Reaches' },
    { x: -107, z: -13, radius: 160, alpha: -.92, beta: .9, name: 'Reedhaven · Lantern gardens' },
    { x: 99, z: 60, radius: 152, alpha: -.8, beta: .84, name: 'Ironwake · Ember foundries' },
    { x: 19, z: -125, radius: 168, alpha: -.98, beta: .82, name: 'Bastion · Wandering shipyard' },
    { x: 223, z: -130, radius: 83, alpha: -.92, beta: .94, name: 'Corsair’s Rest · Frontier' },
  ];
  const sections = [...document.querySelectorAll<HTMLElement>('[data-stop]')];
  const label = document.querySelector('#tour-location')!;
  let anchors: number[] = [], active = true, dirty = true, last = 0, time = 0;
  let paused = document.body.classList.contains('calm-tour');
  function layout() { engine.resize(); anchors = sections.map(section => section.offsetTop); position(); dirty = true; }
  function position() {
    let index = 0;
    while (index < anchors.length - 2 && window.scrollY > anchors[index + 1]) index++;
    const raw = Math.min(1, Math.max(0, (window.scrollY - anchors[index]) / (anchors[index + 1] - anchors[index])));
    const progress = raw * raw * (3 - 2 * raw), a = stops[index], b = stops[index + 1];
    const mix = (start: number, end: number) => start + (end - start) * progress;
    const mobile = window.innerWidth <= 760 && window.innerHeight > window.innerWidth;
    camera.alpha = mix(a.alpha, b.alpha); camera.beta = mix(a.beta, b.beta);
    camera.radius = mobile ? mix(index === 0 ? 360 : a.radius * 2.5, b.radius * 2.5) : mix(a.radius, b.radius);
    const target = new Vector3(mix(mobile && index === 0 ? 19 : a.x, b.x) - (mobile ? 25 : 0), mobile ? -camera.radius * .25 : 5, mix(mobile && index === 0 ? -125 : a.z, b.z) + (mobile ? 20 : 0));
    // Put the city beside the copy on wide screens, above it on phones.
    if (!mobile) { target.x -= Math.sin(-camera.alpha) * camera.radius * .21; target.z -= Math.cos(-camera.alpha) * camera.radius * .21; }
    camera.target.copyFrom(target);
    label.textContent = stops[Math.min(stops.length - 1, index + Math.round(raw))].name;
  }
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', () => { dirty = true; }, { passive: true });
  window.addEventListener('tour-motion', () => { paused = document.body.classList.contains('calm-tour'); dirty = true; });
  const observer = new IntersectionObserver(([entry]) => { active = entry.isIntersecting; dirty = true; }, { rootMargin: '-100px 0px 0px' }); observer.observe(document.querySelector('#world-tour')!);
  scene.executeWhenReady(() => { dirty = true; });
  engine.runRenderLoop(() => {
    if (document.hidden || !active || (paused && !dirty)) return;
    const now = performance.now(), elapsed = Math.min((now - last) / 1000, .05); last = now;
    if (!paused) time += elapsed;
    if (dirty && !paused) position();
    updateArtWeather(scene, time, paused ? 0 : .7, .8, 0);
    if (!paused) {
      boat.position.y = Math.sin(time * 1.15) * .16; boat.rotation.z = Math.sin(time * .65) * .015;
      cities.forEach(({ root, art }, i) => { root.position.y = Math.sin(time * .6 + i) * .05; art.rotors.forEach(rotor => { rotor.rotation.x = time * .05; }); });
      ripples.position.x = Math.sin(time * .1) * 2;
    }
    scene.render(); dirty = false; document.body.classList.add('world-ready');
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { observer.disconnect(); engine.dispose(); } });
}
