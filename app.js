// CE - Control de Calidad (Offline)
// app.js: Horas ordenadas + Demora, BD por mes, Reporte diario por día, fallback gráfico offline PRO

/**********************
 * CONFIG
 **********************/
const LIMITS = { slump: { min: 8, max: 11 } };
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid(){ return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function pad2(n){ return String(n).padStart(2,'0'); }
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function nowHHMM(){ const d=new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function thisMonth(){ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
function monthKey(dateIso){ return dateIso ? String(dateIso).slice(0,7) : ''; }

function setStatus(el, msg, ms=2500){
  if(!el) return;
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

/**********************
 * Time helpers: demora = H_LL - HS (ajusta medianoche)
 **********************/
function timeToMin(hhmm){
  if(!hhmm) return null;
  const [h,m] = String(hhmm).split(':').map(Number);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}
function minToHHMM(mins){
  if(mins === null || mins === undefined || Number.isNaN(mins)) return '';
  const m = ((mins%1440)+1440)%1440;
  return `${pad2(Math.floor(m/60))}:${pad2(m%60)}`;
}
function calcDelayMin(hll, hs){
  const a = timeToMin(hll);
  const b = timeToMin(hs);
  if(a===null || b===null) return null;
  let d = a - b;
  if(d < 0) d += 1440;
  return d;
}

/**********************
 * Slump parser (pulgadas: 9 3/4, 7/8, 9.75)
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
    return { value: v, text: `${formatNum(v)}\"` };
  }

  // a b/c or b/c
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
  const text  = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + '\"';
  return { value, text };
}

/**********************
 * IndexedDB
 **********************/
const DB_NAME = 'ce_qc_db';
const DB_VER  = 4;
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

function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }

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
 * Export para PyScript (usa rango; en reporte diario se pasa day,day)
 **********************/
window.ceExportData = async function(desdeIso, hastaIso){
  const [slump, resist, pernos] = await Promise.all([
    getAll('slump'), getAll('resist'), getAll('pernos')
  ]);
  const f = (arr) => arr.filter(r => inRange(r.fecha, desdeIso, hastaIso));
  return {
    slump: f(slump),
    resist: f(resist),
    pernos: f(pernos),
    rango: { desde: desdeIso || null, hasta: hastaIso || null }
  };
};

/**********************
 * UI
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

/**********************
 * BD por mes
 **********************/
async function renderBD(month=''){
  const [slump, resist, pernos] = await Promise.all([getAll('slump'), getAll('resist'), getAll('pernos')]);
  const fMonth = (arr)=> month ? arr.filter(r => monthKey(r.fecha) === month) : arr;
  const sortDesc = (arr)=> arr.slice().sort((a,b)=>
    (b.fecha||'').localeCompare(a.fecha||'') ||
    (b.hora||b.horaSlump||'').localeCompare(a.hora||a.horaSlump||'')
  );

  renderTblSlump(sortDesc(fMonth(slump)));
  renderTblResist(sortDesc(fMonth(resist)));
  renderTblPernos(sortDesc(fMonth(pernos)));
}

function renderEmptyRow(tbody, cols, msg='Sin registros'){
  tbody.innerHTML = `<tr><td colspan="${cols}" class="muted">${esc(msg)}</td></tr>`;
}

function renderTblSlump(rows){
  const tbody = $('#tblSlump tbody');
  if(!tbody) return;
  if(!rows.length) return renderEmptyRow(tbody, 12);

  tbody.innerHTML = rows.map(r=>{
    const del = `<button type="button" class="btn-mini" data-del data-store="slump" data-id="${esc(r.id)}">🗑</button>`;
    return `
      <tr>
        <td data-label="Fecha"><span class="cell-right">${esc(r.fecha||'')}</span></td>
        <td data-label="Hora Slump"><span class="cell-right">${esc(r.horaSlump||'')}</span></td>
        <td data-label="Labor">${esc(r.labor||'')}</td>
        <td data-label="Nivel"><span class="cell-right">${esc(r.nivel||'')}</span></td>
        <td data-label="Slump"><span class="cell-right">${esc(r.slumpText||'')}</span></td>
        <td data-label="T°"><span class="cell-right">${esc(formatNum(r.temp))}</span></td>
        <td data-label="Presión"><span class="cell-right">${esc(formatNum(r.presionAire))}</span></td>
        <td data-label="Mixer"><span class="cell-right">${esc(r.mixerNo||'')}</span></td>
        <td data-label="HS"><span class="cell-right">${esc(r.hsOut||'')}</span></td>
        <td data-label="H_LL"><span class="cell-right">${esc(r.hll||'')}</span></td>
        <td data-label="Demora"><span class="cell-right">${esc(r.demoraText||'')}</span></td>
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
 * Reporte diario KPIs
 **********************/
async function updateKPIs(dayIso){
  const [slump, pernos] = await Promise.all([getAll('slump'), getAll('pernos')]);
  const slumpF  = dayIso ? slump.filter(r=> r.fecha === dayIso) : slump;
  const pernosF = dayIso ? pernos.filter(r=> r.fecha === dayIso) : pernos;

  const temps = slumpF.map(r=>Number(r.temp)).filter(v=>!Number.isNaN(v));
  const tProm = mean(temps);
  const tMin  = temps.length ? Math.min(...temps) : null;
  const tMax  = temps.length ? Math.max(...temps) : null;

  const hel = pernosF.reduce((a,r)=>a + (Number(r.cantHel)||0), 0);
  const sw  = pernosF.reduce((a,r)=>a + (Number(r.cantSw)||0), 0);

  $('#kpiTempProm').textContent = temps.length ? `${formatNum(tProm)} °C` : '—';
  $('#kpiTempExtra').textContent = temps.length ? `Min ${formatNum(tMin)} / Max ${formatNum(tMax)}` : 'Min — / Max —';
  $('#kpiPernosTotal').textContent = String(Math.round(hel+sw));
  $('#kpiPernosExtra').textContent = `Helicoidal ${Math.round(hel)} / Swellex ${Math.round(sw)}`;

  const resumen = $('#resumenReporte');
  if(resumen){
    resumen.innerHTML = `
      <div><b>Día:</b> ${esc(dayIso || 'Todo')}</div>
      <div><b>Registros slump:</b> ${slumpF.length}</div>
      <div><b>Registros pernos:</b> ${pernosF.length}</div>
    `;
  }
}

/**********************
 * Fallback gráfico offline (BARRAS SUPER PRO, NO GRUESAS)
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
  const out = [...m.values()].map(o=>({ labor:o.k, value:o.n? o.sum/o.n : 0 }));
  out.sort((a,b)=> a.value - b.value);
  return out.slice(-12);
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function drawBarVertical(canvas, items, title, unit=''){
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0,0,W,H);

  if(!items.length){
    ctx.fillStyle = '#6B7280';
    ctx.font = '800 22px system-ui';
    ctx.fillText('Sin datos para el día seleccionado', 40, 80);
    return;
  }

  const margin = {l: 72, r: 26, t: 52, b: 150};
  const iw = W - margin.l - margin.r;
  const ih = H - margin.t - margin.b;

  // Título
  ctx.fillStyle = '#111827';
  ctx.font = '900 18px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(title, margin.l, 30);

  const maxV = Math.max(...items.map(d=>d.value), 1);
  const n = items.length;

  // Barras finas: cap máximo + gap dinámico
  const maxBarW = 44;
  const minGap  = 14;

  let barW = Math.min(maxBarW, (iw / n) * 0.60);
  let gap  = Math.max(minGap, (iw - (barW*n)) / Math.max(1, n-1));

  const totalW = barW*n + gap*(n-1);
  const startX = margin.l + Math.max(0, (iw - totalW)/2);

  // Grid Y
  ctx.strokeStyle = 'rgba(17,24,39,.10)';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for(let i=0;i<=gridLines;i++){
    const y = margin.t + (ih*i/gridLines);
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(W - margin.r, y);
    ctx.stroke();

    const val = maxV * (1 - i/gridLines);
    ctx.fillStyle = 'rgba(17,24,39,.55)';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(val.toFixed(1), 12, y+4);
  }

  // Barras
  for(let i=0;i<n;i++){
    const d = items[i];
    const x = startX + i*(barW + gap);
    const h = (d.value / maxV) * ih;
    const y = margin.t + (ih - h);

    const grad = ctx.createLinearGradient(0, y, 0, y+h);
    grad.addColorStop(0, 'rgba(251,146,60,.95)');
    grad.addColorStop(1, 'rgba(249,115,22,.85)');

    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(154,52,18,.55)';
    ctx.lineWidth = 1.1;

    roundRect(ctx, x, y, barW, h, 10);
    ctx.fill();
    ctx.stroke();

    // valor
    ctx.fillStyle = '#111827';
    ctx.font = '800 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(d.value.toFixed(2), x + barW/2, y - 10);

    // label
    ctx.save();
    ctx.translate(x + barW/2, H - margin.b + 118);
    ctx.rotate(-0.62);
    ctx.fillStyle = 'rgba(17,24,39,.92)';
    ctx.font = '800 12px system-ui';
    ctx.textAlign = 'left';
    const lab = d.labor.length > 24 ? d.labor.slice(0,23)+'…' : d.labor;
    ctx.fillText(lab, -70, 0);
    ctx.restore();
  }

  // unidad
  if(unit){
    ctx.fillStyle = 'rgba(17,24,39,.75)';
    ctx.font = '800 12px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(unit, W - margin.r, 30);
  }

  ctx.textAlign = 'left';
}

async function drawFallbackCharts(dayIso){
  const data = await window.ceExportData(dayIso, dayIso);
  const slump = data.slump || [];

  // normaliza slumpValue si falta (datos antiguos)
  for(const r of slump){
    if(r.slumpValue === undefined || r.slumpValue === null || Number.isNaN(Number(r.slumpValue))){
      const p = parseInchFraction(r.slumpIn);
      if(p) r.slumpValue = p.value;
    }
  }

  const bySlump = groupMean(slump, 'labor', 'slumpValue');
  const byAire  = groupMean(slump, 'labor', 'presionAire');

  const imgS = $('#chartSlumpImg');
  const imgA = $('#chartAireImg');
  const cvS  = $('#chartSlumpCv');
  const cvA  = $('#chartAireCv');

  if(imgS) imgS.style.display = 'none';
  if(imgA) imgA.style.display = 'none';
  if(cvS)  cvS.style.display  = 'block';
  if(cvA)  cvA.style.display  = 'block';

  drawBarVertical(cvS, bySlump, 'Slump promedio por labor', 'pulgadas (")');
  drawBarVertical(cvA,  byAire, 'Presión de aire promedio por labor', 'presión');
}

/**********************
 * Init & wiring
 **********************/
function initDefaults(){
  const d = todayISO();
  $('#formSlump input[name="fecha"]').value = d;
  $('#formResist input[name="fecha"]').value = d;
  $('#formPernos input[name="fecha"]').value = d;

  $('#formSlump input[name="horaSlump"]').value = nowHHMM();
  $('#formSlump input[name="demora"]').value = '';

  $('#formResist input[name="hora"]').value = nowHHMM();
  $('#formPernos input[name="hora"]').value = nowHHMM();

  $('#fMes').value = thisMonth();
  $('#rDia').value = d;
}

function wireTabs(){
  $$('.tab').forEach(btn=> btn.addEventListener('click', ()=> showTab(btn.dataset.tab)));
  const last = localStorage.getItem('ce_last_tab');
  if(last) showTab(last);
}

function wirePernosChecks(){
  const chkHel = $('#chkHel');
  const chkSw  = $('#chkSw');
  const inHel  = $('#cantHel');
  const inSw   = $('#cantSw');

  function sync(){
    const helOn = !!chkHel.checked;
    const swOn  = !!chkSw.checked;
    inHel.disabled = !helOn;
    inSw.disabled  = !swOn;
    if(!helOn) inHel.value = 0;
    if(!swOn)  inSw.value  = 0;
  }

  chkHel.addEventListener('change', sync);
  chkSw.addEventListener('change', sync);
  sync();
}

function wireSlumpDelay(){
  const hs  = $('#formSlump input[name="hsOut"]');
  const hll = $('#formSlump input[name="hll"]');
  const out = $('#formSlump input[name="demora"]');

  function recalc(){
    const dmin = calcDelayMin(hll.value, hs.value);
    out.value = (dmin === null) ? '' : `${minToHHMM(dmin)} (${dmin} min)`;
  }

  hs.addEventListener('input', recalc);
  hll.addEventListener('input', recalc);
}

function wireDeletes(){
  document.addEventListener('click', async (e)=>{
    const b = e.target.closest('[data-del]');
    if(!b) return;
    const store = b.getAttribute('data-store');
    const id    = b.getAttribute('data-id');
    if(!store || !id) return;

    if(!confirm('¿Eliminar este registro?')) return;
    await deleteRecord(store, id);

    await renderBD($('#fMes').value || '');
    await updateKPIs($('#rDia').value || '');
    toast('Registro eliminado', 'ok');
  });
}

function wireForms(){
  // Slump
  const fSlump = $('#formSlump');
  const stSlump= $('#slumpStatus');
  fSlump.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fSlump);

    const parsed = parseInchFraction(fd.get('slumpIn'));
    if(!parsed){
      setStatus(stSlump, 'Slump inválido. Ej: 9 3/4" o 9.75"', 3500);
      toast('Slump inválido', 'err');
      return;
    }

    const hsOut = fd.get('hsOut');
    const hll   = fd.get('hll');
    const dmin  = calcDelayMin(hll, hsOut);
    const demoraText = (dmin===null) ? '' : `${minToHHMM(dmin)} (${dmin} min)`;

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
      hsOut,
      hll,
      horaSlump: fd.get('horaSlump'),
      demoraMin: dmin,
      demoraText,
      slumpOk: ok
    };

    await addRecord('slump', rec);
    setStatus(stSlump, ok ? 'Guardado ✅' : `Guardado ⚠️ (Fuera de rango ${LIMITS.slump.min}-${LIMITS.slump.max}")`, 3500);
    toast(ok ? 'Guardado ✅' : 'Guardado (Slump fuera de rango)', ok ? 'ok' : 'warn');

    fSlump.reset();
    fSlump.querySelector('input[name="fecha"]').value = todayISO();
    fSlump.querySelector('input[name="horaSlump"]').value = nowHHMM();
    fSlump.querySelector('input[name="demora"]').value = '';

    await renderBD($('#fMes').value || '');
  });

  // Resist
  const fRes = $('#formResist');
  const stRes= $('#resistStatus');
  fRes.addEventListener('submit', async (e)=>{
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

    await renderBD($('#fMes').value || '');
  });

  // Pernos
  const fPer = $('#formPernos');
  const stPer= $('#pernosStatus');
  fPer.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fPer);
    const helOn = $('#chkHel').checked;
    const swOn  = $('#chkSw').checked;

    if(!helOn && !swOn){
      setStatus(stPer, 'Selecciona al menos un tipo de perno.', 3500);
      toast('Falta seleccionar tipo de perno','err');
      return;
    }

    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      cantHel: helOn ? Number(fd.get('cantHel')||0) : 0,
      cantSw:  swOn  ? Number(fd.get('cantSw')||0)  : 0,
      obs: String(fd.get('obs')||'').trim()
    };

    await addRecord('pernos', rec);
    setStatus(stPer, 'Guardado ✅', 3000);
    toast('Pernos registrados ✅','ok');

    fPer.reset();
    fPer.querySelector('input[name="fecha"]').value = todayISO();
    fPer.querySelector('input[name="hora"]').value = nowHHMM();

    $('#chkHel').checked = false;
    $('#chkSw').checked  = false;
    wirePernosChecks();

    await renderBD($('#fMes').value || '');
    await updateKPIs($('#rDia').value || '');
  });
}

function wireBDButtons(){
  $('#btnFiltrar').addEventListener('click', async ()=>{
    await renderBD($('#fMes').value || '');
    toast('Mes aplicado','ok');
  });

  $('#btnLimpiarFiltro').addEventListener('click', async ()=>{
    $('#fMes').value = '';
    await renderBD('');
    toast('Mostrando todo','ok');
  });

  $('#btnBDPDF').addEventListener('click', ()=> window.print());

  $('#btnBorrarTodo').addEventListener('click', async ()=>{
    const ok = confirm('¿Borrar TODA la base de datos? Esta acción no se puede deshacer.');
    if(!ok) return;
    const ok2 = confirm('Confirmación final: ¿Seguro que deseas borrar TODO?');
    if(!ok2) return;

    await Promise.all([clearStore('slump'), clearStore('resist'), clearStore('pernos')]);
    await renderBD('');
    await updateKPIs($('#rDia').value || '');

    $('#chartSlumpImg')?.removeAttribute('src');
    $('#chartAireImg')?.removeAttribute('src');

    toast('Base de datos borrada','warn');
  });
}

function wireReportButtons(){
  $('#btnReporte').addEventListener('click', async ()=>{
    const day = $('#rDia').value || todayISO();
    $('#rDia').value = day;
    await updateKPIs(day);

    // intento Python
    if(typeof window.runPythonReport === 'function'){
      try{
        await window.runPythonReport(day, day);
        const s = $('#chartSlumpImg')?.getAttribute('src');
        const a = $('#chartAireImg')?.getAttribute('src');
        if(s || a){
          $('#chartSlumpImg').style.display='block';
          $('#chartAireImg').style.display='block';
          $('#chartSlumpCv').style.display='none';
          $('#chartAireCv').style.display='none';
          toast('Gráficos Python listos ✅','ok');
          return;
        }
      } catch(err){ console.warn(err); }
    }

    // fallback offline
    await drawFallbackCharts(day);
    toast('Modo offline: gráfico alternativo ✅','warn');
  });

  $('#btnReporteTodo').addEventListener('click', async ()=>{
    const day = todayISO();
    $('#rDia').value = day;
    await updateKPIs(day);
    try{ if(typeof window.runPythonReport === 'function') await window.runPythonReport(day, day); } catch(e){}
    toast('Reporte de HOY ✅','ok');
  });

  $('#btnPDF').addEventListener('click', ()=> window.print());
}

async function boot(){
  await openDB();
  initDefaults();
  wireTabs();
  wirePernosChecks();
  wireSlumpDelay();
  wireForms();
  wireBDButtons();
  wireReportButtons();
  wireDeletes();
  setOfflineBadge();

  await renderBD($('#fMes').value || thisMonth());
  await updateKPIs($('#rDia').value || todayISO());
}

document.addEventListener('DOMContentLoaded', ()=>{
  boot().catch(err=>{
    console.error(err);
    toast('Error iniciando la app', 'err', 3500);
  });
});
