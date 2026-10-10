# Dominó Cubano Online

Dominó cubano en tiempo real para 2–4 jugadores (PC, Android, iPhone/iPad).
Node.js + Express + Socket.IO. Meta: 100 puntos.

## Reglas implementadas
- Modo **Equipos** (2 contra 2, compañeros frente a frente) o **Individual** (2–4).
- **Doble-6** (7 fichas c/u) o **Doble-9** (10 fichas c/u). El servidor reparte al azar.
- Primera mano: sale un equipo al azar y un jugador al azar de ese equipo, con **cualquier ficha**.
  Manos siguientes: sale quien ganó la anterior.
- Sin robo ni soplar. Quien no tiene ficha **pasa automáticamente**.
- Gana la mano quien se queda sin fichas o, en **tranca**, quien tenga la **menor suma individual**.
  Empate en la menor suma: nadie puntúa y se juega otra mano.
- El ganador suma los puntos de las fichas que le quedan al contrario.
- **F5** reconecta al mismo asiento; **Salir** borra la sesión. Si alguien sale en plena
  partida, el servidor juega por él para no dejar colgados a los demás.
- El servidor valida cada jugada (turno, ficha en tu mano, extremo correcto).

## Funciones de esta versión
- **Organizar la mano:** botón «↔ Organizar»: arrastra para cambiar el orden y toca una ficha
  para girarla (elige qué número va arriba). Solo se ve en tu pantalla y se recuerda aunque
  recargues. Al llegar tu turno el modo organizar se apaga solo.
- **Espectadores:** quien entra con los 4 asientos ocupados, o con la partida empezada, mira
  desde un bloque aparte. En el lobby el anfitrión pasa a cualquiera de jugador a espectador
  y al revés. Los espectadores ven la mesa pero no las manos.
- **Admin con control total** (⚙ Admin en la pantalla de inicio): ver la partida con todas las
  manos, cambiar modo/variante, nombres, equipos, anfitrión, mover jugadores/espectadores,
  expulsar, ajustar el marcador, siguiente mano, jugada automática, reiniciar, volver a la sala
  y cerrar salas.
- **Fondo, imágenes y sonidos (solo el administrador):** el admin elige la foto de la mesa, las
  imágenes de ganador y perdedor y los sonidos de ganar, perder, pase y capicúa; **todos los jugadores lo ven y lo oyen**. Se cambia en
  ⚙ Admin > «Apariencia». Cada jugador oye el de ganar si su equipo gana y el de perder si
  pierde. Hay un control para que suenen cada mano o solo al terminar la partida.
  - Cambio rápido: desde el panel (se guarda en el servidor; en Render gratis se borra al reiniciar).
  - Cambio permanente: pon los archivos (`fondo`, `ganador`, `perdedor`, `ganar`, `perder`,
    `pase`, `capicua`, `azote`) en `public/theme/` y súbelos a GitHub (ver `public/theme/LEEME.txt`).

## Vista 2D y 3D
- **2D (por defecto):** ligera, ideal para ahorrar datos y batería.
- **3D:** el botón de arriba (o el de la pantalla de inicio) recorre **2D → 3D primera persona → 3D mesa**.
  El motor 3D (`public/table3d.js`, ~19 KB comprimidos, sin librerías externas) **solo se descarga
  si alguien activa el 3D**. Cada jugador elige su vista; no afecta a los demás. Si el dispositivo
  no soporta WebGL, avisa y se queda en 2D.
- **3D primera persona:** ves la mesa desde tu asiento. Tu compañero está al frente y los rivales a
  los lados (con sus fichas de espaldas); la etiqueta de cada uno muestra nombre, equipo y fichas.
  Arrastra un dedo (o el ratón) por la mesa para **mirar a los lados**, pellizca o usa ＋ / － para
  el zoom y ◎ para centrar la vista. Tus fichas están en 3D abajo: **arrástralas hasta la mesa** con
  tu propio brazo (se resalta el extremo más cercano). «↔ Organizar» te deja mover y girar tus fichas.
- **3D mesa:** vista aérea con perspectiva y la mano normal abajo. Los espectadores siempre usan esta.
- En 3D las fichas quedan un poco corridas y torcidas, y se ven los brazos de cada jugador.
- **Azotar la última ficha (solo 3D):** cuando te queda una sola ficha en tu turno aparece el botón
  «💥 Azotar la ficha». Si lo activas y ganas la mano, tu brazo la levanta y la estrella contra la
  mesa: sacude la cámara, las demás fichas saltan y quedan desordenadas, y todos oyen el golpe
  (sonido editable por el admin). Quien juega en 2D ve el aviso y una sacudida.

## Reglas añadidas en esta versión
- **Sale el equipo ganador:** en las manos siguientes, cualquiera de los integrantes del equipo
  que ganó la mano anterior puede poner la primera ficha (el primero que la elija).
  En modo individual sale el ganador.
- **Capicúa:** si ganas la mano colocando tu última ficha y esa ficha encaja en LOS DOS extremos
  (que valen lo mismo), ganas un bonus de **+30 puntos** además de las fichas del contrario.
  Se puede desactivar en la sala de espera (anfitrión) o desde el panel de admin.
  El bonus se cambia en `game.js` (`CAPICUA_BONUS`).
- **Pase:** suena un sonido cuando alguien pasa (editable por el admin).
- **Tiempo por turno:** 30 segundos. Al acabarse, el servidor juega por esa persona (la ficha de
  más puntos que pueda jugar). Se cambia con la variable de entorno `TURN_SECONDS`.
- **Imágenes de ganadores y perdedores:** distintas para cada uno, las elige el admin.

## Probar en tu computadora
```bash
npm install
npm start          # http://localhost:10000
npm test           # simula miles de partidas y el flujo del servidor
```

## Subir a GitHub y publicar en Render
1. Crea un repositorio y sube **el contenido de esta carpeta** (`server.js`, `game.js`,
   `package.json`, `render.yaml`, `public/`, `test/`...).
2. En Render: *New > Blueprint* (usa `render.yaml`) o *New > Web Service* con
   Build `npm install` y Start `npm start`.
3. En Render, **Environment > ADMIN_PASSWORD**: escribe tu contraseña de administrador.
   (Si no la defines, se genera una al arrancar y aparece en los *Logs*.)
4. Comparte el enlace `https://tu-app.onrender.com/?room=CODIGO` o solo el código.

## Notas
- Las salas viven en memoria: si Render reinicia o se duerme el servicio (plan gratis),
  las partidas en curso se pierden. Para uso entre amigos suele bastar.
- Con el plan gratis el primer acceso tras un rato de inactividad tarda ~30 s en despertar.

## Estructura
```
server.js   Express + Socket.IO (salas, reconexión, administrador)
game.js     reglas del juego (reparto, turnos, tranca, puntuación)
public/     index.html, app.js, styles.css, manifest.json, iconos
test/       sim.js (reglas) y server.test.js (flujo completo, espectadores y admin)
```
