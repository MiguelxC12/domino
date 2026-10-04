# Dominó Cubano Online — GitHub + Render

Este paquete está preparado para publicarse sin instalar Node.js en tu computadora.

## Cómo publicarlo

1. Crea un repositorio nuevo en GitHub.
2. Sube todos los archivos y carpetas de este proyecto.
3. En Render: **New → Web Service**.
4. Conecta tu cuenta de GitHub y selecciona el repositorio.
5. Usa:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free para pruebas
6. Pulsa **Create Web Service**.

El archivo `render.yaml` ya contiene esta configuración y la comprobación de salud.

## Importante

Las salas activas y las estadísticas de esta versión se guardan en memoria. Si el servicio se reinicia, se pierden. Para una versión pública definitiva conviene añadir una base de datos persistente.

No necesitas instalar Node.js localmente: Render instala y ejecuta Node en el servidor.

## Reglas incluidas

4 jugadores, 2 equipos, Doble-6/Doble-9, salida elegida por un jugador del equipo seleccionado al azar, jugadas validadas en servidor, tranca por menor valor individual, puntos del equipo perdedor y victoria a 100.
