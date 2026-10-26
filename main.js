const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const calendarSync = require('./calendar-sync');

// ---------- Rutas de almacenamiento local (JSON, nada de nube) ----------
const dataDir = path.join(app.getPath('userData'), 'data');
const tasksFile = path.join(dataDir, 'tasks.json');
const eventsFile = path.join(dataDir, 'events.json');
const settingsFile = path.join(dataDir, 'settings.json');
const accountsFile = path.join(dataDir, 'calendar-accounts.json'); // tokens de Google/Microsoft, aparte de settings

const defaultSettings = {
  background: null,
  // La zona de video vive siempre arriba. Su alto (topFrac) y su
  // posición/ancho horizontal (crossStart/crossSize) son ajustables desde
  // la propia ventana (sin ventana flotante aparte), siempre respetando
  // los mínimos de 1/4 de pantalla para abajo y para los laterales.
  zone: { topFrac: 0.55, crossStart: 0, crossSize: 0.45 },
  alwaysOnTop: true,
  translucent: false,   // paneles opacos por defecto
  displayIndex: 0,
  // Convenciones: AHORA son universales, se usan tanto para tareas como
  // para eventos de calendario (antes eran dos sistemas separados). Las
  // tres primeras son del sistema y no se pueden borrar ni modificar
  // (protected: true) porque el resto de la app depende de sus ids
  // exactos ('urgente' = campo de recurrencia oculto en el modal de
  // tareas, 'recurrente' = activa los campos de recurrencia y queda
  // excluida del calendario, 'pendiente' = tipo por defecto). El resto
  // son convenciones normales, editables/borrables por el usuario.
  eventCategories: [
    { id: 'urgente', name: 'Urgente', color: '#B23A3A', protected: true, showAsColumn: true },
    { id: 'recurrente', name: 'Recurrente', color: '#2E8B57', protected: true, showAsColumn: true },
    { id: 'pendiente', name: 'Pendiente', color: '#B8860B', showAsColumn: false },
    { id: 'cumpleanos', name: 'Cumpleaños', color: '#5B8DEF', showAsColumn: false },
    { id: 'reunion', name: 'Reunión', color: '#3AA0A0', showAsColumn: false },
    { id: 'festivo', name: 'Festivo', color: '#E08A2C', showAsColumn: false }
  ],
  // Perfiles del Pomodoro. El estado de ejecución vive en el renderer;
  // aquí solo se persisten los segmentos configurables.
  pomodoro: {
    activeMode: 'work',
    modes: {
      work: { name: 'Trabajo', segments: [{ name: 'Trabajo', min: 25, break: false }, { name: 'Descanso', min: 5, break: true }] },
      exercise: { name: 'Ejercicio', segments: [{ name: 'Ejercicio', min: 45, break: false }, { name: 'Descanso', min: 10, break: true }] },
      game: { name: 'Juego', segments: [{ name: 'Juego', min: 60, break: false }, { name: 'Descanso', min: 10, break: true }] },
      custom: { name: 'Personalizado', segments: [{ name: 'Personalizado', min: 25, break: false }, { name: 'Descanso', min: 5, break: true }] }
    }
  },
  // Ocultar un panel es independiente de la lógica de tamaño dinámico:
  // ese panel se sigue calculando/reservando su espacio exactamente
  // igual, el resto no se reparte nada — solo que su ventana no se
  // muestra en pantalla.
  hiddenPanels: { scheduleLeft: false, schedule: false, timer: false, calendar: false }
};

const PROTECTED_CATEGORY_IDS = ['urgente', 'recurrente'];

// Todos los límites MÍNIMOS reducidos un 20% respecto al valor original
// (0.25 -> 0.20, 0.08 -> 0.064). Los máximos (como el 33% del calendario)
// no se tocan.
const MIN_BOTTOM_FRAC = 0.20;
const TOP_FRAC_MAX = 1 - MIN_BOTTOM_FRAC; // 0.80: tope de altura de la zona

// Ancho mínimo garantizado para los paneles laterales SUPERIORES
// (cronograma / pieza izquierda junto a la zona): 0.20 reducido un 35%
// adicional -> 0.13. Esto NO afecta el mínimo de abajo (MIN_BOTTOM_FRAC)
// ni el máximo del calendario (CAL_MAX_FRAC), que quedan igual.
const MIN_SCHEDULE_FRAC = 0.13;
const ZONE_MIN = 0.064;
const ZONE_MAX = 0.98;

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(tasksFile)) fs.writeFileSync(tasksFile, '[]');
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, '[]');
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings));
  if (!fs.existsSync(accountsFile)) writeJSON(accountsFile, {
    google: { clientId: '', clientSecret: '', connections: [] },
    microsoft: { clientId: '', tenant: 'common', connections: [] }
  });
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
// Migra settings viejos: agrega urgente/recurrente/pendiente si faltan
// (versiones previas solo tenían cumpleaños/reunión/festivo), y elimina
// duplicados que el usuario haya creado a mano con el mismo nombre (por
// ejemplo, si ya habías agregado "Urgente" como convención manual para
// verla en el calendario, antes de que este cambio la unificara).
function migrateCategories(list) {
  const byNameLower = (n) => (n || '').trim().toLowerCase();
  const SYSTEM_IDS = ['urgente', 'recurrente', 'pendiente'];
  const systemNames = new Set(defaultSettings.eventCategories
    .filter(c => SYSTEM_IDS.includes(c.id))
    .map(c => byNameLower(c.name)));

  // Quita copias manuales duplicadas: p. ej. si ya habías creado a mano
  // "Urgente" / "Recurrente" / "Pendiente" como convención de calendario
  // (con otro id) para poder verlas en la leyenda antes de esta
  // unificación — ahora esos 3 ids ya existen de por sí, así que el
  // duplicado manual sobra.
  let cleaned = (list || []).filter(c =>
    !(systemNames.has(byNameLower(c.name)) && !SYSTEM_IDS.includes(c.id))
  );

  // Asegura que las protegidas existan, con sus valores de sistema
  PROTECTED_CATEGORY_IDS.forEach(id => {
    const def = defaultSettings.eventCategories.find(c => c.id === id);
    const idx = cleaned.findIndex(c => c.id === id);
    if (idx === -1) cleaned.unshift({ ...def });
    else cleaned[idx] = { ...cleaned[idx], name: def.name, color: def.color, protected: true, showAsColumn: def.showAsColumn };
  });

  // Asegura 'pendiente' (no protegida, pero es el tipo por defecto del modal)
  if (!cleaned.find(c => c.id === 'pendiente')) {
    const def = defaultSettings.eventCategories.find(c => c.id === 'pendiente');
    cleaned.push({ ...def });
  }
  return cleaned;
}

// Se cachea en memoria: antes cada reposicionamiento en vivo (mientras
// arrastras la zona) leía el archivo de settings del disco 2 veces por
// evento (una directa, otra dentro de currentDisplay()), y eso se
// disparaba muchísimas veces por segundo durante un arrastre — ahí
// estaba buena parte del delay/lentitud. Ahora solo se lee de disco la
// primera vez; de ahí en más todo pasa por memoria, y writeSettings
// mantiene la copia en memoria al día.
let cachedSettings = null;
function readSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    const s = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) };
    s.eventCategories = migrateCategories(s.eventCategories);
    cachedSettings = s;
    return s;
  }
  catch { cachedSettings = { ...defaultSettings }; return cachedSettings; }
}
function writeSettings(s) { cachedSettings = s; writeJSON(settingsFile, s); }
function readAccounts() {
  const fallback = { google: { clientId: '', clientSecret: '', connections: [] }, microsoft: { clientId: '', tenant: 'common', connections: [] } };
  try {
    const a = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
    return { google: { ...fallback.google, ...a.google }, microsoft: { ...fallback.microsoft, ...a.microsoft } };
  } catch { return fallback; }
}
function writeAccounts(a) { writeJSON(accountsFile, a); }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function stretchlyCandidates() {
  return [
    'stretchly',
    'C:\\Program Files\\WindowsApps\\33881JanHovancik.stretchly_1.22.1.0_x64__24fg4m0zq65je\\app\\Stretchly.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Stretchly', 'Stretchly.exe'),
    path.join(process.env.ProgramFiles || '', 'Stretchly', 'Stretchly.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Stretchly', 'Stretchly.exe')
  ];
}

let stretchlyStartPromise = null;
let stretchlyBreakActive = false;

function runStretchly(args, waitMs) {
  console.log(`[CLI] Stretchly command: ${args.join(' ')}`);
  return ensureStretchlyStarted(waitMs).then(() => new Promise((resolve) => {
    const candidates = stretchlyCandidates();
    const tryNext = (index) => {
      if (index >= candidates.length) {
        resolve({ success: false, error: 'No se encontró Stretchly. Instálalo o agrega su carpeta al PATH.' });
        return;
      }
      let child;
      try {
        console.log(`[CLI] Stretchly executable: ${candidates[index]}`);
        child = spawn(candidates[index], args, { detached: true, windowsHide: true, stdio: 'ignore' });
      } catch {
        console.warn(`[CLI] No se pudo iniciar: ${candidates[index]}`);
        tryNext(index + 1);
        return;
      }
      child.once('error', (error) => {
        console.warn(`[CLI] Error en Stretchly: ${error.message}`);
        tryNext(index + 1);
      });
      child.once('spawn', () => {
        console.log('[CLI] Stretchly command sent successfully');
        child.unref();
        resolve({ success: true });
      });
    };
    tryNext(0);
  })).catch(error => ({ success: false, error: error.message }));
}

function startStretchly() {
  if (stretchlyStartPromise) return stretchlyStartPromise;
  stretchlyStartPromise = new Promise((resolve) => {
    const candidates = stretchlyCandidates();
    const tryNext = (index) => {
      if (index >= candidates.length) {
        resolve({ success: false, error: 'No se encontró Stretchly instalado.' });
        return;
      }
      let child;
      try {
        child = spawn(candidates[index], [], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        tryNext(index + 1);
        return;
      }
      child.once('error', () => tryNext(index + 1));
      child.once('spawn', () => {
        console.log(`[CLI] Stretchly started: ${candidates[index]}`);
        child.unref();
        resolve({ success: true });
      });
    };
    tryNext(0);
  });
  return stretchlyStartPromise;
}

function ensureStretchlyStarted(waitMs = 1500) {
  return startStretchly().then(result => {
    if (!result.success) throw new Error(result.error);
    return new Promise(resolve => setTimeout(resolve, waitMs));
  });
}

function isStretchlyRunning() {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('tasklist', ['/FI', 'IMAGENAME eq Stretchly.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
    } catch { resolve(false); return; }
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.once('error', () => resolve(false));
    child.once('close', () => resolve(out.toLowerCase().includes('stretchly.exe')));
  });
}

function stretchlyConfigPath() {
  return path.join(
    process.env.LOCALAPPDATA || '',
    'Packages',
    '33881JanHovancik.stretchly_24fg4m0zq65je',
    'LocalCache',
    'Roaming',
    'Stretchly',
    'config.json'
  );
}

function stopStretchlyProcess() {
  return new Promise(resolve => {
    const child = spawn('taskkill.exe', ['/F', '/IM', 'Stretchly.exe'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

async function prepareStretchlyDuration(seconds) {
  const configPath = stretchlyConfigPath();
  if (!fs.existsSync(configPath)) return null;
  let original;
  try {
    original = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const configuredDuration = Math.max(1, Math.ceil(Number(seconds) || 1)) * 1000;
    const temporary = { ...original, breakDuration: configuredDuration };
    fs.writeFileSync(configPath, JSON.stringify(temporary, null, 2));
    console.log(`[CLI] Stretchly breakDuration temporal: ${configuredDuration}ms`);
    // Solo hace falta matar y reabrir el proceso si YA había uno corriendo
    // con la config vieja cargada en memoria. Si no había ninguno, el
    // primer arranque ya va a leer la config nueva directamente — nos
    // ahorramos el taskkill y buena parte de la espera.
    const wasRunning = await isStretchlyRunning();
    if (wasRunning) {
      await stopStretchlyProcess();
      stretchlyStartPromise = null;
    }
    return { configPath, originalDuration: original.breakDuration, configuredDuration, wasRunning };
  } catch (error) {
    console.error(`[CLI] No se pudo preparar breakDuration: ${error.message}`);
    return null;
  }
}

function restoreStretchlyDuration(state) {
  if (!state) return;
  try {
    const current = JSON.parse(fs.readFileSync(state.configPath, 'utf8'));
    if (current.breakDuration === state.configuredDuration) {
      current.breakDuration = state.originalDuration;
      fs.writeFileSync(state.configPath, JSON.stringify(current, null, 2));
      console.log('[CLI] Stretchly breakDuration restaurado');
    }
  } catch (error) {
    console.error(`[CLI] No se pudo restaurar breakDuration: ${error.message}`);
  }
}

function sendStretchlyBreakShortcut() {
  if (!stretchlyBreakActive) {
    console.log('[CLI] Salto de Stretchly ignorado: no hay un descanso activo registrado');
    return Promise.resolve({ success: true, skipped: true });
  }
  stretchlyBreakActive = false;
  return new Promise((resolve) => {
    const command = "(New-Object -ComObject WScript.Shell).SendKeys('^x')";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', (error) => {
      console.error(`[CLI] No se pudo saltar el descanso de Stretchly: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
    child.once('close', (code) => {
      console.log(`[CLI] Atajo de salto de Stretchly enviado (exit=${code})`);
      resolve({ success: code === 0, error: code === 0 ? null : `PowerShell exit code ${code}` });
    });
  });
}

async function startStretchlyBreak(remainingSeconds) {
  const seconds = Math.max(1, Math.ceil(Number(remainingSeconds) || 1));
  const durationState = await prepareStretchlyDuration(seconds);
  // Si tuvimos que matar y reabrir el proceso, dale más margen a que
  // vuelva a levantar su ventana/IPC. Si no había nada corriendo, no hace
  // falta esperar tanto — así se nota bastante menos el retraso inicial.
  const waitMs = durationState && durationState.wasRunning ? 1500 : 700;
  const result = await runStretchly(['long'], waitMs);
  if (durationState) {
    // La segunda instancia reenvía el comando a la principal; esperamos a
    // que esa instancia haya cargado la configuración antes de restaurarla.
    setTimeout(() => restoreStretchlyDuration(durationState), 3000);
  }
  if (!result.success) return result;
  stretchlyBreakActive = true;
  console.log(`[CLI] Descanso de Stretchly iniciado con duración exacta de ${seconds}s`);
  return result;
}

// Aplica los mismos mínimos (1/4 de pantalla abajo y en los laterales) a
// cualquier zona que llegue desde el renderer antes de guardarla.
function clampZone(z) {
  let topFrac = clamp(z.topFrac, ZONE_MIN, TOP_FRAC_MAX);
  let crossSize = clamp(z.crossSize, ZONE_MIN, ZONE_MAX);
  let crossStart = clamp(z.crossStart, 0, 1);

  const maxEnd = 1 - MIN_SCHEDULE_FRAC;
  if (crossStart + crossSize > maxEnd) {
    if (crossSize > maxEnd) crossSize = maxEnd;
    crossStart = Math.max(0, maxEnd - crossSize);
  }
  if (crossStart > 0 && crossStart < MIN_SCHEDULE_FRAC) crossStart = 0;

  return { topFrac, crossStart, crossSize };
}

let panelWindows = { scheduleLeft: null, schedule: null, timer: null, calendar: null };
let zoneEditorWindow = null;
let mapWindow = null;
let notesWindow = null;
let tray = null;

function currentDisplay() {
  const displays = screen.getAllDisplays();
  const settings = readSettings();
  return displays[settings.displayIndex] || screen.getPrimaryDisplay();
}

// ================= Layout: la misma matemática que antes vivía en
// renderer.js (applyLayout), ahora acá porque quien de verdad posiciona
// las piezas es el proceso principal (son ventanas reales, no <div>s
// dentro de una sola ventana). Todo se calcula en FRACCIONES (0-1) igual
// que antes, y se convierte a píxeles recién al aplicar setBounds. =================
const CAL_MAX_FRAC = 1 / 3;
const TOOLBAR_PX = 40;
const TIMER_MIN_PX = 390;

function computeLayout(zone, display) {
  const topFrac = zone.topFrac;
  const bottomFrac = 1 - topFrac;
  const crossStart = zone.crossStart;
  const crossSize = zone.crossSize;
  const rightFrac = Math.max(0, 1 - crossStart - crossSize); // ancho del cronograma
  const showLeft = crossStart > 0.01;

  const widthCal = Math.min(rightFrac, CAL_MAX_FRAC);
  const heightCal = Math.min(bottomFrac, CAL_MAX_FRAC);
  const calX = 1 - widthCal;
  const calY = 1 - heightCal;
  const toolbarFrac = TOOLBAR_PX / display.bounds.height;
  const toolbarY = calY - toolbarFrac;

  const timerWidthFrac = Math.min(1, Math.max(crossStart + crossSize, TIMER_MIN_PX / display.bounds.width));

  const frac = (x, y, w, h) => ({
    x: Math.round(display.bounds.x + x * display.bounds.width),
    y: Math.round(display.bounds.y + y * display.bounds.height),
    width: Math.max(1, Math.round(w * display.bounds.width)),
    height: Math.max(1, Math.round(h * display.bounds.height))
  });

  return {
    showLeft,
    scheduleLeft: frac(0, 0, crossStart, topFrac),
    schedule: frac(crossStart + crossSize, 0, rightFrac, 1),
    timer: frac(0, topFrac, timerWidthFrac, bottomFrac),
    // calendarBody: el calendario de VERDAD (sin el menú de botones
    // arriba) — es lo que usa el cronograma para saber hasta dónde puede
    // bajar cada columna sin que su contenido quede escondido detrás del
    // calendario. Antes se usaba el tope del menú de botones, que está
    // más arriba de lo necesario: eso le quitaba una franja de espacio
    // (justo la altura del menú, ~40px) que el cronograma sí podía usar.
    calendarBody: frac(calX, calY, widthCal, heightCal),
    // El toolbar y el calendario comparten una sola ventana real (siempre
    // van pegados, nunca hace falta que se superpongan entre ellos), así
    // que su ventana combinada va de toolbarY a 1, con el toolbar fijo a
    // 40px arriba y el calendario ocupando el resto (esto se resuelve
    // dentro del propio HTML de esa ventana, no acá).
    calendar: frac(calX, toolbarY, widthCal, toolbarFrac + heightCal),
    zone: frac(crossStart, 0, crossSize, topFrac)
  };
}

function createPanelWindow(panelQuery, hiddenKey) {
  const settings = readSettings();
  const win = new BrowserWindow({
    width: 100, height: 100, show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { panel: panelQuery } });
  // Antes esto mostraba la ventana sin condiciones. Si el panel estaba
  // marcado como oculto (mapa de paneles), layoutWindows() ya la había
  // llamado a hide() justo después de crearla — pero como esto corre
  // recién cuando termina de cargar el contenido (más tarde), sin este
  // chequeo terminaba mostrándola igual, pisando ese hide().
  win.once('ready-to-show', () => {
    const settings2 = readSettings();
    const hidden = (settings2.hiddenPanels || {})[hiddenKey];
    if (hidden) return;
    if (hiddenKey === 'scheduleLeft') {
      const showLeft = computeLayout(settings2.zone, currentDisplay()).showLeft;
      if (!showLeft) return;
    }
    win.show();
  });
  return win;
}

function createPanelWindows() {
  panelWindows.timer = createPanelWindow('timer', 'timer');
  panelWindows.schedule = createPanelWindow('schedule', 'schedule');
  panelWindows.calendar = createPanelWindow('calendar', 'calendar');
  panelWindows.scheduleLeft = createPanelWindow('schedule-left', 'scheduleLeft');
  layoutWindows();

  // El calendario+menú SIEMPRE debe quedar encima de los otros 3 (tiene
  // los controles que siempre hace falta poder alcanzar). moveTop() al
  // arrancar no alcanza: en Windows, hacer clic en CUALQUIER otra
  // ventana normalmente la sube al frente — así que cada vez que
  // cronograma/tiempo/extra ganan el foco, el calendario se reafirma
  // encima de inmediato.
  [panelWindows.timer, panelWindows.schedule, panelWindows.scheduleLeft].forEach(w => {
    if (!w) return;
    w.on('focus', () => {
      if (panelWindows.calendar && !panelWindows.calendar.isDestroyed()) panelWindows.calendar.moveTop();
    });
  });
}

// Reubica TODAS las ventanas reales según la zona actual — se llama al
// arrancar, al cambiar de monitor, al redimensionar la ventana principal
// (ya no existe como tal, pero sí al cambiar de pantalla) y en vivo
// mientras se edita la zona (ver zoneEditorWindow más abajo).
function layoutWindows() {
  const settings = readSettings();
  const display = currentDisplay();
  const rects = computeLayout(liveZoneOverride || settings.zone, display);
  const hidden = settings.hiddenPanels || {};

  // Ocultar un panel NO cambia nada de este cálculo: se sigue fijando su
  // rect exactamente igual que si estuviera visible (el resto no se
  // reparte su espacio) — solo se decide, al final, si esa ventana se
  // muestra o no.
  const applyPanel = (win, rect, hiddenKey) => {
    if (!win || win.isDestroyed()) return;
    win.setBounds(rect);
    if (hidden[hiddenKey]) win.hide(); else win.showInactive();
  };
  applyPanel(panelWindows.timer, rects.timer, 'timer');
  applyPanel(panelWindows.schedule, rects.schedule, 'schedule');
  applyPanel(panelWindows.calendar, rects.calendar, 'calendar');
  if (panelWindows.scheduleLeft && !panelWindows.scheduleLeft.isDestroyed()) {
    panelWindows.scheduleLeft.setBounds(rects.scheduleLeft);
    // La izquierda tiene DOS motivos para no mostrarse: que la zona no
    // deje espacio para ella (showLeft, ya existía) o que la hayas
    // ocultado a mano (hiddenPanels) — cualquiera de los dos alcanza.
    if (rects.showLeft && !hidden.scheduleLeft) panelWindows.scheduleLeft.showInactive();
    else panelWindows.scheduleLeft.hide();
  }

  // Orden de superposición (de abajo hacia arriba): el temporizador puede
  // quedar detrás del cronograma en su borde derecho si el mínimo de
  // ancho del temporizador (TIMER_MIN_PX) empuja más allá de donde
  // empieza el cronograma; y el calendario+toolbar siempre queda por
  // encima de la esquina inferior derecha del cronograma. Mismo orden
  // que tenía el z-index de CSS en la versión de una sola ventana.
  // IMPORTANTE: nunca se le hace moveTop() a un panel oculto — moveTop()
  // en Windows puede volver a mostrar una ventana como efecto colateral,
  // que era justo lo que deshacía el ocultar apenas un instante después.
  [
    { win: panelWindows.timer, key: 'timer' },
    { win: panelWindows.schedule, key: 'schedule' },
    { win: panelWindows.calendar, key: 'calendar' }
  ].forEach(({ win, key }) => {
    if (win && !win.isDestroyed() && !hidden[key]) win.moveTop();
  });

  // Nota: la ventanita de edición de zona (zoneEditorWindow) es de
  // pantalla completa y no se reposiciona nunca (siempre cubre toda la
  // pantalla actual); el recuadro delimitador que sí se mueve vive
  // DENTRO de su HTML, no como bounds de la ventana — ver zone-editor.html.
  if (mapWindow && !mapWindow.isDestroyed()) mapWindow.webContents.send('hidden-panels-changed', hidden);

  // Cada ventana de "schedule"/"schedule-left" decide sola qué categoría
  // mostrar en su columna según esto — antes (una sola ventana) lo veían
  // directamente por CSS; ahora hay que avisarles.
  const leftState = { showLeft: rects.showLeft && !hidden.scheduleLeft };
  broadcast('layout-changed', leftState);
  lastLeftState = leftState;

  // El cronograma necesita saber dónde queda el calendario EN LA PANTALLA
  // para que sus columnas no se corten detrás de él (antes, con una sola
  // ventana, esto se medía directo del DOM porque todo vivía junto; ahora
  // son ventanas separadas, así que main.js — que sí ve las 4 a la vez —
  // se lo tiene que avisar). Se manda el calendario SIN el menú de
  // botones de arriba, así las columnas ganan esa franja de vuelta.
  broadcast('calendar-geometry', rects.calendarBody);
  lastCalendarRect = rects.calendarBody;
}
let lastLeftState = { showLeft: false };
let lastCalendarRect = null;

ipcMain.handle('layout:get-state', () => lastLeftState);
ipcMain.handle('layout:get-calendar-rect', () => lastCalendarRect);

function allPanelWindows() {
  return [panelWindows.scheduleLeft, panelWindows.schedule, panelWindows.timer, panelWindows.calendar].filter(w => w && !w.isDestroyed());
}

// Avisa a TODAS las ventanas cuando algo compartido cambió (tareas,
// eventos, categorías, pomodoro, ajustes) — cada una decide si le importa
// y se refresca sola. Reemplaza lo que antes era una sola página
// actualizando su propio estado en memoria.
function broadcast(channel, payload) {
  allPanelWindows().forEach(w => w.webContents.send(channel, payload));
}

// ================= Edición de la zona: ahora es una ventanita real y
// aparte (con borde de sistema operativo, movible/redimensionable de
// forma nativa) que solo existe MIENTRAS se está editando. El resto del
// tiempo no hay absolutamente nada ahí — ni una ventana transparente ni
// un hueco con clic-a-través, literalmente no existe. =================
let liveZoneOverride = null; // mientras se arrastra/redimensiona la zona: en memoria, no en disco
let layoutThrottle = null;
function requestLayoutWindows() {
  if (layoutThrottle) return;
  layoutThrottle = setTimeout(() => { layoutThrottle = null; layoutWindows(); }, 16);
}

// La ventanita de edición es de PANTALLA COMPLETA (transparente, clic-a-
// través en todos lados EXCEPTO justo sobre el recuadro delimitador, que
// vive DENTRO de ella como un <div> normal) — es la misma técnica
// probada de la app original de una sola ventana, aplicada ahora solo a
// esta ventana temporal en vez de a toda la app. Como el recuadro es un
// <div> normal dentro de una ventana del tamaño exacto de la pantalla,
// no puede salirse: su posición se calcula con la misma matemática de
// siempre (fracciones de 0 a 1), nunca con coordenadas absolutas que se
// puedan ir de rango.
function startZoneEdit() {
  if (zoneEditorWindow && !zoneEditorWindow.isDestroyed()) return;
  const display = currentDisplay();
  zoneEditorWindow = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  zoneEditorWindow.setAlwaysOnTop(true, 'screen-saver');
  zoneEditorWindow.setIgnoreMouseEvents(true, { forward: true }); // clic-a-través salvo sobre el recuadro (el propio HTML avisa cuándo)
  zoneEditorWindow.loadFile(path.join(__dirname, 'src', 'zone-editor.html'));
  zoneEditorWindow.webContents.once('did-finish-load', () => {
    zoneEditorWindow.webContents.send('zone-editor-init', {
      zone: readSettings().zone,
      // Los mismos límites que aplica clampZone() acá abajo — antes el
      // recuadro usaba sus propios números aproximados, así que a veces
      // se veía a sí mismo permitiendo algo que clampZone() después
      // recortaba distinto al aplicarlo de verdad a los paneles reales.
      limits: { ZONE_MIN, TOP_FRAC_MAX, MIN_SCHEDULE_FRAC }
    });
  });
  broadcast('zone-edit-changed', true);
}
function endZoneEdit() {
  if (zoneEditorWindow && !zoneEditorWindow.isDestroyed()) zoneEditorWindow.close();
  zoneEditorWindow = null;
  liveZoneOverride = null;
  broadcast('zone-edit-changed', false);
}
// El propio HTML del editor decide, según dónde está el mouse respecto
// al recuadro, si esta ventana debe dejar pasar los clics o no.
ipcMain.on('zone-editor:set-ignore', (e, ignore) => {
  if (zoneEditorWindow && !zoneEditorWindow.isDestroyed()) zoneEditorWindow.setIgnoreMouseEvents(ignore, { forward: true });
});
// Mientras arrastra/redimensiona (muchas veces por segundo): solo en
// memoria + throttle, igual que antes — el disco no se toca hasta soltar.
ipcMain.on('zone-editor:live-update', (e, zone) => {
  liveZoneOverride = clampZone(zone);
  requestLayoutWindows();
});
// Al soltar: se persiste una sola vez.
ipcMain.on('zone-editor:end-update', (e, zone) => {
  const s = readSettings();
  s.zone = clampZone(zone);
  writeSettings(s);
  liveZoneOverride = null;
  layoutWindows();
});
// ================= Modales como ventanas de verdad, independientes =====
// (tarea, evento, config de pomodoro, conexión con Google/Microsoft): en
// vez de agrandar la ventana del panel que las abre (se veía raro, el
// panel se "deformaba"), cada una es su propia ventana nueva, centrada,
// del tamaño que necesita, arrastrable — el panel que la abrió se queda
// intacto, tal cual estaba. Reusa el mismo index.html con ?panel=modal-X
// (mismo truco que los 4 paneles principales), así toda la lógica de
// poblar/guardar cada modal sigue siendo la misma, sin duplicar nada. =====
let modalWindows = {};
const MODAL_SIZES = {
  task: { width: 400, height: 660 },
  event: { width: 380, height: 560 },
  pomo: { width: 600, height: 680 },
  drawer: { width: 520, height: 680 }
};
// Se pre-crean OCULTAS al arrancar la app (ver app.whenReady más abajo)
// en vez de recién al primer clic — antes, la primera vez que abrías
// cualquier modal, tenía que arrancar un proceso de Chromium nuevo ahí
// mismo, lo cual se sentía como si abriera una segunda app. Ahora ese
// arranque pasa en segundo plano mientras ya estás mirando los paneles
// principales, y abrir el modal después es solo mostrar una ventana que
// ya estaba lista.
function createModalWindow(kind) {
  const size = MODAL_SIZES[kind] || { width: 420, height: 600 };
  const d = currentDisplay();
  const w = Math.min(size.width, d.bounds.width - 40);
  const h = Math.min(size.height, d.bounds.height - 40);
  const x = Math.round(d.bounds.x + (d.bounds.width - w) / 2);
  const y = Math.round(d.bounds.y + (d.bounds.height - h) / 2);
  const win = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false, transparent: true, hasShadow: true, resizable: false, movable: true,
    alwaysOnTop: true, backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { panel: `modal-${kind}` } });
  modalWindows[kind] = win;
}
function openModalWindow(kind, payload) {
  const win = modalWindows[kind];
  if (!win || win.isDestroyed()) { createModalWindow(kind); }
  const target = modalWindows[kind];
  const send = () => { target.webContents.send('modal-init', payload); target.show(); target.moveTop(); };
  // Si por algo todavía no había terminado de cargar (recién creada esta
  // misma vez, caso raro), espera; si ya estaba lista de antes, es
  // instantáneo.
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send);
  else send();
}
function closeModalWindow(kind) {
  const win = modalWindows[kind];
  if (win && !win.isDestroyed()) win.hide(); // se conserva viva (más rápido reabrir), no se destruye
  reassertMainPanelsOnTop();
}
ipcMain.handle('modal:open', (e, { kind, payload }) => openModalWindow(kind, payload));
ipcMain.handle('modal:close', (e, { kind }) => closeModalWindow(kind));

ipcMain.handle('zone:toggle-edit', () => {
  if (zoneEditorWindow && !zoneEditorWindow.isDestroyed()) endZoneEdit();
  else startZoneEdit();
  return !!(zoneEditorWindow && !zoneEditorWindow.isDestroyed());
});

// ================= Mapa de paneles: ventanita pequeña con un esquema
// minimalista de la app; cada pieza se puede apagar/prender ahí (se
// pone gris/transparente cuando está oculta). Ocultar un panel NUNCA
// cambia su lógica de tamaño dinámico — layoutWindows() sigue calculando
// su rect exactamente igual, solo no se muestra esa ventana. =================
// Vuelve a poner los 4 paneles principales por encima de cualquier
// ventanita secundaria (notas, mapa) que se les haya podido superponer —
// en particular el calendario+menú, que es el que tiene los controles
// que siempre hacen falta poder alcanzar.
function reassertMainPanelsOnTop() {
  [panelWindows.timer, panelWindows.schedule, panelWindows.calendar].forEach(w => {
    if (w && !w.isDestroyed()) w.moveTop();
  });
}

function toggleMapWindow() {
  if (mapWindow && !mapWindow.isDestroyed()) { mapWindow.close(); mapWindow = null; return; }
  const display = currentDisplay();
  mapWindow = new BrowserWindow({
    width: 200, height: 168,
    x: Math.round(display.bounds.x + display.bounds.width / 2 - 100),
    y: Math.round(display.bounds.y + display.bounds.height / 2 - 84),
    frame: false, transparent: true, hasShadow: false, resizable: false, movable: true,
    alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mapWindow.setAlwaysOnTop(true, 'screen-saver');
  mapWindow.loadFile(path.join(__dirname, 'src', 'map.html'));
  mapWindow.once('ready-to-show', () => mapWindow.moveTop());
  mapWindow.on('closed', () => { mapWindow = null; reassertMainPanelsOnTop(); });
}
ipcMain.handle('panels:toggle-map', () => { toggleMapWindow(); return !!(mapWindow && !mapWindow.isDestroyed()); });
ipcMain.handle('panels:get-hidden', () => readSettings().hiddenPanels || {});
ipcMain.handle('panels:toggle-hidden', (e, panelId) => {
  const settings = readSettings();
  const hidden = { ...(settings.hiddenPanels || {}) };
  hidden[panelId] = !hidden[panelId];
  settings.hiddenPanels = hidden;
  writeSettings(settings);
  layoutWindows(); // aplica mostrar/ocultar ya mismo, sin tocar tamaños
  return hidden;
});

// ---------- Ventana de notas rápidas ----------
function createNotesWindow() {
  notesWindow = new BrowserWindow({
    width: 360, height: 240, frame: false, show: false,
    alwaysOnTop: true, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  // Los 4 paneles principales usan el nivel MÁS ALTO que existe
  // ('screen-saver'). Antes las notas solo tenían alwaysOnTop:true sin
  // nivel explícito (por defecto queda en 'floating', más bajo) — en la
  // teoría ya debería alcanzar, pero para que nunca dependa de un
  // default implícito, se fija 'floating' a mano: así es IMPOSIBLE que
  // termine por encima del calendario, sin importar cuál se haya
  // mostrado o clickeado más recientemente.
  notesWindow.setAlwaysOnTop(true, 'floating');
  notesWindow.loadFile(path.join(__dirname, 'src', 'notes.html'));
  notesWindow.on('blur', () => notesWindow.hide());
  notesWindow.on('hide', () => reassertMainPanelsOnTop());
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function toggleNotesWindow() {
  if (!notesWindow) return;
  if (notesWindow.isVisible()) { notesWindow.hide(); return; }
  const { x, y } = screen.getCursorScreenPoint();
  const size = notesWindow.getBounds();
  let notesRect = { x, y, width: size.width, height: size.height };
  // El menú+calendario tiene los controles que siempre hace falta poder
  // alcanzar (🎬🗺🔗⚙, etc.) — si las notas fueran a taparlo justo donde
  // apareció el cursor, no habría forma de volver a hacer clic en el
  // calendario para que las notas pierdan el foco y se escondan solas
  // (quedaría trabado). Mejor: si detecta que se solaparían, las abre en
  // otra esquina en vez de ahí.
  const calWin = panelWindows.calendar;
  if (calWin && !calWin.isDestroyed() && rectsOverlap(notesRect, calWin.getBounds())) {
    const d = currentDisplay();
    notesRect = { x: d.bounds.x + 20, y: d.bounds.y + 20, width: size.width, height: size.height };
  }
  notesWindow.setPosition(notesRect.x, notesRect.y);
  notesWindow.show();
  notesWindow.focus();
}

// ---------- Bandeja del sistema ----------
function createTray() {
  tray = new Tray(path.join(__dirname, 'src', 'assets', 'tray.png'));
  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar / ocultar paneles', click: () => {
        const anyVisible = allPanelWindows().some(w => w.isVisible());
        allPanelWindows().forEach(w => anyVisible ? w.hide() : w.showInactive());
      }
    },
    { label: 'Nota rápida (Ctrl+Shift+N)', click: toggleNotesWindow },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ]);
  tray.setToolTip('Organizador');
  tray.setContextMenu(menu);
}

// ================= Bloqueo automático de Stretchly a la hora de una
// tarea (urgente o recurrente) =================
// Corre en el proceso principal (no en ninguna ventana) porque tiene que
// seguir funcionando pase lo que pase con los paneles, y porque el
// control de Stretchly ya vive acá.
function todaysOccurrenceTime(task, now) {
  if (task.type === 'recurrente' && task.recurrence) {
    const days = task.recurrence.days || [];
    const matches = task.recurrence.freq === 'daily' || days.includes(now.getDay());
    if (!matches) return null;
    const [h, m] = (task.recurrence.time || '09:00').split(':').map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  }
  if (task.type === 'urgente' && task.datetime) {
    const d = new Date(task.datetime);
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? d : null;
  }
  return null;
}
const triggeredTaskBlocks = new Set(); // `${taskId}_${YYYY-MM-DD}`, para no repetir el mismo día
function checkTaskBlocks() {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  // Limpieza: se sacan las marcas de días anteriores para que el Set no
  // crezca para siempre mientras la app queda abierta muchos días.
  [...triggeredTaskBlocks].forEach(k => { if (!k.endsWith(todayKey)) triggeredTaskBlocks.delete(k); });

  const tasks = readJSON(tasksFile);
  tasks.forEach(t => {
    if (!t.duration || t.duration <= 0) return; // sin duración configurada, no dispara nada
    const occ = todaysOccurrenceTime(t, now);
    if (!occ) return;
    const diffSec = (now - occ) / 1000;
    if (diffSec < 0 || diffSec > 30) return; // ventana de 30s desde la hora exacta (el chequeo corre cada 15s)
    const key = `${t.id}_${todayKey}`;
    if (triggeredTaskBlocks.has(key)) return;
    triggeredTaskBlocks.add(key);
    console.log(`[Stretchly] Bloqueo automático por tarea "${t.title}" (${t.duration} min)`);
    startStretchlyBreak(t.duration * 60);
  });
}

app.whenReady().then(() => {
  ensureDataFiles();
  createPanelWindows();
  createNotesWindow();
  createTray();
  startStretchly();
  globalShortcut.register('Control+Shift+N', toggleNotesWindow);
  // En segundo plano, sin apurar: no importa si tardan un par de segundos
  // más en estar listas, porque el usuario todavía no las necesita — lo
  // que sí importa es que YA estén listas para cuando las pida.
  setTimeout(() => Object.keys(MODAL_SIZES).forEach(kind => createModalWindow(kind)), 300);
  // Cada 15s: si alguna tarea urgente/recurrente tiene su hora justo
  // ahora Y tiene una duración configurada, dispara el bloqueo de
  // Stretchly solo.
  setInterval(checkTaskBlocks, 15000);
});
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- IPC: tareas ----------
ipcMain.handle('tasks:get', () => readJSON(tasksFile));
ipcMain.handle('tasks:add', (e, task) => {
  const tasks = readJSON(tasksFile);
  task.id = Date.now().toString();
  tasks.push(task);
  writeJSON(tasksFile, tasks);
  broadcast('tasks-changed');
  return tasks;
});
ipcMain.handle('tasks:delete', (e, id) => {
  let tasks = readJSON(tasksFile).filter(t => t.id !== id);
  writeJSON(tasksFile, tasks);
  broadcast('tasks-changed');
  return tasks;
});
ipcMain.handle('tasks:update', (e, updated) => {
  let tasks = readJSON(tasksFile).map(t => (t.id === updated.id ? updated : t));
  writeJSON(tasksFile, tasks);
  broadcast('tasks-changed');
  return tasks;
});

// ---------- IPC: eventos de calendario ----------
ipcMain.handle('events:get', () => readJSON(eventsFile));
ipcMain.handle('events:add', (e, ev) => {
  const events = readJSON(eventsFile);
  ev.id = Date.now().toString();
  events.push(ev);
  writeJSON(eventsFile, events);
  broadcast('events-changed');
  return events;
});
ipcMain.handle('events:delete', (e, id) => {
  let events = readJSON(eventsFile).filter(ev => ev.id !== id);
  writeJSON(eventsFile, events);
  broadcast('events-changed');
  return events;
});

// ---------- IPC: configuración general ----------
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:toggleTranslucent', () => {
  const settings = readSettings();
  settings.translucent = !settings.translucent;
  writeSettings(settings);
  broadcast('settings-changed', settings);
  return settings;
});
ipcMain.handle('settings:saveEventCategories', (e, categories) => {
  const settings = readSettings();
  // Las protegidas nunca se toman de lo que mande el renderer: se
  // reinsertan tal cual están en el sistema, ignorando cualquier intento
  // de borrarlas o modificarlas (defensa además de la del renderer).
  const incoming = (categories || []).filter(c => !PROTECTED_CATEGORY_IDS.includes(c.id));
  const protectedCats = settings.eventCategories.filter(c => PROTECTED_CATEGORY_IDS.includes(c.id));
  settings.eventCategories = [...protectedCats, ...incoming];
  writeSettings(settings);
  broadcast('categories-changed', settings.eventCategories);
  return settings.eventCategories;
});
ipcMain.handle('settings:savePomodoro', (e, pomodoro) => {
  const settings = readSettings();
  const fallback = defaultSettings.pomodoro;
  const modes = {};
  for (const [id, fallbackMode] of Object.entries(fallback.modes)) {
    const incoming = pomodoro?.modes?.[id] || settings.pomodoro?.modes?.[id] || fallbackMode;
    const segments = Array.isArray(incoming.segments) ? incoming.segments.map(segment => ({
      name: String(segment.name || 'Segmento').slice(0, 40),
      min: clamp(Number(segment.min) || 1, 1, 180),
      dynamic: !!segment.dynamic,
      break: !!segment.break
    })).slice(0, 12) : fallbackMode.segments;
    modes[id] = { name: String(incoming.name || fallbackMode.name).slice(0, 30), segments: segments.length ? segments : fallbackMode.segments };
  }
  settings.pomodoro = { activeMode: fallback.modes[pomodoro?.activeMode] ? pomodoro.activeMode : 'work', modes };
  writeSettings(settings);
  broadcast('pomodoro-changed', settings.pomodoro);
  return settings.pomodoro;
});
ipcMain.handle('stretchly:startBreak', (e, remainingSeconds) => {
  console.log(`[IPC] stretchly:startBreak remaining=${remainingSeconds}`);
  return startStretchlyBreak(remainingSeconds);
});
ipcMain.handle('stretchly:skipBreak', () => sendStretchlyBreakShortcut());
ipcMain.on('debug:log', (e, message) => console.log(`[RENDERER] ${message}`));
ipcMain.handle('settings:cycleDisplay', () => {
  const displays = screen.getAllDisplays();
  const settings = readSettings();
  settings.displayIndex = (settings.displayIndex + 1) % displays.length;
  writeSettings(settings);
  layoutWindows();
  return { displayIndex: settings.displayIndex, total: displays.length };
});
ipcMain.handle('settings:toggleAlwaysOnTop', () => {
  const settings = readSettings();
  settings.alwaysOnTop = !settings.alwaysOnTop;
  writeSettings(settings);
  allPanelWindows().forEach(w => {
    if (settings.alwaysOnTop) w.setAlwaysOnTop(true, 'screen-saver');
    else w.setAlwaysOnTop(false);
  });
  return settings.alwaysOnTop;
});

// ---------- IPC: zona de video (ahora es una ventana real aparte, ver
// startZoneEdit/endZoneEdit más arriba — esto solo queda por si algo
// externo necesita fijarla directamente, sin pasar por el modo edición). ----------
ipcMain.handle('settings:saveZone', (e, zone) => {
  const settings = readSettings();
  settings.zone = clampZone(zone);
  writeSettings(settings);
  layoutWindows();
  return settings.zone;
});

// ---------- IPC: abrir enlaces externos (solo a hosts conocidos) ----------
ipcMain.on('open-external', (e, url) => {
  try {
    const u = new URL(url);
    const allowedHosts = ['console.cloud.google.com', 'portal.azure.com'];
    if (allowedHosts.includes(u.hostname)) {
      console.log(`[EXTERNAL] Abriendo navegador: ${u.origin}${u.pathname}`);
      shell.openExternal(url);
    }
  } catch { /* URL inválida, ignorar */ }
});

// ---------- IPC: sincronización con Google Calendar / Microsoft Calendar ----------
// Modelo: UNA credencial (Client ID [+ Secret]) por proveedor, compartida
// por TODAS las cuentas que conectes de ese proveedor (para que puedas
// sumar, por ejemplo, tu Microsoft personal y tu Microsoft de trabajo sin
// tener que crear una app distinta para cada una).
ipcMain.on('calendar:cancel-flow', () => calendarSync.cancelActiveFlow());
ipcMain.handle('calendar:status', () => {
  const a = readAccounts();
  const strip = (c) => ({ id: c.id, label: c.label, email: c.email, needsReconnect: !!c.needsReconnect });
  return {
    google: { hasCreds: !!a.google.clientId, connections: a.google.connections.map(strip) },
    microsoft: { hasCreds: !!a.microsoft.clientId, connections: a.microsoft.connections.map(strip) }
  };
});

ipcMain.handle('calendar:connect', async (e, { provider, label, clientId, clientSecret, tenant }) => {
  console.log(`[IPC] calendar:connect provider=${provider} label=${label || ''}`);
  try {
    const accounts = readAccounts();
    if (provider === 'google') {
      const id = (clientId || accounts.google.clientId || '').trim();
      const secret = (clientSecret || accounts.google.clientSecret || '').trim();
      if (!id) throw new Error('Falta el Client ID de Google.');
      const conn = await calendarSync.connectGoogle({ clientId: id, clientSecret: secret });
      accounts.google.clientId = id;
      accounts.google.clientSecret = secret;
      conn.id = Date.now().toString();
      conn.label = (label || conn.email || 'Cuenta de Google').trim();
      accounts.google.connections.push(conn);
    } else if (provider === 'microsoft') {
      const id = (clientId || accounts.microsoft.clientId || '').trim();
      const t = (tenant || accounts.microsoft.tenant || 'common').trim();
      if (!id) throw new Error('Falta el Application (client) ID de Microsoft.');
      const conn = await calendarSync.connectMicrosoft({ clientId: id, tenant: t });
      accounts.microsoft.clientId = id;
      accounts.microsoft.tenant = t;
      conn.id = Date.now().toString();
      conn.label = (label || conn.email || 'Cuenta de Microsoft').trim();
      accounts.microsoft.connections.push(conn);
    } else {
      throw new Error('Proveedor desconocido: ' + provider);
    }
    writeAccounts(accounts);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('calendar:disconnect', (e, { provider, id }) => {
  const accounts = readAccounts();
  if (accounts[provider]) {
    accounts[provider].connections = accounts[provider].connections.filter(c => c.id !== id);
    writeAccounts(accounts);
  }
  return true;
});

ipcMain.handle('calendar:getRemoteEvents', async () => {
  console.log('[IPC] calendar:getRemoteEvents');
  const accounts = readAccounts();
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();
  let events = [];
  let errors = []; // se muestran en el panel, no solo en la consola
  let dirty = false;

  const googleCreds = { clientId: accounts.google.clientId, clientSecret: accounts.google.clientSecret };
  for (const conn of accounts.google.connections) {
    try {
      const ev = await calendarSync.fetchGoogleEvents(conn, googleCreds, timeMin, timeMax);
      events = events.concat(ev.map(e => ({ ...e, id: conn.id + '_' + e.id })));
      if (conn.needsReconnect) { conn.needsReconnect = false; dirty = true; }
      dirty = true; // el fetch puede haber refrescado el access token
    } catch (err) {
      console.error(`Google Calendar (${conn.label}):`, err.message);
      errors.push(`Google (${conn.label}): ${err.message}`);
      if (err.needsReconnect) { conn.needsReconnect = true; dirty = true; }
    }
  }
  const msCreds = { clientId: accounts.microsoft.clientId, tenant: accounts.microsoft.tenant };
  for (const conn of accounts.microsoft.connections) {
    try {
      const ev = await calendarSync.fetchMicrosoftEvents(conn, msCreds, timeMin, timeMax);
      events = events.concat(ev.map(e => ({ ...e, id: conn.id + '_' + e.id })));
      dirty = true;
    } catch (err) {
      console.error(`Microsoft Calendar (${conn.label}):`, err.message);
      errors.push(`Microsoft (${conn.label}): ${err.message}`);
    }
  }
  if (dirty) writeAccounts(accounts); // persiste tokens refrescados / needsReconnect
  return { events, errors };
});

// Crea un evento en el Google Calendar de una cuenta conectada específica
// (para eso sirve connectionId: con varias cuentas conectadas, hay que
// saber en cuál crear el evento).
ipcMain.handle('calendar:createGoogleEvent', async (e, { connectionId, title, date, dateTime, durationMinutes }) => {
  console.log(`[IPC] calendar:createGoogleEvent date=${date || ''} dateTime=${dateTime || ''} title=${title}`);
  try {
    const accounts = readAccounts();
    const conn = accounts.google.connections.find(c => c.id === connectionId);
    if (!conn) throw new Error('Esa cuenta de Google ya no está conectada.');
    const creds = { clientId: accounts.google.clientId, clientSecret: accounts.google.clientSecret };
    await calendarSync.createGoogleEvent(conn, creds, { title, date, dateTime, durationMinutes });
    writeAccounts(accounts); // por si el token se refrescó en el proceso
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Crea un recordatorio en Google Tasks (aparece en el móvil vía la app
// de Google Tasks) para una cuenta conectada específica.
ipcMain.handle('calendar:createGoogleTask', async (e, { connectionId, title, dueDate }) => {
  console.log(`[IPC] calendar:createGoogleTask dueDate=${dueDate || ''} title=${title}`);
  try {
    const accounts = readAccounts();
    const conn = accounts.google.connections.find(c => c.id === connectionId);
    if (!conn) throw new Error('Esa cuenta de Google ya no está conectada.');
    const creds = { clientId: accounts.google.clientId, clientSecret: accounts.google.clientSecret };
    await calendarSync.createGoogleTask(conn, creds, { title, dueDate });
    writeAccounts(accounts);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
