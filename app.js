// CE - Control de Calidad (Offline)
// app.js: Slump (demora), Resistencias iniciales (UNE EN 14488-2 A/B), Pernos,
// BD por MES, Reporte DIARIO, y gráficos con PyScript.

const LIMITS = { slump: { min: 8, max: 11 } };

// Calibraciones locales desde RESINI-26012026.xlsx (26/01/2026)
const CALIB = {
  A: {
    // MPa = a * N_prom + b  (Curva II, agregado 0–16 mm) — Ajuste lineal exacto en tus datos
    II: { type:'linear', a: 0.00190114068441, b: -0.07034220532319, label:'A–II (local 26/01/2026)' },
    I:  { type:'linear', a: 0.00190114068441, b: -0.07034220532319, label:'A–I (ajustar)' },
    III:{ type:'linear', a: 0.00190114068441, b: -0.07034220532319, label:'A–III (ajustar)' },
  },
  B: {
    // MPa = a * (N/mm) + b  (Hilti – ajuste empírico con promedios visibles 2:20 y 3:20)
    II: { type:'linear', a: 0.13003901170351106, b: 0.35110533159948026, label:'B–II (local 26/01/2026)' },
  }
};
// ↑ Puedes reemplazar coeficientes por los oficiales de tu laboratorio/guía sin tocar más código.

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

// ESCAPE SEGURO (arregla el bug: antes no escapaba)
function esc(s){
  const str = String(s ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\x22/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNum(v){
  if(v === null || v === undefined || Number.isNaN(v)) return '';
  if(Number.isInteger(v)) return String(v);
  return (Math.round(v*100)/100).toFixed(2).replace(/\.00$/,'');
}
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

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

/*** Time helpers ***/
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

/*** Slump parser (pulgadas) ***/
function parseInchFraction(input){
  if(input === null || input === undefined) return null;
  let s = String(input).trim();
  if(!s) return null;
  s = s.replace(/["”″]/g,'').trim();
  s = s.replace(/\s+/g,' ');
  // decimal
  if(/^\d+(\.\d+)?$/.test(s)){
    const v = Number(s);
    return { value: v, text: `${formatNum(v)}"` };
  }
  // a b/c  o  b/c
  const parts = s.split(' ');
  let whole = 0, frac = null;
  if(parts.length === 1){ frac = parts[0]; }
  else if(parts.length === 2){ whole = Number(parts[0]); frac = parts[1]; if(Number.isNaN(whole)) return null; }
  else return null;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if(!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if(!den) return null;
  const value = whole + (num/den);
  const text = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + '"';
  return { value, text };
}

/*** IndexedDB ***/
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

/*** Export para PyScript ***/
window.ceExportData = async function(desdeIso, hastaIso){
  const [slump, resist, pernos] = await Promise.all([ getAll('slump'), getAll('resist'), getAll('pernos') ]);
  const f = (arr) => arr.filter(r => inRange(r.fecha, desdeIso, hastaIso));
  return {
    slump: f(slump),
    resist: f(resist),
    pernos: f(pernos),
    rango: { desde: desdeIso || null, hasta: hastaIso || null }
  };
};

/*** UI Helpers ***/
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
  window.addEventListener('online', ()=>{ paint(); toast('Conexión restablecida ✅','ok'); });
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
    if(on){ p.classList.add('panel-anim'); setTimeout(()=>p.classList.remove('panel-anim'), 220); }
  });
  localStorage.setItem('ce_last_tab', name);
}

/*** Slump: wiring y demora ***/
function wireSlumpDelay(){
  const hs = $('#formSlump input[name="hsOut"]');
  const hll= $('#formSlump input[name="hll"]');
  const out= $('#formSlump input[name="demora"]');
  if(!hs || !hll || !out) return;
  function recalc(){
    const dmin = calcDelayMin(hll.value, hs.value);
    out.value = (dmin === null) ? '' : `${minToHHMM(dmin)} (${dmin} min)`;
  }
  hs.addEventListener('input', recalc);
  hll.addEventListener('input', recalc);
}

/*** Pernos ***/
function wirePernosChecks(){
  const chkHel = $('#chkHel');
  const chkSw  = $('#chkSw');
  const inHel  = $('#cantHel');
  const inSw   = $('#cantSw');
  function sync(){
    const helOn = !!chkHel?.checked;
    const swOn  = !!chkSw?.checked;
    if(inHel){ inHel.disabled = !helOn; if(!helOn) inHel.value = 0; }
    if(inSw){  inSw.disabled  = !swOn;  if(!swOn)  inSw.value  = 0; }
  }
  chkHel?.addEventListener('change', sync);
  chkSw?.addEventListener('change', sync);
  sync();
}

/*** FORM: Slump ***/
function wireFormSlump(){
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
    setStatus(stSlump, ok ? 'Guardado ✅' : `Guardado ⚠️ (Rango ${LIMITS.slump.min}-${LIMITS.slump.max}")`, 3500);
    toast(ok ? 'Guardado ✅' : 'Guardado (Slump fuera de rango)', ok ? 'ok' : 'warn');
    fSlump.reset();
    fSlump.querySelector('input[name="fecha"]').value = todayISO();
    fSlump.querySelector('input[name="horaSlump"]').value = nowHHMM();
    const dem = fSlump.querySelector('input[name="demora"]');
    if(dem) dem.value = '';
    await renderBD($('#fMes')?.value || '');
  });
}

/*** Resistencias iniciales — UI dinámica A/B ***/
function newRowA(i){
  return `
  <div class="card" data-row-a>
    <div class="grid">
      <div>
        <label>Hora lectura (hh:mm)</label>
        <input type="time" name="horaA_${i}" required />
      </div>
      <div>
        <label>Hora acumulada (auto)</label>
        <input type="text" name="acumA_${i}" readonly />
      </div>
      <div>
        <label>Temp. ambiente (°C)</label>
        <input type="number" step="0.1" name="tA_${i}" />
      </div>
      <div>
        <label>Promedio (N)</label>
        <input type="text" name="promA_${i}" readonly />
      </div>
    </div>
    <div class="grid mt-12">
      <div><label>F1 (N)</label><input type="number" name="n1A_${i}" step="0.1" required /></div>
      <div><label>F2 (N)</label><input type="number" name="n2A_${i}" step="0.1" required /></div>
      <div><label>F3 (N)</label><input type="number" name="n3A_${i}" step="0.1" required /></div>
      <div><label>F4 (N)</label><input type="number" name="n4A_${i}" step="0.1" required /></div>
      <div><label>F5 (N)</label><input type="number" name="n5A_${i}" step="0.1" required /></div>
    </div>
  </div>`;
}
function newRowB(i){
  return `
  <div class="card" data-row-b>
    <div class="grid">
      <div>
        <label>Hora lectura (hh:mm)</label>
        <input type="time" name="horaB_${i}" required />
      </div>
      <div>
        <label>Hora acumulada (auto)</label>
        <input type="text" name="acumB_${i}" readonly />
      </div>
      <div>
        <label>Temp. ambiente (°C)</label>
        <input type="number" step="0.1" name="tB_${i}" />
      </div>
      <div>
        <label>Relación (N/mm)</label>
        <input type="text" name="relB_${i}" readonly />
      </div>
    </div>
    <div class="grid mt-12">
      <div><label>L total (mm)</label><input type="number" step="0.1" name="ltB_${i}" required /></div>
      <div><label>NVS saliente (mm)</label><input type="number" step="0.1" name="nvsB_${i}" required /></div>
      <div><label>Parte perforada (mm)</label><input type="number" step="0.1" name="perfB_${i}" required /></div>
      <div><label>Pull-out (N)</label><input type="number" step="1"   name="pullB_${i}" required /></div>
    </div>
  </div>`;
}

function hhmmToMins(hhmm){ if(!hhmm) return null; const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function minsDiff(h1, h0){ let d=hhmmToMins(h1)-hhmmToMins(h0); if(d<0) d+=1440; return d; }
function minsToHHMM(m){ const H=String(Math.floor(m/60)).padStart(2,'0'); const M=String(m%60).padStart(2,'0'); return `${H}:${M}`; }
function calcMPaLinear(a,b,x){ return Math.max(0, a*x + b); }

function computeRowA(fd, base, i, curva){
  const hora = fd.get(`horaA_${i}`);
  const dmin = minsDiff(hora, base);
  const n = [1,2,3,4,5].map(k => Number(fd.get(`n${k}A_${i}`))).filter(v=>!Number.isNaN(v));
  const prom = n.length ? n.reduce((s,v)=>s+v,0)/n.length : 0;
  const {a,b} = CALIB.A[curva] || CALIB.A.II;
  const mpa = calcMPaLinear(a,b,prom);
  return { hora, dmin, prom, mpa };
}
function computeRowB(fd, base, i, curva){
  const hora = fd.get(`horaB_${i}`);
  const dmin = minsDiff(hora, base);
  const perf = Number(fd.get(`perfB_${i}`)||0);
  const pull = Number(fd.get(`pullB_${i}`)||0);
  const rel  = perf>0 ? (pull/perf) : 0; // N/mm
  const {a,b} = (CALIB.B[curva] || CALIB.B.II);
  const mpa = calcMPaLinear(a,b,rel);
  return { hora, dmin, rel, mpa };
}

function wireResistUI(){
  const metodo = $('#metodo'); const curva = $('#curva');
  const boxA = $('#resA'); const boxB = $('#resB');
  const areaA = $('#areaA'); const areaB = $('#areaB');
  const addA = $('#addRowA'); const addB = $('#addRowB');
  let idxA = 0, idxB = 0;

  function syncMethod(){
    const m = metodo?.value || 'A';
    boxA.style.display = (m==='A') ? '' : 'none';
    boxB.style.display = (m==='B') ? '' : 'none';
  }
  metodo?.addEventListener('change', syncMethod);
  syncMethod();

  function addRowAOnce(){
    idxA += 1; areaA.insertAdjacentHTML('beforeend', newRowA(idxA));
  }
  function addRowBOnce(){
    idxB += 1; areaB.insertAdjacentHTML('beforeend', newRowB(idxB));
  }
  addA?.addEventListener('click', addRowAOnce);
  addB?.addEventListener('click', addRowBOnce);

  // fila por defecto
  addRowAOnce();
}

function wireResistSubmit(){
  const fRes = $('#formResist'); const stRes = $('#resistStatus');
  fRes?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fRes);
    const base   = fd.get('horaBase');
    const metodo = fd.get('metodo') || 'A';
    const curva  = fd.get('curva')  || 'II';

    const comunes = {
      fecha: fd.get('fecha'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      obs:   String(fd.get('obs')||'').trim(),
      metodo, curva
    };

    let saved = 0;

    if(metodo==='A'){
      const rows = [...document.querySelectorAll('[data-row-a]')];
      for(let i=1;i<=rows.length;i++){
        const {hora, dmin, prom, mpa} = computeRowA(fd, base, i, curva);
        if(!hora) continue;
        await addRecord('resist', {
          ...comunes,
          hora,
          edad: minsToHHMM(dmin),
          edadMin: dmin,
          nProm: prom,
          resistencia: mpa
        });
        saved++;
      }
    } else {
      const rows = [...document.querySelectorAll('[data-row-b]')];
      for(let i=1;i<=rows.length;i++){
        const {hora, dmin, rel, mpa} = computeRowB(fd, base, i, curva);
        if(!hora) continue;
        await addRecord('resist', {
          ...comunes,
          hora,
          edad: minsToHHMM(dmin),
          edadMin: dmin,
          relHilti: rel,
          resistencia: mpa
        });
        saved++;
      }
    }

    if(saved===0){
      setStatus(stRes, 'Agrega al menos una lectura', 3000);
      return;
    }

    setStatus(stRes, `Guardado ${saved} lectura(s) ✅`, 3500);
    toast('Resistencias iniciales guardadas ✅','ok');
    fRes.reset();
    initDefaults(); // repone fecha/hora base por hoy
    await renderBD($('#fMes')?.value || '');
    try{ if(typeof window.runPythonResist==='function'){ const d=comunes.fecha; await window.runPythonResist(d,d); } }catch(_){}
  });
}

/*** BD por mes ***/
async function renderBD(month=''){
  const [slump, resist, pernos] = await Promise.all([getAll('slump'), getAll('resist'), getAll('pernos')]);
  const fMonth = (arr)=> month ? arr.filter(r => monthKey(r.fecha) === month) : arr;
  const sortDesc = (arr)=> arr.slice().sort((a,b)=>
    (b.fecha ?? '').localeCompare(a.fecha ?? '') ||
    ((b.hora ?? b.horaSlump ?? '').localeCompare(a.hora ?? a.horaSlump ?? ''))
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
    const del = `<button type="button" class="btn-mini" data-del data-store="slump" data-id="${esc(r.id)}">🗑️</button>`;
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
  if(!rows.length) return renderEmptyRow(tbody, 8);
  tbody.innerHTML = rows.map(r=>{
    const del = `<button type="button" class="btn-mini" data-del data-store="resist" data-id="${esc(r.id)}">🗑️</button>`;
    return `
      <tr>
        <td data-label="Fecha"><span class="cell-right">${esc(r.fecha||'')}</span></td>
        <td data-label="Hora"><span class="cell-right">${esc(r.hora||'')}</span></td>
        <td data-label="Labor">${esc(r.labor||'')}</td>
        <td data-label="Nivel"><span class="cell-right">${esc(r.nivel||'')}</span></td>
        <td data-label="Método"><span class="cell-right">${esc(r.metodo||'')}</span></td>
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
    const del = `<button type="button" class="btn-mini" data-del data-store="pernos" data-id="${esc(r.id)}">🗑️</button>`;
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

/*** Reporte diario KPIs ***/
async function updateKPIs(dayIso){
  const [slump, pernos] = await Promise.all([getAll('slump'), getAll('pernos')]);
  const slumpF  = dayIso ? slump.filter(r=> r.fecha === dayIso) : slump;
  const pernosF = dayIso ? pernos.filter(r=> r.fecha === dayIso) : pernos;

  const temps = slumpF.map(r=>Number(r.temp)).filter(v=>!Number.isNaN(v));
  const tProm = mean(temps);
  const tMin = temps.length ? Math.min(...temps) : null;
  const tMax = temps.length ? Math.max(...temps) : null;

  const hel = pernosF.reduce((a,r)=>a + (Number(r.cantHel)||0), 0);
  const sw  = pernosF.reduce((a,r)=>a + (Number(r.cantSw) ||0), 0);

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

/*** Botoneras BD / Reporte / Borrado ***/
function wireBDButtons(){
  $('#btnFiltrar')?.addEventListener('click', async ()=>{
    await renderBD($('#fMes')?.value || '');
    toast('Mes aplicado','ok');
  });
  $('#btnLimpiarFiltro')?.addEventListener('click', async ()=>{
    const mes = $('#fMes');
    if(mes) mes.value = '';
    await renderBD('');
    toast('Mostrando todo','ok');
  });
  $('#btnBDPDF')?.addEventListener('click', ()=> window.print());
  $('#btnBorrarTodo')?.addEventListener('click', async ()=>{
    const ok = confirm('¿Borrar TODA la base de datos? Esta acción no se puede deshacer.');
    if(!ok) return;
    const ok2 = confirm('Confirmación final: ¿Seguro que deseas borrar TODO?');
    if(!ok2) return;
    await Promise.all([clearStore('slump'), clearStore('resist'), clearStore('pernos')]);
    await renderBD('');
    await updateKPIs($('#rDia')?.value || '');
    $('#chartSlumpImg')?.removeAttribute('src');
    $('#chartAireImg')?.removeAttribute('src');
    $('#chartResistImg')?.removeAttribute('src');
    toast('Base de datos borrada','warn');
  });
}
function wireReportButtons(){
  $('#btnReporte')?.addEventListener('click', async ()=>{
    const day = $('#rDia')?.value || todayISO();
    if($('#rDia')) $('#rDia').value = day;
    await updateKPIs(day);
    try{ if(typeof window.runPythonReport === 'function') await window.runPythonReport(day, day); } catch(e){ console.warn(e); }
    try{ if(typeof window.runPythonResist === 'function') await window.runPythonResist(day, day); } catch(e){ console.warn(e); }
    toast('Reporte actualizado ✅','ok');
  });
  $('#btnReporteTodo')?.addEventListener('click', async ()=>{
    const day = todayISO();
    if($('#rDia')) $('#rDia').value = day;
    await updateKPIs(day);
    try{ if(typeof window.runPythonReport === 'function') await window.runPythonReport(day, day); } catch(e){}
    try{ if(typeof window.runPythonResist === 'function') await window.runPythonResist(day, day); } catch(e){}
    toast('Reporte de HOY ✅','ok');
  });
  $('#btnPDF')?.addEventListener('click', ()=> window.print());
}

/*** Deletes ***/
function wireDeletes(){
  document.addEventListener('click', async (e)=>{
    const b = e.target.closest('[data-del]');
    if(!b) return;
    const store = b.getAttribute('data-store');
    const id = b.getAttribute('data-id');
    if(!store || !id) return;
    if(!confirm('¿Eliminar este registro?')) return;
    await deleteRecord(store, id);
    await renderBD($('#fMes')?.value || '');
    await updateKPIs($('#rDia')?.value || '');
    toast('Registro eliminado', 'ok');
  });
}

/*** Init / Defaults ***/
function initDefaults(){
  const d = todayISO();
  const sFecha = $('#formSlump input[name="fecha"]');
  const rFecha = $('#formResist input[name="fecha"]');
  const pFecha = $('#formPernos input[name="fecha"]');
  if(sFecha) sFecha.value = d;
  if(rFecha) rFecha.value = d;
  if(pFecha) pFecha.value = d;

  const sHoraSl = $('#formSlump input[name="horaSlump"]');
  const sDemora = $('#formSlump input[name="demora"]');
  if(sHoraSl) sHoraSl.value = nowHHMM();
  if(sDemora) sDemora.value = '';

  const rHoraBase = $('#formResist input[name="horaBase"]');
  if(rHoraBase) rHoraBase.value = nowHHMM();

  const rHora = $('#formPernos input[name="hora"]');
  if(rHora) rHora.value = nowHHMM();

  const mes = $('#fMes');
  const dia = $('#rDia');
  if(mes) mes.value = thisMonth();
  if(dia) dia.value = d;
}

function wireTabs(){
  $$('.tab').forEach(btn=> btn.addEventListener('click', ()=> showTab(btn.dataset.tab)));
  const last = localStorage.getItem('ce_last_tab');
  if(last) showTab(last);
}

async function boot(){
  await openDB();
  initDefaults();
  wireTabs();
  wirePernosChecks();
  wireSlumpDelay();
  wireFormSlump();
  wireResistUI();
  wireResistSubmit();
  wireBDButtons();
  wireReportButtons();
  wireDeletes();
  setOfflineBadge();
  await renderBD($('#fMes')?.value || thisMonth());
  await updateKPIs($('#rDia')?.value || todayISO());
  // Dibuja resistencias del día al cargar (si python está listo)
  try{
    const d = $('#rDia')?.value || todayISO();
    if(typeof window.runPythonResist === 'function'){
      await window.runPythonResist(d, d);
    }
  } catch(_){}
}
document.addEventListener('DOMContentLoaded', ()=>{
  boot().catch(err=>{
    console.error(err);
    toast('Error iniciando la app', 'err', 3500);
  });
});
