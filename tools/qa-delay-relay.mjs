// Owned local WebSocket proxy: simulated latency, never a public Origin workaround.
import {WebSocket,WebSocketServer} from 'ws';
const delay=Number(process.env.CC_QA_DELAY_MS??75),port=Number(process.env.CC_QA_DELAY_PORT??5198);
if(!Number.isFinite(delay)||delay<0||delay>1000)throw Error('invalid delay');
const server=new WebSocketServer({host:'127.0.0.1',port}),connections=new Set(),timers=new Set();
const stats={pid:process.pid,delayEachHopMs:delay,port,connections:0,forwarded:0,dropped:0,queuedMax:0};
server.on('connection',client=>{const upstream=new WebSocket('ws://127.0.0.1:5192/multiplayer'),pending=[];connections.add(client);connections.add(upstream);stats.connections++;
 const send=(to,data,binary)=>{if(to.readyState===WebSocket.OPEN){to.send(data,{binary});stats.forwarded++;}else if(to.readyState===WebSocket.CONNECTING)pending.push([to,data,binary]);else stats.dropped++;};
 const forward=(to,data,binary)=>{const id=setTimeout(()=>{timers.delete(id);send(to,data,binary);},delay);timers.add(id);stats.queuedMax=Math.max(stats.queuedMax,timers.size);};
 client.on('message',(d,b)=>forward(upstream,d,b));upstream.on('message',(d,b)=>forward(client,d,b));upstream.on('open',()=>{for(const [to,d,b]of pending.splice(0))send(to,d,b);});
 for(const [a,b]of [[client,upstream],[upstream,client]]){a.on('close',()=>{connections.delete(a);if(b.readyState===WebSocket.OPEN||b.readyState===WebSocket.CONNECTING)b.close();});a.on('error',()=>{if(b.readyState===WebSocket.OPEN||b.readyState===WebSocket.CONNECTING)b.close();});}
});
server.on('listening',()=>console.log('READY',JSON.stringify(stats)));
process.on('SIGTERM',()=>{for(const timer of timers)clearTimeout(timer);for(const ws of connections)ws.terminate();server.close(()=>{console.log('FINISHED',JSON.stringify(stats));process.exit(0);});});
