// Lector de partidas de Pokémon Ultra Sol/Ultra Luna (formato SAV7 USUM)
const fs = require('fs');
function blocks(d){
  const base = d.length - 0x200;
  const out=[]; let off=0;
  for(let i=0;i<60;i++){
    const p = base+0x14+i*8; if(p+8>d.length) break;
    const len=d.readUInt32LE(p), id=d.readUInt16LE(p+4), chk=d.readUInt16LE(p+6);
    if(len===0) break;
    out.push({i,id,off,len,chk});
    off += len; if(off%0x200) off += 0x200-(off%0x200);
  }
  return out;
}
function str(d,o,n){let s='';for(let i=0;i<n;i++){const c=d.readUInt16LE(o+i*2);if(!c)break;s+=String.fromCharCode(c);}return s;}
const ORDER=['0123','0132','0213','0312','0231','0321','1023','1032','2013','3012','2031','3021','1203','1302','2103','3102','2301','3201','1230','1320','2130','3120','2310','3210'].map(s=>[...s].map(Number));
function decrypt(raw){
  const d=Buffer.from(raw); const ec=d.readUInt32LE(0); let seed=ec;
  const next=()=>{seed=(Math.imul(seed,0x41C64E6D)+0x6073)>>>0;return seed>>>16;};
  for(let i=8;i<232;i+=2)d.writeUInt16LE(d.readUInt16LE(i)^next(),i);
  const sv=((ec>>>13)&31)%24, ord=ORDER[sv], out=Buffer.from(d);
  for(let b=0;b<4;b++) d.copy(out,8+b*56,8+ord[b]*56,8+ord[b]*56+56);
  if(d.length>232){seed=ec;for(let i=232;i<d.length;i+=2)out.writeUInt16LE(d.readUInt16LE(i)^next(),i);}
  return out;
}
function pk(raw){
  if(raw.readUInt32LE(0)===0 && raw.readUInt16LE(6)===0 && raw.readUInt16LE(8)===0) return null;
  const d=decrypt(raw); const species=d.readUInt16LE(8); if(!species||species>4000) return null;
  let sum=0;for(let i=8;i<232;i+=2)sum=(sum+d.readUInt16LE(i))&0xFFFF;
  const iv=d.readUInt32LE(0x74);
  const p={species,form:d[0x1D]>>3,nick:str(d,0x40,12),item:d.readUInt16LE(0x0A),exp:d.readUInt32LE(0x10),
    ec:d.readUInt32LE(0).toString(16),pid:d.readUInt32LE(0x18).toString(16),nature:d[0x1C],ability:d[0x14],
    moves:[0x5A,0x5C,0x5E,0x60].map(o=>d.readUInt16LE(o)),isEgg:!!((iv>>>30)&1),
    ot:str(d,0xB0,12),tid:d.readUInt16LE(0x0C),metLoc:d.readUInt16LE(0xDA),metLvl:d[0xDD]&0x7F,ball:d[0xDC],
    metDate:`20${String(d[0xD4]).padStart(2,'0')}-${d[0xD5]}-${d[0xD6]}`,valid:sum===d.readUInt16LE(6)};
  if(d.length>232){p.level=d[0xEC];p.hp=d.readUInt16LE(0xF0);p.maxHp=d.readUInt16LE(0xF2);p.status=d[0xE8];}
  return p;
}
function parse(d){
  if(d.length!==0x6CC00) throw new Error('No es una partida de Ultra Sol/Luna (tamaño '+d.length+')');
  const B=blocks(d), o=i=>B[i].off;
  const t=o(3), res={};
  res.trainer={name:str(d,t+0x38,13),tid:d.readUInt16LE(t),sid:d.readUInt16LE(t+2),game:d[t+4],gender:d[t+5]};
  const pt=o(16); res.playtime={h:d.readUInt16LE(pt),m:d[pt+2],s:d[pt+3]};
  const mi=o(9); res.money=d.readUInt32LE(mi+4); res.stamps=d.readUInt32LE(mi+8);
  const pa=o(4); res.party=[];
  for(let i=0;i<6;i++){const p=pk(d.subarray(pa+i*260,pa+i*260+260)); if(p)res.party.push(p);}
  res.partyCount=d[pa+0x618];
  const bx=o(14); res.boxes=[];
  for(let b=0;b<32;b++)for(let s=0;s<30;s++){const q=bx+(b*30+s)*232;const p=pk(d.subarray(q,q+232));if(p){p.box=b+1;p.slot=s+1;res.boxes.push(p);}}
  const it=o(0); const pouch=(off,n)=>{const r=[];for(let i=0;i<n;i++){const v=d.readUInt32LE(it+off+i*4);const id=v&0x3FF,c=(v>>>10)&0x3FF;if(id)r.push({id,count:c});}return r;};
  res.items={held:pouch(0,427),key:pouch(0x6AC,198),tm:pouch(0x9C4,108),med:pouch(0xB74,60),berry:pouch(0xC64,67),z:pouch(0xD70,35),roto:pouch(0xDFC,11)};
  res._blocks=B;
  return res;
}
module.exports={parse};
