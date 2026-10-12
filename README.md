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
  El motor 3D (`public/table3d.js`, ~29 KB comprimidos, sin librerías externas) **solo se descarga
  si alguien activa el 3D**. Cada jugador elige su vista; no afecta a los demás. Si el dispositivo
  no soporta WebGL, avisa y se queda en 2D.
- **3D primera persona:** ves la mesa desde tu asiento. Tu compañero está al frente y los rivales a
  los lados (con sus fichas de espaldas); la etiqueta de cada uno muestra nombre, equipo y fichas.
  Arrastra un dedo (o el ratón) por la mesa para **mirar a los lados**, pellizca o usa ＋ / － para
  el zoom y ◎ para centrar la vista. Tus fichas están en 3D abajo: **arrástralas hasta la mesa** con
  tu propio brazo (se resalta el extremo más cercano). «↔ Organizar» te deja mover y girar tus fichas.
- **3D mesa:** vista aérea con perspectiva y la mano normal abajo. Los espectadores siempre usan esta.
- **Ambiente:** un portal de La Habana al atardecer: suelo de baldosas hidráulicas, fachadas
  coloniales de colores con balcones, persianas, letreros y la bandera, coches clásicos, palmeras
  y luces. La mesa es de madera, con el paño de siempre (o tu foto de fondo).
- **Ojos a la altura de tu compañero**, que está sentado frente a ti.
- **Avatares:** cada jugador elige el color de su camisa y su tono de piel (🎨 Mi avatar, en el
  inicio y en la sala). Los demás lo ven así. En equipos llevan además gorra o cinta del color del equipo.
- **Botella de ron y vasos:** hay una botella *Havana Club* en una esquina al azar de la mesa (la misma
  para todos) y un vaso de plástico transparente para cada jugador. Con 🥃 bebes y con 🍾 te sirves:
  se ve tu brazo y el de los demás haciéndolo, el nivel del vaso y de la botella baja, y se oye.
  Si el vaso está vacío o la botella se acabó, avisa. (Solo se ve en la primera persona.)
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

---

## Cambios de la versión 3D realista

- **Escala real**: la ficha mide ≈5 cm; la mesa ≈1 m de lado y 80 cm de alto; las personas, el vaso (≈10 cm) y la botella (≈30 cm) se dibujan a tamaño real. La cámara en primera persona está a la altura de los ojos de tu avatar (arrastra para mirar a los lados y hacia arriba; los jugadores fuera de pantalla tienen su etiqueta pegada al borde).
- **Atril en el mundo**: tus fichas están sobre la mesa, recostadas en una tablilla de madera con las caras hacia ti. Ya no son un HUD pegado a la pantalla: si mueves la vista, se mueven con la mesa. Los rivales tienen su atril con las fichas de espaldas.
- **Beber / servir**: se oculta el brazo en reposo mientras dura la acción (antes se veían 3 manos) y los brazos usan la misma escala en todas las vistas. El vaso está abierto por arriba y el ron sigue su forma.
- **Modo debug (admin)**: Admin → «Crear sala de pruebas» crea una sala ya empezada con 3 bots. Dentro, el botón 🛠 abre un panel: beber/servir por cualquier jugador, niveles de vaso y botella, azote, capicúa, pase, recortar la mano, repartir de nuevo, pausar los bots, jugada automática y deslizadores de cámara/atril (se guardan en el navegador).

Pruebas: `npm test` (incluye `test/render-smoke.js`, que dibuja el 3D con un WebGL simulado, y `test/debug-room.test.js`, que prueba la sala de pruebas sin instalar dependencias).

## Mesa tipo «de verdad», colecta de CUC y pantalla completa

- **Mesa como la de la foto** (≈82 cm): marco de madera alrededor de la zona de juego, huecos redondos en las 4 esquinas donde van los **vasos** y una tablilla de madera en cada lado donde se recuestan las fichas.
- **Colecta para rellenar la botella** (botón 🪙 en la vista 3D): cuando la botella se está acabando, cada jugador pone **1 CUC** en el plato redondo (esquina lejana izquierda). Cuando han puesto todos, la botella vacía **se queda en la esquina** y cae una botella nueva al lado. El botón muestra cuántos han puesto (p. ej. 2/4).
- **Nombres fuera de la mesa**: en 3D primera persona los jugadores aparecen en una tira encima de la mesa, no sobre ella.
- **Pantalla completa (⛶)**: esconde marcador, estado, nombres y demás; queda solo la pantalla de jugar. La ✕ de arriba a la derecha (o Esc) la cierra.
- **Audios fijos**: en ⚙ Admin > Apariencia cada archivo dice si es 🔒 **fijo** (viene de `public/theme/`) o ⚠ **temporal** (subido por el panel; Render gratis lo borra al reiniciar). El botón «Descargar lo subido para dejarlo fijo» baja un zip con los nombres correctos: cópialos a `public/theme/`, súbelos a GitHub y no se pierden nunca.
- Debug: nuevos botones «Poner su CUC» y «Completar colecta».
