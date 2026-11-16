(() => {
'use strict';
const $ = id => document.getElementById(id);
const stage = $('game-stage');
const stageWidth = () => Math.max(1, stage.clientWidth);
const stageHeight = () => Math.max(1, stage.clientHeight);
const R=new THREE.WebGLRenderer({antialias:true,alpha:false});
R.setPixelRatio(Math.min(devicePixelRatio||1,2));
R.setSize(stageWidth(),stageHeight());
R.domElement.className='swell-canvas';
R.domElement.setAttribute('aria-label','Swell 3D game canvas');
R.domElement.style.width='100%';R.domElement.style.height='100%';
stage.prepend(R.domElement);
const S=new THREE.Scene();S.background=new THREE.Color(0x28456e);S.fog=new THREE.Fog(0x28456e,30,60);
const C=new THREE.PerspectiveCamera(60,stageWidth()/stageHeight(),.1,300);
S.add(new THREE.HemisphereLight(0xaed6ff,0x0b2a55,.8));
const sun=new THREE.DirectionalLight(0xffe2b8,1.4);sun.position.set(-25,14,-30);S.add(sun);
// stars
{const g=new THREE.BufferGeometry(),a=[];for(let i=0;i<500;i++){const r=180,u=Math.random()*6.28,v=Math.random()*1.2+.1;a.push(Math.cos(u)*Math.cos(v)*r,Math.sin(v)*r,Math.sin(u)*Math.cos(v)*r)}
g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));window.stars=new THREE.Points(g,new THREE.PointsMaterial({color:0xe8f4ef,size:.5,fog:false}));S.add(window.stars)}

const N=71,G=1.6,H=(N-1)/2,LIM=H*G-1;
let base=1.6,surge=0;
const amp=()=>base*(1+surge);
const h=(x,z,t)=>amp()*(.6*Math.sin(.28*x+1.1*t)+.5*Math.sin(.23*z-.8*t+1)+.4*Math.sin(.2*(x+z)+.6*t));
const pg0=new THREE.PlaneGeometry((N-1)*G,(N-1)*G,N-1,N-1);pg0.rotateX(-Math.PI/2);pg0.setAttribute('color',new THREE.BufferAttribute(new Float32Array(N*N*3),3));
const mesh=new THREE.Mesh(pg0,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.22,metalness:.1}));mesh.frustumCulled=false;S.add(mesh);
const lo=new THREE.Color(0x06284a),mi=new THREE.Color(0x0f7c8f),hi=new THREE.Color(0x6fd0c8),fo=new THREE.Color(0xf2fbff),col=new THREE.Color(),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v3=new THREE.Vector3(),sc=new THREE.Vector3();
function grid2(t,cx,cz){const A=amp()*1.5,ox=Math.round(cx/G)*G,oz=Math.round(cz/G)*G,pa=pg0.attributes.position,ca=pg0.attributes.color;
 mesh.position.set(ox,0,oz);let i=0;
 for(let b=0;b<N;b++)for(let a=0;a<N;a++){const lx=(a-H)*G,lz=(b-H)*G,y=h(ox+lx,oz+lz,t);pa.setXYZ(i,lx,y,lz);
  const k=THREE.MathUtils.clamp((y/A+1)/2,0,1);
  if(k<.55)col.copy(lo).lerp(mi,k/.55);else if(k<.88)col.copy(mi).lerp(hi,(k-.55)/.33);else col.copy(hi).lerp(fo,(k-.88)/.12);
  ca.setXYZ(i,col.r,col.g,col.b);i++}
 pa.needsUpdate=true;ca.needsUpdate=true;pg0.computeVertexNormals()}
const P=new THREE.Group();S.add(P);P.scale.setScalar(1.3);let hd=0;
const wood=new THREE.MeshStandardMaterial({color:0x8a5a34,roughness:.8}),cloth=new THREE.MeshStandardMaterial({color:0xf6efe0,roughness:.9,side:THREE.DoubleSide});
const hull=new THREE.Mesh(new THREE.BoxGeometry(1.3,.6,2.6),wood);hull.position.y=.05;
const bg=new THREE.ConeGeometry(.92,1.3,4);bg.rotateY(Math.PI/4);bg.rotateX(-Math.PI/2);const bow=new THREE.Mesh(bg,wood);bow.position.set(0,.05,-1.95);bow.scale.set(1,.46,1);
const mast=new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,3.2,8),wood);mast.position.set(0,1.9,0);
const sail=new THREE.Mesh(new THREE.PlaneGeometry(1.7,2.2),cloth);sail.position.set(0,2.0,-.05);
const flag=new THREE.Mesh(new THREE.PlaneGeometry(.55,.3),new THREE.MeshBasicMaterial({color:0xff6b8a,side:THREE.DoubleSide}));flag.position.set(.3,3.35,0);
P.add(hull,bow,mast,sail,flag);
const X=new THREE.Mesh(new THREE.OctahedronGeometry(.7),new THREE.MeshLambertMaterial({color:0xffc857,emissive:0xffa000,emissiveIntensity:.9}));S.add(X);
const beam=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,60,6),new THREE.MeshBasicMaterial({color:0xffc857,transparent:true,opacity:.35}));S.add(beam);
let teal=false,spawned=0;
function spawn(){spawned++;teal=spawned%5===0;
 const c=teal?0x2ec4b6:0xffc857;X.material.color.setHex(c);X.material.emissive.setHex(teal?0x00a896:0xffa000);beam.material.color.setHex(c);
 const a=Math.random()*6.283,r=14+Math.random()*30,c0=P.position;
 X.position.set(c0.x+Math.cos(a)*r,2+Math.random()*2.5,c0.z+Math.sin(a)*r);beam.position.set(X.position.x,X.position.y,X.position.z)}

// particles
const PN=400,pp=new Float32Array(PN*3),pv=new Float32Array(PN*3),pl=new Float32Array(PN),pc=new Float32Array(PN*3);let pi=0;
const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(pp,3));pg.setAttribute('color',new THREE.BufferAttribute(pc,3));
const pts=new THREE.Points(pg,new THREE.PointsMaterial({size:.35,vertexColors:true,transparent:true,opacity:.9,depthWrite:false}));pts.frustumCulled=false;S.add(pts);
for(let i=0;i<PN;i++)pp[i*3+1]=-99;
function emit(p,hex,n,sp){const c=new THREE.Color(hex);for(let k=0;k<n;k++){const i=pi++%PN;pp.set([p.x,p.y,p.z],i*3);pv.set([(Math.random()-.5)*sp,(Math.random()-.3)*sp,(Math.random()-.5)*sp],i*3);pl[i]=.7+Math.random()*.5;pc.set([c.r,c.g,c.b],i*3)}}
function parts(dt){for(let i=0;i<PN;i++){if(pl[i]>0){pl[i]-=dt;pv[i*3+1]-=9*dt;for(let a=0;a<3;a++)pp[i*3+a]+=pv[i*3+a]*dt;if(pl[i]<=0)pp[i*3+1]=-99}}pg.attributes.position.needsUpdate=true;pg.attributes.color.needsUpdate=true}

// audio
let AC;function beep(f,d=.12,ty='sine',v=.15){if(!AC)return;try{const o=AC.createOscillator(),g=AC.createGain();o.type=ty;o.frequency.value=f;g.gain.setValueAtTime(v,AC.currentTime);g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+d);o.connect(g).connect(AC.destination);o.start();o.stop(AC.currentTime+d)}catch(e){}}

// Input stays scoped to the embedded game area, not the S-Client controls.
const K={};
function gameIsVisible(){return !$('game-view').classList.contains('hidden')}
window.addEventListener('keydown',e=>{
 const tag=e.target&&e.target.tagName?e.target.tagName.toLowerCase():'';
 if(['input','textarea','select'].includes(tag)||e.target?.isContentEditable)return;
 if(!gameIsVisible())return;
 K[e.code]=1;
 if(e.code==='Space'||e.code==='ShiftLeft')e.preventDefault();
});
window.addEventListener('keyup',e=>{K[e.code]=0});
let yaw=0,pitch=.55,drag=false,jx=0,jz=0,tj=null,tl=null,tlx=0,tly=0,tsx=0,tsy=0;
const look=(dx,dy)=>{yaw-=dx*.006;pitch=THREE.MathUtils.clamp(pitch+dy*.005,.05,1.4)};
let lx=0,ly=0;
window.addEventListener('mousemove',e=>{
 const lk=document.pointerLockElement===R.domElement;
 const dx=lk?e.movementX:e.clientX-lx,dy=lk?e.movementY:e.clientY-ly;
 lx=e.clientX;ly=e.clientY;
 if(gameIsVisible()&&(lk||(e.buttons&1&&stage.contains(e.target))))look(dx,dy);
});
R.domElement.addEventListener('click',()=>{
 if(!run||!gameIsVisible())return;
 try{if(document.pointerLockElement!==R.domElement)R.domElement.requestPointerLock()}catch(e){}
});
stage.addEventListener('pointerdown',e=>{
 if(!gameIsVisible()||e.target.closest('button,#card,#shop,#jb,#db'))return;
 if(e.pointerType==='mouse'){drag=true;return;}
 const rect=stage.getBoundingClientRect(),localX=e.clientX-rect.left;
 try{stage.setPointerCapture(e.pointerId)}catch(_){}
 if(localX<rect.width/2&&tj===null){tj=e.pointerId;tsx=e.clientX;tsy=e.clientY;}
 else if(localX>=rect.width/2&&tl===null){tl=e.pointerId;tlx=e.clientX;tly=e.clientY;}
});
window.addEventListener('pointerup',e=>{
 drag=false;
 if(e.pointerId===tj){tj=null;jx=jz=0;}
 if(e.pointerId===tl)tl=null;
 if(e.pointerType!=='mouse'){K.Space=0;K.ShiftLeft=0;}
});
window.addEventListener('pointercancel',e=>{
 if(e.pointerId===tj){tj=null;jx=jz=0;}
 if(e.pointerId===tl)tl=null;
});
stage.addEventListener('pointermove',e=>{
 if(e.pointerId===tl){look(e.clientX-tlx,e.clientY-tly);tlx=e.clientX;tly=e.clientY;}
 if(e.pointerId===tj){jx=THREE.MathUtils.clamp((e.clientX-tsx)/50,-1,1);jz=THREE.MathUtils.clamp((e.clientY-tsy)/50,-1,1);}
});
const jb=$('jb'),db=$('db');
jb.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();K.Space=1;});
db.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();K.ShiftLeft=1;});
jb.addEventListener('pointerup',()=>K.Space=0);jb.addEventListener('pointercancel',()=>K.Space=0);
db.addEventListener('pointerup',()=>K.ShiftLeft=0);db.addEventListener('pointercancel',()=>K.ShiftLeft=0);
function resizeGame(){
 const w=stage.clientWidth,h=stage.clientHeight;
 if(w<1||h<1)return;
 R.setSize(w,h,false);R.domElement.style.width='100%';R.domElement.style.height='100%';C.aspect=w/h;C.updateProjectionMatrix();
}
if('ResizeObserver' in window){new ResizeObserver(resizeGame).observe(stage);}
window.addEventListener('resize',resizeGame);

const SKINS=[{n:'Sloop',p:0,hull:0x8a5a34,sail:0xf6efe0,flag:0xff6b8a},{n:'Galleon',p:30,hull:0xc4455f,sail:0xffe3d9,flag:0xffc857},{n:'Catamaran',p:60,hull:0x1b2540,sail:0x8fb8ff,flag:0xe8f4ef},{n:'Longship',p:100,hull:0x1f6b4f,sail:0xd8f5e6,flag:0xffc857},{n:'Steamer',p:200,hull:0xb8860b,sail:0xfff4c2,flag:0xc9184a},{n:'Ghost Ship',p:350,hull:0xdfe9f0,sail:0xaee7ff,flag:0x2ec4b6}];
let coins=0,owned=[0],sel=0;
try{const d=JSON.parse(localStorage.getItem('swell-save')||'null');if(d){coins=d.coins|0;owned=d.owned||[0];sel=d.sel|0}}catch(e){}
function save(){try{localStorage.setItem('swell-save',JSON.stringify({coins,owned,sel}))}catch(e){}}
function showCoins(){$('coins').textContent='Coins: '+coins;$('coins2').textContent='Coins: '+coins}
const SHAPE_OF=['sloop','galleon','cat','long','steam','ghost'],SHAPES={};
{
const M=(g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);P.add(o);return o};
const bx=(w,h,l)=>new THREE.BoxGeometry(w,h,l),cy=(r,h)=>new THREE.CylinderGeometry(r,r,h,10),pl=(w,h)=>new THREE.PlaneGeometry(w,h);
const tip=(w,l,d)=>{const g=new THREE.ConeGeometry(w*.7071,l,4);g.rotateY(Math.PI/4);g.rotateX(d*Math.PI/2);return g};
const bow=(x,w,h,l,y,zc,d)=>{M(tip(w,l,d),wood,x,y,zc).scale.y=h/w};
SHAPES.sloop=()=>{M(bx(1.3,.6,2.6),wood,0,.05,0);bow(0,1.3,.6,1.3,.05,-1.95,-1);M(cy(.06,3.2),wood,0,1.9,0);M(pl(1.7,2.2),cloth,0,2,-.05);flag.position.set(.3,3.35,0);P.add(flag)};
SHAPES.galleon=()=>{M(bx(1.8,.8,3),wood,0,.1,0);bow(0,1.8,.8,1.4,.1,-2.2,-1);M(bx(1.6,.7,1),wood,0,.85,1.1);M(cy(.06,3.6),wood,0,2.1,-.5);M(cy(.05,2.6),wood,0,1.6,.9);M(pl(1.9,2.2),cloth,0,2.3,-.55);M(pl(1.4,1.6),cloth,0,1.9,.85);flag.position.set(.3,3.75,-.5);P.add(flag)};
SHAPES.cat=()=>{for(const s of[-1,1]){M(bx(.45,.45,3),wood,s*.8,0,0);bow(s*.8,.45,.45,1,0,-2,-1)}M(bx(2.1,.15,1.8),wood,0,.45,.1);M(cy(.05,3.4),wood,0,2.1,-.2);M(pl(1.2,2.8),cloth,0,2.1,-.25);flag.position.set(.25,3.8,-.2);P.add(flag)};
SHAPES.long=()=>{M(bx(1.1,.5,3.2),wood,0,0,0);bow(0,1.1,.5,1.6,0,-2.4,-1);bow(0,1.1,.5,1.6,0,2.4,1);M(new THREE.ConeGeometry(.2,.8,6),wood,0,.6,-3.1);M(cy(.05,3),wood,0,1.7,0);M(pl(2.3,1.5),cloth,0,2.3,-.05);const sm=[new THREE.MeshStandardMaterial({color:0xffc857}),new THREE.MeshStandardMaterial({color:0xc4455f})];for(let k=0;k<6;k++)for(const s of[-1,1]){M(cy(.22,.06),sm[k%2],s*.58,.2,-1.2+k*.48).rotation.z=Math.PI/2}flag.position.set(.3,3.4,0);P.add(flag)};
SHAPES.steam=()=>{M(bx(1.5,.7,3),wood,0,.1,0);bow(0,1.5,.7,1.3,.1,-2.15,-1);M(bx(1.1,.8,1.2),cloth,0,.85,.4);M(cy(.28,1.1),new THREE.MeshStandardMaterial({color:0xc9184a}),0,1.7,.4);for(const s of[-1,1])M(cy(.5,.2),wood,s*.85,.1,.6).rotation.z=Math.PI/2;flag.position.set(0,2.5,.4);P.add(flag)};
SHAPES.ghost=()=>{M(bx(1,.45,3),wood,0,0,0);bow(0,1,.45,1.5,0,-2.25,-1);M(bx(1,.5,.8),wood,0,.4,1.3);[[-.9,3.2,1.6],[.2,3.8,1.9],[1.1,2.8,1.4]].forEach(([z,hh,w],n)=>{M(cy(.05,hh),wood,0,hh/2+.2,z);M(pl(w,hh*.7),cloth,0,hh*.6+.2,z).rotation.z=(n-1)*.06});M(new THREE.SphereGeometry(.12,10,8),new THREE.MeshBasicMaterial({color:0xaee7ff}),0,.6,-1.7);flag.position.set(.3,3.9,.2);P.add(flag)};
}
function applySkin(i){const s=SKINS[i];wood.color.setHex(s.hull);cloth.color.setHex(s.sail);flag.material.color.setHex(s.flag);while(P.children.length)P.remove(P.children[0]);SHAPES[SHAPE_OF[i]]()}
const hx=n=>'#'+n.toString(16).padStart(6,'0');
function drawShop(){const g=$('grid');g.innerHTML='';SKINS.forEach((s,i)=>{const b=document.createElement('button'),own=owned.includes(i);b.className='sk'+(i===sel?' on':'');
 b.innerHTML='<i style="background:'+hx(s.hull)+'"></i><i style="background:'+hx(s.sail)+'"></i><span>'+s.n+'</span><small>'+(i===sel?'Equipped':own?'Equip':s.p+' coins')+'</small>';
 b.onclick=()=>{applySkin(i);if(own){sel=i;$('note').textContent=s.n+' equipped.'}else if(coins>=s.p){coins-=s.p;owned.push(i);sel=i;$('note').textContent='Bought '+s.n+'!'}else{$('note').textContent='You need '+(s.p-coins)+' more coins for '+s.n+'. Play a round to earn some.'}save();showCoins();drawShop()};g.appendChild(b)})}
$('shopb').onclick=()=>{$('card').style.display='none';$('shop').style.display='flex';$('note').textContent='';drawShop()};
$('back').onclick=()=>{applySkin(sel);$('shop').style.display='none';$('card').style.display='flex'};
applySkin(sel);showCoins();
let best=0;try{best=+localStorage.getItem('swell-best')||0}catch(e){}
let run=false,t=0,left=90,score=0,combo=0,comboT=0,vx=0,vz=0,vy=0,grounded=false,dashCd=0,shake=0,nextSurge=30,last=performance.now(),spd=0;
let lastClientStatsAt=0;

// S-Client runs in this same page: mods update these local game features directly.
const sclientFeatures={freezeTimer:false,crystalMagnet:false,noDashCooldown:false,superJump:false};
const sclientFeatureNames=new Set(Object.keys(sclientFeatures));
const sclientActions=new Set(['collectCrystal','refillTimer','setCoins','addCoins','addScore','unlockShips']);
function updateClientStats(){
 $('stat-coins').textContent=Number(coins||0).toLocaleString();
 $('stat-score').textContent=Number(score||0).toLocaleString();
 $('stat-speed').textContent=Number(spd||0).toFixed(1);
 $('round-status').textContent=run?`In a round · ${Math.max(0,Math.ceil(left))}s left`:'At menu';
 $('game-hint').textContent=run?`Playing · ${SKINS[sel]?.n||'Sloop'} · ${Math.max(0,Math.ceil(left))}s remaining`:`Ready · ${SKINS[sel]?.n||'Sloop'} selected`;
}
function sclientDoAction(action,value){
 if(!sclientActions.has(action))return {ok:false,message:'Unsupported S-Client action.'};
 if(action==='collectCrystal'){
  if(!run)return {ok:false,message:'Start a round before collecting a crystal.'};
  X.position.set(P.position.x,P.position.y+.7,P.position.z);beam.position.copy(X.position);
  return {ok:true,message:'Crystal moved to your ship.'};
 }
 if(action==='refillTimer'){
  if(!run)return {ok:false,message:'Start a round before refilling the timer.'};
  left=90;$('t').textContent='90';updateClientStats();return {ok:true,message:'Timer refilled to 90 seconds.'};
 }
 if(action==='setCoins'||action==='addCoins'){
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0)return {ok:false,message:'Enter a valid non-negative amount.'};
  coins=action==='setCoins'?Math.floor(amount):Math.floor(coins+amount);
  coins=Math.min(coins,1000000000);save();showCoins();
  if(getComputedStyle($('shop')).display!=='none')drawShop();
  updateClientStats();return {ok:true,message:'Coin balance: '+coins.toLocaleString()+'.'};
 }
 if(action==='addScore'){
  const amount=Number(value);
  if(!run)return {ok:false,message:'Start a round before changing score.'};
  if(!Number.isFinite(amount)||amount<0)return {ok:false,message:'Enter a valid non-negative amount.'};
  score=Math.min(1000000000,score+Math.floor(amount));$('s').textContent=String(score);updateClientStats();
  return {ok:true,message:'Round score increased.'};
 }
 if(action==='unlockShips'){
  owned=SKINS.map((_,i)=>i);applySkin(sel);save();showCoins();drawShop();
  return {ok:true,message:'All six ships unlocked in this local save.'};
 }
 return {ok:false,message:'Action unavailable.'};
}

function banner(s){const b=$('ban');b.textContent=s;b.style.opacity=1;setTimeout(()=>b.style.opacity=0,1100)}
function start(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)()}catch(e){}
 run=true;left=90;score=0;combo=0;comboT=0;t=0;base=1.3;surge=0;nextSurge=30;spawned=0;P.position.set(0,3,0);vx=vz=vy=0;spawn();$('card').style.display='none';$('s').textContent=0;$('cb').textContent='';updateClientStats();beep(440,.2,'triangle')}
$('go').onclick=start;
function frame(now){
 const dt=Math.min((now-last)/1000,.05);last=now;t+=dt*.7;
 const p=P.position;
 if(run){
  if(!sclientFeatures.freezeTimer)left-=dt;base=1.3+(90-left)*.01;
  if(90-left>nextSurge){surge=.4;nextSurge+=30;banner('Surge!');beep(110,.5,'sawtooth',.2)}
  surge=Math.max(0,surge-dt*.12);
  if(K.KeyQ||K.ArrowLeft)yaw+=2*dt;if(K.KeyE||K.ArrowRight)yaw-=2*dt;if(K.ArrowUp)pitch=Math.max(.05,pitch-1.5*dt);if(K.ArrowDown)pitch=Math.min(1.4,pitch+1.5*dt);
  const ix=(K.KeyD?1:0)-(K.KeyA?1:0)+jx,iz=(K.KeyS?1:0)-(K.KeyW?1:0)+jz;
  const c=Math.cos(yaw),s=Math.sin(yaw);
  vx+=(ix*c+iz*s)*50*dt;vz+=(-ix*s+iz*c)*50*dt;
  if(sclientFeatures.noDashCooldown)dashCd=0;
  if(K.ShiftLeft&&dashCd<=0&&(ix||iz)){const l=Math.hypot(ix,iz);vx+=(ix*c+iz*s)/l*16;vz+=(-ix*s+iz*c)/l*16;dashCd=1.5;shake=.25;beep(300,.15,'square',.08);emit(p,0xe8f4ef,25,6)}
  dashCd-=dt;
  const d=Math.exp(-3*dt);vx*=d;vz*=d;
  p.x+=vx*dt;p.z+=vz*dt;
  vy-=13*dt;p.y+=vy*dt;
  const g=h(p.x,p.z,t)+.6,gv=(h(p.x,p.z,t+.02)-h(p.x,p.z,t))/.02;
  const was=grounded;grounded=false;
  if(p.y<=g){if(!was&&vy<-4){emit(p,0xff6b8a,10,4)}p.y=g;vy=Math.max(vy,gv*1.3);grounded=true}
  if(K.Space&&grounded){vy=(sclientFeatures.superJump?22:11)+Math.max(gv,0);beep(520,.1,'triangle',.08)}
  if(!grounded&&Math.hypot(vx,vz)>3&&Math.random()<.6)emit(p,0x6fd6c4,1,1.5);
  const sp=Math.hypot(vx,vz);if(sp>1.5){const tg=Math.atan2(-vx,-vz);let dd=tg-hd;dd=Math.atan2(Math.sin(dd),Math.cos(dd));hd+=dd*Math.min(1,dt*5)}
  const e=.6,sx=h(p.x+e,p.z,t)-h(p.x-e,p.z,t),sz=h(p.x,p.z+e,t)-h(p.x,p.z-e,t);
  const sF=(-sx*Math.sin(hd)-sz*Math.cos(hd))/(2*e),sR=(sx*Math.cos(hd)-sz*Math.sin(hd))/(2*e);
  P.rotation.set(grounded?Math.atan(sF):THREE.MathUtils.clamp(vy*.04,-.5,.5),hd,Math.atan(sR),'YXZ');
  if(grounded&&sp>3&&Math.random()<.5)emit(p,0xf2fbff,1,2);
  X.rotation.y+=dt*2;X.rotation.x+=dt;
  if(sclientFeatures.crystalMagnet)X.position.set(p.x,p.y+.7,p.z);
  beam.position.set(X.position.x,X.position.y,X.position.z);
  comboT-=dt;if(comboT<=0&&combo){combo=0;$('cb').textContent=''}
  if(p.distanceTo(X.position)<2.6){
   combo=comboT>0?Math.min(combo+1,9):1;comboT=7;
   if(teal){left+=5;banner('+5 seconds')}
   score+=combo;shake=.5;emit(X.position,teal?0x2ec4b6:0xffc857,50,9);beep(500+combo*70,.2,'triangle',.18);
   $('s').textContent=score;$('cb').textContent=combo>1?'x'+combo:'';spawn()}
  $('t').textContent=Math.ceil(Math.max(left,0));
  if(left<=0){run=false;const nb=score>best;coins+=score;save();showCoins();if(nb){best=score;try{localStorage.setItem('swell-best',best)}catch(e){}}
   $('res').textContent='+'+score+' coins! You scored '+score+(nb?' - a new best!':'. Best: '+best+'.');$('go').textContent='Sail again';$('card').style.display='flex';beep(200,.6,'sine',.2);updateClientStats()}
 }
 if(!run){hd+=dt*.5;p.y=h(p.x,p.z,t)+.6;P.rotation.set(0,hd,0)}
 parts(dt);grid2(t,p.x,p.z);
 spd+=(Math.hypot(vx,vz)-spd)*.1;
 // Keep the speed-based camera zoom below the extreme FOV range that can flip/distort the scene.
 C.fov=THREE.MathUtils.clamp(60+Math.min(spd,30)*.72,60,82);C.updateProjectionMatrix();
 const sh=shake;shake=Math.max(0,shake-dt*1.5);
 const cd=15,ch=Math.cos(pitch)*cd;C.position.set(p.x+Math.sin(yaw)*ch+(Math.random()-.5)*sh,p.y+Math.sin(pitch)*cd+(Math.random()-.5)*sh,p.z+Math.cos(yaw)*ch);C.position.y=Math.max(C.position.y,h(C.position.x,C.position.z,t)+2);C.lookAt(p.x,p.y,p.z);
 stars.position.set(p.x,0,p.z);
 if(now-lastClientStatsAt>250){lastClientStatsAt=now;updateClientStats()}
 R.render(S,C);requestAnimationFrame(frame)}
P.position.set(0,3,0);spawn();requestAnimationFrame(frame);

// ---------------- S-CLIENT MOD MANAGER ----------------
const STORAGE_KEY='sclient.mods.v1';
const STARTER_MOD={
 format:'sclient-mod',formatVersion:1,id:'swell-hacks',name:'Swell Hacks',version:'1.0.0',author:'S-Client',game:'swell',
 description:'Local gameplay tools for Swell. Toggle movement and round advantages, then use quick actions while playing.',icon:'⚡',
 features:[
  {id:'freezeTimer',name:'Freeze timer',description:'Keep the round timer from counting down.',defaultEnabled:false},
  {id:'crystalMagnet',name:'Crystal magnet',description:'Pull the current crystal to your ship.',defaultEnabled:false},
  {id:'noDashCooldown',name:'No dash cooldown',description:'Remove the dash cooldown.',defaultEnabled:false},
  {id:'superJump',name:'Super jump',description:'Increase jump strength.',defaultEnabled:false}
 ],
 actions:[
  {id:'collect-crystal',label:'Collect crystal',action:'collectCrystal'},
  {id:'refill-timer',label:'Refill 90 sec',action:'refillTimer'},
  {id:'add-coins',label:'+100 coins',action:'addCoins',value:100},
  {id:'max-coins',label:'Set 999,999 coins',action:'setCoins',value:999999},
  {id:'add-score',label:'+100 score',action:'addScore',value:100},
  {id:'unlock-ships',label:'Unlock all ships',action:'unlockShips'}
 ]
};
let mods=[];
let toastTimer=null;
function toast(message){
 const el=$('toast');el.textContent=message;el.classList.add('show');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function validateManifest(manifest){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('The file is not a valid mod package.');
 if(manifest.format!=='sclient-mod'||manifest.formatVersion!==1)throw new Error('Unsupported .sclient format. This client supports format version 1.');
 if(manifest.game!=='swell')throw new Error('This mod is not marked as compatible with Swell.');
 if(typeof manifest.id!=='string'||!/^[a-z0-9][a-z0-9-]{1,62}$/.test(manifest.id))throw new Error('The mod ID must be 2–63 lowercase letters, numbers, or hyphens.');
 if(typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>80)throw new Error('The mod needs a name of at most 80 characters.');
 if(typeof manifest.version!=='string'||manifest.version.length>30)throw new Error('The mod needs a valid version string.');
 if(typeof manifest.description!=='string'||manifest.description.length>400)throw new Error('The mod description is missing or too long.');
 if(!Array.isArray(manifest.features)||manifest.features.length>40)throw new Error('The mod features list is invalid or too large.');
 if(!Array.isArray(manifest.actions)||manifest.actions.length>40)throw new Error('The mod actions list is invalid or too large.');
 const featureIds=new Set(),actionIds=new Set();
 for(const feature of manifest.features){
  if(!feature||typeof feature.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(feature.id))throw new Error('A feature has an invalid ID.');
  if(featureIds.has(feature.id))throw new Error(`Duplicate feature ID: ${feature.id}`);featureIds.add(feature.id);
  if(typeof feature.name!=='string'||!feature.name.trim()||feature.name.length>80)throw new Error(`Feature ${feature.id} needs a name.`);
 }
 for(const action of manifest.actions){
  if(!action||typeof action.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,49}$/.test(action.id))throw new Error('An action has an invalid ID.');
  if(actionIds.has(action.id))throw new Error(`Duplicate action ID: ${action.id}`);actionIds.add(action.id);
  if(typeof action.label!=='string'||!action.label.trim()||action.label.length>80)throw new Error(`Action ${action.id} needs a label.`);
  if(typeof action.action!=='string')throw new Error(`Action ${action.id} has no API action.`);
  if(action.value!==undefined&&(!Number.isFinite(Number(action.value))||Math.abs(Number(action.value))>1000000000))throw new Error(`Action ${action.id} has an invalid numeric value.`);
 }
 return manifest;
}
function normalizeInstalled(manifest,enabled=true,enabledFeatures=null){
 const defaults={};for(const feature of manifest.features||[])defaults[feature.id]=Boolean(feature.defaultEnabled);
 return {manifest,enabled:Boolean(enabled),enabledFeatures:{...defaults,...(enabledFeatures||{})}};
}
function persistMods(){
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(mods));}
 catch(_){toast('Could not save the mod library. Browser storage may be disabled or full.');}
 $('mod-count').textContent=String(mods.length);
 $('installed-count').textContent=`${mods.length} INSTALLED`;
 $('installed-summary').textContent=`${mods.length} mod${mods.length===1?'':'s'} in your local library`;
}
function syncModFeatures(){
 for(const id of sclientFeatureNames)sclientFeatures[id]=false;
 for(const item of mods){
  if(!item.enabled)continue;
  for(const [id,on] of Object.entries(item.enabledFeatures||{})){
   if(sclientFeatureNames.has(id)&&on)sclientFeatures[id]=true;
  }
 }
}
function downloadMod(item){
 const blob=new Blob([JSON.stringify(item.manifest,null,2)+'\n'],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`${item.manifest.id}.sclient`;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Downloaded ${item.manifest.name}.sclient`);
}
function runModAction(item,action){
 if(!item.enabled){toast('Enable this mod before using its actions.');return;}
 if(!sclientActions.has(action.action)){toast('This action is not supported by the current Swell API.');return;}
 const result=sclientDoAction(action.action,action.value);toast(result.message);
}
function renderMods(){
 const grid=$('mods-grid');grid.replaceChildren();
 $('mod-count').textContent=String(mods.length);$('installed-count').textContent=`${mods.length} INSTALLED`;
 $('installed-summary').textContent=`${mods.length} mod${mods.length===1?'':'s'} in your local library`;
 $('empty-state').classList.toggle('hidden',mods.length!==0);
 for(const item of mods){
  const mod=item.manifest,card=el('article',`mod-card${item.enabled?'':' disabled'}`);
  const top=el('div','mod-top'),icon=el('div','mod-icon',typeof mod.icon==='string'&&mod.icon.length<=4?mod.icon:'◇');
  const info=el('div','mod-info'),titleRow=el('div','mod-title-row');
  titleRow.append(el('span','mod-title',mod.name),el('span','mod-version',`v${mod.version}`));
  info.append(titleRow,el('p','mod-desc',mod.description));
  const master=el('label','mod-toggle');master.append(document.createTextNode(item.enabled?'Enabled':'Disabled'));
  const masterInput=el('input','switch');masterInput.type='checkbox';masterInput.checked=item.enabled;masterInput.setAttribute('aria-label',`Enable ${mod.name}`);
  masterInput.addEventListener('change',()=>{item.enabled=masterInput.checked;persistMods();syncModFeatures();renderMods();toast(`${mod.name} ${item.enabled?'enabled':'disabled'}.`);});
  master.append(masterInput);top.append(icon,info,master);card.append(top);
  card.append(el('div','mod-meta',`${mod.author||'Unknown author'} · SWELL · ${mod.features.length} FEATURES`));
  card.append(el('div','mod-divider'),el('div','feature-heading','FEATURES'));
  const featureList=el('div','feature-list');
  for(const feature of mod.features){
   const supported=sclientFeatureNames.has(feature.id),row=el('div',`feature-row${supported?'':' unsupported'}`);
   const label=el('label','',feature.name),right=el('div','','');
   if(supported){
    const input=el('input','switch');input.type='checkbox';input.checked=Boolean(item.enabledFeatures?.[feature.id]);input.disabled=!item.enabled;
    input.setAttribute('aria-label',`${feature.name} for ${mod.name}`);
    input.addEventListener('change',()=>{item.enabledFeatures[feature.id]=input.checked;persistMods();syncModFeatures();});right.append(input);
   }else right.append(el('span','unsupported-tag','API NOT AVAILABLE'));
   row.append(label,right);if(feature.description)row.title=feature.description;featureList.append(row);
  }
  card.append(featureList);
  if(mod.actions.length){
   card.append(el('div','mod-divider'),el('div','feature-heading','QUICK ACTIONS'));
   const actions=el('div','mod-actions');
   for(const action of mod.actions){
    const button=el('button','mod-action-button',action.label);button.type='button';
    button.disabled=!item.enabled||!sclientActions.has(action.action);
    button.title=!sclientActions.has(action.action)?'This action is not supported by the current game API.':action.label;
    button.addEventListener('click',()=>runModAction(item,action));actions.append(button);
   }
   card.append(actions);
  }
  const bottom=el('div','mod-bottom');bottom.append(el('small','',`ID: ${mod.id}`));
  const bottomActions=el('div','mod-bottom-actions'),download=el('button','mini-button','↓ Download');
  download.type='button';download.addEventListener('click',()=>downloadMod(item));
  const remove=el('button','mini-button danger','Remove');remove.type='button';
  remove.addEventListener('click',()=>{
   if(!window.confirm(`Remove ${mod.name} from this client?`))return;
   mods=mods.filter(entry=>entry.manifest.id!==mod.id);persistMods();syncModFeatures();renderMods();toast(`${mod.name} removed.`);
  });
  bottomActions.append(download,remove);bottom.append(bottomActions);card.append(bottom);grid.append(card);
 }
}
function showView(name){
 const isMods=name==='mods';
 $('game-view').classList.toggle('hidden',isMods);$('mods-view').classList.toggle('hidden',!isMods);
 $('nav-game').classList.toggle('active',!isMods);$('nav-mods').classList.toggle('active',isMods);
 $('page-title').textContent=isMods?'MODS':'SWELL';
 if(isMods&&document.pointerLockElement)document.exitPointerLock();
 if(!isMods){resizeGame();updateClientStats();}
}
function importFile(file){
 if(!file)return;if(!file.name.toLowerCase().endsWith('.sclient')){toast('Choose a file with the .sclient extension.');return;}
 if(file.size>512*1024){toast('Mod files must be smaller than 512 KB.');return;}
 const reader=new FileReader();reader.onload=()=>{
  try{
   const manifest=validateManifest(JSON.parse(String(reader.result))),index=mods.findIndex(entry=>entry.manifest.id===manifest.id);
   if(index>=0&&!window.confirm(`${manifest.name} is already installed. Replace it?`))return;
   const installed=normalizeInstalled(manifest,true);if(index>=0)mods[index]=installed;else mods.push(installed);
   persistMods();syncModFeatures();renderMods();toast(`${manifest.name} imported successfully.`);showView('mods');
  }catch(error){toast(error instanceof Error?error.message:'Could not import this mod.');}
  finally{$('mod-file').value='';}
 };
 reader.onerror=()=>toast('The selected mod file could not be read.');reader.readAsText(file);
}
function bootMods(){
 let hasSavedLibrary=false;
 try{
  const saved=localStorage.getItem(STORAGE_KEY);
  if(saved!==null){hasSavedLibrary=true;const parsed=JSON.parse(saved);if(Array.isArray(parsed)){
   mods=parsed.filter(entry=>{try{validateManifest(entry.manifest);return true;}catch(_){return false;}})
    .map(entry=>normalizeInstalled(entry.manifest,entry.enabled,entry.enabledFeatures));
  }}
 }catch(_){mods=[];hasSavedLibrary=false;toast('Saved mods could not be read. A fresh library was created.');}
 if(!hasSavedLibrary)mods=[normalizeInstalled(validateManifest(STARTER_MOD),true)];
 persistMods();syncModFeatures();renderMods();
}
$('nav-game').addEventListener('click',()=>showView('game'));
$('nav-mods').addEventListener('click',()=>showView('mods'));
$('open-mods-from-game').addEventListener('click',()=>showView('mods'));
$('browse-mods').addEventListener('click',()=>$('mod-file').click());
$('empty-import').addEventListener('click',()=>$('mod-file').click());
$('mod-file').addEventListener('change',event=>importFile(event.target.files?.[0]));
$('refresh-game').addEventListener('click',()=>window.location.reload());
bootMods();updateClientStats();resizeGame();
})();


