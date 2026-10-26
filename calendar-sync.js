// Sincronización con Google Calendar y Microsoft Calendar (Graph API).
// Flujo OAuth "loopback" con PKCE, recomendado por ambos proveedores para
// apps de escritorio: se abre el navegador del sistema, se captura el
// código en un mini-servidor local temporal, y se intercambia por tokens.
// No usa librerías externas: solo http/crypto de Node y fetch nativo.

const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

function safeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of ['client_id', 'code', 'code_challenge', 'refresh_token', 'access_token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch { return String(rawUrl); }
}

async function apiFetch(url, options = {}) {
  const method = options.method || 'GET';
  const started = Date.now();
  console.log(`[API] -> ${method} ${safeUrl(url)}`);
  try {
    const response = await fetch(url, options);
    console.log(`[API] <- ${method} ${safeUrl(url)} ${response.status} (${Date.now() - started}ms)`);
    return response;
  } catch (error) {
    console.error(`[API] !! ${method} ${safeUrl(url)} (${Date.now() - started}ms): ${error.message}`);
    throw error;
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>${error ? 'Algo salió mal.' : 'Listo, ya puedes cerrar esta pestaña.'}</h2>
        </body></html>`);
      if (error) server.emit('oauth-error', new Error(error));
      else server.emit('oauth-code', code);
      server.close();
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    server.on('error', reject);
  });
}

// Guarda el flujo OAuth en curso (si hay uno) para poder cancelarlo desde
// afuera — por ejemplo, si el usuario cierra la ventana de conexión
// mientras espera la confirmación del navegador.
let activeFlow = null;

async function runOAuthFlow(buildAuthUrl, exchangeCode) {
  const { server, port } = await startLoopbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const { verifier, challenge } = makePKCE();
  const authUrl = buildAuthUrl(redirectUri, challenge);
  console.log(`[OAUTH] Abriendo navegador: ${safeUrl(authUrl)}`);
  shell.openExternal(authUrl);

  const code = await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); activeFlow = null; };
    const timeout = setTimeout(() => { server.close(); cleanup(); reject(new Error('Tiempo de espera agotado (5 min) esperando el inicio de sesión.')); }, 5 * 60 * 1000);
    activeFlow = { server, reject: (err) => { cleanup(); reject(err); } };
    server.once('oauth-code', (c) => { cleanup(); resolve(c); });
    server.once('oauth-error', (err) => { cleanup(); reject(err); });
  });

  return exchangeCode(code, redirectUri, verifier);
}

// Cancela el flujo OAuth en curso, si hay uno: cierra el servidor local y
// rechaza la promesa pendiente, para que todo quede listo para empezar
// de cero en el próximo intento.
function cancelActiveFlow() {
  if (!activeFlow) return;
  try { activeFlow.server.close(); } catch { /* ya podría estar cerrado */ }
  activeFlow.reject(new Error('Proceso de conexión cancelado.'));
}

// ==================== Google Calendar ====================
// Las credenciales (clientId/clientSecret) son UNA por app, compartidas
// por todas las cuentas de Google que se conecten. Cada "connection" solo
// guarda sus propios tokens — así se pueden sumar varias cuentas de Google
// sin volver a pedir credenciales.
//
// Alcance (scope): incluye lectura Y escritura de eventos individuales
// (calendar.events), no solo lectura. Esto es lo que permite crear
// eventos desde la app. Las cuentas conectadas ANTES de este cambio
// solo tienen permiso de lectura (el scope quedó fijo al momento de
// autorizar) — hay que reconectarlas para poder crear eventos con ellas.
async function connectGoogle({ clientId, clientSecret }) {
  if (!clientId) throw new Error('Falta el Client ID de Google.');
// Alcance (scope): calendario (lectura+escritura de eventos) + Google
// Tasks (para que las tareas recordatorio también aparezcan en el móvil,
// vía la app de Google Tasks). Cuentas conectadas antes de este cambio
// no tienen el permiso de Tasks — hay que reconectarlas.
  const scope = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks openid email';

  const tokens = await runOAuthFlow(
    (redirectUri, challenge) => {
      const p = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        scope, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256'
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async (code, redirectUri, verifier) => {
      const body = new URLSearchParams({
        client_id: clientId, client_secret: clientSecret || '', code,
        code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri
      });
      const res = await apiFetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      if (!res.ok) throw new Error('Google rechazó el intercambio de token: ' + await res.text());
      return res.json();
    }
  );

  const email = await fetchGoogleEmail(tokens.access_token);
  // Nota: NO se guarda clientId/clientSecret aquí — esos viven a nivel de
  // "app" (main.js), esta conexión solo lleva sus propios tokens.
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token, expiry: Date.now() + tokens.expires_in * 1000, email
  };
}

async function fetchGoogleEmail(accessToken) {
  try {
    const res = await apiFetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return (await res.json()).email || null;
  } catch { return null; }
}

async function refreshGoogleToken(connection, creds) {
  const body = new URLSearchParams({
    client_id: creds.clientId, client_secret: creds.clientSecret || '',
    refresh_token: connection.refreshToken, grant_type: 'refresh_token'
  });
  const res = await apiFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!res.ok) {
    const text = await res.text();
    let reason = null;
    try { reason = JSON.parse(text)?.error; } catch { /* no era JSON */ }
    // El caso más común con proyectos de Google Cloud en modo "Prueba"
    // (Testing, no publicado/verificado): el refresh token caduca solo
    // a los 7 días de haberlo emitido, aunque se use seguido. El síntoma
    // es siempre 'invalid_grant'. La única solución real es reconectar
    // la cuenta (o publicar el proyecto en Google Cloud Console).
    if (reason === 'invalid_grant') {
      const err = new Error('La sesión de Google caducó y hay que volver a conectarla (esto es normal si tu proyecto de Google Cloud está en modo "Prueba": el permiso solo dura 7 días). Ve al 🔗 y reconecta esta cuenta.');
      err.needsReconnect = true;
      throw err;
    }
    const err = new Error('No se pudo refrescar el token de Google' + (reason ? ` (${reason})` : '') + '.');
    err.needsReconnect = true;
    throw err;
  }
  const tokens = await res.json();
  connection.accessToken = tokens.access_token;
  connection.expiry = Date.now() + tokens.expires_in * 1000;
  connection.needsReconnect = false;
  return connection;
}

// Los colores de evento de Google (colorId -> hex) son fijos por cuenta;
// se piden una sola vez y se guardan en memoria para no repetir la llamada.
const googleColorsCache = new Map(); // accessToken -> { "1": "#hex", ... }
async function fetchGoogleEventColors(accessToken) {
  if (googleColorsCache.has(accessToken)) return googleColorsCache.get(accessToken);
  try {
    const res = await apiFetch('https://www.googleapis.com/calendar/v3/colors', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const [id, c] of Object.entries(data.event || {})) map[id] = c.background;
    googleColorsCache.set(accessToken, map);
    return map;
  } catch { return {}; }
}

// Traduce los errores más comunes de la API de Google a un mensaje claro
// en vez del JSON crudo (que es difícil de leer en la interfaz).
function friendlyGoogleError(rawText, fallbackPrefix) {
  try {
    const parsed = JSON.parse(rawText);
    const reason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.status;
    if (reason === 'accessNotConfigured') {
      return 'Falta activar la "Google Calendar API" en tu proyecto de Google Cloud (es un paso aparte de crear las credenciales). Usa el botón 🔗 "Habilitar Google Calendar API" y vuelve a intentar en un par de minutos.';
    }
    if (parsed?.error?.code === 401 || parsed?.error?.code === 403) {
      return 'Esta cuenta no tiene permiso suficiente — probá reconectarla desde el drawer.';
    }
    return fallbackPrefix + (parsed?.error?.message || rawText);
  } catch {
    return fallbackPrefix + rawText;
  }
}

async function fetchGoogleEvents(connection, creds, timeMinISO, timeMaxISO) {
  if (Date.now() > connection.expiry - 60000) await refreshGoogleToken(connection, creds);
  const colors = await fetchGoogleEventColors(connection.accessToken);
  const p = new URLSearchParams({ timeMin: timeMinISO, timeMax: timeMaxISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const res = await apiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, {
    headers: { Authorization: `Bearer ${connection.accessToken}` }
  });
  if (!res.ok) throw new Error(friendlyGoogleError(await res.text(), 'Error consultando Google Calendar: '));
  const data = await res.json();
  return (data.items || [])
    .map(ev => ({
      id: 'g_' + ev.id,
      title: ev.summary || '(Sin título)',
      date: (ev.start && (ev.start.date || (ev.start.dateTime || '').slice(0, 10))) || null,
      time: ev.start && ev.start.dateTime ? ev.start.dateTime : null,
      type: 'sincronizado',
      color: (ev.colorId && colors[ev.colorId]) || null, // color propio de Google si lo tiene
      source: 'google'
    }))
    .filter(e => e.date);
}

// Crea un evento nuevo (de un solo día, sin hora) directamente en el
// Google Calendar principal de la cuenta. Requiere que la conexión tenga
// el scope de escritura (calendar.events) — cuentas conectadas antes de
// ese cambio necesitan reconectarse primero.
// title+date crea un evento de TODO EL DÍA (como antes, para eventos de
// calendario). title+dateTime crea un evento con HORA exacta (para
// tareas urgentes, que sí tienen una hora puntual) — dura 1h por defecto.
async function createGoogleEvent(connection, creds, { title, date, dateTime, durationMinutes = 60 }) {
  if (Date.now() > connection.expiry - 60000) await refreshGoogleToken(connection, creds);
  let body;
  if (dateTime) {
    const start = new Date(dateTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    body = { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  } else {
    const next = new Date(date + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const endDate = next.toISOString().slice(0, 10);
    body = { summary: title, start: { date }, end: { date: endDate } };
  }
  const res = await apiFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    let reason = null;
    try { reason = JSON.parse(text)?.error?.errors?.[0]?.reason; } catch { /* no era JSON parseable */ }
    if (reason === 'accessNotConfigured') {
      throw new Error(friendlyGoogleError(text, 'Google rechazó la creación del evento: '));
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error('Esta cuenta no tiene permiso de escritura todavía — reconéctala desde el drawer de calendarios para poder crear eventos.');
    }
    throw new Error(friendlyGoogleError(text, 'Google rechazó la creación del evento: '));
  }
  return res.json();
}

// Crea un recordatorio en Google Tasks (aparece sincronizado en el
// móvil vía la app de Google Tasks / Google Calendar). Requiere el
// scope de Tasks — cuentas conectadas antes de ese cambio necesitan
// reconectarse primero.
async function createGoogleTask(connection, creds, { title, dueDate }) {
  if (Date.now() > connection.expiry - 60000) await refreshGoogleToken(connection, creds);
  const body = { title };
  if (dueDate) body.due = new Date(dueDate).toISOString();
  const res = await apiFetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 || res.status === 401) {
      throw new Error('Esta cuenta no tiene permiso de Google Tasks todavía — reconéctala desde el drawer de calendarios.');
    }
    throw new Error(friendlyGoogleError(text, 'Google rechazó la creación del recordatorio: '));
  }
  return res.json();
}

// ==================== Microsoft Calendar (Graph) ====================
// Igual que Google: un solo Application (client) ID por app, compartido
// por todas las cuentas de Microsoft que se conecten (personal, trabajo,
// etc.) — cada "connection" solo guarda sus propios tokens.
async function connectMicrosoft({ clientId, tenant }) {
  if (!clientId) throw new Error('Falta el Application (client) ID de Microsoft.');
  const t = tenant || 'common';
  const scope = 'offline_access Calendars.Read User.Read';

  const tokens = await runOAuthFlow(
    (redirectUri, challenge) => {
      const p = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        response_mode: 'query', scope, code_challenge: challenge, code_challenge_method: 'S256'
      });
      return `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize?${p}`;
    },
    async (code, redirectUri, verifier) => {
      const body = new URLSearchParams({
        client_id: clientId, code, redirect_uri: redirectUri,
        grant_type: 'authorization_code', code_verifier: verifier, scope
      });
      const res = await apiFetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      if (!res.ok) throw new Error('Microsoft rechazó el intercambio de token: ' + await res.text());
      return res.json();
    }
  );

  const email = await fetchMicrosoftEmail(tokens.access_token);
  return {
    refreshToken: tokens.refresh_token, accessToken: tokens.access_token,
    expiry: Date.now() + tokens.expires_in * 1000, email
  };
}

async function fetchMicrosoftEmail(accessToken) {
  try {
    const res = await apiFetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.mail || data.userPrincipalName || null;
  } catch { return null; }
}

async function refreshMicrosoftToken(connection, creds) {
  const body = new URLSearchParams({
    client_id: creds.clientId, refresh_token: connection.refreshToken,
    grant_type: 'refresh_token', scope: 'offline_access Calendars.Read User.Read'
  });
  const res = await apiFetch(`https://login.microsoftonline.com/${creds.tenant || 'common'}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!res.ok) throw new Error('No se pudo refrescar el token de Microsoft.');
  const tokens = await res.json();
  connection.accessToken = tokens.access_token;
  if (tokens.refresh_token) connection.refreshToken = tokens.refresh_token;
  connection.expiry = Date.now() + tokens.expires_in * 1000;
  return connection;
}

async function fetchMicrosoftEvents(connection, creds, timeMinISO, timeMaxISO) {
  if (Date.now() > connection.expiry - 60000) await refreshMicrosoftToken(connection, creds);
  const p = new URLSearchParams({ startDateTime: timeMinISO, endDateTime: timeMaxISO });
  const res = await apiFetch(`https://graph.microsoft.com/v1.0/me/calendarview?${p}`, {
    headers: { Authorization: `Bearer ${connection.accessToken}`, Prefer: 'outlook.timezone="UTC"' }
  });
  if (!res.ok) throw new Error('Error consultando Microsoft Calendar: ' + await res.text());
  const data = await res.json();
  return (data.value || [])
    .map(ev => ({
      id: 'm_' + ev.id,
      title: ev.subject || '(Sin título)',
      date: ev.start && ev.start.dateTime ? ev.start.dateTime.slice(0, 10) : null,
      time: ev.start && ev.start.dateTime ? ev.start.dateTime : null,
      type: 'sincronizado',
      source: 'microsoft'
    }))
    .filter(e => e.date);
}

module.exports = {
  connectGoogle, connectMicrosoft,
  fetchGoogleEvents, fetchMicrosoftEvents,
  refreshGoogleToken, refreshMicrosoftToken,
  createGoogleEvent, createGoogleTask,
  cancelActiveFlow
};
