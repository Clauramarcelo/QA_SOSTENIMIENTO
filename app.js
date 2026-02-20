// CE - Control de Calidad (Offline)
// app.js: Slump (demora), Resistencias iniciales (UNE EN 14488-2 A/B), Pernos,
// BD por mes, Reporte diario, y gráficos con PyScript.

// -------------------------
// Config básica
// -------------------------
const LIMITS = { slump: { min: 8, max: 11 } };
// (Opcional) Calibración Método B (Hilti) si lo usas
const CALIB = {
  B: {
    II: { type:'linear', a: 0.13003901170351106, b: 0.35110533159948026, label:'B–II (local 26/01/2026)' }
  }
};
const $ = (sel) => document.querySelector(sel);
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
// Escape seguro (anti-XSS)
function esc(s){
  const str = String(s ?? '');
  return str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
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

// -------------------------
// Time helpers
// -------------------------
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

// -------------------------
// Slump parser (pulgadas)
// -------------------------
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
  // a b/c o b/c
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

// -------------------------
// Método A helpers (fórmula solicitada)
// -------------------------
function parseNList(text){
  if(!text) return [];
  return String(text)
  .replace(/,/g,' ')
  .replace(/;/g,' ')
  .replace(/\s+/g,' ')
  .trim()
  .split(' ')
  .filter(Boolean)
  .map(Number)
  .filter(v => !Number.isNaN(v));
}
function mpaFromNpromA(nProm){
  // MPa = max(0, (N̅ - 37) / 526)
  const mpa = (nProm - 37) / 526;
  return Math.max(0, mpa);
}

// -------------------------
// (Opcional) Método B helpers (calibración a MPa por curva — no usado en flujo actual)
// -------------------------
function calcMPaB(curva, rel){
  const c = (CALIB.B[curva] || CALIB.B.II);
  const mpa = (c?.a ?? 0)*rel + (c?.b ?? 0);
  return Math.max(0, mpa);
}

// ==============================
// Método B (Hilti) — UI + Cálculo
// ==============================
const HILTI = {
  // Tiempos fijos y longitudes de clavo (mm)
  times: [
    { key: '2h', label: '2 h (120 min)', mins: 120, L: 103 },
    { key: '3h', label: '3 h (180 min)', mins: 180, L: 80  },
    { key: '4h', label: '4 h (240 min)', mins: 240, L: 60  },
  ],
  rows: 5,
  formula: (avgRel) => (avgRel + 2.7) / 7.69 // Método B final, según tu especificación
};

// Construye UI compacta por bloque (una sola vez)
function buildMetodoBUI() {
  const host = document.getElementById('areaB');
  if (!host) return;
  if (host.__built) return; // evitar reconstruir
  const blocks = HILTI.times.map(t => {
    const rows = Array.from({ length: HILTI.rows }, (_, i) => {
      const n = i + 1;
      return `
        <tr>
          <td data-label="#">${n}</td>
          <td data-label="L. Clavo (mm)"><span class="cell-right">${t.L}</span></td>
          <td data-label="Parte saliente (mm)">
            <input type="number" min="0" step="0.1" name="sal_${t.key}_${n}" placeholder="mm">
          </td>
          <td data-label="L. incrustada (mm)"><span id="lin_${t.key}_${n}" class="cell-right">—</span></td>
          <td data-label="Pull-out (N)">
            <input type="number" min="0" step="1" name="pull_${t.key}_${n}" placeholder="N">
          </td>
          <td data-label="N/mm"><span id="rel_${t.key}_${n}" class="cell-right">—</span></td>
        </tr>`;
    }).join('');

    return `
      <div class="card" data-block="${t.key}">
        <h3>Método B — ${t.label} • Clavo ${t.L} mm</h3>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>#</th><th>L. Clavo (mm)</th><th>Parte saliente (mm)</th>
                <th>L. incrustada (mm)</th><th>Pull-out (N)</th><th>N/mm</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr>
                <td colspan="5"><b>Promedio N/mm</b></td>
                <td><span id="avg_${t.key}" class="cell-right">—</span></td>
              </tr>
              <tr>
                <td colspan="5"><b>Método B = (Promedio + 2.7) / 7.69</b></td>
                <td><span id="mb_${t.key}" class="cell-right">—</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;
  }).join('');

  host.innerHTML = blocks;
  host.__built = true;

  // Enlazar eventos y botón "Limpiar"
  host.querySelectorAll('input[type="number"]').forEach(inp => {
    ['input','change','blur'].forEach(evt => inp.addEventListener(evt, recomputeMetodoB));
  });
  document.getElementById('resetB')?.addEventListener('click', () => {
    host.querySelectorAll('input[type="number"]').forEach(i => i.value = '');
    host.querySelectorAll('span[id^="lin_"], span[id^="rel_"], span[id^="avg_"], span[id^="mb_"]')
        .forEach(s => s.textContent = '—');
  });
}

// Recalcula todos los bloques en vivo
function recomputeMetodoB() {
  for (const t of HILTI.times) {
    const rels = [];
    for (let i = 1; i <= HILTI.rows; i++) {
      const sal = Number(document.querySelector(`input[name="sal_${t.key}_${i}"]`)?.value);
      const pull = Number(document.querySelector(`input[name="pull_${t.key}_${i}"]`)?.value);

      const linEl = document.getElementById(`lin_${t.key}_${i}`);
      const relEl = document.getElementById(`rel_${t.key}_${i}`);

      if (!Number.isFinite(sal) && !Number.isFinite(pull)) {
        if (linEl) linEl.textContent = '—';
        if (relEl) relEl.textContent = '—';
        continue;
      }
      if (!Number.isFinite(sal) || !Number.isFinite(pull)) {
        if (linEl) linEl.textContent = '';
        if (relEl) relEl.textContent = '';
        continue;
      }
      const Lin = t.L - sal;
      if (linEl) linEl.textContent = Lin > 0 ? formatNum(Lin) : '0';
      let rel = (Lin > 0) ? (pull / Lin) : NaN;
      if (Number.isFinite(rel) && rel >= 0) {
        rels.push(rel);
        if (relEl) relEl.textContent = formatNum(rel);
      } else {
        if (relEl) relEl.textContent = '';
      }
    }
    const avgEl = document.getElementById(`avg_${t.key}`);
    const mbEl  = document.getElementById(`mb_${t.key}`);
    if (rels.length === HILTI.rows) {
      const avg = mean(rels);
      const mb  = HILTI.formula(avg);
      if (avgEl) avgEl.textContent = formatNum(avg);
      if (mbEl)  mbEl.textContent  = formatNum(mb);
    } else {
      if (avgEl) avgEl.textContent = '—';
      if (mbEl)  mbEl.textContent  = '—';
    }
  }
}

// Valida y devuelve {avg, mb} por bloque o lanza error si incompleto
function collectMetodoBBloque(t) {
  let rels = [];
  let anyFilled = false;

  for (let i = 1; i <= HILTI.rows; i++) {
    const salStr = document.querySelector(`input[name="sal_${t.key}_${i}"]`)?.value ?? '';
    const pullStr= document.querySelector(`input[name="pull_${t.key}_${i}"]`)?.value ?? '';
    const hasSal = salStr.trim() !== '';
    const hasPul = pullStr.trim() !== '';
    if (hasSal || hasPul) anyFilled = true;

    if (!hasSal && !hasPul) continue; // fila vacía
    if (!hasSal || !hasPul) {
      throw new Error(`${t.label}: fila ${i} incompleta (saliente o pull-out).`);
    }
    const sal = Number(salStr), pull = Number(pullStr);
    if (!Number.isFinite(sal) || sal < 0) {
      throw new Error(`${t.label}: 'Parte saliente' inválida en fila ${i}.`);
    }
    if (!Number.isFinite(pull) || pull < 0) {
      throw new Error(`${t.label}: 'Pull-out' inválido en fila ${i}.`);
    }
    const Lin = t.L - sal;
    if (!(Lin > 0)) {
      throw new Error(`${t.label}: L. incrustada ≤ 0 en fila ${i} (saliente ≥ L clavo).`);
    }
    const rel = pull / Lin;
    if (!Number.isFinite(rel) || rel < 0) {
      throw new Error(`${t.label}: Relación N/mm inválida en fila ${i}.`);
    }
    rels.push(rel);
  }

  if (!anyFilled) return null; // bloque omitido
  if (rels.length !== HILTI.rows) {
    throw new Error(`${t.label}: se requieren exactamente ${HILTI.rows} lecturas.`);
  }

  const avg = mean(rels);
  const mb  = HILTI.formula(avg);
  return { avg, mb };
}

// -------------------------
// IndexedDB
// -------------------------
const DB_NAME = 'ce_qc_db';
const DB_VER = 4;
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
      mkStore('slump'); mkStore('resist'); mkStore('pernos');
    };
    req.onsuccess = ()=>{ db=req.result; resolve(db); };
    req.onerror = ()=> reject(req.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
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

// -------------------------
// Export para PyScript
// -------------------------
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

// -------------------------
// UI (toast / offline)
// -------------------------
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

// -------------------------
// Tabs
// -------------------------
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
function wireTabs(){
  $$('.tab').forEach(btn=> btn.addEventListener('click', ()=> showTab(btn.dataset.tab)));
  const last = localStorage.getItem('ce_last_tab');
  if(last) showTab(last);
}

// -------------------------
// Slump: wiring + demora
// -------------------------
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
    const hll = fd.get('hll');
    const dmin = calcDelayMin(hll, hsOut);
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
      hsOut, hll,
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

// -------------------------
// Resistencias iniciales — UI toggle (A/B)
// -------------------------
function wireResistUI(){
  const metodo = $('#metodo');
  const boxA = $('#resA');
  const boxB = $('#resB');
  function syncMethod(){
    const m = metodo?.value || 'A';
    boxA.style.display = (m==='A') ? '' : 'none';
    boxB.style.display = (m==='B') ? '' : 'none';
    if (m === 'B') buildMetodoBUI(); // construir UI B al seleccionar
  }
  metodo?.addEventListener('change', syncMethod);
  syncMethod();
}

// Cálculo en vivo para Método A (4 tiempos fijos)
function bindMetodoALive(){
  const spec = [{ key:'15' }, { key:'30' }, { key:'45' }, { key:'60' }];
  const onChange = (key)=>{
    try{
      const ta = document.querySelector(`textarea[name="incadosA_${key}"]`);
      const outProm = document.querySelector(`input[name="promA_${key}"]`);
      const outMPa = document.querySelector(`input[name="mpaA_${key}"]`);
      if(!ta || !outProm || !outMPa) return;
      const list = parseNList(ta.value);
      if(list.length === 10){
        const nProm = list.reduce((a,b)=>a+b,0)/10;
        const mpa = mpaFromNpromA(nProm);
        outProm.value = nProm.toFixed(2);
        outMPa.value = mpa.toFixed(3);
      }else{
        outProm.value = '';
        outMPa.value = '';
      }
    }catch(e){ console.error(e); }
  };
  spec.forEach(({key})=>{
    const ta = document.querySelector(`textarea[name="incadosA_${key}"]`);
    if(ta){ ['input','change','blur'].forEach(evt => ta.addEventListener(evt, ()=> onChange(key))); }
  });
}

// -------------------------
// Resistencias iniciales — Submit
// -------------------------
function wireResistSubmit(){
  const fRes = $('#formResist');
  const stRes = $('#resistStatus');
  fRes?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(fRes);
    const metodo = fd.get('metodo') || 'A';
    const curva = fd.get('curva') || 'II';
    const comunes = {
      fecha: fd.get('fecha'),
      labor: String(fd.get('labor')||'').trim(),
      nivel: String(fd.get('nivel')||'').trim(),
      obs: String(fd.get('obs')||'').trim(),
      metodo, curva
    };
    let saved = 0;
    if(metodo === 'A'){
      try{
        const spec = [
          { key: '15', mins: 15, label: '0.25 h (15 min)' },
          { key: '30', mins: 30, label: '0.50 h (30 min)' },
          { key: '45', mins: 45, label: '0.75 h (45 min)' },
          { key: '60', mins: 60, label: '1.00 h (60 min)' },
        ];
        // Validación: EXACTAMENTE 10 lecturas por tiempo
        for(const t of spec){
          const list = parseNList(fd.get(`incadosA_${t.key}`));
          if(list.length !== 10){
            setStatus(stRes, `Tiempo ${t.label}: se requieren exactamente 10 lecturas (N).`, 4500);
            return;
          }
        }
        // Calcular/guardar 4 registros
        for(const t of spec){
          const list = parseNList(fd.get(`incadosA_${t.key}`));
          const nProm = list.reduce((a,b)=>a+b,0) / 10;
          const mpa = mpaFromNpromA(nProm);
          // Reflejar en UI
          const promOut = fRes.querySelector(`input[name="promA_${t.key}"]`);
          const mpaOut = fRes.querySelector(`input[name="mpaA_${t.key}"]`);
          if(promOut) promOut.value = nProm.toFixed(2);
          if(mpaOut) mpaOut.value = mpa.toFixed(3);
          await addRecord('resist', {
            ...comunes,
            hora: '', // opcional
            edad: `${String(Math.floor(t.mins/60)).padStart(2,'0')}:${String(t.mins%60).padStart(2,'0')}`,
            edadMin: t.mins,
            nProm,
            resistencia: mpa
          });
          saved++;
        }
      }catch(err){
        console.error(err);
        setStatus(stRes, 'Error al procesar Método A. Revisa que las 10 lecturas sean números.', 4500);
        toast('Error en Método A','err');
        return;
      }
    } else {
      // ========= Método B (Hilti) =========
      try{
        for (const t of HILTI.times) {
          const res = collectMetodoBBloque(t); // {avg, mb} o null
          if (!res) continue; // bloque omitido
          // Guardar un registro por bloque con 5 lecturas completas
          await addRecord('resist', {
            ...comunes,
            hora: '', // opcional
            edad: `${String(Math.floor(t.mins/60)).padStart(2,'0')}:${String(t.mins%60).padStart(2,'0')}`,
            edadMin: t.mins,
            nProm: res.avg,                  // Promedio N/mm del bloque
            resistencia: res.mb              // MPa = (avg + 2.7) / 7.69
          });
          saved++;
        }
        if (saved === 0) {
          setStatus(stRes, 'Método B: no hay bloques completos (5 lecturas).', 4000);
          toast('Sin bloques completos en B','warn');
          return;
        }
      } catch(err){
        console.error(err);
        setStatus(stRes, String(err?.message ?? 'Error en Método B'), 4500);
        toast('Error en Método B','err');
        return;
      }
    }
    setStatus(stRes, `Guardado ${saved} lectura(s) ✅`, 3500);
    toast('Resistencias iniciales guardadas ✅','ok');
    await renderBD($('#fMes')?.value || '');
    // Actualiza gráfico log–log del día
    try{
      if(typeof window.runPythonResist==='function'){
        const d=comunes.fecha;
        await window.runPythonResist(d, d);
      }
    }catch(_){}
  });
}

// -------------------------
// BD por mes
// -------------------------
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

// -------------------------
// Reporte diario KPIs
// -------------------------
async function updateKPIs(dayIso){
  const [slump, pernos] = await Promise.all([getAll('slump'), getAll('pernos')]);
  const slumpF = dayIso ? slump.filter(r=> r.fecha === dayIso) : slump;
  const pernosF = dayIso ? pernos.filter(r=> r.fecha === dayIso) : pernos;
  const temps = slumpF.map(r=>Number(r.temp)).filter(v=>!Number.isNaN(v));
  const tProm = mean(temps);
  const tMin = temps.length ? Math.min(...temps) : null;
  const tMax = temps.length ? Math.max(...temps) : null;
  const hel = pernosF.reduce((a,r)=>a + (Number(r.cantHel)||0), 0);
  const sw = pernosF.reduce((a,r)=>a + (Number(r.cantSw) ||0), 0);
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

// -------------------------
// Botoneras BD/Reporte/Borrado
// -------------------------
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

// -------------------------
// Deletes
// -------------------------
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

// -------------------------
// Init / Defaults
// -------------------------
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
async function boot(){
  await openDB();
  initDefaults();
  wireTabs();
  wireSlumpDelay();
  wireFormSlump();
  wireResistUI();
  bindMetodoALive(); // cálculo en vivo para Método A
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
