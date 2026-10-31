
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import {OrbitControls} from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import {createModel,WIDTH,HEIGHT,DEPTH} from "./physics.js";
import {createVisuals} from "./visuals.js";

/* SETTINGS */

const $=id=>document.getElementById(id);

const settings={
 heat:()=>$("heat").value,
 moist:()=>$("moist").value,
 wind:()=>$("wind").value,
 shear:()=>$("shear").value
};

let model=createModel(settings);

/* THREE SCENE */

const container=$("view");
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x9dbbd3);

const camera=new THREE.PerspectiveCamera(
 48,
 window.innerWidth/window.innerHeight,
 .1,
 250
);
camera.position.set(23,17,29);

const renderer=new THREE.WebGLRenderer({
 antialias:false,
 powerPreference:"high-performance"
});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.2));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
container.appendChild(renderer.domElement);

const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,HEIGHT*.43,0);
controls.enableDamping=true;
controls.dampingFactor=.075;
controls.minDistance=5;
controls.maxDistance=100;
controls.maxPolarAngle=Math.PI*.49;
controls.update();

/* LIGHTS */

scene.add(new THREE.HemisphereLight(0xeaf6ff,0x667b88,1.8));

const sun=new THREE.DirectionalLight(0xffffff,2.2);
sun.position.set(-22,35,18);
scene.add(sun);

/* GROUND */

const ground=new THREE.Mesh(
 new THREE.PlaneGeometry(WIDTH*1.8,DEPTH*1.8),
 new THREE.MeshStandardMaterial({
  color:0x829e82,
  roughness:1
 })
);
ground.rotation.x=-Math.PI/2;
ground.position.y=-.12;
scene.add(ground);

const grid=new THREE.GridHelper(
 Math.max(WIDTH,DEPTH)*1.8,
 36,
 0x47718a,
 0x658c98
);
grid.position.y=-.105;
grid.material.transparent=true;
grid.material.opacity=.27;
scene.add(grid);

/* DOMAIN FRAME */

const frame=new THREE.LineSegments(
 new THREE.EdgesGeometry(
  new THREE.BoxGeometry(WIDTH,HEIGHT,DEPTH)
 ),
 new THREE.LineBasicMaterial({
  color:0x42657d,
  transparent:true,
  opacity:.4
 })
);
frame.position.y=HEIGHT/2;
scene.add(frame);

/* VISUAL SYSTEM */

let visuals=createVisuals(scene,model);

/* SIMULATION */

let paused=false;
let accumulator=0;
let last=performance.now();
let simSteps=0;

function refreshStats(){
 const d=model.diagnostics;

 $("updraft").textContent=d.updraft.toFixed(1)+" m/s";
 $("cloud").textContent=d.cloud.toFixed(2)+" g/kg";
 $("temp").textContent=d.temp.toFixed(1)+" °C";

 const seconds=Math.floor(d.time);
 const mm=String(Math.floor(seconds/60)).padStart(2,"0");
 const ss=String(seconds%60).padStart(2,"0");
 $("time").textContent=mm+":"+ss;

 $("conv").textContent=
  d.updraft>8?"ACTIVE":
  d.updraft>2?"DEVELOPING":"WEAK";

 $("status").textContent=paused?"PAUSED":"MODEL RUNNING";
}

function oneStep(){
 model.step(.35);
 simSteps++;
 if(simSteps%2===0) refreshStats();
}

function resetSimulation(){
 model.initialize();
 accumulator=0;
 simSteps=0;
 refreshStats();
}

/* CONTROLS */

$("pause").onclick=()=>{
 paused=!paused;
 $("pause").textContent=paused?"Продолжить":"Пауза";
 refreshStats();
};

$("step").onclick=()=>{
 if(paused){
  oneStep();
  refreshStats();
 }
};

$("reset").onclick=()=>{
 resetSimulation();
};

$("camera").onclick=()=>{
 camera.position.set(23,17,29);
 controls.target.set(0,HEIGHT*.43,0);
 controls.update();
};

$("close").onclick=()=>{
 $("panel").classList.add("hidden");
 $("toggle").classList.add("show");
};

$("toggle").onclick=()=>{
 $("panel").classList.remove("hidden");
 $("toggle").classList.remove("show");
};

/* SLIDERS */

function bindSlider(id,label,format){
 const el=$(id);
 const output=$(label);
 const update=()=>output.textContent=format(Number(el.value));
 el.addEventListener("input",update);
 update();
}

bindSlider("speed","speedV",v=>v.toFixed(1)+"×");
bindSlider("heat","heatV",v=>v+"%");
bindSlider("moist","moistV",v=>v+"%");
bindSlider("wind","windV",v=>v+" m/s");
bindSlider("shear","shearV",v=>v+" m/s");

/* RESIZE */

window.addEventListener("resize",()=>{
 camera.aspect=window.innerWidth/window.innerHeight;
 camera.updateProjectionMatrix();
 renderer.setSize(window.innerWidth,window.innerHeight);
});

/* ANIMATION */

function animate(now){
 requestAnimationFrame(animate);

 const elapsed=Math.min((now-last)/1000,.05);
 last=now;

 controls.update();

 if(!paused){
  accumulator+=elapsed*Number($("speed").value)*2.5;

  let count=0;
  while(accumulator>=.35 && count<2){
   oneStep();
   accumulator-=.35;
   count++;
  }
 }

 visuals.update(elapsed,model.diagnostics.time,camera);
 renderer.render(scene,camera);
}

refreshStats();
$("status").textContent="MODEL RUNNING";
$("loading")?.remove?.();
requestAnimationFrame(animate);
