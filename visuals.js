
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
 texture.wrapS=THREE.ClampToEdgeWrapping;
 texture.wrapT=THREE.ClampToEdgeWrapping;
 texture.wrapR=THREE.ClampToEdgeWrapping;
 texture.unpackAlignment=1;
 texture.needsUpdate=true;

 const material=new THREE.ShaderMaterial({
  glslVersion:THREE.GLSL3,

  uniforms:{
   densityTex:{value:texture},
   cameraLocal:{value:new THREE.Vector3()},
   boxSize:{value:new THREE.Vector3(WIDTH,HEIGHT,DEPTH)},
   lightDir:{value:new THREE.Vector3(-.5,.8,.4).normalize()},
   time:{value:0}
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
   uniform float time;

   in vec3 localPos;
   out vec4 outColor;

   float hash31(vec3 p){
    p=fract(p*.1031);
    p+=dot(p,p.yzx+33.33);
    return fract((p.x+p.y)*p.z);
   }

   float noise3(vec3 p){

    vec3 i=floor(p);
    vec3 f=fract(p);

    f=f*f*(3.-2.*f);

    float n000=hash31(i+vec3(0,0,0));
    float n100=hash31(i+vec3(1,0,0));
    float n010=hash31(i+vec3(0,1,0));
    float n110=hash31(i+vec3(1,1,0));

    float n001=hash31(i+vec3(0,0,1));
    float n101=hash31(i+vec3(1,0,1));
    float n011=hash31(i+vec3(0,1,1));
    float n111=hash31(i+vec3(1,1,1));

    float x00=mix(n000,n100,f.x);
    float x10=mix(n010,n110,f.x);
    float x01=mix(n001,n101,f.x);
    float x11=mix(n011,n111,f.x);

    return mix(
     mix(x00,x10,f.y),
     mix(x01,x11,f.y),
     f.z
    );
   }

   float fbm(vec3 p){

    float value=0.;
    float amplitude=.5;

    for(int i=0;i<4;i++){
     value+=noise3(p)*amplitude;
     p*=2.03;
     amplitude*=.5;
    }

    return value;
   }

   vec2 intersectBox(vec3 ro,vec3 rd){

    vec3 safeDir=sign(rd)*max(abs(rd),vec3(.00001));
    vec3 inv=1./safeDir;

    vec3 t0=(-boxSize*.5-ro)*inv;
    vec3 t1=(boxSize*.5-ro)*inv;

    vec3 lo=min(t0,t1);
    vec3 hi=max(t0,t1);

    return vec2(
     max(max(lo.x,lo.y),lo.z),
     min(min(hi.x,hi.y),hi.z)
    );
   }

   float rawDensity(vec3 p){

    vec3 uv=p/boxSize+.5;

    if(any(lessThan(uv,vec3(0.)))||
       any(greaterThan(uv,vec3(1.)))){
     return 0.;
    }

    return texture(densityTex,uv).r;
   }

   float densityAt(vec3 p){

    float base=rawDensity(p);

    if(base<.008) return 0.;

    vec3 q=p;

    q.xz*=.72;
    q.y*=.9;

    q+=vec3(
     time*.012,
     time*.006,
     -time*.009
    );

    float broad=fbm(q*.48);
    float medium=fbm(q*1.35+17.2);
    float fine=noise3(q*4.2+31.7);

    float turbulence=
     broad*.55+
     medium*.30+
     fine*.15;

    float erosion=
     (1.-turbulence)*.22;

    float shaped=base-erosion;

    float d=smoothstep(.045,.36,shaped);

    float billows=
     .88+.12*fbm(q*2.0+8.);

    d*=billows;

    return clamp(d,0.,1.);
   }

   float lightTransmittance(vec3 p){

    float shadow=0.;

    vec3 direction=normalize(lightDir);

    for(int i=0;i<3;i++){

     float distance= float(i+1)*.34;

     shadow+=densityAt(
      p+direction*distance
     )*.22;
    }

    return exp(-shadow*2.2);
   }

   void main(){

    vec3 rd=normalize(localPos-cameraLocal);

    vec2 hit=intersectBox(cameraLocal,rd);

    float start=max(hit.x,0.);
    float finish=hit.y;

    if(finish<=start) discard;

    float distance=finish-start;

    float stepSize=max(distance/170.,.025);

    vec3 color=vec3(0.);
    float alpha=0.;

    for(float t=start;t<finish;t+=stepSize){

     vec3 p=cameraLocal+rd*t;

     float d=densityAt(p);

     if(d>.015){

      float h=clamp(p.y/boxSize.y+.5,0.,1.);

      float shadow=lightTransmittance(p);

      float sunFacing=max(dot(rd,lightDir),0.);

      float phase=
       .72+
       .28*pow(sunFacing,2.);

      float underside=
       smoothstep(.55,.08,h);

      vec3 baseColor=mix(
       vec3(.20,.23,.29),
       vec3(.76,.82,.90),
       smoothstep(.08,.82,h)
      );

      vec3 sunColor=vec3(1.0,.96,.89);

      float illumination=
       (.30+.70*shadow)*phase;

      vec3 cloudColor=
       baseColor*illumination;

      cloudColor=mix(
       cloudColor,
       sunColor,
       clamp(shadow*.18,0.,.18)
      );

      cloudColor*=1.-underside*.20;

      float a=1.-exp(-d*stepSize*.34);

      color+=(1.-alpha)*cloudColor*a;
      alpha+=(1.-alpha)*a;

      if(alpha>.985) break;
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

  material.uniforms.time.value=now*.001;

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
