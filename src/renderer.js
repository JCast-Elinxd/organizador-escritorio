// ================= Estado =================
let tasks = [];
let events = [];
let remoteEvents = []; // eventos sincronizados de Google/Microsoft (solo lectura)
let calViewDate = new Date();
let calendarDrawerOpen = false; // fuerza el overlay de interacción mientras el drawer está abierto
// Si la zona deja o no espacio a la izquierda (o si lo ocultaste a mano
// desde el mapa de paneles) ahora lo decide main.js, que es quien ve
// las 4 ventanas a la vez — cada ventana se entera por acá.
let leftPanelVisible = false;

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ================= Qué panel muestra ESTA ventana =================
// Cada panel ahora es una ventana real y aparte (ver main.js); todas
// cargan el mismo index.html, pero cada una recibe por query string cuál
// de sus piezas debe mostrar. El CSS (body[data-panel="..."]) se encarga
// de ocultar el resto y de que la pieza visible llene toda la ventana —
// ya no hace falta calcular ningún porcentaje acá, eso ahora es cosa del
// proceso principal (setBounds real, no CSS).
const currentPanel = new URLSearchParams(location.search).get('panel') || '';
document.body.dataset.panel = currentPanel;

// Los modales/drawers ya no necesitan "forzar apagar el clic-a-través"
// (cada ventana es una ventana normal, interactiva de por sí — eso solo
// existía por el hueco de video de la versión de una sola ventana). Se
// deja como función vacía porque muchos puntos del código todavía la
// llaman; así no hay que tocar cada uno de esos sitios.
function setInteractionOverlay() {}

// ================= Edición de la zona: ahora es una ventana real y
// aparte que main.js crea/destruye bajo demanda (ver zone-editor.html).
// Aquí solo hace falta prender/apagar el ícono del botón según el aviso
// que llega por IPC. =================
function setZoneEditButtonState(editing) {
  const btn = document.getElementById('btn-zone-edit');
  if (!btn) return;
  btn.classList.toggle('active', editing);
  btn.textContent = editing ? '🔓' : '🎬';
  btn.title = editing ? 'Terminar edición' : 'Mover / redimensionar el espacio libre';
}
const zoneEditBtn = document.getElementById('btn-zone-edit');
if (zoneEditBtn) zoneEditBtn.addEventListener('click', () => window.api.toggleZoneEdit());

const panelMapBtn = document.getElementById('btn-panel-map');
if (panelMapBtn) panelMapBtn.addEventListener('click', () => window.api.toggleMapWindow());

// ================= Sincronización entre ventanas =================
// Antes todo vivía en una sola página; ahora cada panel es su propio
// proceso, así que cuando UNA ventana cambia algo compartido (tareas,
// eventos, categorías, ajustes), las demás se enteran por acá y se
// refrescan solas.
window.api.onDataChanged('tasks-changed', async () => {
  tasks = await window.api.getTasks();
  if (typeof renderSchedule === 'function') renderSchedule();
  if (typeof tickClock === 'function') tickClock();
  if (typeof renderCalendar === 'function') renderCalendar();
});
window.api.onDataChanged('events-changed', async () => {
  events = await window.api.getEvents();
  if (typeof renderCalendar === 'function') renderCalendar();
});
window.api.onDataChanged('categories-changed', async (categories) => {
  eventCategories = categories;
  if (typeof renderCategoryList === 'function') renderCategoryList();
  if (typeof renderLegend === 'function') renderLegend();
  if (typeof populateEventTypeSelect === 'function') populateEventTypeSelect();
  if (typeof populateTaskTypeSelect === 'function') populateTaskTypeSelect();
  if (typeof renderSchedule === 'function') renderSchedule();
  if (typeof renderCalendar === 'function') renderCalendar();
});
window.api.onDataChanged('settings-changed', (settings) => {
  if (typeof applyTranslucent === 'function') applyTranslucent(settings.translucent);
});
window.api.onDataChanged('zone-edit-changed', setZoneEditButtonState);
window.api.onDataChanged('layout-changed', ({ showLeft }) => {
  leftPanelVisible = showLeft;
  if (typeof renderSchedule === 'function') renderSchedule();
});
window.api.onDataChanged('calendar-geometry', (rect) => {
  calendarScreenRect = rect;
  applyCalendarOverlapPadding();
});
// El modal de pomodoro ahora es una ventana aparte de la del temporizador
// que de verdad corre el reloj — esto es cómo se entera cuando guardas
// cambios ahí.
window.api.onDataChanged('pomodoro-changed', (pomodoro) => {
  if (typeof pomoProfiles === 'undefined') return;
  if (pomodoro.modes) pomoProfiles = { ...structuredClone(defaultPomoProfiles), ...pomodoro.modes };
  if (pomodoro.activeMode && pomoProfiles[pomodoro.activeMode]) pomoProfileId = pomodoro.activeMode;
  pomoSegmentIndex = 0;
  pomoRemaining = pomoTotalFor();
  if (typeof populatePomoProfileSelect === 'function') populatePomoProfileSelect();
  if (typeof renderPomodoro === 'function') renderPomodoro();
});

// Ventanas de modal dedicadas (tarea/evento/pomodoro/conexión): cuando
// main.js las abre, les manda acá los datos que necesitan (qué tarea
// editar, qué fecha, etc.). Como esta ventana recién está arrancando,
// puede llegar ANTES de que termine de cargar sus propias tareas/eventos
// (init() es asíncrono) — si eso pasa, se guarda y se aplica apenas
// termine, en vez de abrir el modal con datos vacíos.
let appDataReady = false;
let pendingModalPayload = undefined;
function routeModalInit(payload) {
  if (!appDataReady) { pendingModalPayload = payload; return; }
  if (currentPanel === 'modal-task') openTaskModal(payload?.taskId ? tasks.find(t => t.id === payload.taskId) : null);
  else if (currentPanel === 'modal-event') openEventModal(new Date(payload.date));
  else if (currentPanel === 'modal-pomo') openPomoConfigModal();
  else if (currentPanel === 'modal-drawer') openCalendarDrawer();
}
window.api.onModalInit(routeModalInit);

// ================= Barra de controles =================
document.getElementById('btn-translucent').addEventListener('click', async () => {
  const settings = await window.api.toggleTranslucent();
  applyTranslucent(settings.translucent);
});
function applyTranslucent(on) {
  document.body.classList.toggle('translucent', on);
  document.getElementById('btn-translucent').classList.toggle('active', on);
}

document.getElementById('btn-display').addEventListener('click', async () => {
  await window.api.cycleDisplay();
});

document.getElementById('btn-ontop').addEventListener('click', async () => {
  const on = await window.api.toggleAlwaysOnTop();
  document.getElementById('btn-ontop').classList.toggle('active', on);
});

// ================= Utilidades de tiempo =================
function fmtRemaining(ms) {
  if (ms <= 0) return '¡Ahora!';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function futureTasks() {
  const now = Date.now();
  return tasks
    .map(t => ({ ...t, _occ: nextOccurrence(t) }))
    .filter(t => t._occ && t._occ.getTime() > now)
    .sort((a, b) => a._occ - b._occ);
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ================= Reloj + próxima actividad + pendientes =================
function fmtClockTime(d) {
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function tickClock() {
  const now = new Date();
  document.getElementById('clock').textContent = fmtClockTime(now);

  const upcoming = futureTasks();
  const nextNameEl = document.getElementById('next-name');
  const nextTimeEl = document.getElementById('next-time');
  const countdownEl = document.getElementById('countdown');
  const pendingList = document.getElementById('pending-list');

  if (upcoming.length === 0) {
    nextNameEl.textContent = 'Sin tareas próximas';
    nextTimeEl.textContent = '';
    countdownEl.textContent = '--:--';
    pendingList.innerHTML = '';
    return;
  }
  const next = upcoming[0];
  nextNameEl.textContent = next.title;
  nextTimeEl.textContent = `(${fmtClockTime(next._occ)})`;
  countdownEl.textContent = fmtRemaining(next._occ - now);

  pendingList.innerHTML = '';
  const rest = upcoming.slice(1);
  if (rest.length === 0) {
    pendingList.innerHTML = '<div class="empty-hint">No hay más tareas en cola.</div>';
  } else {
    rest.forEach(t => {
      const row = document.createElement('div');
      row.className = 'pending-item';
      row.innerHTML = `
        <span class="p-task">${escapeHtml(t.title)}</span>
        <span class="p-time">${fmtClockTime(t._occ)}</span>
        <span class="p-remaining">${fmtRemaining(t._occ - now)}</span>
      `;
      pendingList.appendChild(row);
    });
  }
}

// ================= Cronograma =================
// Las convenciones (categorías) son universales: viven en eventCategories
// y se usan tanto para tareas como para eventos de calendario. 'urgente'
// y 'recurrente' son protegidas (no editables/borrables) porque el resto
// de la app depende de esos ids exactos.
function categoryOf(id) {
  return eventCategories.find(c => c.id === id) || { id, name: id || 'Sin categoría', color: '#8899AA' };
}
// Orden fijo para columnas: solo las convenciones marcadas "ver en
// columnas" (showAsColumn) se muestran como columna propia — urgente
// primero, recurrente al final, el resto (marcadas) en medio, en el
// orden en que el usuario las creó. Las NO marcadas (p. ej. Pendiente
// por defecto, y cualquier convención nueva) se agrupan todas juntas en
// una única columna "OTROS" al final (cada tarjeta conserva su propio
// color, así que dentro de "OTROS" se siguen distinguiendo por tipo).
const OTROS_ID = '__otros__';
function flaggedColumnCategories() {
  const flagged = eventCategories.filter(c => c.showAsColumn);
  const urgent = flagged.filter(c => c.id === 'urgente');
  const recurrent = flagged.filter(c => c.id === 'recurrente');
  const middle = flagged.filter(c => c.id !== 'urgente' && c.id !== 'recurrente');
  return [...urgent, ...middle, ...recurrent];
}
function unflaggedCategories() {
  return eventCategories.filter(c => !c.showAsColumn);
}
// Columnas reales a renderizar: las marcadas + "OTROS" al final (si hace
// falta). orderedCategories() sigue existiendo porque también fija la
// PRIORIDAD de ordenamiento en modo lista (urgente arriba, recurrente
// abajo, lo no marcado queda agrupado en la prioridad de "OTROS").
function orderedCategories() {
  const cols = flaggedColumnCategories();
  const rest = unflaggedCategories();
  if (rest.length === 0) return cols;
  return [...cols, { id: OTROS_ID, name: 'OTROS', color: '#8899AA', isOtros: true }];
}
function scheduleCategories() {
  return [...flaggedColumnCategories(), ...unflaggedCategories()];
}

// Elige las columnas visibles sin caer directamente a modo lista. Las
// categorías se recorren en orden de prioridad: las primeras conservan su
// columna y las restantes se agrupan en OTROS. Si no había categorías sin
// marcar, se agrupan al menos dos para que OTROS sea una reducción real.
function visibleScheduleColumns(categories, availableWidth) {
  const minColumnWidth = 150;
  const gap = 10;
  const maxColumns = Math.max(1, Math.floor((availableWidth + gap) / (minColumnWidth + gap)));
  const flagged = categories.filter(c => c.showAsColumn);
  const unflagged = categories.filter(c => !c.showAsColumn);
  let kept = flagged;
  let overflow = [];

  if (unflagged.length > 0) {
    const keepCount = Math.min(flagged.length, Math.max(0, maxColumns - 1));
    kept = flagged.slice(0, keepCount);
    overflow = flagged.slice(keepCount);
  } else if (flagged.length > maxColumns) {
    const keepCount = Math.min(flagged.length - 2, Math.max(0, maxColumns - 1));
    kept = flagged.slice(0, keepCount);
    overflow = flagged.slice(keepCount);
  }

  const columns = kept.map(category => ({
    ...category,
    categoryIds: [category.id]
  }));
  const otherIds = [...unflagged, ...overflow].map(category => category.id);
  if (otherIds.length > 0) {
    columns.push({
      id: OTROS_ID,
      name: 'OTROS',
      color: '#8899AA',
      isOtros: true,
      categoryIds: otherIds
    });
  }
  return columns;
}
// A qué "columna" pertenece una tarea/categoría real (su propio id si
// está marcada como columna, o OTROS si no).
function columnIdFor(catId) {
  const cat = categoryOf(catId);
  return cat.showAsColumn ? cat.id : OTROS_ID;
}
function hexToRgba(hex, alpha) {
  const h = (hex || '#8899AA').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16) || 0x8899AA;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
const DOW_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // índice = Date.getDay() (0=domingo)
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dom, para mostrar siempre en ese orden

// Próxima ocurrencia de una tarea, sea puntual (datetime) o recurrente
// (recurrence). Todo el ordenamiento y las columnas "Hora/Día" se basan
// en este cálculo.
function nextOccurrence(t) {
  if (t.datetime) return new Date(t.datetime);
  if (!t.recurrence) return null;
  const now = new Date();
  const [h, m] = (t.recurrence.time || '09:00').split(':').map(Number);
  if (t.recurrence.freq === 'daily') {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  // weekly
  const days = (t.recurrence.days && t.recurrence.days.length) ? t.recurrence.days : [now.getDay()];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (days.includes(d.getDay()) && d > now) return d;
  }
  return null;
}

function taskDayLabel(t) {
  if (t.recurrence) {
    if (t.recurrence.freq === 'daily') return 'Todos los días';
    const days = t.recurrence.days || [];
    const ordered = WEEK_ORDER.filter(d => days.includes(d));
    return ordered.length ? ordered.map(d => DOW_LETTER[d]).join('') : 'Semanal';
  }
  const occ = nextOccurrence(t);
  return occ ? occ.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }) : '';
}
function taskTimeLabel(t) {
  const occ = nextOccurrence(t);
  return occ ? occ.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
}

// Sin etiqueta de texto: el tipo se intuye únicamente por el color del
// marco/fondo de la tarjeta (viene de la categoría, no de una clase CSS
// fija, porque ahora las categorías son dinámicas/personalizables).
function taskCardHtml(t) {
  return `
    <div class="t-top">
      <span class="t-title">${escapeHtml(t.title)}</span>
      <span class="t-del" title="Eliminar">✕</span>
    </div>
    <div class="t-meta">
      <span class="t-when">${taskDayLabel(t)} · ${taskTimeLabel(t)}</span>
    </div>
  `;
}

function buildTaskCard(t) {
  const cat = categoryOf(t.type);
  const card = document.createElement('div');
  card.className = 'task-card';
  card.style.borderColor = cat.color;
  card.innerHTML = taskCardHtml(t);
  card.querySelector('.t-when').style.background = hexToRgba(cat.color, 0.35);
  card.addEventListener('click', () => openTaskModal(t));
  card.querySelector('.t-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    tasks = await window.api.deleteTask(t.id);
    renderSchedule();
  });
  return card;
}

// Tareas de una columna (catId puede ser una categoría real marcada como
// columna, o el pseudo-id OTROS que agrupa todas las no marcadas),
// ordenadas cronológicamente dentro de la columna.
function tasksForCategory(catId, categoryIds = null) {
  const matches = catId === OTROS_ID
    ? (t) => categoryIds ? categoryIds.includes(t.type) : columnIdFor(t.type) === OTROS_ID
    : (t) => t.type === catId;
  return tasks
    .filter(matches)
    .map(t => ({ ...t, _occ: nextOccurrence(t) }))
    .sort((a, b) => {
      if (!a._occ && !b._occ) return 0;
      if (!a._occ) return 1;
      if (!b._occ) return -1;
      return a._occ - b._occ;
    });
}

// Todas las tareas mezcladas, para el modo lista (angosto): primero por
// prioridad de categoría (urgente arriba, recurrente abajo, resto en
// medio), y dentro de cada prioridad, cronológicamente.
function tasksSortedByPriority(taskList) {
  const rank = new Map(orderedCategories().map((c, i) => [c.id, i]));
  return [...taskList]
    .map(t => ({ ...t, _occ: nextOccurrence(t) }))
    .sort((a, b) => {
      const ra = rank.has(columnIdFor(a.type)) ? rank.get(columnIdFor(a.type)) : 999;
      const rb = rank.has(columnIdFor(b.type)) ? rank.get(columnIdFor(b.type)) : 999;
      if (ra !== rb) return ra - rb;
      if (!a._occ && !b._occ) return 0;
      if (!a._occ) return 1;
      if (!b._occ) return -1;
      return a._occ - b._occ;
    });
}

function columnTitleEl(cat) {
  const el = document.createElement('div');
  el.className = 'schedule-column-title';
  el.innerHTML = `<span class="col-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}`;
  return el;
}

// Tamaño de fuente dinámico POR COLUMNA (independiente entre columnas):
// grande por defecto, compacto si esa columna en particular no tiene
// espacio cómodo para sus propias tarjetas.
function applyDynamicSize(container, count) {
  const estimatedHeight = count * 64; // alto aproximado de una tarjeta grande
  container.classList.toggle('compact', estimatedHeight > container.clientHeight && count > 4);
}

// Cada columna conserva su altura propia. Solo las columnas cuya caja
// intersecta el calendario se detienen antes de esa superposición; las
// demás siguen hasta el fondo disponible del cronograma.
//
// El calendario ahora vive en OTRA ventana (antes, con una sola ventana,
// se medía directo del DOM porque #panel-toolbar estaba ahí mismo). Acá
// se usa la posición real que main.js manda por 'calendar-geometry'
// (coordenadas de pantalla), convertida a coordenadas LOCALES de esta
// ventana con window.screenX/screenY (la posición de ESTA ventana en la
// pantalla).
let calendarScreenRect = null;
function applyCalendarOverlapPadding() {
  const margin = 10;
  const list = document.getElementById('schedule-list');
  const leftList = document.getElementById('schedule-list-left');
  const containers = [...document.querySelectorAll('#schedule-list-left > .schedule-column')];
  const rightColumns = document.querySelectorAll('#schedule-list > .schedule-column');
  if (rightColumns.length > 0) containers.push(...rightColumns);
  else containers.push(document.getElementById('schedule-list')); // modo lista plana (angosto)

  // En modo lista el límite se aplica al propio #schedule-list. Hay que
  // limpiarlo siempre antes de volver a medir columnas, porque cambiar la
  // clase visual a column-mode no elimina estilos inline anteriores.
  list.style.maxHeight = 'none';
  leftList.style.maxHeight = 'none';
  containers.forEach(column => { column.style.maxHeight = 'none'; });

  if (!calendarScreenRect) return; // main.js todavía no avisó dónde está

  // Rect del calendario, convertido a coordenadas locales de ESTA ventana.
  const toolbarRect = {
    left: calendarScreenRect.x - window.screenX,
    top: calendarScreenRect.y - window.screenY,
    right: calendarScreenRect.x - window.screenX + calendarScreenRect.width,
    bottom: calendarScreenRect.y - window.screenY + calendarScreenRect.height
  };

  containers.forEach(column => {
    const columnRect = column.getBoundingClientRect();
    const overlapsToolbar =
      columnRect.left < toolbarRect.right &&
      columnRect.right > toolbarRect.left &&
      columnRect.top < toolbarRect.bottom &&
      columnRect.bottom > toolbarRect.top;

    if (overlapsToolbar) {
      const availableHeight = toolbarRect.top - columnRect.top - margin;
      column.style.maxHeight = `${Math.max(80, availableHeight)}px`;
    }
  });
}

// Híbrido: en modo ancho se parte en columnas (una por categoría); en
// modo angosto es una sola lista. Si el panel izquierdo (extensión del
// cronograma) está visible, se lleva la PRIMERA categoría (normalmente
// "Urgente") como su única columna, y el panel principal muestra el
// resto de categorías — nunca las mezcla todas revueltas.
function renderSchedule() {
  const list = document.getElementById('schedule-list');
  const leftList = document.getElementById('schedule-list-left');
  const leftVisible = leftPanelVisible;
  list.innerHTML = '';
  leftList.innerHTML = '';
  leftList.className = 'schedule-list list-mode';

  if (tasks.length === 0) {
    list.className = 'schedule-list list-mode';
    list.innerHTML = '<div class="empty-hint">No tienes tareas. Añade la primera.</div>';
    return;
  }

  const cats = scheduleCategories();
  let leftCat = null;
  let rightCats = cats;
  if (leftVisible && cats.length > 1) {
    leftCat = cats[0];
    rightCats = cats.slice(1);
  }

  // --- Panel izquierdo: una sola columna, de la primera categoría ---
  let leftColInfo = null;
  if (leftCat) {
    const catTasks = tasksForCategory(leftCat.id, [leftCat.id]);
    if (catTasks.length === 0) {
      leftList.innerHTML = '<div class="empty-hint">Sin tareas.</div>';
    } else {
      const col = document.createElement('div');
      col.className = 'schedule-column';
      col.appendChild(columnTitleEl(leftCat));
      catTasks.forEach(t => col.appendChild(buildTaskCard(t)));
      leftList.appendChild(col);
      leftColInfo = { col, count: catTasks.length };
    }
  }

  // --- Panel principal: el resto de categorías ---
  if (rightCats.length === 0) {
    list.className = 'schedule-list list-mode';
    list.innerHTML = '<div class="empty-hint">Sin más tareas.</div>';
    applyCalendarOverlapPadding();
    if (leftColInfo) applyDynamicSize(leftColInfo.col, leftColInfo.count);
    return;
  }

  // Se agrupan las categorías de menor prioridad antes de cambiar a lista.
  const visibleColumns = visibleScheduleColumns(rightCats, list.clientWidth);
  const MIN_COL_WIDTH = 150;
  const columnMode = visibleColumns.length > 1 && list.clientWidth / visibleColumns.length >= MIN_COL_WIDTH;
  list.className = 'schedule-list ' + (columnMode ? 'column-mode' : 'list-mode');
  list.style.gridTemplateColumns = columnMode ? `repeat(${visibleColumns.length}, 1fr)` : '';

  if (columnMode) {
    const builtColumns = [];
    visibleColumns.forEach(cat => {
      const catTasks = tasksForCategory(cat.id, cat.categoryIds);
      const col = document.createElement('div');
      col.className = 'schedule-column';
      col.appendChild(columnTitleEl(cat));
      catTasks.forEach(t => col.appendChild(buildTaskCard(t)));
      list.appendChild(col);
      builtColumns.push({ col, count: catTasks.length });
    });
    // El alto máximo real se fija ANTES de decidir el tamaño compacto de
    // CUALQUIER columna (incluida la izquierda): si se hiciera al revés,
    // "compacto" se calcularía contra un alto desactualizado.
    applyCalendarOverlapPadding();
    builtColumns.forEach(({ col, count }) => applyDynamicSize(col, count));
    if (leftColInfo) applyDynamicSize(leftColInfo.col, leftColInfo.count);
    return;
  }

  const rightIds = rightCats.map(c => c.id);
  const flat = tasksSortedByPriority(tasks.filter(t => rightIds.includes(t.type)));
  if (flat.length === 0) {
    list.innerHTML = '<div class="empty-hint">Sin más tareas.</div>';
  } else {
    flat.forEach(t => list.appendChild(buildTaskCard(t)));
  }
  applyCalendarOverlapPadding();
  if (flat.length > 0) applyDynamicSize(list, flat.length);
  if (leftColInfo) applyDynamicSize(leftColInfo.col, leftColInfo.count);
}
const scheduleResizeObserver = new ResizeObserver(() => renderSchedule());

// ================= Calendario =================
// Tamaño/visibilidad adaptable con ResizeObserver (más confiable que
// "container queries" de CSS en este layout con flexbox). Orden pedido
// según falte ALTURA: 1) achica letra, 2) recorta las filas inferiores de
// convenciones, 3) esconde días de la semana, 4) esconde selector de mes.
// Para ANCHO: la agenda se adapta progresivamente y se esconde si no hay
// espacio real, mientras la grilla también achica.
function updateCalendarResponsive() {
  const body = document.getElementById('cal-body');
  if (!body) return;
  const w = body.clientWidth;
  const h = body.clientHeight;

  // El calendario tiene prioridad: calcula su tamaño sin reservar ancho
  // para la agenda. La agenda recibe únicamente el espacio sobrante y
  // cede primero cuando el panel se estrecha.
  const headerReserve = h < 170 ? 0 : 36;
  const heightCell = Math.floor((h - headerReserve - 4) / 7);
  const agendaMinWidth = 68;
  const widthCell = Math.floor((w - 18) / 7);
  const cell = Math.max(18, Math.min(30, heightCell, widthCell));
  const font = Math.max(8, Math.min(11, Math.round(cell * 11 / 30)));

  body.style.setProperty('--cal-cell', `${cell}px`);
  body.style.setProperty('--cal-font', `${font}px`);
  const agendaWidth = body.clientWidth - (cell * 7 + 18);
  const keepAgenda = agendaWidth >= agendaMinWidth;
  const titleSpace = agendaWidth - 12 - 6 - 8 - 42 - 8;
  const titleFont = Math.max(8, Math.min(12, 8 + titleSpace / 36));
  const legend = document.getElementById('cal-legend');
  body.classList.toggle('agenda-stacked', agendaWidth < 240);
  body.style.setProperty('--agenda-title-font', `${titleFont}px`);
  body.classList.toggle('hide-dow', h < 210);
  body.classList.toggle('hide-header', h < 170);
  // El formato de solo fecha necesita mucho menos ancho que una fila
  // completa; se oculta únicamente cuando ya no caben punto + fecha.
  body.classList.toggle('hide-agenda', !keepAgenda);

  // La leyenda conserva las primeras filas y recorta solo las inferiores
  // cuando la altura disponible se reduce, en vez de desaparecer completa.
  const header = document.getElementById('cal-month-label').parentElement;
  const grid = document.getElementById('cal-grid');
  const headerHeight = body.classList.contains('hide-header') ? 0 : header.offsetHeight + 8;
  const legendSpace = Math.max(0, h - headerHeight - grid.offsetHeight - 8);
  trimLegendToHeight(legend, legendSpace);
}
const calResizeObserver = new ResizeObserver(() => updateCalendarResponsive());

function trimLegendToHeight(legend, availableHeight) {
  const items = [...legend.querySelectorAll('.legend-category, .legend-sync')];
  items.forEach(item => item.classList.remove('legend-hidden'));
  legend.style.maxHeight = 'none';
  legend.style.overflow = 'visible';

  // Quita convenciones completas desde el final hasta que no quede una
  // fracción de fila escondida bajo el límite inferior.
  while (items.some(item => item.offsetParent !== null) && legend.scrollHeight > availableHeight) {
    const visible = items.filter(item => !item.classList.contains('legend-hidden'));
    if (visible.length === 0) break;
    visible[visible.length - 1].classList.add('legend-hidden');
  }
  legend.style.maxHeight = `${availableHeight}px`;
  legend.style.overflow = 'hidden';
}

// ================= Temporizador: ancho adaptable =================
// Igual que el calendario, se decide con el tamaño REAL del panel (no
// con media queries), porque su ancho depende de dónde esté la zona de
// video, no del tamaño de la ventana. Umbrales: normal (reloj/pomodoro
// lado a lado) -> narrow (se apilan) -> tiny (además se achica la letra).
function updateTimerResponsive() {
  const panel = document.getElementById('panel-timer');
  const w = panel.clientWidth;
  panel.classList.toggle('timer-narrow', w < 380);
  panel.classList.toggle('timer-tiny', w < 220);
}
const timerResizeObserver = new ResizeObserver(() => updateTimerResponsive());

// El toolbar conserva sus seis botones en una sola fila y reduce sus
// dimensiones según el ancho real del panel, especialmente cuando la zona
// de video deja poco espacio para el calendario.
function updateToolbarResponsive() {
  const toolbar = document.getElementById('panel-toolbar');
  if (!toolbar) return;
  const width = toolbar.clientWidth;
  const gap = width < 180 ? 2 : width < 240 ? 4 : 6;
  const padding = width < 180 ? 4 : width < 240 ? 6 : 8;
  const buttonWidth = Math.max(14, Math.min(26, Math.floor((width - padding * 2 - gap * 5) / 6)));
  const buttonHeight = Math.max(18, Math.min(24, buttonWidth - 2));
  const fontSize = Math.max(8, Math.min(12, Math.round(buttonWidth * 12 / 26)));
  toolbar.style.setProperty('--toolbar-gap', `${gap}px`);
  toolbar.style.setProperty('--toolbar-padding', `6px ${padding}px`);
  toolbar.style.setProperty('--toolbar-button-width', `${buttonWidth}px`);
  toolbar.style.setProperty('--toolbar-button-height', `${buttonHeight}px`);
  toolbar.style.setProperty('--toolbar-button-font', `${fontSize}px`);
}
const toolbarResizeObserver = new ResizeObserver(() => updateToolbarResponsive());

let eventCategories = []; // {id,name,color}, personalizable — ver sección de categorías

function allEvents() {
  return events.concat(remoteEvents);
}

// Color de un evento: si es sincronizado y Google le dio un color propio,
// se usa ese; si no, se busca en las convenciones del usuario por su
// "type"; si tampoco hay match, cae al morado genérico de "sincronizado".
function eventColor(ev) {
  if (ev.color) return ev.color;
  const cat = eventCategories.find(c => c.id === ev.type);
  if (cat) return cat.color;
  return '#9B6BD6';
}

// Convierte SOLO las tareas urgentes con fecha en "eventos" del mes, para
// que se vean como puntos en el calendario. Las recurrentes nunca se
// muestran ahí (a propósito), y las demás categorías tampoco: solo
// urgente + fecha.
function taskEventsForMonth(year, month) {
  const out = [];
  tasks.forEach(t => {
    if (t.type !== 'urgente' || !t.datetime) return;
    const d = new Date(t.datetime);
    if (d.getFullYear() === year && d.getMonth() === month) {
      out.push({ id: `task_${t.id}`, title: t.title, date: toISODate(d), color: categoryOf(t.type).color, isTask: true, taskId: t.id });
    }
  });
  return out;
}

function renderCalendar() {
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  document.getElementById('cal-month-label').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  DOW.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toDateString();
  const merged = allEvents().concat(taskEventsForMonth(year, month));

  for (let i = 0; i < startOffset; i++) grid.appendChild(document.createElement('div'));

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (cellDate.toDateString() === todayStr ? ' today' : '');
    const dayEvents = merged.filter(ev => sameDate(ev.date, cellDate));
    cell.innerHTML = `<span>${day}</span><span class="dots">${dayEvents.map(ev => `<span class="dot" style="background:${eventColor(ev)}"></span>`).join('')}</span>`;
    cell.addEventListener('click', () => openEventModal(cellDate));
    grid.appendChild(cell);
  }

  renderAgenda();
}
function sameDate(isoDateStr, dateObj) {
  const d = new Date(isoDateStr + 'T00:00:00');
  return d.toDateString() === dateObj.toDateString();
}

// Lista de próximos eventos DE CALENDARIO únicamente (nunca tareas de
// otros paneles). Solo se ve si el panel tiene espacio de sobra, porque
// el grid de arriba es de tamaño fijo y no lo empuja.
function renderAgenda() {
  const list = document.getElementById('cal-agenda');
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcoming = allEvents()
    .map(ev => ({ ...ev, _d: new Date(ev.date + 'T00:00:00') }))
    .filter(ev => ev._d >= now)
    .sort((a, b) => a._d - b._d)
    .slice(0, 30);

  if (upcoming.length === 0) {
    list.innerHTML = '<div class="empty-hint">Sin eventos próximos.</div>';
    return;
  }
  list.innerHTML = upcoming.map(ev => `
    <div class="agenda-item">
      <span class="agenda-dot" style="background:${eventColor(ev)}"></span>
      <span class="agenda-date">${ev._d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })}</span>
      <span class="agenda-title">${escapeHtml(ev.title)}</span>
    </div>
  `).join('');
}

async function fetchRemoteEvents() {
  let errors = [];
  try {
    const result = await window.api.getRemoteEvents();
    remoteEvents = result.events || [];
    errors = result.errors || [];
  } catch {
    remoteEvents = [];
  }
  document.getElementById('legend-sync').classList.toggle('visible', remoteEvents.length > 0);
  const errBox = document.getElementById('calendar-sync-errors');
  if (errBox) errBox.textContent = errors.length ? 'Error sincronizando: ' + errors.join(' · ') : '';
  // Aviso visible SIN necesidad de abrir el cajón: el botón 🔗 se pone en
  // rojo si algo falló (p. ej. una cuenta necesita reconectarse).
  const connectBtn = document.getElementById('btn-calendar-connect');
  if (connectBtn) {
    connectBtn.classList.toggle('has-error', errors.length > 0);
    connectBtn.title = errors.length
      ? 'Hay un problema sincronizando: ' + errors.join(' · ')
      : 'Conectar Google Calendar / Microsoft Calendar';
  }
  if (calendarDrawerOpen) refreshCalendarDrawerStatus(); // refleja el ⚠ Reconectar si el cajón ya está abierto
  renderCalendar();
}

// ================= Convenciones (categorías) personalizables =================
// Cuántas tareas/eventos usan una categoría — para bloquear el borrado
// de convenciones que están en uso (evita "huérfanos" invisibles).
function categoryUsageCount(id) {
  return tasks.filter(t => t.type === id).length + events.filter(ev => ev.type === id).length;
}

function renderCategoryList() {
  const list = document.getElementById('category-list');
  if (!list) return;
  list.innerHTML = eventCategories.map(c => {
    const isProtected = !!c.protected;
    return `
    <div class="category-row ${isProtected ? 'protected' : ''}" data-id="${c.id}" draggable="${!isProtected}">
      ${isProtected ? '' : '<span class="category-drag-handle" title="Arrastrar para cambiar la prioridad">⋮⋮</span>'}
      <input type="color" class="category-color" value="${c.color}" ${isProtected ? 'disabled' : ''} />
      <input type="text" class="category-name" value="${escapeHtml(c.name)}" ${isProtected ? 'disabled' : ''} />
      <label class="category-column-toggle" title="Ver en columnas: le da su propia columna en el cronograma. Si no, se agrupa con las demás sin marcar en una columna 'OTROS'.">
        <input type="checkbox" class="category-column-check" ${c.showAsColumn ? 'checked' : ''} ${isProtected ? 'disabled' : ''} /> 📊
      </label>
      ${isProtected
        ? '<span class="protected-lock" title="Convención del sistema: no se puede borrar ni modificar">🔒</span>'
        : '<button class="category-remove" title="Quitar">✕</button>'}
    </div>
  `;
  }).join('');

  const errorEl = document.getElementById('category-error');
  if (errorEl) errorEl.textContent = '';

  let draggedCategoryId = null;
  list.querySelectorAll('.category-row[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedCategoryId = row.dataset.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCategoryId);
    });
    row.addEventListener('dragend', () => {
      draggedCategoryId = null;
      row.classList.remove('dragging');
      list.querySelectorAll('.category-row').forEach(item => item.classList.remove('drag-over'));
    });
  });
  list.querySelectorAll('.category-row').forEach(row => {
    row.addEventListener('dragover', (e) => {
      if (!draggedCategoryId || row.dataset.id === draggedCategoryId) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      row.classList.add('drag-over');
      const dragged = list.querySelector(`[data-id="${CSS.escape(draggedCategoryId)}"]`);
      if (!dragged) return;
      list.insertBefore(dragged, after ? row.nextSibling : row);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async (e) => {
      if (!draggedCategoryId) return;
      e.preventDefault();
      const order = [...list.querySelectorAll('.category-row')].map(item => item.dataset.id);
      const byId = new Map(eventCategories.map(category => [category.id, category]));
      eventCategories = order.map(id => byId.get(id)).filter(Boolean);
      await saveCategoriesAndRefresh();
    });
  });

  list.querySelectorAll('.category-row:not(.protected)').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.category-color').addEventListener('change', (e) => {
      const cat = eventCategories.find(c => c.id === id);
      if (cat) { cat.color = e.target.value; saveCategoriesAndRefresh(); }
    });
    row.querySelector('.category-name').addEventListener('change', (e) => {
      const cat = eventCategories.find(c => c.id === id);
      if (cat) { cat.name = e.target.value.trim() || cat.name; saveCategoriesAndRefresh(); }
    });
    row.querySelector('.category-column-check').addEventListener('change', (e) => {
      const cat = eventCategories.find(c => c.id === id);
      if (cat) { cat.showAsColumn = e.target.checked; saveCategoriesAndRefresh(); }
    });
    row.querySelector('.category-remove').addEventListener('click', () => {
      const usage = categoryUsageCount(id);
      if (usage > 0) {
        if (errorEl) errorEl.textContent = `No se puede borrar: hay ${usage} tarea(s)/evento(s) usando esta convención. Cámbialos de tipo primero.`;
        return;
      }
      eventCategories = eventCategories.filter(c => c.id !== id);
      saveCategoriesAndRefresh();
    });
  });
}
async function saveCategoriesAndRefresh() {
  eventCategories = await window.api.saveEventCategories(eventCategories);
  renderCategoryList();
  renderLegend();
  populateEventTypeSelect();
  populateTaskTypeSelect();
  renderSchedule(); // los colores/columnas del cronograma dependen de las categorías
  renderCalendar();
}
document.getElementById('category-add-btn').addEventListener('click', () => {
  eventCategories.push({ id: 'cat_' + Date.now(), name: 'Nueva', color: '#8899AA', showAsColumn: false });
  saveCategoriesAndRefresh();
});

function renderLegend() {
  const legend = document.getElementById('cal-legend');
  const syncSpan = document.getElementById('legend-sync');
  legend.querySelectorAll('.legend-category').forEach(el => el.remove());
  eventCategories.forEach(c => {
    const span = document.createElement('span');
    span.className = 'legend-category';
    span.innerHTML = `<i class="dot" style="background:${c.color}"></i>${escapeHtml(c.name)}`;
    legend.insertBefore(span, syncSpan);
  });
}

function populateEventTypeSelect() {
  const select = document.getElementById('event-type');
  select.innerHTML = eventCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// Las categorías son universales: el tipo de tarea usa la misma lista
// de convenciones REALES (nunca el pseudo-grupo "OTROS", que no es una
// categoría de verdad, solo una forma de agrupar columnas en pantalla).
function populateTaskTypeSelect() {
  const select = document.getElementById('task-type');
  select.innerHTML = [...flaggedColumnCategories(), ...unflaggedCategories()]
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// ================= Modales =================
let editingTaskId = null; // null = creando; si no, se está editando esa tarea

function updateTaskFieldsVisibility() {
  const type = document.getElementById('task-type').value;
  const isRecurrent = type === 'recurrente';
  document.getElementById('task-oneoff-fields').style.display = isRecurrent ? 'none' : 'block';
  document.getElementById('task-recurrence-fields').style.display = isRecurrent ? 'flex' : 'none';
  // La duración (y el bloqueo automático de Stretchly que dispara) solo
  // tiene sentido para tipos con una hora puntual — urgente y recurrente.
  document.getElementById('task-duration-field').style.display = (type === 'urgente' || isRecurrent) ? 'block' : 'none';
  // Agregar a Google Calendar (con hora exacta) solo tiene sentido para
  // urgentes: son las únicas con una fecha/hora puntual que amerita
  // verse como evento, no solo como recordatorio de lista de tareas.
  document.getElementById('task-google-calendar-field').style.display = type === 'urgente' ? 'block' : 'none';
}
function updateWeekdayPickerVisibility() {
  const freq = document.getElementById('task-recur-freq').value;
  document.getElementById('task-recur-days').style.display = freq === 'weekly' ? 'flex' : 'none';
}
document.getElementById('task-type').addEventListener('change', updateTaskFieldsVisibility);
document.getElementById('task-recur-freq').addEventListener('change', updateWeekdayPickerVisibility);

async function populateTaskGoogleTargetSelect() {
  const select = document.getElementById('task-google-target');
  const status = await window.api.getCalendarStatus();
  const options = ['<option value="">No crear recordatorio en Google Tasks</option>']
    .concat(status.google.connections.map(c => `<option value="${c.id}">Recordatorio en Google Tasks: ${escapeHtml(c.label)}</option>`));
  select.innerHTML = options.join('');

  const calSelect = document.getElementById('task-google-calendar-target');
  const calOptions = ['<option value="">No agregar a Google Calendar</option>']
    .concat(status.google.connections.map(c => `<option value="${c.id}">Evento en Google Calendar: ${escapeHtml(c.label)}</option>`));
  calSelect.innerHTML = calOptions.join('');
}

async function openTaskModal(existingTask) {
  // Esta función vive en TODAS las ventanas (mismo archivo compartido).
  // Si no soy la ventana dedicada al modal de tarea, le pido a main.js
  // que abra (o traiga al frente) esa ventana aparte, con el id de la
  // tarea si es que se está editando una — y no hago nada más acá: el
  // panel que disparó esto (cronograma) se queda intacto, tal cual.
  if (currentPanel !== 'modal-task') {
    window.api.openModal('task', { taskId: existingTask ? existingTask.id : null });
    return;
  }
  editingTaskId = existingTask ? existingTask.id : null;
  document.getElementById('task-modal-title').textContent = existingTask ? 'Editar tarea' : 'Nueva tarea';
  document.getElementById('task-delete').style.display = existingTask ? '' : 'none';
  document.getElementById('task-save-error').textContent = '';

  document.getElementById('task-title').value = existingTask ? existingTask.title : '';
  populateTaskTypeSelect();
  document.getElementById('task-type').value = existingTask ? existingTask.type : 'pendiente';

  if (existingTask && existingTask.recurrence) {
    document.getElementById('task-recur-freq').value = existingTask.recurrence.freq;
    document.getElementById('task-recur-time').value = existingTask.recurrence.time || '09:00';
    document.querySelectorAll('#task-recur-days input').forEach(cb => {
      cb.checked = (existingTask.recurrence.days || []).includes(Number(cb.value));
    });
  } else {
    document.getElementById('task-recur-freq').value = 'daily';
    document.getElementById('task-recur-time').value = '09:00';
    document.querySelectorAll('#task-recur-days input').forEach(cb => cb.checked = false);
  }
  document.getElementById('task-datetime').value = (existingTask && existingTask.datetime)
    ? existingTask.datetime.slice(0, 16) : '';
  document.getElementById('task-duration').value = (existingTask && existingTask.duration) ? existingTask.duration : 25;

  updateTaskFieldsVisibility();
  updateWeekdayPickerVisibility();
  await populateTaskGoogleTargetSelect();
  document.getElementById('task-modal').classList.add('open');
}
function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('open');
  if (currentPanel === 'modal-task') window.api.closeModal('task');
}

let pendingEventDate = null;
async function openEventModal(dateObj) {
  if (currentPanel !== 'modal-event') {
    window.api.openModal('event', { date: dateObj.toISOString() });
    return;
  }
  pendingEventDate = dateObj;
  document.getElementById('event-title').value = '';
  if (eventCategories.length) document.getElementById('event-type').value = eventCategories[0].id;
  document.getElementById('event-date').value = toISODate(dateObj);
  document.getElementById('event-save-error').textContent = '';
  renderDayItems(dateObj);
  await populateGoogleTargetSelect();
  document.getElementById('event-modal').classList.add('open');
}

// Lista de lo que ya hay ese día (eventos de calendario + tareas), cada
// uno con su botón para borrarlo directamente desde el calendario.
function renderDayItems(dateObj) {
  const container = document.getElementById('event-day-items');
  const year = dateObj.getFullYear(), month = dateObj.getMonth();
  const dayEvents = allEvents().filter(ev => sameDate(ev.date, dateObj));
  const dayTasks = taskEventsForMonth(year, month).filter(ev => sameDate(ev.date, dateObj));
  const items = [...dayEvents.map(ev => ({ ...ev, kind: 'event' })), ...dayTasks.map(ev => ({ ...ev, kind: 'task' }))];

  if (items.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = items.map(it => {
    const deletable = it.kind === 'task' || !it.source; // los sincronizados de Google/Microsoft son de solo lectura
    return `
    <div class="day-item" data-kind="${it.kind}" data-id="${it.kind === 'task' ? it.taskId : it.id}">
      <span class="day-item-dot" style="background:${it.color || eventColor(it)}"></span>
      <span class="day-item-title">${escapeHtml(it.title)}${it.kind === 'task' ? ' (tarea)' : ''}${it.source ? ' (sincronizado)' : ''}</span>
      ${deletable ? '<button class="day-item-del" title="Eliminar">✕</button>' : ''}
    </div>
  `;
  }).join('');

  container.querySelectorAll('.day-item').forEach(row => {
    const delBtn = row.querySelector('.day-item-del');
    if (!delBtn) return;
    delBtn.addEventListener('click', async () => {
      const { kind, id } = row.dataset;
      if (kind === 'task') {
        tasks = await window.api.deleteTask(id);
        renderSchedule();
      } else {
        events = await window.api.deleteEvent(id);
      }
      renderCalendar();
      renderDayItems(dateObj);
    });
  });
}

function closeEventModal() {
  document.getElementById('event-modal').classList.remove('open');
  if (currentPanel === 'modal-event') window.api.closeModal('event');
}
async function populateGoogleTargetSelect() {
  const select = document.getElementById('event-google-target');
  const status = await window.api.getCalendarStatus();
  const options = ['<option value="">No guardar en Google (solo local)</option>']
    .concat(status.google.connections.map(c => `<option value="${c.id}">También en Google: ${escapeHtml(c.label)}</option>`));
  select.innerHTML = options.join('');
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal(null));
document.getElementById('task-cancel').addEventListener('click', closeTaskModal);
document.getElementById('task-delete').addEventListener('click', async () => {
  if (!editingTaskId) return;
  tasks = await window.api.deleteTask(editingTaskId);
  renderSchedule();
  closeTaskModal();
});
document.getElementById('task-save').addEventListener('click', async () => {
  const title = document.getElementById('task-title').value.trim();
  if (!title) return;
  const type = document.getElementById('task-type').value;
  const errorEl = document.getElementById('task-save-error');
  errorEl.textContent = '';

  let payload = { title, type, datetime: null, recurrence: null };
  if (type === 'urgente' || type === 'recurrente') {
    payload.duration = Math.max(1, Math.min(480, Number(document.getElementById('task-duration').value) || 25));
  }
  if (type === 'recurrente') {
    const freq = document.getElementById('task-recur-freq').value;
    const time = document.getElementById('task-recur-time').value || '09:00';
    const days = Array.from(document.querySelectorAll('#task-recur-days input:checked')).map(cb => Number(cb.value));
    payload.recurrence = { freq, time, days };
  } else {
    const datetime = document.getElementById('task-datetime').value;
    payload.datetime = datetime || null;
  }

  if (editingTaskId) {
    tasks = await window.api.updateTask({ id: editingTaskId, ...payload });
  } else {
    tasks = await window.api.addTask(payload);
  }
  renderSchedule();

  const googleConnectionId = document.getElementById('task-google-target').value;
  if (googleConnectionId) {
    const occ = nextOccurrence(payload);
    const result = await window.api.createGoogleTask({
      connectionId: googleConnectionId, title,
      dueDate: occ ? occ.toISOString() : null
    });
    if (!result.success) {
      errorEl.textContent = 'Se guardó local, pero no en Google Tasks: ' + result.error;
      return; // deja el modal abierto para que se vea el error
    }
  }

  const googleCalConnectionId = document.getElementById('task-google-calendar-target').value;
  if (googleCalConnectionId && payload.datetime) {
    const result = await window.api.createGoogleEvent({
      connectionId: googleCalConnectionId, title, dateTime: payload.datetime, durationMinutes: payload.duration || 60
    });
    if (!result.success) {
      errorEl.textContent = 'Se guardó local, pero no en Google Calendar: ' + result.error;
      return; // deja el modal abierto para que se vea el error
    }
    fetchRemoteEvents(); // trae el evento recién creado de vuelta ya con su color real
  }
  closeTaskModal();
});

document.getElementById('event-cancel').addEventListener('click', closeEventModal);
document.getElementById('event-save').addEventListener('click', async () => {
  const title = document.getElementById('event-title').value.trim();
  if (!title) return;
  const type = document.getElementById('event-type').value;
  const date = document.getElementById('event-date').value;
  const googleConnectionId = document.getElementById('event-google-target').value;
  const errorEl = document.getElementById('event-save-error');
  errorEl.textContent = '';

  events = await window.api.addEvent({ title, type, date });
  renderCalendar();

  if (googleConnectionId) {
    const result = await window.api.createGoogleEvent({ connectionId: googleConnectionId, title, date });
    if (!result.success) {
      errorEl.textContent = 'Se guardó local, pero no en Google: ' + result.error;
      return; // deja el modal abierto para que se vea el error
    }
    fetchRemoteEvents(); // trae el evento recién creado de vuelta ya con su color real
  }
  closeEventModal();
});

document.getElementById('cal-prev').addEventListener('click', () => {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
  renderCalendar();
});

// ================= Drawer de calendarios: en el borde derecho, no un modal centrado =================
function openCalendarDrawer() {
  if (currentPanel !== 'modal-drawer') {
    window.api.openModal('drawer', {});
    return;
  }
  calendarDrawerOpen = true;
  document.getElementById('calendar-drawer').classList.add('open');
  refreshCalendarDrawerStatus();
}
function closeCalendarDrawer() {
  calendarDrawerOpen = false;
  document.getElementById('calendar-drawer').classList.remove('open');
  window.api.cancelCalendarFlow(); // por si se cierra a medio proceso de login
  if (currentPanel === 'modal-drawer') window.api.closeModal('drawer');
}
document.getElementById('btn-calendar-connect').addEventListener('click', openCalendarDrawer);
document.getElementById('calendar-drawer-close').addEventListener('click', closeCalendarDrawer);

function renderAccountChips(provider, connections) {
  const container = document.getElementById(`${provider}-accounts`);
  if (connections.length === 0) {
    container.innerHTML = '<div class="empty-hint">Sin cuentas conectadas.</div>';
    return;
  }
  container.innerHTML = connections.map(c => `
    <div class="account-chip ${c.needsReconnect ? 'needs-reconnect' : ''}" data-id="${c.id}">
      <div class="account-info">
        <span class="account-label">${escapeHtml(c.label)}${c.needsReconnect ? ' <span class="reconnect-badge" title="La sesión caducó, hay que reconectar">⚠ Reconectar</span>' : ''}</span>
        <span class="account-email">${escapeHtml(c.email || '')}</span>
      </div>
      <button class="account-remove" title="Quitar esta cuenta" data-provider="${provider}" data-id="${c.id}">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('.account-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.disconnectCalendar(btn.dataset.provider, btn.dataset.id);
      await refreshCalendarDrawerStatus();
      await fetchRemoteEvents();
    });
  });
}

async function refreshCalendarDrawerStatus() {
  const status = await window.api.getCalendarStatus();
  renderAccountChips('google', status.google.connections);
  renderAccountChips('microsoft', status.microsoft.connections);
}

document.getElementById('google-connect-btn').addEventListener('click', () => {
  const fields = document.getElementById('google-fields');
  fields.style.display = fields.style.display === 'flex' ? 'none' : 'flex';
});
document.getElementById('microsoft-connect-btn').addEventListener('click', () => {
  const fields = document.getElementById('microsoft-fields');
  fields.style.display = fields.style.display === 'flex' ? 'none' : 'flex';
});

async function submitCalendarConnect(provider, opts, submitBtn) {
  const errorEl = document.getElementById('calendar-connect-error');
  errorEl.textContent = '';
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Esperando el navegador…';
  submitBtn.disabled = true;
  try {
    const result = await window.api.connectCalendar({ provider, ...opts });
    if (!result.success) throw new Error(result.error || 'No se pudo conectar.');
    document.getElementById(`${provider}-fields`).style.display = 'none';
    document.querySelectorAll(`#${provider}-fields input`).forEach(i => i.value = '');
    await refreshCalendarDrawerStatus();
    await fetchRemoteEvents();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.textContent = originalLabel;
    submitBtn.disabled = false;
  }
}

document.getElementById('google-fields-submit').addEventListener('click', () => {
  const label = document.getElementById('google-account-label').value.trim();
  const clientId = document.getElementById('google-client-id').value.trim();
  const clientSecret = document.getElementById('google-client-secret').value.trim();
  submitCalendarConnect('google', { label, clientId, clientSecret }, document.getElementById('google-fields-submit'));
});
document.getElementById('microsoft-fields-submit').addEventListener('click', () => {
  const label = document.getElementById('microsoft-account-label').value.trim();
  const clientId = document.getElementById('microsoft-client-id').value.trim();
  submitCalendarConnect('microsoft', { label, clientId }, document.getElementById('microsoft-fields-submit'));
});

// Enlaces directos a las páginas exactas de creación de credenciales
// (verificados; si Google/Microsoft cambian su consola, avisa para actualizarlos).
document.getElementById('google-open-consent').addEventListener('click', () => {
  window.api.openExternal('https://console.cloud.google.com/apis/credentials/consent');
});
document.getElementById('google-open-creds').addEventListener('click', () => {
  window.api.openExternal('https://console.cloud.google.com/apis/credentials/oauthclient');
});
document.getElementById('google-open-api').addEventListener('click', () => {
  window.api.openExternal('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
});
document.getElementById('microsoft-open-creds').addEventListener('click', () => {
  window.api.openExternal('https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
});

// ================= Pomodoro =================
const defaultPomoProfiles = {
  work: { name: 'Trabajo', segments: [{ name: 'Trabajo', min: 25, break: false }, { name: 'Descanso', min: 5, break: true }] },
  exercise: { name: 'Ejercicio', segments: [{ name: 'Ejercicio', min: 45, break: false }, { name: 'Descanso', min: 10, break: true }] },
  game: { name: 'Juego', segments: [{ name: 'Juego', min: 60, break: false }, { name: 'Descanso', min: 10, dynamic: true, break: true }] },
  custom: { name: 'Personalizado', segments: [{ name: 'Personalizado', min: 25, break: false }, { name: 'Descanso', min: 5, break: true }] }
};
let pomoProfiles = structuredClone(defaultPomoProfiles);
let pomoProfileId = 'work'; // modo ACTIVO (el que corre de verdad)
let pomoEditingModeId = 'work'; // modo que se está viendo/editando DENTRO del modal — separado a propósito: antes usaban la misma variable y con solo abrir el modal para mirar otro modo, ya cambiabas el modo activo sin querer.
let pomoSegmentIndex = 0;
let pomoRemaining = pomoProfiles.work.segments[0].min * 60;
let pomoRunning = false;
let pomoInterval = null;
let pomoStretchlyLinked = false;
let pomoStretchlyBreakSent = false;
let pomoConfigDraft = null;

// Menú desplegable propio genérico: setup se llama UNA vez (registra el
// click del botón y el cierre al hacer clic afuera); renderDropdownOptions
// se llama cada vez que cambian las opciones o la selección.
function setupCustomDropdown(toggleId, menuId) {
  const toggle = document.getElementById(toggleId);
  const menu = document.getElementById(menuId);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !menu.classList.contains('open');
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    if (willOpen) menu.classList.add('open');
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => menu.classList.remove('open'));
}
function renderDropdownOptions(toggleId, menuId, entries, currentId, onSelect) {
  const current = entries.find(([id]) => id === currentId);
  document.getElementById(toggleId).textContent = `${current ? current[1] : entries[0]?.[1] || ''} ▾`;
  const menu = document.getElementById(menuId);
  menu.innerHTML = entries.map(([id, label]) => `<div class="dropdown-option ${id === currentId ? 'selected' : ''}" data-id="${id}">${escapeHtml(label)}</div>`).join('');
  menu.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.addEventListener('click', () => {
      menu.classList.remove('open');
      onSelect(opt.dataset.id);
    });
  });
}

function activePomoProfile() { return pomoProfiles[pomoProfileId] || pomoProfiles.work; }
function activePomoSegment() { return activePomoProfile().segments[pomoSegmentIndex] || activePomoProfile().segments[0]; }
function pomoTotalFor(segment = activePomoSegment()) { return (segment?.min || 1) * 60; }
function fmtMinSec(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = Math.floor(totalSeconds) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Los siguientes N segmentos del ciclo (dando la vuelta al perfil si hace
// falta), con su duración COMPLETA (todavía no empezaron). Se muestran en
// gris a la derecha del cronómetro principal, que sigue siendo el único
// con el tiempo restante real.
function pomoCyclePreview(count = 3) {
  const segments = activePomoProfile().segments;
  if (segments.length <= 1) return [];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const seg = segments[(pomoSegmentIndex + i) % segments.length];
    out.push({ name: seg.name, seconds: pomoTotalFor(seg) });
  }
  return out;
}
function renderPomodoro() {
  const segment = activePomoSegment();
  document.getElementById('pomo-mode').textContent = segment.name.toUpperCase();
  document.getElementById('pomo-mode').classList.toggle('break', segment.break || /descanso|pausa/i.test(segment.name));
  document.getElementById('pomo-time').textContent = fmtMinSec(pomoRemaining);
  document.getElementById('pomo-toggle').textContent = pomoRunning ? '⏸' : '▶';

  const preview = pomoCyclePreview();
  document.getElementById('pomo-cycle-preview').innerHTML = preview.map(p => `
    <div class="pomo-cycle-item">
      <span class="pcy-name">${escapeHtml(p.name)}</span>
      <span class="pcy-time">${fmtMinSec(p.seconds)}</span>
    </div>
  `).join('');
}
function pomoSwitchMode(shouldTriggerStretchly = pomoRunning) {
  const segments = activePomoProfile().segments;
  window.api.debugLog(`Pomodoro fase ${pomoSegmentIndex} -> ${(pomoSegmentIndex + 1) % segments.length}; corriendo=${pomoRunning}; disparar=${shouldTriggerStretchly}`);
  pomoSegmentIndex = (pomoSegmentIndex + 1) % segments.length;
  pomoRemaining = pomoTotalFor();
  pomoStretchlyBreakSent = false;
  if (shouldTriggerStretchly) triggerStretchlyForActiveSegment();
  renderPomodoro();
}
function triggerStretchlyForActiveSegment() {
  const segment = activePomoSegment();
  const isBreak = segment.break || /descanso|pausa/i.test(segment.name);
  window.api.debugLog(`Stretchly gate: linked=${pomoStretchlyLinked}; break=${isBreak}; sent=${pomoStretchlyBreakSent}; running=${pomoRunning}; remaining=${pomoRemaining}; segment=${segment.name}`);
  if (!pomoStretchlyLinked || !isBreak || pomoStretchlyBreakSent) return;
  pomoStretchlyBreakSent = true;
  window.api.startStretchlyBreak(Math.ceil(pomoRemaining)).then(result => {
    if (!result.success) {
      pomoStretchlyBreakSent = false;
      document.getElementById('pomo-stretchly').title = result.error;
    }
  });
}
function pomoTick() {
  pomoRemaining--;
  if (pomoRemaining <= 0) {
    const segment = activePomoSegment();
    const isBreak = segment.break || /descanso|pausa/i.test(segment.name);
    if (isBreak && pomoStretchlyLinked && pomoStretchlyBreakSent) window.api.skipStretchlyBreak();
    pomoSwitchMode(true);
  }
  renderPomodoro();
}
function pomoStart() {
  if (pomoRunning) return;
  triggerStretchlyForActiveSegment();
  pomoRunning = true;
  pomoInterval = setInterval(pomoTick, 1000);
  renderPomodoro();
}
function pomoPause() {
  const segment = activePomoSegment();
  const isBreak = segment.break || /descanso|pausa/i.test(segment.name);
  if (isBreak && pomoStretchlyLinked && pomoStretchlyBreakSent) {
    window.api.skipStretchlyBreak();
    pomoStretchlyBreakSent = false;
  }
  pomoRunning = false;
  clearInterval(pomoInterval);
  renderPomodoro();
}
document.getElementById('pomo-toggle').addEventListener('click', () => pomoRunning ? pomoPause() : pomoStart());
document.getElementById('pomo-reset').addEventListener('click', () => {
  pomoPause();
  pomoStretchlyBreakSent = false;
  pomoRemaining = pomoTotalFor();
  renderPomodoro();
});
document.getElementById('pomo-skip').addEventListener('click', () => {
  const wasRunning = pomoRunning;
  const segment = activePomoSegment();
  const isBreak = segment.break || /descanso|pausa/i.test(segment.name);
  if (isBreak && pomoStretchlyLinked && pomoStretchlyBreakSent) window.api.skipStretchlyBreak();
  pomoSwitchMode(wasRunning);
});
document.getElementById('pomo-stretchly').addEventListener('click', (e) => {
  pomoStretchlyLinked = !pomoStretchlyLinked;
  window.api.debugLog(`Stretchly vinculado=${pomoStretchlyLinked}`);
  e.target.classList.toggle('linked', pomoStretchlyLinked);
  e.target.textContent = pomoStretchlyLinked ? '🔗 Stretchly (vinculado)' : '🔗 Stretchly';
  e.target.title = pomoStretchlyLinked
    ? 'Preparado para activar Stretchly durante los descansos.'
    : 'Preparar Stretchly para los descansos';
});

function renderPomoConfig() {
  const entries = Object.entries(pomoConfigDraft).map(([id, mode]) => [id, mode.name]);
  renderDropdownOptions('pomo-config-mode-toggle', 'pomo-config-mode-menu', entries, pomoEditingModeId, (id) => {
    readPomoSegments();
    pomoEditingModeId = id;
    document.getElementById('pomo-mode-name').value = pomoConfigDraft[pomoEditingModeId].name;
    renderPomoConfig(); // reconstruye: refleja la nueva opción resaltada + sus segmentos
  });
  document.getElementById('pomo-mode-name').value = pomoConfigDraft[pomoEditingModeId].name;
  renderPomoSegments();
}
setupCustomDropdown('pomo-config-mode-toggle', 'pomo-config-mode-menu');
function renderPomoSegments() {
  const mode = pomoConfigDraft[pomoEditingModeId];
  const list = document.getElementById('pomo-segments');
  list.innerHTML = mode.segments.map((segment, index) => `
    <div class="pomo-segment-row" data-index="${index}">
      <input class="pomo-segment-name" value="${escapeHtml(segment.name)}" placeholder="Nombre" />
      <input class="pomo-segment-min" type="number" min="1" max="180" value="${segment.min}" />
      <label title="Segmento de descanso: activa Stretchly cuando está vinculado"><input class="pomo-segment-break" type="checkbox" ${segment.break ? 'checked' : ''} /> Descanso</label>
      <label title="Preparado para duración dinámica desde Discord"><input class="pomo-segment-dynamic" type="checkbox" ${segment.dynamic ? 'checked' : ''} /> Dinámico</label>
      <button class="pomo-segment-remove" title="Quitar segmento">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.pomo-segment-remove').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.closest('.pomo-segment-row').dataset.index);
    if (mode.segments.length > 1) mode.segments.splice(index, 1);
    renderPomoSegments();
  }));
}
function readPomoSegments() {
  const mode = pomoConfigDraft[pomoEditingModeId];
  mode.segments = [...document.querySelectorAll('.pomo-segment-row')].map(row => ({
    name: row.querySelector('.pomo-segment-name').value.trim() || 'Segmento',
    min: Math.max(1, Math.min(180, Number(row.querySelector('.pomo-segment-min').value) || 1)),
    dynamic: row.querySelector('.pomo-segment-dynamic').checked,
    break: row.querySelector('.pomo-segment-break').checked
  }));
}
function populatePomoProfileSelect() {
  const entries = Object.entries(pomoProfiles).map(([id, p]) => [id, p.name]);
  renderDropdownOptions('pomo-profile-toggle', 'pomo-profile-menu', entries, pomoProfileId, async (id) => {
    pomoPause();
    pomoProfileId = id;
    pomoSegmentIndex = 0;
    pomoStretchlyBreakSent = false;
    pomoRemaining = pomoTotalFor();
    populatePomoProfileSelect(); // refleja la nueva selección resaltada
    renderPomodoro();
    // Antes, elegir un modo acá solo cambiaba el estado en memoria: al
    // reiniciar la app, siempre volvía al último modo GUARDADO desde el
    // modal de configuración (nunca al que habías elegido aquí). Ahora
    // también se persiste el modo activo apenas lo cambias.
    await window.api.savePomodoro({ activeMode: pomoProfileId, modes: pomoProfiles });
  });
}
setupCustomDropdown('pomo-profile-toggle', 'pomo-profile-menu');
function openPomoConfigModal() {
  if (currentPanel !== 'modal-pomo') {
    window.api.openModal('pomo', {});
    return;
  }
  pomoConfigDraft = structuredClone(pomoProfiles);
  pomoEditingModeId = pomoProfileId; // arranca mostrando el modo activo, pero mirarlo/cambiarlo aquí ya NO afecta lo que está corriendo
  renderPomoConfig();
  document.getElementById('pomo-modal').classList.add('open');
}
document.getElementById('pomo-config').addEventListener('click', openPomoConfigModal);
document.getElementById('pomo-add-segment').addEventListener('click', () => {
  readPomoSegments();
  pomoConfigDraft[pomoEditingModeId].segments.push({ name: 'Segmento', min: 5, dynamic: false, break: false });
  renderPomoSegments();
});
document.getElementById('pomo-config-cancel').addEventListener('click', () => {
  document.getElementById('pomo-modal').classList.remove('open');
  if (currentPanel === 'modal-pomo') window.api.closeModal('pomo');
});
document.getElementById('pomo-config-save').addEventListener('click', async () => {
  readPomoSegments();
  pomoConfigDraft[pomoEditingModeId].name = document.getElementById('pomo-mode-name').value.trim() || 'Modo';
  pomoProfiles = pomoConfigDraft;
  pomoPause();
  pomoSegmentIndex = 0;
  pomoRemaining = pomoTotalFor();
  // El modo ACTIVO no cambia por haber editado otro modo en el modal —
  // se guarda tal cual estaba (pomoProfileId), junto con la config nueva
  // de TODOS los modos (segments actualizados). Esta ventana (modal-pomo)
  // ya no es la misma que la del temporizador — se avisa por broadcast
  // (ver 'pomodoro-changed') para que el reloj de verdad se actualice.
  await window.api.savePomodoro({ activeMode: pomoProfileId, modes: pomoProfiles });
  populatePomoProfileSelect(); // refleja nombres renombrados en el selector principal
  renderPomodoro();
  document.getElementById('pomo-modal').classList.remove('open');
  if (currentPanel === 'modal-pomo') window.api.closeModal('pomo');
});

// ================= Arranque =================
(async function init() {
  const settings = await window.api.getSettings();
  applyTranslucent(settings.translucent);
  document.getElementById('btn-ontop').classList.toggle('active', settings.alwaysOnTop);

  const layoutState = await window.api.getLayoutState();
  leftPanelVisible = layoutState.showLeft;
  calendarScreenRect = await window.api.getCalendarRect();

  eventCategories = settings.eventCategories || [];
  renderCategoryList();
  renderLegend();
  populateEventTypeSelect();
  populateTaskTypeSelect();

  const savedPomo = settings.pomodoro || {};
  if (savedPomo.modes) pomoProfiles = { ...structuredClone(defaultPomoProfiles), ...savedPomo.modes };
  pomoProfileId = savedPomo.activeMode && pomoProfiles[savedPomo.activeMode] ? savedPomo.activeMode : 'work';
  pomoSegmentIndex = 0;
  pomoRemaining = pomoTotalFor();
  populatePomoProfileSelect();
  renderPomodoro();

  tasks = await window.api.getTasks();
  events = await window.api.getEvents();
  renderSchedule();
  renderCalendar();
  tickClock();
  setInterval(tickClock, 1000);

  calResizeObserver.observe(document.getElementById('cal-body'));
  scheduleResizeObserver.observe(document.getElementById('schedule-list'));
  timerResizeObserver.observe(document.getElementById('panel-timer'));
  toolbarResizeObserver.observe(document.getElementById('panel-toolbar'));

  fetchRemoteEvents(); // primera sincronización (no bloqueante)
  setInterval(fetchRemoteEvents, 10 * 60 * 1000); // cada 10 minutos

  appDataReady = true;
  if (pendingModalPayload !== undefined) { routeModalInit(pendingModalPayload); pendingModalPayload = undefined; }
})();
