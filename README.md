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
test/       sim.js (reglas) y server.test.js (flujo completo del servidor)
```
