
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import {NX,NY,NZ,N,WIDTH,HEIGHT,DEPTH} from "./physics.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function createVisuals(scene,model){
 const data=new Uint8Array(N);

 const texture=new THREE.Data3DTexture(data,NX,NY,NZ);
 texture.format=THREE.RedFormat;
 texture.type=THREE.UnsignedByteType;
 texture.minFilter=THREE.LinearFilter;
 texture.magFilter=THREE.LinearFilter;
 texture.unpackAlignment=1;
 texture.needsUpdate=true;

 const material=new THREE.ShaderMaterial({
  glslVersion:THREE.GLSL3,
  uniforms:{
   densityTex:{value:texture},
   cameraLocal:{value:new THREE.Vector3()},
   boxSize:{value:new THREE.Vector3(WIDTH,HEIGHT,DEPTH)},
   lightDir:{value:new THREE.Vector3(-.5,.8,.4).normalize()},
   clock:{value:0}
  },
  vertexShader:`
   out vec3 localPos;
   void main(){
    localPos=position;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
   }
  `,
  fragmentShader:`
   precision highp float;
   precision highp sampler3D;

   uniform sampler3D densityTex;
   uniform vec3 cameraLocal;
   uniform vec3 boxSize;
   uniform vec3 lightDir;
   uniform float clock;

   in vec3 localPos;
   out vec4 outColor;

   float hash(vec3 p){
    p=fract(p*.1031);
    p+=dot(p,p.yzx+33.33);
    return fract((p.x+p.y)*p.z);
   }

   float noise(vec3 p){
    vec3 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    float a=hash(i);
    float b=hash(i+vec3(1,0,0));
    float c=hash(i+vec3(0,1,0));
    float d=hash(i+vec3(1,1,0));
    float e=hash(i+vec3(0,0,1));
    float g=hash(i+vec3(0,1,1));
    float h=hash(i+vec3(1,1,1));
    float j=hash(i+vec3(1,0,1));
    return mix(
     mix(mix(a,b,f.x),mix(c,d,f.x),f.y),
     mix(mix(e,j,f.x),mix(g,h,f.x),f.y),f.z
    );
   }

   float fbm(vec3 p){
    float v=0.,a=.5;
    for(int i=0;i<4;i++){
     v+=noise(p)*a;
     p*=2.02;
     a*=.5;
    }
    return v;
   }

   vec2 intersectBox(vec3 ro,vec3 rd){
    vec3 inv=1./rd;
    vec3 t0=(-boxSize*.5-ro)*inv;
    vec3 t1=( boxSize*.5-ro)*inv;
    vec3 lo=min(t0,t1);
    vec3 hi=max(t0,t1);
    return vec2(max(max(lo.x,lo.y),lo.z),
                min(min(hi.x,hi.y),hi.z));
   }

   float densityAt(vec3 p){
    vec3 uv=p/boxSize+.5;
    if(any(lessThan(uv,vec3(0.)))||
       any(greaterThan(uv,vec3(1.)))) return 0.;

    float base=texture(densityTex,uv).r;
    if(base<.018) return 0.;

    vec3 q=p*.8+vec3(clock*.004,0.,clock*.002);
    float n=fbm(q);
    float erosion=mix(.10,.35,n);
    return smoothstep(erosion,.55,base)*min(1.,base*2.4);
   }

   void main(){
    vec3 rd=normalize(localPos-cameraLocal);
    vec2 hit=intersectBox(cameraLocal,rd);
    float start=max(hit.x,0.);
    float finish=hit.y;
    if(finish<=start) discard;

    float stepSize=max((finish-start)/110.,.045);
    vec3 color=vec3(0.);
    float alpha=0.;

    for(float t=start;t<finish;t+=stepSize){
     vec3 p=cameraLocal+rd*t;
     float d=densityAt(p);

     if(d>.012){
      float h=clamp(p.y/boxSize.y+.5,0.,1.);
      vec3 cloud=mix(
       vec3(.34,.40,.47),
       vec3(1.,.99,.96),
       smoothstep(.05,.9,h)
      );

      float light=.68+.32*max(dot(-rd,lightDir),0.);
      float shade=mix(.65,1.,smoothstep(.05,.6,d));
      cloud*=light*shade;

      float a=d*.105;
      color+=(1.-alpha)*cloud*a;
      alpha+=(1.-alpha)*a;
      if(alpha>.96) break;
     }
    }

    if(alpha<.006) discard;
    outColor=vec4(color,alpha);
   }
  `,
  transparent:true,
  depthWrite:false,
  side:THREE.BackSide
 });

 const volume=new THREE.Mesh(
  new THREE.BoxGeometry(WIDTH,HEIGHT,DEPTH),
  material
 );
 volume.position.y=HEIGHT/2;
 scene.add(volume);

 // Rain particles are a visual indicator of precipitation.
 const rainCount=900;
 const rainPositions=new Float32Array(rainCount*3);
 const rainGeometry=new THREE.BufferGeometry();
 rainGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(rainPositions,3)
 );

 const rainMaterial=new THREE.PointsMaterial({
  color:0xb8d9f2,
  size:.055,
  transparent:true,
  opacity:.55,
  depthWrite:false
 });

 const rain=new THREE.Points(rainGeometry,rainMaterial);
 scene.add(rain);

 for(let i=0;i<rainCount;i++){
  rainPositions[i*3]=(Math.random()-.5)*WIDTH;
  rainPositions[i*3+1]=Math.random()*HEIGHT;
  rainPositions[i*3+2]=(Math.random()-.5)*DEPTH;
 }

 // Lightning flash and branching bolt.
 const lightningGroup=new THREE.Group();
 scene.add(lightningGroup);

 const flash=new THREE.AmbientLight(0x9fcfff,0);
 scene.add(flash);

 let lightningTimer=8+Math.random()*15;
 let flashTime=0;

 function makeBolt(){
  lightningGroup.clear();

  const x=(Math.random()-.5)*WIDTH*.65;
  const z=(Math.random()-.5)*DEPTH*.65;
  let y=HEIGHT*.85;

  const points=[new THREE.Vector3(x,y,z)];

  for(let i=0;i<12;i++){
   y-=HEIGHT*.055;
   points.push(new THREE.Vector3(
    x+(Math.random()-.5)*1.8,
    y,
    z+(Math.random()-.5)*1.8
   ));
  }

  const geometry=new THREE.BufferGeometry().setFromPoints(points);
  const bolt=new THREE.Line(
   geometry,
   new THREE.LineBasicMaterial({
    color:0xd9efff,
    transparent:true,
    opacity:.95
   })
  );
  lightningGroup.add(bolt);
  flashTime=.16;
 }

 function update(dt,now,camera){
  const qc=model.fields.qc;
  let ptr=0;

  for(let z=0;z<NZ;z++){
   for(let y=0;y<NY;y++){
    for(let x=0;x<NX;x++){
     const q=qc[x+NX*(y+NY*z)];
     const d=clamp((q-.025)/2.2,0,1);
     data[ptr++]=Math.round(Math.pow(d,.8)*255);
    }
   }
  }

  texture.needsUpdate=true;

  volume.updateMatrixWorld(true);
  material.uniforms.cameraLocal.value.copy(
   volume.worldToLocal(camera.position.clone())
  );
  material.uniforms.clock.value=now;

  const positions=rainGeometry.attributes.position.array;

  for(let i=0;i<rainCount;i++){
   const j=i*3;
   positions[j+1]-=dt*5.5;
   if(positions[j+1]<0){
    positions[j]=(Math.random()-.5)*WIDTH;
    positions[j+1]=HEIGHT;
    positions[j+2]=(Math.random()-.5)*DEPTH;
   }
  }
  rainGeometry.attributes.position.needsUpdate=true;

  lightningTimer-=dt;
  if(lightningTimer<=0){
   if(model.diagnostics.cloud>1.5 && Math.random()<.55){
    makeBolt();
   }
   lightningTimer=7+Math.random()*18;
  }

  if(flashTime>0){
   flashTime-=dt;
   flash.intensity=flashTime>0?.9:0;
  }else{
   flash.intensity=0;
   lightningGroup.clear();
  }
 }

 function dispose(){
  scene.remove(volume,rain,lightningGroup,flash);
  volume.geometry.dispose();
  material.dispose();
  texture.dispose();
  rain.geometry.dispose();
  rain.material.dispose();
 }

 return {update,dispose};
}
