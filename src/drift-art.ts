// Original Drift Republics geometry. Boat fittings are separate roots so ownership controls their visibility.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder.js";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import type { Ship, Seamanship, Look, PortId, Good, ItemKind } from "./economy.ts";
import type { HullKind } from "./boat.ts";
import { CITY_STYLE, LANDMARKS, CITY_DISTRICTS } from "./region.ts";

import { WindCloth, weatherSurface } from "./art-weather.ts";

type Point = [number, number, number];
const v = (p: Point) => new Vector3(...p);
function material(root: TransformNode, name: string, color: string, metallic = 0): PBRMaterial {
  const mat = new PBRMaterial(root.name + "-" + name, root.getScene());
  mat.albedoColor = Color3.FromHexString(color).toLinearSpace();
  mat.metallic = metallic; mat.roughness = metallic ? 0.38 : 0.86;
  const kind = /teak|wood/.test(name) ? 'wood' : /plaster/.test(name) ? 'plaster' : /stone/.test(name) ? 'stone' : /iron|copper/.test(name) ? 'metal' : '';
  if (kind && typeof document !== 'undefined') {
    const scene = root.getScene();
    const surface = (map: string) => {
      const file = kind + '-' + map + (map === 'normal' ? '.png' : '.jpg');
      const cached = scene.textures.find(t => t.name === file) as Texture | undefined;
      if (cached) return cached;
      const texture = new Texture('/assets/drift/materials/' + file, scene);
      texture.name = file; texture.anisotropicFilteringLevel = 4;
      texture.gammaSpace = map === 'color'; return texture;
    };
    mat.albedoTexture = surface('color');
    mat.bumpTexture = surface('normal'); mat.bumpTexture.level = .55;
    mat.metallicTexture = surface('arm');
    mat.useRoughnessFromMetallicTextureAlpha = false;
    mat.useRoughnessFromMetallicTextureGreen = true;
    mat.useMetallnessFromMetallicTextureBlue = kind === 'metal';
    mat.useAmbientOcclusionFromMetallicTextureRed = true;
    mat.ambientTextureStrength = .55;
    weatherSurface(mat);
  }
  if (/cloth|sail|flag|banner|kelp|canopy|lantern-leaf/.test(name)) new WindCloth(mat);
  return mat;
}
function attach(mesh: Mesh, root: TransformNode, mat: PBRMaterial, at: Point = [0, 0, 0]): Mesh {
  if (!mesh.isVerticesDataPresent("uv2")) mesh.setVerticesData("uv2", new Float32Array(mesh.getTotalVertices() * 2));
  mesh.parent = root; mesh.material = mat; mesh.position.set(...at);
  return mesh;
}
function box(root: TransformNode, name: string, size: Point, at: Point, mat: PBRMaterial): Mesh {
  const mesh = CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, root.getScene());
  const uv = mesh.getVerticesData('uv')!;
  const faces = [[size[0],size[1]],[size[0],size[1]],[size[2],size[1]],[size[2],size[1]],[size[0],size[2]],[size[0],size[2]]];
  if (mat.bumpTexture) for (let i=0;i<uv.length;i+=2) { const face=faces[Math.floor(i/8)]; uv[i]*=face[0]/6; uv[i+1]*=face[1]/6; }
  mesh.setVerticesData('uv',uv);
  return attach(mesh, root, mat, at);
}
function cylinder(root: TransformNode, name: string, diameter: number, height: number, at: Point, mat: PBRMaterial, top = diameter): Mesh {
  return attach(CreateCylinder(name, { diameterBottom: diameter, diameterTop: top, height, tessellation: 12 }, root.getScene()), root, mat, at);
}
function tube(root: TransformNode, name: string, points: Point[], radius: number, mat: PBRMaterial): Mesh {
  return attach(CreateTube(name, { path: points.map(v), radius, tessellation: 6, cap: Mesh.CAP_ALL }, root.getScene()), root, mat);
}
function beam(root: TransformNode, a: Point, b: Point, radius: number, mat: PBRMaterial): Mesh {
  return tube(root, "spar", [a, b], radius, mat);
}

// Merge each material while the art root is at the origin; then attach it to its moving game entity.
function compact(root: TransformNode): void {
  const groups = new Map<PBRMaterial, Mesh[]>();
  for (const mesh of root.getChildMeshes()) if (mesh instanceof Mesh && mesh.material instanceof PBRMaterial) {
    const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
  }
  for (const [mat, meshes] of groups) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) throw new Error("Could not build " + root.name);
    merged.name = root.name + ":" + mat.name;
    merged.parent = root; merged.receiveShadows = true; merged.isPickable = true;
  }
}

// A flared, hard-chine hull with a rising bow. The deck uses the same stations, so its edges meet the hull.
const HULL_STATIONS: Record<HullKind, number[][]> = {
  cutter: [[-4.4,0.75,.4],[-3.5,1.7,.12],[-2,2.1,0],[0,2.2,0],[2.3,1.9,.12],[4,1.2,.5],[5.4,.06,1.05]],
  lighter: [[-3.5,1.1,.05],[-3,1.55,0],[-1.5,1.65,0],[1,1.5,0],[2.7,1,.15],[4,.05,.48]],
  barge: [[-6,2.2,.1],[-5.2,2.9,0],[-3,3,0],[2,3,0],[4.8,2.8,.1],[6.2,1.8,.45],[6.5,.8,.55]],
};
function hull(root: TransformNode, paint: PBRMaterial, deck: PBRMaterial, trim: PBRMaterial, rail = trim, kind: HullKind = 'cutter'): void {
  const stations=HULL_STATIONS[kind], deckY=kind==='lighter'?1:1.25;
  const rings = stations.map(([z, w, rise]) => [
    new Vector3(-w, deckY + rise, z), new Vector3(-w * 0.86, 0.15 + rise * 0.4, z),
    new Vector3(-w * 0.4, -0.5 + rise * 0.3, z), new Vector3(0, -0.72 + rise * 0.3, z),
    new Vector3(w * 0.4, -0.5 + rise * 0.3, z), new Vector3(w * 0.86, 0.15 + rise * 0.4, z), new Vector3(w, deckY + rise, z),
  ]);
  const shell = attach(CreateRibbon(kind+"-hull", { pathArray: rings, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, root.getScene()), root, paint);
  shell.convertToFlatShadedMesh();
  attach(CreateRibbon("laid-deck", { pathArray: stations.map(([z, w, rise]) => [new Vector3(-w * 0.96, deckY+.04 + rise, z), new Vector3(w * 0.96, deckY+.04 + rise, z)]), sideOrientation: Mesh.DOUBLESIDE }, root.getScene()), root, deck);
  for (const sign of [-1, 1]) {
    tube(root, "brass-gunwale", stations.map(([z, w, rise]) => [sign * w, deckY+.1 + rise, z]), 0.075, trim);
    tube(root, "waterline-inlay", stations.map(([z, w, rise]) => [sign * w * 0.925, 0.69 + rise * 0.7, z]), 0.055, trim);
    tube(root, "sheer-rail", stations.slice(0, -1).map(([z, w, rise]) => [sign * w, deckY+.58 + rise, z]), 0.04, rail);
    for (const [z, w, rise] of stations.slice(0, -1)) beam(root, [sign * w, deckY+.05 + rise, z], [sign * w, deckY+.58 + rise, z], 0.045, rail);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const [z0, w0, r0] = stations[i], [z1, w1, r1] = stations[i + 1];
    for (let j = 0; j < 4; j++) {
      const t = j / 4, z = z0 + (z1 - z0) * t, w = (w0 + (w1 - w0) * t) * 0.95, y = deckY+.06 + r0 + (r1 - r0) * t;
      beam(root, [-w, y, z], [w, y, z], 0.014, paint);
    }
  }
}

function cloth(root: TransformNode, name: string, corners: [Point, Point, Point, Point], mat: PBRMaterial, billow: Point): Mesh {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [], weights: number[] = [];
  const [bl, br, tl, tr] = corners.map(v), n = 10;
  for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
    const u = col / n, t = row / n;
    const p = Vector3.Lerp(Vector3.Lerp(bl, br, u), Vector3.Lerp(tl, tr, u), t);
    p.addInPlace(v(billow).scale(Math.sin(u * Math.PI) * Math.sin(t * Math.PI)));
    positions.push(p.x, p.y, p.z); uvs.push(u, t);
    weights.push(/flag|pennant/.test(name) ? u : Math.sin(u * Math.PI) * Math.sin(t * Math.PI), u + t * .37);
    if (row < n && col < n) { const a = row * (n + 1) + col; indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs; data.uvs2 = weights;
  const mesh = new Mesh(name, root.getScene()); data.applyToMesh(mesh);
  mat.backFaceCulling = false; mat.twoSidedLighting = true;
  return attach(mesh, root, mat);
}

function curvedRoof(root: TransformNode, at: Point, width: number, depth: number, mat: PBRMaterial, trim: PBRMaterial): void {
  const paths: Vector3[][] = [];
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10 - 0.5) * width, y = at[1] + Math.cos((i / 10 - 0.5) * Math.PI) * width * 0.23;
    paths.push([new Vector3(at[0] + x, y, at[2] - depth / 2), new Vector3(at[0] + x, y, at[2] + depth / 2)]);
  }
  attach(CreateRibbon("swept-copper-roof", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, root.getScene()), root, mat);
  for (const z of [-depth / 2, depth / 2]) {
    attach(CreateRibbon("arched-roof-end", { pathArray: [
      paths.map(p => new Vector3(p[0].x, at[1], at[2] + z)),
      paths.map(p => new Vector3(p[0].x, p[0].y, at[2] + z)),
    ], sideOrientation: Mesh.DOUBLESIDE }, root.getScene()), root, mat);
    tube(root, "roof-edging", paths.map(p => [p[0].x, p[0].y + 0.02, at[2] + z]), 0.065, trim);
  }
  for (let i = 1; i < 10; i += 2) beam(root, [paths[i][0].x, paths[i][0].y + 0.02, at[2] - depth / 2], [paths[i][0].x, paths[i][0].y + 0.02, at[2] + depth / 2], 0.027, trim);
}

function freightCase(root: TransformNode, at: Point, wood: PBRMaterial, bands: PBRMaterial, seal: PBRMaterial): void {
  box(root, "freight-case", [0.76, 0.58, 0.88], at, wood);
  for (const x of [-0.25, 0.25]) box(root, "case-strap", [0.055, 0.61, 0.91], [at[0] + x, at[1], at[2]], bands);
  for (const y of [-0.17, 0, 0.17]) box(root, "case-plank", [0.78, 0.025, 0.9], [at[0], at[1] + y, at[2]], bands);
  const stamp = box(root, "maker-seal", [0.2, 0.03, 0.2], [at[0], at[1] + 0.31, at[2]], seal); stamp.rotation.y = Math.PI / 4;
}

function freight(root: TransformNode, kind: Good | ItemKind, wood: PBRMaterial, iron: PBRMaterial, brass: PBRMaterial, color: PBRMaterial): void {
  if(kind==='timber') {
    for(let i=0;i<3;i++)cylinder(root,'timber-log',.25,1.45,[(i-1)*.26,0,0],wood).rotation.x=Math.PI/2;
    for(const z of [-.45,.45])beam(root,[-.4,.15,z],[.4,.15,z],.035,iron);
  }else if(kind==='fuel'){
    cylinder(root,'fuel-cask',.65,.85,[0,0,0],color,.57);
    for(const y of [-.3,.3])cylinder(root,'barrel-hoop',.69,.07,[0,y,0],brass);
    box(root,'fuel-handle',[.25,.07,.1],[0,.5,0],iron);
  }else if(kind==='plates'||kind==='scrap'){
    for(let i=0;i<4;i++){const plate=box(root,kind==='plates'?'rolled-plate':'salvaged-iron',[.85,.09,.67],[0,-.16+i*.12,0],color);plate.rotation.y=kind==='scrap'?i*.6:.05*(i%2);}
    beam(root,[-.4,.29,0],[.4,.29,0],.025,brass);
  }else if(kind==='kelp'){
    for(let i=0;i<5;i++)tube(root,'kelp-frond',[[i*.14-.28,-.2,-.55],[i*.12-.24,.17,0],[i*.16-.32,-.05,.55]],.07,color);
    beam(root,[-.4,.2,0],[.4,.2,0],.035,brass);
  }else if(kind==='fish'){
    box(root,'fish-tray',[.9,.12,.65],[0,-.2,0],wood);
    for(const x of [-.25,0,.25]){
      const fish=attach(CreateSphere('silver-fish',{diameter:1,segments:6},root.getScene()),root,color,[x,0,0]);fish.scaling.set(.17,.2,.65);
      cylinder(root,'fish-tail',.23,.2,[x,0,-.38],color,0).rotation.x=Math.PI/2;
    }
  }else{
    freightCase(root,[0,0,0],kind==='repairKit'?color:wood,iron,brass);
    if(kind==='ammunition')for(const x of [-.25,.25])attach(CreateSphere('round-shot',{diameter:.32,segments:6},root.getScene()),root,color,[x,.5,0]);
    if(kind==='repairKit'){box(root,'repair-kit-cross',[.36,.035,.1],[0,.34,0],brass);box(root,'repair-kit-cross',[.1,.035,.36],[0,.34,0],brass);}
    if(kind==='livery')cylinder(root,'rolled-sailcloth',.27,.8,[0,.5,0],color).rotation.z=Math.PI/2;
    if(kind==='engine')cylinder(root,'boxed-engine',.48,.4,[0,.5,0],brass);
  }
}

export function buildMerchantCutter(parent: TransformNode, texture: Texture | null, kind: HullKind = 'cutter') {
  const scene = parent.getScene(), body = new TransformNode(parent.name + "-" + kind, scene);
  const paint = material(body, "enamel", "#244e73"), timber = material(body, "teak", "#9d6c3c"), dark = material(body, "tarred-rope", "#29383a");
  const brass = material(body, "brass", "#c89c54", 0.65), copper = material(body, "copper", "#a66040", 0.45);
  const canvas = material(body, "sailcloth", "#f4e8cf"); canvas.albedoTexture = texture;
  const window = material(body, "glass", "#69afa8", 0.25); window.emissiveColor = Color3.FromHexString("#30574b").scale(0.18);
  const rail = material(body, "railings", "#c89c54", 0.65);
  hull(body, paint, timber, brass, rail, kind);
  const cabin = new TransformNode(parent.name + "-cabin", scene);
  const cabinRoof = material(body, "cabin-roof", "#a66040", 0.45);
  if (kind !== 'lighter') {
  box(cabin, "stern-cabin", [2.5, 1.35, 1.9], [0, 2.02, -2.8], paint);
  curvedRoof(cabin, [0, 2.73, -2.8], 3.1, 2.35, cabinRoof, brass);
  for (const sign of [-1, 1]) {
    for (const z of [-3.15, -2.45]) {
      cylinder(cabin, "porthole-rim", 0.57, 0.09, [sign * 1.28, 2.09, z], brass).rotation.z = Math.PI / 2;
      cylinder(cabin, "porthole-glass", 0.4, 0.105, [sign * 1.3, 2.09, z], window).rotation.z = Math.PI / 2;
    }
  }
  for (const x of [-0.65, 0.65]) {
    box(cabin, "cabin-window-rim", [0.67, 0.73, 0.08], [x, 2.15, -1.82], brass);
    box(cabin, "cabin-window", [0.51, 0.56, 0.095], [x, 2.15, -1.81], window);
  }
  for (const x of [-0.76, 0, 0.76]) {
    box(cabin, "stern-window-frame", [0.6, 0.72, 0.08], [x, 2.1, -3.78], brass);
    box(cabin, "stern-window", [0.44, 0.55, 0.1], [x, 2.1, -3.8], window);
    box(cabin, "stern-mullion", [0.04, 0.57, 0.12], [x, 2.1, -3.82], brass);
  }
  }
  compact(cabin); cabin.parent = parent; if (kind === 'barge') cabin.position.z = -1.25;
  const sails = new TransformNode(parent.name + "-sails", scene);
  const yards: TransformNode[] = [];
  const mastSites = kind === 'barge' ? [-1.5,4] : [kind === 'lighter' ? -0.7 : 0.65];
  const mastHeight = kind === 'barge' ? 7.6 : kind === 'lighter' ? 7.1 : 9.5;
  for (const z of mastSites) {
    beam(body,[0,1.1,z],[0,mastHeight,z],kind==='barge'?.13:.1,timber);
    cylinder(body,'mast-collar',.43,.25,[0,1.45,z],brass);
    const yard=new TransformNode(parent.name+'-sail-yard-'+z,scene);
    if(kind==='lighter'){
      beam(yard,[-2.3,2.9,0],[2.3,7,0],.07,timber);
      cloth(yard,'lateen-sail',[[-2.2,3,0],[2.5,2.9,0],[-2.18,3.01,0],[2.2,6.9,0]],canvas,[0,0,.6]);
      box(body,'open-cargo-well',[2.3,.16,2.7],[0,1.12,1.25],dark);
      for(const x of [-1.3,1.3])beam(body,[x,1.15,-2.7],[x,1.15,2.4],.09,brass);
    }else if(kind==='barge'){
      beam(yard,[-2.5,7,0],[2.5,7,0],.09,timber);
      beam(yard,[-2.4,3.4,0],[2.4,3.4,0],.07,brass);
      cloth(yard,'broad-working-sail',[[-2.3,3.5,0],[2.3,3.5,0],[-2.4,6.9,0],[2.4,6.9,0]],canvas,[0,0,.55]);
      for(const x of [-2.7,2.7])beam(body,[x,1.4,z],[0,mastHeight-.3,z],.035,dark);
    }else{
      beam(yard,[-2.6,8.3,0],[1.8,9.5,0],.08,brass);
      beam(yard,[-2.65,3.6,0],[2.65,3.55,0],.07,timber);
      cloth(yard,'cartographer-lugsail',[[-2.5,3.72,.03],[2.5,3.68,.03],[-2.48,8.26,.03],[1.68,9.37,.03]],canvas,[0,0,.95]);
      beam(body,[0,1.8,4.6],[0,2.35,6.7],.09,brass);
      beam(body,[0,2.35,6.7],[0,9.2,.65],.028,dark);
      const jib=new TransformNode(parent.name+'-jib',scene);
      cloth(jib,'foresail',[[.04,2.55,6.05],[.04,2.65,1.65],[.08,8.65,.87],[.08,8.7,.84]],canvas,[.7,0,0]);
      compact(jib);jib.parent=sails;
      for(const sign of [-1,1])beam(body,[sign*1.9,1.6,-1],[0,9.15,.65],.025,dark);
    }
    compact(yard);yard.position.z=z;yard.parent=sails;yards.push(yard);
  }
  if(kind==='barge'){
    for(const z of [-2.5,2.5])for(const x of [-2.2,2.2])cylinder(body,'freight-bollard',.32,.55,[x,1.55,z],brass);
    box(body,'recessed-working-hold',[4.1,.12,4.1],[0,1.32,.5],dark);
    for(const x of [-2.2,2.2])box(body,'hold-coaming',[.15,.32,4.4],[x,1.5,.5],timber);
  }
  const flag = new TransformNode(parent.name + "-flag", scene);
  const flagCloth = material(body, "house-flag", "#f4e8cf");
  const pennant = cloth(flag, "house-pennant", [[0,0,0],[1.8,.25,.1],[0,.65,0],[1.75,.26,.1]], flagCloth, [0,0,.2]);
  const squareFlag = cloth(flag, "square-house-flag", [[0,0,0],[1.3,0,0],[0,.65,0],[1.3,.65,0]], flagCloth, [0,0,.2]);
  squareFlag.setEnabled(false);
  compact(body); body.parent = parent;
  sails.parent = parent; flag.parent = parent; flag.position.set(0,mastHeight-.4,mastSites[0]);

  const rig = new TransformNode(parent.name + "-outrigger-rig", scene);
  for (const sign of [-1, 1]) {
    const x = sign * 2.8;
    cylinder(rig, "sealed-float", 0.72, 3.6, [x, 0.22, -0.15], paint, 0.5).rotation.x = Math.PI / 2;
    box(rig, "cargo-wing", [1.15, 0.13, 3.5], [x, 1.35, -0.2], timber);
    for (const z of [-1.6, 1.15]) {
      beam(rig, [sign * 1.65, 0.8, z], [sign * 3.3, 1.32, z], 0.085, brass);
      beam(rig, [sign * 3.32, 1.32, z], [sign * 3.32, 2.05, z], 0.055, brass);
    }
    beam(rig, [sign * 3.32, 2.05, -1.6], [sign * 3.32, 2.05, 1.15], 0.035, dark);
    for (let i = 0; i < 6; i++) {
      const z = -1.5 + i * 0.48;
      beam(rig, [sign * 3.32, 1.4, z], [sign * 3.32, 2.03, z + 0.38], 0.015, dark);
      beam(rig, [sign * 3.32, 2.03, z], [sign * 3.32, 1.4, z + 0.38], 0.015, dark);
    }
  }
  cylinder(rig, "cargo-winch", 0.48, 0.9, [0, 1.9, -0.85], brass).rotation.z = Math.PI / 2;
  compact(rig); rig.parent = parent;

  const cannon = new TransformNode(parent.name + '-deck-cannon', scene);
  box(cannon, 'gun-carriage', [.75,.25,1], [0,1.6,3], timber);
  cylinder(cannon, 'iron-barrel', .42, 1.7, [0,1.97,3.3], dark).rotation.x = Math.PI/2;
  compact(cannon); cannon.parent = parent; cannon.setEnabled(false);
  const motor = new TransformNode(parent.name + "-tide-engine", scene);
  cylinder(motor, "copper-boiler", 1.15, 1.35, [0, 2.04, -3.95], copper, 0.94);
  for (const y of [1.5, 2.45]) cylinder(motor, "boiler-band", 1.2, 0.12, [0, y, -3.95], brass);
  tube(motor, "exhaust", [[0, 2.7, -3.95], [0, 3.4, -3.95], [0, 3.55, -4.15]], 0.17, dark);
  tube(motor, "return-pipe", [[-0.55, 2.25, -3.95], [-0.8, 2.25, -3.95], [-0.8, 1.25, -3.95], [0, 1.25, -4.4]], 0.075, brass);
  cylinder(motor, "pressure-gauge", 0.36, 0.1, [0, 2.15, -4.54], canvas).rotation.x = Math.PI / 2;
  beam(motor, [0, 1.3, -4.2], [0, -0.2, -4.8], 0.1, dark);
  for (let i = 0; i < 3; i++) {
    const fin = box(motor, "propeller", [0.22, 1, 0.09], [0, -0.12, -4.82], brass); fin.rotation.z = i * Math.PI / 3;
  }
  compact(motor); motor.parent = parent; motor.position.z = kind==='lighter' ? 1 : kind==='barge' ? -1.7 : 0;
  const freightColors = Object.fromEntries(Object.entries({kelp:'#4b9b68',timber:'#aa7944',scrap:'#776f64',fuel:'#70855b',plates:'#76919b',repairKit:'#a9553e',fish:'#9ac5c8',ammunition:'#414c50',engine:'#c38e48',cargoModule:'#718f94',livery:'#d9c69d'}).map(([k,c])=>[k,material(body,'freight-'+k,c)]));
  const cargo = Array.from({ length: 7 }, (_, i) => {
    const root = new TransformNode(parent.name + "-freight-" + i, scene);
    root.position.set((i % 2 - 0.5) * 0.95, (kind==='lighter'?1.53:1.82) + Math.floor(i / 6) * 0.65, (kind==='lighter'?.2:kind==='barge'?-.5:1.5) + Math.floor(i % 6 / 2) * .95); root.parent = parent; return root;
  });
  let cargoKey='';
  const stations = new TransformNode(parent.name + "-deck-stations", scene);
  const station = (name: string, at: Point, mat: PBRMaterial) => {
    const mesh = cylinder(stations, name, 0.44, 0.5, at, mat); mesh.metadata = { station: name }; return mesh;
  };
  station("helm", [0, kind==='lighter'?1.4:1.8, kind==='barge'?-3.1:-1.3], brass);
  station("cargo", [1.1, 1.7, 1.8], timber);
  station("repair", [-1.1, 1.7, -0.3], copper);
  station("anchor", [0, kind==='lighter'?1.5:2.1, kind==='lighter'?3.3:kind==='barge'?5.6:4.4], dark);
  stations.parent = parent;
  const lamps = new TransformNode(parent.name + "-lamps", scene);
  for (const x of [-1.6, 1.6]) {
    beam(lamps, [x, 1.5, -2], [x, 2.7, -2], 0.05, brass);
    cylinder(lamps, "warm-lantern", 0.28, 0.45, [x, 2.5, -2], window);
  }
  compact(lamps); lamps.parent = parent;
  const figureheads = ['gull', 'sun'].map(figurehead => {
    const root = new TransformNode(parent.name + '-' + figurehead, scene);
    cylinder(root, figurehead, 0.5, 0.16, [0, 2.25, 5.1], brass).rotation.x = Math.PI / 2;
    if (figurehead === 'gull') for (const sign of [-1, 1]) beam(root, [0, 2.3, 5.1], [sign * 0.75, 2.6, 5.1], 0.08, brass);
    else for (let i = 0; i < 8; i++) beam(root, [0, 2.25, 5.1], [Math.sin(i * Math.PI / 4) * 0.48, 2.25 + Math.cos(i * Math.PI / 4) * 0.48, 5.1], 0.04, brass);
    compact(root); root.parent = parent; root.position.z=kind==='lighter'?-1.4:kind==='barge'?1.1:0; root.setEnabled(false); return root;
  });
  const trophy = new TransformNode(parent.name + '-trophy', scene);
  cylinder(trophy, 'merchant-cup', 0.3, 0.45, [0.7, 2.9, -2.5], brass, 0.5); compact(trophy); trophy.parent = parent; trophy.setEnabled(false);
  const worker = buildDockworker(parent, '#e9c88c');
  worker.root.position.set(0.9, kind==='lighter'?1.08:1.4, -0.5);
  const damage = new TransformNode(parent.name + '-hull-damage', scene);
  for (const sign of [-1, 1]) {
    const x=sign*(kind==='barge'?2.85:kind==='lighter'?1.53:2.04);
    cylinder(damage, 'hull-breach', 0.6, 0.025, [x, 0.7, 0], dark).rotation.z = Math.PI / 2;
    tube(damage, 'split-plank', [[x,.65,-.8],[x,.9,0],[x,.62,.6]], 0.04, dark);
  }
  compact(damage); damage.parent = parent; damage.setEnabled(false);
  const buoys = new TransformNode(parent.name + '-mooring-buoys', scene);
  for (const z of [-3, 3]) cylinder(buoys, 'berth-buoy', 0.65, 0.3, [-4.5, 0.15, z], brass, 0.3);
  compact(buoys); buoys.parent = parent;
  const tug = new TransformNode(parent.name + '-harbor-tug', scene);
  hull(tug, paint, timber, brass);
  box(tug, 'tug-wheelhouse', [2.4, 1.6, 2.5], [0, 2.1, -0.7], copper);
  cylinder(tug, 'tug-funnel', 0.7, 1.4, [0, 3.3, -1.5], dark);
  compact(tug); tug.parent = parent; tug.scaling.setAll(0.45); tug.position.z = 10; tug.setEnabled(false);
  const towline = beam(tug, [0, 1.2, -4.4], [0, 1.2, -11], 0.06, dark);
  towline.isPickable = false;
  let plate: DynamicTexture | null = null, stripes: DynamicTexture | null = null, crest: DynamicTexture | null = null;
  if (typeof document !== 'undefined') {
    stripes = new DynamicTexture(parent.name + '-striped-cloth', { width: 256, height: 256 }, scene, false);
    const stripeContext = stripes.getContext(); stripeContext.fillStyle = '#f4e8cf'; stripeContext.fillRect(0, 0, 256, 256);
    stripeContext.fillStyle = '#567b88'; for (let x = 0; x < 256; x += 64) stripeContext.fillRect(x, 0, 24, 256); stripes.update();
    crest = new DynamicTexture(parent.name + '-house-crest', { width: 256, height: 256 }, scene, false); flagCloth.albedoTexture = crest;
    plate = new DynamicTexture(parent.name + '-nameplate', { width: 512, height: 128 }, scene, false);
    const mat = material(parent, 'nameplate', '#ffffff'); mat.albedoTexture = plate;
    mat.emissiveTexture = plate; mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
    const mesh = attach(CreatePlane('ship-name', { width: 2.1, height: 0.53, sideOrientation: Mesh.DOUBLESIDE }, scene), parent, mat, [0, 1.32, -4.43]);
    mesh.rotation.y = Math.PI;
  }
  return { kind, rig, cannon, engine: motor, cargo, sails, yards, flag, cabin, worker, stations, lamps, figureheads, trophy, damage, tug, buoys,
    stock: (goods: (Good | ItemKind)[]) => {
      const key=goods.join(',');if(key===cargoKey)return;cargoKey=key;
      cargo.forEach((slot,i)=>{
        for(const child of slot.getChildren())child.dispose();
        const good=goods[i];slot.setEnabled(!!good);
        if(good){const model=new TransformNode(slot.name+'-goods',scene);freight(model,good,timber,dark,brass,freightColors[good]);compact(model);model.parent=slot;}
      });
    },
    paint: (look: Look) => { paint.albedoColor = Color3.FromHexString(look.hull).toLinearSpace(); canvas.albedoColor = Color3.FromHexString(look.sail).toLinearSpace(); },
    identify: (ship: Pick<Ship, 'name' | 'look'>, house: string, completed: number) => {
      trophy.setEnabled(completed > 0);
      if (crest) {
        const ctx = crest.getContext() as CanvasRenderingContext2D;
        ctx.fillStyle = ship.look.hull; ctx.fillRect(0, 0, 256, 256); ctx.strokeStyle = '#c89c54'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.arc(128, 128, 96, 0, Math.PI * 2); ctx.stroke();
        ctx.font = 'bold 74px serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#f4e8cf';
        ctx.fillText(house.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(), 128, 153); crest.update();
      }
      if (plate) {
        const ctx = plate.getContext() as CanvasRenderingContext2D; ctx.fillStyle = '#162f38'; ctx.fillRect(0, 0, 512, 128);
        ctx.strokeStyle = '#c89c54'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
        ctx.fillStyle = '#f4e8cf'; ctx.font = 'bold 27px serif'; ctx.textAlign = 'center'; ctx.fillText(ship.name, 256, 56, 480);
        ctx.font = '20px serif'; ctx.fillText(house.slice(0, 26), 256, 93, 460); plate.update();
      }
    },
    details: (sea: Seamanship) => {
      cannon.setEnabled(sea.gear.includes("cannon"));
      cabin.setEnabled(sea.hull !== 'lighter'); cabin.scaling.y = sea.finish.cabin === 'flat' ? 0.7 : 1;
      cabinRoof.albedoColor = Color3.FromHexString(sea.finish.cabin === 'canvas' ? '#d9cca8' : '#a66040').toLinearSpace();
      rail.albedoColor = Color3.FromHexString(sea.finish.railing === 'rope' ? '#69533c' : '#c89c54').toLinearSpace(); rail.metallic = sea.finish.railing === 'rope' ? 0 : 0.65;
      paint.metallic = sea.finish.material === 'copper' ? 0.72 : 0; paint.roughness = sea.finish.material === 'timber' ? 1 : 0.65;
      canvas.albedoTexture = sea.finish.pattern === 'crest' ? texture : sea.finish.pattern === 'striped' ? stripes : null;
      flag.setEnabled(sea.finish.flag !== 'none'); pennant.setEnabled(sea.finish.flag === 'swallowtail'); squareFlag.setEnabled(sea.finish.flag === 'square');
      lamps.setEnabled(sea.finish.lamps); figureheads.forEach((f, i) => f.setEnabled(sea.finish.figurehead === ['gull', 'sun'][i]));
      for(const yard of sails.getChildTransformNodes(true)){yard.scaling.y=Math.max(.06,sea.reef);yard.position.y=(1-yard.scaling.y)*3.4;}
    },
  };
}

function leaf(root: TransformNode, at: Point, length: number, width: number, heading: number, mat: PBRMaterial, vein: PBRMaterial): void {
  const frond=new TransformNode(root.name+'-frond',root.getScene()), paths:Vector3[][]=[], spine:Point[]=[];
  for(let i=0;i<=12;i++){
    const t=i/12, w=Math.sin(Math.PI*t)*width*.5, y=Math.sin(t*Math.PI)*length*.2+t*length*.12;
    paths.push([new Vector3(-w,y,t*length),new Vector3(0,y+.28,t*length),new Vector3(w,y,t*length)]);spine.push([0,y+.3,t*length]);
  }
  const blade = CreateRibbon('swept-kelp-leaf',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},root.getScene());
  const positions = blade.getVerticesData('position')!, weights: number[] = [];
  for (let i=0;i<positions.length;i+=3) weights.push(positions[i+2]/length, heading + positions[i+2]*.06);
  blade.setVerticesData('uv2',weights); attach(blade,frond,mat);
  tube(frond,'leaf-vein',spine,.065,vein);frond.position.set(...at);frond.rotation.y=heading;frond.parent=root;
}
function lamp(root: TransformNode, at: Point, iron: PBRMaterial, glass: PBRMaterial, height=3.8): void {
  beam(root,at,[at[0],at[1]+height,at[2]],.09,iron);
  const y=at[1]+height;
  cylinder(root,'lantern-base',.75,.15,[at[0],y-.65,at[2]],iron);
  cylinder(root,'lantern-glass',.52,.75,[at[0],y-.2,at[2]],glass,.43);
  cylinder(root,'lantern-cap',.92,.45,[at[0],y+.35,at[2]],iron,.07);
}
export function buildRepublicHarbor(parent: TransformNode, id: PortId, texture: Texture | null) {
  const scene=parent.getScene(), root=new TransformNode(id+'-republic-architecture',scene), style=CITY_STYLE[id];
  const paint=material(root,'enamel',style.dark), wood=material(root,'teak','#b69461'), dark=material(root,'iron','#283642',.25);
  const brass=material(root,'brass','#d4ad65',.55), roof=material(root,'oxidised-copper',id==='ironwake'?'#b96140':id==='reedhaven'?'#459d7c':'#686a9c',.25);
  const wall=material(root,'plaster',id==='ironwake'?'#d6b099':'#e9dcc0'), glass=material(root,'amber-windows','#f0bf62');
  glass.emissiveColor=Color3.FromHexString('#eea746').scale(.7);
  const greenery=material(root,'living-kelp','#418264'), luminous=material(root,'lantern-leaf','#72bea0');
  luminous.emissiveColor=Color3.FromHexString('#72d8b1').scale(.22);
  const sail=material(root,'guild-banner','#e7dbc0');sail.albedoTexture=texture;
  const columns=id==='bastion'?7:6;
  for(let c=0;c<columns;c++)for(let r=0;r<6;r++){
    if((c===0||c===columns-1)&&(r===0||r===5))continue;
    const x=(c-(columns-1)/2)*8-3,z=(r-2.5)*8+5;
    box(root,'city-pontoon',[7.8,2.8,7.8],[x,-.6,z],paint);
    box(root,'pontoon-collar',[8,.2,8],[x,.66,z],brass);
    box(root,'public-boardwalk',[7.9,.3,7.9],[x,.98,z],wood);
    for(const side of [-1,1])for(const offset of [-2,2])cylinder(root,'pontoon-rivet',.2,.12,[x+side*3.55,1.18,z+offset],brass);
  }
  // The long pier reaches the shared berth, leaving a clear approach on its east side.
  box(root,'longshore-pier',[5,1.2,36],[18,.3,-36],paint);
  box(root,'pier-planks',[5.4,.25,36.2],[18,1.03,-36],wood);
  for(let z=-51;z<=-19;z+=8){
    cylinder(root,'mooring-bollard',.65,.7,[20,1.5,z],brass);
    cylinder(root,'pier-pile',.9,4,[16,-.6,z],dark);
  }
  const building=(target:TransformNode,at:Point,width:number,depth:number,floors:number)=>{
    const height=floors*2.7;
    box(target,'guildhouse',[width,height,depth],[at[0],at[1]+height/2,at[2]],wall);
    box(target,'stone-footing',[width+.4,.65,depth+.4],[at[0],at[1]+.25,at[2]],paint);
    for(const x of [-width/2,width/2])for(const z of [-depth/2,depth/2])box(target,'timber-frame',[.21,height+.12,.21],[at[0]+x,at[1]+height/2,at[2]+z],paint);
    for(let f=0;f<floors;f++){
      box(target,'floor-beam',[width+.25,.2,depth+.25],[at[0],at[1]+f*2.7+.65,at[2]],wood);
      for(const side of [-1,1])for(let i=0;i<Math.floor(width/1.8);i++){
        const x=at[0]+(i-(Math.floor(width/1.8)-1)/2)*1.65,y=at[1]+1.8+f*2.7,z=at[2]+side*(depth/2+.09);
        box(target,'window-frame',[.9,1.35,.13],[x,y,z],paint);box(target,'window-light',[.65,1.05,.16],[x,y,z+side*.03],glass);
        box(target,'window-mullion',[.065,1.12,.2],[x,y,z+side*.08],brass);
        box(target,'window-sill',[1.04,.16,.3],[x,y-.65,z],wood);
      }
    }
    box(target,'front-door',[1.1,2.1,.16],[at[0],at[1]+1.08,at[2]-depth/2-.1],dark);
    if(id==='ironwake'){
      for(const dx of [-width/4,width/4])curvedRoof(target,[at[0]+dx,at[1]+height+.1,at[2]],width/2+.4,depth+.5,roof,dark);
      box(target,'kiln-chimney',[.65,2.5,.65],[at[0]+width*.3,at[1]+height+1.2,at[2]+depth*.2],paint);
    }else{
      curvedRoof(target,[at[0],at[1]+height+.1,at[2]],width+.8,depth+.65,roof,brass);
      if(floors>2)cylinder(target,'roof-finial',.8,2,[at[0],at[1]+height+width*.23+1,at[2]],brass,.05);
    }
    for(const x of [-width*.4,width*.4])beam(target,[at[0]+x,at[1]+2.3,at[2]-depth/2],[at[0]+x,at[1]+1.9,at[2]-depth/2-1.3],.05,brass);
    cloth(target,'shop-awning',[[at[0]-width*.45,at[1]+1.9,at[2]-depth/2-1.3],[at[0]+width*.45,at[1]+1.9,at[2]-depth/2-1.3],[at[0]-width*.45,at[1]+2.3,at[2]-depth/2],[at[0]+width*.45,at[1]+2.3,at[2]-depth/2]],sail,[0,-.16,0]);
  };
  for(const [x,z,f] of [[-19,10,2],[-20,22,3],[-9,23,2],[3,22,3],[15,20,2],[16,8,2],[-18,-5,2]])building(root,[x,1.15,z],x===16?7:6,5.8,f);
  const houseTemplates=new Map<string,TransformNode>();
  for (const [districtIndex, district] of CITY_DISTRICTS.entries()) {
    const quarter = new TransformNode(id + '-residential-quarter-' + districtIndex, scene);
    box(quarter,'district-caisson',[district.hx*2,3.2,district.hz*2],[district.x,-.65,district.z],paint);
    box(quarter,'district-boardwalk',[district.hx*2,.3,district.hz*2],[district.x,1.1,district.z],wood);
    for (let x=district.x-district.hx+8, col=0;x<district.x+district.hx-5;x+=14,col++) {
      for (const row of [-1,1]) {
        const z=district.z+row*13, floors=2+(col+districtIndex)%3;
        const width=8+(col%2)*2,key=width+':'+floors;
        let template=houseTemplates.get(key);
        if(!template) {
          template=new TransformNode(id+'-house-template-'+key,scene);
          building(template,[0,0,0],width,8,floors);compact(template);
          template.setEnabled(false);houseTemplates.set(key,template);
        }
        for(const mesh of template.getChildMeshes()) {
          const copy=(mesh as Mesh).clone('district-house',quarter)!;
          copy.position.set(x,1.25,z);copy.setEnabled(true);
        }
        if (id==='reedhaven' && col%2===0) {
          cylinder(quarter,'garden-planter',3.4,.8,[x,1.7,district.z],paint);
          for(let n=0;n<4;n++)leaf(quarter,[x,2.1,district.z],5,2.2,n*Math.PI/2,greenery,brass);
        }
      }
      lamp(quarter,[x,1.25,district.z-3],brass,glass,4.5);
      box(quarter,'promenade-bench',[2.2,.18,.65],[x+3,1.9,district.z],wood);
      for(const dx of [2.3,3.7])box(quarter,'bench-leg',[.15,.65,.6],[x+dx,1.55,district.z],dark);
    }
    for(let x=district.x-district.hx+1;x<district.x+district.hx;x+=8) {
      cylinder(quarter,'quay-pile',.8,4,[x,-.4,district.z+district.hz-.5],dark);
      beam(quarter,[x,1.3,district.z+district.hz-.5],[x,2.2,district.z+district.hz-.5],.07,brass);
    }
    beam(quarter,[district.x-district.hx,2.2,district.z+district.hz-.5],[district.x+district.hx,2.2,district.z+district.hz-.5],.055,brass);
    compact(quarter);quarter.parent=parent;
  }
  for(const template of houseTemplates.values())template.dispose();
  // Stalls and a public square make the harbor a place to inhabit.
  for(const [x,z] of [[-9,1],[6,1],[7,-7]]){
    box(root,'market-counter',[2.6,1,1.3],[x,1.65,z],wood);
    for(const side of [-1,1])beam(root,[x+side*1.5,1.2,z],[x+side*1.5,4,z],.07,paint);
    cloth(root,'market-cloth',[[x-1.65,3.4,z-1.3],[x+1.65,3.4,z-1.3],[x-1.65,4,z+.6],[x+1.65,4,z+.6]],sail,[0,.15,0]);
    const display=new TransformNode('market-sample',scene);
    freight(display,id==='reedhaven'?'kelp':id==='ironwake'?'plates':'timber',wood,dark,brass,id==='reedhaven'?greenery:roof);
    compact(display);display.position.set(x,2.35,z);display.parent=root;
  }
  const rotors:TransformNode[]=[], smokeOrigins:Point[]=[];
  if(id==='reedhaven'){
    for(const [x,z,h] of [[-4,12,22],[8,13,17],[-14,3,15]]){
      tube(root,'living-lantern-stem',[[x,1,z],[x-1,h*.35,z+1],[x+1,h*.7,z],[x,h,z]],.48,greenery);
      for(let i=0;i<7;i++)leaf(root,[x,h-i%2*1.6,z],11+i%3*2.5,5.5,i*Math.PI*2/7+(h%3),i%2?greenery:luminous,brass);
      for(let i=0;i<3;i++)lamp(root,[x+Math.sin(i*2.1)*5,6+i,z+Math.cos(i*2.1)*5],brass,glass,2.4);
    }
    for(const x of [-12,-7,-2]){
      cylinder(root,'kelp-distillery',2.8,3.2,[x,2.7,6],roof,2.3);cylinder(root,'copper-still',2.2,2,[x,5.3,6],brass,.3);
      tube(root,'condensing-pipe',[[x,6.3,6],[x,7.2,6],[x,7.2,2],[x,2.4,2]],.16,brass);
    }
    for(const x of [-25,22])for(const z of [1,11,20])leaf(root,[x,.4,z],5,2.4,x<0?-Math.PI/2:Math.PI/2,greenery,brass);
  }else if(id==='ironwake'){
    building(root,[-3,1.15,10],12,9,3);
    for(const [x,z,h] of [[-7,14,29],[2,15,35],[8,12,24]]){
      cylinder(root,'ember-foundry-stack',3.4,h,[x,h/2+1,z],dark,2);
      for(let y=4;y<h;y+=5)cylinder(root,'riveted-stack-collar',3.45-y*.035,.32,[x,y,z],brass);
      cylinder(root,'chimney-crown',3.6,1.3,[x,h+1,z],roof,2.6);smokeOrigins.push([x,h+2,z]);
      tube(root,'foundry-pipe',[[x,3,z],[x-2,3,z],[x-2,5,z-8],[x-2,5,z-10]],.32,brass);
    }
    const fire=material(root,'furnace-fire','#ff9b47');fire.emissiveColor=Color3.FromHexString('#ff8635').scale(.9);
    for(const x of [-6,0,6]){
      box(root,'furnace-arch',[3.8,3.7,1],[x,3,4.7],dark);box(root,'ember-mouth',[2.7,2.4,1.1],[x,2.8,4.5],fire);
      for(const dx of [-.8,0,.8])box(root,'furnace-bars',[.15,2.5,1.2],[x+dx,2.8,4.4],dark);
    }
    for(let i=0;i<8;i++){const sheet=box(root,'reclaimed-hull-plate',[3,.22,1.7],[12,1.5+i*.28,-3],roof);sheet.rotation.y=i%2*.15;}
  }else{
    for(const x of [-10,-2]){
      tube(root,'tide-clock-foundation',[[x-3,1.2,9],[x-2,10,9],[x,16,9],[x,24,9]],.55,paint);
      beam(root,[x,2,9],[x,18,9],.13,brass);
    }
    const rotor=new TransformNode('bastion-tide-clock',scene);
    const rim=attach(CreateTorus('tide-wheel-rim',{diameter:21,thickness:.3,tessellation:72},scene),rotor,brass);rim.rotation.z=Math.PI/2;
    const inner=attach(CreateTorus('tide-wheel-inner',{diameter:7,thickness:.2,tessellation:40},scene),rotor,brass);inner.rotation.z=Math.PI/2;
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;beam(rotor,[0,0,0],[0,Math.cos(a)*10,Math.sin(a)*10],.15,brass);
      cloth(rotor,'tide-silk-vane',[[0,Math.cos(a)*3,Math.sin(a)*3],[0,Math.cos(a+.3)*3.3,Math.sin(a+.3)*3.3],[0,Math.cos(a)*9.7,Math.sin(a)*9.7],[0,Math.cos(a+.42)*9,Math.sin(a+.42)*9]],sail,[.45,0,0]);
    }
    cylinder(rotor,'clock-hub',2.1,1,[0,0,0],roof).rotation.z=Math.PI/2;
    compact(rotor);rotor.position.set(-6,23,9);rotors.push(rotor);
    for(const x of [-27,26]){
      const paddle=new TransformNode('migration-paddlewheel',scene);
      for(let i=0;i<10;i++){const a=i*Math.PI/5;beam(paddle,[0,0,0],[0,Math.cos(a)*3.7,Math.sin(a)*3.7],.12,dark);const blade=box(paddle,'paddle-blade',[2.7,.2,1.3],[0,Math.cos(a)*3.6,Math.sin(a)*3.6],wood);blade.rotation.x=a;}
      compact(paddle);paddle.position.set(x,.5,8);rotors.push(paddle);
    }
    for(const [x,z] of [[-22,4],[12,17]]){tube(root,'shipyard-timber-tree',[[x,1,z],[x,7,z],[x+1,12,z]],.65,wood);for(let i=0;i<5;i++)leaf(root,[x,10+i%2,z],7,3.7,i*1.26,greenery,brass);}
    for(const x of [-14,-4])beam(root,[x,1,-1],[x,12,-1],.32,paint);
    beam(root,[-14,12,-1],[-4,12,-1],.35,brass);
    beam(root,[-9,12,-1],[-9,3,-1],.035,dark);
    tube(root,'shipyard-hook',[[-9,3,-1],[-9,2.3,-1],[-8.5,2.2,-1],[-8.2,2.6,-1]],.12,brass);
  }
  for(const [x,z] of [[-20,-12],[10,-14],[18,-25],[18,-43],[-22,17],[14,24]])lamp(root,[x,1.1,z],brass,glass);
  compact(root);root.parent=parent;for(const rotor of rotors)rotor.parent=parent;
  const districts=Array.from({length:3},(_,i)=>{
    const district=new TransformNode(id+'-civic-expansion-'+i,scene),x=-18+i*10;
    box(district,'new-pontoon',[7.2,2,6.3],[x,0,-14],paint);box(district,'new-boardwalk',[7.4,.25,6.5],[x,1,-14],wood);
    building(district,[x,1.15,-14],5.8,4.6,2+i%2);compact(district);district.parent=parent;district.setEnabled(false);return district;
  });
  if(typeof document!=='undefined'){
    const board=new DynamicTexture(id+'-harbor-sign',{width:1024,height:256},scene,false),ctx=board.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle=style.dark;ctx.fillRect(0,0,1024,256);ctx.strokeStyle='#dabc78';ctx.lineWidth=7;ctx.strokeRect(12,12,1000,232);
    ctx.fillStyle='#f5e8c4';ctx.textAlign='center';ctx.font='120px "IM Fell English"';ctx.fillText(id[0].toUpperCase()+id.slice(1),512,133,900);
    ctx.font='42px "Atkinson Hyperlegible Next"';ctx.fillText(style.title,512,206,900);board.update();
    const signMat=material(root,'harbor-sign','#ffffff');signMat.albedoTexture=board;signMat.emissiveTexture=board;signMat.emissiveColor=new Color3(.16,.16,.16);
    attach(CreatePlane('harbor-name',{width:17,height:4.25,sideOrientation:Mesh.DOUBLESIDE},scene),parent,signMat,[5,6.3,-17.5]);
  }
  return {rotors,districts,glass,smokeOrigins};
}

export function buildRegionLandmarks(parent: TransformNode) {
  const scene=parent.getScene(), beacons:TransformNode[]=[];
  for(const place of LANDMARKS){
    const root=new TransformNode(place.id,scene),stone=material(root,'weathered-stone',place.kind==='scrap'?'#706c62':'#718e87');
    const dark=material(root,'basalt-stone','#344c59'),wood=material(root,'root-wood','#786847'),brass=material(root,'copper','#b48c52',.4);
    const green=material(root,'deep-kelp','#2d765b'),lit=material(root,'luminous-canopy','#77baa0');lit.emissiveColor=Color3.FromHexString('#69c99d').scale(.2);
    const glow=material(root,'beacon-glass','#edc482');glow.emissiveColor=Color3.FromHexString('#f9c76f').scale(.8);
    if(place.kind!=='gate'){
      for(let i=0;i<9;i++){
        const a=i*Math.PI*2/9, r=place.radius*(i%3===0?.25:.54), h=3+(i*7%6);
        const rock=CreateIcoSphere('wave-cut-rock',{radius:1,subdivisions:3,flat:false},scene);
        const positions=rock.getVerticesData('position')!,normals:number[]=[];
        for(let j=0;j<positions.length;j+=3) {
          const x=positions[j],y=positions[j+1],z=positions[j+2];
          const rough=1+.13*Math.sin(x*9+z*6+i)*Math.cos(y*7+i)+.07*Math.sin(z*17-y*11);
          positions[j]*=rough;positions[j+1]*=1+.1*Math.sin(x*13+z*9);positions[j+2]*=rough;
        }
        VertexData.ComputeNormals(positions,rock.getIndices()!,normals);
        rock.setVerticesData('position',positions);rock.setVerticesData('normal',normals);
        rock.scaling.set(place.radius*(.34+i%2*.06),h*.7,place.radius*.31);
        attach(rock,root,i%3?stone:dark,[Math.sin(a)*r,h*.3-1.3,Math.cos(a)*r]);
        rock.rotation.y=a;rock.rotation.z=Math.sin(i)*.06;
      }
    }
    if(place.kind==='timber'||place.kind==='kelp'){
      const h=place.height;
      for(const side of [-1,0,1]){
        const x=side*8,z=side*3;
        tube(root,'ancient-root',[[x-9,2,z-5],[x,4,z],[x+2,h*.4,z+1],[x,h*.75,z],[x+side*4,h,z+3]],1.6,place.kind==='timber'?wood:green);
        for(let i=0;i<7;i++)leaf(root,[x,h-4-i%3*4,z],place.kind==='timber'?17:20,8,i*Math.PI*2/7+side, i%3?green:lit,brass);
      }
      for(let i=0;i<5;i++){const a=i*1.25;lamp(root,[Math.sin(a)*19,7,Math.cos(a)*19],brass,glow,5);}
    }else if(place.kind==='scrap'){
      for(const [x,z,h] of [[-12,0,place.height],[9,8,place.height*.78],[2,-13,place.height*.55]]){
        cylinder(root,'bellwether-spire',8,h,[x,h/2,z],dark,2.8);
        cylinder(root,'salvaged-crown',9,2,[x,h-2,z],brass,6);
        if(place.id==='bellwether')cylinder(root,'ancient-tide-bell',5,5,[x,h-7,z],brass,2.5);
      }
      beam(root,[-12,place.height*.6,0],[9,place.height*.57,8],.8,brass);
      for(let i=0;i<7;i++){const slab=box(root,'old-hull-fragment',[5,.5,10],[Math.sin(i*2)*18,2+i%3,Math.cos(i*2)*14],brass);slab.rotation.set(.15*i,i*.7,.2);}
    }else if(place.kind==='gate'){
      for(const side of [-1,1]){
        cylinder(root,'gate-footing',15,5,[side*20,1,0],stone,12);
        tube(root,'tide-gate-horn',[[side*20,2,0],[side*20,24,0],[side*17,40,0],[side*7,place.height,0]],3.2,dark);
        tube(root,'gate-inlay',[[side*19.8,7,-3.25],[side*19.8,24,-3.25],[side*16.8,40,-3.25],[side*7,place.height,-3.25]],.2,brass);
      }
      cylinder(root,'suspended-tide-stone',5,9,[0,place.height-6,0],lit,0);
    }else{
      cylinder(root,'northlight-tower',10,place.height-8,[0,(place.height-8)/2,0],stone,4.5);
      for(let y=8;y<place.height-8;y+=8)cylinder(root,'beacon-collar',10-y*.09,.7,[0,y,0],brass);
      cylinder(root,'northlight-lens',6,6,[0,place.height-7,0],glow);
      cylinder(root,'beacon-copper-crown',9,5,[0,place.height-1.5,0],brass,.1);
    }
    compact(root);root.position.set(place.x,0,place.z);root.parent=parent;
    const beacon=new TransformNode(place.id+'-light',scene);
    const mote=attach(CreateSphere('beacon-glow',{diameter:2.2,segments:8},scene),beacon,glow);mote.isPickable=false;
    beacon.position.set(place.x,place.height+1,place.z);beacon.parent=parent;beacons.push(beacon);
  }
  return beacons;
}

export function buildDockworker(parent: TransformNode, color: string) {
  const root = new TransformNode(parent.name + '-worker', parent.getScene());
  const coat = material(root, 'coat', color), dark = material(root, 'boots', '#253b40'), skin = material(root, 'skin', '#b98356');
  cylinder(root, 'coat', .42, .48, [0,.72,0], coat,.34).scaling.z=.68;
  const head=attach(CreateSphere('head',{diameter:.31,segments:12},root.getScene()),root,skin,[0,1.13,.02]);head.scaling.set(.87,1.1,.9);
  box(root,'nose',[.055,.06,.065],[0,1.14,.16],skin);
  for(const side of [-1,1])box(root,'eye',[.023,.025,.026],[side*.068,1.18,.152],dark);
  cylinder(root, 'work-cap', 0.37, 0.09, [0, 1.3, 0], coat);
  box(root,'cap-visor',[.29,.035,.17],[0,1.28,.13],coat);
  box(root,'coat-belt',[.35,.055,.285],[0,.55,0],dark);
  compact(root); root.parent = parent;
  const legs = [-1, 1].map(side => {
    const leg = new TransformNode(root.name + '-leg', root.getScene());
    cylinder(leg,'trouser-leg',.14,.3,[0,-.13,0],dark);
    box(leg, 'boot', [0.15, 0.14, 0.28], [0, -.34, .06], dark); compact(leg);
    leg.parent = root; leg.position.set(side * 0.1, 0.47, 0); return leg;
  });
  const arms = new TransformNode(root.name + '-arms', root.getScene());
  const shoulders = [-1,1].map(side=>{
    const arm=new TransformNode(root.name+'-arm-'+side,root.getScene());
    beam(arm,[0,0,0],[side*.015,-.19,.02],.075,coat);
    beam(arm,[side*.015,-.19,.02],[0,-.33,.12],.065,coat);
    const hand=attach(CreateSphere('hand',{diameter:.115,segments:8},root.getScene()),arm,skin,[0,-.35,.13]);hand.scaling.y=1.2;
    compact(arm);arm.parent=arms;arm.position.x=side*.235;return arm;
  });
  arms.parent = root;arms.position.y=.89;
  const carry = new TransformNode(root.name + '-carried-case', root.getScene());
  freightCase(carry, [0, 0, 0], coat, dark, skin); compact(carry); carry.parent = root; carry.scaling.setAll(0.5); carry.position.set(0, 0.66, 0.35); carry.setEnabled(false);
  return { root, legs, arms, shoulders, carry };
}

export function buildSeabird(parent: TransformNode) {
  const scene=parent.getScene(),root=new TransformNode('harbor-tern',scene);
  const feather=material(root,'ivory-feather','#d7ddd2'),beak=material(root,'beak','#bf8e4e');
  const body=attach(CreateSphere('tern-body',{diameter:.38,segments:12},scene),root,feather);body.scaling.set(.9,.85,2.2);
  attach(CreateSphere('tern-head',{diameter:.27,segments:10},scene),root,feather,[0,.12,.42]);
  cylinder(root,'tern-beak',.11,.29,[0,.11,.65],beak,.015).rotation.x=Math.PI/2;
  const tail=box(root,'tern-tail',[.37,.035,.48],[0,.06,-.47],feather);tail.rotation.x=-.12;
  compact(root);root.parent=parent;
  const wings=[-1,1].map(side=>{
    const wing=new TransformNode('tern-wing',scene),mesh=new Mesh('flight-feathers',scene),data=new VertexData();
    data.positions=[0,0,.18,side*.65,.1,.2,side*1.45,-.04,-.3,side*.75,.02,-.25,0,0,-.25];
    data.indices=[0,1,4,1,3,4,1,2,3];data.normals=[];VertexData.ComputeNormals(data.positions,data.indices,data.normals);
    data.colors=[1,1,1,1,1,1,1,1,.2,.25,.29,1,.6,.64,.64,1,1,1,1,1];
    data.applyToMesh(mesh);mesh.useVertexColors=true;feather.backFaceCulling=false;attach(mesh,wing,feather);
    wing.parent=root;wing.position.y=.07;return wing;
  });
  root.getChildMeshes().forEach(mesh=>{mesh.isPickable=false;});
  return {root,wings};
}

export function buildHarborActivity(parent: TransformNode) {
  const scene = parent.getScene(), root = new TransformNode(parent.name + '-working-harbor', scene);
  const wood = material(root, 'freight-wood', '#9d6c3c'), brass = material(root, 'freight-brass', '#c89c54', 0.55), iron = material(root, 'crane', '#29383a');
  const dock=new TransformNode(parent.name+'-drydock',scene);
  for(const x of [-14,-4])box(dock,'shipyard-slip',[2,1.3,18],[x,.3,-35],wood);
  box(dock,'shipyard-headwalk',[12,1.3,3],[-9,.3,-27.5],wood);
  for(let z=-41;z<-28;z+=3)beam(dock,[-14,0,z],[-4,0,z],.18,iron);
  compact(dock);dock.parent=parent;
  const stock = Array.from({ length: 8 }, (_, i) => {
    const crate = new TransformNode(root.name + '-stock-' + i, scene);
    freightCase(crate, [0, 0, 0], wood, iron, brass); compact(crate); crate.parent = root;
    crate.position.set(1 + i % 2 * .9, 1.5 + Math.floor(i / 4) * .63, 8 + Math.floor(i % 4 / 2)); return crate;
  });
  const crane = new TransformNode(root.name + '-crane', scene);
  beam(crane, [2, 1.1, -8], [2, 12, -8], .25, iron);
  beam(crane, [2, 12, -8], [12, 11, -13], .2, brass);
  beam(crane, [2, 6, -8], [12, 11, -13], .07, iron);
  compact(crane); crane.parent = root;
  const lift = new TransformNode(root.name + '-lift', scene);
  freightCase(lift, [0, 0, 0], wood, iron, brass); beam(lift, [0, 0.3, 0], [0, 3.4, 0], 0.025, iron);
  compact(lift); lift.parent = root; lift.position.set(12, 2, -13); lift.setEnabled(false);
  const workers = ['#c89f5e','#648f8b','#ae6957','#8b80a2','#b8a678','#4b856a'].map(color => buildDockworker(root,color));
  const construction = Array.from({ length: 6 }, (_, i) => {
    const rib = new TransformNode(root.name + '-construction-' + i, scene);
    tube(rib, 'vessel-frame', [[-1.4, 1, 0], [-1, 0.1, 0], [0, -0.2, 0], [1, 0.1, 0], [1.4, 1, 0]], 0.1, wood);
    box(rib, 'new-deck-planks', [2.3, 0.12, 0.68], [0, 0.72, 0], wood); compact(rib);
    rib.position.set(-25, .8, -5 + i * 1.4); rib.parent = root; rib.setEnabled(false); return rib;
  });
  root.parent = parent; root.position.set(16,0,-34);
  return { root, stock, lift, workers, construction };
}


export function buildFrontierOutpost(root: TransformNode) {
  const deck = new TransformNode(root.name+'-built',root.getScene());
  const wood = material(root,'outpost-wood','#765538'), iron = material(root,'outpost-iron','#34474b',.55), brass = material(root,'outpost-brass','#ca9953',.55);
  const clothMat = material(root,'outpost-flag','#a94032');
  box(deck,'floating-pontoon',[14,1.2,12],[0,.1,0],iron);
  box(deck,'timber-deck',[13.4,.3,11.4],[0,.9,0],wood);
  for(const x of [-6,6])for(const z of [-5,5])cylinder(deck,'mooring-post',.65,2,[x,1.1,z],wood);
  box(deck,'watch-cabin',[4,3.5,3.5],[-3,2.7,1],wood);
  curvedRoof(deck,[-3,4.5,1],5,4.5,iron,brass);
  cylinder(deck,'watch-turret',2.8,2,[2,2,1],iron);
  cylinder(deck,'outpost-cannon',.85,4,[2,3.1,2],iron).rotation.x=Math.PI/2;
  beam(deck,[-4,1,-3],[-4,10,-3],.15,wood);
  cloth(deck,'raider-pennant',[[0,0,0],[4,.4,0],[0,2,0],[3.5,1.8,0]],clothMat,[-4,7,-3]);
  compact(deck);deck.parent=root;
  const stock=Array.from({length:8},(_,i)=>{
    const crate=new TransformNode(root.name+'-exposed-'+i,root.getScene());
    freightCase(crate,[0,0,0],wood,iron,brass);compact(crate);crate.parent=deck;
    crate.scaling.setAll(1.5);crate.position.set(-3+i%4*1.8,1.5,-3+Math.floor(i/4)*1.6);return crate;
  });
  const walls=Array.from({length:3},(_,i)=>{
    const wall=box(root,'defensive-wall',[13,1, .5],[0,1.5+i,-5.5],iron);return wall;
  });
  const marker=attach(CreateTorus('frontier-mooring',{diameter:19,thickness:.2,tessellation:32},root.getScene()),root,brass,[0,.1,0]);
  return {deck,stock,walls,marker};
}

export function buildWorkshopAnnex(root: TransformNode) {
  const wood=material(root,'annex-wood','#9d6c3c'),iron=material(root,'annex-iron','#506a70',.45),brass=material(root,'annex-brass','#c89c54',.6);
  box(root,'annex-platform',[13,.9,15],[0,.2,0],iron);
  for(const x of [-5,5])for(const z of [-6,6])beam(root,[x,1,z],[x,7,z],.18,wood);
  box(root,'workbench',[7,1.5,2],[0,1.7,-3],wood);
  for(const x of [-3,0,3])cylinder(root,'workshop-spindle',.7,1,[x,3,-3],brass);
  compact(root);
  const roof=box(root,'annex-roof',[14,.45,16],[0,7,0],iron);
  return {roof};
}
