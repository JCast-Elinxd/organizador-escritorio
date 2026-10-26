# Organizador de pantalla secundaria (MVP)

App de escritorio para Windows hecha con Electron. Todo se guarda localmente
(nada de nube): tareas, eventos y configuración viven en archivos JSON
dentro de tu carpeta de usuario de Windows.

## Layout: adaptable, con mínimos garantizados

- **Franja superior**: contiene la zona de video + el cronograma. Su alto
  y ancho son completamente ajustables entrando en modo edición (🎬),
  dentro de la misma ventana (sin ventana flotante aparte).
- **Franja inferior (temporizador + calendario)**: se adapta al tamaño de
  la zona, pero **nunca baja de 20% de la altura de la pantalla** —
  aunque agrandes la zona al máximo, siempre les queda ese mínimo.
- **Paneles laterales superiores (cronograma / pieza junto a la zona)**:
  igual, se adaptan al ancho de la zona, pero **nunca bajan de 13% del
  ancho de la pantalla**. Este límite se respeta **en vivo** mientras
  arrastras (no solo al soltar el clic, con un salto brusco).
- **Calendario**: tiene su propio tope de tamaño máximo, **33% del ancho
  y 33% del alto de la pantalla**, sin importar cuánto crezca la columna
  de la zona/cronograma. Siempre queda anclado a la esquina inferior
  derecha, dibujado **encima** de la esquina del temporizador. Ver más
  abajo.

### El cronograma es el único que se divide en dos

La zona de video vive siempre arriba y puedes moverla/redimensionarla
(ancho, alto y posición horizontal) con libertad, dentro de esos mínimos.
El cronograma ocupa lo que sobra de esa franja:

- Si la zona toca el borde izquierdo → el cronograma es **una sola pieza**
  a la derecha (el caso más común).
- Si la zona queda flotando sin tocar el borde izquierdo (y ese espacio
  sobrante alcanza el mínimo de 13% de pantalla) → aparece una **segunda
  pieza** de cronograma a la izquierda de la zona, con el mismo estilo,
  para que no quede espacio muerto. (Esa pieza izquierda es decorativa —
  el listado de tareas en sí vive siempre en la pieza principal de la
  derecha, así no se corta a la mitad.) Si el espacio sobrante es menor a
  ese mínimo, la app directamente no lo deja aparecer: la zona se ajusta
  para no crear una franja inútil. Este umbral también se respeta **en
  vivo** mientras arrastras (antes solo se corregía al soltar el clic):
  al pasar la mitad del mínimo, salta directo al 13%, sin mostrar
  primero una franja diminuta.

### Cronograma hasta abajo, sin pieza extra ni L

El calendario tiene su propio tope máximo de **33% del ancho** y **33%
del alto** de la pantalla, sin depender 1:1 del cronograma. Para que esto
nunca requiera crear una pieza extra ni una forma en L (una sola caja CSS
no puede tener forma de L — es geometría básica), ningún panel cambia de
forma: en vez de eso, se superponen en un orden fijo.

- El **cronograma** (tareas) se extiende **hasta el fondo de la
  pantalla** (alto completo, no solo la franja de arriba) y queda **por
  encima** del temporizador donde se solapen.
- El **temporizador** sigue siendo un rectángulo simple de ancho
  completo, por debajo del cronograma.
- El **calendario** siempre queda **arriba de todo**, en su esquina
  inferior derecha, con el tamaño que le corresponda según su tope de 33%.

Resultado: **ningún panel se divide jamás** — cronograma, temporizador y
calendario son siempre cuadros simples e intocados; solo cambia qué se ve
"encima" de qué cuando sus áreas se cruzan.

El calendario siempre queda anclado a la esquina inferior derecha de la
pantalla, tenga el tamaño que tenga. Con el tamaño por defecto de la app
(zona al 45% de ancho), el calendario ya arranca topado por defecto — es
un comportamiento esperado, no un error.

## Cómo mover/redimensionar la zona de video (sin ventana flotante)

1. Clic en 🎬. La zona de video entra en **modo edición** dentro de la
   misma ventana (borde resaltado + un tirador en la esquina inferior
   derecha). El botón cambia a 🔓.
2. **Arrastra el cuerpo de la zona** para moverla horizontalmente.
   **Arrastra el tirador de la esquina** para cambiar su ancho y su alto
   a la vez.
3. El cambio se aplica en vivo mientras arrastras, y se guarda solo al
   soltar el clic — siempre respetando los mínimos de 20% de pantalla
   para los paneles de abajo y los laterales (si te pasas, se ajusta
   automáticamente al límite más cercano).
4. Vuelve a hacer clic en 🔓 para salir del modo edición. Mientras estás
   editando, el clic-a-través se desactiva (para poder usar los
   controles); al salir, se reactiva.

## Aspecto: borde estilo "ventana de navegador", pegado al borde real

El borde exterior de la app y el de la zona de video ahora son gruesos (3px),
opacos, gris neutro (nada de azul), y quité el padding que dejaba un margen
alrededor de todo: ahora el contenido queda pegado de verdad al borde físico
de la pantalla, como el marco de una ventana de navegador real.

## Si el video se ve borroso sobre YouTube/Netflix/etc.

Esto pasa porque, aunque la zona sea transparente, tu app técnicamente
sigue estando **encima** del video (modo "siempre encima"), y Windows
compone esa superposición de forma que el video con aceleración por
hardware del navegador pierde su renderizado nítido normal. Es una
limitación de cómo Windows compone capas transparentes superpuestas, no
algo arreglable con CSS.

**Solución**: botón 📌 en la barra de controles, alterna "siempre encima".
Si lo desactivas, al hacer clic en el navegador/reproductor esa ventana
pasa a estar realmente al frente (nada tuyo compuesto arriba) y el video
se ve nítido de nuevo. El costo: sin "siempre encima", si abres otra
ventana grande en ese mismo monitor, sí podría tapar tus paneles — con
"siempre encima" activado (por defecto) eso nunca pasa, a cambio de la
posible borrosidad del video.

## Sin modo pantalla completa

Se quitó por completo el botón/función de pantalla completa (⛶): el
fullscreen nativo de Electron seguía sin funcionar bien en Windows con
ventanas transparentes (no revertía, y llegaba a tapar otras ventanas de
la app). La aplicación ya cubre el monitor completo por defecto, así que
no hace falta.

## Paneles opacos (con opción de translucidez)

Por defecto los paneles son sólidos y opacos. El botón 🌫 alterna a un
estilo translúcido tipo vidrio (con blur).

## Calendario: adaptable a los límites del panel + agenda + multi-cuenta

**Tamaño adaptable, no roto**: la grilla del mes usa un `ResizeObserver`
de JavaScript (más confiable que "container queries" de CSS, que
dependían de containment estricto y no reaccionaban bien dentro de este
layout con flexbox — si venías de una versión anterior, este es el
arreglo a "sigue sin achicarse") para reaccionar al tamaño real del
panel, en este orden según vaya faltando **altura**:
1. Se achica la letra.
2. Desaparecen las convenciones (leyenda de colores).
3. Desaparece la fila de días de la semana (L M X J...).
4. Desaparece el selector de mes.

Para el **ancho**: si no hay al menos ~300px de sobra, la agenda se
oculta sola (para no dejar una franja inútil); si el panel completo es
angosto, la grilla también achica sus celdas. Los umbrales de píxeles
están todos juntos en `updateCalendarResponsive()` en `renderer.js` — si
al probarlo en tu pantalla algún corte se siente en el lugar equivocado,
dime y ajusto los números exactos.

**Agenda a la derecha**: la lista de próximos eventos ya no va debajo del
calendario — ahora vive a la derecha, aprovechando el ancho sobrante del
panel. Sigue mostrando solo eventos de calendario (nunca tareas de otros
paneles).

## Sincronización con Google Calendar / Microsoft Calendar

Botón 🔗 en la barra de controles. Es una sincronización real por OAuth
(lectura, y ahora también escritura para Google — ver más abajo).

### De vuelta a ser parte de la app, pero pegado al borde derecho

La ventana de Electron aparte tenía varios bugs propios de una ventana
separada (foco, orden de apilamiento con otras ventanas, comportamiento
inconsistente entre sesiones). Volvió a ser parte de la misma ventana,
como un **drawer que se desliza desde el borde derecho** (no un modal
centrado). Para que no se repita el problema original (el clic-a-través
de la zona de video "tragándose" los clics del panel), mientras el drawer
está abierto el clic-a-través se apaga por completo, sin importar dónde
esté el cursor — igual que ya pasaba en el modo de edición de la zona.

Si cierras el drawer **mientras esperás la confirmación del navegador**,
el proceso se cancela del lado de la app (se cierra el servidor local que
esperaba el código de autorización): no queda nada a medias.

### Si no ves tus eventos de Google después de conectar

Ahora los errores de sincronización se muestran directamente en el
drawer (en rojo, debajo de las cuentas), traducidos a un mensaje legible
en vez del JSON crudo de Google. Causas típicas y cómo se ven ahora:

**"Falta activar la Google Calendar API..."** — Creaste las credenciales
OAuth, pero **activar la API es un paso aparte** que se salta fácil. Ve a
[la página de la API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
(o usa el botón 🔗 "Habilitar Google Calendar API" en el drawer), botón
"Habilitar", espera 1-2 minutos, y vuelve a intentar. Este es probablemente
el motivo si tu sincronización nunca trajo nada desde el principio.

**"Esta cuenta no tiene permiso suficiente"** — el token quedó con
permisos antiguos (por ejemplo, de antes de que la app pidiera también
escritura). Reconecta esa cuenta desde el drawer (mismo Client ID, solo
volver a iniciar sesión).

**Cualquier otro mensaje** — cópialo tal cual aparece en el drawer y así
puedo ayudarte a diagnosticarlo con precisión.

### Si Google te da "Error 403: access_denied" / "Acceso bloqueado"

Esto **no es un error de la app** — es una restricción propia de Google
mientras tu proyecto de Google Cloud esté en modo "Prueba" (Testing),
que es el modo normal para un proyecto personal que no vas a publicar.
En ese modo, **solo las cuentas que agregues explícitamente como "Usuario
de prueba" pueden iniciar sesión** — cualquier otra cuenta (incluida la
tuya, si no la agregaste) recibe exactamente ese error.

Cómo arreglarlo:
1. Ve a [Google Cloud Console](https://console.cloud.google.com/) →
   "APIs y servicios" → "Pantalla de consentimiento OAuth" (o usa el
   botón 🔗 "Abrir pantalla de consentimiento OAuth" en la app).
2. Busca la sección "Usuarios de prueba" (Test users) y agrega ahí el
   correo de Google con el que quieras iniciar sesión (por ejemplo,
   `jcast.elinxd@gmail.com`). Puedes agregar hasta 100 cuentas distintas.
3. Aparte, si tu app quedó con un nombre provisional (como "No sé cómo
   llamar esto todavía"), puedes cambiarlo en esa misma pantalla, campo
   "Nombre de la aplicación" — es solo cosmético (aparece en la pantalla
   de login), no afecta el funcionamiento.
4. Vuelve a intentar conectar la cuenta en la app.

Esto aplica **por cada cuenta de Google** que quieras conectar — si vas a
sumar una segunda cuenta más adelante, también hay que agregarla a la
lista de usuarios de prueba primero.

### Convenciones (categorías) personalizables

Ya no son fijas (Cumpleaños/Reunión/Festivo). En el drawer, sección
"🏷️ Convenciones", puedes agregar, renombrar, recolorear o quitar las
que quieras — se reflejan al instante en la leyenda del calendario y en
el selector de tipo al crear un evento nuevo.

Para los eventos **sincronizados** de Google: si el evento tiene un color
propio asignado en Google Calendar, se usa exactamente ese color (no una
convención local) — es la forma más fiel de "sincronizar con los colores
de Google" sin inventar una convención que no se corresponda con la
realidad. Si el evento no tiene color propio, se usa el punto morado
genérico de "Sincronizado".

### Crear eventos también en Google Calendar

Sí es posible, y ya está implementado (solo para Google por ahora). Al
crear un evento nuevo, aparece un selector "Guardar también en Google" con
las cuentas conectadas — si eliges una, el evento se crea tanto local
como en el Google Calendar principal de esa cuenta.

**Importante**: esto requirió ampliar el permiso pedido a Google, de
"solo lectura" a "lectura y escritura de eventos" (`calendar.events`).
Los permisos quedan fijos al momento de conectar una cuenta — **si
conectaste una cuenta de Google antes de esta actualización, tiene
permiso de solo lectura y no podrá crear eventos hasta que la
reconectes** (botón "+ Agregar cuenta" de nuevo con la misma cuenta; no
hace falta tocar el Client ID/Secret, se reutilizan).

Lo que falta para Microsoft: la misma idea aplicaría (cambiar el scope de
`Calendars.Read` a `Calendars.ReadWrite` y agregar la llamada de creación
a Graph), pero no lo implementé todavía — dime si lo quieres y lo sumo
siguiendo el mismo patrón que Google.

### Sobre usar SSO / inicio de sesión directo en vez de Client ID

Lo investigué a fondo: **no es técnicamente posible eliminar por completo**
el paso de crear una credencial (Client ID), ni para mí ni para nadie que
no sea Google/Microsoft mismos. La razón: cualquier app que quiera acceder
a un calendario vía OAuth necesita estar *registrada* ante Google/Microsoft
con un Client ID — es el mecanismo con el que esas plataformas identifican
qué aplicación está pidiendo acceso, sin excepción, sin importar si el
login final "se siente" como un SSO simple. Yo no puedo crear y mantener
esa credencial en tu nombre (Google exige verificación de la app si la
usan más de 100 usuarios, requiere una cuenta de desarrollador real,
soporte, cumplimiento de políticas, etc. — no es algo que se pueda generar
dentro de esta conversación).

Lo que sí logré acercar a un "inicio de sesión directo":
- **Microsoft ya no pide Client Secret**, solo el Client ID — es lo más
  cercano a "solo inicia sesión" que permite el estándar.
- **La credencial se crea UNA sola vez por proveedor**, nunca por cuenta.
  Una vez la tienes, conectar una segunda o tercera cuenta del mismo
  proveedor (tu Microsoft personal y tu Microsoft de trabajo, por
  ejemplo) es literalmente solo hacer clic en "+ Agregar cuenta" e
  iniciar sesión — los campos de Client ID/Secret se pueden dejar vacíos
  y se reutilizan solos.

### Varias cuentas al mismo tiempo

Ahora puedes conectar tantas cuentas de Google y de Microsoft como
quieras (botón "+ Agregar cuenta" dentro de cada proveedor, en el modal).
A cada una le pones una etiqueta (ej. "Personal", "Trabajo") y todas se
combinan en el mismo calendario y en la misma agenda. Cada cuenta se
puede quitar individualmente con el botón ✕ en su tarjeta.

### Enlaces directos (verificados) para crear las credenciales

Dentro del modal, cada proveedor tiene botones 🔗 que abren directamente
la página correcta en tu navegador (verificados por búsqueda antes de
agregarlos, no de memoria — las consolas de Google/Microsoft cambian con
el tiempo):

- **Google — Pantalla de consentimiento OAuth**:
  `https://console.cloud.google.com/apis/credentials/consent`
- **Google — Crear credenciales**:
  `https://console.cloud.google.com/apis/credentials/oauthclient`
- **Microsoft — App registrations** (ahí mismo está el botón "New
  registration"):
  `https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`

Ningún enlace puede saltarse pasos obligatorios del lado de Google/Microsoft
(elegir/crear tu proyecto o tenant, completar la pantalla de consentimiento
antes de crear el cliente OAuth, etc.) — eso es parte inherente de cómo
funciona OAuth, no algo que un enlace pueda evitar. Si alguna de estas
consolas cambia de dirección más adelante, avísame para actualizarlas.

### Google Calendar (gratis, ~5 minutos, una sola vez)
1. Ve a [Google Cloud Console](https://console.cloud.google.com/) y crea
   un proyecto nuevo (o usa uno existente).
2. En "APIs y servicios" → "Biblioteca", busca y activa **Google Calendar
   API** (⚠️ paso que se salta fácil — sin esto verás "Error consultando
   Google Calendar API has not been used..." al sincronizar, aunque las
   credenciales estén bien).
3. En "APIs y servicios" → "Pantalla de consentimiento OAuth", elige
   "Externo", completa los campos obligatorios, y agrégate a ti mismo
   (y a cualquier otra cuenta tuya que quieras conectar) como "Usuario de
   prueba" (así no hace falta publicar la app).
4. En "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth",
   tipo de aplicación **"App de escritorio"**.
5. Copia el **Client ID** y el **Client Secret** que te genera, y pégalos
   en el modal de la app (botón 🔗 → Google Calendar → "+ Agregar
   cuenta"), junto con una etiqueta para esa cuenta.
6. Al conectar, se abre tu navegador para iniciar sesión. Después de
   aceptar, puedes cerrar esa pestaña y volver a la app.
7. Para una segunda cuenta de Google: "+ Agregar cuenta" de nuevo, deja
   Client ID/Secret vacíos, pon otra etiqueta, e inicia sesión con la
   otra cuenta.

### Microsoft Calendar / Outlook (gratis, ~5 minutos, una sola vez)
1. Ve a [Azure Portal](https://portal.azure.com/) → "Microsoft Entra ID"
   → "Registros de aplicaciones" → "Nuevo registro".
2. Nombre: el que quieras. En "Tipos de cuenta admitidos" elige
   "Cuentas en cualquier directorio organizativo y cuentas personales de
   Microsoft" (esto permite conectar tanto cuentas personales como de
   trabajo/organización con el mismo registro).
3. En "Autenticación" → "Agregar una plataforma" → **"Aplicaciones
   móviles y de escritorio"** → marca el URI
   `http://localhost` (la app usa un puerto local dinámico para el
   login, esto solo habilita el tipo de flujo).
4. Copia el **Application (client) ID** de la página de resumen, y
   pégalo en el modal de la app (botón 🔗 → Microsoft Calendar → "+
   Agregar cuenta"), junto con una etiqueta para esa cuenta.
5. Para una segunda cuenta de Microsoft (ej. tu Teams/Outlook de
   trabajo): "+ Agregar cuenta" de nuevo, deja el Client ID vacío, pon
   otra etiqueta, e inicia sesión con la otra cuenta.

Los tokens se guardan localmente (`calendar-accounts.json` en tu carpeta
de usuario de Windows), nunca se suben a ningún servidor propio de esta
app — la única comunicación es directa entre tu PC y Google/Microsoft.


## Cronograma: híbrido lista/columnas, tamaño dinámico y recurrencia

**Híbrido según el ancho del panel**: si el panel es angosto, las tareas
se ven como una sola lista (ordenada por fecha/hora). Si el panel es
ancho (más de ~420px), se divide sola en 3 columnas por Tipo (Urgente /
Recurrente / Pendiente), cada una ordenada internamente. El cambio es
automático según el tamaño real del panel.

**Se extiende al panel izquierdo**: cuando la zona de video deja espacio
a la izquierda (aparece el panel decorativo junto a ella), ya no es solo
fondo — se lleva la mitad de las tareas más próximas como una extensión
real del cronograma (siempre en lista simple ahí, sin dividir en
columnas). El resto sigue en el panel principal.

**Tamaño dinámico**: las tarjetas se ven grandes por defecto. Si hay
muchas tareas para el espacio disponible, se compactan solas (letra y
relleno más chicos) para que quepan sin depender solo del scroll.

**Nunca detrás del calendario ni fuera de pantalla**: el cronograma
reserva automáticamente el espacio que ocupan el calendario y el
mini-panel de controles, así su propia área scrolleable termina antes de
esa zona — las tareas quedan siempre visibles y accesibles por scroll, en
vez de escondidas detrás o cortadas en el borde inferior. (Nota: esa
reserva se aplica en todo el ancho del panel por simplicidad, así que
puede sobrar algo de espacio vacío del lado donde no hay superposición
real con el calendario — es el costo de mantener esto simple y confiable.)

**Botón "+ Nueva tarea"** arriba del listado, no abajo.

**Sin campo de urgencia/prioridad** — se quitó, tal como pediste.

**Campos por tarea**: Tarea (título), Hora, Día, Tipo. Orden siempre por
fecha/hora efectiva (ver recurrencia abajo).

**Estética**: marco de color por tipo (no relleno sólido), fondo
semitransparente, y la hora/fecha en su propio recuadro de tono distinto
— inspirado en la referencia visual que enviaste.

### Tareas recurrentes

Al elegir Tipo = "Recurrente" en el formulario, aparece un panel
distinto (marcado con borde punteado) en vez de la fecha puntual: elegir
si se repite todos los días o solo ciertos días de la semana (marcados
como L M X J V S D, no con los nombres completos), y a qué hora. La app
calcula sola la "próxima ocurrencia" para mostrarla en el cronograma, en
el temporizador (próxima actividad / pendientes), y para ordenar junto
con las tareas puntuales.

Al hacer clic en una tarea existente se abre el mismo formulario para
editarla (con un botón "Eliminar"); si es recurrente, automáticamente
muestra los campos de recurrencia en vez de la fecha — es el "menú
distinto" para ese tipo de tarea.

### Las tareas también aparecen en el calendario

Tanto las puntuales como las recurrentes (expandidas en cada día que les
corresponde dentro del mes visible) se ven como puntos de color en la
vista mensual, con el color de su Tipo (rojo=urgente, verde=recurrente,
amarillo=pendiente).

**Eliminar desde el calendario**: al hacer clic en un día aparece, arriba
del formulario de "nuevo evento", la lista de lo que ya hay ese día
(eventos y tareas), cada uno con su botón ✕ para borrarlo ahí mismo. Los
eventos sincronizados de Google/Microsoft se marcan como "(sincronizado)"
y no tienen botón de borrar — son de solo lectura, borrarlos habría que
hacerlo desde Google/Microsoft directamente. Nota: borrar una tarea
recurrente desde un día puntual borra **toda la serie** (no una sola
ocurrencia) — no implementé "excepciones" de una fecha suelta todavía;
avísame si lo necesitas y lo sumo.

### Recordatorio en Google Tasks (aparece en el móvil)

Al crear o editar una tarea, hay un selector "Recordatorio en Google
Tasks" con las cuentas de Google conectadas. Si eliges una, además de
guardarse local, se crea un recordatorio en Google Tasks de esa cuenta —
aparece sincronizado en el móvil vía la app de Google Tasks (o dentro de
Google Calendar, según cómo la tengas configurada).

**Importante**: esto amplió el permiso pedido a Google una vez más (se
agregó el scope de Tasks, sumado al de Calendar). Igual que la vez
anterior, **las cuentas conectadas antes de esta actualización no tienen
este permiso todavía** — hay que reconectarlas (mismo Client ID, solo
volver a iniciar sesión) para poder usarlo.

## Qué incluye este MVP

- **Cronograma**: tarjetas con marco de color por tipo (rojo = urgente,
  verde = recurrente, amarillo = pendiente) sobre fondo semitransparente,
  layout híbrido lista/columnas, tamaño dinámico, extensión al panel
  izquierdo, tareas recurrentes visibles en el calendario, y
  recordatorios opcionales en Google Tasks.
- **Temporizador**: reloj, próxima actividad con cuenta regresiva en rojo,
  lista de pendientes con tiempo restante. Posición fija.
- **Calendario**: vista mensual con puntos de color, tamaño de grilla fijo
  + agenda de próximos eventos, y sincronización opcional con Google
  Calendar / Microsoft Calendar. Posición fija.
- **Zona de video**: hueco transparente con clic-a-través real.
- **Fondo personalizable**, **nota rápida** (`Ctrl+Shift+N`), **bandeja
  del sistema**, **cambio de monitor** (🖥), **alternar "siempre encima"**
  (📌, útil si el video se ve borroso).

## Lo que NO incluye todavía (fase 2)

Integraciones con Stretchly, Discord/detección de juegos, Spotify y
Pomodoro. La arquitectura ya está lista para añadirlas en `main.js`.

## Cómo correrlo (necesitas Node.js instalado)

1. Instala [Node.js](https://nodejs.org/) (versión LTS).
2. Abre PowerShell en esta carpeta.
3. `npm install`
4. `npm start`

## Instalador .exe (opcional, más adelante)

```
npm run dist
```

## Estructura del proyecto

```
organizador-escritorio/
├── main.js              → ventana principal, bandeja, IPC, zona de video
├── preload.js            → puente seguro entre main.js y las interfaces
├── calendar-sync.js      → OAuth + fetch/creación en Google Calendar / Microsoft Graph
├── src/
│   ├── index.html          → paneles + zona de video + drawer de calendarios
│   ├── style.css            → estilos, layout adaptable, calendario, drawer, categorías
│   ├── renderer.js          → layout, tareas, reloj, calendario, sync, categorías
│   └── notes.html            → ventana de nota rápida
└── data/  (se crea sola en la carpeta de usuario de Windows)
    ├── tasks.json, events.json, settings.json (incluye eventCategories)
    └── calendar-accounts.json  → tokens de Google/Microsoft (no se comparte)
```

## Próximos pasos sugeridos

1. Prueba la sincronización de calendario y confírmame si el flujo de
   conexión (botón 🔗) y la agenda funcionan como esperabas.
2. Seguimos con cada panel individual: cronograma, temporizador, y las
   integraciones pendientes (Discord Rich Presence, Stretchly, Spotify,
   Pomodoro).
3. Empaquetamos con `electron-builder` para tener un instalador real.
