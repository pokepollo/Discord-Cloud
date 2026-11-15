require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const UPLOAD_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '19922944', 10);
const UPLOAD_CONCURRENCY = Math.max(1, parseInt(process.env.UPLOAD_CONCURRENCY || '4', 10));
const API_KEY = process.env.API_KEY || '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';

const sessions = new Set();
const uploadProgress = new Map();

function parseCookies(req) {
  const h = req.headers.cookie || '';
  return Object.fromEntries(h.split(';').map(c => {
    const i = c.indexOf('=');
    if (i < 0) return [c.trim(), ''];
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(x => x[0]));
}
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const GUILD_ID = process.env.GUILD_ID || '';
const CHANNEL_PREFIX = process.env.CHANNEL_PREFIX || 'cloud-chunk';
const NUM_CHANNELS = parseInt(process.env.NUM_CHANNELS || '4', 10);

let WEBHOOKS = (process.env.WEBHOOKS || '').split(',').map(s => s.trim()).filter(Boolean);

async function discordApi(method, path, body) {
  const r = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`Discord API ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function initBotWebhooks() {
  if (!BOT_TOKEN || !GUILD_ID) return;
  const channels = await discordApi('GET', `/guilds/${GUILD_ID}/channels`);
  let textChannels = channels.filter(c => c.type === 0 && c.name.startsWith(CHANNEL_PREFIX));
  // crear los que falten
  while (textChannels.length < NUM_CHANNELS) {
    const ch = await discordApi('POST', `/guilds/${GUILD_ID}/channels`, { name: `${CHANNEL_PREFIX}-${textChannels.length}`, type: 0 });
    textChannels.push(ch);
    await sleep(1000);
  }
  textChannels = textChannels.slice(0, NUM_CHANNELS);
  const hooks = [];
  for (const ch of textChannels) {
    // buscar webhook existente o crear
    const existing = await discordApi('GET', `/channels/${ch.id}/webhooks`);
    let wh = existing.find(w => w.name === 'cloud-storage');
    if (!wh) {
      wh = await discordApi('POST', `/channels/${ch.id}/webhooks`, { name: 'cloud-storage' });
      await sleep(500);
    }
    hooks.push(`https://discord.com/api/webhooks/${wh.id}/${wh.token}`);
  }
  WEBHOOKS = hooks;
  console.log(`Bot: ${hooks.length} canales/webhooks listos`);
}

const DATA_DIR = path.join(__dirname, 'data');
const META_FILE = path.join(DATA_DIR, 'files.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, '[]');

function loadMeta() { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
function saveMeta(m) { fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2)); }
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { uploadMode: 'default', autoConcurrency: null, lastBenchmark: null }; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
function hasStoredPassword() {
  const c = loadConfig();
  return !!(c.passwordHash && c.passwordSalt);
}
function isSetupRequired() {
  return !LOGIN_PASSWORD && !hasStoredPassword();
}
function isLoginRequired() {
  return !!LOGIN_PASSWORD || hasStoredPassword();
}
function verifyPassword(password) {
  if (LOGIN_PASSWORD) return password === LOGIN_PASSWORD;
  const c = loadConfig();
  if (!c.passwordHash || !c.passwordSalt) return false;
  const hash = crypto.scryptSync(String(password), c.passwordSalt, 64).toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(c.passwordHash, 'hex')); } catch { return false; }
}
function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  saveConfig({ ...loadConfig(), passwordHash: hash, passwordSalt: salt, setupAt: new Date().toISOString() });
}

function isAuthed(req) {
  if (!isLoginRequired()) return true;
  const cookies = parseCookies(req);
  if (cookies.sid && sessions.has(cookies.sid)) return true;
  if (API_KEY) {
    const k = req.headers['x-api-key'] || req.query.key;
    if (k && k === API_KEY) return true;
  }
  return false;
}

function auth(req, res, next) {
  if (isSetupRequired()) return res.status(403).json({ error: 'setup_required' });
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.use(express.json());

app.post('/api/setup', (req, res) => {
  if (!isSetupRequired()) return res.status(400).json({ error: 'El sistema ya está configurado' });
  const { password, confirm } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  if (password !== confirm) return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  setPassword(String(password));
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.add(sid);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  if (isSetupRequired()) return res.status(403).json({ error: 'setup_required' });
  const { password } = req.body || {};
  if (!isLoginRequired()) return res.json({ ok: true });
  if (!verifyPassword(String(password || ''))) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.add(sid);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sid) sessions.delete(cookies.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ authed: isAuthed(req), loginRequired: isLoginRequired(), setupRequired: isSetupRequired() });
});

app.get('/', (req, res) => {
  if (isSetupRequired()) return res.sendFile(path.join(__dirname, 'public', 'setup.html'));
  if (isLoginRequired() && !isAuthed(req)) return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  if (isSetupRequired()) return res.redirect('/');
  if (isLoginRequired() && !isAuthed(req)) return res.redirect('/');
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', auth, (req, res) => {
  const all = loadMeta();
  const settings = loadSettings();
  const totalSize = all.reduce((s, f) => s + (f.size || 0), 0);
  const totalChunks = all.reduce((s, f) => s + ((f.chunks && f.chunks.length) || 0), 0);
  res.json({ files: all.length, totalSize, totalChunks, channels: WEBHOOKS.length, chunkSize: CHUNK_SIZE, uploadConcurrency: UPLOAD_CONCURRENCY, settings });
});

app.get('/api/settings', auth, (req, res) => {
  res.json(loadSettings());
});

app.post('/api/settings', auth, (req, res) => {
  const s = loadSettings();
  const { uploadMode } = req.body || {};
  if (uploadMode === 'default' || uploadMode === 'auto') s.uploadMode = uploadMode;
  saveSettings(s);
  res.json(s);
});

app.get('/api/upload-progress/:id', auth, (req, res) => {
  res.json(uploadProgress.get(req.params.id) || { status: 'unknown' });
});

app.patch('/api/files/:id', auth, (req, res) => {
  const { name, tags, note } = req.body || {};
  const all = loadMeta();
  const f = all.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (typeof name === 'string' && name.trim()) f.name = name.trim();
  if (Array.isArray(tags)) f.tags = tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
  if (typeof tags === 'string') f.tags = tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
  if (typeof note === 'string') f.note = note.slice(0, 500);
  saveMeta(all);
  res.json({ ok: true, name: f.name, tags: f.tags || [], note: f.note || '' });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendChunkToDiscord(webhookUrl, buffer, filename, index, attempt = 1) {
  const form = new FormData();
  const blob = new Blob([buffer]);
  form.append('file', blob, `${filename}.part${index}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(webhookUrl, { method: 'POST', body: form, signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 429) {
      const retry = await res.json().catch(() => ({}));
      const wait = Math.ceil((retry.retry_after || 1) * 1000) + 500;
      await sleep(wait);
      if (attempt < 5) return sendChunkToDiscord(webhookUrl, buffer, filename, index, attempt + 1);
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Discord ${res.status}: ${txt}`);
    }
    const json = await res.json();
    const att = json.attachments && json.attachments[0];
    if (!att) throw new Error('No attachment returned');
    return { messageId: json.id, url: att.url, size: att.size || buffer.length };
  } catch (e) {
    clearTimeout(timeout);
    if (attempt < 5) {
      await sleep(1000 * attempt);
      return sendChunkToDiscord(webhookUrl, buffer, filename, index, attempt + 1);
    }
    throw e;
  }
}

app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  const uploadId = req.headers['x-upload-id'] || '';
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (WEBHOOKS.length === 0) {
    try { await fsp.unlink(req.file.path); } catch {}
    if (uploadId) uploadProgress.set(uploadId, { status: 'error', error: 'no webhooks configured' });
    return res.status(500).json({ error: 'no webhooks configured' });
  }

  const file = req.file;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunks = new Array(totalChunks);
  let fh;
  let doneChunks = 0;
  const settings = loadSettings();
  const effectiveConcurrency = settings.uploadMode === 'auto' && settings.autoConcurrency ? Number(settings.autoConcurrency) : 4;
  if (uploadId) uploadProgress.set(uploadId, { status: 'processing', name: file.originalname, done: 0, total: totalChunks, percent: 0, concurrency: effectiveConcurrency });

  async function uploadOne(i) {
    const start = i * CHUNK_SIZE;
    const len = Math.min(CHUNK_SIZE, file.size - start);
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);
    const widx = i % WEBHOOKS.length;
    const wh = WEBHOOKS[widx];
    const info = await sendChunkToDiscord(wh, buf, file.originalname, i);
    chunks[i] = { index: i, webhookIndex: widx, ...info };
    doneChunks++;
    if (uploadId) uploadProgress.set(uploadId, { status: 'uploading', name: file.originalname, done: doneChunks, total: totalChunks, percent: Math.round((doneChunks / totalChunks) * 100), concurrency: effectiveConcurrency });
    if (doneChunks % 5 === 0 || doneChunks === totalChunks) console.log(`[upload] ${file.originalname}: ${doneChunks}/${totalChunks} chunks`);
  }

  try {
    fh = await fsp.open(file.path, 'r');
    let next = 0;
    const workers = Array.from({ length: Math.min(effectiveConcurrency, totalChunks) }, async () => {
      while (true) {
        const i = next++;
        if (i >= totalChunks) break;
        await uploadOne(i);
      }
    });
    await Promise.all(workers);
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    try { await fsp.unlink(file.path); } catch {}
    if (uploadId) uploadProgress.set(uploadId, { status: 'error', name: file.originalname, error: e.message, done: doneChunks, total: totalChunks });
    return res.status(500).json({ error: e.message, partial: chunks.filter(Boolean) });
  }
  if (fh) await fh.close().catch(() => {});
  try { await fsp.unlink(file.path); } catch {}

  const meta = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: file.originalname,
    size: file.size,
    type: file.mimetype,
    chunks,
    createdAt: new Date().toISOString()
  };
  const all = loadMeta();
  all.unshift(meta);
  saveMeta(all);
  if (uploadId) uploadProgress.set(uploadId, { status: 'done', name: file.originalname, done: totalChunks, total: totalChunks, percent: 100, fileId: meta.id });
  setTimeout(() => { if (uploadId) uploadProgress.delete(uploadId); }, 120000);
  res.json({ id: meta.id, name: meta.name, size: meta.size, chunks: chunks.length });
});

app.get('/api/files', auth, (req, res) => {
  const all = loadMeta();
  res.json(all.map(f => ({ id: f.id, name: f.name, size: f.size, type: f.type, chunks: f.chunks.length, createdAt: f.createdAt, shareToken: f.shareToken || null, shareExpiresAt: f.shareExpiresAt || null, tags: f.tags || [], note: f.note || '' })));
});

app.post('/api/files/:id/share', auth, (req, res) => {
  const all = loadMeta();
  const f = all.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (!f.shareToken) f.shareToken = crypto.randomBytes(16).toString('hex');
  const hours = Number((req.body || {}).expiresInHours);
  if (hours && hours > 0) f.shareExpiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  else if ((req.body || {}).expiresInHours === null) delete f.shareExpiresAt;
  saveMeta(all);
  const url = `${req.protocol}://${req.get('host')}/s/${f.shareToken}`;
  res.json({ ok: true, shareToken: f.shareToken, shareExpiresAt: f.shareExpiresAt || null, url });
});

app.delete('/api/files/:id/share', auth, (req, res) => {
  const all = loadMeta();
  const f = all.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  delete f.shareToken;
  delete f.shareExpiresAt;
  saveMeta(all);
  res.json({ ok: true });
});

app.get('/s/:token', async (req, res) => {
  const all = loadMeta();
  const meta = all.find(f => f.shareToken === req.params.token);
  if (!meta) return res.status(404).send('Enlace no válido o revocado');
  if (meta.shareExpiresAt && new Date(meta.shareExpiresAt).getTime() < Date.now()) return res.status(410).send('Enlace expirado');
  await streamFileDownload(meta, req, res);
});

async function streamFileDownload(meta, req, res) {
  try {
    res.setHeader('Content-Type', meta.type || 'application/octet-stream');
    const safeName = encodeURIComponent(meta.name || 'file');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    if (meta.size) res.setHeader('Content-Length', meta.size);
    const chunks = [...(meta.chunks || [])].sort((a, b) => a.index - b.index);
    for (const c of chunks) {
      let r;
      let ok = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        r = await fetch(c.url);
        if (r.ok && r.body) { ok = true; break; }
        await sleep(500 * attempt);
      }
      if (!ok) throw new Error(`fetch chunk ${c.index} failed: ${r ? r.status : 'no response'}`);
      // stream web stream to node response
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else try { res.end(); } catch {}
  }
}

app.get('/api/download/:id', auth, async (req, res) => {
  const all = loadMeta();
  const meta = all.find(f => f.id === req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  await streamFileDownload(meta, req, res);
});

app.delete('/api/files/:id', auth, async (req, res) => {
  const all = loadMeta();
  const idx = all.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const meta = all[idx];
  const errors = [];
  await Promise.all((meta.chunks || []).map(async (c) => {
    try {
      const wh = WEBHOOKS[c.webhookIndex];
      if (!wh || !c.messageId) return;
      const r = await fetch(`${wh}/messages/${c.messageId}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) {
        const t = await r.text().catch(() => '');
        errors.push(`chunk ${c.index}: ${r.status} ${t}`);
      }
    } catch (e) {
      errors.push(`chunk ${c.index}: ${e.message}`);
    }
  }));
  all.splice(idx, 1);
  saveMeta(all);
  res.json({ ok: true, deletedFromDiscord: errors.length === 0, errors });
});

async function checkChunkUrl(url) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let r = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (r.status === 405 || r.status === 403) {
      r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    }
    clearTimeout(timeout);
    return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.message };
  }
}

async function deleteWebhookMessage(webhookUrl, messageId) {
  if (!webhookUrl || !messageId) return;
  try { await fetch(`${webhookUrl}/messages/${messageId}`, { method: 'DELETE' }); } catch {}
}

app.post('/api/tools/benchmark-concurrency', auth, async (req, res) => {
  if (WEBHOOKS.length === 0) return res.status(400).json({ error: 'No hay webhooks configurados' });
  const candidates = [2, 4, 6, 8].filter(c => c <= Math.max(2, WEBHOOKS.length * 2)).filter((v,i,a)=>a.indexOf(v)===i);
  const testChunks = Math.min(6, Math.max(4, WEBHOOKS.length));
  const testSize = 256 * 1024; // 256KB
  const results = [];
  for (const concurrency of candidates) {
    const started = Date.now();
    let ok = 0, errors = 0;
    const sent = [];
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++; if (i >= testChunks) break;
        const buf = Buffer.alloc(testSize, i);
        const wh = WEBHOOKS[i % WEBHOOKS.length];
        try {
          const info = await sendChunkToDiscord(wh, buf, 'benchmark-test.bin', i);
          sent.push({ wh, messageId: info.messageId });
          ok++;
        } catch (e) { errors++; }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, testChunks) }, worker));
    } catch { errors++; }
    const ms = Date.now() - started;
    // cleanup
    await Promise.all(sent.map(s => deleteWebhookMessage(s.wh, s.messageId)));
    results.push({ concurrency, ms, ok, errors, chunks: testChunks, throughputKBs: ms > 0 ? Math.round((ok * testSize / 1024) / (ms / 1000)) : 0 });
    await sleep(500);
  }
  const successful = results.filter(r => r.errors === 0 && r.ok > 0);
  const pick = (successful.length ? successful : results.filter(r=>r.ok>0)).sort((a,b)=>a.ms-b.ms)[0] || { concurrency: 4 };
  const settings = loadSettings();
  settings.autoConcurrency = pick.concurrency;
  settings.lastBenchmark = { at: new Date().toISOString(), recommended: pick.concurrency, results };
  saveSettings(settings);
  res.json({ recommended: pick.concurrency, results, settings });
});

app.post('/api/tools/health-scan', auth, async (req, res) => {
  const all = loadMeta();
  const tasks = [];
  for (const f of all) {
    for (const c of (f.chunks || [])) tasks.push({ fileId: f.id, fileName: f.name, index: c.index, url: c.url });
  }
  const results = new Array(tasks.length);
  let i = 0;
  const concurrency = 8;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) break;
      const t = tasks[idx];
      const r = await checkChunkUrl(t.url);
      results[idx] = { ...t, ...r };
    }
  });
  await Promise.all(workers);
  const byFile = {};
  for (const r of results) {
    if (!byFile[r.fileId]) byFile[r.fileId] = { fileId: r.fileId, fileName: r.fileName, total: 0, ok: 0, bad: 0, chunks: [], avgMs: 0 };
    byFile[r.fileId].total++;
    if (r.ok) byFile[r.fileId].ok++; else byFile[r.fileId].bad++;
    byFile[r.fileId].chunks.push({ index: r.index, ok: r.ok, status: r.status, ms: r.ms, error: r.error || null });
  }
  const files = Object.values(byFile).map(f => ({ ...f, avgMs: Math.round(f.chunks.reduce((s,c)=>s+c.ms,0)/(f.chunks.length||1)), healthy: f.bad === 0 }));
  const summary = {
    scannedAt: new Date().toISOString(),
    files: files.length,
    chunks: results.length,
    okChunks: results.filter(r=>r.ok).length,
    badChunks: results.filter(r=>!r.ok).length,
    healthyFiles: files.filter(f=>f.healthy).length,
    unhealthyFiles: files.filter(f=>!f.healthy).length,
    avgMs: results.length ? Math.round(results.reduce((s,r)=>s+r.ms,0)/results.length) : 0
  };
  res.json({ summary, files: files.sort((a,b)=>a.healthy===b.healthy? a.fileName.localeCompare(b.fileName) : (a.healthy?1:-1)) });
});

app.post('/api/tools/cleanup-tmp', auth, async (req, res) => {
  let removed = 0, bytes = 0;
  try {
    const entries = await fsp.readdir(UPLOAD_DIR);
    for (const name of entries) {
      const p = path.join(UPLOAD_DIR, name);
      try {
        const st = await fsp.stat(p);
        bytes += st.size || 0;
        await fsp.unlink(p);
        removed++;
      } catch {}
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true, removed, bytes });
});

app.get('/api/tools/export-shares', auth, (req, res) => {
  const all = loadMeta();
  const base = `${req.protocol}://${req.get('host')}`;
  const shares = all.filter(f => f.shareToken).map(f => ({
    id: f.id,
    name: f.name,
    size: f.size,
    url: `${base}/s/${f.shareToken}`,
    shareToken: f.shareToken,
    expiresAt: f.shareExpiresAt || null,
    expired: f.shareExpiresAt ? new Date(f.shareExpiresAt).getTime() < Date.now() : false
  }));
  res.json({ shares });
});

app.get('/api/tools/storage-breakdown', auth, (req, res) => {
  const all = loadMeta();
  const byType = {};
  for (const f of all) {
    const t = (f.type || 'desconocido').split(';')[0] || 'desconocido';
    if (!byType[t]) byType[t] = { type: t, files: 0, size: 0 };
    byType[t].files++; byType[t].size += f.size || 0;
  }
  res.json({ breakdown: Object.values(byType).sort((a,b)=>b.size-a.size) });
});

(async () => {
  try { await initBotWebhooks(); } catch (e) { console.error('Bot init error:', e.message); }
  const server = app.listen(PORT, () => {
    console.log(`Discord Cloud listening on http://localhost:${PORT}`);
    console.log(`Webhooks: ${WEBHOOKS.length} | Chunk size: ${CHUNK_SIZE} bytes`);
    if (WEBHOOKS.length === 0) console.warn('AVISO: no hay webhooks configurados. Define WEBHOOKS o BOT_TOKEN+GUILD_ID en .env');
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 120000;
})();
