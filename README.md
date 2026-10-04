# 🎲 Dominó Cubano Online

Juego de dominó cubano multijugador en tiempo real para 2–4 amigos.

## Stack

- Node.js
- Express 5
- Socket.IO 4
- HTML / CSS / JavaScript
- Render + GitHub

## Reglas implementadas

- Doble-6: 28 fichas, 7 por jugador.
- Doble-9: 55 fichas, 10 por jugador.
- Modo equipos e individual.
- Primera salida sorteada; el jugador elegido puede escoger cualquier ficha.
- En equipos, el equipo ganador de la mano anterior conserva la salida y se elige un jugador de ese equipo.
- En individual, el ganador de la mano anterior sale en la siguiente.
- La ficha inicial queda centrada y resaltada.
- Sin robo y sin soplar.
- Si el jugador no tiene jugada legal, el turno pasa automáticamente.
- Si todos los jugadores pasan, se declara trancada.
- En trancada se compara el valor individual de cada jugador; un empate produce otra mano sin puntos.
- Al quedarse sin fichas se gana la mano.
- El ganador recibe el valor de las fichas restantes de los contrarios.
- La partida termina al llegar a 100 puntos.
- F5/reconexión conserva la sesión mientras la sala exista en el servidor.
- El botón Salir elimina la sesión local y abandona realmente la sala.
- Las jugadas se validan en el servidor.

## Subir a GitHub y desplegar en Render

1. Crea un repositorio en GitHub.
2. Sube **el contenido de esta carpeta**, de forma que `server.js` y `package.json` queden en la raíz del repositorio.
3. En Render crea un Web Service desde ese repositorio.
4. `render.yaml` ya define:
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/api/health`
5. Define `ADMIN_PASSWORD` como secreto de Render. El proyecto no guarda una contraseña de administrador en el código.
6. Abre la URL de Render y comparte el código/enlace de la sala con tus amigos.

## Prueba local

Necesitas Node.js instalado.

```bash
npm install
npm start
```

Después abre `http://localhost:10000`.

En Windows PowerShell puedes definir la contraseña de administrador para esa sesión con:

```powershell
$env:ADMIN_PASSWORD="tu-clave"
npm start
```

## Persistencia

Las salas viven en memoria. Si Render reinicia el proceso, las salas y partidas activas desaparecen. Esto es intencional para esta versión de juego entre amigos; una versión pública permanente debería añadir almacenamiento persistente.

## Seguridad

- El servidor valida turno, propiedad de ficha y extremo válido.
- Los jugadores nuevos no pueden entrar a una partida ya iniciada.
- La contraseña de administrador se toma de `ADMIN_PASSWORD`.
- Para una versión pública grande conviene añadir autenticación y rate limiting más completos.
