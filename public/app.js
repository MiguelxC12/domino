const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const $ = id => document.getElementById(id);

let state = null;
let pid = localStorage.getItem('dominoPlayerId') || '';
let roomCode = localStorage.getItem('dominoRoom') || '';
let playerName = localStorage.getItem('dominoName') || '';
let sound = true;
let pendingTile = null;
let admin = false;

/* =========================================================
   ESTILOS ADICIONALES
========================================================= */

(function injectV3Styles() {
  if (document.getElementById('domino-v3-overrides')) return;

  const s = document.createElement('style');
  s.id = 'domino-v3-overrides';

  s.textContent = `
    :root {
      --num0:#64748b;
      --num1:#ef4444;
      --num2:#3b82f6;
      --num3:#22c55e;
      --num4:#eab308;
      --num5:#a855f7;
      --num6:#f97316;
      --num7:#06b6d4;
      --num8:#ec4899;
      --num9:#84cc16;
    }

    /* Cada número tiene SIEMPRE su mismo color */
    .pip.pip-0 { background:var(--num0)!important; }
    .pip.pip-1 { background:var(--num1)!important; }
    .pip.pip-2 { background:var(--num2)!important; }
    .pip.pip-3 { background:var(--num3)!important; }
    .pip.pip-4 { background:var(--num4)!important; }
    .pip.pip-5 { background:var(--num5)!important; }
    .pip.pip-6 { background:var(--num6)!important; }
    .pip.pip-7 { background:var(--num7)!important; }
    .pip.pip-8 { background:var(--num8)!important; }
    .pip.pip-9 { background:var(--num9)!important; }

    /* Botón salir */
    .game-exit-btn {
      background:#7f1d1d!important;
      border:1px solid #ef4444!important;
      color:#fff!important;
      padding:8px 10px!important;
    }

    /* Mesa centrada */
    .table-wrap {
      display:flex!important;
      align-items:flex-start!important;
      justify-content:center!important;
      padding:0!important;
      overflow:auto!important;
    }

    .table-wrap #board {
      position:relative;
      flex:0 0 auto;
      margin:0 auto!important;
      padding:0!important;
    }

    /* Movimiento suave de las fichas */
    .board-piece {
      will-change:transform,left,top;
      transition:
        left .22s ease,
        top .22s ease,
        transform .22s ease!important;
    }

    .board-piece .domino {
      box-shadow:0 3px 5px rgba(0,0,0,.35);
    }

    /* Ficha con la que se inició la mano */
    .board-piece.starter-piece {
      z-index:10;
      outline:3px solid var(--gold);
      outline-offset:3px;
      filter:drop-shadow(0 0 7px rgba(245,197,66,.9))!important;
    }

    .side-choice .domino {
      pointer-events:none;
    }

    @media(max-width:720px) {
      .game-exit-btn {
        font-size:.78rem!important;
      }

      .table-wrap #board {
        min-width:720px!important;
      }
    }
  `;

  document.head.appendChild(s);
})();


/* =========================================================
   FICHAS
========================================================= */

const pipMap = {
  0: [],
  1: [5],
  2: [1,9],
  3: [1,5,9],
  4: [1,3,7,9],
  5: [1,3,5,7,9],
  6: [1,3,4,6,7,9],
  7: [1,3,4,5,6,7,9],
  8: [1,2,3,7,8,9],
  9: [1,2,3,4,5,6,7,8,9]
};


/* =========================================================
   UTILIDADES
========================================================= */

function screen(id) {
  document.querySelectorAll('.screen')
    .forEach(x => x.classList.remove('active'));

  const target = $(id);

  if (target) {
    target.classList.add('active');
  }
}


function toast(t) {
  const element = $('toast');

  if (!element) return;

  element.textContent = t;
  element.classList.add('show');

  clearTimeout(toast.t);

  toast.t = setTimeout(() => {
    element.classList.remove('show');
  }, 2400);
}


function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[c])
  );
}


/* =========================================================
   PUNTOS DE LAS FICHAS

   IMPORTANTE:
   El color depende del NÚMERO.
   Ejemplo:
   todos los 2 = azul,
   todos los 3 = verde,
   etc.

   No depende de la posición del punto.
========================================================= */

function pipGrid(n) {
  const set = new Set(pipMap[n] || []);

  return Array.from(
    { length:9 },
    (_,i) => `
      <i
        class="pip pip-${n}"
        style="visibility:${set.has(i + 1) ? 'visible' : 'hidden'}"
      ></i>
    `
  ).join('');
}


function tileHTML(a,b,extra='') {
  return `
    <div class="domino ${a === b ? 'double' : ''} ${extra}">
      <div class="half">
        ${pipGrid(a)}
      </div>

      <div class="half">
        ${pipGrid(b)}
      </div>
    </div>
  `;
}


function tileMini(n) {
  return `
    <div class="side-domino">
      ${tileHTML(n,0)}
    </div>
  `;
}


/* =========================================================
   SESIÓN
========================================================= */

function saveSession() {
  localStorage.setItem('dominoPlayerId', pid);
  localStorage.setItem('dominoRoom', roomCode);
  localStorage.setItem('dominoName', playerName);
}


function clearSession() {
  localStorage.removeItem('dominoRoom');
  localStorage.removeItem('dominoPlayerId');
}


/* =========================================================
   HOME / LOBBY
========================================================= */

$('toggleJoin').onclick = () => {
  $('joinBox').classList.toggle('hidden');
};


$('create').onclick = () => {
  playerName = $('name').value.trim();

  if (!playerName) {
    return toast('Escribe tu nombre.');
  }

  socket.emit('create-room', {
    name: playerName,
    playerId: pid
  });
};


$('join').onclick = () => {
  playerName = $('name').value.trim();
  roomCode = $('code').value.trim().toUpperCase();

  if (!playerName) {
    return toast('Escribe tu nombre.');
  }

  if (!roomCode) {
    return toast('Escribe el código.');
  }

  saveSession();

  socket.emit('join-room', {
    name: playerName,
    code: roomCode,
    playerId: pid
  });
};


$('code').oninput = e => {
  e.target.value = e.target.value.toUpperCase();
};


$('back').onclick = () => {
  clearSession();

  socket.emit('leave-room');

  screen('home');
};


$('copy').onclick = async () => {
  const url = `${location.origin}/?room=${state.code}`;

  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado.');
  } catch {
    toast(url);
  }
};


$('start').onclick = () => {
  socket.emit('start-game');
};


document.querySelectorAll('[data-v]').forEach(button => {
  button.onclick = () => {
    socket.emit('configure', {
      variant:+button.dataset.v
    });
  };
});


document.querySelectorAll('[data-mode]').forEach(button => {
  button.onclick = () => {
    socket.emit('configure', {
      mode:button.dataset.mode
    });
  };
});


/* =========================================================
   RESULTADOS
========================================================= */

$('next').onclick = () => {
  socket.emit('next-hand');
};


$('again').onclick = () => {
  socket.emit('new-match');
};


$('cancelChoice').onclick = () => {
  $('sideModal').classList.add('hidden');
  pendingTile = null;
};


/* =========================================================
   SONIDO
========================================================= */

$('sound').onclick = () => {
  sound = !sound;

  $('sound').textContent = sound ? '🔊' : '🔇';
};


/* =========================================================
   SALIR DE LA PARTIDA
========================================================= */

function leaveMatch() {

  if (!state || state.phase === 'lobby') {
    return;
  }

  if (!confirm('¿Quieres salir de la partida y volver al inicio?')) {
    return;
  }

  pendingTile = null;

  clearSession();

  socket.emit('leave-room');

  state = null;

  $('modal').classList.add('hidden');
  $('sideModal').classList.add('hidden');

  screen('home');

  toast('Has salido de la sala.');
}


/*
   Creamos el botón mediante JavaScript para no tener que
   modificar el HTML.
*/

function ensureExitButton() {

  if ($('leaveGame')) {
    return;
  }

  const button = document.createElement('button');

  button.id = 'leaveGame';
  button.type = 'button';
  button.textContent = 'Salir';
  button.title = 'Salir de la sala';
  button.className = 'game-exit-btn';

  button.onclick = leaveMatch;

  document
    .querySelector('.game-top .top-actions')
    ?.prepend(button);
}


ensureExitButton();


/* =========================================================
   HORIZONTAL
========================================================= */

$('landscape').onclick = async () => {

  try {

    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }

    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }

    toast('Modo horizontal activado.');

  } catch {

    toast(
      'Gira el teléfono manualmente para ponerlo horizontal.'
    );
  }
};


/* =========================================================
   ADMIN
========================================================= */

$('adminBtn').onclick = () => openAdmin();

$('gameAdmin').onclick = () => openAdmin();

$('closeAdmin').onclick = () => {
  $('adminModal').classList.add('hidden');
};


$('adminLoginBtn').onclick = () => {

  socket.emit('admin-auth', {
    password:$('adminPassword').value
  });

};


socket.on('admin-auth-result', d => {

  if (!d.ok) {
    return toast('Contraseña incorrecta.');
  }

  admin = true;

  $('adminLogin').classList.add('hidden');
  $('adminPanel').classList.remove('hidden');

  socket.emit('admin-refresh');
});


socket.on('admin-rooms', rooms => {
  renderAdmin(rooms);
});


/* =========================================================
   SOCKET
========================================================= */

socket.on('game-error', message => {
  toast(message);
});


socket.on('joined', d => {

  pid = d.playerId;
  roomCode = d.room;

  saveSession();

  screen('lobby');
});


/*
   Reconexión automática.

   Si se pulsa F5:
   - el ID permanece;
   - el código permanece;
   - el nombre permanece;
   - Socket.IO vuelve a conectar;
   - se solicita entrar nuevamente a la misma sala.
*/

socket.on('connect', () => {

  if (pid && roomCode && playerName) {

    socket.emit('join-room', {
      name:playerName,
      code:roomCode,
      playerId:pid
    });

  }

});


socket.on('state', s => {

  state = s;

  roomCode = s.code;

  saveSession();

  render();

  if (
    s.phase === 'hand-result' ||
    s.phase === 'finished'
  ) {

    showResult();

  } else {

    $('modal').classList.add('hidden');

  }

});


/* =========================================================
   RENDER GENERAL
========================================================= */

function render() {

  $('lcode').textContent = state.code;
  $('gcode').textContent = state.code;
  $('count').textContent = `${state.players.length}/4`;

  $('players').innerHTML =
    state.players.map(p => `
      <div class="player">

        <div class="avatar">
          ${p.team === 0 ? '🧑🏻' : '🧑🏽'}
        </div>

        <div>

          <b>
            ${esc(p.name)}
            ${p.host ? '👑' : ''}
          </b>

          <br>

          <small>
            ${
              state.mode === 'team'
                ? `Equipo ${p.team ? 'B' : 'A'}`
                : 'Individual'
            }

            ·

            ${p.connected ? 'Conectado' : 'Desconectado'}
          </small>

        </div>

      </div>
    `).join('');


  document
    .querySelectorAll('[data-v]')
    .forEach(button => {
      button.classList.toggle(
        'selected',
        +button.dataset.v === state.variant
      );
    });


  document
    .querySelectorAll('[data-mode]')
    .forEach(button => {
      button.classList.toggle(
        'selected',
        button.dataset.mode === state.mode
      );
    });


  const me = state.players.find(p => p.id === pid);

  $('start').disabled =
    !me?.host ||
    state.players.length < 2;


  renderScore();
  renderSeats();
  renderBoard();
  renderHand();


  const tp =
    state.players.find(
      p => p.id === state.turn
    );


  $('turn').textContent =
    state.phase === 'starter-choice'
      ? (
          state.isStarterChoice
            ? 'Tu equipo sale: elige una ficha'
            : 'El otro grupo está eligiendo la salida'
        )
      : tp
        ? `Turno de ${tp.name}`
        : '';


  const banner = $('starterBanner');

  banner.classList.toggle(
    'hidden',
    state.phase !== 'starter-choice'
  );


  if (state.phase === 'starter-choice') {

    banner.textContent =
      state.isStarterChoice
        ? 'Tu equipo fue elegido para salir. Elige cualquier ficha de tu mano.'
        : 'El equipo seleccionado al azar está eligiendo su ficha de salida.';

  }


  screen(
    state.phase === 'lobby'
      ? 'lobby'
      : 'game'
  );
}


/* =========================================================
   MARCADOR
========================================================= */

function renderScore() {

  const labels =
    state.mode === 'team'
      ? ['Equipo A','Equipo B']
      : state.players.map(p => p.name);


  $('score').innerHTML =
    state.scores.map((value,index) => `

      <div class="score-item">

        <small>
          ${esc(
            labels[index] ||
            `Jugador ${index + 1}`
          )}
        </small>

        <b>${value}</b>

      </div>

      ${
        index === 0
          ? '<div class="score-vs">VS</div>'
          : ''
      }

    `).join('');
}


/* =========================================================
   POSICIONES DE LOS JUGADORES
========================================================= */

function relativeSeats() {

  const me =
    state.players.find(
      p => p.id === pid
    );


  if (!me) {
    return {};
  }


  const out = {
    self:me
  };


  const others =
    state.players.filter(
      p => p.id !== me.id
    );


  if (others.length === 1) {

    out.top = others[0];

    return out;
  }


  out.left =
    others.find(
      p =>
        p.seat ===
        (
          me.seat +
          state.players.length -
          1
        ) %
        state.players.length
    );


  out.right =
    others.find(
      p =>
        p.seat ===
        (
          me.seat + 1
        ) %
        state.players.length
    );


  out.top =
    others.find(
      p =>
        p !== out.left &&
        p !== out.right
    );


  return out;
}


function seatHTML(p,pos) {

  if (!p) {
    return `<div class="seat ${pos}"></div>`;
  }


  const active =
    p.id === state.turn;


  const count =
    state.hands[p.id]?.count ??
    state.hands[p.id]?.length ??
    0;


  return `

    <div class="seat ${pos} ${active ? 'active' : ''}">

      <div class="seat-icon">
        ${p.team === 0 ? '🧑🏻' : '🧑🏽'}
      </div>

      <div class="seat-name">
        ${esc(p.name)}
        ${p.host ? '👑' : ''}
      </div>

      <small>

        ${
          state.mode === 'team'
            ? `Equipo ${p.team ? 'B' : 'A'} · `
            : ''
        }

        ${count} fichas

      </small>

    </div>

  `;
}


function renderSeats() {

  const s = relativeSeats();

  $('seats').innerHTML =
    seatHTML(s.left,'left') +
    seatHTML(s.top,'top') +
    seatHTML(s.right,'right') +
    seatHTML(s.self,'self');
}


/* =========================================================
   MESA DE DOMINÓ
========================================================= */

/*
   La ficha inicial queda en el centro.

   Las fichas crecen hacia los extremos.

   Cuando llegan al límite:
       →→→→→
             ↓
       ←←←←←
       ↓
       →→→→→

   De esta manera la mesa no crece indefinidamente
   hacia la izquierda.
*/

function renderBoard() {

  const board = $('board');

  board.innerHTML = '';


  if (!state.board.length) {

    $('empty').classList.remove('hidden');

    board.style.width = '100%';
    board.style.height = '100%';

    return;
  }


  $('empty').classList.add('hidden');


  /*
     Identificamos la ficha con la que comenzó
     la mano para utilizarla como centro.
  */

  const anchorId =
    state.starterChoice?.tileId ||
    state.board[0]?.id;


  const anchorIndex =
    Math.max(
      0,
      state.board.findIndex(
        x => x.id === anchorId
      )
    );


  const stepX = 52;
  const stepY = 48;

  /*
     Cantidad de fichas antes de doblar.
  */

  const bendEvery = 8;


  function pathForDistance(distance, direction) {

    if (distance === 0) {

      return {
        x:0,
        y:0,
        rot:0,
        segment:0
      };

    }


    const n = distance - 1;

    const segment =
      Math.floor(
        n / bendEvery
      );


    const offset =
      n % bendEvery;


    /*
       Segmentos pares:
       se desplazan horizontalmente.

       Segmentos impares:
       vuelven en dirección contraria.

       Cada nuevo segmento baja.
    */

    const currentDirection =
      segment % 2 === 0
        ? direction
        : -direction;


    const x =
      currentDirection *
      offset *
      stepX;


    const y =
      (segment + 1) *
      stepY;


    /*
       Cuando la cadena está bajando,
       giramos visualmente las fichas.
    */

    const rot =
      segment % 2 === 0
        ? 0
        : 90;


    return {
      x,
      y,
      rot,
      segment
    };
  }


  const positions = [];

  let minX = 0;
  let maxX = 0;
  let maxY = 0;


  state.board.forEach((piece,index) => {

    const delta =
      index - anchorIndex;


    const direction =
      delta >= 0
        ? 1
        : -1;


    const p =
      pathForDistance(
        Math.abs(delta),
        direction
      );


    positions.push({
      ...p,
      x:p.x,
      y:p.y
    });


    minX =
      Math.min(
        minX,
        p.x
      );


    maxX =
      Math.max(
        maxX,
        p.x
      );


    maxY =
      Math.max(
        maxY,
        p.y
      );

  });


  /*
     Espacio adicional para que las fichas
     nunca queden pegadas al borde.
  */

  const boardWidth =
    Math.max(
      720,
      (maxX - minX) + 220
    );


  const boardHeight =
    Math.max(
      300,
      maxY + 190
    );


  board.style.width =
    `${boardWidth}px`;


  board.style.height =
    `${boardHeight}px`;


  board.style.margin =
    '0 auto';


  /*
     Centro real de la mesa.
  */

  const centerX =
    (boardWidth / 2) -
    ((minX + maxX) / 2);


  const centerY = 48;


  state.board.forEach((piece,index) => {

    const p =
      positions[index];


    const element =
      document.createElement('div');


    const isDouble =
      piece.left === piece.right;


    const isStarter =
      piece.id === anchorId;


    element.className =
      `
        board-piece
        ${isDouble ? 'double' : ''}
        ${isStarter ? 'starter-piece' : ''}
      `;


    element.innerHTML =
      tileHTML(
        piece.left,
        piece.right
      );


    /*
       Dimensiones normales.
    */

    const tileW =
      isDouble ? 70 : 46;


    const tileH =
      isDouble ? 46 : 70;


    const left =
      centerX +
      p.x -
      tileW / 2;


    const top =
      centerY +
      p.y -
      tileH / 2;


    element.style.left =
      `${left}px`;


    element.style.top =
      `${top}px`;


    element.style.transform =
      `rotate(${p.rot}deg)`;


    element.style.transformOrigin =
      'center center';


    element.dataset.index =
      index;


    board.appendChild(element);

  });
}


/* =========================================================
   VALIDACIÓN DE JUGADAS
========================================================= */

function tileMatches(tile,value) {

  return (
    tile.a === value ||
    tile.b === value
  );
}


function canPlaceOnSide(tile,side) {

  if (!state?.board?.length) {
    return true;
  }


  const value =
    side === 'left'
      ? state.board[0].left
      : state.board[state.board.length - 1].right;


  return tileMatches(
    tile,
    value
  );
}


function tileHasLegalMove(tile) {

  if (!state?.board?.length) {
    return true;
  }


  return (
    canPlaceOnSide(tile,'left') ||
    canPlaceOnSide(tile,'right')
  );
}


/* =========================================================
   MANO DEL JUGADOR
========================================================= */

function renderHand() {

  const h =
    state.hands[pid] || [];


  $('hc').textContent =
    `${h.length} fichas`;


  $('hand').innerHTML = '';


  const starter =
    state.phase === 'starter-choice' &&
    state.isStarterChoice;


  const myTurn =
    state.phase === 'playing' &&
    state.turn === pid;


  h.forEach(tile => {

    const button =
      document.createElement('button');


    button.className =
      `domino ${starter ? 'starter-select' : ''}`;


    button.innerHTML =
      tileHTML(
        tile.a,
        tile.b
      )
      .replace(
        /^<div class="domino[^>]*>/,
        ''
      )
      .replace(
        /<\/div>$/,
        ''
      );


    let canPlay = starter;


    if (myTurn) {

      canPlay =
        tileHasLegalMove(tile);

    }


    button.disabled =
      !canPlay;


    button.title =
      canPlay
        ? 'Jugar ficha'
        : (
            myTurn
              ? 'No coincide con ningún extremo'
              : 'Espera tu turno'
          );


    if (canPlay) {

      button.onclick =
        () => {

          if (starter) {

            socket.emit(
              'choose-starter',
              {
                tileId:tile.id
              }
            );

          } else {

            chooseSide(tile);

          }

        };

    }


    $('hand').appendChild(button);

  });
}


/* =========================================================
   ELEGIR EXTREMO
========================================================= */

function chooseSide(tile) {

  if (!state?.board?.length) {
    return;
  }


  const leftValue =
    state.board[0].left;


  const rightValue =
    state.board[
      state.board.length - 1
    ].right;


  const canLeft =
    canPlaceOnSide(
      tile,
      'left'
    );


  const canRight =
    canPlaceOnSide(
      tile,
      'right'
    );


  /*
     Comprobación adicional:
     si la ficha ya no puede ponerse,
     no enviamos nada al servidor.
  */

  if (!canLeft && !canRight) {

    toast(
      'Esa ficha no se puede poner en ningún extremo.'
    );

    return;
  }


  /*
     Puede ir en ambos lados.
     Mostramos claramente qué extremo
     se va a elegir.
  */

  if (canLeft && canRight) {

    pendingTile = tile;


    $('sideChoices').innerHTML = `

      <button
        class="side-choice"
        id="chooseLeft"
      >

        <span class="side-label">
          IZQUIERDA · ${leftValue}
        </span>

        ${tileHTML(leftValue,leftValue)}

      </button>


      <button
        class="side-choice"
        id="chooseRight"
      >

        <span class="side-label">
          DERECHA · ${rightValue}
        </span>

        ${tileHTML(rightValue,rightValue)}

      </button>

    `;


    $('sideModal')
      .classList
      .remove('hidden');


    $('chooseLeft').onclick =
      () => sendSide('left');


    $('chooseRight').onclick =
      () => sendSide('right');


    return;
  }


  /*
     Solo puede ir en un lado.
  */

  sendSide(
    canLeft
      ? 'left'
      : 'right',
    tile
  );
}


/* =========================================================
   ENVIAR JUGADA
========================================================= */

function sendSide(
  side,
  tile = pendingTile
) {

  if (!tile) {
    return;
  }


  /*
     Comprobamos otra vez antes de enviar.
     Esto evita que una ficha quede seleccionada
     si otro jugador acaba de modificar la mesa.
  */

  if (!canPlaceOnSide(tile,side)) {

    toast(
      'Ese extremo ya no acepta esa ficha.'
    );


    pendingTile = null;

    $('sideModal')
      .classList
      .add('hidden');

    return;
  }


  socket.emit(
    'play-tile',
    {
      tileId:tile.id,
      side
    }
  );


  pendingTile = null;

  $('sideModal')
    .classList
    .add('hidden');
}


/* =========================================================
   RESULTADO DE LA MANO
========================================================= */

function showResult() {

  const result =
    state.lastResult;


  if (!result) {
    return;
  }


  $('modal')
    .classList
    .remove('hidden');


  $('icon').textContent =
    result.winningTeam === null
      ? '🤝'
      : '🏆';


  const label =
    state.mode === 'team'
      ? `Equipo ${result.winningTeam ? 'B' : 'A'}`
      : (
          state.players.find(
            p =>
              p.team ===
              result.winningTeam
          )?.name ||
          'Jugador'
        );


  if (state.phase === 'finished') {

    $('mtitle').textContent =
      `${label} gana la partida`;


    $('mtext').textContent =
      'Se alcanzaron 100 puntos.';


    $('next')
      .classList
      .add('hidden');


    $('again')
      .classList
      .remove('hidden');

  } else {

    $('mtitle').textContent =
      result.winningTeam === null
        ? 'Mano empatada'
        : `${label} gana la mano`;


    $('mtext').textContent =
      result.reason === 'trancada'
        ? `Tranca: ${result.detail} tuvo el menor valor individual.`
        : result.reason === 'empate-tranca'
          ? `Empate entre ${result.detail}. Se juega otra mano.`
          : `${result.detail} se quedó sin fichas.`;


    $('next')
      .classList
      .remove('hidden');


    $('again')
      .classList
      .add('hidden');

  }


  $('mscore').textContent =
    result.winningTeam === null
      ? 'Sin puntos'
      : `+${result.awarded} · ${result.scores.join(' - ')}`;
}


/* =========================================================
   ADMINISTRACIÓN
========================================================= */

function openAdmin() {

  $('adminModal')
    .classList
    .remove('hidden');


  if (admin) {

    $('adminLogin')
      .classList
      .add('hidden');


    $('adminPanel')
      .classList
      .remove('hidden');


    socket.emit('admin-refresh');

  }
}


function renderAdmin(rooms) {

  if (!admin) {
    return;
  }


  $('adminRooms').innerHTML =
    rooms.length

      ? rooms.map(room => {

          const players =
            room.players.map(player => `

              <div class="admin-player">

                <input
                  data-rename="${player.id}"
                  value="${esc(player.name)}"
                >

                <select
                  data-team="${player.id}"
                  ${room.mode === 'individual' ? 'disabled' : ''}
                >

                  <option
                    value="0"
                    ${player.team === 0 ? 'selected' : ''}
                  >
                    Equipo A
                  </option>

                  <option
                    value="1"
                    ${player.team === 1 ? 'selected' : ''}
                  >
                    Equipo B
                  </option>

                </select>

                <button
                  data-host="${player.id}"
                >
                  👑
                </button>

                <button
                  data-save="${player.id}"
                >
                  Guardar
                </button>

              </div>

            `).join('');


          return `

            <div class="admin-room">

              <h3>
                Sala ${room.code}
              </h3>


              <div class="admin-meta">

                ${room.players.length} jugadores
                · ${room.phase}
                · ${
                    room.mode === 'team'
                      ? 'Equipos'
                      : 'Individual'
                  }
                · Doble-${room.variant}
                · ${room.scores.join(' - ')}

              </div>


              <div class="admin-grid">

                <select
                  data-mode="${room.code}"
                >

                  <option
                    value="team"
                    ${room.mode === 'team' ? 'selected' : ''}
                  >
                    Equipos
                  </option>

                  <option
                    value="individual"
                    ${room.mode === 'individual' ? 'selected' : ''}
                  >
                    Individual
                  </option>

                </select>


                <select
                  data-variant="${room.code}"
                >

                  <option
                    value="6"
                    ${room.variant === 6 ? 'selected' : ''}
                  >
                    Doble-6
                  </option>

                  <option
                    value="9"
                    ${room.variant === 9 ? 'selected' : ''}
                  >
                    Doble-9
                  </option>

                </select>


                <button
                  data-start="${room.code}"
                >
                  ▶ Iniciar
                </button>


                <button
                  data-refresh="${room.code}"
                >
                  ↻
                </button>

              </div>


              ${players}

            </div>

          `;

        }).join('')

      : '<p>No hay salas.</p>';


  /*
     Cambiar modo
  */

  document
    .querySelectorAll('[data-mode]')
    .forEach(element => {

      element.onchange = () => {

        socket.emit(
          'admin-change',
          {
            code:element.dataset.mode,
            action:'mode',
            value:element.value
          }
        );

      };

    });


  /*
     Cambiar variante
  */

  document
    .querySelectorAll('[data-variant]')
    .forEach(element => {

      element.onchange = () => {

        socket.emit(
          'admin-change',
          {
            code:element.dataset.variant,
            action:'variant',
            value:+element.value
          }
        );

      };

    });


  /*
     Iniciar
  */

  document
    .querySelectorAll('[data-start]')
    .forEach(element => {

      element.onclick = () => {

        socket.emit(
          'admin-change',
          {
            code:element.dataset.start,
            action:'start'
          }
        );

      };

    });


  /*
     Refrescar
  */

  document
    .querySelectorAll('[data-refresh]')
    .forEach(element => {

      element.onclick = () => {
        socket.emit('admin-refresh');
      };

    });


  /*
     Cambiar anfitrión
  */

  document
    .querySelectorAll('[data-host]')
    .forEach(element => {

      element.onclick = () => {

        const room =
          element.closest('.admin-room');


        const code =
          room
            .querySelector('[data-mode]')
            .dataset
            .mode;


        socket.emit(
          'admin-change',
          {
            code,
            action:'host',
            value:{
              id:element.dataset.host
            }
          }
        );

      };

    });


  /*
     Guardar jugador:
     nombre + equipo
  */

  document
    .querySelectorAll('[data-save]')
    .forEach(element => {

      element.onclick = () => {

        const box =
          element.closest('.admin-player');


        const room =
          element.closest('.admin-room');


        const code =
          room
            .querySelector('[data-mode]')
            .dataset
            .mode;


        const id =
          element.dataset.save;


        const name =
          box.querySelector(
            '[data-rename]'
          ).value;


        socket.emit(
          'admin-change',
          {
            code,
            action:'rename',
            value:{
              id,
              name
            }
          }
        );


        const teamSelect =
          box.querySelector(
            '[data-team]'
          );


        if (
          teamSelect &&
          !teamSelect.disabled
        ) {

          socket.emit(
            'admin-change',
            {
              code,
              action:'team',
              value:{
                id,
                team:+teamSelect.value
              }
            }
          );

        }

      };

    });

}


/* =========================================================
   INICIALIZACIÓN
========================================================= */

const q =
  new URLSearchParams(
    location.search
  ).get('room');


if (q) {

  roomCode =
    q.toUpperCase();

  $('joinBox')
    .classList
    .remove('hidden');

  $('code').value =
    roomCode;
}


if (playerName) {

  $('name').value =
    playerName;

}
