
import * as THREE from "three";
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
   lightDir:{value:new THREE.Vector3(-.5,.8,.4).normalize()}
  },

  vertexShader:`
   out vec3 localPos;

   void main(){
    localPos=position;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
   }
  `,

  fragmentShader:`
   precision highp float;
   precision highp sampler3D;

   uniform sampler3D densityTex;
   uniform vec3 cameraLocal;
   uniform vec3 boxSize;
   uniform vec3 lightDir;

   in vec3 localPos;
   out vec4 outColor;

   vec2 intersectBox(vec3 ro,vec3 rd){

    vec3 inv=1./rd;
    vec3 t0=(-boxSize*.5-ro)*inv;
    vec3 t1=(boxSize*.5-ro)*inv;

    vec3 lo=min(t0,t1);
    vec3 hi=max(t0,t1);

    return vec2(
     max(max(lo.x,lo.y),lo.z),
     min(min(hi.x,hi.y),hi.z)
    );
   }

   float densityAt(vec3 p){

    vec3 uv=p/boxSize+.5;

    if(any(lessThan(uv,vec3(0.)))||
       any(greaterThan(uv,vec3(1.)))){
     return 0.;
    }

    float d=texture(densityTex,uv).r;

    return smoothstep(.035,.38,d);
   }

   void main(){

    vec3 rd=normalize(localPos-cameraLocal);
    vec2 hit=intersectBox(cameraLocal,rd);

    float start=max(hit.x,0.);
    float finish=hit.y;

    if(finish<=start) discard;

    float stepSize=max((finish-start)/150.,.035);

    vec3 color=vec3(0.);
    float alpha=0.;

    for(float t=start;t<finish;t+=stepSize){

     vec3 p=cameraLocal+rd*t;
     float d=densityAt(p);

     if(d>.01){

      float h=clamp(p.y/boxSize.y+.5,0.,1.);

      vec3 cloudColor=mix(
       vec3(.36,.40,.46),
       vec3(.97,.98,1.),
       smoothstep(.05,.78,h)
      );

      float lighting=.58+
       .42*max(dot(-rd,lightDir),0.);

      cloudColor*=lighting;

      float a=d*.105;

      color+=(1.-alpha)*cloudColor*a;
      alpha+=(1.-alpha)*a;

      if(alpha>.97) break;
     }
    }

    if(alpha<.008) discard;

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

 let updateTimer=0;

 function update(dt,now,camera){

  updateTimer+=dt;

  if(updateTimer>=.1){

   updateTimer=0;

   const qc=model.fields.qc;
   const qi=model.fields.qi;

   let ptr=0;

   for(let z=0;z<NZ;z++){
    for(let y=0;y<NY;y++){
     for(let x=0;x<NX;x++){

      const i=x+NX*(y+NY*z);

      const liquid=qc[i];
      const ice=qi[i];

      const total=liquid+ice*.85;

      const density=clamp(total/1.4,0,1);

      data[ptr++]=Math.round(
       Math.pow(density,.85)*255
      );
     }
    }
   }

   texture.needsUpdate=true;
  }

  volume.updateMatrixWorld(true);

  material.uniforms.cameraLocal.value.copy(
   volume.worldToLocal(camera.position.clone())
  );
 }

 function dispose(){

  scene.remove(volume);

  volume.geometry.dispose();
  material.dispose();
  texture.dispose();
 }

 return {update,dispose};
}
