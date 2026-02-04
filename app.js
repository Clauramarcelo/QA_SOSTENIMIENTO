/**********************
 * CONFIG (ajusta rangos si deseas)
 **********************/
const LIMITS = {
  slump: { min: 8, max: 11 },     // pulgadas OK (ajusta según tu CE)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid(){ return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }

function todayISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function setStatus(el, msg, ms=2500){
  el.textContent = msg;
  if(ms) setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; }, ms);
}

function parseDateISO(iso){
  if(!iso) return null;
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}

function inRange(dateIso, desdeIso, hastaIso){
  if(!desdeIso && !hastaIso) return true;
  const x = parseDateISO(dateIso);
  const d0 = desdeIso ? parseDateISO(desdeIso) : null;
  const d1 = hastaIso ? parseDateISO(hastaIso) : null;
  if(d0 && x < d0) return false;
  if(d1 && x > d1) return false;
  return true;
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function formatNum(v){
  if(v === null || v === undefined || Number.isNaN(v)) return '';
  if(Number.isInteger(v)) return String(v);
  return (Math.round(v*100)/100).toFixed(2).replace(/\.00$/,'');
}

function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
function truncate(s,n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }

function rangoCaption(desde,hasta){
  if(!desde && !hasta) return 'Todo el historial';
  if(desde && !hasta) return `Desde ${desde}`;
  if(!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
}

/**********************
 * Slump: pulgadas con fracciones
 **********************/
function parseInchFraction(input){
  if(input === null || input === undefined) return null;
  let s = String(input).trim();
  if(!s) return null;

  s = s.replace(/["”″]/g,'').trim(); // quitar comillas
  s = s.replace(/\s+/g,' ');

  // decimal directo
  if(/^\d+(\.\d+)?$/.test(s)){
    const v = Number(s);
    return { value: v, text: `${formatNum(v)}"` };
  }

  // "a b/c" o "b/c"
  const parts = s.split(' ');
  let whole = 0, frac = null;

  if(parts.length === 1){
    frac = parts[0];
  } else if(parts.length === 2){
    whole = Number(parts[0]);
    frac = parts[1];
    if(Number.isNaN(whole)) return null;
  } else return null;

  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if(!m) return null;

  const num = Number(m[1]);
  const den = Number(m[2]);
  if(!den) return null;

  const value = whole + (num/den);
  const text = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + `"`;
  return { value, text };
}

/**********************
 * IndexedDB
 **********************/
const DB_NAME = 'ce_qc_db';
const DB_VER = 2; // slumpIn/slumpText
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;

      const mkStore = (name) => {
        if(!db.objectStoreNames.contains(name)){
          const s = db.createObjectStore(name, { keyPath: 'id' });
          s.createIndex('fecha','fecha',{unique:false});
          s.createIndex('labor','labor',{unique:false});
        }
      };

      mkStore('slump');
      mkStore('resist');
      mkStore('pernos');
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db); };
    req.onerror = ()=> reject(req.error);
  });
}

function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}

function addRecord(store, rec){
  rec.id = uid();
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').add(rec);
    r.onsuccess = ()=> resolve(rec);
    r.onerror = ()=> reject(r.error);
  });
}

function deleteRecord(store, id){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').delete(id);
    r.onsuccess = ()=> resolve(true);
    r.onerror = ()=> reject(r.error);
  });
}

function clearStore(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').clear();
    r.onsuccess = ()=> resolve(true);
    r.onerror = ()=> reject(r.error);
  });
}

function getAll(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store).getAll();
    r.onsuccess = ()=> resolve(r.result || []);
    r.onerror = ()=> reject(r.error);
  });
}

async function getAllFiltered(store, desdeIso, hastaIso){
  const rows = await getAll(store);
  return rows
    .filter(r => inRange(r.fecha, desdeIso, hastaIso))
    .sort((a,b)=> (a.fecha+(a.hora||'')).localeCompare(b.fecha+(b.hora||'')));
}

/**********************
 * Tabs
 **********************/
function initTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const name = btn.dataset.tab;
      $$('.panel').forEach(p=>p.classList.remove('active'));
      $(`#tab-${name}`).classList.add('active');

      if(name==='bd') refreshDBTables();
      if(name==='reporte') buildReport();
    });
  });
}

/**********************
 * Rows con data-label (cards móvil)
 **********************/
function makeRow(cells){
  const tr = document.createElement('tr');
  cells.forEach(({label, html})=>{
    const td = document.createElement('td');
    td.setAttribute('data-label', label);
    td.innerHTML = `<div class="cell-right">${html}</div>`;
    tr.appendChild(td);
  });
  return tr;
}
function delBtn(store, id){
  return `<button class="btn btn-danger" data-del="${store}:${id}">Eliminar</button>`;
}

/**********************
 * Formularios
 **********************/
function initForms(){
  ['#formSlump input[name=fecha]','#formResist input[name=fecha]','#formPernos input[name=fecha]',
   '#fDesde', '#fHasta', '#rDesde', '#rHasta']
   .forEach(sel=>{ const el=$(sel); if(el) el.value = todayISO(); });

  // Pernos: habilitar cantidades
  const chkHel = $('#chkHel');
  const chkSw = $('#chkSw');
  const cantHel = $('#cantHel');
  const cantSw = $('#cantSw');
  const sync = ()=>{
    cantHel.disabled = !chkHel.checked;
    cantSw.disabled = !chkSw.checked;
    if(!chkHel.checked) cantHel.value = 0;
    if(!chkSw.checked) cantSw.value = 0;
  };
  chkHel.addEventListener('change', sync);
  chkSw.addEventListener('change', sync);

  // Slump
  $('#formSlump').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    const parsed = parseInchFraction(fd.get('slumpIn'));
    if(!parsed){
      setStatus($('#slumpStatus'), '⚠️ Slump inválido. Ej: 9 3/4" o 10 1/4"', 4000);
      return;
    }

    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('horaSlump'),
      labor: (fd.get('labor')||'').trim(),
      nivel: (fd.get('nivel')||'').trim(),
      slumpText: parsed.text,
      slumpIn: parsed.value,
      temp: Number(fd.get('temp')),
      presionAire: Number(fd.get('presionAire')),
      mixerHS: (fd.get('mixerHS')||'').trim(),
      hll: fd.get('hll'),
      obs: (fd.get('obs')||'').trim(),
      createdAt: new Date().toISOString()
    };

    await addRecord('slump', rec);
    setStatus($('#slumpStatus'), '✅ Registro guardado.');

    e.target.reset();
    e.target.querySelector('input[name=fecha]').value = todayISO();
  });

  // Resist
  $('#formResist').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora'),
      labor: (fd.get('labor')||'').trim(),
      nivel: (fd.get('nivel')||'').trim(),
      edad: (fd.get('edad')||'').trim(),
      resistencia: Number(fd.get('resistencia')),
      obs: (fd.get('obs')||'').trim(),
      createdAt: new Date().toISOString()
    };

    await addRecord('resist', rec);
    setStatus($('#resistStatus'), '✅ Registro guardado.');

    e.target.reset();
    e.target.querySelector('input[name=fecha]').value = todayISO();
  });

  // Pernos
  $('#formPernos').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    const hel = chkHel.checked ? Number(fd.get('cantHel')||0) : 0;
    const sw = chkSw.checked ? Number(fd.get('cantSw')||0) : 0;

    if((hel+sw) <= 0){
      setStatus($('#pernosStatus'), '⚠️ Marca un tipo e ingresa una cantidad.', 3500);
      return;
    }

    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora'),
      labor: (fd.get('labor')||'').trim(),
      nivel: (fd.get('nivel')||'').trim(),
      helicoidal: hel,
      swellex: sw,
      obs: (fd.get('obs')||'').trim(),
      createdAt: new Date().toISOString()
    };

    await addRecord('pernos', rec);
    setStatus($('#pernosStatus'), '✅ Registro guardado.');

    e.target.reset();
    e.target.querySelector('input[name=fecha]').value = todayISO();
    chkHel.checked=false; chkSw.checked=false;
    cantHel.value=0; cantSw.value=0;
    cantHel.disabled=true; cantSw.disabled=true;
  });

  // Filtro BD
  $('#btnFiltrar').addEventListener('click', refreshDBTables);
  $('#btnLimpiarFiltro').addEventListener('click', ()=>{
    $('#fDesde').value=''; $('#fHasta').value='';
    refreshDBTables();
  });

  // Borrar todo
  $('#btnBorrarTodo').addEventListener('click', async ()=>{
    const ok = confirm('¿Seguro que deseas borrar TODO? No se puede deshacer.');
    if(!ok) return;
    await clearStore('slump');
    await clearStore('resist');
    await clearStore('pernos');
    refreshDBTables();
    buildReport();
    alert('Listo: Base de datos borrada.');
  });

  // Reporte
  $('#btnReporte').addEventListener('click', buildReport);
  $('#btnReporteTodo').addEventListener('click', ()=>{
    $('#rDesde').value=''; $('#rHasta').value='';
    buildReport();
  });

  // ✅ PDF (ahora sí hace acción)
  $('#btnPDF').addEventListener('click', exportReportPDF);
}

/**********************
 * BD Tables
 **********************/
async function refreshDBTables(){
  const desde = $('#fDesde').value || null;
  const hasta = $('#fHasta').value || null;

  const [sl, re, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('resist', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  // Slump
  const slb = $('#tblSlump tbody'); slb.innerHTML='';
  sl.forEach(r=>{
    slb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Slump', html: esc(r.slumpText || `${formatNum(r.slumpIn)}"` )},
      {label:'T°', html: `${formatNum(r.temp)} °C`},
      {label:'Presión', html: formatNum(r.presionAire)},
      {label:'Mixer/HS', html: esc(r.mixerHS)},
      {label:'H_LL', html: esc(r.hll)},
      {label:'Acción', html: delBtn('slump', r.id)}
    ]));
  });

  // Resist
  const reb = $('#tblResist tbody'); reb.innerHTML='';
  re.forEach(r=>{
    reb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Edad', html: esc(r.edad)},
      {label:'MPa', html: formatNum(r.resistencia)},
      {label:'Acción', html: delBtn('resist', r.id)}
    ]));
  });

  // Pernos
  const peb = $('#tblPernos tbody'); peb.innerHTML='';
  pe.forEach(r=>{
    peb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Helicoidal', html: formatNum(r.helicoidal || 0)},
      {label:'Swellex', html: formatNum(r.swellex || 0)},
      {label:'Acción', html: delBtn('pernos', r.id)}
    ]));
  });

  $$('[data-del]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [store,id] = b.dataset.del.split(':');
      const ok = confirm('¿Eliminar este registro?');
      if(!ok) return;
      await deleteRecord(store, id);
      refreshDBTables();
      buildReport();
    });
  });
}

/**********************
 * Reporte: Lollipop SOLO Slump y Presión
 * + Temperatura y Pernos como KPIs grandes
 **********************/
function groupByLabor(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.labor || 'SIN LABOR').trim() || 'SIN LABOR';
    if(!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return m;
}

function drawLollipopChart(canvas, labels, values, unit, caption){
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const BG = css.getPropertyValue('--surface').trim() || '#fff';
  const TXT = css.getPropertyValue('--text').trim() || '#111827';
  const MUT = css.getPropertyValue('--muted').trim() || '#6B7280';
  const ACC = css.getPropertyValue('--accent').trim() || '#F97316';

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = BG;
  ctx.fillRect(0,0,W,H);

  const padL = 190, padR = 24, padT = 44, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  ctx.font = '12px system-ui';
  ctx.fillStyle = MUT;
  ctx.textAlign = 'left';
  ctx.fillText(caption || '', padL, 20);

  const n = Math.max(1, labels.length);
  const rowH = plotH / n;
  const maxV = Math.max(1, ...values);

  ctx.strokeStyle = 'rgba(17,24,39,.10)';
  ctx.lineWidth = 1;
  for(let i=0;i<=5;i++){
    const x = padL + plotW*(i/5);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }

  for(let i=0;i<n;i++){
    const y = padT + rowH*i + rowH/2;
    const v = values[i] || 0;
    const xVal = padL + (v/maxV) * plotW;

    ctx.fillStyle = TXT;
    ctx.font = '12px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(truncate(labels[i], 22), padL - 10, y + 4);

    ctx.strokeStyle = 'rgba(249,115,22,.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(xVal, y);
    ctx.stroke();

    ctx.fillStyle = ACC;
    ctx.beginPath();
    ctx.arc(xVal, y, 6, 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = MUT;
    ctx.textAlign = 'left';
    ctx.fillText(`${formatNum(v)}${unit}`, Math.min(W-10, xVal + 10), y + 4);
  }
}

async function buildReport(){
  const desde = $('#rDesde').value || null;
  const hasta = $('#rHasta').value || null;
  const caption = rangoCaption(desde, hasta);

  const [sl, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  // Métricas por labor
  const gSl = groupByLabor(sl);
  const labores = Array.from(gSl.keys()).sort((a,b)=>a.localeCompare(b));

  const slumpVals = labores.map(l=>{
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.slumpIn)||0)) : 0;
  });

  const aireVals = labores.map(l=>{
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.presionAire)||0)) : 0;
  });

  // Dibujar SOLO 2 gráficos
  drawLollipopChart($('#chartSlump'), labores, slumpVals, '"', caption);
  drawLollipopChart($('#chartAire'), labores, aireVals, '', caption);

  // KPI Temperatura (prom, min, max)
  const temps = sl.map(r=>Number(r.temp)).filter(v=>!Number.isNaN(v));
  const tProm = temps.length ? mean(temps) : 0;
  const tMin = temps.length ? Math.min(...temps) : 0;
  const tMax = temps.length ? Math.max(...temps) : 0;

  $('#kpiTempProm').textContent = temps.length ? `${formatNum(tProm)}°C` : '—';
  $('#kpiTempExtra').textContent = temps.length ? `Min ${formatNum(tMin)}°C | Max ${formatNum(tMax)}°C` : 'Min — | Max —';

  // KPI Pernos (total + desglose)
  const helTot = pe.reduce((a,r)=> a + (Number(r.helicoidal)||0), 0);
  const swTot  = pe.reduce((a,r)=> a + (Number(r.swellex)||0), 0);
  const totalP = helTot + swTot;

  $('#kpiPernosTotal').textContent = totalP;
  $('#kpiPernosExtra').textContent = `Helicoidal ${helTot} | Swellex ${swTot}`;

  // Resumen
  const slumpPromGlobal = sl.length ? mean(sl.map(r=>Number(r.slumpIn)||0)) : 0;
  const airePromGlobal  = sl.length ? mean(sl.map(r=>Number(r.presionAire)||0)) : 0;

  $('#resumenReporte').innerHTML = `
    <ul>
      <li><strong>Rango:</strong> ${caption}</li>
      <li><strong>Registros Slump:</strong> ${sl.length}</li>
      <li><strong>Slump prom. global:</strong> ${formatNum(slumpPromGlobal)}"</li>
      <li><strong>Presión prom. global:</strong> ${formatNum(airePromGlobal)}</li>
      <li><strong>Temperatura prom. global:</strong> ${temps.length ? formatNum(tProm) + '°C' : '—'}</li>
      <li><strong>Pernos total:</strong> ${totalP} (Hel ${helTot} / Sw ${swTot})</li>
      <li><strong>Labores (Slump):</strong> ${labores.length}</li>
    </ul>
  `;
}

/**********************
 * PDF (sí funciona): abre vista imprimible y dispara imprimir
 **********************/
function exportReportPDF(){
  // Si el popup se bloquea, avisar
  const w = window.open('', '_blank');
  if(!w){
    alert('El navegador bloqueó la ventana del PDF. Permite ventanas emergentes (pop-ups) y vuelve a intentar.');
    return;
  }

  const desde = $('#rDesde').value || '';
  const hasta = $('#rHasta').value || '';
  const caption = rangoCaption(desde||null, hasta||null);

  // Charts como imágenes
  const chartSlumpUrl = document.getElementById('chartSlump').toDataURL('image/png');
  const chartAireUrl  = document.getElementById('chartAire').toDataURL('image/png');

  // KPI textos
  const tProm = esc($('#kpiTempProm').textContent || '—');
  const tExtra = esc($('#kpiTempExtra').textContent || '—');
  const pTot = esc($('#kpiPernosTotal').textContent || '0');
  const pExtra = esc($('#kpiPernosExtra').textContent || '—');

  const resumen = $('#resumenReporte').innerHTML || '';

  const html = `
  <!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reporte CE - PDF</title>
    <style>
      body{ font-family: Arial, sans-serif; margin:20px; color:#111827; }
      .head{ display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
      .brand{ font-weight:900; font-size:18px; }
      .tag{ padding:6px 10px; border-radius:999px; background:#F97316; color:#fff; font-weight:800; display:inline-block; }
      .muted{ color:#6B7280; font-size:12px; }
      .grid{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-top:14px; }
      .card{ border:1px solid #e5e7eb; border-radius:14px; padding:12px; }
      .kpis{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-top:14px; }
      .kpi{ background:#fff7ed; border:1px solid #fed7aa; border-radius:14px; padding:12px; }
      .kpi-title{ font-weight:800; font-size:12px; color:#7c2d12; }
      .kpi-value{ font-weight:900; font-size:26px; margin-top:6px; }
      img{ width:100%; height:auto; border:1px solid #e5e7eb; border-radius:12px; }
      h3{ margin:0 0 10px; font-size:14px; }
      @media print{ .grid{ grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="head">
      <div>
        <div class="brand">CE Offline - Reporte</div>
        <div class="muted">Rango: <strong>${caption}</strong></div>
      </div>
      <div class="tag">Plomo + Naranja</div>
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-title">Temperatura Promedio</div>
        <div class="kpi-value">${tProm}</div>
        <div class="muted">${tExtra}</div>
      </div>
      <div class="kpi">
        <div class="kpi-title">Pernos Instalados</div>
        <div class="kpi-value">${pTot}</div>
        <div class="muted">${pExtra}</div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Resumen</h3>
      ${resumen}
    </div>

    <div class="grid">
      <div class="card">
        <h3>Slump (") promedio por Labor</h3>
        <img src="${chartSlumpUrl}" />
      </div>
      <div class="card">
        <h3>Presión de aire promedio por Labor</h3>
        <img src="${chartAireUrl}" />
      </div>
    </div>

    <script>
      setTimeout(()=>window.print(), 450);
    </script>
  </body>
  </html>
  `;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

/**********************
 * Online/offline badge
 **********************/
function initOfflineBadge(){
  const badge = $('#offlineBadge');
  const refresh = ()=>{
    const on = navigator.onLine;
    badge.textContent = on ? 'Online' : 'Offline';
    badge.classList.toggle('offline', !on);
    badge.classList.toggle('online', on);
  };
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  refresh();
}

/**********************
 * Inicio
 **********************/
(async function init(){
  await openDB();
  initTabs();
  initForms();
  initOfflineBadge();
  await refreshDBTables();
  await buildReport();
})();
