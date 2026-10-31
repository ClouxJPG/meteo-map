
export const NX=28, NY=20, NZ=28;
export const N=NX*NY*NZ;

export const DX=500, DY=400, DZ=500;

export const WIDTH=NX*DX/1000;
export const HEIGHT=NY*DY/1000;
export const DEPTH=NZ*DZ/1000;

const idx=(x,y,z)=>x+NX*(y+NY*z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const G=9.81;
const CP=1004;
const LV=2.5e6;
const LF=3.34e5;
const RHO0=1.15;

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

 const fields={
  u:new Float32Array(N),
  v:new Float32Array(N),
  w:new Float32Array(N),
  temp:new Float32Array(N),
  qv:new Float32Array(N),
  qc:new Float32Array(N),
  qi:new Float32Array(N),
  qr:new Float32Array(N),
  qs:new Float32Array(N),
  pressure:new Float32Array(N)
 };

 const next={};

 for(const key of Object.keys(fields)){
  next[key]=new Float32Array(N);
 }

 const diagnostics={
  updraft:0,
  downdraft:0,
  cloud:0,
  ice:0,
  temp:0,
  time:0,
  maxVorticity:0,
  cloudTop:0
 };

 function sample(a,x,y,z){

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

  const a0=a[idx(x0,y0,z0)]*(1-fx)+a[idx(x1,y0,z0)]*fx;
  const a1=a[idx(x0,y1,z0)]*(1-fx)+a[idx(x1,y1,z0)]*fx;
  const b0=a[idx(x0,y0,z1)]*(1-fx)+a[idx(x1,y0,z1)]*fx;
  const b1=a[idx(x0,y1,z1)]*(1-fx)+a[idx(x1,y1,z1)]*fx;

  return (a0*(1-fy)+a1*fy)*(1-fz)
       +(b0*(1-fy)+b1*fy)*fz;
 }

 /* ENVIRONMENT */

 function initialize(){

  for(const key of Object.keys(fields)){
   fields[key].fill(0);
  }

  diagnostics.updraft=0;
  diagnostics.downdraft=0;
  diagnostics.cloud=0;
  diagnostics.ice=0;
  diagnostics.temp=0;
  diagnostics.time=0;
  diagnostics.maxVorticity=0;
  diagnostics.cloudTop=0;

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

     fields.temp[i]=T;
     fields.qv[i]=vapor;

     fields.u[i]=wind+shear*h/(HEIGHT*1000);
     fields.v[i]=0;
     fields.w[i]=0;
    }
   }
  }

  const thermals=[
   {x:-7,z:-5,r:3.0,t:1.8},
   {x:5,z:4,r:3.5,t:1.5},
   {x:1,z:-9,r:2.8,t:1.1},
   {x:-9,z:8,r:2.5,t:.9}
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
     const i=idx(x,y,z);
     fields.temp[i]+=perturbation*Math.exp(-y*.65);
    }
   }
  }
 }

 /* SEMI-LAGRANGIAN TRANSPORT */

 function advect(dt){

  for(const key of Object.keys(fields)){
   next[key].set(fields[key]);
  }

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     const bx=x-fields.u[i]*dt/DX;
     const by=y-fields.w[i]*dt/DY;
     const bz=z-fields.v[i]*dt/DZ;

     for(const key of [
      "temp","qv","qc","qi","qr","qs",
      "u","v","w"
     ]){
      next[key][i]=sample(fields[key],bx,by,bz);
     }
    }
   }
  }

  for(const key of Object.keys(fields)){
   fields[key].set(next[key]);
  }
 }

 /* PRESSURE PROJECTION */

 function project(dt){

  const p=fields.pressure;
  const div=next.pressure;

  p.fill(0);
  div.fill(0);

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     div[i]=
      (fields.u[idx(x+1,y,z)]-fields.u[idx(x-1,y,z)])/(2*DX)+
      (fields.w[idx(x,y+1,z)]-fields.w[idx(x,y-1,z)])/(2*DY)+
      (fields.v[idx(x,y,z+1)]-fields.v[idx(x,y,z-1)])/(2*DZ);
    }
   }
  }

  const ax=1/(DX*DX);
  const ay=1/(DY*DY);
  const az=1/(DZ*DZ);
  const denom=2*(ax+ay+az);

  for(let iteration=0;iteration<12;iteration++){

   next.pressure.set(p);

   for(let z=1;z<NZ-1;z++){
    for(let y=1;y<NY-1;y++){
     for(let x=1;x<NX-1;x++){

      const i=idx(x,y,z);

      const neighbors=
       (p[idx(x-1,y,z)]+p[idx(x+1,y,z)])*ax+
       (p[idx(x,y-1,z)]+p[idx(x,y+1,z)])*ay+
       (p[idx(x,y,z-1)]+p[idx(x,y,z+1)])*az;

      next.pressure[i]=
       (neighbors-RHO0*div[i]/Math.max(dt,.001))/denom;
     }
    }
   }

   p.set(next.pressure);
  }

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     fields.u[i]-=dt*(p[idx(x+1,y,z)]-p[idx(x-1,y,z)])/(2*DX*RHO0);
     fields.w[i]-=dt*(p[idx(x,y+1,z)]-p[idx(x,y-1,z)])/(2*DY*RHO0);
     fields.v[i]-=dt*(p[idx(x,y,z+1)]-p[idx(x,y,z-1)])/(2*DZ*RHO0);
    }
   }
  }
 }

 /* TURBULENT MIXING */

 function diffuse(dt){

  const coefficients={
   temp:.012,
   qv:.009,
   qc:.006,
   qi:.006,
   qr:.004,
   qs:.004,
   u:.018,
   v:.018,
   w:.018
  };

  for(const key of Object.keys(coefficients)){

   const arr=fields[key];
   const out=next[key];
   const amount=coefficients[key]*dt;

   out.set(arr);

   for(let z=1;z<NZ-1;z++){
    for(let y=1;y<NY-1;y++){
     for(let x=1;x<NX-1;x++){

      const i=idx(x,y,z);

      const neighbors=(
       arr[idx(x-1,y,z)]+arr[idx(x+1,y,z)]+
       arr[idx(x,y-1,z)]+arr[idx(x,y+1,z)]+
       arr[idx(x,y,z-1)]+arr[idx(x,y,z+1)]
      )/6;

      out[i]=arr[i]+(neighbors-arr[i])*amount;
     }
    }
   }

   arr.set(out);
  }
 }

 /* THERMODYNAMICS AND CLOUD MICROPHYSICS */

 function thermodynamics(dt){

  const heat=Number(settings.heat())/100;
  const wind=Number(settings.wind());
  const shear=Number(settings.shear());

  diagnostics.updraft=0;
  diagnostics.downdraft=0;
  diagnostics.cloud=0;
  diagnostics.ice=0;
  diagnostics.temp=-100;
  diagnostics.cloudTop=0;

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){

    const h=y*DY;
    const env=envTemp(h);
    const p=pressureAt(h);

    for(let x=1;x<NX-1;x++){

     const i=idx(x,y,z);

     const vapor=fields.qv[i]/1000;
     const condensate=(
      fields.qc[i]+fields.qi[i]+
      fields.qr[i]+fields.qs[i]
     )/1000;

     const virtualT=
      fields.temp[i]*(1+.61*vapor-condensate);

     const buoyancy=G*(virtualT-env)/env;

     fields.w[i]=clamp(
      fields.w[i]+buoyancy*dt-fields.w[i]*.006*dt,
      -25,
      55
     );

     fields.temp[i]-=.0098*fields.w[i]*dt;

     if(y<3){
      fields.temp[i]+=
       heat*.045*Math.exp(-y*.8)*dt;
     }

     const targetWind=
      wind+shear*h/(HEIGHT*1000);

     fields.u[i]+=(targetWind-fields.u[i])*.012*dt;

     const saturation=qsat(fields.temp[i],p);
     const excess=fields.qv[i]-saturation;

     if(excess>0){

      const cond=Math.min(
       excess,
       excess*(.20*dt)
      );

      fields.qv[i]-=cond;
      fields.qc[i]+=cond;

      fields.temp[i]+=cond*LV/(CP*1000);

     }else if(excess<0 && fields.qc[i]>0){

      const evap=Math.min(
       fields.qc[i],
       -excess*.045*dt
      );

      fields.qc[i]-=evap;
      fields.qv[i]+=evap;

      fields.temp[i]-=evap*LV/(CP*1000);
     }

     if(fields.temp[i]<268.15 && fields.qc[i]>.01){

      const freezing=Math.min(
       fields.qc[i],
       fields.qc[i]*.025*dt
      );

      fields.qc[i]-=freezing;
      fields.qi[i]+=freezing;

      fields.temp[i]+=freezing*LF/(CP*1000);
     }

     if(fields.temp[i]>268.15 && fields.qi[i]>.01){

      const melting=Math.min(
       fields.qi[i],
       fields.qi[i]*.012*dt
      );

      fields.qi[i]-=melting;
      fields.qc[i]+=melting;

      fields.temp[i]-=melting*LF/(CP*1000);
     }

     if(fields.qc[i]>1.2){

      const conversion=Math.min(
       fields.qc[i],
       (fields.qc[i]-1.2)*.008*dt
      );

      fields.qc[i]-=conversion;
      fields.qr[i]+=conversion;
     }

     if(fields.qi[i]>.5){

      const aggregation=Math.min(
       fields.qi[i],
       (fields.qi[i]-.5)*.004*dt
      );

      fields.qi[i]-=aggregation;
      fields.qs[i]+=aggregation;
     }

     if(fields.qr[i]>.01 && fields.qv[i]<saturation){

      const evaporation=Math.min(
       fields.qr[i],
       (saturation-fields.qv[i])*.006*dt
      );

      fields.qr[i]-=evaporation;
      fields.qv[i]+=evaporation;

      fields.temp[i]-=evaporation*LV/(CP*1000);
     }

     const rainFall=Math.min(
      fields.qr[i],
      fields.qr[i]*.025*dt
     );

     const snowFall=Math.min(
      fields.qs[i],
      fields.qs[i]*.012*dt
     );

     fields.qr[i]-=rainFall;
     fields.qs[i]-=snowFall;

     if(y>1){
      fields.qr[idx(x,y-1,z)]+=rainFall*.9;
      fields.qs[idx(x,y-1,z)]+=snowFall*.9;
     }

     fields.qv[i]=clamp(fields.qv[i],0,35);
     fields.qc[i]=clamp(fields.qc[i],0,15);
     fields.qi[i]=clamp(fields.qi[i],0,15);
     fields.qr[i]=clamp(fields.qr[i],0,20);
     fields.qs[i]=clamp(fields.qs[i],0,20);

     fields.temp[i]=clamp(fields.temp[i],180,330);

     diagnostics.updraft=Math.max(
      diagnostics.updraft,
      fields.w[i]
     );

     diagnostics.downdraft=Math.min(
      diagnostics.downdraft,
      fields.w[i]
     );

     diagnostics.cloud=Math.max(
      diagnostics.cloud,
      fields.qc[i]
     );

     diagnostics.ice=Math.max(
      diagnostics.ice,
      fields.qi[i]
     );

     diagnostics.temp=Math.max(
      diagnostics.temp,
      fields.temp[i]-273.15
     );

     if(fields.qc[i]+fields.qi[i]>.08){
      diagnostics.cloudTop=Math.max(
       diagnostics.cloudTop,
       h
      );
     }
    }
   }
  }
 }

 /* VORTICITY DIAGNOSTIC */

 function calculateVorticity(){

  let maximum=0;

  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){

     const dvdx=(
      fields.v[idx(x+1,y,z)]-
      fields.v[idx(x-1,y,z)]
     )/(2*DX);

     const dudy=(
      fields.u[idx(x,y+1,z)]-
      fields.u[idx(x,y-1,z)]
     )/(2*DY);

     const dvdz=(
      fields.v[idx(x,y,z+1)]-
      fields.v[idx(x,y,z-1)]
     )/(2*DZ);

     const dudz=(
      fields.u[idx(x,y,z+1)]-
      fields.u[idx(x,y,z-1)]
     )/(2*DZ);

     const dwdx=(
      fields.w[idx(x+1,y,z)]-
      fields.w[idx(x-1,y,z)]
     )/(2*DX);

     const dwdz=(
      fields.w[idx(x,y,z+1)]-
      fields.w[idx(x,y,z-1)]
     )/(2*DZ);

     const ox=dwdz-dvdx;
     const oy=dudz-dwdx;
     const oz=dudy-dvdz;

     const magnitude=Math.sqrt(
      ox*ox+oy*oy+oz*oz
     );

     maximum=Math.max(maximum,magnitude);
    }
   }
  }

  diagnostics.maxVorticity=maximum;
 }

 /* BOUNDARIES */

 function boundaries(){

  for(let z=0;z<NZ;z++){
   for(let x=0;x<NX;x++){

    const bottom=idx(x,0,z);
    const top=idx(x,NY-1,z);

    fields.w[bottom]=0;
    fields.w[top]=0;

    fields.qc[top]=0;
    fields.qi[top]=0;
    fields.qr[top]=0;
    fields.qs[top]=0;
   }
  }

  for(let y=0;y<NY;y++){
   for(let z=0;z<NZ;z++){
    fields.w[idx(0,y,z)]=0;
    fields.w[idx(NX-1,y,z)]=0;
   }

   for(let x=0;x<NX;x++){
    fields.w[idx(x,y,0)]=0;
    fields.w[idx(x,y,NZ-1)]=0;
   }
  }
 }

 /* MODEL INTEGRATION */

 function step(dt=.35){

  const substeps=Math.max(1,Math.ceil(dt/.175));
  const h=dt/substeps;

  for(let s=0;s<substeps;s++){

   advect(h);
   diffuse(h);
   thermodynamics(h);
   project(h);
   boundaries();
  }

  diagnostics.time+=dt;

  calculateVorticity();
 }

 initialize();

 return {
  fields,
  diagnostics,
  initialize,
  step,
  index:idx
 };
}
