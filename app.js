// CE - Control de Calidad (Offline)
// app.js (patched): Wiring completo de botones + formularios + tablas + reportes

/**********************
 * CONFIG
 **********************/
const LIMITS = {
  slump: { min: 8, max: 11 } // pulgadas
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid(){ return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function pad2(n){ return String(n).padStart(2,'0'); }
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function nowHHMM(){ const d=new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function setStatus(el, msg, ms=2500){
  if(!el) return;
  el.textContent = msg;
  if(ms){
    setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; }, ms);
  }
}

function parseDateISO(iso){
  if(!iso) return null;
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}

function inRange(dateIso, desdeIso, hastaIso){
  if(!desdeIso && !hastaIso) return true;
  const x  = parseDateISO(dateIso);
  const d0 = desdeIso ? parseDateISO(desdeIso) : null;
  const d1 = hastaIso ? parseDateISO(hastaIso) : null;
  if(d0 && x < d0) return false;
  if(d1 && x > d1) return false;
  return true;
}

function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function formatNum(v){
  if(v === null || v === undefined || Number.isNaN(v)) return '';
  if(Number.isInteger(v)) return String(v);
  return (Math.round(v*100)/100).toFixed(2).replace(/\.00$/,'');
}

function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
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
  s = s.replace(/[\"”″]/g,'').trim();
  s = s.replace(/\s+/g,' ');

  // decimal
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
    frac  = parts[1];
    if(Number.isNaN(whole)) return null;
  } else return null;

  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if(!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if(!den) return null;
  const value = whole + (num/den);
  const text  = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + '"';
  return { value, text };
}

/**********************
 * IndexedDB
 **********************/
const DB_NAME = 'ce_qc_db';
const DB_VER  = 3;
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const dbx = e.target.result;
      const mkStore = (name)=>{
        if(!dbx.objectStoreNames.contains(name)){
          const s = dbx.createObjectStore(name, { keyPath:'id' });
          s.createIndex('fecha','fecha',{unique:false});
          s.createIndex('labor','labor',{unique:false});
        }
      };
      mkStore('slump');
      mkStore('resist');
      mkStore('pernos');
    };
    req.onsuccess = ()=>{ db=req.result; resolve(db); };
    req.onerror   = ()=> reject(req.error);
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
    r.onerror   = ()=> reject(r.error);
  });
}

function deleteRecord(store, id){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').delete(id);
    r.onsuccess = ()=> resolve(true);
    r.onerror   = ()=> reject(r.error);
  });
}

function clearStore(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store,'readwrite').clear();
    r.onsuccess = ()=> resolve(true);
    r.onerror   = ()=> reject(r.error);
  });
}

function getAll(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store).getAll();
    r.onsuccess = ()=> resolve(r.result || []);
    r.onerror   = ()=> reject(r.error);
  });
}

/**********************
 * UI Helpers
 **********************/
function toast(msg, type='ok', ms=2400){
  let el = $('#toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast show ${type}`;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.className = 'toast'; }, ms);
}

function setOfflineBadge(){
  const b = $('#offlineBadge');
  if(!b) return;
  const paint = ()=>{
    const online = navigator.onLine;
    b.textContent = online ? 'Online' : 'Offline';
    b.classList.toggle('online', online);
    b.classList.toggle('offline', !online);
  };
  window.addEventListener('online',  ()=>{ paint(); toast('Conexión restablecida ✅','ok'); });
  window.addEventListener('offline', ()=>{ paint(); toast('Sin conexión — modo offline','warn'); });
  paint();
}

function showTab(name){
  $$('.tab').forEach(t=>{
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.panel').forEach(p=>{
    const on = p.id === `tab-${name}`;
    p.classList.toggle('active', on);
    if(on){
      p.classList.add('panel-anim');
      setTimeout(()=>p.classList.remove('panel-anim'), 220);
    }
  });
  localStorage.setItem('ce_last_tab', name);
}

function btnMini(label='🗑'){
  return `<button type="button" class="btn-mini" title="Eliminar">${label}</button>`;
}

/**********************
 * Render tables (BD)
 **********************/
async function renderBD(desdeIso='', hastaIso=''){
  const [slump, resist, pernos] = await Promise.all([
    getAll('slump'), getAll('resist'), getAll('pernos')
  ]);

  const f = (arr)=> arr
    .filter(r=> inRange(r.fecha, desdeIso, hastaIso))
    .sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||'') || (b.hora||'').localeCompare(a.hora||''));

  renderTblSlump(f(slump));
  renderTblResist(f(resist));
  renderTblPernos(f(pernos));
}

function renderEmptyRow(tbody, cols, msg='Sin registros'){
  tbody.innerHTML = `<tr><td colspan="${cols}" class="muted">${esc(msg)}</td></tr>`;
}

function renderTblSlump(rows){
  const tbody = $('#tblSlump tbody');
  if(!tbody) return;
  if(!rows.length) return renderEmptyRow(tbody, 11);

  tbody.innerHTML = rows.map(r=>{
    const del = `<button type="button" class="btn-mini" data-del data-store="slump" data-id="${esc(r.id)}">🗑</button>`;
    return `
      <tr>
        <td data-label="Fecha"><span class="cell-right">${esc(r.fecha||'')}</span></td>
        <td data-label="Hora"><span class="cell-right">${esc(r.horaSlump||'')}</span></td>
        <td data-label="Labor">${esc(r.labor||'')}</td>
        <td data-label="Nivel"><span class="cell-right">${esc(r.nivel||'')}</span></td>
        <td data-label="Slump"><span class="cell-right">${esc(r.slumpText||'')}</span></td>
        <td data-label="T°"><span class="cell-right">${esc(formatNum(r.temp))}</span></td>
        <td data-label="Presión"><span class="cell-right">${esc(formatNum(r.presionAire))}</span></td>
        <td data-label="Mixer"><span class="cell-right">${esc(r.mixerNo||'')}</span></td>
        <td data-label="H_Salida"><span class="cell-right">${esc(r.hsOut||'')}</span></td>
        <td data-label="H_LL"><span class="cell-right">${esc(r.hll||'')}</span></td>
        <td data-label="">${del}</td>
      </tr>`;
  }).join('');
}

function renderTblResist(rows){
  const tbody = $('#tblResist tbody');
  if(!tbody) return;
  if(!rows.length) return renderEmptyRow(tbody, 7);

  tbody.innerHTML = rows.map(r=>{
    const del = `<button type="button" class="btn-mini" data-del data-store="resist" data-id="${esc(r.id)}">🗑</button>`;
    return `
      <tr>
        <td data-label="Fecha"><span class="cell-right">${esc(r.fecha||'')}</span></td>
        <td data-label="Hora"><span class="cell-right">${esc(r.hora||'')}</span></td>
        <td data-label="Labor">${esc(r.labor||'')}</td>
        <td data-label="Nivel"><span class="cell-right">${esc(r.nivel||'')}</span></td>
        <td data-label="Edad"><span class="cell-right">${esc(r.edad||'')}</span></td>
        <td data-label="MPa"><span class="cell-right">${esc(formatNum(r.resistencia))}</span></td>
        <td data-label="">${del}</td>
      </tr>`;
  }).join('');
}

function renderTblPernos(rows){
  const tbody = $('#tblPernos tbody');
  if(!tbody) return;
  if(!rows.length) return renderEmptyRow(tbody, 7);

  tbody.innerHTML = rows.map(r=>{
    const del = `<button type="button" class="btn-mini" data-del data-store="pernos" data-id="${esc(r.id)}">🗑</button>`;
    return `
      <tr>
        <td data-label="Fecha"><span class="cell-right">${esc(r.fecha||'')}</span></td>
        <td data-label="Hora"><span class="cell-right">${esc(r.hora||'')}</span></td>
        <td data-label="Labor">${esc(r.labor||'')}</td>
        <td data-label="Nivel"><span class="cell-right">${esc(r.nivel||'')}</span></td>
        <td data-label="Helicoidal"><span class="cell-right">${esc(String(r.cantHel ?? 0))}</span></td>
        <td data-label="Swellex"><span class="cell-right">${esc(String(r.cantSw ?? 0))}</span></td>
        <td data-label="">${del}</td>
      </tr>`;
  }).join('');
}

/**********************
 * Report (JS fallback)
 **********************/
function groupMean(rows, keyGroup, keyValue){
  const m = new Map();
  for(const r of rows){
    const k = (r[keyGroup] ?? '').trim() || '—';
    const v = Number(r[keyValue]);
    if(Number.isNaN(v)) continue;
    if(!m.has(k)) m.set(k, {k, sum:0, n:0});
    const o = m.get(k);
    o.sum += v; o.n += 1;
  }
  const out = [...m.values()].map(o=>({ labor:o.k, value:o.n? o.sum/o.n : 0, n:o.n }));
  out.sort((a,b)=> a.value-b.value);
  return out;
}

function drawLollipop(canvas, items, title=''){ // items: [{labor,value}]
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // background
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);

  if(!items.length){
    ctx.fillStyle = '#6B7280';
    ctx.font = '700 22px system-ui';
    ctx.fillText('Sin datos en el rango seleccionado', 40, 80);
    return;
  }

  const top = items.slice(-12); // top 12
  const labels = top.map(d=>d.labor);
  const values = top.map(d=>d.value);

  const margin = {l: 220, r: 50, t: 40, b: 50};
  const innerW = W - margin.l - margin.r;
  const innerH = H - margin.t - margin.b;
  const maxV = Math.max(...values, 1);

  // axes
  ctx.strokeStyle = 'rgba(17,24,39,.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, H - margin.b);
  ctx.lineTo(W - margin.r, H - margin.b);
  ctx.stroke();

  // title
  ctx.fillStyle = '#111827';
  ctx.font = '700 18px system-ui';
  if(title) ctx.fillText(title, margin.l, 26);

  const n = labels.length;
  const stepY = innerH / Math.max(1, n-1);

  for(let i=0;i<n;i++){
    const y = margin.t + i*stepY;
    const v = values[i];
    const x = margin.l + (v/maxV)*innerW;

    // label
    ctx.fillStyle = '#111827';
    ctx.font = '700 16px system-ui';
    const lab = labels[i].length>22 ? labels[i].slice(0,21)+'…' : labels[i];
    ctx.fillText(lab, 20, y+6);

    // line
    ctx.strokeStyle = 'rgba(251,146,60,.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(x, y);
    ctx.stroke();

    // dot
    ctx.fillStyle = '#F97316';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI*2);
    ctx.fill();

    // value
    ctx.fillStyle = '#374151';
    ctx.font = '700 14px system-ui';
    ctx.fillText(formatNum(v), x+12, y+5);
  }
}

async function updateReport(desdeIso='', hastaIso=''){
  const [slump, pernos] = await Promise.all([getAll('slump'), getAll('pernos')]);

  const slumpF = slump.filter(r=> inRange(r.fecha, desdeIso, hastaIso));
  const pernosF = pernos.filter(r=> inRange(r.fecha, desdeIso, hastaIso));

  // KPIs
  const temps = slumpF.map(r=>Number(r.temp)).filter(v=>!Number.isNaN(v));
  const tProm = mean(temps);
  const tMin  = temps.length ? Math.min(...temps) : null;
  const tMax  = temps.length ? Math.max(...temps) : null;

  const hel = pernosF.reduce((a,r)=>a + (Number(r.cantHel)||0), 0);
  const sw  = pernosF.reduce((a,r)=>a + (Number(r.cantSw)||0), 0);

  const elProm = $('#kpiTempProm');
  const elExtra= $('#kpiTempExtra');
  if(elProm) elProm.textContent = temps.length ? `${formatNum(tProm)} °C` : '—';
  if(elExtra) elExtra.textContent = temps.length ? `Min ${formatNum(tMin)} / Max ${formatNum(tMax)}` : 'Min — / Max —';

  const elPT = $('#kpiPernosTotal');
  const elPE = $('#kpiPernosExtra');
  if(elPT) elPT.textContent = String(Math.round(hel+sw));
  if(elPE) elPE.textContent = `Helicoidal ${Math.round(hel)} / Swellex ${Math.round(sw)}`;

  // charts (JS fallback)
  const bySlump = groupMean(slumpF, 'labor', 'slumpValue');
  const byAire  = groupMean(slumpF, 'labor', 'presionAire');
  drawLollipop($('#chartSlump'), bySlump, 'Slump promedio por labor');
  drawLollipop($('#chartAire'),  byAire,  'Presión de aire promedio por labor');

  const resumen = $('#resumenReporte');
  if(resumen){
    resumen.innerHTML = `
      <div><b>Rango:</b> ${esc(rangoCaption(desdeIso,hastaIso))}</div>
      <div><b>Registros slump:</b> ${slumpF.length}</div>
      <div><b>Registros pernos:</b> ${pernosF.length}</div>
    `;
  }
}

/**********************
 * Init & Wiring
 **********************/
function initDefaults(){
  // fechas por defecto en formularios
  const d = todayISO();
  $('#formSlump input[name="fecha"]')?.setAttribute('value', d);
  $('#formResist input[name="fecha"]')?.setAttribute('value', d);
  $('#formPernos input[name="fecha"]')?.setAttribute('value', d);

  // horas por defecto
  $('#formSlump input[name="horaSlump"]')?.setAttribute('value', nowHHMM());
  $('#formResist input[name="hora"]')?.setAttribute('value', nowHHMM());
  $('#formPernos input[name="hora"]')?.setAttribute('value', nowHHMM());
}

function wirePernosChecks(){
  const chkHel = $('#chkHel');
  const chkSw  = $('#chkSw');
  const inHel  = $('#cantHel');
  const inSw   = $('#cantSw');

  function sync(){
    const helOn = !!chkHel?.checked;
    const swOn  = !!chkSw?.checked;

    if(inHel){
      inHel.disabled = !helOn;
      if(!helOn) inHel.value = 0;
    }
    if(inSw){
      inSw.disabled = !swOn;
      if(!swOn) inSw.value = 0;
    }
  }

  chkHel?.addEventListener('change', sync);
  chkSw?.addEventListener('change', sync);
  sync();
}

function wireTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=> showTab(btn.dataset.tab));
  });
  const last = localStorage.getItem('ce_last_tab');
  if(last) showTab(last);
}

function wireDeletes(){
  // delegación para botones eliminar en tablas
  document.addEventListener('click', async (e)=>{
    const b = e.target.closest('[data-del]');
    if(!b) return;
    const store = b.getAttribute('data-store');
    const id    = b.getAttribute('data-id');
    if(!store || !id) return;

    if(!confirm('¿Eliminar este registro?')) return;
    await deleteRecord(store, id);

    // re-render BD y reporte
    const desde = $('#fDesde')?.value || '';
    const hasta = $('#fHasta')?.value || '';
    await renderBD(desde, hasta);

    const rDesde = $('#rDesde')?.value || '';
    const rHasta = $('#rHasta')?.value || '';
    await updateReport(rDesde, rHasta);

    toast('Registro eliminado', 'ok');
  });
}

function wireForms(){
  // Slump
  const fSlump = $('#formSlump');
  const stSlump= $('#slumpStatus');
  fSlump?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fSlump);

    const parsed = parseInchFraction(fd.get('slumpIn'));
    if(!parsed){
      setStatus(stSlump, 'Slump inválido. Ej: 9 3/4" o 9.75"', 3500);
      toast('Slump inválido', 'err');
      return;
    }
    const slumpValue = parsed.value;
    const ok = slumpValue >= LIMITS.slump.min && slumpValue <= LIMITS.slump.max;

    const rec = {
      fecha: fd.get('fecha'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      operador: String(fd.get('operador')||'').trim(),
      slumpIn: String(fd.get('slumpIn')||'').trim(),
      slumpValue,
      slumpText: parsed.text,
      temp: Number(fd.get('temp')),
      presionAire: Number(fd.get('presionAire')),
      mixerNo: String(fd.get('mixerNo')||'').trim(),
      obs: String(fd.get('obs')||'').trim(),
      horaSlump: fd.get('horaSlump'),
      hsOut: fd.get('hsOut'),
      hll: fd.get('hll'),
      slumpOk: ok
    };

    await addRecord('slump', rec);
    setStatus(stSlump, ok ? 'Guardado ✅' : `Guardado ⚠️ (Fuera de rango ${LIMITS.slump.min}-${LIMITS.slump.max}")`, 3500);
    toast(ok ? 'Guardado ✅' : 'Guardado (Slump fuera de rango)', ok ? 'ok' : 'warn');

    fSlump.reset();
    // reponer defaults
    fSlump.querySelector('input[name="fecha"]').value = todayISO();
    fSlump.querySelector('input[name="horaSlump"]').value = nowHHMM();
    fSlump.querySelector('input[name="hsOut"]').value = '';
    fSlump.querySelector('input[name="hll"]').value = '';

    // refrescar BD (si está filtrado, respeta filtro)
    await renderBD($('#fDesde')?.value||'', $('#fHasta')?.value||'');
  });

  // Resist
  const fRes = $('#formResist');
  const stRes= $('#resistStatus');
  fRes?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fRes);
    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      edad: String(fd.get('edad')||'').trim(),
      resistencia: Number(fd.get('resistencia')),
      obs: String(fd.get('obs')||'').trim()
    };
    await addRecord('resist', rec);
    setStatus(stRes, 'Guardado ✅', 3000);
    toast('Resistencia guardada ✅','ok');

    fRes.reset();
    fRes.querySelector('input[name="fecha"]').value = todayISO();
    fRes.querySelector('input[name="hora"]').value = nowHHMM();

    await renderBD($('#fDesde')?.value||'', $('#fHasta')?.value||'');
  });

  // Pernos
  const fPer = $('#formPernos');
  const stPer= $('#pernosStatus');
  fPer?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fPer);
    const helOn = $('#chkHel')?.checked;
    const swOn  = $('#chkSw')?.checked;

    if(!helOn && !swOn){
      setStatus(stPer, 'Selecciona al menos un tipo de perno.', 3500);
      toast('Falta seleccionar tipo de perno','err');
      return;
    }

    const cantHel = helOn ? Number(fd.get('cantHel')||0) : 0;
    const cantSw  = swOn  ? Number(fd.get('cantSw')||0)  : 0;

    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      cantHel,
      cantSw,
      obs: String(fd.get('obs')||'').trim()
    };

    await addRecord('pernos', rec);
    setStatus(stPer, 'Guardado ✅', 3000);
    toast('Pernos registrados ✅','ok');

    fPer.reset();
    fPer.querySelector('input[name="fecha"]').value = todayISO();
    fPer.querySelector('input[name="hora"]').value = nowHHMM();

    // reset checks
    $('#chkHel').checked = false;
    $('#chkSw').checked  = false;
    wirePernosChecks();

    await renderBD($('#fDesde')?.value||'', $('#fHasta')?.value||'');
    await updateReport($('#rDesde')?.value||'', $('#rHasta')?.value||'');
  });
}

function wireBDButtons(){
  $('#btnFiltrar')?.addEventListener('click', async ()=>{
    await renderBD($('#fDesde')?.value||'', $('#fHasta')?.value||'');
    toast('Filtro aplicado','ok');
  });

  $('#btnLimpiarFiltro')?.addEventListener('click', async ()=>{
    if($('#fDesde')) $('#fDesde').value = '';
    if($('#fHasta')) $('#fHasta').value = '';
    await renderBD('', '');
    toast('Mostrando todo','ok');
  });

  $('#btnBDPDF')?.addEventListener('click', ()=>{
    window.print();
  });

  $('#btnBorrarTodo')?.addEventListener('click', async ()=>{
    const ok = confirm('¿Borrar TODA la base de datos? Esta acción no se puede deshacer.');
    if(!ok) return;
    const ok2 = confirm('Confirmación final: ¿Seguro que deseas borrar TODO?');
    if(!ok2) return;

    await Promise.all([clearStore('slump'), clearStore('resist'), clearStore('pernos')]);
    await renderBD('', '');
    await updateReport('', '');
    toast('Base de datos borrada','warn');
  });
}

function wireReportButtons(){
  $('#btnReporte')?.addEventListener('click', async ()=>{
    const desde = $('#rDesde')?.value || '';
    const hasta = $('#rHasta')?.value || '';

    // si existe PyScript (más adelante), úsalo; si no, fallback JS
    if(typeof window.runPythonReport === 'function'){
      try{
        await window.runPythonReport(desde, hasta);
      }catch(err){
        console.warn(err);
        await updateReport(desde, hasta);
      }
    }else{
      await updateReport(desde, hasta);
    }
    toast('Reporte actualizado','ok');
  });

  $('#btnReporteTodo')?.addEventListener('click', async ()=>{
    if($('#rDesde')) $('#rDesde').value = '';
    if($('#rHasta')) $('#rHasta').value = '';

    if(typeof window.runPythonReport === 'function'){
      try{ await window.runPythonReport('', ''); }
      catch{ await updateReport('', ''); }
    } else {
      await updateReport('', '');
    }
    toast('Reporte: todo el historial','ok');
  });

  $('#btnPDF')?.addEventListener('click', ()=>{
    window.print();
  });
}

async function boot(){
  await openDB();
  initDefaults();
  wireTabs();
  wirePernosChecks();
  wireForms();
  wireBDButtons();
  wireReportButtons();
  wireDeletes();
  setOfflineBadge();

  // carga inicial
  await renderBD('', '');
  await updateReport('', '');
}

document.addEventListener('DOMContentLoaded', ()=>{
  boot().catch(err=>{
    console.error(err);
    toast('Error iniciando la app', 'err', 3500);
  });
});
