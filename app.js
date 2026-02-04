/***********************
 * CONFIG
 ***********************/
const LIMITS = {
  slump: { min: 8, max: 11 } // pulgadas OK (ajusta a tu criterio)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid() { return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function pad2(n){ return String(n).padStart(2,'0'); }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
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
function setStatus(el, msg, ms=3500){
  if(!el) return;
  el.textContent = msg;
  if(ms) setTimeout(() => { if(el.textContent === msg) el.textContent=''; }, ms);
}
function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function formatNum(v){
  if(v === null || v === undefined || Number.isNaN(v)) return '';
  if(Number.isInteger(v)) return String(v);
  const x = Math.round(v*100)/100;
  return x.toFixed(2).replace(/\.00$/,'');
}
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function truncate(s,n){ s=String(s ?? ''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function rangoCaption(desde, hasta){
  if(!desde && !hasta) return 'Todo el historial';
  if(desde && !hasta) return `Desde ${desde}`;
  if(!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
}

/***********************
 * Slump: pulgadas con fracciones
 ***********************/
function parseInchFraction(input){
  if(input === null || input === undefined) return null;
  let s = String(input).trim();
  if(!s) return null;

  s = s.replace(/["”″]/g,'').trim();
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

/***********************
 * IndexedDB
 ***********************/
const DB_NAME = 'ce_qc_db';
const DB_VER  = 3; // subimos versión para evolución de campos (sin perder data)
let db;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      const mkStore = (name) => {
        if(!_db.objectStoreNames.contains(name)){
          const s = _db.createObjectStore(name, { keyPath: 'id' });
          s.createIndex('fecha','fecha',{unique:false});
          s.createIndex('labor','labor',{unique:false});
        }
      };
      mkStore('slump');
      mkStore('resist');
      mkStore('pernos');
    };

    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}
function addRecord(store, rec){
  rec.id = uid();
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').add(rec);
    r.onsuccess = () => resolve(rec);
    r.onerror   = () => reject(r.error);
  });
}
function deleteRecord(store, id){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').delete(id);
    r.onsuccess = () => resolve(true);
    r.onerror   = () => reject(r.error);
  });
}
function clearStore(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').clear();
    r.onsuccess = () => resolve(true);
    r.onerror   = () => reject(r.error);
  });
}
function getAll(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror   = () => reject(r.error);
  });
}
async function getAllFiltered(store, desdeIso, hastaIso){
  const rows = await getAll(store);
  return rows
    .filter(r => inRange(r.fecha, desdeIso, hastaIso))
    .sort((a,b) => (a.fecha+(a.hora||'')).localeCompare(b.fecha+(b.hora||'')));
}

/***********************
 * Tabs
 ***********************/
function initTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      const name = btn.dataset.tab;
      $$('.panel').forEach(p=>p.classList.remove('active'));
      $(`#tab-${name}`).classList.add('active');

      if(name === 'bd') refreshDBTables();
      if(name === 'reporte') buildReport();
    });
  });
}

/***********************
 * UI rows (tabla → cards móvil)
 ***********************/
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

/***********************
 * Formularios
 ***********************/
function initForms(){
  // set fecha por defecto
  ['#formSlump input[name=fecha]','#formResist input[name=fecha]','#formPernos input[name=fecha]',
   '#fDesde','#fHasta','#rDesde','#rHasta'
  ].forEach(sel => { const el = $(sel); if(el) el.value = todayISO(); });

  // Pernos: habilitar cantidades
  const chkHel = $('#chkHel');
  const chkSw  = $('#chkSw');
  const cantHel = $('#cantHel');
  const cantSw  = $('#cantSw');

  const sync = () => {
    cantHel.disabled = !chkHel.checked;
    cantSw.disabled  = !chkSw.checked;
    if(!chkHel.checked) cantHel.value = 0;
    if(!chkSw.checked)  cantSw.value = 0;
  };
  chkHel.addEventListener('change', sync);
  chkSw.addEventListener('change', sync);

  // Slump submit (ARREGLADO)
  $('#formSlump').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    try {
      const parsed = parseInchFraction(fd.get('slumpIn'));
      if(!parsed){
        setStatus($('#slumpStatus'), '⚠️ Slump inválido. Ej: 9 3/4" o 10 1/4"', 4500);
        return;
      }

      const mixerNo = (fd.get('mixerNo') || '').trim();
      const hsOut   = fd.get('hsOut');     // HH:MM
      const horaSl  = fd.get('horaSlump'); // HH:MM
      const hll     = fd.get('hll');       // HH:MM

      if(!mixerNo){
        setStatus($('#slumpStatus'), '⚠️ Ingresa N° Mixer.', 3500);
        return;
      }

      const rec = {
        fecha: fd.get('fecha'),
        hora: horaSl,
        labor: (fd.get('labor') || '').trim(),
        nivel: (fd.get('nivel') || '').trim(),
        operador: (fd.get('operador') || '').trim(),

        slumpText: parsed.text,
        slumpIn: parsed.value,

        temp: Number(fd.get('temp')),
        presionAire: Number(fd.get('presionAire')),

        // nuevos campos
        mixerNo,
        hsOut,
        hll,

        // compatibilidad con versión anterior
        mixerHS: `${mixerNo}${hsOut ? ' / ' + hsOut : ''}`,

        obs: (fd.get('obs') || '').trim(),
        createdAt: new Date().toISOString()
      };

      await addRecord('slump', rec);

      setStatus($('#slumpStatus'), '✅ Registro guardado en Base de Datos.', 2800);

      // reset + set fecha
      e.target.reset();
      const d = e.target.querySelector('input[name=fecha]');
      if(d) d.value = todayISO();

      // refrescar vistas
      refreshDBTables();
      buildReport();

    } catch (err){
      console.error(err);
      setStatus($('#slumpStatus'), '❌ Error guardando. Revisa consola (F12).', 5000);
    }
  });

  // Resist submit
  $('#formResist').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    try {
      const rec = {
        fecha: fd.get('fecha'),
        hora: fd.get('hora'),
        labor: (fd.get('labor') || '').trim(),
        nivel: (fd.get('nivel') || '').trim(),
        edad: (fd.get('edad') || '').trim(),
        resistencia: Number(fd.get('resistencia')),
        obs: (fd.get('obs') || '').trim(),
        createdAt: new Date().toISOString()
      };

      await addRecord('resist', rec);
      setStatus($('#resistStatus'), '✅ Registro guardado.', 2500);
      e.target.reset();
      e.target.querySelector('input[name=fecha]').value = todayISO();
      refreshDBTables();
      buildReport();
    } catch(err){
      console.error(err);
      setStatus($('#resistStatus'), '❌ Error guardando.', 4500);
    }
  });

  // Pernos submit
  $('#formPernos').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    const hel = chkHel.checked ? Number(fd.get('cantHel') || 0) : 0;
    const sw  = chkSw.checked ? Number(fd.get('cantSw')  || 0) : 0;

    if((hel + sw) <= 0){
      setStatus($('#pernosStatus'), '⚠️ Marca un tipo e ingresa una cantidad.', 3500);
      return;
    }

    try{
      const rec = {
        fecha: fd.get('fecha'),
        hora: fd.get('hora'),
        labor: (fd.get('labor') || '').trim(),
        nivel: (fd.get('nivel') || '').trim(),
        helicoidal: hel,
        swellex: sw,
        obs: (fd.get('obs') || '').trim(),
        createdAt: new Date().toISOString()
      };

      await addRecord('pernos', rec);
      setStatus($('#pernosStatus'), '✅ Registro guardado.', 2500);

      e.target.reset();
      e.target.querySelector('input[name=fecha]').value = todayISO();
      chkHel.checked = false;
      chkSw.checked  = false;
      cantHel.value  = 0;
      cantSw.value   = 0;
      cantHel.disabled = true;
      cantSw.disabled  = true;

      refreshDBTables();
      buildReport();
    } catch(err){
      console.error(err);
      setStatus($('#pernosStatus'), '❌ Error guardando.', 4500);
    }
  });

  // Filtro BD
  $('#btnFiltrar').addEventListener('click', refreshDBTables);
  $('#btnLimpiarFiltro').addEventListener('click', ()=>{
    $('#fDesde').value = '';
    $('#fHasta').value = '';
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
    $('#rDesde').value = '';
    $('#rHasta').value = '';
    buildReport();
  });

  // PDF Reporte
  $('#btnPDF').addEventListener('click', exportReportPDF);

  // PDF BD (Registros)
  const btnBDPDF = $('#btnBDPDF');
  if(btnBDPDF) btnBDPDF.addEventListener('click', exportDBPDF);
}

/***********************
 * BD Tables
 ***********************/
async function refreshDBTables(){
  const desde = $('#fDesde').value || null;
  const hasta = $('#fHasta').value || null;

  const [sl, re, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('resist', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  // Slump
  const slb = $('#tblSlump tbody');
  slb.innerHTML = '';
  sl.forEach(r=>{
    const mixer = r.mixerNo || (r.mixerHS ? String(r.mixerHS).split('/')[0].trim() : '');
    const hsOut = r.hsOut   || (r.mixerHS ? (String(r.mixerHS).split('/')[1] || '').trim() : '');

    slb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora',  html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Slump', html: esc(r.slumpText || `${formatNum(r.slumpIn)}"` )},
      {label:'T°',    html: `${formatNum(r.temp)} °C`},
      {label:'Presión', html: formatNum(r.presionAire)},
      {label:'Mixer', html: esc(mixer)},
      {label:'H_Salida', html: esc(hsOut)},
      {label:'H_LL', html: esc(r.hll)},
      {label:'Acción', html: delBtn('slump', r.id)}
    ]));
  });

  // Resist
  const reb = $('#tblResist tbody');
  reb.innerHTML = '';
  re.forEach(r=>{
    reb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora',  html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Edad',  html: esc(r.edad)},
      {label:'MPa',   html: formatNum(r.resistencia)},
      {label:'Acción', html: delBtn('resist', r.id)}
    ]));
  });

  // Pernos
  const peb = $('#tblPernos tbody');
  peb.innerHTML = '';
  pe.forEach(r=>{
    peb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora',  html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Helicoidal', html: formatNum(r.helicoidal || 0)},
      {label:'Swellex',    html: formatNum(r.swellex || 0)},
      {label:'Acción', html: delBtn('pernos', r.id)}
    ]));
  });

  // Eliminar registros
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

/***********************
 * Reporte (charts + KPIs)
 ***********************/
function groupByLabor(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.labor || 'SIN LABOR').trim() || 'SIN LABOR';
    if(!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return m;
}

// Escala tipo matplotlib (1-2-5-10)
function niceMax(v){
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, exp);
  const nf = (f <= 1) ? 1 : (f <= 2) ? 2 : (f <= 5) ? 5 : 10;
  return nf * Math.pow(10, exp);
}

// Lollipop PRO (estilo python)
function drawLollipopChart(canvas, labels, values, unit, caption, opts = {}){
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);

  const BG  = (css.getPropertyValue('--surface').trim() || '#fff');
  const TXT = (css.getPropertyValue('--text').trim() || '#111827');
  const MUT = (css.getPropertyValue('--muted').trim() || '#6B7280');
  const ACC = (css.getPropertyValue('--accent').trim() || '#F97316');
  const DNG = (css.getPropertyValue('--danger').trim() || '#EF4444');

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  ctx.fillStyle = BG;
  ctx.fillRect(0,0,W,H);

  const maxLabelLen = labels.reduce((m,s)=>Math.max(m, String(s).length), 0);
  const padL = Math.min(300, 120 + maxLabelLen * 6.2);
  const padR = 34, padT = 70, padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  ctx.textAlign = 'left';
  ctx.fillStyle = TXT;
  ctx.font = '900 14px system-ui';
  ctx.fillText(opts.title || 'Lollipop', 16, 28);

  ctx.fillStyle = MUT;
  ctx.font = '12px system-ui';
  ctx.fillText(caption || '', 16, 50);

  const n = Math.max(1, labels.length);
  const rowH = plotH / n;

  const vals = values.map(v => Number(v) || 0);
  const rawMax = Math.max(1, ...vals);
  const maxV = niceMax(rawMax);

  // Banda objetivo (slump)
  if (typeof opts.bandMin === 'number' && typeof opts.bandMax === 'number') {
    const xMin = padL + (opts.bandMin / maxV) * plotW;
    const xMax = padL + (opts.bandMax / maxV) * plotW;

    ctx.fillStyle = 'rgba(34,197,94,.10)';
    ctx.fillRect(xMin, padT, Math.max(0, xMax - xMin), plotH);

    ctx.strokeStyle = 'rgba(34,197,94,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xMin, padT); ctx.lineTo(xMin, padT + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xMax, padT); ctx.lineTo(xMax, padT + plotH); ctx.stroke();

    ctx.fillStyle = 'rgba(21,128,61,.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(`Objetivo: ${formatNum(opts.bandMin)}–${formatNum(opts.bandMax)}${unit}`, padL, padT - 10);
  }

  // Grid + ticks
  const ticks = 5;
  ctx.strokeStyle = 'rgba(17,24,39,.10)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3,4]);

  for (let i=0;i<=ticks;i++){
    const x = padL + plotW*(i/ticks);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = MUT;
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    const tv = maxV * (i/ticks);
    ctx.fillText(`${formatNum(tv)}${unit}`, x, padT + plotH + 34);
    ctx.setLineDash([3,4]);
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(17,24,39,.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  for (let i=0;i<n;i++){
    const y = padT + rowH*i + rowH/2;
    const v = vals[i];
    const x0 = padL;
    const x1 = padL + (v/maxV)*plotW;

    ctx.textAlign = 'right';
    ctx.fillStyle = TXT;
    ctx.font = '12px system-ui';
    ctx.fillText(truncate(labels[i], 28), padL - 12, y + 4);

    ctx.strokeStyle = 'rgba(249,115,22,.50)';
    ctx.lineWidth = 3;
    ctx.begin¡Perfecto, Cesar! **Opción B** (panel lateral de horas) ✅.  
Y lo que describes (botón **Guardar** no guarda **ni alimenta Reporte**) casi siempre pasa por **2 causas**:

1) **Cambiaste el HTML (names/ids) pero el JS sigue leyendo los nombres antiguos** → `FormData` devuelve `null` y el registro no se crea/guarda. Tu `app.js` depende de `#formSlump` y de `name="horaSlump"`, `name="slumpIn"`, etc. [1](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/manifest%20(1).json)[2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html).html).html)  
2) **Service Worker** te está sirviendo un `app.js` viejo cacheado → tú ves el HTML nuevo, pero corre JS viejo y nada coincide. Además tu sitio registra `sw.js`. [2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html).html)  

Para que ya no estés “cargando cada vez”, aquí te dejo **EL CÓ*EL CÓDIGO COMPLETO** (listo para reemplazar en tu GitHub) con:

✅ Opción B (horas aoras a la derecha)  
✅ Slump: **N° Mixer Mixer** separado + **Hora de salida (HS)** separado  
✅ Guardado 100% en IndexedDB y se refleja en Base de Datos y Reporte  
✅ Reporte con **Lollipop charts “estilo Python”** (ticks, grilla suave, escala nice, banda objetivo slump min–max, puntos verde/rorde/rojo)  
✅ Cards del reporte “premium”  
✅ Botón **Exportar PDF** en Reporteeporte **y** en Registros (BD)  
✅ `sw.js` mejorado para que no te “atrase” te “atrase” cambios (cache versionado)

> **IMPORTANTE (para tu problema actual)**: después de pegar estos archivos, haz **Hard**Hard Reload** (Ctrl+Shift+R) y si sigue raro: **Application → Service Workers → Unregister** y “Clear site data”. Esto es clave cuando hay SW y cambios frecuentes. [2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html).html).html)  

---

# ✅ 1) `index.html` (COM` (COMPLETO)

> Reemplaza tu `index.html` por este:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CEtle>CE - Control de Calidad (Offline)</title>

  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#F97316"/>
  <link rel="stylesheet" href="styles.css" />
</head>

<body>
<header class="app-header">
  <div class="brand">
    <div class="logo">CE</div>
    <div class="brand-text">
      <div class="title">Control de Calidad - Sostenimiento</div>
      <div class="subtitle">Offline • Datos guardados en el dispositivo</div>
    </div>
  </div>
</header>

<nav class="tabs" role="tablist" aria-label="Pestañas">
  <button class="tab active" data-tab="slump" role="tab" aria-selected="true">1. Slump y T°</button>
  <button class="tab" data-tab="resist" role="tab" aria-selected="false">2. Resistencias</button>
  <button class="tab" data-tab="pernos" role="tab" aria-selected="false">3. Pernos</button>
  <button class="tab" data-tab="bd" role="tab" aria-selected="false">4. Registros</button>
  <button class="tab" data-tab="reporte" role="tab" aria-selected="false">5. Reporte</button>
</nav>

<main class="container">

  <!-- TAB 1 -->
  <section id="tab-slump" class="panel active" role="tabpanel">
    <div class="panel-head">
      <h2>Slump y Temperatura</h2>
      <p class="muted">Registro de control (Slumpal (Opción B).</p>
    </div>

    <form id="formSlump" class="card">
      <div class="slump-layout">

        <!-- Columna izquierda: datos -->
        <div class="slump-main">
          <div class="grid grid-2">
            <div>
              <label>Fecha</label>
              <input type="date" name="fecha" required />
            </div>
            <div>
              <label>Nivel</label>
              <input type="text" name="nivel" placeholder="Ej. 520" required />
            </div>
          </div>

          <div class="grid grid-2 mt-12">
            <div>
              <label>Labor</label>
              <input type="text" name="labor" placeholder="Ej. NV-520 Rampa 3" required />
            </div>
            <div>
              <label>N° Mixer</label>
              <input type="text" name="mixerNo" placeholder="Ej. Mixer 07" required />
            </div>
          </div>

          <div class="grid grid-3 mt-12">
            <div>
              <     <label>Slump (pulgadas)</label>
              <input type="text" name="slumpIn" placeholder='Ej. 9 3/4" | 10 1/4" | 7/8"' required />
              <small class="hint">Acepta: 9 3/4", 10 1/4", 7/8", 9.75"</small>
            </div>
            <div>
                    <label>Temperatura (°C)</label>
              <input type="number" name="temp" step="0.1" placeholder="Ej. 18.5" required />
            </div>
            <div>
              <label>Presión de aire</label>
              <input type="number" name="presionAire" step="0.1" placeholder="Ej. 6.5" required />
            </div>
          </div>

          <div class="mt-12">
            <label>Observaciones</label>
            <input type="text" name="obs" placeholder="Opcional" />
          </div>
        </div>

        <!-- Columna derecha: panel horas -->
        <aside class="time-panel">
          <div class="time-panel-head">
            <div class="time-badge">Horas</div>
            <div class="muted small">Ordenadas para control operativo</div>
          </div>

          <div class="time-stack">
            <div>
              <label>Hora del Slump</label>
              <input type="time" name="horaSlump" required />
            </div>
            <div>
              <label>label>Hora de salida (HS)</label>
              <input type="time" name="hsOut" required />
            </div>
            <div>
              <label<label>Hora llegada (H_LL)</label>
              <input type="time" name="hll" required />
            </div>
          </div>
        </aside>

      </div>

      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <button class="btn btn-secondary" type="reset">Limpiar</button>
      </div>

      <div class="inline-status" id="slumpStatus" aria-live="polite"></div>
    </form>
  </section>

  <!-- TAB 2 -->
  <section id="tab-resist" class="panel" role="tabpanel">
    <div class="panel-head">
      <h2>Resistencias Iniciales</h2>
      <p class="muted">uted">Registra resistencias tempranas (edad + MPa).</p>
    </div>

    <form id="formResist" class="card">
      <div class="grid">
        <div>
          <label>Fecha</label>
          <input type="date" name="fecha" required />
        </div>
        <div>
          <label>Hora</label>
          <input type="time" name="hora" required />
        </div>
        <div>
          <label>Labor</label>
          <input type="text" name="labor" required />
        </div>
        <div>
          <label>Nivel</label>
          <input type="text" name="nivel" required />
        </div>
        <div>
          <label>label>Edad (min / h)</label>
          <input type="text" name="edad" placeholder="Ej. 30 min, 1 h, 3 h" required />
        </div>
        <     <div>
          <label>Resistencia (MPa)</label>
          <input type="number" name="resistencia" step="0.01" min="0" placeholder="Ej. 1.25" required />
        </div>
        <div class="col-span-2">
          <label>Observaciones</label>
          <input type="text" name="obs" placeholder="Opcional" />
        </div>
      </div>

      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <button class="btn btn-secondary" type="reset">Limpiar</button>
      </div>

      <div class="inline-status" id="resistStatus" aria-live="polite"></div>
    </form>
  </section>

  <!-- TAB 3 -->
  <section id="tab-pernos" class="panel" role="tabpanel">
    <div class="panel-head">
      <h2>Instalación de Pernos</h2>
      <p class="muted">Registra tipo y cantidad instalada por labor.</p>
    </div>

    <form id="formPernos" class="card">
      <div class="grid">
        <div>
          <label>Fecha</label>
          <input type="date" name="fecha" required />
        </div>
        <div>
          <label>Hora</label>
          <input type="time" name="hora" required />
        </div>
        <div>
          <label>Labor</label>
          <input type="text" name="labor" required />
        </div>
        <div>
          <label>Nivel</label>
          <input type="text" name="nivel" required />
        </div>

        <div class="col-span-2">
          <label>Tipo de perno</label>
          <div class="checks">
            <label class="check"><input type="checkbox" id="chkHel" /> P. Helicoidal</label>
            <label class="check"><input type="checkbox" id="chkSw" /> P. Swellex</label>
          </div>
          <small class="hint">Marca uno o ambos e ingresa cantidades.</small>
        </div>

        <div>
          <label>Cantidad Helicoidal</label>
          <input type="number" name="cantHel" id="cantHel" min="0" step="1" value="0" disabled />
        </div>
        <div>
          <label>Cantidad Swellex</label>
          <input type="number" name="cantSw" id="cantSw" min="0" step="1" value="0" disabled />
        </div>

        <div class="col-span-2">
          <label>Observaciones</label>
          <input type="text" name="obs" placeholder="Opcional" />
        </div>
      </div>

      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <button class="btn btn-secondary" type="reset">Limpiar</button>
      </div>

      <div class="inline-status" id="pernosStatus" aria-live="polite"></div>
    </form>
  </section>

  <!-- TAB 4 -->
  <section id="tab-bd" class="panel" role="tabpanel">
    <div class="panel-head">
      <h2>Registros (pors (por fecha)</h2>
      <p class="muted">Filtra por rango y gestiona registros. Exporta PDF de tablas.</p>
    </div>

    <div class="card">
      <div class="grid">
        <div>
          <label>Desde</label>
          <input type="date" id="fDesde" />
        </div>
        <div>
          <label>Hasta</label>
          <input type="date" id="fHasta" />
        </div>
        <div class="col-span-2 actions left">
          <button id="btnFiltrar" class="btn" type="button">Filtrar</button>
          <button id="btnLimpiarFiltro" class="btn btn-secondary" type="button">Ver todo</button>
          <button id="btnBDPDF" class="btn btn-secondary" type="button">Exportar PDF</button>
          <button id="btnBorrarTodo" class="btn btn-danger" type="button">Borrar TODO</button>
        </div>
      </div>
      <p class="hint">Recomendación: Exporta antes de borrar toda la base de datos.</p>
    </div>

    <div class="card">
      <h3>Slump y T°</h3>
      <div class="table-wrap">
        <table class="table" id="tblSlump">
          <thead>
            <tr>
              <th>Fecha</th><th>Hora</th><th>Labor</th><th>Nivel</th>
              <th>Slump</th><th>T°</th><th>Presión</th><th>Mixer</th><th>H_Salida</th><th>H_LL</th><th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Resistencias</h3>
      <div class="table-wrap">
        <table class="table" id="tblResist">
          <thead>
            <tr>
              <th>Fecha</th><th>Hora</th><th>Labor</th><th>Nivel</th><th>Edad</th><th>MPa</th><th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Pernos</h3>
      <div class="table-wrap">
        <table class="table" id="tblPernos">
          <thead>
            <tr>
              <th>Fecha</th><th>Hora</th><th>Labor</th><th>Nivel</th><th>Helicoidal</th><th>Swellex</th><th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- TAB 5 -->
  <section id="tab-reporte" class="panel" role="tabpanel">
    <div class="panel"panel-head">
      <h2>Reporte (WhatsApp / PDF)</h2>
      <p class="muted">Lollipop charts estilo Python:ython: Slump (") y Presión. Cards premium + banda objetivo.</p>
    </div>

    <div class="card">
      <div class="grid">
        <div>
          <label>Desde</label>
          <input type="date" id="rDesde" />
        </div>
        <div>
          <label>Hasta</label>
          <input type="date" id="rHasta" />
        </div>
        <div class="col-span-2 actions left">
          <button id="btnReporte" class="btn" type="button">Actualizar</button>
          <button id="btnReporteTodo" class="btn btn-secondary" type="button">Todo</button>
          <button id="btnPDF" class="btn btn-secondary" type="button">Exportar PDF</button>
        </div>
      </div>

      <div class="kpis-2">
        <div class="kpi-big kpi-premium">
          <div class="kpi-title">Temperatura Promedio</div>
          <div class="kpi-value" id="kpiTempProm">—</div>
          <div class="kpi-sub muted" id="kpiTempExtra">Min — / Max —</div>
        </div>

        <div class="kpi-big kpi-premium">
          <div class="kpi-title">Pernos Instalados</div>
          <div class="kpi-value" id="kpiPernosTotal">0</div>
          <div class="kpi-sub muted" id="kpiPernosExtra">Helicoidal 0 / Swellex 0</div>
        </div>
      </div>

      <p class="hint">
        En el celular: Exportar PDF abre impresión → “Guardar como PDF” → Compartir por WhatsApp.
      </p>
    </div>

    <div class="grid-2">
      <div class="card chart-card">
        <h3   <h3>Slump (") promedio por Labor</h3>
        <canvas id="chartSlump" width="900" height="560"></canvas>
      </div>
      <div class="card chart-card">
        <h3>Presión de aire promedio por Labor</h3>
        <canvas id="chartAire" width="900" height="560"></canvas>
      </div>
    </div>

    <div class="card">
      <h3>Resumen</h3>
      <div id="resumenReporte" class="muted"></div>
    </div>
  </section>

</main>

<footer class="footer">
  <span>CE Offline • IndexedDB</span>
  <span id="offlineBadge" class="badge">Online</span>
</footer>

<script src="app.js"></script>
<script>
rviceWorker' in navigator) {
   gator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
  }
</script>
</body>
</html>
