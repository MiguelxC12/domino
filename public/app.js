const socket=io();const $=x=>document.getElementById(x);let pid=localStorage.getItem("dominoPlayerId")||"",state=null,sound=true;
function screen(id){document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2400)}
$("toggleJoin").onclick=()=>$("joinBox").classList.toggle("hidden");
$("create").onclick=()=>{const name=$("name").value.trim();if(!name)return toast("Escribe tu nombre.");socket.emit("create-room",{name,playerId:pid})};
$("join").onclick=()=>{const name=$("name").value.trim(),code=$("code").value.trim().toUpperCase();if(!name)return toast("Escribe tu nombre.");socket.emit("join-room",{name,code,playerId:pid})};
$("code").oninput=e=>e.target.value=e.target.value.toUpperCase();
$("back").onclick=()=>socket.emit("leave-room");
$("copy").onclick=async()=>{await navigator.clipboard?.writeText(location.origin+"/?room="+state.code);toast("Enlace copiado.")};
document.querySelectorAll(".variants button").forEach(b=>b.onclick=()=>socket.emit("configure",{variant:+b.dataset.v}));
$("start").onclick=()=>socket.emit("start-game");
$("next").onclick=()=>socket.emit("next-hand");
$("again").onclick=()=>{$("modal").classList.add("hidden");socket.emit("new-match")};
$("sound").onclick=()=>{sound=!sound;$("sound").textContent=sound?"🔊":"🔇"};
socket.on("joined",d=>{pid=d.playerId;localStorage.setItem("dominoPlayerId",pid);screen("lobby")});
socket.on("game-error",toast);
socket.on("state",s=>{state=s;render();screen(s.phase==="lobby"?"lobby":"game");if(s.phase==="hand-result"||s.phase==="finished")showResult();else $("modal").classList.add("hidden")});
function render(){
  $("lcode").textContent=state.code;$("gcode").textContent=state.code;$("count").textContent=`${state.players.length}/4`;
  $("players").innerHTML=state.players.map(p=>`<div class="player"><div>🧑</div><div><b>${esc(p.name)} ${p.host?"👑":""}</b><br><small>Equipo ${p.team?"B":"A"} · ${p.connected?"Conectado":"Desconectado"}</small></div></div>`).join("");
  document.querySelectorAll(".variants button").forEach(b=>b.classList.toggle("selected",+b.dataset.v===state.variant));
  const me=state.players.find(p=>p.id===pid);$("start").disabled=!me?.host||state.players.length!==4;
  $("s0").textContent=state.scores[0];$("s1").textContent=state.scores[1];
  $("around").innerHTML=state.players.map(p=>`<div class="${p.id===state.turn?"active":""}">${esc(p.name)}<br><small>Equipo ${p.team?"B":"A"} · ${state.hands[p.id]?.count??state.hands[p.id]?.length??0}</small></div>`).join("");
  $("board").innerHTML=state.board.map(x=>`<div class="domino"><div class="half">${x.left}</div><div class="half">${x.right}</div></div>`).join("");
  $("empty").classList.toggle("hidden",state.board.length>0);$("hc").textContent=(state.hands[pid]||[]).length+" fichas";
  const tp=state.players.find(p=>p.id===state.turn);$("turn").textContent=state.phase==="starter-choice"?(state.isStarterChoice?"Tu equipo sale: elige una ficha":`Sale Equipo ${state.startingTeam?"B":"A"}`):tp?`Turno de ${tp.name}`:"";
  $("banner").classList.toggle("hidden",state.phase!=="starter-choice");if(state.phase==="starter-choice")$("banner").textContent=state.isStarterChoice?"Puedes elegir cualquier ficha de tu mano para salir.":`El Equipo ${state.startingTeam?"B":"A"} fue elegido para salir.`;
  renderHand();
}
function renderHand(){
  const h=state.hands[pid]||[], starter=state.phase==="starter-choice"&&state.isStarterChoice, my=state.turn===pid&&state.phase==="playing";
  $("hand").innerHTML="";
  h.forEach(t=>{const b=document.createElement("button");b.className="domino";b.innerHTML=`<div class="half">${t.a}</div><div class="half">${t.b}</div>`;
    let ok=starter;if(my&&state.board.length){const l=state.board[0].left,r=state.board[state.board.length-1].right;ok=t.a===l||t.b===l||t.a===r||t.b===r}
    b.disabled=!ok;if(ok)b.onclick=()=>starter?socket.emit("choose-starter",{tileId:t.id}):place(t);$("hand").appendChild(b)
  })
}
function place(t){const l=state.board[0].left,r=state.board[state.board.length-1].right,cl=t.a===l||t.b===l,cr=t.a===r||t.b===r;if(cl&&cr)socket.emit("play-tile",{tileId:t.id,side:confirm("Aceptar: izquierda. Cancelar: derecha.")?"left":"right"});else socket.emit("play-tile",{tileId:t.id,side:cl?"left":"right"})}
function showResult(){const r=state.lastResult;if(!r)return;$("modal").classList.remove("hidden");$("icon").textContent=r.winningTeam===null?"🤝":"🏆";if(state.phase==="finished"){$("mtitle").textContent=`Equipo ${r.winningTeam?"B":"A"} gana la partida`;$("mtext").textContent="Se alcanzaron 100 puntos.";$("next").classList.add("hidden");$("again").classList.remove("hidden")}else{$("mtitle").textContent=r.winningTeam===null?"Mano empatada":`Equipo ${r.winningTeam?"B":"A"} gana la mano`;$("mtext").textContent=r.reason==="trancada"?`Tranca: ${r.detail} tuvo el menor valor individual.`:r.reason==="empate-tranca"?`Empate entre ${r.detail}. No se asignan puntos.`:`${r.detail} se quedó sin fichas.`;$("next").classList.remove("hidden");$("again").classList.add("hidden")}$("mscore").textContent=r.winningTeam===null?"Sin puntos":`+${r.awarded} · ${r.scores[0]} - ${r.scores[1]}`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
const q=new URLSearchParams(location.search).get("room");if(q){$("joinBox").classList.remove("hidden");$("code").value=q.toUpperCase()}
