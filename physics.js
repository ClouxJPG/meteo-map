
export const NX=28, NY=20, NZ=28;
export const N=NX*NY*NZ;

export const DX=500, DY=400, DZ=500;
export const WIDTH=NX*DX/1000;
export const HEIGHT=NY*DY/1000;
export const DEPTH=NZ*DZ/1000;

const idx=(x,y,z)=>x+NX*(y+NY*z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function envTemp(h){
 return 299.15-0.0062*h;
}

export function pressureAt(h){
 return 101325*Math.exp(-h/8400);
}

export function qsat(T,p){
 const tc=T-273.15;
 const es=611.2*Math.exp(17.67*tc/(tc+243.5));
 return 0.622*es/Math.max(100,p-es)*1000;
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

 const diagnostics={updraft:0,cloud:0,temp:0,time:0};

 function initialize(){
  diagnostics.updraft=0;
  diagnostics.cloud=0;
  diagnostics.temp=0;
  diagnostics.time=0;

  const humidity=settings.moist()/100;
  const wind=settings.wind();
  const shear=settings.shear();

  for(let z=0;z<NZ;z++){
   for(let y=0;y<NY;y++){
    const h=y*DY;
    const T=envTemp(h);
    const vapor=qsat(T,pressureAt(h))*humidity;

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

  // Initial thermal perturbations in the lowest model layer.
  for(let z=0;z<NZ;z++){
   for(let x=0;x<NX;x++){
    const px=x-NX/2;
    const pz=z-NZ/2;

    const a=Math.exp(-((px+5)**2+(pz+2)**2)/11);
    const b=Math.exp(-((px-5)**2+(pz-4)**2)/14);
    const c=Math.exp(-(px*px+(pz+7)**2)/16);

    f.temp[idx(x,1,z)]+=1.1*a+.85*b+.65*c;
   }
  }
 }

 function sample(arr,x,y,z){
  x=clamp(x,0,NX-1.001);
  y=clamp(y,0,NY-1.001);
  z=clamp(z,0,NZ-1.001);

  const x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z);
  const x1=x0+1,y1=y0+1,z1=z0+1;
  const fx=x-x0,fy=y-y0,fz=z-z0;

  const a=arr[idx(x0,y0,z0)]*(1-fx)+arr[idx(x1,y0,z0)]*fx;
  const b=arr[idx(x0,y1,z0)]*(1-fx)+arr[idx(x1,y1,z0)]*fx;
  const c=arr[idx(x0,y0,z1)]*(1-fx)+arr[idx(x1,y0,z1)]*fx;
  const d=arr[idx(x0,y1,z1)]*(1-fx)+arr[idx(x1,y1,z1)]*fx;

  return (a*(1-fy)+b*fy)*(1-fz)+(c*(1-fy)+d*fy)*fz;
 }

 function advect(dt){
  for(const k of Object.keys(next)) next[k].set(f[k]);

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

  for(const k of Object.keys(f)) f[k].set(next[k]);
 }

 function thermodynamics(dt){
  const heat=settings.heat()/100;
  const wind=settings.wind();
  const shear=settings.shear();

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

     const vapor=f.qv[i]/1000;
     const condensate=(f.qc[i]+f.qr[i])/1000;
     const virtualT=f.temp[i]*(1+.61*vapor-condensate);

     const buoy=9.81*(virtualT-env)/env;

     f.w[i]=clamp((f.w[i]+buoy*dt)*.992,-12,30);
     f.temp[i]-=.0098*f.w[i]*dt;

     // Surface sensible heating.
     if(y<4){
      f.temp[i]+=heat*.022*(1-y/4)*dt;
     }

     // Weak horizontal wind relaxation and vertical shear.
     const target=wind+shear*h/(HEIGHT*1000);
     f.u[i]+=(target-f.u[i])*.002;

     // Condensation / evaporation.
     const saturation=qsat(f.temp[i],p);
     const excess=f.qv[i]-saturation;

     if(excess>0){
      const cond=Math.min(excess,excess*.14);
      f.qv[i]-=cond;
      f.qc[i]+=cond;
      f.temp[i]+=cond*.00016;
     }else if(excess<0 && f.qc[i]>0){
      const evap=Math.min(f.qc[i],-excess*.04);
      f.qc[i]-=evap;
      f.qv[i]+=evap;
      f.temp[i]-=evap*.0001;
     }

     // Cloud-water autoconversion and precipitation fallout.
     if(f.qc[i]>1.2){
      const conversion=(f.qc[i]-1.2)*.004;
      f.qc[i]-=conversion;
      f.qr[i]+=conversion;
     }

     const fall=Math.min(f.qr[i],.008);
     f.qr[i]-=fall;
     if(y>1) f.qr[idx(x,y-1,z)]+=fall*.9;

     f.qv[i]=clamp(f.qv[i],0,35);
     f.qc[i]=clamp(f.qc[i],0,10);
     f.qr[i]=clamp(f.qr[i],0,15);

     diagnostics.updraft=Math.max(diagnostics.updraft,f.w[i]);
     diagnostics.cloud=Math.max(diagnostics.cloud,f.qc[i]);
     diagnostics.temp=Math.max(diagnostics.temp,f.temp[i]-273.15);
    }
   }
  }

  // Simple momentum mixing to reduce grid-scale noise.
  for(let z=1;z<NZ-1;z++){
   for(let y=1;y<NY-1;y++){
    for(let x=1;x<NX-1;x++){
     const i=idx(x,y,z);
     const meanW=(
      f.w[idx(x-1,y,z)]+f.w[idx(x+1,y,z)]+
      f.w[idx(x,y,z-1)]+f.w[idx(x,y,z+1)]
     )*.25;
     f.w[i]=f.w[i]*.985+meanW*.015;
    }
   }
  }
 }

 function step(dt=.35){
  advect(dt);
  thermodynamics(dt);
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
