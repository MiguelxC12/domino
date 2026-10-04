const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;

// Live rooms and starter statistics are in memory in this first Render deployment.
// This avoids relying on Render's ephemeral local filesystem.
const rooms = new Map();
const stats = new Map();

app.use(express.static(path.join(__dirname, "public")));

const randId = () => crypto.randomBytes(8).toString("hex");
function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do c = Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  while (rooms.has(c));
  return c;
}
function tiles(max) {
  const a=[]; for(let x=0;x<=max;x++) for(let y=x;y<=max;y++) a.push({id:`${x}-${y}`,a:x,b:y});
  return a;
}
function shuffle(a) {
  a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a;
}
function team(seat){return seat%2}
function player(room,id){return room.players.find(p=>p.id===id)}
function addStat(id,name){const s=stats.get(id)||{player_id:id,display_name:name,games:0,wins:0,losses:0,points:0};s.display_name=name;stats.set(id,s)}
function publicState(room,viewer){
  const me=player(room,viewer);
  const hands={};
  for(const p of room.players){
    const h=room.hands.get(p.id)||[];
    hands[p.id]=p.id===viewer?h:{count:h.length};
  }
  const turn=player(room,room.turn);
  return {
    code:room.code,hostId:room.hostId,variant:room.variant,target:100,phase:room.phase,
    players:room.players.map(p=>({id:p.id,name:p.name,seat:p.seat,team:team(p.seat),connected:p.connected,host:p.id===room.hostId})),
    scores:room.scores,handNumber:room.handNumber,board:room.board,turn:room.turn,turnName:turn?.name||null,
    startingTeam:room.startingTeam,isStarterChoice:room.phase==="starter-choice"&&me&&team(me.seat)===room.startingTeam,
    hands,lastResult:room.lastResult
  };
}
function emitRoom(room){for(const p of room.players) io.to(p.socketId).emit("state",publicState(room,p.id))}
function err(s,msg){s.emit("game-error",msg)}
function makeRoom(host){
  const r={code:newCode(),hostId:host.id,variant:9,players:[],phase:"lobby",hands:new Map(),board:[],turn:null,
    startingTeam:null,starterChoice:null,scores:[0,0],handNumber:0,lastResult:null,disconnected:new Map()};
  rooms.set(r.code,r); return r;
}
function startHand(r){
  r.handNumber++;r.phase="starter-choice";r.board=[];r.turn=null;r.starterChoice=null;r.lastResult=null;
  const deck=shuffle(tiles(r.variant)),count=r.variant===6?7:10;r.hands.clear();
  for(const p of r.players) r.hands.set(p.id,deck.splice(0,count));
  r.startingTeam=Math.random()<.5?0:1;emitRoom(r);
}
function legal(t,v){return t.a===v||t.b===v}
function canPlay(h,b){
  if(!b.length)return true;
  const l=b[0].left,rr=b[b.length-1].right;
  return h.some(t=>legal(t,l)||legal(t,rr));
}
function orientLeft(t,v){return t.b===v?{a:t.a,b:t.b}:t.a===v?{a:t.b,b:t.a}:null}
function orientRight(t,v){return t.a===v?{a:t.a,b:t.b}:t.b===v?{a:t.b,b:t.a}:null}

function finish(r,winner,reason,detail){
  let awarded=0;
  if(winner!==null){
    const loser=1-winner;
    awarded=r.players.filter(p=>team(p.seat)===loser)
      .reduce((s,p)=>(s+(r.hands.get(p.id)||[]).reduce((a,t)=>a+t.a+t.b,0)),0);
    r.scores[winner]+=awarded;
  }
  r.lastResult={reason,detail,winningTeam:winner,awarded,scores:[...r.scores]};
  const matchWinner=r.scores[0]>=100?0:r.scores[1]>=100?1:null;
  if(matchWinner!==null){
    r.phase="finished";
    for(const p of r.players){
      const s=stats.get(p.id)||{player_id:p.id,display_name:p.name,games:0,wins:0,losses:0,points:0};
      const won=team(p.seat)===matchWinner;s.games++;s.wins+=won?1:0;s.losses+=won?0:1;s.points+=r.scores[matchWinner];s.display_name=p.name;stats.set(p.id,s);
    }
  } else r.phase="hand-result";
  emitRoom(r);
}
function nextTurn(r){
  const cur=player(r,r.turn), start=cur?cur.seat:-1;
  for(let n=1;n<=4;n++){
    const p=r.players.find(x=>x.seat===(start+n+4)%4); if(!p)continue;
    r.turn=p.id;
    if(canPlay(r.hands.get(p.id)||[],r.board)){emitRoom(r);return}
  }
  const sums=r.players.map(p=>({name:p.name,team:team(p.seat),points:(r.hands.get(p.id)||[]).reduce((s,t)=>s+t.a+t.b,0)}));
  const min=Math.min(...sums.map(x=>x.points)), wins=sums.filter(x=>x.points===min), teams=[...new Set(wins.map(x=>x.team))];
  if(teams.length!==1) finish(r,null,"empate-tranca",wins.map(x=>`${x.name} (${x.points})`).join(", "));
  else finish(r,teams[0],"trancada",wins[0].name);
}
function play(r,p,id,side){
  const h=r.hands.get(p.id)||[],i=h.findIndex(t=>t.id===id);if(i<0)throw Error("Esa ficha no está en tu mano.");
  const t=h[i];
  if(!r.board.length){h.splice(i,1);r.board.push({id:t.id,left:t.a,right:t.b,playerId:p.id})}
  else{
    const l=r.board[0].left,rr=r.board[r.board.length-1].right;
    const o=side==="left"?orientLeft(t,l):orientRight(t,rr);if(!o)throw Error("Esa ficha no puede ir en ese extremo.");
    h.splice(i,1);const piece={id:t.id,left:o.a,right:o.b,playerId:p.id};side==="left"?r.board.unshift(piece):r.board.push(piece)
  }
  if(h.length===0){finish(r,team(p.seat),"pegada",p.name);return}
  nextTurn(r);
}

io.on("connection",s=>{
  s.on("create-room",({name,playerId})=>{
    name=String(name||"").trim().slice(0,18);if(!name)return err(s,"Escribe tu nombre.");
    const id=playerId||randId(),r=makeRoom({id});r.players.push({id,name,seat:0,socketId:s.id,connected:true});addStat(id,name);
    s.data={room:r.code,playerId:id};s.join(r.code);s.emit("joined",{room:r.code,playerId:id});emitRoom(r);
  });
  s.on("join-room",({code,name,playerId})=>{
    code=String(code||"").trim().toUpperCase();name=String(name||"").trim().slice(0,18);const r=rooms.get(code);
    if(!r)return err(s,"No existe esa sala.");if(!name)return err(s,"Escribe tu nombre.");
    const old=playerId&&player(r,playerId);
    if(old){old.socketId=s.id;old.connected=true;r.disconnected.delete(playerId);s.data={room:code,playerId};s.join(code);s.emit("joined",{room:code,playerId});emitRoom(r);return}
    if(r.phase!=="lobby")return err(s,"La partida ya comenzó.");if(r.players.length>=4)return err(s,"La sala está llena.");
    const id=playerId||randId(),seat=[0,1,2,3].find(x=>!r.players.some(p=>p.seat===x));
    r.players.push({id,name,seat,socketId:s.id,connected:true});addStat(id,name);s.data={room:code,playerId:id};s.join(code);s.emit("joined",{room:code,playerId:id});emitRoom(r);
  });
  s.on("configure",({variant})=>{const r=rooms.get(s.data.room);if(!r||r.hostId!==s.data.playerId||r.phase!=="lobby")return;if([6,9].includes(+variant)){r.variant=+variant;emitRoom(r)}});
  s.on("start-game",()=>{const r=rooms.get(s.data.room);if(!r)return;if(r.hostId!==s.data.playerId)return err(s,"Solo el anfitrión puede comenzar.");if(r.players.length!==4)return err(s,"Se necesitan 4 jugadores.");startHand(r)});
  s.on("choose-starter",({tileId})=>{
    const r=rooms.get(s.data.room),p=player(r,s.data.playerId);if(!r||!p||r.phase!=="starter-choice")return;
    if(team(p.seat)!==r.startingTeam)return err(s,"Tu equipo no fue seleccionado para salir.");if(r.starterChoice)return;
    const t=(r.hands.get(p.id)||[]).find(x=>x.id===tileId);if(!t)return err(s,"Esa ficha no está en tu mano.");
    r.starterChoice={playerId:p.id,tileId};r.phase="playing";r.turn=p.id;play(r,p,t.id,"right");
  });
  s.on("play-tile",({tileId,side})=>{const r=rooms.get(s.data.room);if(!r||r.phase!=="playing")return err(s,"No se puede jugar ahora.");if(r.turn!==s.data.playerId)return err(s,"No es tu turno.");try{play(r,player(r,s.data.playerId),tileId,side)}catch(e){err(s,e.message)}});
  s.on("next-hand",()=>{const r=rooms.get(s.data.room);if(r?.phase==="hand-result"&&r.hostId===s.data.playerId)startHand(r)});
  s.on("new-match",()=>{const r=rooms.get(s.data.room);if(!r||r.hostId!==s.data.playerId)return;r.scores=[0,0];r.handNumber=0;r.phase="lobby";r.board=[];r.turn=null;r.lastResult=null;emitRoom(r)});
  s.on("leave-room",()=>disconnect(s));s.on("disconnect",()=>disconnect(s));
});
function disconnect(s){
  const r=rooms.get(s.data?.room),id=s.data?.playerId;if(!r||!id)return;const p=player(r,id);if(!p||p.socketId!==s.id)return;
  p.connected=false;r.disconnected.set(id,Date.now());emitRoom(r);
  setTimeout(()=>{if(r.disconnected.get(id)&&Date.now()-r.disconnected.get(id)>=59000){r.disconnected.delete(id);if(r.phase==="lobby"){r.players=r.players.filter(x=>x.id!==id);if(r.hostId===id&&r.players[0])r.hostId=r.players[0].id}emitRoom(r)}},60000);
}
app.get("/api/health",(_,res)=>res.json({ok:true,rooms:rooms.size}));
app.get("/api/stats/:id",(req,res)=>res.json(stats.get(req.params.id)||{games:0,wins:0,losses:0,points:0}));
server.listen(PORT,"0.0.0.0",()=>console.log(`Dominó Cubano listening on ${PORT}`));
