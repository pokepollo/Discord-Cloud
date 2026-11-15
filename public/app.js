const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploads = document.getElementById('uploads');
const fileList = document.getElementById('fileList');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const statsEl = document.getElementById('stats');
const sysStats = document.getElementById('sysStats');

let files = [];
let stats = null;

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function humanSize(b) {
  const u = ['B','KB','MB','GB','TB']; let i=0; let n=Number(b||0);
  while (n >= 1024 && i < u.length-1) { n/=1024; i++; }
  return `${n.toFixed(n>=10||i===0?0:1)} ${u[i]}`;
}
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function api(path, opts={}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  if (r.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || r.statusText || 'Error');
  return data;
}

async function loadStats() {
  stats = await api('/api/stats');
  const cards = [
    ['Archivos', stats.files, 'files'],
    ['Almacenado', humanSize(stats.totalSize), 'storage'],
    ['Chunks', stats.totalChunks, 'chunks'],
    ['Canales', stats.channels, 'channels']
  ];
  statsEl.innerHTML = cards.map(([label,value]) => `<div class="stat"><div class="stat-glow"></div><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
  sysStats.innerHTML = `
    <div><span>Archivos</span><strong>${stats.files}</strong></div>
    <div><span>Tamaño total</span><strong>${humanSize(stats.totalSize)}</strong></div>
    <div><span>Chunks totales</span><strong>${stats.totalChunks}</strong></div>
    <div><span>Canales activos</span><strong>${stats.channels}</strong></div>
    <div><span>Tamaño de chunk</span><strong>${humanSize(stats.chunkSize)}</strong></div>`;
  document.getElementById('cfgChannels').textContent = stats.channels;
  document.getElementById('cfgChunk').textContent = humanSize(stats.chunkSize);
}

async function loadFiles() {
  files = await api('/api/files');
  renderFiles();
  await loadStats();
}

function renderFiles() {
  const q = search.value.trim().toLowerCase();
  const list = files.filter(f => {
    if (!q) return true;
    const hay = [f.name, f.note || '', ...(f.tags||[])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  fileList.innerHTML = list.map((f, idx) => `
    <tr style="--i:${idx}">
      <td class="name">
        <div class="file-name"><span class="file-icon">▣</span>${esc(f.name)}</div>
        ${(f.tags && f.tags.length) ? `<div>${f.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}
        ${f.shareToken ? `<div class="share-badge">Enlace público activo${f.shareExpiresAt ? ' · expira ' + new Date(f.shareExpiresAt).toLocaleString() : ''}</div>` : ''}
      </td>
      <td>${humanSize(f.size)}</td>
      <td><span class="pill">${f.chunks}</span></td>
      <td>${new Date(f.createdAt).toLocaleString()}</td>
      <td>
        <div class="actions">
          <button class="small secondary" data-act="share" data-id="${f.id}">${f.shareToken ? 'Compartir' : 'Enlace'}</button>
          <button class="small secondary" data-act="edit" data-id="${f.id}">Editar</button>
          <button class="small primary" data-act="dl" data-id="${f.id}">Descargar</button>
          <button class="small danger" data-act="del" data-id="${f.id}">Borrar</button>
        </div>
      </td>
    </tr>`).join('');
  empty.style.display = list.length ? 'none' : 'block';
}

fileList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const f = files.find(x => x.id === id);
  if (act === 'dl') {
    showToast('Preparando descarga... comenzará en cuanto el servidor envíe los datos.');
    const a = document.createElement('a');
    a.href = `/api/download/${id}`;
    a.download = f ? f.name : 'file';
    document.body.appendChild(a); a.click(); a.remove();
  } else if (act === 'del') {
    if (!confirm(`¿Borrar "${f ? f.name : id}"? Se eliminará del panel y también sus mensajes/chunks en Discord.`)) return;
    const res = await api(`/api/files/${id}`, { method: 'DELETE' });
    if (res.errors && res.errors.length) alert('Borrado del índice completo, pero hubo errores al borrar en Discord:\n' + res.errors.join('\n'));
    await loadFiles();
  } else if (act === 'edit') {
    const name = prompt('Nombre:', f ? f.name : '');
    if (name === null) return;
    const tags = prompt('Etiquetas (separadas por coma):', (f && f.tags || []).join(', '));
    if (tags === null) return;
    const note = prompt('Nota:', (f && f.note) || '');
    if (note === null) return;
    await api(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify({ name: name || (f&&f.name), tags, note }) });
    await loadFiles();
  } else if (act === 'rename') {
    const name = prompt('Nuevo nombre:', f ? f.name : '');
    if (!name) return;
    await api(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    await loadFiles();
  } else if (act === 'share') {
    let token = f && f.shareToken;
    let url = token ? `${location.origin}/s/${token}` : '';
    let shareExpiresAt = f && f.shareExpiresAt;
    if (!token) {
      const exp = prompt('Horas de validez del enlace (vacío = sin expiración):', '24');
      if (exp === null) return;
      const body = {};
      if (exp && !isNaN(Number(exp))) body.expiresInHours = Number(exp);
      const res = await api(`/api/files/${id}/share`, { method: 'POST', body: JSON.stringify(body) });
      url = res.url; token = res.shareToken; shareExpiresAt = res.shareExpiresAt;
      await loadFiles();
    }
    const info = `Enlace público:\n${url}\n${shareExpiresAt ? 'Expira: ' + new Date(shareExpiresAt).toLocaleString() : 'Sin expiración'}\n\nAceptar = copiar enlace\nCancelar = revocar enlace`;
    const copy = confirm(info);
    if (copy) {
      try { await navigator.clipboard.writeText(url); showToast('Enlace copiado al portapapeles'); }
      catch { prompt('Copia el enlace:', url); }
    } else {
      if (confirm('¿Revocar el enlace público de este archivo?')) {
        await api(`/api/files/${id}/share`, { method: 'DELETE' });
        await loadFiles();
        showToast('Enlace revocado');
      }
    }
  }
});

function makeUploadItem(name, size) {
  const el = document.createElement('div');
  el.className = 'upload-item active';
  el.innerHTML = `
    <div class="u-head"><strong>${esc(name)}</strong> <span class="muted">${humanSize(size)}</span></div>
    <div class="u-status">Preparando subida...</div>
    <div class="bar"><span style="width:0%"></span></div>
    <div class="u-meta"><span class="u-pct">0%</span><span class="u-detail"></span></div>`;
  uploads.prepend(el);
  const bar = el.querySelector('.bar span');
  const status = el.querySelector('.u-status');
  const pct = el.querySelector('.u-pct');
  const detail = el.querySelector('.u-detail');
  return {
    set(p, text, det='') { const v = Math.max(0, Math.min(100, Math.round(p))); bar.style.width = v+'%'; pct.textContent = v+'%'; status.textContent = text; detail.textContent = det; },
    ok(msg){ el.classList.remove('active'); el.classList.add('ok'); this.set(100, msg); },
    err(msg){ el.classList.remove('active'); el.classList.add('err'); status.textContent = 'Error: ' + msg; detail.textContent=''; }
  };
}

function uploadWithProgress(file) {
  return new Promise((resolve) => {
    const item = makeUploadItem(file.name, file.size);
    const uploadId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2));
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    let pollTimer = null;
    let serverPhase = false;
    let finished = false;

    const finishOk = (chunksCount) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      item.ok(`Completado · ${chunksCount || '?'} chunks`);
      resolve();
    };
    const finishErr = (msg) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      item.err(msg);
      resolve();
    };

    const poll = async () => {
      try {
        const r = await fetch(`/api/upload-progress/${uploadId}`, { credentials: 'same-origin' });
        if (!r.ok) return;
        const p = await r.json();
        if (p && p.status && p.status !== 'unknown') {
          serverPhase = true;
          const conc = p.concurrency ? ` · concurrencia ${p.concurrency}` : '';
          if (p.status === 'processing') item.set(2, 'Procesando archivo y subiendo a Discord...', `0/${p.total || '?'} chunks${conc}`);
          else if (p.status === 'uploading') item.set(p.percent || 0, 'Subiendo a Discord...', `${p.done}/${p.total} chunks${conc}`);
          else if (p.status === 'done') finishOk(p.total);
          else if (p.status === 'error') finishErr(p.error || 'Error');
        }
      } catch {}
    };

    xhr.upload.onprogress = (e) => {
      if (serverPhase) return;
      if (e.lengthComputable) {
        const p = (e.loaded / e.total) * 100;
        item.set(p, 'Enviando archivo al servidor...', `${humanSize(e.loaded)} / ${humanSize(e.total)}`);
      }
    };
    xhr.upload.onload = () => {
      if (!serverPhase) item.set(100, 'Archivo recibido. Preparando subida a Discord...', 'Iniciando reparto en chunks');
      pollTimer = setInterval(poll, 1000);
      poll();
    };
    xhr.onreadystatechange = async () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 401) { if (pollTimer) clearInterval(pollTimer); location.href = '/'; return resolve(); }
      try {
        const j = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          finishOk(j.chunks);
        } else {
          finishErr(j.error || xhr.statusText || 'Error');
        }
      } catch (e) {
        if (finished) return; // poll may have already finalized
        finishErr(xhr.status ? (xhr.statusText || 'Error') : 'fetch failed');
      }
    };
    xhr.onerror = () => finishErr('Error de red');
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('x-upload-id', uploadId);
    xhr.withCredentials = true;
    xhr.send(fd);
  });
}

async function handleFiles(fileListInput) {
  for (const f of fileListInput) {
    await uploadWithProgress(f);
  }
  await loadFiles();
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value = ''; });

search.addEventListener('input', renderFiles);
document.getElementById('refresh').addEventListener('click', loadFiles);
document.getElementById('logoutBtn').addEventListener('click', async () => { await fetch('/api/logout', {method:'POST'}); location.href='/'; });

document.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  const view = a.dataset.view;
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x===a));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.getElementById('viewTitle').textContent = view === 'tools' ? 'Herramientas' : 'Archivos';
  if (view === 'tools') { loadStats(); loadConcurrencyUI(); }
}));

document.getElementById('toolRefreshMeta').addEventListener('click', loadFiles);
document.getElementById('toolExportMeta').addEventListener('click', async () => {
  const data = await api('/api/files');
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'discord-cloud-index.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('toolExportShares').addEventListener('click', async () => {
  const res = await api('/api/tools/export-shares');
  const blob = new Blob([JSON.stringify(res, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'discord-cloud-shares.json';
  a.click();
  URL.revokeObjectURL(a.href);
  document.getElementById('quickToolResult').textContent = `Exportados ${res.shares.length} enlaces compartidos.`;
});

document.getElementById('toolCleanupTmp').addEventListener('click', async () => {
  const res = await api('/api/tools/cleanup-tmp', { method: 'POST' });
  document.getElementById('quickToolResult').textContent = `Temporales limpiados: ${res.removed} archivo(s), ${humanSize(res.bytes)} liberados.`;
  showToast('Limpieza de temporales completada');
});

document.getElementById('toolBreakdown').addEventListener('click', async () => {
  const res = await api('/api/tools/storage-breakdown');
  const total = res.breakdown.reduce((s,x)=>s+x.size,0) || 1;
  document.getElementById('breakdownResults').innerHTML = res.breakdown.length ? res.breakdown.map(x => `
    <div class="bd-row">
      <div><div><strong>${esc(x.type)}</strong></div><div class="bd-bar"><span style="width:${(x.size/total*100).toFixed(1)}%"></span></div></div>
      <div class="muted">${x.files} archivos</div>
      <div><strong>${humanSize(x.size)}</strong></div>
    </div>`).join('') : '<div class="muted">Sin datos.</div>';
});

document.getElementById('toolHealthScan').addEventListener('click', async () => {
  const btn = document.getElementById('toolHealthScan');
  const summaryEl = document.getElementById('healthSummary');
  const resultsEl = document.getElementById('healthResults');
  btn.disabled = true; btn.textContent = 'Escaneando...';
  summaryEl.innerHTML = '<div class="muted">Analizando disponibilidad y latencia de chunks...</div>';
  resultsEl.innerHTML = '';
  try {
    const res = await api('/api/tools/health-scan', { method: 'POST' });
    const s = res.summary;
    summaryEl.innerHTML = [
      ['Archivos', s.files], ['Chunks', s.chunks], ['Chunks OK', s.okChunks], ['Chunks con fallo', s.badChunks],
      ['Archivos sanos', s.healthyFiles], ['Archivos con incidencias', s.unhealthyFiles], ['Latencia media', s.avgMs + ' ms']
    ].map(([k,v]) => `<div class="hs-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    resultsEl.innerHTML = res.files.map(f => `
      <div class="hf ${f.healthy ? 'ok' : 'bad'}">
        <div class="hf-head"><strong>${esc(f.fileName)}</strong><span class="${f.healthy?'badge-ok':'badge-bad'}">${f.healthy ? 'Íntegro' : 'Con incidencias'} · ${f.ok}/${f.total} chunks · ${f.avgMs} ms</span></div>
        ${f.bad ? `<div class="hf-chunks">Chunks afectados: ${f.chunks.filter(c=>!c.ok).map(c=>`#${c.index} (${c.status||'ERR'}${c.error?': '+esc(c.error):''})`).join(', ')}</div>` : ''}
      </div>`).join('') || '<div class="muted">No hay archivos para escanear.</div>';
    showToast('Escaneo de salud completado');
  } catch (e) {
    summaryEl.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Ejecutar escaneo';
  }
});

async function loadConcurrencyUI() {
  const s = await api('/api/settings');
  const mode = s.uploadMode || 'default';
  document.getElementById('modeDefault').classList.toggle('active', mode === 'default');
  document.getElementById('modeAuto').classList.toggle('active', mode === 'auto');
  const effective = mode === 'auto' && s.autoConcurrency ? s.autoConcurrency : 4;
  const bench = s.lastBenchmark;
  document.getElementById('concurrencyStatus').innerHTML = `
    <div><span>Modo actual</span><strong>${mode === 'auto' ? 'Automático' : 'Por defecto (4)'}</strong></div>
    <div><span>Concurrencia efectiva</span><strong>${effective}</strong></div>
    <div><span>Recomendación calibrada</span><strong>${s.autoConcurrency || 'Sin calibrar'}</strong></div>
    <div><span>Última calibración</span><strong>${bench ? new Date(bench.at).toLocaleString() : 'Nunca'}</strong></div>`;
  if (bench && bench.results) {
    document.getElementById('benchmarkResults').innerHTML = bench.results.map(r => `<div class="hf ${r.concurrency===bench.recommended?'ok':''}"><div class="hf-head"><strong>Concurrencia ${r.concurrency}</strong><span>${r.ms} ms · ${r.throughputKBs} KB/s · ${r.ok}/${r.chunks} ok · ${r.errors} errores ${r.concurrency===bench.recommended?'· recomendada':''}</span></div></div>`).join('');
  }
}

document.getElementById('modeDefault').addEventListener('click', async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ uploadMode: 'default' }) }); await loadConcurrencyUI(); showToast('Modo por defecto (4) activado'); });
document.getElementById('modeAuto').addEventListener('click', async () => {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ uploadMode: 'auto' }) });
  await loadConcurrencyUI();
  const s = await api('/api/settings');
  if (!s.autoConcurrency) showToast('Modo automático activado. Ejecuta "Calibrar automático" para medir la mejor concurrencia.');
  else showToast('Modo automático activado');
});
document.getElementById('toolBenchmark').addEventListener('click', async () => {
  const btn = document.getElementById('toolBenchmark');
  const resEl = document.getElementById('benchmarkResults');
  btn.disabled = true; btn.textContent = 'Calibrando...';
  resEl.innerHTML = '<div class="muted">Enviando chunks de prueba a Discord, midiendo rendimiento y limpiando mensajes de prueba...</div>';
  try {
    const res = await api('/api/tools/benchmark-concurrency', { method: 'POST' });
    await loadConcurrencyUI();
    showToast(`Calibración completada. Concurrencia recomendada: ${res.recommended}`);
  } catch (e) {
    resEl.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Calibrar automático';
  }
});

(async () => {
  try {
    const me = await api('/api/me');
    if (me.setupRequired) { location.href = '/'; return; }
    if (me.loginRequired && !me.authed) { location.href = '/'; return; }
  } catch {}
  await loadFiles();
  try { await loadConcurrencyUI(); } catch {}
})();