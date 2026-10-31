
export const NX=28, NY=20, NZ=28;
export const N=NX*NY*NZ;

export const DX=500, DY=400, DZ=500;

export const WIDTH=NX*DX/1000;
export const HEIGHT=NY*DY/1000;
export const DEPTH=NZ*DZ/1000;

const idx=(x,y,z)=>x+NX*(y+NY*z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const GRAVITY=9.81;
const CP=1004;
const RD=287;
const RV=461.5;
const LV=2.5e6;
const EPSILON=RD/RV;

export function envTemp(h){
 return 299.15-.0062*h;
}

export function pressureAt(h){
 return 101325*Math.exp(-h/8400);
}

export function qsat(T,p){
 const tc=T-273.15;
 const es=611.2*Math.exp(17.67*tc/(tc+243.5));
 return .622*es/Math.max(100,p-es)*1000;
}

export function createModel(settings){

 const f={
  u:new Float32Array(N),
  v:new Float32Array(N),
  w:new Float32Array(N),
  temp:new Float32Array(N),
  qv:new Float32Array(N),
  qc:new Float32Array(N),
  qr:new Float32Array(N)
 };

 const next={
  temp:new Float32Array(N),
  qv:new Float32Array(N),
  qc:new Float32Array(N),
  qr:new Float32Array(N),
  u:new Float32Array(N),
  v:new Float32Array(N),
  w:new Float32Array(N)
 };

 const diagnostics={
  updraft:0,
  cloud:0,
  temp:0,
  time:0
 };

 function sample(arr,x,y,z){

  x=clamp(x,0,NX-1.001);
  y=clamp(y,0,NY-1.001);
  z=clamp(z,0,NZ-1.001);

  const x0=Math.floor(x);
  const y0=Math.floor(y);
  const z0=Math.floor(z);

  const x1=x0+1;
  const y1=y0+1;
  const z1=z0+1;

  const fx=x-x0;
  const fy=y-y0;
  const fz=z-z0;

  const a=arr[idx(x0,y0,z0)]*(1-fx)+arr[idx(x1,y0,z0)]*fx;
  const b=arr[idx(x0,y1,z0)]*(1-fx)+arr[idx(x1,y1,z0)]*fx;
  const c=arr[idx(x0,y0,z1)]*(1-fx)+arr[idx(x1,y0,z1)]*fx;
  const d=arr[idx(x0,y1,z1)]*(1-fx)+arr[idx(x1,y1,z1)]*fx;

  return (a*(1-fy)+b*fy)*(1-fz)
       +(c*(1-fy)+d*fy)*fz;
 }

 /* INITIAL ATMOSPHERE */

 function initialize(){

  diagnostics.updraft=0;
  diagnostics.cloud=0;
  diagnostics.temp=0;
  diagnostics.time=0;

  const humidity=Number(settings.moist())/100;
  const wind=Number(settings.wind());
  const shear=Number(settings.shear());

  for(let z=0;z<NZ;z++){
   for(let y=0;y<NY;y++){

    const h=y*DY;
    const T=envTemp(h);
    const p=pressureAt(h);
    const vapor=qsat(T,p)*humidity;

    for(let x=0;x<NX;x++){

     const i=idx(x,y,z);

     f.temp[i]=T;
     f.qv[i]=vapor;
     f.qc[i]=0;
     f.qr[i]=0;

     f.u[i]=wind+shear*h/(HEIGHT*1000);
     f.v[i]=0;
     f.w[i]=0;
    }
   }
  }

  /*
   Initial surface thermals.
   Their horizontal distribution is irregular,
   rather than a single circular cloud shape.
  */

  const thermals=[
   {x:-7,z:-5,r:3.2,t:1.6},
   {x:5,z:4,r:3.8,t:1.25},
   {x:1,z:-9,r:2.8,t:.9},
   {x:-9,z:8,r:2.5,t:.75}
  ];

  for(let z=0;z<NZ;z++){
   for(let x=0;x<NX;x++){

    const px=x-NX/2;
    const pz=z-NZ/2;

    let perturbation=0;

    for(const thermal of thermals){

     const dx=px-thermal.x;
     const dz=pz-thermal.z;

     perturbation+=thermal.t*Math.exp(
      -(dx*dx+dz*dz)/(thermal.r*thermal.r)
     );
    }

    for(let y=0;y<3;y++){

     const verticalWeight=Math.exp(-y*.7);
     const i=idx(x,y,z);

     f.temp[i]+=perturbation*verticalWeight;
    }
   }
  }
 }

 /* ADVECTION */

 function advect(dt){

  for(const k of Object.keys(next)){
   next[k].set(f[k]);
  }

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     const bx=x-f.u[i]*dt/DX;
     const by=y-f.w[i]*dt/DY;
     const bz=z-f.v[i]*dt/DZ;

     next.temp[i]=sample(f.temp,bx,by,bz);
     next.qv[i]=sample(f.qv,bx,by,bz);
     next.qc[i]=sample(f.qc,bx,by,bz);
     next.qr[i]=sample(f.qr,bx,by,bz);

     next.u[i]=sample(f.u,bx,by,bz);
     next.v[i]=sample(f.v,bx,by,bz);
     next.w[i]=sample(f.w,bx,by,bz);
    }
   }
  }

  for(const k of Object.keys(f)){
   f[k].set(next[k]);
  }
 }

 /* TURBULENT MIXING */

 function diffuse(dt){

  const coefficients={
   temp:.018,
   qv:.012,
   qc:.008,
   qr:.006,
   u:.025,
   v:.025,
   w:.035
  };

  for(const k of Object.keys(f)){

   const arr=f[k];
   const out=next[k];
   const amount=coefficients[k]*dt;

   out.set(arr);

   for(let z=1;z<NZ-1;z++){
    for(let y=1;y<NY-1;y++){
     for(let x=1;x<NX-1;x++){

      const i=idx(x,y,z);

      const neighbors=(
       arr[idx(x-1,y,z)]+
       arr[idx(x+1,y,z)]+
       arr[idx(x,y-1,z)]+
       arr[idx(x,y+1,z)]+
       arr[idx(x,y,z-1)]+
       arr[idx(x,y,z+1)]
      )/6;

      out[i]=arr[i]+(neighbors-arr[i])*amount;
     }
    }
   }

   arr.set(out);
  }
 }

 /* THERMODYNAMICS AND BUOYANCY */

 function thermodynamics(dt){

  const heat=Number(settings.heat())/100;
  const wind=Number(settings.wind());
  const shear=Number(settings.shear());

  diagnostics.updraft=0;
  diagnostics.cloud=0;
  diagnostics.temp=-100;

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){

    const h=y*DY;
    const env=envTemp(h);
    const p=pressureAt(h);

    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     /* Moist-air virtual temperature */

     const vapor=f.qv[i]/1000;
     const condensate=(f.qc[i]+f.qr[i])/1000;

     const virtualT=
      f.temp[i]*(1+.61*vapor-condensate);

     /* Buoyancy */

     const buoyancy=
      GRAVITY*(virtualT-env)/env;

     /*
      Vertical momentum.
      Drag and mixing limit numerical acceleration.
     */

     f.w[i]=clamp(
      f.w[i]+buoyancy*dt-f.w[i]*.012*dt,
      -18,
      45
     );

     /* Adiabatic cooling in rising air */

     f.temp[i]-=.0098*f.w[i]*dt;

     /* Surface sensible heat flux */

     if(y<3){

      const surfaceWeight=Math.exp(-y*.85);

      f.temp[i]+=
       heat*.035*surfaceWeight*dt;
     }

     /* Wind profile and vertical shear */

     const targetWind=
      wind+shear*h/(HEIGHT*1000);

     f.u[i]+=(targetWind-f.u[i])*.018*dt;

     /* Moisture condensation */

     const saturation=qsat(f.temp[i],p);
     const excess=f.qv[i]-saturation;

     if(excess>0){

      const condensationRate=
       Math.min(excess,excess*(.12*dt));

      f.qv[i]-=condensationRate;
      f.qc[i]+=condensationRate;

      /* Latent heat release */

      f.temp[i]+=
       condensationRate*LV/(CP*1000);

     }else if(excess<0 && f.qc[i]>0){

      const evaporation=Math.min(
       f.qc[i],
       -excess*.035*dt
      );

      f.qc[i]-=evaporation;
      f.qv[i]+=evaporation;

      f.temp[i]-=
       evaporation*LV/(CP*1000);
     }

     /* Cloud water to rain water */

     if(f.qc[i]>1.5){

      const conversion=Math.min(
       f.qc[i],
       (f.qc[i]-1.5)*.012*dt
      );

      f.qc[i]-=conversion;
      f.qr[i]+=conversion;
     }

     /* Precipitation fallout */

     const fall=Math.min(
      f.qr[i],
      f.qr[i]*.018*dt
     );

     f.qr[i]-=fall;

     if(y>1){
      f.qr[idx(x,y-1,z)]+=fall*.85;
     }

     /* Numerical limits */

     f.qv[i]=clamp(f.qv[i],0,35);
     f.qc[i]=clamp(f.qc[i],0,15);
     f.qr[i]=clamp(f.qr[i],0,25);

     f.temp[i]=clamp(f.temp[i],180,330);

     /* Diagnostics */

     diagnostics.updraft=Math.max(
      diagnostics.updraft,
      f.w[i]
     );

     diagnostics.cloud=Math.max(
      diagnostics.cloud,
      f.qc[i]
     );

     diagnostics.temp=Math.max(
      diagnostics.temp,
      f.temp[i]-273.15
     );
    }
   }
  }
 }

 /* BOUNDARY CONDITIONS */

 function boundaries(){

  for(let z=0;z<NZ;z++){
   for(let x=0;x<NX;x++){

    for(const y of [0,NY-1]){

     const i=idx(x,y,z);

     f.w[i]=0;

     f.qc[i]=0;
     f.qr[i]=0;

     if(y===NY-1){
      f.qv[i]=Math.min(f.qv[i],5);
     }
    }
   }
  }

  for(let y=0;y<NY;y++){
   for(let z=0;z<NZ;z++){

    f.w[idx(0,y,z)]=0;
    f.w[idx(NX-1,y,z)]=0;
   }

   for(let x=0;x<NX;x++){

    f.w[idx(x,y,0)]=0;
    f.w[idx(x,y,NZ-1)]=0;
   }
  }
 }

 /* MODEL STEP */

 function step(dt=.35){

  /*
   Split the model step into smaller increments
   for improved numerical stability.
  */

  const substeps=Math.max(1,Math.ceil(dt/.175));
  const h=dt/substeps;

  for(let s=0;s<substeps;s++){

   advect(h);
   diffuse(h);
   thermodynamics(h);
   boundaries();
  }

  diagnostics.time+=dt;
 }

 initialize();

 return {
  fields:f,
  diagnostics,
  initialize,
  step,
  index:idx
 };
}
