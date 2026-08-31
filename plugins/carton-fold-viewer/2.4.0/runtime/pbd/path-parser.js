const SVG_TOKEN_RE = /[A-Za-z]|[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

function lerp2(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; }

function cubic2(p0,p1,p2,p3,t){ const u=1-t; return [u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]]; }

function quad2(p0,p1,p2,t){ const u=1-t; return [u*u*p0[0]+2*u*t*p1[0]+t*t*p2[0],u*u*p0[1]+2*u*t*p1[1]+t*t*p2[1]]; }

function svgArcPoints(p0, rx, ry, phiDeg, large, sweep, p1, maxStepDeg=7.5) {
  let [x1,y1]=p0, [x2,y2]=p1; rx=Math.abs(+rx); ry=Math.abs(+ry);
  const phi=((+phiDeg)%360)*Math.PI/180;
  if(rx<1e-12 || ry<1e-12 || (Math.abs(x1-x2)<1e-12 && Math.abs(y1-y2)<1e-12)) return [p1];
  const cp=Math.cos(phi), sp=Math.sin(phi), dx=(x1-x2)/2, dy=(y1-y2)/2;
  const x1p=cp*dx+sp*dy, y1p=-sp*dx+cp*dy;
  const lam=(x1p*x1p)/(rx*rx)+(y1p*y1p)/(ry*ry);
  if(lam>1){ const k=Math.sqrt(lam); rx*=k; ry*=k; }
  const sign=(!!large===!!sweep)?-1:1;
  const num=Math.max(0, rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p);
  const den=Math.max(1e-30, rx*rx*y1p*y1p+ry*ry*x1p*x1p);
  const coef=sign*Math.sqrt(num/den);
  const cxp=coef*(rx*y1p/ry), cyp=coef*(-ry*x1p/rx);
  const cx=cp*cxp-sp*cyp+(x1+x2)/2, cy=sp*cxp+cp*cyp+(y1+y2)/2;
  const ux=(x1p-cxp)/rx, uy=(y1p-cyp)/ry, vx=(-x1p-cxp)/rx, vy=(-y1p-cyp)/ry;
  const th1=Math.atan2(uy,ux);
  let dth=Math.atan2(ux*vy-uy*vx, ux*vx+uy*vy);
  if(!sweep && dth>0) dth-=2*Math.PI; if(sweep && dth<0) dth+=2*Math.PI;
  const n=Math.max(2, Math.ceil(Math.abs(dth*180/Math.PI)/maxStepDeg)), pts=[];
  for(let j=1;j<=n;j++){
    const t=th1+dth*j/n;
    pts.push([cx+cp*rx*Math.cos(t)-sp*ry*Math.sin(t), cy+sp*rx*Math.cos(t)+cp*ry*Math.sin(t)]);
  }
  pts[pts.length-1]=p1; return pts;
}
export function parseSvgPathD(d, curveSteps=12) {
  const tok=d.match(SVG_TOKEN_RE)||[]; let i=0, cmd=null, cur=[0,0], start=null, pts=[], lastCtrl=null;
  const num=()=>+tok[i++];
  const emit=p=>{ cur=[p[0],p[1]]; pts.push([...cur]); };
  while(i<tok.length){
    if(/^[A-Za-z]$/.test(tok[i])) cmd=tok[i++];
    if(!cmd) break;
    const rel=cmd===cmd.toLowerCase(), C=cmd.toUpperCase();
    const point=()=>{ const x=num(),y=num(); return rel?[cur[0]+x,cur[1]+y]:[x,y]; };
    if(C==='M'){
      emit(point()); start=[...cur]; cmd=rel?'l':'L'; lastCtrl=null;
    } else if(C==='L'){
      emit(point()); lastCtrl=null;
    } else if(C==='H'){
      const x=num(); emit([rel?cur[0]+x:x,cur[1]]); lastCtrl=null;
    } else if(C==='V'){
      const y=num(); emit([cur[0],rel?cur[1]+y:y]); lastCtrl=null;
    } else if(C==='C'){
      const p0=[...cur], p1=point(), p2=point(), p3=point();
      for(let s=1;s<=curveSteps;s++) pts.push(cubic2(p0,p1,p2,p3,s/curveSteps));
      cur=[...p3]; lastCtrl=[...p2];
    } else if(C==='S'){
      const p0=[...cur], p1=lastCtrl?[2*cur[0]-lastCtrl[0],2*cur[1]-lastCtrl[1]]:[...cur], p2=point(), p3=point();
      for(let s=1;s<=curveSteps;s++) pts.push(cubic2(p0,p1,p2,p3,s/curveSteps));
      cur=[...p3]; lastCtrl=[...p2];
    } else if(C==='Q'){
      const p0=[...cur], p1=point(), p2=point();
      for(let s=1;s<=curveSteps;s++) pts.push(quad2(p0,p1,p2,s/curveSteps));
      cur=[...p2]; lastCtrl=[...p1];
    } else if(C==='T'){
      const p0=[...cur], p1=lastCtrl?[2*cur[0]-lastCtrl[0],2*cur[1]-lastCtrl[1]]:[...cur], p2=point();
      for(let s=1;s<=curveSteps;s++) pts.push(quad2(p0,p1,p2,s/curveSteps));
      cur=[...p2]; lastCtrl=[...p1];
    } else if(C==='A'){
      const rx=num(),ry=num(),phi=num(),large=num(),sweep=num(),p1=point();
      pts.push(...svgArcPoints(cur,rx,ry,phi,large,sweep,p1)); cur=[...p1]; lastCtrl=null;
    } else if(C==='Z'){
      if(start && Math.hypot(cur[0]-start[0],cur[1]-start[1])>1e-9) pts.push([...start]);
      cur=start?[...start]:cur; cmd=null; lastCtrl=null;
    } else throw new Error(`Unsupported SVG path command: ${cmd}`);
  }
  if(pts.length>1 && Math.hypot(pts[0][0]-pts.at(-1)[0],pts[0][1]-pts.at(-1)[1])<1e-8) pts.pop();
  return pts;
}

export function svgXY(p){ return [+p[0], -p[1]]; }

export function safeNodeName(id){ return 'Panel__'+String(id).replace(/[^A-Za-z0-9_-]+/g,'_'); }

export function polyCentroid(poly){
  if(!poly || !poly.length) return [0, 0];
  let a = 0, cx = 0, cy = 0;
  for(let i = 0; i < poly.length; i++){
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  a *= 0.5;
  if(Math.abs(a) < 1e-9){
    let x = 0, y = 0;
    for(const p of poly){ x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}


export function lineInfo(points){
  if(points.length<2) throw new Error('Fold geometry has fewer than 2 points');
  const a=[...points[0]], b=[...points.at(-1)], dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  if(len<1e-9) throw new Error('Fold geometry has zero length');
  return {a,b,axis:[dx/len,dy/len,0],length:len};
}

export function requireFinite(v,label){ const n=Number(v); if(!Number.isFinite(n)) throw new Error(`Missing/invalid ${label}`); return n; }
