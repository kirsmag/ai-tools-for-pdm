const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const SLOT_TIMES = ['09:00', '11:00', '13:00', '15:00', '17:00'];
const database = new DatabaseSync(path.join(__dirname, 'boris.sqlite'));

database.exec(`
  CREATE TABLE IF NOT EXISTS walk_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    walk_date TEXT NOT NULL,
    slot_time TEXT NOT NULL,
    booked_by TEXT,
    booked_at TEXT,
    UNIQUE (walk_date, slot_time),
    CHECK (
      (booked_by IS NULL AND booked_at IS NULL)
      OR
      (booked_by IS NOT NULL AND booked_at IS NOT NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS feedings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    fed_at TEXT NOT NULL
  );
`);

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const insertSlot = database.prepare(
  'INSERT OR IGNORE INTO walk_slots (walk_date, slot_time) VALUES (?, ?)'
);
function ensureTodaySlots() {
  const today = localDateString();
  for (const slotTime of SLOT_TIMES) {
    insertSlot.run(today, slotTime);
  }
  return today;
}

ensureTodaySlots();

const staticFiles = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(new Error('Слишком большой запрос.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Переданы некорректные данные.'));
      }
    });
    request.on('error', reject);
  });
}

async function handleBooking(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { error: 'Переданы некорректные данные.' });
    return;
  }

  const slotTime = body.slotTime;
  const employeeName = typeof body.employeeName === 'string' ? body.employeeName.trim() : '';
  if (!SLOT_TIMES.includes(slotTime)) {
    sendJson(response, 400, { error: 'Выберите один из пяти доступных слотов.' });
    return;
  }
  if (!employeeName) {
    sendJson(response, 400, { error: 'Введите ФИО без лишних пробелов.' });
    return;
  }
  if (employeeName.length > 120) {
    sendJson(response, 400, { error: 'ФИО должно быть не длиннее 120 символов.' });
    return;
  }

  const today = ensureTodaySlots();
  const bookedSlot = database.prepare(`
    UPDATE walk_slots
    SET booked_by = ?, booked_at = ?
    WHERE walk_date = ? AND slot_time = ? AND booked_by IS NULL
    RETURNING slot_time AS time, booked_by AS bookedBy
  `).get(employeeName, new Date().toISOString(), today, slotTime);

  if (!bookedSlot) {
    sendJson(response, 409, { error: 'Этот слот уже заняли. Обновите расписание и выберите другое время.' });
    return;
  }

  sendJson(response, 201, { slot: bookedSlot });
}

async function handleFeeding(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { error: 'Переданы некорректные данные.' });
    return;
  }

  const employeeName = typeof body.employeeName === 'string' ? body.employeeName.trim() : '';
  if (!employeeName) {
    sendJson(response, 400, { error: 'Введите ФИО без лишних пробелов.' });
    return;
  }
  if (employeeName.length > 120) {
    sendJson(response, 400, { error: 'ФИО должно быть не длиннее 120 символов.' });
    return;
  }

  const fedAt = new Date().toISOString();
  database.prepare('INSERT INTO feedings (employee_name, fed_at) VALUES (?, ?)').run(employeeName, fedAt);
  sendJson(response, 201, { feeding: { employeeName, fedAt } });
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', date: localDateString(), slotsInitialized: SLOT_TIMES.length }));
    return;
  }

  if (request.method === 'GET' && request.url === '/api/today') {
    const today = ensureTodaySlots();
    const slots = database.prepare(
      'SELECT slot_time AS time, booked_by AS bookedBy FROM walk_slots WHERE walk_date = ? ORDER BY slot_time'
    ).all(today);
    const lastFeeding = database.prepare(
      'SELECT employee_name AS employeeName, fed_at AS fedAt FROM feedings ORDER BY fed_at DESC, id DESC LIMIT 1'
    ).get() ?? null;

    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ date: today, slots, lastFeeding }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/bookings') {
    handleBooking(request, response);
    return;
  }

  if (request.method === 'POST' && request.url === '/api/feedings') {
    handleFeeding(request, response);
    return;
  }

  if (request.method === 'GET' && staticFiles[request.url]) {
    const asset = staticFiles[request.url];
    const filePath = path.join(__dirname, 'public', asset.file);
    response.writeHead(200, { 'content-type': asset.type });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Локальный сервер запущен: http://127.0.0.1:${PORT}`);
});

function closeDatabase() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeDatabase);
process.on('SIGTERM', closeDatabase);
