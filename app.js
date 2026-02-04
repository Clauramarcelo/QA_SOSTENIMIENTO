// CE Offline App - IndexedDB + Reportes + Tablas responsive tipo Cards + Badges

/**********************
 * CONFIG (Rangos para badges)
 * Ajusta estos valores según tu CE real.
 **********************/
const LIMITS = {
  slump: { min: 60, max: 100 },        // mm
  temp:  { warn: 28, bad: 35 },        // °C
  aire:  { min: 5.5, max: 7.5 }        // presión (bar típico, ajustable)
};

// Helpers DOM
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

/**********************
 * Badges (estado)
 **********************/
function badgeChip(cls, text){
  return `<span class="badge-chip ${cls}">${esc(text)}</span>`;
}

function statusSlump(v){
  if(v === null || v === undefined || Number.isNaN(v)) return {cls:'neutral', text:'Sin dato'};
  if(v < LIMITS.slump.min) return {cls:'warn', text:`Bajo (${v})`};
  if(v > LIMITS.slump.max) return {cls:'warn', text:`Alto (${v})`};
  return {cls:'ok', text:`OK (${v})`};
}

function statusTemp(v){
  if(v === null || v === undefined || Number.isNaN(v)) return {cls:'neutral', text:'Sin dato'};
  if(v >= LIMITS.temp.bad) return {cls:'bad', text:`Alerta (${v}°C)`};
  if(v >= LIMITS.temp.warn) return {cls:'warn', text:`Alta (${v}°C)`};
  return {cls:'ok', text:`OK (${v}°C)`};
}

function statusAire(v){
  if(v === null || v === undefined || Number.isNaN(v)) return {cls:'neutral', text:'Sin dato'};
  if(v < LIMITS.aire.min) return {cls:'warn', text:`Baja (${v})`};
  if(v > LIMITS.aire.max) return {cls:'warn', text:`Alta (${v})`};
  return {cls:'ok', text:`OK (${v})`};
}

function statusPernos(hel, sw){
  const total = (Number(hel)||0) + (Number(sw)||0);
  if(total <= 0) return {cls:'warn', text:'0 pernos'};
  if(total < 5) return {cls:'neutral', text:`Pocos (${total})`};
  return {cls:'ok', text:`OK (${total})`};
}

/**********************
 * IndexedDB
 **********************/
const DB_NAME = 'ce_qc_db';
const DB_VER = 1;
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
 * UI Tabs
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
 * Row builder: crea TDs con data-label (para cards en móvil)
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
  return `<button class="btn btn-danger" data-del="${store}:${id}" title="Eliminar">Eliminar</button>`;
}

/**********************
 * Formularios
 **********************/
function initForms(){
  // defaults
  ['#formSlump input[name=fecha]','#formResist input[name=fecha]','#formPernos input[name=fecha]', '#fDesde', '#fHasta', '#rDesde', '#rHasta']
    .forEach(sel=>{ const el=$(sel); if(el) el.value = todayISO(); });

  // pernos
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
    const rec = {
      fecha: fd.get('fecha'),
      hora: fd.get('horaSlump'),
      labor: (fd.get('labor')||'').trim(),
      nivel: (fd.get('nivel')||'').trim(),
      slump: Number(fd.get('slump')),
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
    refreshRecent();
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
    refreshRecent();
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
    refreshRecent();
  });

  // filtros BD
  $('#btnFiltrar').addEventListener('click', refreshDBTables);
  $('#btnLimpiarFiltro').addEventListener('click', ()=>{
    $('#fDesde').value=''; $('#fHasta').value='';
    refreshDBTables();
  });

  // borrar todo
  $('#btnBorrarTodo').addEventListener('click', async ()=>{
    const ok = confirm('¿Seguro que deseas borrar TODO? No se puede deshacer. Recomendación: Exporta antes.');
    if(!ok) return;
    await clearStore('slump');
    await clearStore('resist');
    await clearStore('pernos');
    refreshRecent();
    refreshDBTables();
    buildReport();
    alert('Listo: Base de datos borrada.');
  });

  // reporte
  $('#btnReporte').addEventListener('click', buildReport);
  $('#btnReporteTodo').addEventListener('click', ()=>{
    $('#rDesde').value=''; $('#rHasta').value='';
    buildReport();
  });

  // export/import
  $('#btnExport').addEventListener('click', exportJSON);
  $('#importFile').addEventListener('change', importJSON);
}

/**********************
 * Tablas (Recientes y BD)
 **********************/
async function refreshRecent(){
  const [sl, re, pe] = await Promise.all([getAll('slump'), getAll('resist'), getAll('pernos')]);

  const last = (arr)=> arr.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,8);

  // Slump recientes
  const slb = $('#slumpRecent tbody'); slb.innerHTML='';
  last(sl).forEach(r=>{
    const s1 = statusSlump(Number(r.slump));
    const s2 = statusTemp(Number(r.temp));
    const s3 = statusAire(Number(r.presionAire));

    const estado = badgeChip(s1.cls, s1.text) + ' ' + badgeChip(s2.cls, s2.text) + ' ' + badgeChip(s3.cls, s3.text);

    slb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Slump', html: `${formatNum(r.slump)} mm`},
      {label:'T°', html: `${formatNum(r.temp)} °C`},
      {label:'Presión', html: `${formatNum(r.presionAire)}`},
      {label:'Estado', html: estado}
    ]));
  });

  // Resist recientes
  const reb = $('#resistRecent tbody'); reb.innerHTML='';
  last(re).forEach(r=>{
    reb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Edad', html: esc(r.edad)},
      {label:'MPa', html: formatNum(r.resistencia)}
    ]));
  });

  // Pernos recientes
  const peb = $('#pernosRecent tbody'); peb.innerHTML='';
  last(pe).forEach(r=>{
    const st = statusPernos(r.helicoidal, r.swellex);
    const estado = badgeChip(st.cls, st.text);

    peb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Helicoidal', html: formatNum(r.helicoidal || 0)},
      {label:'Swellex', html: formatNum(r.swellex || 0)},
      {label:'Estado', html: estado}
    ]));
  });
}

async function refreshDBTables(){
  const desde = $('#fDesde').value || null;
  const hasta = $('#fHasta').value || null;

  const [sl, re, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('resist', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  // Slump BD
  const slb = $('#tblSlump tbody'); slb.innerHTML='';
  sl.forEach(r=>{
    const s1 = statusSlump(Number(r.slump));
    const s2 = statusTemp(Number(r.temp));
    const s3 = statusAire(Number(r.presionAire));
    const estado = badgeChip(s1.cls, s1.text) + ' ' + badgeChip(s2.cls, s2.text) + ' ' + badgeChip(s3.cls, s3.text);

    slb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Slump', html: `${formatNum(r.slump)} mm`},
      {label:'T°', html: `${formatNum(r.temp)} °C`},
      {label:'Presión', html: `${formatNum(r.presionAire)}`},
      {label:'Mixer/HS', html: esc(r.mixerHS)},
      {label:'H_LL', html: esc(r.hll)},
      {label:'Estado', html: estado},
      {label:'Acción', html: delBtn('slump', r.id)}
    ]));
  });

  // Resist BD
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

  // Pernos BD
  const peb = $('#tblPernos tbody'); peb.innerHTML='';
  pe.forEach(r=>{
    const st = statusPernos(r.helicoidal, r.swellex);
    const estado = badgeChip(st.cls, st.text);

    peb.appendChild(makeRow([
      {label:'Fecha', html: esc(r.fecha)},
      {label:'Hora', html: esc(r.hora)},
      {label:'Labor', html: esc(r.labor)},
      {label:'Nivel', html: esc(r.nivel)},
      {label:'Helicoidal', html: formatNum(r.helicoidal || 0)},
      {label:'Swellex', html: formatNum(r.swellex || 0)},
      {label:'Estado', html: estado},
      {label:'Acción', html: delBtn('pernos', r.id)}
    ]));
  });

  // evento eliminar
  $$('[data-del]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [store,id] = b.dataset.del.split(':');
      const ok = confirm('¿Eliminar este registro?');
      if(!ok) return;
      await deleteRecord(store, id);
      refreshDBTables();
      refreshRecent();
      buildReport();
    });
  });
}

/**********************
 * Export / Import
 **********************/
async function exportJSON(){
  const data = {
    exportedAt: new Date().toISOString(),
    app: 'CE Offline',
    slump: await getAll('slump'),
    resist: await getAll('resist'),
    pernos: await getAll('pernos')
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CE_backup_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function importJSON(e){
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  let data;
  try{ data = JSON.parse(text); }catch{ alert('Archivo inválido.'); return; }

  const ok = confirm('Importar fusionará datos con los existentes (no borra). ¿Continuar?');
  if(!ok) return;

  const importStore = async (name, rows)=>{
    if(!Array.isArray(rows)) return;
    for(const r of rows){
      const rec = {...r};
      rec.id = (rec.id ? (rec.id + '_imp_' + Math.random().toString(16).slice(2)) : uid());
      try{ await addRecord(name, rec); }catch(_){}
    }
  };

  await importStore('slump', data.slump);
  await importStore('resist', data.resist);
  await importStore('pernos', data.pernos);

  alert('Importación completada.');
  e.target.value='';
  refreshRecent();
  refreshDBTables();
  buildReport();
}

/**********************
 * Reporte y gráficos (tema claro + naranja)
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
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }

function niceNumber(maxV){
  const exp = Math.floor(Math.log10(maxV));
  const f = maxV / Math.pow(10, exp);
  let nf = 1;
  if(f<=1) nf=1; else if(f<=2) nf=2; else if(f<=5) nf=5; else nf=10;
  return nf * Math.pow(10, exp);
}
function truncate(s, n){
  s = String(s);
  return s.length>n ? s.slice(0,n-1)+'…' : s;
}
function rangoCaption(desde,hasta){
  if(!desde && !hasta) return 'Todo el historial';
  if(desde && !hasta) return `Desde ${desde}`;
  if(!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
}

function drawBarChart(canvas, labels, values, opts={}){
  const ctx = canvas.getContext('2d');

  const css = getComputedStyle(document.documentElement);
  const BG  = (opts.bg || css.getPropertyValue('--surface').trim() || '#ffffff');
  const TXT = (opts.text || css.getPropertyValue('--text').trim() || '#111827');

  const GRID = 'rgba(17,24,39,.10)';
  const AXIS = 'rgba(17,24,39,.18)';

  const TOP = (opts.colorTop || css.getPropertyValue('--accent').trim() || '#F97316');
  const BOT = (opts.colorBottom || css.getPropertyValue('--accent2').trim() || '#FB923C');

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const padL = 56, padR = 18, padT = 18, padB = 70;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  ctx.fillStyle = BG;
  ctx.fillRect(0,0,W,H);

  // Ejes
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+plotH);
  ctx.lineTo(padL+plotW, padT+plotH);
  ctx.stroke();

  const maxV = Math.max(1, ...values);
  const niceMax = niceNumber(maxV);

  // Ticks
  ctx.font = '12px system-ui';
  const ticks = 5;
  for(let i=0;i<=ticks;i++){
    const v = niceMax*(i/ticks);
    const y = padT + plotH - (v/niceMax)*plotH;

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL+plotW, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(17,24,39,.75)';
    ctx.textAlign = 'left';
    ctx.fillText(formatNum(v), 8, y+4);
  }

  // Barras
  const n = labels.length || 1;
  const gap = Math.max(6, plotW * 0.03 / n);
  const barW = (plotW - gap*(n+1)) / n;

  for(let i=0;i<n;i++){
    const v = values[i] || 0;
    const x = padL + gap + i*(barW+gap);
    const h = (v/niceMax)*plotH;
    const y = padT + plotH - h;

    const g = ctx.createLinearGradient(0,y,0,y+h);
    g.addColorStop(0, TOP);
    g.addColorStop(1, BOT);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, barW, h);

    // valor
    ctx.fillStyle = TXT;
    ctx.textAlign = 'center';
    ctx.fillText(formatNum(v), x+barW/2, Math.max(14, y-6));

    // etiqueta
    const label = labels[i];
    ctx.save();
    ctx.translate(x+barW/2, padT+plotH+52);
    ctx.rotate(-Math.PI/6);
    ctx.fillStyle = 'rgba(17,24,39,.78)';
    ctx.textAlign = 'center';
    ctx.fillText(truncate(label, 18), 0, 0);
    ctx.restore();
  }

  // caption
  if(opts.caption){
    ctx.fillStyle='rgba(17,24,39,.65)';
    ctx.textAlign='left';
    ctx.fillText(opts.caption, padL, 14);
  }
}

async function buildReport(){
  const desde = $('#rDesde').value || null;
  const hasta = $('#rHasta').value || null;

  const [sl, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  const gSl = groupByLabor(sl);
  const gPe = groupByLabor(pe);

  const labores = Array.from(new Set([...gSl.keys(), ...gPe.keys()])).sort((a,b)=>a.localeCompare(b));

  const slumpVals = labores.map(l => {
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.slump)||0)) : 0;
  });

  const tempVals = labores.map(l => {
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.temp)||0)) : 0;
  });

  const aireVals = labores.map(l => {
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.presionAire)||0)) : 0;
  });

  const pernosVals = labores.map(l => {
    const rows = gPe.get(l) || [];
    return sum(rows.map(r => (Number(r.helicoidal)||0) + (Number(r.swellex)||0)));
  });

  const caption = rangoCaption(desde,hasta);

  // Slump & Pernos (naranja)
  drawBarChart($('#chartSlump'), labores, slumpVals, {caption});
  drawBarChart($('#chartPernos'), labores, pernosVals, {caption});

  // Temp & Aire (gris/naranja suave, sigue paleta)
  drawBarChart($('#chartTemp'), labores, tempVals, {
    caption,
    colorTop: 'rgba(107,114,128,.92)',
    colorBottom: 'rgba(156,163,175,.82)'
  });

  drawBarChart($('#chartAire'), labores, aireVals, {
    caption,
    colorTop: 'rgba(249,115,22,.78)',
    colorBottom: 'rgba(251,146,60,.62)'
  });

  // resumen
  const totalSl = sl.length;
  const totalPe = pe.reduce((acc,r)=> acc + (Number(r.helicoidal)||0) + (Number(r.swellex)||0), 0);

  const promSlump = totalSl ? mean(sl.map(r=>Number(r.slump)||0)) : 0;
  const promTemp = totalSl ? mean(sl.map(r=>Number(r.temp)||0)) : 0;
  const promAire = totalSl ? mean(sl.map(r=>Number(r.presionAire)||0)) : 0;

  $('#resumenReporte').innerHTML = `
    <ul>
      <li><strong>Rango:</strong> ${caption}</li>
      <li><strong>Registros Slump:</strong> ${totalSl}</li>
      <li><strong>Pernos instalados:</strong> ${formatNum(totalPe)} unid.</li>
      <li><strong>Promedios globales:</strong> Slump ${formatNum(promSlump)} mm • T° ${formatNum(promTemp)} °C • Presión ${formatNum(promAire)}</li>
      <li><strong>Labores consideradas:</strong> ${labores.length}</li>
    </ul>
  `;
}

/**********************
 * Estado Offline
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
  await refreshRecent();
  await refreshDBTables();
  await buildReport();
})();
