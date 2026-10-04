const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity
});


let state = null;

let pid =
  localStorage.getItem(
    "dominoPlayerId"
  ) || "";

let roomCode =
  localStorage.getItem(
    "dominoRoom"
  ) || "";

let playerName =
  localStorage.getItem(
    "dominoName"
  ) || "";


/*
   MUY IMPORTANTE:

   Si el jugador pulsa SALIR,
   esto se convierte en true.

   Por eso F5 NO vuelve a meterlo
   automáticamente en la sala.
*/

let intentionallyLeft =
  localStorage.getItem(
    "dominoIntentionalExit"
  ) === "1";


let pendingTile = null;

let admin = false;


/* =========================================================
   UTILIDADES
========================================================= */

function $(id) {
  return document.getElementById(id);
}


function showScreen(id) {

  document
    .querySelectorAll(".screen")
    .forEach(x =>
      x.classList.remove("active")
    );

  const element = $(id);

  if (element) {
    element.classList.add("active");
  }
}


function toast(message) {

  const element =
    $("toast");

  if (!element) return;

  element.textContent =
    message;

  element.classList.add("show");

  clearTimeout(
    toast.timer
  );

  toast.timer =
    setTimeout(
      () =>
        element.classList.remove("show"),
      2500
    );
}


function esc(value) {

  return String(value)
    .replace(
      /[&<>"']/g,
      c => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[c])
    );
}


/* =========================================================
   SESIÓN
========================================================= */

function saveSession() {

  localStorage.setItem(
    "dominoPlayerId",
    pid
  );

  localStorage.setItem(
    "dominoRoom",
    roomCode
  );

  localStorage.setItem(
    "dominoName",
    playerName
  );

  /*
     Si estamos guardando sesión
     significa que el jugador está dentro.
  */

  localStorage.setItem(
    "dominoIntentionalExit",
    "0"
  );

  intentionallyLeft = false;
}


function clearSession() {

  localStorage.removeItem(
    "dominoPlayerId"
  );

  localStorage.removeItem(
    "dominoRoom"
  );

  localStorage.removeItem(
    "dominoName"
  );

  localStorage.removeItem(
    "dominoIntentionalExit"
  );

  pid = "";
  roomCode = "";
  playerName = "";

  intentionallyLeft = true;
}


/* =========================================================
   PUNTOS
========================================================= */

const pipMap = {

  0: [],

  1: [5],

  2: [1,9],

  3: [1,5,9],

  4: [1,3,7,9],

  5: [1,3,5,7,9],

  6: [1,3,4,6,7,9],

  7: [1,2,3,5,7,8,9],

  8: [1,2,3,4,6,7,8,9],

  9: [1,2,3,4,5,6,7,8,9]
};


/*
   Cada número tiene un color fijo.

   2 SIEMPRE azul.
*/

function pipGrid(number) {

  const visible =
    new Set(
      pipMap[number] || []
    );


  return Array.from(
    {length:9},
    (_,i) => {

      const position =
        i + 1;


      return `
        <i
          class="pip pip-${number}"
          style="
            visibility:
              ${
                visible.has(position)
                  ? "visible"
                  : "hidden"
              }
          "
        ></i>
      `;
    }
  ).join("");
}


function tileHTML(
  a,
  b,
  extra = ""
) {

  return `
    <div class="domino ${a === b ? "double" : ""} ${extra}">

      <div class="half">
        ${pipGrid(a)}
      </div>

      <div class="divider"></div>

      <div class="half">
        ${pipGrid(b)}
      </div>

    </div>
  `;
}


/* =========================================================
   BOTÓN SALIR
========================================================= */

function ensureExitButton() {

  if ($("leaveGame")) {
    return;
  }


  const actions =
    document.querySelector(
      ".game-top .top-actions"
    );


  if (!actions) {
    return;
  }


  const button =
    document.createElement(
      "button"
    );


  button.id =
    "leaveGame";


  button.className =
    "game-exit-btn";


  button.textContent =
    "Salir";


  button.onclick =
    leaveGame;


  actions.prepend(
    button
  );
}


function leaveGame() {

  if (
    !confirm(
      "¿Quieres salir de esta sala?"
    )
  ) {
    return;
  }


  /*
     Primero marcamos la salida
     para que F5 NO reconecte.
  */

  intentionallyLeft =
    true;


  localStorage.setItem(
    "dominoIntentionalExit",
    "1"
  );


  pendingTile = null;


  socket.emit(
    "leave-room"
  );


  clearSession();


  state = null;


  if ($("modal")) {
    $("modal")
      .classList
      .add("hidden");
  }


  if ($("sideModal")) {
    $("sideModal")
      .classList
      .add("hidden");
  }


  showScreen("home");


  toast(
    "Has salido de la sala."
  );
}


/* =========================================================
   CREAR / ENTRAR
========================================================= */

if ($("create")) {

  $("create").onclick =
    () => {

      playerName =
        $("name")
          .value
          .trim();


      if (!playerName) {

        toast(
          "Escribe tu nombre."
        );

        return;
      }


      /*
         Crear sala = nueva sesión.
      */

      intentionallyLeft = false;


      socket.emit(
        "create-room",
        {
          name:playerName,
          playerId:pid
        }
      );
    };
}


if ($("toggleJoin")) {

  $("toggleJoin").onclick =
    () => {

      $("joinBox")
        .classList
        .toggle(
          "hidden"
        );
    };
}


if ($("join")) {

  $("join").onclick =
    () => {

      playerName =
        $("name")
          .value
          .trim();


      roomCode =
        $("code")
          .value
          .trim()
          .toUpperCase();


      if (!playerName) {

        toast(
          "Escribe tu nombre."
        );

        return;
      }


      if (!roomCode) {

        toast(
          "Escribe el código."
        );

        return;
      }


      intentionallyLeft =
        false;


      saveSession();


      socket.emit(
        "join-room",
        {
          name:playerName,
          code:roomCode,
          playerId:pid
        }
      );
    };
}


if ($("code")) {

  $("code").oninput =
    e => {

      e.target.value =
        e.target.value
          .toUpperCase();
    };
}


if ($("back")) {

  $("back").onclick =
    leaveGame;
}


/* =========================================================
   SOCKET: JOINED
========================================================= */

socket.on(
  "joined",
  data => {

    pid =
      data.playerId;


    roomCode =
      data.room;


    intentionallyLeft =
      false;


    saveSession();
  }
);


/* =========================================================
   RECONEXIÓN / F5
========================================================= */

socket.on(
  "connect",
  () => {

    /*
       NO reconectar si el usuario
       había pulsado Salir.
    */

    if (
      intentionallyLeft
    ) {
      return;
    }


    if (
      pid &&
      roomCode &&
      playerName
    ) {

      socket.emit(
        "join-room",
        {
          name:playerName,
          code:roomCode,
          playerId:pid
        }
      );
    }
  }
);


/* =========================================================
   ESTADO
========================================================= */

socket.on(
  "state",
  newState => {

    state =
      newState;


    roomCode =
      state.code;


    /*
       El servidor confirma que seguimos
       dentro de la sala.
    */

    intentionallyLeft =
      false;


    saveSession();


    render();


    if (
      state.phase === "hand-result" ||
      state.phase === "finished"
    ) {

      showResult();

    } else {

      $("modal")
        ?.classList
        .add("hidden");
    }
  }
);


/* =========================================================
   ERROR
========================================================= */

socket.on(
  "game-error",
  message => {

    toast(message);
  }
);


/* =========================================================
   RENDER
========================================================= */

function render() {

  if (!state) {
    return;
  }


  if ($("lcode")) {
    $("lcode").textContent =
      state.code;
  }


  if ($("gcode")) {
    $("gcode").textContent =
      state.code;
  }


  if ($("count")) {
    $("count").textContent =
      `${state.players.length}/4`;
  }


  renderLobbyPlayers();

  renderScore();

  renderSeats();

  renderBoard();

  renderHand();


  const currentPlayer =
    state.players.find(
      p =>
        p.id ===
        state.turn
    );


  if ($("turn")) {

    $("turn").textContent =
      currentPlayer
        ? `Turno de ${currentPlayer.name}`
        : "";
  }


  if ($("starterBanner")) {

    const visible =
      state.phase ===
      "starter-choice";


    $("starterBanner")
      .classList
      .toggle(
        "hidden",
        !visible
      );


    if (visible) {

      $("starterBanner")
        .textContent =
          state.isStarterChoice
            ? "Te toca elegir la ficha de salida. Puedes escoger cualquiera."
            : "El jugador seleccionado está eligiendo la salida.";
    }
  }


  showScreen(
    state.phase === "lobby"
      ? "lobby"
      : "game"
  );


  ensureExitButton();
}


function renderLobbyPlayers() {

  if (!$("players")) {
    return;
  }


  $("players").innerHTML =
    state.players
      .map(
        p => `
          <div class="player">

            <div class="avatar">
              ${p.team === 0 ? "🧑🏻" : "🧑🏽"}
            </div>

            <div>

              <b>
                ${esc(p.name)}
                ${p.host ? " 👑" : ""}
              </b>

              <small>
                ${
                  state.mode === "team"
                    ? `Equipo ${p.team ? "B" : "A"}`
                    : "Individual"
                }

                ·

                ${
                  p.connected
                    ? "Conectado"
                    : "Desconectado"
                }

              </small>

            </div>

          </div>
        `
      )
      .join("");


  const me =
    state.players.find(
      p => p.id === pid
    );


  document
    .querySelectorAll("[data-v]")
    .forEach(button => {

      button.classList.toggle(
        "selected",
        Number(button.dataset.v) === state.variant
      );
      button.disabled = !me?.host;
    });


  document
    .querySelectorAll("[data-mode]")
    .forEach(button => {

      button.classList.toggle(
        "selected",
        button.dataset.mode === state.mode
      );
      button.disabled = !me?.host;
    });


  if ($("start")) {

    $("start").disabled =
      !me?.host ||
      state.players.length < 2;
  }
}


/* =========================================================
   CONFIGURACIÓN
========================================================= */

document
  .querySelectorAll("[data-v]")
  .forEach(button => {

    button.onclick =
      () => {

        socket.emit(
          "configure",
          {
            variant:
              Number(
                button.dataset.v
              )
          }
        );
      };
  });


document
  .querySelectorAll("[data-mode]")
  .forEach(button => {

    button.onclick =
      () => {

        socket.emit(
          "configure",
          {
            mode:
              button.dataset.mode
          }
        );
      };
  });


if ($("start")) {

  $("start").onclick =
    () => {

      socket.emit(
        "start-game"
      );
    };
}


/* =========================================================
   MARCADOR
========================================================= */

function renderScore() {

  if (!$("score")) {
    return;
  }


  const labels =
    state.mode === "team"
      ? [
          "Equipo A",
          "Equipo B"
        ]
      : state.players.map(
          p => p.name
        );


  $("score").innerHTML =
    state.scores
      .map(
        (score,index) => `

          <div class="score-item">

            <small>
              ${esc(
                labels[index] ||
                `Jugador ${index + 1}`
              )}
            </small>

            <b>
              ${score}
            </b>

          </div>

          ${
            index === 0
              ? '<div class="score-vs">VS</div>'
              : ""
          }

        `
      )
      .join("");
}


/* =========================================================
   POSICIONES DE MESA
========================================================= */

function relativeSeats() {

  const me =
    state.players.find(
      p => p.id === pid
    );


  if (!me) {
    return {};
  }


  const players =
    [...state.players]
      .sort(
        (a,b) =>
          a.seat - b.seat
      );


  const index =
    players.findIndex(
      p => p.id === me.id
    );


  const result = {
    self:me,
    left:null,
    right:null,
    top:null
  };


  if (players.length === 2) {

    result.top =
      players[
        (index + 1) %
        players.length
      ];

    return result;
  }


  if (players.length === 3) {

    result.left =
      players[
        (index + 1) %
        players.length
      ];

    result.right =
      players[
        (index + 2) %
        players.length
      ];

    return result;
  }


  result.left =
    players[
      (index + players.length - 1) %
      players.length
    ];


  result.right =
    players[
      (index + 1) %
      players.length
    ];


  result.top =
    players[
      (index + 2) %
      players.length
    ];


  return result;
}


function seatHTML(
  player,
  position
) {

  if (!player) {

    return `
      <div class="seat ${position}"></div>
    `;
  }


  const active =
    player.id ===
    state.turn;


  const count =
    state.hands[player.id]
      ?.count ??
    state.hands[player.id]
      ?.length ??
    0;


  return `

    <div
      class="
        seat
        ${position}
        ${active ? "active" : ""}
      "
    >

      <div class="seat-icon">
        ${
          player.team === 0
            ? "🧑🏻"
            : "🧑🏽"
        }
      </div>

      <div class="seat-name">

        ${esc(player.name)}

        ${
          player.host
            ? " 👑"
            : ""
        }

      </div>

      <small>

        ${
          state.mode === "team"
            ? `Equipo ${
                player.team
                  ? "B"
                  : "A"
              } · `
            : ""
        }

        ${count} fichas

      </small>

    </div>
  `;
}


function renderSeats() {

  if (!$("seats")) {
    return;
  }


  const seats =
    relativeSeats();


  $("seats").innerHTML =
    seatHTML(
      seats.left,
      "left"
    ) +
    seatHTML(
      seats.top,
      "top"
    ) +
    seatHTML(
      seats.right,
      "right"
    ) +
    seatHTML(
      seats.self,
      "self"
    );
}


/* =========================================================
   VALIDACIÓN LOCAL
========================================================= */

function canPlace(
  tile,
  side
) {

  if (!state.board.length) {
    return true;
  }


  const value =
    side === "left"
      ? state.board[0].left
      : state.board[
          state.board.length - 1
        ].right;


  return (
    tile.a === value ||
    tile.b === value
  );
}


function canPlay(tile) {

  return (
    canPlace(
      tile,
      "left"
    ) ||
    canPlace(
      tile,
      "right"
    )
  );
}


/* =========================================================
   MESA
========================================================= */

/*
   Este algoritmo es diferente al anterior.

   NO coloca las fichas simplemente
   en una columna.

   Primero genera una trayectoria:

       ← ← ←
             ↑
             ↑
       → → → → centro ← ← ←
                         ↓
                         ↓
                         → → →

   y cada ficha se coloca pegada
   a la anterior.

   La primera ficha está exactamente
   en el centro.
*/

function calculateBoardLayout() {

  const pieces = state.board;
  if (!pieces.length) return [];

  // La cadena lógica del servidor está ordenada de izquierda a derecha.
  // Visualmente la centramos y la hacemos crecer desde una ficha central,
  // doblando 90° cuando alcanza el límite de cada tramo.
  const normalW = 46;
  const normalH = 76;
  const turnStep = 62;
  const maxStraight = 7;
  const positions = new Array(pieces.length);
  const center = Math.floor((pieces.length - 1) / 2);

  function place(index, x, y, direction) {
    const piece = pieces[index];
    const isDouble = piece.left === piece.right;
    const normalRotation = direction === "horizontal" ? 90 : 0;
    // Los dobles parten de una ficha horizontal por CSS: quedan
    // perpendiculares a la dirección de la cadena.
    const rotation = isDouble
      ? (direction === "horizontal" ? 90 : 0)
      : normalRotation;

    positions[index] = {
      x,
      y,
      direction,
      rotation: ((rotation % 360) + 360) % 360,
      width: direction === "horizontal" ? normalH : normalW,
      height: direction === "horizontal" ? normalW : normalH
    };
  }

  place(center, 0, 0, "vertical");

  function grow(start, stepIndex, sign) {
    let x = 0;
    let y = 0;
    let direction = "vertical";
    let straightCount = 0;

    for (let i = start + stepIndex; i >= 0 && i < pieces.length; i += stepIndex) {
      const previous = positions[i - stepIndex];
      if (!previous) continue;

      const previousDirection = previous.direction;
      const shouldTurn = straightCount >= maxStraight;

      if (shouldTurn) {
        // Cada nuevo tramo se desplaza perpendicularmente y cambia de sentido.
        straightCount = 0;
        direction = previousDirection === "horizontal" ? "vertical" : "horizontal";
      } else {
        direction = previousDirection;
      }

      const currentIsDouble =
        pieces[i].left === pieces[i].right;
      const previousIsDouble =
        pieces[i - stepIndex].left === pieces[i - stepIndex].right;

      // Una ficha normal ocupa 76 px a lo largo de la cadena y un doble,
      // al colocarse perpendicular, ocupa 46 px. Así los bordes quedan unidos.
      const currentAlong = currentIsDouble ? normalW : normalH;
      const previousAlong = previousIsDouble ? normalW : normalH;
      const distance = (currentAlong + previousAlong) / 2;

      if (!shouldTurn) {
        if (direction === "horizontal") {
          x = previous.x + sign * distance;
          y = previous.y;
        } else {
          x = previous.x;
          y = previous.y + (sign > 0 ? distance : -distance);
        }
      } else {
        // En una esquina cambiamos de eje y dejamos el siguiente centro
        // en el borde del anterior.
        const lateral = turnStep;
        if (direction === "horizontal") {
          x = previous.x + sign * lateral;
          y = previous.y + (sign > 0 ? distance : -distance);
        } else {
          x = previous.x + sign * distance;
          y = previous.y + (sign > 0 ? lateral : -lateral);
        }
      }

      place(i, x, y, direction);
      straightCount += 1;
    }
  }

  // Construimos ambos extremos a partir del centro.
  // Para evitar solapes en cadenas largas, la ruta alterna horizontal/vertical.
  grow(center, 1, 1);
  grow(center, -1, -1);

  return positions;
}

function renderBoard() {

  const board =
    $("board");


  if (!board) {
    return;
  }


  board.innerHTML = "";


  if (!state.board.length) {

    board.style.width =
      "100%";

    board.style.height =
      "100%";

    if ($("empty")) {
      $("empty")
        .classList
        .remove("hidden");
    }

    return;
  }


  if ($("empty")) {
    $("empty")
      .classList
      .add("hidden");
  }


  const positions =
    calculateBoardLayout();


  const spacing = 60;


  const xs =
    positions
      .map(p => p.x);


  const ys =
    positions
      .map(p => p.y);


  const minX =
    Math.min(...xs);


  const maxX =
    Math.max(...xs);


  const minY =
    Math.min(...ys);


  const maxY =
    Math.max(...ys);


  const width =
    Math.max(
      420,
      maxX -
        minX +
        180
    );


  const height =
    Math.max(
      260,
      maxY -
        minY +
        180
    );


  board.style.width =
    `${width}px`;


  board.style.height =
    `${height}px`;


  const offsetX =
    -minX + 90;


  const offsetY =
    -minY + 90;


  state.board.forEach(
    (piece,index) => {

      const pos =
        positions[index];


      if (!pos) {
        return;
      }


      const element =
        document.createElement(
          "div"
        );


      const double =
        piece.left ===
        piece.right;


      const starter =
        state.starterChoice &&
        piece.id ===
          state.starterChoice.tileId;


      element.className =
        `
          board-piece
          ${double ? "double" : ""}
          ${starter ? "starter-piece" : ""}
        `;


      element.innerHTML =
        tileHTML(
          piece.left,
          piece.right
        );


      /*
         IMPORTANTE:

         La posición representa
         el CENTRO de la ficha.

         Así no se generan separaciones
         entre los números.
      */

      const left =
        offsetX +
        pos.x -
        23;


      const top =
        offsetY +
        pos.y -
        38;


      element.style.left =
        `${left}px`;


      element.style.top =
        `${top}px`;


      element.style.transform =
        `rotate(${pos.rotation}deg)`;


      element.dataset.index =
        index;


      board.appendChild(
        element
      );
    }
  );
}


/* =========================================================
   MANO
========================================================= */

function renderHand() {

  if (!$("hand")) {
    return;
  }


  const hand =
    state.hands[pid] || [];


  if ($("hc")) {
    $("hc").textContent =
      `${hand.length} fichas`;
  }


  $("hand").innerHTML =
    "";


  const starter =
    state.phase ===
      "starter-choice" &&
    state.isStarterChoice;


  const myTurn =
    state.phase ===
      "playing" &&
    state.turn === pid;


  hand.forEach(tile => {

    const button =
      document.createElement(
        "button"
      );


    button.className =
      `
        hand-tile
        ${starter ? "starter-select" : ""}
      `;


    button.innerHTML =
      tileHTML(
        tile.a,
        tile.b
      );


    let allowed =
      starter;


    if (myTurn) {

      allowed =
        canPlay(tile);

    }


    button.disabled =
      !allowed;


    if (allowed) {

      button.onclick =
        () => {

          if (starter) {

            socket.emit(
              "choose-starter",
              {
                tileId:
                  tile.id
              }
            );

          } else {

            chooseSide(
              tile
            );
          }
        };
    }


    $("hand")
      .appendChild(
        button
      );
  });
}


/* =========================================================
   ELEGIR EXTREMO
========================================================= */

function chooseSide(tile) {

  const left =
    canPlace(
      tile,
      "left"
    );


  const right =
    canPlace(
      tile,
      "right"
    );


  if (!left && !right) {

    toast(
      "Esa ficha no puede colocarse."
    );

    return;
  }


  if (
    left &&
    right &&
    state.board.length
  ) {

    pendingTile =
      tile;


    const leftValue =
      state.board[0].left;


    const rightValue =
      state.board[
        state.board.length - 1
      ].right;


    if ($("sideChoices")) {

      $("sideChoices").innerHTML = `

        <button
          class="side-choice"
          id="chooseLeft"
        >

          <strong>
            IZQUIERDA
          </strong>

          <span>
            ${leftValue}
          </span>

        </button>


        <button
          class="side-choice"
          id="chooseRight"
        >

          <strong>
            DERECHA
          </strong>

          <span>
            ${rightValue}
          </span>

        </button>
      `;
    }


    $("sideModal")
      ?.classList
      .remove("hidden");


    $("chooseLeft").onclick =
      () => sendSide("left");


    $("chooseRight").onclick =
      () => sendSide("right");


    return;
  }


  sendSide(
    left
      ? "left"
      : "right",
    tile
  );
}


function sendSide(
  side,
  tile = pendingTile
) {

  if (!tile) {
    return;
  }


  /*
     Segunda comprobación
     antes de mandar la jugada.
  */

  if (!canPlace(tile,side)) {

    toast(
      "Ese extremo ya no acepta esa ficha."
    );

    pendingTile =
      null;

    $("sideModal")
      ?.classList
      .add("hidden");

    return;
  }


  socket.emit(
    "play-tile",
    {
      tileId:
        tile.id,

      side
    }
  );


  pendingTile =
    null;


  $("sideModal")
    ?.classList
    .add("hidden");
}


if ($("cancelChoice")) {

  $("cancelChoice").onclick =
    () => {

      pendingTile =
        null;

      $("sideModal")
        .classList
        .add("hidden");
    };
}


/* =========================================================
   RESULTADO
========================================================= */

function showResult() {

  const result =
    state.lastResult;


  if (!result) {
    return;
  }


  $("modal")
    ?.classList
    .remove("hidden");


  if ($("icon")) {
    $("icon").textContent =
      state.phase === "finished"
        ? "🏆"
        : "🎲";
  }


  let winnerName =
    "Ganador";


  if (
    state.mode === "team"
  ) {

    winnerName =
      result.winningTeam === null
        ? "Empate"
        : `Equipo ${
            result.winningTeam
              ? "B"
              : "A"
          }`;

  } else {

    const p =
      state.players.find(
        x =>
          x.id ===
          result.winningPlayer
      );


    if (p) {
      winnerName =
        p.name;
    }
  }


  if ($("mtitle")) {

    $("mtitle").textContent =
      state.phase === "finished"
        ? `${winnerName} gana la partida`
        : `${winnerName} gana la mano`;
  }


  if ($("mtext")) {

    $("mtext").textContent =
      result.reason ===
        "trancada"

        ? `Tranca: ${result.detail}.`

        : result.reason ===
            "empate-tranca"

          ? `Empate: ${result.detail}. Se juega otra mano.`

          : `${result.detail} se quedó sin fichas.`;
  }


  if ($("mscore")) {

    $("mscore").textContent =
      result.reason === "empate-tranca"
        ? "Sin puntos"
        : `+${result.awarded} puntos`;
  }


  if ($("next")) {

    $("next")
      .classList
      .toggle(
        "hidden",
        state.phase ===
          "finished"
      );
  }


  if ($("again")) {

    $("again")
      .classList
      .toggle(
        "hidden",
        state.phase !==
          "finished"
      );
  }
}


if ($("next")) {

  $("next").onclick =
    () => {

      socket.emit(
        "next-hand"
      );
    };
}


if ($("again")) {

  $("again").onclick =
    () => {

      socket.emit(
        "new-match"
      );
    };
}


/* =========================================================
   COPIAR ENLACE
========================================================= */

if ($("copy")) {

  $("copy").onclick =
    async () => {

      const url =
        `${location.origin}/?room=${state.code}`;


      try {

        await navigator.clipboard
          .writeText(url);

        toast(
          "Enlace copiado."
        );

      } catch {

        toast(url);
      }
    };
}


/* =========================================================
   HORIZONTAL
========================================================= */

if ($("landscape")) {

  $("landscape").onclick =
    async () => {

      try {

        if (
          !document.fullscreenElement
        ) {

          await document
            .documentElement
            .requestFullscreen();
        }


        if (
          screen.orientation?.lock
        ) {

          await screen.orientation
            .lock(
              "landscape"
            );
        }


        toast(
          "Modo horizontal activado."
        );

      } catch {

        toast(
          "Gira el teléfono manualmente."
        );
      }
    };
}


/* =========================================================
   SONIDO
========================================================= */

if ($("sound")) {

  $("sound").onclick =
    () => {

      const button =
        $("sound");


      button.textContent =
        button.textContent ===
          "🔊"
            ? "🔇"
            : "🔊";
    };
}


/* =========================================================
   ADMIN
========================================================= */

if ($("adminBtn")) {

  $("adminBtn").onclick =
    () => {

      $("adminModal")
        ?.classList
        .remove("hidden");
    };
}


if ($("gameAdmin")) {

  $("gameAdmin").onclick =
    () => {

      $("adminModal")
        ?.classList
        .remove("hidden");
    };
}


if ($("closeAdmin")) {

  $("closeAdmin").onclick =
    () => {

      $("adminModal")
        ?.classList
        .add("hidden");
    };
}


if ($("adminLoginBtn")) {

  $("adminLoginBtn").onclick =
    () => {

      socket.emit(
        "admin-auth",
        {
          password:
            $("adminPassword")
              .value
        }
      );
    };
}


socket.on(
  "admin-auth-result",
  result => {

    if (!result.ok) {

      toast(
        "Contraseña incorrecta."
      );

      return;
    }


    admin = true;


    $("adminLogin")
      ?.classList
      .add("hidden");


    $("adminPanel")
      ?.classList
      .remove("hidden");


    socket.emit(
      "admin-refresh"
    );
  }
);


socket.on(
  "admin-rooms",
  rooms => {

    renderAdmin(
      rooms
    );
  }
);


function renderAdmin(rooms) {

  if (!admin) {
    return;
  }


  const container =
    $("adminRooms");


  if (!container) {
    return;
  }


  container.innerHTML =
    rooms.length

      ? rooms.map(
          room => `

            <div class="admin-room">

              <h3>
                Sala ${room.code}
              </h3>

              <p>
                ${room.players.length}
                jugadores ·
                Doble-${room.variant} ·
                ${
                  room.mode === "team"
                    ? "Equipos"
                    : "Individual"
                } ·
                ${room.phase}
              </p>

              <div>

                <select
                  data-admin-mode="${room.code}"
                >

                  <option
                    value="team"
                    ${
                      room.mode === "team"
                        ? "selected"
                        : ""
                    }
                  >
                    Equipos
                  </option>

                  <option
                    value="individual"
                    ${
                      room.mode === "individual"
                        ? "selected"
                        : ""
                    }
                  >
                    Individual
                  </option>

                </select>


                <select
                  data-admin-variant="${room.code}"
                >

                  <option
                    value="6"
                    ${
                      room.variant === 6
                        ? "selected"
                        : ""
                    }
                  >
                    Doble-6
                  </option>

                  <option
                    value="9"
                    ${
                      room.variant === 9
                        ? "selected"
                        : ""
                    }
                  >
                    Doble-9
                  </option>

                </select>


                <button
                  data-admin-start="${room.code}"
                >
                  ▶ Iniciar
                </button>

              </div>


              ${room.players
                .map(
                  p => `

                    <div class="admin-player">

                      <input
                        value="${esc(p.name)}"
                        data-admin-name="${room.code}:${p.id}"
                      >


                      <select
                        data-admin-team="${room.code}:${p.id}"
                        ${
                          room.mode ===
                          "individual"
                            ? "disabled"
                            : ""
                        }
                      >

                        <option
                          value="0"
                          ${
                            p.team === 0
                              ? "selected"
                              : ""
                          }
                        >
                          Equipo A
                        </option>

                        <option
                          value="1"
                          ${
                            p.team === 1
                              ? "selected"
                              : ""
                          }
                        >
                          Equipo B
                        </option>

                      </select>


                      <button
                        data-admin-save="${room.code}:${p.id}"
                      >
                        Guardar
                      </button>


                      <button
                        data-admin-host="${room.code}:${p.id}"
                      >
                        👑
                      </button>

                    </div>
                  `
                )
                .join("")}

            </div>
          `
        ).join("")

      : "<p>No hay salas activas.</p>";


  document
    .querySelectorAll(
      "[data-admin-mode]"
    )
    .forEach(el => {

      el.onchange =
        () => {

          socket.emit(
            "admin-change",
            {
              code:
                el.dataset
                  .adminMode,

              action:
                "mode",

              value:
                el.value
            }
          );
        };
    });


  document
    .querySelectorAll(
      "[data-admin-variant]"
    )
    .forEach(el => {

      el.onchange =
        () => {

          socket.emit(
            "admin-change",
            {
              code:
                el.dataset
                  .adminVariant,

              action:
                "variant",

              value:
                Number(el.value)
            }
          );
        };
    });


  document
    .querySelectorAll(
      "[data-admin-start]"
    )
    .forEach(el => {

      el.onclick =
        () => {

          socket.emit(
            "admin-change",
            {
              code:
                el.dataset
                  .adminStart,

              action:
                "start"
            }
          );
        };
    });


  document
    .querySelectorAll(
      "[data-admin-save]"
    )
    .forEach(el => {

      el.onclick =
        () => {

          const [
            code,
            playerId
          ] =
            el.dataset
              .adminSave
              .split(":");


          const nameInput =
            document.querySelector(
              `[data-admin-name="${code}:${playerId}"]`
            );


          const teamInput =
            document.querySelector(
              `[data-admin-team="${code}:${playerId}"]`
            );


          socket.emit(
            "admin-change",
            {
              code,
              action:
                "rename",
              value:{
                id:playerId,
                name:nameInput.value
              }
            }
          );


          if (
            teamInput &&
            !teamInput.disabled
          ) {

            socket.emit(
              "admin-change",
              {
                code,
                action:
                  "team",
                value:{
                  id:playerId,
                  team:
                    Number(
                      teamInput.value
                    )
                }
              }
            );
          }
        };
    });


  document
    .querySelectorAll(
      "[data-admin-host]"
    )
    .forEach(el => {

      el.onclick =
        () => {

          const [
            code,
            playerId
          ] =
            el.dataset
              .adminHost
              .split(":");


          socket.emit(
            "admin-change",
            {
              code,
              action:
                "host",
              value:{
                id:playerId
              }
            }
          );
        };
    });
}


/* =========================================================
   ENLACE DIRECTO A SALA
========================================================= */

const roomFromURL =
  new URLSearchParams(
    location.search
  ).get("room");


if (
  roomFromURL &&
  !intentionallyLeft
) {

  roomCode =
    roomFromURL
      .toUpperCase();


  if ($("joinBox")) {

    $("joinBox")
      .classList
      .remove("hidden");
  }


  if ($("code")) {

    $("code").value =
      roomCode;
  }
}


if ($("name") && playerName) {

  $("name").value =
    playerName;
}


/* =========================================================
   BOTÓN SALIR
========================================================= */

ensureExitButton();
