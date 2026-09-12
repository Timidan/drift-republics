import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture.js';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture.js';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem.js';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';
import '@babylonjs/core/Particles/webgl2ParticleSystem.js';
import '@babylonjs/core/Particles/particleSystemComponent.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

export const SEA_NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) {
    float n=0.,a=.5;
    for(int i=0;i<4;i++){ n+=noise(p)*a; p=mat2(1.6,1.2,-1.2,1.6)*p+3.7; a*=.5; }
    return n;
  }`;

type Vessel = { id: string; x: number; z: number; heading: number; speed: number; width: number; length: number };
type TrailPoint = { x: number; z: number; time: number; width: number; heading: number };
type Trail = { mesh: Mesh; points: TrailPoint[]; positions: Float32Array; uv: Float32Array; lastSeen: number };

export function createSeaEffects(scene: Scene, camera: Camera, water: ShaderMaterial, sky: Mesh, waveGlsl: string) {
  const phone = matchMedia('(max-width:760px)').matches;
  const reflection = new MirrorTexture('harbor-reflection', phone ? 256 : 512, scene, true);
  reflection.mirrorPlane = new Plane(0,-1,0,0);
  reflection.refreshRate = 2;
  reflection.renderParticles = false;
  reflection.renderList = [sky];
  scene.customRenderTargets.push(reflection);
  water.setTexture('reflectionSampler', reflection);
  scene.environmentTexture = new HDRCubeTexture('/assets/drift/materials/harbor-sky.hdr', scene, 128, false, true, false, true);
  scene.environmentIntensity = .65;
  const glow = new GlowLayer('lantern-bloom', scene, {mainTextureRatio:.35,blurKernelSize:24});
  glow.intensity = .23;
  const lamps = [0,1].map(i => {
    const light = new PointLight('nearby-lantern-'+i, Vector3.Zero(), scene);
    light.diffuse = new Color3(1,.62,.24); light.range = 22; light.intensity = 0;
    return light;
  });

  const soft = new DynamicTexture('soft-spray-and-smoke', {width:64,height:64}, scene, false);
  const ctx = soft.getContext() as CanvasRenderingContext2D;
  const pixels = ctx.createImageData(64,64);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++) {
    const i=(y*64+x)*4, r=Math.hypot((x-31.5)/32,(y-31.5)/32);
    const n=.8+.2*Math.sin(x*.6+Math.sin(y*.37))*Math.cos(y*.4);
    pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;
    pixels.data[i+3]=Math.max(0,1-r)**2*255*n;
  }
  ctx.putImageData(pixels,0,0); soft.hasAlpha=true; soft.update();

  const rain = new GPUParticleSystem('windblown-rain', {capacity:phone?1200:4000,emitRateControl:true}, scene);
  rain.particleTexture=soft; rain.emitter=Vector3.Zero(); rain.updateSpeed=1/60;
  rain.createBoxEmitter(new Vector3(2,-35,0),new Vector3(4,-38,1),new Vector3(-65,0,-65),new Vector3(65,8,65));
  rain.minLifeTime=1.2;rain.maxLifeTime=2.2;rain.minEmitPower=1;rain.maxEmitPower=1;
  rain.minSize=1;rain.maxSize=1;rain.minScaleX=.025;rain.maxScaleX=.06;rain.minScaleY=1.2;rain.maxScaleY=2.8;
  rain.billboardMode=ParticleSystem.BILLBOARDMODE_STRETCHED;
  rain.color1=new Color4(.73,.83,.9,.38);rain.color2=new Color4(.7,.81,.92,.2);rain.colorDead=new Color4(.7,.81,.92,0);
  rain.blendMode=ParticleSystem.BLENDMODE_STANDARD;rain.emitRate=0;rain.clipPlane=new Plane(0,-1,0,.02);rain.start();
  const splashes = new GPUParticleSystem('rain-surface-spray',{capacity:phone?200:600,emitRateControl:true},scene);
  splashes.particleTexture=soft;splashes.emitter=Vector3.Zero();splashes.updateSpeed=1/60;
  splashes.createBoxEmitter(new Vector3(-.5,1.6,-.5),new Vector3(.5,2.6,.5),new Vector3(-40,.08,-40),new Vector3(40,.12,40));
  splashes.gravity=new Vector3(0,-12,0);splashes.minLifeTime=.18;splashes.maxLifeTime=.4;
  splashes.minSize=.13;splashes.maxSize=.32;splashes.color1=new Color4(.85,.95,1,.6);splashes.color2=new Color4(.65,.83,.9,.25);splashes.colorDead=new Color4(.7,.9,1,0);
  splashes.blendMode=ParticleSystem.BLENDMODE_STANDARD;splashes.emitRate=0;splashes.start();

  const chimneys: {system:GPUParticleSystem;parent:TransformNode;origin:readonly number[]}[]=[];
  function chimney(parent:TransformNode, origin:readonly number[]):void {
    const system=new GPUParticleSystem('chimney-plume-'+chimneys.length,{capacity:80,emitRateControl:true},scene);
    system.particleTexture=soft;system.emitter=new Vector3();system.updateSpeed=1/60;
    system.createBoxEmitter(new Vector3(-.4,1.8,-.4),new Vector3(.4,3.1,.4),new Vector3(-.6,0,-.6),new Vector3(.6,.3,.6));
    system.minLifeTime=5;system.maxLifeTime=9;system.minSize=2;system.maxSize=3;
    system.addSizeGradient(0,1.2);system.addSizeGradient(.5,4.5);system.addSizeGradient(1,8);
    system.addColorGradient(0,new Color4(.3,.33,.35,0));system.addColorGradient(.1,new Color4(.32,.35,.38,.22));system.addColorGradient(.55,new Color4(.42,.45,.48,.16));system.addColorGradient(1,new Color4(.55,.59,.62,0));
    system.minAngularSpeed=-.25;system.maxAngularSpeed=.3;system.blendMode=ParticleSystem.BLENDMODE_STANDARD;system.emitRate=7;system.start();
    chimneys.push({system,parent,origin});
  }

  const wakeMaterial = new ShaderMaterial('persistent-foam', scene, {
    vertexSource: `precision highp float;
      attribute vec3 position;attribute vec2 uv;uniform mat4 viewProjection;uniform float time;uniform float waveScale;
      varying vec2 vUv;varying vec3 vWorld;
      void addWave(vec2 p,float t,vec2 d,float k,float speed,float amp,inout float h,inout vec2 g){float ph=dot(d,p)*k+t*speed;h+=amp*sin(ph);g+=amp*k*cos(ph)*d;}
      void main(){vec2 p=position.xz;float h=0.;vec2 g=vec2(0.);${waveGlsl}
        vUv=uv;vWorld=vec3(position.x,h+.09,position.z);gl_Position=viewProjection*vec4(vWorld,1.);}`,
    fragmentSource: `precision highp float;varying vec2 vUv;varying vec3 vWorld;uniform float time;uniform vec3 cameraPosition;uniform float fogDensity;
      ${SEA_NOISE}
      void main(){float age=time-vUv.y;float edge=abs(vUv.x);float foam=fbm(vWorld.xz*2.2+time*.13);
        float broken=smoothstep(.24,.7,foam);float sides=smoothstep(.3,.75,edge)*(1.-smoothstep(.78,1.,edge));
        float alpha=(.22*broken+sides*.5)*smoothstep(0.,.4,age)*(1.-smoothstep(2.,18.,age));
        alpha*=exp(-pow(length(cameraPosition-vWorld)*fogDensity,2.));
        if(age<0.||alpha<.005)discard;gl_FragColor=vec4(.78,.91,.91,alpha);}`,
  }, {attributes:['position','uv'],uniforms:['viewProjection','time','waveScale','cameraPosition','fogDensity'],needAlphaBlending:true});
  wakeMaterial.backFaceCulling=false;wakeMaterial.disableDepthWrite=true;
  const trails=new Map<string,Trail>();
  let visibleVessels: Vessel[]=[];
  const POINTS=72;
  function track(vessel:Vessel,time:number):void {
    if(Math.hypot(vessel.x-camera.position.x,vessel.z-camera.position.z)>500)return;
    if(vessel.width<10)visibleVessels.push(vessel);
    let trail=trails.get(vessel.id);
    if(!trail && Math.abs(vessel.speed)>1 && trails.size<(phone?7:14)) {
      const mesh=new Mesh('wake-'+vessel.id,scene), data=new VertexData();
      const positions=new Float32Array(POINTS*6),uv=new Float32Array(POINTS*4),indices:number[]=[];
      for(let i=0;i<POINTS-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
      data.positions=positions;data.uvs=uv;data.indices=indices;data.applyToMesh(mesh,true);
      mesh.material=wakeMaterial;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
      trail={mesh,positions,uv,points:[],lastSeen:time};trails.set(vessel.id,trail);
    }
    if(!trail)return;
    trail.lastSeen=time;
    const x=vessel.x-Math.sin(vessel.heading)*vessel.length*.45, z=vessel.z-Math.cos(vessel.heading)*vessel.length*.45;
    const last=trail.points.at(-1), distance=last?Math.hypot(x-last.x,z-last.z):Infinity;
    if(last && distance>80)trail.points=[];
    if(Math.abs(vessel.speed)>1 && (!last || time-last.time>.16 && distance>.7)) {
      trail.points.push({x,z,time,width:vessel.width*.75,heading:vessel.heading});
      if(trail.points.length>POINTS)trail.points.shift();
    }
  }
  let refreshAt=-1;
  function update(time:number, waveScale:number, storm:number, windHeading:number, calm:boolean, dusk:number, ports:TransformNode[]):void {
    const nearby=visibleVessels.sort((a,b)=>Math.hypot(a.x-camera.position.x,a.z-camera.position.z)-Math.hypot(b.x-camera.position.x,b.z-camera.position.z)).slice(0,8);
    const hulls=new Array(32).fill(0),sizes=new Array(32).fill(0);
    nearby.forEach((v,i)=>{hulls.splice(i*4,4,v.x,v.z,Math.sin(v.heading),Math.cos(v.heading));sizes.splice(i*4,4,v.width,v.length,v.speed,0);});
    water.setInt('hullCount',nearby.length);water.setArray4('hulls',hulls);water.setArray4('hullSizes',sizes);visibleVessels=[];
    const weather=calm?0:storm;
    const anchor=new Vector3(camera.position.x,Math.max(32,Math.min(80,camera.position.y+15)),camera.position.z);
    (rain.emitter as Vector3).copyFrom(anchor);rain.emitRate=camera.position.y>220?0:weather*(phone?1000:2600);
    rain.minLifeTime=anchor.y/38;rain.maxLifeTime=anchor.y/35+.3;
    rain.direction1.set(Math.sin(windHeading)*8,-35,Math.cos(windHeading)*8);
    rain.direction2.set(Math.sin(windHeading)*11,-38,Math.cos(windHeading)*11);
    (splashes.emitter as Vector3).set(camera.position.x,0,camera.position.z);splashes.emitRate=camera.position.y>220?0:weather*(phone?250:750);
    for(const {system,parent,origin} of chimneys) {
      (system.emitter as Vector3).copyFrom(parent.position).addInPlaceFromFloats(origin[0],origin[1],origin[2]);
      system.gravity.set(Math.sin(windHeading)*.16,0,Math.cos(windHeading)*.16);
      system.emitRate=calm?0:7;system.updateSpeed=calm?0:1/60;
    }
    wakeMaterial.setFloat('time',time);wakeMaterial.setFloat('waveScale',waveScale);wakeMaterial.setFloat('fogDensity',scene.fogDensity);wakeMaterial.setVector3('cameraPosition',camera.position);
    for(const [id,trail] of trails) {
      while(trail.points.length && time-trail.points[0].time>18)trail.points.shift();
      if(!trail.points.length){trail.mesh.dispose();trails.delete(id);continue;}
      trail.mesh.setEnabled(!calm && trail.points.length>1);
      for(let i=0;i<POINTS;i++) {
        const p=trail.points[Math.min(i,trail.points.length-1)];if(!p)continue;
        const width=p.width+(time-p.time)*.32, nx=Math.cos(p.heading), nz=-Math.sin(p.heading);
        trail.positions.set([p.x-nx*width,0,p.z-nz*width,p.x+nx*width,0,p.z+nz*width],i*6);
        trail.uv.set([-1,p.time,1,p.time],i*4);
      }
      trail.mesh.updateVerticesData('position',trail.positions);trail.mesh.updateVerticesData('uv',trail.uv);
    }
    const closest=ports.slice().sort((a,b)=>Vector3.DistanceSquared(a.position,camera.position)-Vector3.DistanceSquared(b.position,camera.position))[0];
    lamps.forEach((light,i)=>{light.position.copyFrom(closest.position).addInPlaceFromFloats(i? -20:18,4.9,i? -12:-43);light.intensity=(.2+dusk*.8+storm*.3)*24;});
    if(time>refreshAt) {
      refreshAt=time+.7;
      reflection.renderList=[sky,...scene.meshes.filter(m=>m.isEnabled() && m.material instanceof PBRMaterial && Vector3.DistanceSquared(m.getBoundingInfo().boundingBox.centerWorld,camera.position)<650**2)];
      for(const mesh of scene.meshes)if(mesh.material instanceof PBRMaterial && mesh.material.emissiveColor.r+mesh.material.emissiveColor.g+mesh.material.emissiveColor.b>0)glow.addIncludedOnlyMesh(mesh as Mesh);
    }
  }
  return {track,update,chimney};
}
