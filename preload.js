const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Tareas
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (task) => ipcRenderer.invoke('tasks:add', task),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  updateTask: (task) => ipcRenderer.invoke('tasks:update', task),

  // Eventos de calendario
  getEvents: () => ipcRenderer.invoke('events:get'),
  addEvent: (ev) => ipcRenderer.invoke('events:add', ev),
  deleteEvent: (id) => ipcRenderer.invoke('events:delete', id),

  // Configuración general
  getSettings: () => ipcRenderer.invoke('settings:get'),
  toggleTranslucent: () => ipcRenderer.invoke('settings:toggleTranslucent'),
  cycleDisplay: () => ipcRenderer.invoke('settings:cycleDisplay'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('settings:toggleAlwaysOnTop'),
  saveEventCategories: (categories) => ipcRenderer.invoke('settings:saveEventCategories', categories),
  savePomodoro: (pomodoro) => ipcRenderer.invoke('settings:savePomodoro', pomodoro),
  startStretchlyBreak: (remainingSeconds) => ipcRenderer.invoke('stretchly:startBreak', remainingSeconds),
  skipStretchlyBreak: () => ipcRenderer.invoke('stretchly:skipBreak'),
  debugLog: (message) => ipcRenderer.send('debug:log', message),

  // Sincronización de calendario (Google / Microsoft)
  getCalendarStatus: () => ipcRenderer.invoke('calendar:status'),
  connectCalendar: (opts) => ipcRenderer.invoke('calendar:connect', opts),
  disconnectCalendar: (provider, id) => ipcRenderer.invoke('calendar:disconnect', { provider, id }),
  getRemoteEvents: () => ipcRenderer.invoke('calendar:getRemoteEvents'),
  createGoogleEvent: (opts) => ipcRenderer.invoke('calendar:createGoogleEvent', opts),
  createGoogleTask: (opts) => ipcRenderer.invoke('calendar:createGoogleTask', opts),
  cancelCalendarFlow: () => ipcRenderer.send('calendar:cancel-flow'),

  // Zona de video: ahora es una ventana real aparte que solo existe
  // mientras se edita (ver zone-editor.html). Este botón solo prende/
  // apaga esa ventana; el arrastre/resize lo maneja el propio SO.
  toggleZoneEdit: () => ipcRenderer.invoke('zone:toggle-edit'),
  saveZone: (zone) => ipcRenderer.invoke('settings:saveZone', zone),
  getLayoutState: () => ipcRenderer.invoke('layout:get-state'),
  getCalendarRect: () => ipcRenderer.invoke('layout:get-calendar-rect'),

  // Editor de zona de pantalla completa: el recuadro delimitador vive
  // dentro de zone-editor.html y manda esto mientras lo arrastras/
  // redimensionas, y le avisa a la ventana (que es de pantalla completa)
  // cuándo debe dejar pasar los clics y cuándo no.
  zoneEditorSetIgnore: (ignore) => ipcRenderer.send('zone-editor:set-ignore', ignore),
  zoneLiveUpdate: (zone) => ipcRenderer.send('zone-editor:live-update', zone),
  zoneEndUpdate: (zone) => ipcRenderer.send('zone-editor:end-update', zone),

  // Mapa de paneles: mostrar/ocultar cada ventana de forma independiente,
  // sin afectar su tamaño dinámico (ver comentario en main.js).
  toggleMapWindow: () => ipcRenderer.invoke('panels:toggle-map'),
  getHiddenPanels: () => ipcRenderer.invoke('panels:get-hidden'),
  togglePanelHidden: (panelId) => ipcRenderer.invoke('panels:toggle-hidden', panelId),

  // Modales como ventanas independientes de verdad (tarea, evento,
  // pomodoro, conexión) — el panel que las abre no cambia de tamaño.
  openModal: (kind, payload) => ipcRenderer.invoke('modal:open', { kind, payload }),
  closeModal: (kind) => ipcRenderer.invoke('modal:close', { kind }),
  onModalInit: (callback) => ipcRenderer.on('modal-init', (e, payload) => callback(payload)),

  // Como ahora cada panel es una ventana/proceso aparte, esto es cómo se
  // enteran unas de otras cuando algo compartido cambia (tareas, eventos,
  // categorías, ajustes) — antes no hacía falta porque todo vivía en una
  // sola página.
  onDataChanged: (channel, callback) => ipcRenderer.on(channel, (e, payload) => callback(payload)),

  // Abrir un enlace externo en el navegador del sistema (solo hosts conocidos)
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
