# Dominó Cubano Online v2

Versión preparada para GitHub + Render y para pruebas locales.

## Cambios de esta versión

- F5/recarga mantiene al jugador en la sala mediante localStorage + reconexión Socket.IO.
- Diseño responsive y botón para solicitar orientación horizontal en teléfonos.
- Jugadores representados alrededor de la mesa: tú abajo, anterior a la izquierda, siguiente a la derecha y compañero/opuesto arriba.
- Cadena visual que serpentea/dobla en filas en vez de bajar indefinidamente.
- Dobles horizontales en la mesa.
- Fichas mostradas como puntos/pips; cada punto usa un color distinto.
- La ficha inicial elegida queda resaltada en dorado.
- Primera mano: equipo/jugador de salida elegido al azar. Manos siguientes: sale el ganador de la mano anterior.
- Anfitrión puede cambiar Doble-6/Doble-9 y modo equipos/individual en la sala.
- Partida puede iniciar con 2 o más jugadores. En modo equipos se permiten 2-4 jugadores; en individual 2-4.
- Si una ficha puede ir por ambos extremos, aparece un selector grande de izquierda/derecha mostrando los extremos.
- Modo administrador con contraseña 07020263524: salas, nombres, equipos, modo, variante, anfitrión e inicio.
- Las reglas importantes se validan en servidor.

## Render

- Build: `npm install`
- Start: `npm start`
- Plan: Free para pruebas.
- `render.yaml` ya está incluido.

## Local sin Node

Para jugar localmente con esta arquitectura se necesita ejecutar el servidor Node. XAMPP/Apache no sustituye Socket.IO/Node. Si quieres evitar instalar Node en Windows, puedes desplegar este mismo repositorio en Render y probarlo desde el navegador.

## Persistencia

Las salas y estadísticas de esta versión están en memoria. Un reinicio del servidor borra las salas y estadísticas. Para producción conviene añadir una base de datos persistente.

## Seguridad del administrador

La contraseña está en el servidor para esta versión de prototipo. Para una versión pública definitiva debe moverse a una variable secreta de Render y usar autenticación de administrador más robusta.
