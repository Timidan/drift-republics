/// <reference types="vite/client" />
// Drift Republics — the server owns gameplay; Babylon renders the shared world.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateLines, CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/core/Culling/ray";
import { BOAT, HULLS, SHOALS, weatherAt, wrapAngle, isClear, navigationInput, stepBoat, type HullKind, type BoatState, type Obstacle } from "./boat.ts";
import { createWorld, worldObstacles, voyagePosition, shipSpeed, shipNavigation, loadUnits, berthPoint, sailingForces, newSeamanship, activeRaid, FRONTIER_SITES, warehouseUsed, SEA_SITES, PORT_IDS, DEFAULT_LOOK, type Good, type ItemKind, type Look, type PortId } from "./economy.ts";
import { WORLD_RADIUS, LANDMARKS, CITY_STYLE, LANTERN_BUOYS } from "./region.ts";
import { startGameUI, type GameState } from "./game-ui.ts";
import { createSeaEffects, SEA_NOISE } from "./sea-effects.ts";
import { updateArtWeather } from "./art-weather.ts";
import { buildMerchantCutter, buildRepublicHarbor, buildHarborActivity, buildRegionLandmarks, buildSeabird, buildFrontierOutpost, buildWorkshopAnnex } from "./drift-art.ts";

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const statusEl = $<HTMLParagraphElement>("status");
const hintEl = $<HTMLParagraphElement>("hint");
const loadingEl = $<HTMLDivElement>("loading");
const loadingText = $<HTMLParagraphElement>("loading-text");
const loadingBar = $<HTMLProgressElement>("loading-bar");
const loadingError = $<HTMLDivElement>("loading-error");
const helpEl = $<HTMLDetailsElement>("help");
let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
window.addEventListener("drift-settings", () => { reduceMotion = $<HTMLInputElement>("calm-motion").checked; });
if (window.matchMedia("(max-width: 760px)").matches) {
  helpEl.open = false;
  $("game-context").hidden = true;
}

let hintTimer = 0;
function showHint(text: string, ms = 3500): void {
  hintEl.textContent = text;
  hintEl.hidden = false;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (hintEl.hidden = true), ms);
}

function showFatal(title: string, items: string[], advice: string): void {
  loadingEl.hidden = false;
  loadingText.textContent = title;
  loadingBar.hidden = true;
  loadingError.hidden = false;
  loadingError.replaceChildren();
  const ul = document.createElement("ul");
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it;
    ul.append(li);
  }
  const p = document.createElement("p");
  p.textContent = advice;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => location.reload());
  loadingError.append(ul, p, retry);
}

// ---------- Engine & scene ----------
const engine = new Engine(canvas, true, { antialias: true, stencil: false, preserveDrawingBuffer: false }, false);
if (engine.webGLVersion < 2) {
  showFatal("WebGL2 is not available", ["This game needs a browser with WebGL2 graphics support."], "Enable hardware acceleration or try a current Chrome, Firefox, Edge or Safari.");
  throw new Error("WebGL2 required");
}
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new Scene(engine);
scene.defaultCursor = "var(--cursor-game, default)";
scene.hoverCursor = "var(--cursor-action, pointer)";
const HORIZON = new Color3(0.79, 0.8, 0.78);
const ZENITH = new Color3(0.28, 0.46, 0.65);
const FOG_DENSITY = 0.00072;
scene.clearColor = new Color4(HORIZON.r, HORIZON.g, HORIZON.b, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogColor = HORIZON;
scene.fogDensity = FOG_DENSITY;

const SUN_DIR = new Vector3(-0.45, 0.72, 0.35).normalize(); // direction towards the sun
const sun = new DirectionalLight("sun", SUN_DIR.scale(-1), scene);
sun.diffuse = new Color3(1.0, 0.94, 0.82);
sun.intensity = 1.4;
sun.position = SUN_DIR.scale(80);
const sky = new HemisphericLight("sky", Vector3.Up(), scene);
sky.diffuse = new Color3(0.72, 0.84, 0.98);
sky.groundColor = new Color3(0.45, 0.4, 0.34);
sky.intensity = 0.7;

const shadows = new CascadedShadowGenerator(2048, sun);
shadows.numCascades = 3;
shadows.lambda = 0.85;
shadows.shadowMaxZ = 260;
shadows.stabilizeCascades = true;
shadows.usePercentageCloserFiltering = true;
shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
shadows.bias = 0.006;
shadows.normalBias = 0.03;

// ---------- Camera ----------
const CAMERA_HOME = { alpha: -Math.PI / 2 + 0.55, beta: 1.30, radius: 95 };
const camTarget = new TransformNode("camTarget", scene);
const camera = new ArcRotateCamera("camera", CAMERA_HOME.alpha, CAMERA_HOME.beta, CAMERA_HOME.radius, Vector3.Zero(), scene);
camera.setTarget(camTarget);
camera.minZ = 0.3;
camera.maxZ = 6000;
camera.lowerRadiusLimit = 12;
camera.upperRadiusLimit = 1700;
camera.lowerBetaLimit = 0.12;
camera.upperBetaLimit = 1.5;
camera.panningSensibility = 0; // no panning: the camera always follows the boat
camera.wheelDeltaPercentage = 0.02;
camera.pinchDeltaPercentage = 0.02;
camera.inertia = 0.82;
camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput"); // arrows steer the boat
camera.attachControl(canvas, true);

// ---------- Waves (shared by the water shader and the CPU buoyancy sampler) ----------
const WAVES = [
  { dx: 0.8, dz: 0.6, k: 0.35, speed: 1.0, amp: 0.09 },
  { dx: -0.5, dz: 0.9, k: 0.6, speed: 1.4, amp: 0.06 },
  { dx: 0.2, dz: -1.0, k: 0.72, speed: 1.9, amp: 0.04 },
  { dx: -0.9, dz: -0.3, k: 0.85, speed: 2.6, amp: 0.025 },
].map((w) => {
  const l = Math.hypot(w.dx, w.dz);
  return { ...w, dx: w.dx / l, dz: w.dz / l };
});
const motionScale = () => reduceMotion ? 0.3 : 1;
let waveTime = 0;
let seaScale = 1;

function waveHeight(x: number, z: number): number {
  let h = 0;
  for (const w of WAVES) h += w.amp * motionScale() * seaScale * Math.sin((w.dx * x + w.dz * z) * w.k + waveTime * w.speed);
  return h;
}

const waveGlsl = WAVES.map(
  (w) => `addWave(p, time, vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), ${w.k.toFixed(3)}, ${w.speed.toFixed(3)}, ${w.amp.toFixed(4)} * waveScale, h, g);`,
).join("\n    ");

// ---------- Water ----------
const WATER_SIZE = 620;

const waterVertex = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  uniform mat4 world;
  uniform mat4 viewProjection;
  uniform float time;
  uniform float waveScale;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vReflection;
  void addWave(vec2 p, float t, vec2 d, float k, float speed, float amp, inout float h, inout vec2 g) {
    float ph = dot(d, p) * k + t * speed;
    h += amp * sin(ph);
    g += amp * k * cos(ph) * d;
  }
  void main() {
    vec4 wp = world * vec4(position, 1.0);
    vec2 p = wp.xz;
    float h = 0.0;
    vec2 g = vec2(0.0);
    ${waveGlsl}
    wp.y += h;
    vWorld = wp.xyz;
    vNormal = normalize(vec3(-g.x, 1.0, -g.y));
    vReflection = viewProjection * vec4(wp.x, 0., wp.z, 1.);
    gl_Position = viewProjection * wp;
  }
`;

const waterFragment = /* glsl */ `
  precision highp float;
  varying vec3 vWorld; varying vec3 vNormal; varying vec4 vReflection;
  uniform vec3 cameraPosition; uniform vec3 sunDir;
  uniform vec3 deepColor; uniform vec3 shallowColor; uniform vec3 skyColor; uniform vec3 fogColor;
  uniform float fogDensity; uniform float time; uniform float storm; uniform float waveScale;
  uniform vec2 wind; uniform sampler2D reflectionSampler;
  uniform vec4 hulls[8]; uniform vec4 hullSizes[8]; uniform int hullCount;
  ${SEA_NOISE}
  float depth(vec2 p) {
    float d=12.;
    ${SHOALS.map(s=>`d=min(d,${s.depth.toFixed(2)}+max(0.,length(p-vec2(${s.x.toFixed(1)},${s.z.toFixed(1)}))-${s.radius.toFixed(1)})*.045);`).join('')}
    return d;
  }
  float shore(vec2 p) {
    float d=10000.;
    ${LANDMARKS.filter(l=>l.kind!=='gate').map(l=>`d=min(d,length(p-vec2(${l.x.toFixed(1)},${l.z.toFixed(1)}))-${l.radius.toFixed(1)}*.87);`).join('')}
    return d;
  }
  float detail(vec2 p) {
    vec2 flow=wind*time*.65;
    return fbm(p*1.4+flow)*.7+noise(p*6.1-flow*1.7)*.18;
  }
  float rainRing(vec2 p) {
    vec2 cell=floor(p*1.4);vec2 local=fract(p*1.4)-.5;
    float phase=fract(time*2.1+hash(cell));
    float radius=length(local+vec2(hash(cell+2.),hash(cell+7.))*.23);
    return sin((radius-phase*.65)*50.)*exp(-abs(radius-phase*.65)*28.)*(1.-phase);
  }
  void main() {
    vec2 p=vWorld.xz;
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    float fine=1.-smoothstep(.06,.35,footprint);
    float scale=(.032+storm*.035)*waveScale*fine;
    vec2 micro=vec2(0.);
    if(fine>.001) {
      float f=detail(p);
      micro=vec2(detail(p+vec2(.05,0.))-f,detail(p+vec2(0.,.05))-f)/.05;
      if(storm>.01) {
        float ripple=rainRing(p);
        micro+=storm*vec2(rainRing(p+vec2(.025,0.))-ripple,rainRing(p+vec2(0.,.025))-ripple)*.16*fine;
      }
    }
    vec3 N=normalize(vNormal+vec3(-micro.x*scale,0.,-micro.y*scale));
    vec3 V=normalize(cameraPosition-vWorld);
    float shallowness=exp(-depth(p)*.38);
    vec3 color=mix(deepColor,shallowColor,shallowness);
    color*=.75+.25*max(dot(N,sunDir),0.);
    float fres=.035+.75*pow(1.-max(dot(N,V),0.),4.);
    vec2 reflectionUV=vReflection.xy/vReflection.w*.5+.5;
    reflectionUV+=N.xz*.018/(1.+length(cameraPosition-vWorld)*.006);
    vec3 reflected=texture2D(reflectionSampler,clamp(reflectionUV,vec2(.002),vec2(.998))).rgb;
    color=mix(color,reflected,fres);
    vec3 H=normalize(sunDir+V);
    color+=vec3(1.,.91,.7)*pow(max(dot(N,H),0.),220.)*(1.-storm*.8)*.8;
    float sd=shore(p),foam=0.;
    if(abs(sd)<5.) {
      sd-=(fbm(p*.7+time*.15)-.5)*2.3;
      foam=(1.-smoothstep(.15,1.4,abs(sd)))*smoothstep(.3,.7,fbm(p*2.6-time*.25));
    }
    for(int i=0;i<8;i++) {
      if(i>=hullCount)break;
      vec2 rel=p-hulls[i].xy;vec2 forward=hulls[i].zw;
      float along=dot(rel,forward),side=rel.x*forward.y-rel.y*forward.x;
      vec4 size=hullSizes[i];
      float e=length(vec2(side/max(.5,size.x),along/max(2.,size.y*.5)));
      float bow=smoothstep(.88,1.,e)*(1.-smoothstep(1.,1.2,e))*smoothstep(-.2,1.,along/size.y+.5);
      foam+=bow*clamp(size.z/5.,0.,1.)*(.4+.6*noise(p*5.-time));
    }
    color=mix(color,vec3(.8,.92,.91),clamp(foam,0.,.85));
    float dist=length(cameraPosition-vWorld);
    float fog=max(1.-exp(-dist*dist*fogDensity*fogDensity),smoothstep(1600.,2200.,dist));
    gl_FragColor=vec4(mix(color,fogColor,fog),1.);
  }
`;

const waterMat = new ShaderMaterial(
  "water",
  scene,
  { vertexSource: waterVertex, fragmentSource: waterFragment },
  {
    attributes: ["position"],
    uniforms: [
      "world", "viewProjection", "cameraPosition", "time", "waveScale", "sunDir", "deepColor", "shallowColor", "skyColor",
      "fogColor", "fogDensity", "wind", "storm", "hulls", "hullSizes", "hullCount",
    ],
    samplers: ["reflectionSampler"],
  },
);
waterMat.setFloat("waveScale", motionScale());
waterMat.setVector3("sunDir", SUN_DIR);
waterMat.setColor3("deepColor", new Color3(0.045, 0.18, 0.28));
waterMat.setColor3("shallowColor", new Color3(0.19, 0.56, 0.48));
waterMat.setColor3("skyColor", new Color3(0.62, 0.8, 0.9));
waterMat.setColor3("fogColor", HORIZON);
waterMat.setFloat("fogDensity", FOG_DENSITY);
waterMat.setInt('hullCount',0);
waterMat.setArray4('hulls',new Array(32).fill(0));
waterMat.setArray4('hullSizes',new Array(32).fill(0));

const water = CreateGround("water", { width: WATER_SIZE, height: WATER_SIZE, subdivisions: 300 }, scene);
water.material = waterMat;
water.isPickable = false;
water.alwaysSelectAsActiveMesh = true;
// ponytail: one detailed patch follows the ship; add terrain LOD only if this region outgrows it.
const farWater = CreateGround("distant-water", { width: WORLD_RADIUS * 5, height: WORLD_RADIUS * 5, subdivisions: 12 }, scene);
farWater.material = waterMat; farWater.position.y = -.6; farWater.isPickable = false; farWater.alwaysSelectAsActiveMesh = true;

// ---------- Sky dome ----------
const skyMat = new ShaderMaterial(
  "sky",
  scene,
  {
    vertexSource: /* glsl */ `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }
    `,
    fragmentSource: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDir;
      uniform float time;
      uniform float storm;
      uniform vec2 wind;
      ${SEA_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(t, 0.5));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 1.4 + pow(s, 10.0) * 0.16);
        vec2 uv=d.xz/max(.16,d.y+.1)*3.;
        vec2 drift=wind*time*.012;
        float lower=fbm(uv+drift), upper=fbm(uv*.55+drift*.37+31.);
        float clouds=smoothstep(.47-storm*.18,.72-storm*.16,lower+upper*.24)*smoothstep(.01,.17,d.y);
        float silver=pow(max(dot(d,sunDir),0.),8.)*(1.-clouds)*.4;
        vec3 cloudColor=mix(vec3(.92,.9,.84),vec3(.27,.33,.4),storm);
        cloudColor+=silver+(.55-lower)*.26;
        c=mix(c,cloudColor,clouds*(.9+storm*.1));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  },
  { attributes: ["position"], uniforms: ["worldViewProjection", "horizon", "zenith", "sunDir", "time", "storm", "wind"] },
);
skyMat.setColor3("horizon", HORIZON);
skyMat.setColor3("zenith", ZENITH);
skyMat.setVector3("sunDir", SUN_DIR);
skyMat.backFaceCulling = false;
skyMat.disableDepthWrite = true;
const skyDome = CreateSphere("skyDome", { diameter: 10000, segments: 24 }, scene);
skyDome.material = skyMat;
skyDome.infiniteDistance = true;
skyDome.isPickable = false;
skyDome.applyFog = false;
const seaEffects = createSeaEffects(scene, camera, waterMat, skyDome, waveGlsl);

// ---------- Destination marker ----------
const marker = CreateTorus("marker", { diameter: 3.2, thickness: 0.16, tessellation: 40 }, scene);
const markerMat = new StandardMaterial("markerMat", scene);
markerMat.emissiveColor = new Color3(1, 0.72, 0.3);
markerMat.disableLighting = true;
marker.material = markerMat;
marker.isPickable = false;
marker.setEnabled(false);

const gridLines: Vector3[][] = [];
for (let i = -800; i <= 800; i += 100) {
  const edge = Math.sqrt(WORLD_RADIUS ** 2 - i ** 2);
  gridLines.push([new Vector3(i, 0.35, -edge), new Vector3(i, 0.35, edge)]);
  gridLines.push([new Vector3(-edge, 0.35, i), new Vector3(edge, 0.35, i)]);
}
const grid = CreateLineSystem("navigation-grid", { lines: gridLines }, scene);
grid.color = new Color3(0.65, 0.89, 0.92);
grid.alpha = 0.26;
grid.isPickable = false;
grid.setEnabled(false);
let routeLine = CreateLines("sailing-route", { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
routeLine.color = new Color3(1, 0.7, 0.28);
routeLine.isPickable = false;
routeLine.setEnabled(false);

// ---------- World layout ----------
const harbor = new TransformNode("harbor", scene);
harbor.metadata = { portId: "bastion" };
const portNodes: Record<PortId, TransformNode> = {
  bastion: harbor, reedhaven: new TransformNode("reedhaven", scene), ironwake: new TransformNode("ironwake", scene),
};
const initialWorld = createWorld(Date.now());
let gameState: GameState | null = null;
let game: ReturnType<typeof startGameUI>;
let focusPort: PortId | null = null;
let regionView = false;
let receivedAt = 0;
let selectedId = "";

function currentObstacles(): Obstacle[] {
  return worldObstacles(gameState ?? initialWorld);
}

const mapObstacles = document.querySelector<SVGGElement>("#map-obstacles")!;
const mapShapes = currentObstacles().map(() => {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  mapObstacles.append(rect);
  return rect;
});
const mapBoat = document.querySelector<SVGPathElement>("#map-boat")!;
const mapRoute = document.querySelector<SVGPathElement>("#map-route")!;
const mapTarget = document.querySelector<SVGCircleElement>("#map-target")!;
const routeInfo = $<HTMLParagraphElement>("route-info");
const chartSheet = $<HTMLDetailsElement>('chart'), phoneChart = matchMedia('(max-width:760px)');
chartSheet.open = !phoneChart.matches;
phoneChart.addEventListener('change',event=>{chartSheet.open=!event.matches;});
const viewRange = $<HTMLInputElement>("view-range");
const viewRangeValue = $<HTMLOutputElement>("view-range-value");

const spinning: TransformNode[] = [];
const cityArt = new Map<PortId, ReturnType<typeof buildRepublicHarbor>>();
const harborActivity = new Map<PortId, ReturnType<typeof buildHarborActivity>>();
let sailTexture: Texture;
const harborTenders = new Map<PortId, ReturnType<typeof buildMerchantCutter> & { root: TransformNode }>();
const annexes = new Map<PortId, {root:TransformNode;roof:ReturnType<typeof buildWorkshopAnnex>['roof']}>();
const frontierArt = new Map<string, ReturnType<typeof buildFrontierOutpost> & {root:TransformNode;shot:ReturnType<typeof CreateSphere>;map:SVGCircleElement}>();
let lastCannonSound = 0;
const birds: ReturnType<typeof buildSeabird>[] = [];

function buildHarbor(): void {
  for (const id of PORT_IDS) {
    const root = portNodes[id]; root.metadata = { portId: id };
    const port = initialWorld.ports[id]; root.position.set(port.x, 0, port.z);
    const annexRoot = new TransformNode(id+'-workshop-annex',scene), annex = buildWorkshopAnnex(annexRoot);
    annexRoot.parent=root;annexRoot.position.set(43,0,15);annexRoot.setEnabled(false);annexes.set(id,{root:annexRoot,...annex});
    const art = buildRepublicHarbor(root, id, sailTexture); cityArt.set(id,art); spinning.push(...art.rotors);
    harborActivity.set(id, buildHarborActivity(root));
    const berth=berthPoint({x:0,z:0}), mooring=CreateTorus(id+'-berth-ring',{diameter:12,thickness:.16,tessellation:48},scene);
    mooring.parent=root;mooring.position.set(berth.x,.2,berth.z);mooring.material=markerMat;mooring.isPickable=false;
    const arrow=CreateLines(id+'-berth-heading',{points:[new Vector3(0,.25,-3),new Vector3(0,.25,3),new Vector3(-1.5,.25,1.5),new Vector3(0,.25,3),new Vector3(1.5,.25,1.5)]},scene);
    arrow.parent=root;arrow.position.set(berth.x,0,berth.z);arrow.rotation.y=-.55;arrow.color=new Color3(.96,.82,.49);arrow.isPickable=false;
    for (const mesh of root.getChildMeshes()) shadows.addShadowCaster(mesh, false);
    const tenderRoot=new TransformNode(id+'-harbor-pilot',scene), tender=buildMerchantCutter(tenderRoot,sailTexture,'lighter');
    tenderRoot.scaling.setAll(.8);tender.paint({hull:CITY_STYLE[id].dark,sail:'#e1cea7'});tender.rig.setEnabled(false);tender.engine.setEnabled(false);tender.stock(['fish']);
    tender.identify({name:port.name+' pilot',look:{hull:CITY_STYLE[id].dark,sail:'#e1cea7'}},'Harbor pilots',0);tender.buoys.setEnabled(false);
    tenderRoot.getChildMeshes().forEach(m=>m.isPickable=false);harborTenders.set(id,{...tender,root:tenderRoot});
    for(const origin of art.smokeOrigins)seaEffects.chimney(root,origin);
    for(let i=0;i<5;i++)birds.push(buildSeabird(root));
  }
}

function buildIslands(): void {
  for(const site of FRONTIER_SITES){
    const root=new TransformNode(site.id+'-outpost',scene),art=buildFrontierOutpost(root);
    root.position.set(site.x,0,site.z);root.metadata={frontierId:site.id};
    const shot=CreateSphere(site.id+'-cannon-shot',{diameter:.65,segments:6},scene);shot.material=markerMat;shot.isPickable=false;shot.setEnabled(false);
    const mark=document.createElementNS('http://www.w3.org/2000/svg','circle');
    for(const [k,v] of Object.entries({cx:site.x,cy:-site.z,r:19,fill:'#cb614d',stroke:'#ffe3a8','stroke-width':4}))mark.setAttribute(k,String(v));
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=site.name+' · frontier outpost';mark.append(title);mapObstacles.append(mark);
    frontierArt.set(site.id,{root,...art,shot,map:mark});
  }
  const region = new TransformNode('Outer Reaches', scene);
  buildRegionLandmarks(region);
  for (const beacon of LANTERN_BUOYS) {
    const buoy = CreateSphere(beacon.name, { diameter: 2.4, segments: 8 }, scene);
    buoy.position.set(beacon.x, 2.6, beacon.z); buoy.material=markerMat; buoy.isPickable=false;
    const base = CreateTorus(beacon.name+' float', {diameter:4,thickness:.6,tessellation:16},scene);
    base.position.set(beacon.x,.4,beacon.z);base.material=markerMat;base.isPickable=false;
    const mark = document.createElementNS('http://www.w3.org/2000/svg','circle');
    for(const [key,value] of Object.entries({cx:beacon.x,cy:-beacon.z,r:14,fill:'none',stroke:'#ffdc8a','stroke-width':6})) mark.setAttribute(key,String(value));
    mapObstacles.append(mark);
  }
  for (const mesh of region.getChildMeshes()) shadows.addShadowCaster(mesh, false);
  for (const shoal of SHOALS) {
    const ring = CreateTorus('shoal-warning', { diameter: shoal.radius * 2, thickness: 0.18, tessellation: 64 }, scene);
    ring.position.set(shoal.x, 0.02, shoal.z); ring.isPickable = false;
    const mat = new StandardMaterial('shoal-sand', scene); mat.diffuseColor = new Color3(0.85, 0.65, 0.3); ring.material = mat;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [key, value] of Object.entries({ cx: shoal.x, cy: -shoal.z, r: shoal.radius, fill: '#efb55c22', stroke: '#efb55c88', 'stroke-width': 5 })) circle.setAttribute(key, String(value));
    mapObstacles.append(circle);
  }
  for (const site of SEA_SITES) {
    const root = new TransformNode(site.id, scene); root.position.set(site.x, 0, site.z); root.metadata = { siteId: site.id };
    const buoy = CreateSphere('expedition-buoy', { diameter: 0.9, segments: 8 }, scene); buoy.parent = root; buoy.position.y = 0.4;
    const mat = new StandardMaterial(site.id + '-buoy', scene); mat.diffuseColor = new Color3(0.94, 0.62, 0.25); buoy.material = mat;
    const signal = CreateLines('expedition-signal', { points: [new Vector3(0, 0.6, 0), new Vector3(0, 3, 0), new Vector3(1.4, 2.4, 0), new Vector3(0, 2, 0)] }, scene); signal.parent = root;
    signal.color = new Color3(0.97, 0.85, 0.55);
    if (site.id === 'wreck') {
      const ribs = Array.from({ length: 5 }, (_, i) => [new Vector3(-1.7, 0.5, i - 2), new Vector3(-0.5, -0.6, i - 2), new Vector3(1.6, 0.2, i - 2)]);
      const frame = CreateLineSystem('wreck-ribs', { lines: ribs }, scene); frame.parent = root; frame.color = new Color3(0.42, 0.29, 0.17);
    }
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [key, value] of Object.entries({ cx: site.x, cy: -site.z, r: 17, fill: '#efb55c' })) marker.setAttribute(key, String(value));
    mapObstacles.append(marker);
  }
}

// ---------- Shared boats ----------
const boat: BoatState = { ...berthPoint(initialWorld.ports.reedhaven), heading: -0.55, speed: 0 };
type BoatVisual = ReturnType<typeof buildMerchantCutter> & { root: TransformNode; tilt: TransformNode; paintKey: string; identityKey: string; icon: SVGPathElement; dockSlot: number; launchAt: number; lines: ReturnType<typeof CreateLineSystem> };
const boatVisuals = new Map<string, BoatVisual>();

function buildBoat(id: string, kind: HullKind): BoatVisual {
  const root = new TransformNode(id, scene);
  root.metadata = { shipId: id };
  const tilt = new TransformNode(id + "-tilt", scene); tilt.parent = root;
  const art = buildMerchantCutter(tilt, sailTexture, kind);
  for (const mesh of tilt.getChildMeshes()) shadows.addShadowCaster(mesh, false);
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.setAttribute("d", "M0 -22L16 18L0 9L-16 18Z");
  document.querySelector("#map-fleet")!.append(icon);
  const lines = CreateLineSystem(id + '-moorings', { lines: [[Vector3.Zero(), Vector3.Zero()], [Vector3.Zero(), Vector3.Zero()]], updatable: true }, scene);
  lines.color = new Color3(0.61, 0.45, 0.25); lines.isPickable = false;
  return { root, tilt, ...art, lines, paintKey: "", identityKey: "", icon, dockSlot: 0, launchAt: 0 };
}
function paintBoat(id: string, look: Look): void {
  const v = boatVisuals.get(id);
  const key = look.hull + look.sail;
  if (v && v.paintKey !== key) { v.paint(look); v.paintKey = key; }
}
function acceptWorld(next: GameState): void {
  const previous = gameState;
  gameState = next; receivedAt = performance.now();
  if (selectedId !== next.me.selectedShip) {
    selectedId = next.me.selectedShip; Object.assign(boat, next.ships[selectedId]); focusPort = null; regionView = false;
    camTarget.position.set(boat.x, 1.2, boat.z);
  }
  for (const [id, v] of boatVisuals) if (!next.ships[id]) {
    const materials = new Set(v.root.getChildMeshes().map(m => m.material));
    v.root.dispose(); v.lines.dispose(); materials.forEach(m => m?.dispose()); v.icon.remove(); boatVisuals.delete(id);
  }
  const dockSlots: Record<string, number> = {};
  for (const s of Object.values(next.ships).sort((a,b)=>Number(b.id===selectedId)-Number(a.id===selectedId))) {
    if (!boatVisuals.has(s.id)) {
      const visual=buildBoat(s.id, s.sea?.hull ?? "cutter");
      if(previous && !previous.ships[s.id] && next.builds?.some(b=>b.launched===s.id)) visual.launchAt=performance.now();
      boatVisuals.set(s.id,visual);
    }
    const v = boatVisuals.get(s.id)!;
    v.dockSlot = s.port ? (dockSlots[s.port] = (dockSlots[s.port] ?? -1) + 1) : 0;
    paintBoat(s.id, s.id === selectedId ? game?.preview ?? s.look : s.look);
    v.details(s.sea ?? newSeamanship());
    v.damage.setEnabled((s.sea?.integrity ?? 100) < 85); v.tug.setEnabled(!!s.voyage?.tow); v.buoys.setEnabled(!!s.port);
    const completed = next.deliveries.filter(d => d.carrier === s.owner && d.status === 'delivered').length;
    const identityKey = s.name + next.players[s.owner].name + s.look.hull + completed;
    if (identityKey !== v.identityKey) { v.identify(s, next.players[s.owner].name, completed); v.identityKey = identityKey; }
    v.rig.scaling.x = s.modules.cargoModule && next.items[s.modules.cargoModule]?.tier === 2 ? 1.2 : 1;
    v.rig.setEnabled(!!s.modules.cargoModule); v.engine.setEnabled(!!s.modules.engine);
    const goods = new Map<Good | ItemKind,number>(Object.entries(s.cargo).filter(([,n])=>n>0) as [Good,number][]);
    for(const id of s.deliveries){const d=next.deliveries.find(d=>d.id===id);if(d)goods.set(d.good,(goods.get(d.good)??0)+d.quantity);}
    for(const id of s.cargoItems){const item=next.items[id];if(item)goods.set(item.kind,(goods.get(item.kind)??0)+4);}
    const cargoKinds = [...goods.keys()];
    for(const [good,quantity] of goods)for(let i=1;i<Math.ceil(quantity/4)&&cargoKinds.length<7;i++)cargoKinds.push(good);
    v.stock(cargoKinds.slice(0,7));
    v.icon.style.display = s.id === selectedId ? "none" : "";
    v.icon.setAttribute("fill", s.owner === next.me.id ? "#e7b85c" : "#afdfdc");
    v.icon.setAttribute("d",s.owner===next.me.id?"M0 -22L16 18L0 9L-16 18Z":"M0 -19L15 0L0 19L-15 0Z");
    v.icon.setAttribute("aria-label", next.players[s.owner].name + " · " + s.name);
  }
  const s = next.ships[selectedId];
  navTarget = s.voyage?.to ?? s.nav;
  const route = s.voyage?.waypoints ?? (s.nav ? [s, s.nav] : []);
  routeLine.dispose();
  routeLine = CreateLines("sailing-route", { points: route.length > 1 ? route.map(p => new Vector3(p.x, 0.4, p.z)) : [Vector3.Zero(), Vector3.Zero()] }, scene);
  routeLine.color = new Color3(1, 0.7, 0.28); routeLine.isPickable = false; routeLine.setEnabled(!!navTarget);
  marker.setEnabled(!!navTarget);
  mapRoute.setAttribute("d", route.map((p, i) => `${i ? "L" : "M"}${p.x} ${-p.z}`).join(""));
  mapTarget.setAttribute("visibility", navTarget ? "visible" : "hidden");
  if (navTarget) {
    marker.position.set(navTarget.x, 0.2, navTarget.z);
    mapTarget.setAttribute("cx", String(navTarget.x)); mapTarget.setAttribute("cy", String(-navTarget.z));
  }
}

// ---------- Input ----------
const keys = new Set<string>();
let navTarget: { x: number; z: number } | null = null;
let lastInput = "0,0";
let inputSentAt = 0;

const isTypingTarget = (e: Event) => e.target instanceof Element && e.target.closest("button, a, input, textarea, select, summary, [contenteditable]") !== null;
const STEER_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1],
};
window.addEventListener("keydown", (e) => {
  if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "KeyF") { focusPort = null; regionView = false; camera.radius = CAMERA_HOME.radius; }
  if (e.code === "KeyQ" || e.code === "KeyE") camera.alpha += (e.code === "KeyQ" ? -1 : 1) * Math.PI / 4;
  if (e.code === "Escape") {
    keys.clear(); void game?.stop();
    return;
  }
  if (STEER_KEYS[e.code]) {
    keys.add(e.code);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => document.hidden && keys.clear());
document.addEventListener("pointerdown", e => {
  const button = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-helm]') : null;
  if (button?.dataset.helm) { keys.add(button.dataset.helm); e.preventDefault(); }
});
document.addEventListener("pointerup", () => { for (const key of Object.keys(STEER_KEYS)) keys.delete(key); });
document.addEventListener("pointercancel", () => keys.clear());
document.addEventListener('click', e => {
  const button = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-helm]') : null;
  if (e.detail === 0 && button?.dataset.helm) {
    const key = button.dataset.helm; keys.add(key); window.setTimeout(() => keys.delete(key), 300);
  }
});

function manualInput(): { throttle: number; steer: number } | null {
  if (keys.size === 0) return null;
  let throttle = 0;
  let steer = 0;
  for (const k of keys) {
    const v = STEER_KEYS[k];
    throttle += v[0];
    steer += v[1];
  }
  return { throttle: Math.sign(throttle), steer: Math.sign(steer) };
}

function setDestination(x: number, z: number): void {
  if (!isClear(x, z, currentObstacles(), WORLD_RADIUS)) {
    showHint("Choose open water inside the chart, clear of the city platforms.");
    return;
  }
  focusPort = null; regionView = false;
  void game?.navigate(x, z);
}

// Tap (not drag) on open water -> sail there. Drags orbit the camera through Babylon's camera input.
const seaPlane = Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up());
let pressed: { x: number; y: number; t: number; id: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 0) pressed = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
});
canvas.addEventListener("pointerup", (e) => {
  const p = pressed;
  pressed = null;
  if (!p || p.id !== e.pointerId || e.button !== 0) return;
  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.t > 450) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left; // CSS pixels: Babylon applies the hardware scaling itself
  const sy = e.clientY - rect.top;
  const hit = scene.pick(sx, sy, (m) => m.isPickable && m.isEnabled());
  if (hit?.hit) {
    let node = hit.pickedMesh?.parent;
    while (node && !node.metadata?.portId && !node.metadata?.shipId && !node.metadata?.siteId && !node.metadata?.frontierId) node = node.parent;
    if (node?.metadata?.shipId === selectedId && hit.pickedMesh?.metadata?.station) {
      game?.open(hit.pickedMesh.metadata.station === 'cargo' ? 'harbor' : 'deck', gameState?.ships[selectedId].port ?? undefined);
    } else if (node?.metadata?.frontierId) {
      game?.open("frontier");
    } else if (node?.metadata?.siteId) {
      game?.open('deck'); showHint('Anchor within eight metres of the site. Open Aboard and choose Gather at this site.');
    } else if (node?.metadata?.portId) {
      const port = node.metadata.portId as PortId;
      game?.open("harbor", port);
      if (gameState?.ships[selectedId].port !== port) showHint("Use Set sail to reach this harbor, or dock when you are close enough.");
    } else if (node?.metadata?.shipId === selectedId) game?.open("shipyard");
    else showHint("This belongs to another house. Its offers appear in the harbor market.");
    return;
  }
  const ray = scene.createPickingRay(sx, sy, null, camera);
  const dist = ray.intersectsPlane(seaPlane);
  if (dist === null || dist < 0) return;
  const point = ray.origin.add(ray.direction.scale(dist));
  setDestination(point.x, point.z);
});
canvas.addEventListener("pointercancel", () => (pressed = null));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.querySelector<SVGSVGElement>("#minimap")!.addEventListener("click", (e) => {
  const rect = e.currentTarget instanceof SVGSVGElement ? e.currentTarget.getBoundingClientRect() : null;
  if (!rect) return;
  const x = ((e.clientX - rect.left) / rect.width * 2 - 1) * WORLD_RADIUS;
  const z = (1 - (e.clientY - rect.top) / rect.height * 2) * WORLD_RADIUS;
  const port = PORT_IDS.find(id => Math.hypot(x - (gameState ?? initialWorld).ports[id].x, z - (gameState ?? initialWorld).ports[id].z) < 85);
  if (FRONTIER_SITES.some(f=>Math.hypot(x-f.x,z-f.z)<40)) game?.open("frontier");
  else if (port) game?.open("voyage", port); else setDestination(x, z);
  canvas.focus();
});

// ---------- Buttons ----------
// After a pointer click on a HUD button, hand focus back to the canvas so WASD keeps working.
// Keyboard activations (detail === 0) keep their focus for accessibility.
for (const id of ["actions", "route-presets"]) {
  $(id).addEventListener("click", (e) => e.detail > 0 && canvas.focus());
}
$("btn-view").addEventListener("click", () => {
  focusPort = null; regionView = false; camera.alpha = CAMERA_HOME.alpha; camera.beta = CAMERA_HOME.beta; camera.radius = CAMERA_HOME.radius;
});
$("btn-overview").addEventListener("click", () => { regionView = true; focusPort = null; camera.radius = 1550; camera.beta = .32; });
document.addEventListener("click", e => {
  if (e.target instanceof Element && e.target.closest("#btn-inspect")) {
    focusPort = null; regionView = false; camera.radius = 22; camera.beta = 1.12; canvas.focus();
    if (window.matchMedia("(max-width: 760px)").matches) game?.close();
  }
});
viewRange.addEventListener("input", () => { camera.radius = Number(viewRange.value); });
$<HTMLInputElement>("show-grid").addEventListener("change", e => grid.setEnabled((e.target as HTMLInputElement).checked));
$("sail-harbor").addEventListener("click", () => game?.open("voyage", "bastion"));
$("sail-island").addEventListener("click", () => game?.open("voyage", "reedhaven"));
$("sail-ironwake").addEventListener("click", () => game?.open("voyage", "ironwake"));
$("btn-stop").addEventListener("click", () => { keys.clear(); void game?.stop(); });
$("btn-boat").addEventListener("click", () => { focusPort = null; regionView = false; camera.radius = CAMERA_HOME.radius; camera.beta=CAMERA_HOME.beta; });
$("btn-drift").addEventListener("click", () => game?.open("city", "bastion"));
const fullBtn = $<HTMLButtonElement>("btn-full");
if (!document.documentElement.requestFullscreen) fullBtn.hidden = true;
fullBtn.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});

// ---------- Frame update ----------
let visualStorm=0, visualFog=0;
const previewWeather=import.meta.env.DEV ? new URLSearchParams(location.search).get('weather') : null;
let statusAccum = 0;
let sound: { context: AudioContext; effects: GainNode; wind: GainNode; motor: GainNode; tone: OscillatorNode; music: HTMLAudioElement; harbor: StereoPannerNode } | null = null;
let heardWork = '', lastCreak = 0, lastHarborSound = 0, heardPort: PortId | null = null, heardHealth = 100;
function soundPulse(frequency: number, length: number, volume: number, delay = 0, harbor = false): void {
  if (!sound || sound.context.state !== 'running' || document.hidden) return;
  const ctx = sound.context, tone = ctx.createOscillator(), gain = ctx.createGain(), time = ctx.currentTime + delay;
  tone.type = 'triangle'; tone.frequency.setValueAtTime(frequency, time); tone.frequency.exponentialRampToValueAtTime(frequency * 0.55, time + length);
  gain.gain.setValueAtTime(volume, time); gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  tone.connect(gain).connect(harbor ? sound.harbor : sound.effects); tone.start(time); tone.stop(time + length);
  tone.onended = () => { tone.disconnect(); gain.disconnect(); };
}
function audioLevels(): void {
  if (!sound) return;
  sound.effects.gain.setTargetAtTime(document.hidden ? 0 : Number($<HTMLInputElement>('effects-volume').value)/100, sound.context.currentTime, .1);
  sound.music.volume = document.hidden ? 0 : Number($<HTMLInputElement>('music-volume').value)/100 * .55;
}
window.addEventListener('drift-settings', audioLevels);
document.addEventListener('visibilitychange', audioLevels);
window.addEventListener('drift-reward', event => {
  const kind = (event as CustomEvent<string>).detail;
  (kind === 'launch' ? [147,220,294,440] : kind === 'rank' ? [294,370,440,587] : [523,659,784]).forEach((note,i)=>soundPulse(note,.42,.07,i*.13));
});
$("sea-audio").addEventListener('change', async event => {
  const enabled = (event.target as HTMLInputElement).checked;
  try {
    if (enabled && !sound) {
      const context = new AudioContext(), effects = context.createGain(), wind = context.createGain(), motor = context.createGain(), tone = context.createOscillator(), harbor = context.createStereoPanner();
      effects.connect(context.destination); harbor.connect(effects);
      const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource(), filter = context.createBiquadFilter(); source.buffer = noise; source.loop = true;
      filter.type = 'lowpass'; filter.frequency.value = 650; wind.gain.value = 0.012; motor.gain.value = 0;
      source.connect(filter).connect(wind).connect(effects); source.start();
      tone.type = 'triangle'; tone.frequency.value = 35; tone.connect(motor).connect(effects); tone.start();
      const music = new Audio('/assets/drift/lanterns-on-the-tide.ogg'); music.loop = true;
      sound = { context, effects, wind, motor, tone, music, harbor }; audioLevels();
    }
    if (enabled) { await sound?.context.resume(); await sound?.music.play(); soundPulse(240, 0.25, 0.035); }
    else { sound?.music.pause(); await sound?.context.suspend(); }
  } catch {
    $<HTMLInputElement>('sea-audio').checked = false;
    sound?.music.pause(); void sound?.context.suspend();
    showHint('Audio could not start. You can keep playing with sound off.');
  }
});

function update(dt: number): void {
  waveTime += dt * (reduceMotion ? .35 : 1);

  const now = (gameState?.updatedAt ?? Date.now()) + Math.min(1000, performance.now() - receivedAt);
  const weather = weatherAt(now);
  const targetStorm=previewWeather==='storm'?1:previewWeather==='clear'?0:Math.min(1,(weather.sea-1)*1.7);
  visualStorm+=(targetStorm-visualStorm)*(1-Math.exp(-dt*.35));
  visualFog+=((previewWeather==='fog'?1:weather.fog?1:0)-visualFog)*(1-Math.exp(-dt*.25));
  const storm=visualStorm;seaScale=1+storm*.8;
  skyMat.setFloat('time',waveTime);skyMat.setFloat('storm',storm);
  const dusk=.5+.5*Math.sin(now/1_800_000*Math.PI*2);
  const horizon=Color3.Lerp(new Color3(.68,.77,.83),new Color3(.83,.71,.57),dusk*.7);
  skyMat.setColor3('horizon',horizon);scene.fogColor=horizon;waterMat.setColor3('skyColor',horizon);
  sun.diffuse=Color3.Lerp(new Color3(1,.97,.89),new Color3(1,.8,.6),dusk*.5);
  const windVector = {x:Math.sin(weather.heading),y:Math.cos(weather.heading)};
  skyMat.setVector2('wind',windVector);waterMat.setVector2('wind',windVector);
  waterMat.setFloat('storm',reduceMotion?0:storm);
  updateArtWeather(scene,waveTime,reduceMotion?0:weather.strength,weather.heading,storm);
  birds.forEach((bird,i)=>{
    const angle=(reduceMotion?0:waveTime*.11)+i*1.6, radius=48+i%3*13;
    bird.root.position.set(-30+Math.sin(angle)*radius,24+i%4*4,25+Math.cos(angle)*radius);
    bird.root.rotation.y=angle+Math.PI/2;bird.root.rotation.z=reduceMotion?0:-.15-Math.sin(angle*.7)*.12;
    const flap=reduceMotion?0:Math.sin(waveTime*5.5+i)*.5*Math.max(0,Math.sin(waveTime*.35+i));
    bird.wings.forEach((wing,j)=>wing.rotation.z=(j?1:-1)*(.12+flap));
  });
  const selectedSea = gameState?.ships[selectedId]?.sea;
  if (sound && sound.context.state === 'running') {
    const time = sound.context.currentTime;
    sound.wind.gain.setTargetAtTime(document.hidden ? 0 : 0.012 + Math.abs(boat.speed) * 0.002, time, 0.2);
    sound.motor.gain.setTargetAtTime(!document.hidden && selectedSea?.engine && (gameState?.ships[selectedId]?.fuel ?? 0) > 0 && Math.abs(boat.speed) > 0.2 ? 0.025 : 0, time, 0.15);
    sound.tone.frequency.setTargetAtTime(30 + Math.abs(boat.speed) * 7, time, 0.2);
    const workKey = selectedSea?.work ? selectedSea.work.kind + selectedSea.work.start : '';
    if (workKey && workKey !== heardWork) { soundPulse(135, 0.14, 0.06); soundPulse(selectedSea?.work?.kind === 'repair' ? 380 : 190, 0.18, 0.05, 0.2); }
    heardWork = workKey;
    if (Math.abs(boat.speed) > 0.3 && now - lastCreak > 5500) { soundPulse(220, 0.65, 0.012); lastCreak = now; }
    const selected = gameState?.ships[selectedId];
    if(selected?.port && selected.port !== heardPort) { soundPulse(392,.8,.04); soundPulse(523,1,.035,.2); }
    if(selectedSea && selectedSea.integrity < heardHealth - .35) soundPulse(72,.18,.11);
    heardPort=selected?.port??null; heardHealth=selectedSea?.integrity??100;
    const nearest=PORT_IDS.map(id=>({id,port:(gameState??initialWorld).ports[id]})).sort((a,b)=>Math.hypot(a.port.x-boat.x,a.port.z-boat.z)-Math.hypot(b.port.x-boat.x,b.port.z-boat.z))[0];
    const distance=Math.hypot(nearest.port.x-boat.x,nearest.port.z-boat.z), proximity=Math.max(0,1-distance/180);
    sound.harbor.pan.setTargetAtTime(Math.max(-.8,Math.min(.8,((nearest.port.x-boat.x)*Math.cos(boat.heading)-(nearest.port.z-boat.z)*Math.sin(boat.heading))/120)),time,.3);
    if(proximity && now-lastHarborSound> (nearest.id==='ironwake'?2600:6200)) {
      if(nearest.id==='ironwake'){soundPulse(930,.13,.045*proximity,0,true);soundPulse(1470,.18,.018*proximity,.21,true);}
      else if(nearest.id==='bastion'){soundPulse(98,.11,.045*proximity,0,true);soundPulse(196,.17,.035*proximity,.22,true);}
      else {soundPulse(784,1.2,.025*proximity,0,true);soundPulse(1175,.8,.016*proximity,.32,true);}
      lastHarborSound=now;
    }
  }
  const ports = (gameState ?? initialWorld).ports;
  for (const id of PORT_IDS) {
    const port = ports[id], root = portNodes[id];
    const move = port.move;
    const f = move ? Math.max(0, Math.min(1, (now - move.departAt) / (move.arriveAt - move.departAt))) : 0;
    root.position.x = move ? move.from.x + (move.to.x - move.from.x) * f : port.x;
    root.position.z = move ? move.from.z + (move.to.z - move.from.z) * f : port.z;
    root.position.y = waveHeight(root.position.x, root.position.z) * 0.5;
    if(move && f>0 && f<1)seaEffects.track({id:id+'-city',x:root.position.x-35,z:root.position.z+25,heading:Math.atan2(move.to.x-move.from.x,move.to.z-move.from.z),speed:Math.hypot(move.to.x-move.from.x,move.to.z-move.from.z)/((move.arriveAt-move.departAt)/1000),width:35,length:85},waveTime);
    root.rotation.z = reduceMotion ? 0 : Math.sin(waveTime * 0.37) * 0.004;
    const activity = harborActivity.get(id);
    const art = cityArt.get(id);
    const annex=annexes.get(id), project=port.civic?.annex;
    if(annex){annex.root.setEnabled(!!project);annex.roof.setEnabled(!!project?.completedAt);annex.root.scaling.y=project?.completedAt?1:.35+.65*Math.min(1,warehouseUsed(project?.stock??{})/22);}
    art?.districts.forEach((district,i)=>district.setEnabled((port.civic?.consumed??0)>=(i+1)*40));
    if(art)art.glass.emissiveColor=Color3.FromHexString('#eea746').scale(.5+dusk*.4);
    const tender=harborTenders.get(id);
    if(tender){
      // Ambient pilot boats circle each harbor's clear outer water; they do not trade or create stock.
      const angle=(reduceMotion?1.5:waveTime*.05)+PORT_IDS.indexOf(id)*2, radius=155;
      tender.root.position.set(root.position.x-35+Math.sin(angle)*radius,root.position.y,root.position.z+25+Math.cos(angle)*radius);
      tender.root.rotation.y=angle+Math.PI/2;
      seaEffects.track({id:id+'-pilot',x:tender.root.position.x,z:tender.root.position.z,heading:tender.root.rotation.y,speed:reduceMotion?0:7.75,width:1.3,length:6},waveTime);
    }
    if (activity && gameState) {
      activity.stock.forEach((crate, i) => crate.setEnabled(i < Math.ceil((gameState!.warehouseTotals?.[id] ?? 0) / 12)));
      const working = gameState.workshops.some(w => w.port === id && w.job) || gameState.extraction.some(e => e.port === id);
      const loading = Object.values(gameState.ships).some(s => s.port === id && s.sea?.work?.kind === 'load');
      activity.lift.setEnabled(loading); activity.lift.position.y = 3.5 + (reduceMotion?0:Math.sin(now / 700) * 1.7);
      activity.workers.forEach((worker, i) => {
        const t = now / (i<2?6500:11000) + i * Math.PI*.7, walking=(working||loading||i>=2)&&!reduceMotion;
        if(i<2)worker.root.position.set(2+Math.sin(i*2)*.8,1.2,walking?Math.sin(t)*8:3+i*2);
        else worker.root.position.set((i%2?-28:-4),1.2,34+(walking?Math.sin(t)*10:0)+i%2*4);
        worker.root.rotation.y = walking&&Math.cos(t)<0?Math.PI:0;
        worker.legs.forEach((leg,j)=>leg.rotation.x=walking?Math.sin(now/160+j*Math.PI)*.3:0);
        worker.arms.rotation.x=working&&!reduceMotion?Math.sin(now/280)*.25:0;worker.carry.setEnabled(i<2&&(working||loading));
        worker.shoulders.forEach((arm,j)=>arm.rotation.x=walking && !worker.carry.isEnabled()?Math.sin(now/220+j*Math.PI)*.35:worker.carry.isEnabled()?-.55:0);
      });
      const build = gameState.builds?.find(b => b.port === id && b.readyAt && !b.launched && !b.cancelled);
      activity.construction.forEach((rib, i) => rib.setEnabled(!!build && i < Math.ceil((1 - (build.readyAt! - now) / 60000) * 6)));
    }
  }
  for(const [id,art] of frontierArt){
    const post=gameState?.outposts?.find(o=>o.id===id),raid=gameState?.raids?.find(r=>r.target===id&&r.status==='fighting');
    art.root.position.y=waveHeight(art.root.position.x,art.root.position.z)*.4;
    art.deck.setEnabled(!!post);art.walls.forEach((wall,i)=>wall.setEnabled(i<(post?.fortification??0)));
    art.stock.forEach((crate,i)=>crate.setEnabled(i<Math.ceil(warehouseUsed(post?.stock??{})/5)));
    art.map.setAttribute('fill',raid?'#ffe3a8':post?.owner===gameState?.me.id?'#83c8b3':post?'#cb614d':'none');
    art.marker.scaling.setAll(raid&&!reduceMotion?1+Math.sin(now/220)*.06:1);
    art.shot.setEnabled(!!raid&&!reduceMotion);
    if(raid){
      const attacker=gameState!.ships[raid.ship],phase=(now-raid.startAt)%(raid.barrage?1100:1800)/(raid.barrage?1100:1800);
      const reverse=Math.floor((now-raid.startAt)/1800)%3===2;
      const from=reverse?art.root.position:attacker,to=reverse?attacker:art.root.position;
      art.shot.position.set(from.x+(to.x-from.x)*phase,3+Math.sin(phase*Math.PI)*8,from.z+(to.z-from.z)*phase);
      const cannon=boatVisuals.get(raid.ship)?.cannon;if(cannon)cannon.position.z=reduceMotion?0:-Math.max(0,1-phase*5)*.4;
      if(raid.ship===selectedId&&now-lastCannonSound>(raid.barrage?1100:1800)){soundPulse(58,.24,.12);lastCannonSound=now;}
    }
  }
  for (const w of spinning) w.rotation.x += dt * (reduceMotion ? 0 : 0.22);
  const obstacles = currentObstacles();
  const input = manualInput() ?? { throttle: 0, steer: 0 };
  const inputKey = input.throttle + "," + input.steer;
  if (gameState && !activeRaid(gameState, gameState.ships[selectedId]) && (inputKey !== lastInput || (keys.size && performance.now() - inputSentAt > 600))) {
    lastInput = inputKey; inputSentAt = performance.now(); void game.steer(input.throttle, input.steer);
  }
  // Predict only a short display interval. Economic and movement decisions stay on the server.
  for (const ship of Object.values(gameState?.ships ?? {})) {
    const v = boatVisuals.get(ship.id)!;
    const pose: BoatState = { ...ship };
    if (ship.voyage) Object.assign(pose, voyagePosition(ship.voyage, now));
    else if (ship.port) {
      // Cosmetic moorings keep docked boats readable; economic routes still bind to the city's berth.
      pose.x = portNodes[ship.port].position.x + 28 + (v.dockSlot % 4) * 11;
      pose.z = portNodes[ship.port].position.z - 48 - Math.floor(v.dockSlot / 4) * 13;
      if(v.launchAt && !reduceMotion){
        const f=Math.min(1,(performance.now()-v.launchAt)/6500),city=portNodes[ship.port].position;
        if(f<.3){pose.x=city.x-9;pose.z=city.z-35-f/.3*24;}
        else if(f<.8){pose.x=city.x-9+(f-.3)/.5*37;pose.z=city.z-59;}
        else {pose.x=city.x+28;pose.z=city.z-59+(f-.8)/.2*11;}
        if(f===1)v.launchAt=0;
      }
    }
    else if (!activeRaid(gameState!, ship)) {
      let remaining = Math.min(0.35, (performance.now() - receivedAt) / 1000);
      while (remaining > 0) {
        const step = Math.min(0.05, remaining);
        const predicted = { ...ship, ...pose };
        const control = ship.nav ? shipNavigation(gameState!, predicted, now).input : ship.input.until > now ? ship.input : { throttle: 0, steer: 0 };
        stepBoat(pose, control, step, obstacles, WORLD_RADIUS, shipSpeed(gameState!, ship), sailingForces(gameState!, predicted, now)); remaining -= step;
      }
    }
    const smooth = ship.id === selectedId ? 1 - Math.exp(-dt * 18) : 1;
    if (ship.id === selectedId) {
      boat.x += (pose.x - boat.x) * smooth; boat.z += (pose.z - boat.z) * smooth;
      boat.heading += Math.atan2(Math.sin(pose.heading - boat.heading), Math.cos(pose.heading - boat.heading)) * smooth;
      boat.speed = pose.speed; Object.assign(pose, boat);
    }
    seaEffects.track({id:ship.id,x:pose.x,z:pose.z,heading:pose.heading,speed:ship.port?0:pose.speed,width:ship.sea?.hull==='barge'?3:ship.sea?.hull==='lighter'?1.65:2.2,length:ship.sea?.hull==='barge'?12:ship.sea?.hull==='lighter'?7.5:9.8},waveTime);
    const s = Math.sin(pose.heading), c = Math.cos(pose.heading);
    const bow = waveHeight(pose.x + s * 3.5, pose.z + c * 3.5), stern = waveHeight(pose.x - s * 3.5, pose.z - c * 3.5);
    const left = waveHeight(pose.x - c * 1.8, pose.z + s * 1.8), right = waveHeight(pose.x + c * 1.8, pose.z - s * 1.8);
    const sea = ship.sea ?? newSeamanship(), forces = sailingForces(gameState!, ship, now), draft = forces.draft - HULLS[sea.hull].draft;
    v.root.position.set(pose.x, (bow + stern) * 0.5 - draft * 0.65, pose.z); v.root.rotation.y = pose.heading;
    v.tilt.rotation.x = Math.atan2(stern - bow, 7);
    v.tilt.rotation.z = Math.atan2(right - left, 3.6) * 0.8 + sea.balance * Math.min(1, loadUnits(gameState!, ship) / HULLS[sea.hull].hold) * 0.13;
    const windAngle = wrapAngle(weather.heading - pose.heading);
    const sailAngle = (sea.trim < 0 ? Math.max(-0.6, Math.min(0.6, windAngle * 0.3)) : sea.trim / 90 * Math.sign(windAngle) * 0.65) + (reduceMotion ? 0 : Math.sin(waveTime * 3) * 0.015);
    for(const yard of v.yards) yard.rotation.y = sailAngle;
    v.flag.rotation.y = windAngle + (reduceMotion ? 0 : Math.sin(waveTime * 5) * 0.06);
    v.cargo.forEach((crate, i) => {
      crate.position.x = (i % 2 - 0.5) * 0.95 + sea.balance * 0.55;
      crate.position.y = (sea.hull==='lighter'?1.53:1.82) + Math.floor(i / 6) * 0.65 + (!reduceMotion && sea.work?.kind === 'load' && i === 0 ? Math.max(0, Math.sin((now - sea.work.start) / 4000 * Math.PI)) * 1.8 : 0);
    });
    const working = !!sea.work && !reduceMotion;
    v.worker.root.position.z = working ? 0.8 + Math.sin(now / 700) * 0.5 : -1;
    v.worker.arms.rotation.x = working ? Math.sin(now / 140) * 0.6 : -0.2; v.worker.carry.setEnabled(sea.work?.kind === "load" || sea.work?.kind === "salvage");
    v.worker.shoulders.forEach((arm,j)=>arm.rotation.x=v.worker.carry.isEnabled()?-.55:working?Math.sin(now/210+j*1.6)*.3:0);
    v.worker.legs.forEach((leg, j) => leg.rotation.x = working ? Math.sin(now / 160 + j * Math.PI) * 0.3 : 0);
    const moored = !!ship.port || sea.anchor;
    v.lines.setEnabled(moored);
    if (moored) {
      const lines = [-3, 3].map(z => ship.port
        ? [new Vector3(pose.x - c * 1.8 + s * z, 1, pose.z + s * 1.8 + c * z), new Vector3(pose.x - c * 4.5 + s * z, 0.15, pose.z + s * 4.5 + c * z)]
        : [new Vector3(pose.x + s * 4.5, 1.4, pose.z + c * 4.5), new Vector3(pose.x + s * 7, -3, pose.z + c * 7)]);
      CreateLineSystem(ship.id + '-moorings', { instance: v.lines, lines }, scene);
    }
    v.icon.setAttribute("transform", `translate(${pose.x} ${-pose.z}) rotate(${pose.heading * 180 / Math.PI})`);
  }
  const s = Math.sin(boat.heading), c = Math.cos(boat.heading);

  // marker pulse
  if (marker.isEnabled()) {
    marker.position.y = waveHeight(marker.position.x, marker.position.z) + 0.2;
    const pulse = reduceMotion ? 1 : 1 + 0.08 * Math.sin(waveTime * 4);
    marker.scaling.set(pulse, 1, pulse);
  }

  // camera follows the boat smoothly
  const k = 1 - Math.exp(-dt * 4);
  const lookAhead = phoneChart.matches ? 0 : Math.min(16,Math.max(0,(camera.radius-30)*0.25));
  const focus = regionView ? {x:0,z:0} : focusPort ? portNodes[focusPort].position : {x:boat.x+Math.sin(boat.heading)*lookAhead,z:boat.z+Math.cos(boat.heading)*lookAhead};
  camTarget.position.x += (focus.x - camTarget.position.x) * k;
  camTarget.position.z += (focus.z - camTarget.position.z) * k;
  camTarget.position.y += ((focusPort?12:camera.radius<30?4:5) - camTarget.position.y) * k;
  water.position.x=boat.x;water.position.z=boat.z;

  // water shader uniforms
  scene.fogDensity = FOG_DENSITY * (1+visualFog*2.2+storm*.8) * Math.min(1, 600 / camera.radius);
  sun.intensity = 1.35-storm*.55;
  waterMat.setColor3("fogColor",horizon);
  waterMat.setFloat('waveScale', motionScale() * seaScale);
  waterMat.setFloat("fogDensity", scene.fogDensity);
  waterMat.setFloat("time", waveTime);
  seaEffects.update(waveTime,motionScale()*seaScale,storm,weather.heading,reduceMotion,dusk,Object.values(portNodes));

  // status line
  statusAccum += dt;
  if (statusAccum > 0.15) {
    statusAccum = 0;
    const deg = ((Math.round((boat.heading * 180) / Math.PI) % 360) + 360) % 360;
    const selected = gameState?.ships[selectedId];
    const mode = selected && gameState && activeRaid(gameState,selected) ? "cannons engaged" : selected?.voyage ? "crew at the helm" : keys.size ? "manual steering" : navTarget ? "sailing to marker" : selected?.port ? "docked" : "at sea";
    statusEl.textContent = (Math.abs(boat.speed)*1.944).toFixed(1) + " knots · " + mode;
    mapBoat.setAttribute("transform", `translate(${boat.x} ${-boat.z}) rotate(${deg})`);
    for (const id of PORT_IDS) {
      const label = document.querySelector<SVGTextElement>(id === "bastion" ? "#map-harbor-label" : "#map-" + id + "-label")!;
      const at = portNodes[id].position;
      const nearest = PORT_IDS.filter(q=>q!==id).sort((a,b)=>Math.hypot(at.x-portNodes[a].position.x,at.z-portNodes[a].position.z)-Math.hypot(at.x-portNodes[b].position.x,at.z-portNodes[b].position.z))[0];
      label.setAttribute("x", String(at.x)); label.setAttribute("y", String(-at.z + (portNodes[nearest].position.z > at.z ? 200 : -145)));
      const crest=document.querySelector<SVGUseElement>('[data-city="'+id+'"]')!;
      crest.setAttribute('x',String(portNodes[id].position.x-70));crest.setAttribute('y',String(-portNodes[id].position.z-70));
    }
    mapShapes.forEach((rect,i)=>rect.style.display=i<obstacles.length?"":"none");
    obstacles.forEach((o, i) => {
      const rect = mapShapes[i] ?? document.createElementNS("http://www.w3.org/2000/svg", "rect");
      if (!mapShapes[i]) { mapShapes[i] = rect; mapObstacles.append(rect); }
      rect.setAttribute("x", String(o.x - o.hx - o.r));
      rect.setAttribute("y", String(-o.z - o.hz - o.r));
      rect.setAttribute("width", String((o.hx + o.r) * 2));
      rect.setAttribute("height", String((o.hz + o.r) * 2));
      rect.setAttribute("rx", String(o.r));
    });
    routeInfo.textContent = selected?.voyage ? `${Math.max(0, Math.ceil((selected.voyage.arriveAt - now) / 1000))}s to ${selected.voyage.frontier ? FRONTIER_SITES.find(f=>f.id===selected.voyage!.frontier)!.name : ports[selected.voyage.port].name}`
      : navTarget ? `${Math.round(Math.hypot(navTarget.x - boat.x, navTarget.z - boat.z))} m to marker` : "Choose a city to plan a voyage";
    if (document.activeElement !== viewRange) viewRange.value = String(Math.round(camera.radius));
    viewRangeValue.value = `${Math.round(camera.radius)} m`;
  }
}

// ---------- Boot ----------
async function main(): Promise<void> {
  loadingText.textContent = "Loading the boats…";
  loadingBar.value = 15;
  await document.fonts.ready;
  sailTexture = await new Promise<Texture>((resolve, reject) => {
    const texture = new Texture("/assets/drift/cartographer-sail.png", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE,
      () => resolve(texture), (_message, error) => reject(error ?? new Error("The sail image could not load.")));
    texture.anisotropicFilteringLevel = 4;
  });
  loadingBar.value = 55;
  buildHarbor(); buildIslands();
  loadingBar.value = 85;
  game = startGameUI({ state: acceptWorld,
    preview: look => { if (selectedId) paintBoat(selectedId, look ?? gameState?.ships[selectedId].look ?? DEFAULT_LOOK); },
    focusPort: port => { focusPort = port; regionView = false; camera.radius = 145; camera.beta=1.08; },
  });
  camTarget.position.set(boat.x, 1.2, boat.z);

  engine.runRenderLoop(() => {
    update(Math.min(engine.getDeltaTime() / 1000, 0.1));
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
  loadingText.textContent = "Preparing the harbor…";
  await scene.whenReadyAsync(true);
  loadingEl.hidden = true;
}

main().catch((err: unknown) => {
  console.error(err);
  showFatal("The harbor could not load", [err instanceof Error ? err.message : String(err)], "Reload the game. If it still cannot load, check your connection and browser graphics settings.");
});
