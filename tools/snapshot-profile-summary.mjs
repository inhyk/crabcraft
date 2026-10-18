import {readFile} from 'node:fs/promises';
const p=JSON.parse(await readFile(process.argv[2],'utf8')),nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map();for(const n of p.nodes)for(const id of n.children??[])parent.set(id,n.id);const self=new Map(),inclusive=new Map();let total=0;
const key=n=>`${n.callFrame.functionName||'(anonymous)'} ${n.callFrame.url.split('/').slice(-3).join('/')}:${n.callFrame.lineNumber+1}`;
for(let i=0;i<(p.samples??[]).length;i++){const us=p.timeDeltas[i]??0;total+=us;const id=p.samples[i],leaf=nodes.get(id);self.set(key(leaf),(self.get(key(leaf))??0)+us);const seen=new Set();let at=id;while(at){const k=key(nodes.get(at));if(!seen.has(k)){inclusive.set(k,(inclusive.get(k)??0)+us);seen.add(k);}at=parent.get(at);}}
const rank=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([frame,us])=>({frame,ms:us/1000,pct:100*us/total}));console.log(JSON.stringify({totalMs:total/1000,self:rank(self),inclusive:rank(inclusive)},null,2));
