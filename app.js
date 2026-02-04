// CE Offline App - IndexedDB + gráficos simples en Canvas

/**********************
 * Utilidades
 **********************/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid(){
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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
  // iso: YYYY-MM-DD
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

      // refrescos puntuales
      if(name==='bd') refreshDBTables();
      if(name==='reporte') buildReport();
    });
  });
}

/**********************
 * Formularios
 **********************/
function initForms(){
  // Defaults de fecha
  ['#formSlump input[name=fecha]','#formResist input[name=fecha]','#formPernos input[name=fecha]', '#fDesde', '#fHasta', '#rDesde', '#rHasta']
    .forEach(sel=>{ const el=$(sel); if(el) el.value = todayISO(); });

  // Pernos: habilitar cantidades por checkbox
  const chkHel = $('#chkHel');
  const chkSw = $('#chkSw');
  const cantHel = $('#cantHel');
  const cantSw = $('#cantSw');
  const syncPernosInputs = ()=>{
    cantHel.disabled = !chkHel.checked;
    cantSw.disabled = !chkSw.checked;
    if(!chkHel.checked) cantHel.value = 0;
    if(!chkSw.checked) cantSw.value = 0;
  };
  chkHel.addEventListener('change', syncPernosInputs);
  chkSw.addEventListener('change', syncPernosInputs);

  // TAB1 - Slump
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

  // TAB2 - Resistencias
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

  // TAB3 - Pernos
  $('#formPernos').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);

    const hel = $('#chkHel').checked ? Number(fd.get('cantHel')||0) : 0;
    const sw = $('#chkSw').checked ? Number(fd.get('cantSw')||0) : 0;

    if(hel===0 && sw===0){
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
    // reset checkboxes/inputs
    $('#chkHel').checked = false; $('#chkSw').checked = false;
    $('#cantHel').value = 0; $('#cantSw').value = 0;
    $('#cantHel').disabled = true; $('#cantSw').disabled = true;
    refreshRecent();
  });

  // Filtro BD
  $('#btnFiltrar').addEventListener('click', refreshDBTables);
  $('#btnLimpiarFiltro').addEventListener('click', ()=>{
    $('#fDesde').value=''; $('#fHasta').value='';
    refreshDBTables();
  });

  // Borrar todo
  $('#btnBorrarTodo').addEventListener('click', async ()=>{
    const ok = confirm('¿Seguro que deseas borrar TODO? Esta acción no se puede deshacer. Recomendación: Exporta antes.');
    if(!ok) return;
    await clearStore('slump');
    await clearStore('resist');
    await clearStore('pernos');
    refreshRecent();
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

  // Export / Import
  $('#btnExport').addEventListener('click', exportJSON);
  $('#importFile').addEventListener('change', importJSON);
}

/**********************
 * Tablas (Recientes y BD)
 **********************/

function row(td){ const tr=document.createElement('tr'); td.forEach(x=>{const c=document.createElement('td'); c.innerHTML=x; tr.appendChild(c);}); return tr; }

function delBtn(store, id){
  return `<button class="btn btn-danger" data-del="${store}:${id}" title="Eliminar">Eliminar</button>`;
}

async function refreshRecent(){
  // muestra 8 últimos de cada tipo
  const [sl, re, pe] = await Promise.all([getAll('slump'), getAll('resist'), getAll('pernos')]);

  const last = (arr)=> arr
    .slice()
    .sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''))
    .slice(0,8);

  const slb = $('#slumpRecent tbody'); slb.innerHTML='';
  last(sl).forEach(r=> slb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), r.slump, r.temp, r.presionAire
  ])));

  const reb = $('#resistRecent tbody'); reb.innerHTML='';
  last(re).forEach(r=> reb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), esc(r.edad), r.resistencia
  ])));

  const peb = $('#pernosRecent tbody'); peb.innerHTML='';
  last(pe).forEach(r=> peb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), r.helicoidal||0, r.swellex||0
  ])));
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function refreshDBTables(){
  const desde = $('#fDesde').value || null;
  const hasta = $('#fHasta').value || null;

  const [sl, re, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('resist', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  const slb = $('#tblSlump tbody'); slb.innerHTML='';
  sl.forEach(r=> slb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), r.slump, r.temp, r.presionAire, esc(r.mixerHS), r.hll, delBtn('slump', r.id)
  ])));

  const reb = $('#tblResist tbody'); reb.innerHTML='';
  re.forEach(r=> reb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), esc(r.edad), r.resistencia, delBtn('resist', r.id)
  ])));

  const peb = $('#tblPernos tbody'); peb.innerHTML='';
  pe.forEach(r=> peb.appendChild(row([
    r.fecha, r.hora, esc(r.labor), esc(r.nivel), r.helicoidal||0, r.swellex||0, delBtn('pernos', r.id)
  ])));

  // eventos eliminar
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
  try{ data = JSON.parse(text); }catch(err){ alert('Archivo inválido.'); return; }

  const ok = confirm('Importar fusionará datos con los existentes (no borra). ¿Continuar?');
  if(!ok) return;

  const importStore = async (name, rows)=>{
    if(!Array.isArray(rows)) return;
    // Insertar uno por uno. Si el id ya existe, generar uno nuevo.
    for(const r of rows){
      const rec = {...r};
      if(!rec.id) rec.id = uid(); else rec.id = rec.id + '_imp_' + Math.random().toString(16).slice(2);
      try{ await addRecord(name, rec); }catch(_){ /* skip */ }
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
 * Reporte y Gráficos
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

function mean(arr){
  if(!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function sum(arr){
  return arr.reduce((a,b)=>a+b,0);
}

function drawBarChart(canvas, labels, values, opts={}){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const padL = 56, padR = 18, padT = 18, padB = 70;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // fondo
  ctx.fillStyle = '#0b1326';
  ctx.fillRect(0,0,W,H);

  // ejes
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+plotH);
  ctx.lineTo(padL+plotW, padT+plotH);
  ctx.stroke();

  const maxV = Math.max(1, ...values);
  const niceMax = niceNumber(maxV);

  // ticks
  ctx.fillStyle = 'rgba(255,255,255,.65)';
  ctx.font = '12px system-ui';
  const ticks = 5;
  for(let i=0;i<=ticks;i++){
    const v = niceMax * (i/ticks);
    const y = padT + plotH - (v/niceMax)*plotH;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL+plotW, y);
    ctx.stroke();
    ctx.fillText(formatNum(v), 8, y+4);
  }

  // barras
  const n = labels.length || 1;
  const gap = Math.max(6, plotW * 0.03 / n);
  const barW = (plotW - gap*(n+1)) / n;

  for(let i=0;i<n;i++){
    const v = values[i] || 0;
    const x = padL + gap + i*(barW+gap);
    const h = (v/niceMax)*plotH;
    const y = padT + plotH - h;

    // gradiente
    const g = ctx.createLinearGradient(0,y,0,y+h);
    g.addColorStop(0, opts.colorTop || 'rgba(15,121,208,.95)');
    g.addColorStop(1, opts.colorBottom || 'rgba(11,92,171,.75)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, barW, h);

    // valor encima
    ctx.fillStyle = 'rgba(232,240,255,.92)';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(formatNum(v), x+barW/2, y-6);

    // etiqueta (rotada)
    const label = labels[i];
    ctx.save();
    ctx.translate(x+barW/2, padT+plotH+52);
    ctx.rotate(-Math.PI/6);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.textAlign = 'center';
    ctx.fillText(truncate(label, 18), 0, 0);
    ctx.restore();
  }

  // título opcional
  if(opts.caption){
    ctx.fillStyle='rgba(255,255,255,.75)';
    ctx.textAlign='left';
    ctx.font='12px system-ui';
    ctx.fillText(opts.caption, padL, 14);
  }
}

function niceNumber(maxV){
  // redondeo a 1-2-5 * 10^n
  const exp = Math.floor(Math.log10(maxV));
  const f = maxV / Math.pow(10, exp);
  let nf = 1;
  if(f<=1) nf=1; else if(f<=2) nf=2; else if(f<=5) nf=5; else nf=10;
  return nf * Math.pow(10, exp);
}

function formatNum(v){
  if(Number.isInteger(v)) return String(v);
  return (Math.round(v*100)/100).toFixed(2).replace(/\.00$/,'');
}

function truncate(s, n){
  s = String(s);
  return s.length>n ? s.slice(0,n-1)+'…' : s;
}

async function buildReport(){
  const desde = $('#rDesde').value || null;
  const hasta = $('#rHasta').value || null;

  const [sl, pe] = await Promise.all([
    getAllFiltered('slump', desde, hasta),
    getAllFiltered('pernos', desde, hasta)
  ]);

  // Slump/temp/aire por labor
  const gSl = groupByLabor(sl);
  const labores = Array.from(new Set([...gSl.keys(), ...groupByLabor(pe).keys()])).sort((a,b)=>a.localeCompare(b));

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

  // Pernos por labor (suma)
  const gPe = groupByLabor(pe);
  const pernosVals = labores.map(l => {
    const rows = gPe.get(l) || [];
    return sum(rows.map(r => (Number(r.helicoidal)||0) + (Number(r.swellex)||0)));
  });

  // Dibujar
  drawBarChart($('#chartSlump'), labores, slumpVals, {caption: rangoCaption(desde,hasta)});
  drawBarChart($('#chartTemp'), labores, tempVals, {colorTop:'rgba(46,204,113,.92)', colorBottom:'rgba(39,174,96,.75)', caption: rangoCaption(desde,hasta)});
  drawBarChart($('#chartAire'), labores, aireVals, {colorTop:'rgba(241,196,15,.92)', colorBottom:'rgba(243,156,18,.75)', caption: rangoCaption(desde,hasta)});
  drawBarChart($('#chartPernos'), labores, pernosVals, {colorTop:'rgba(155,89,182,.92)', colorBottom:'rgba(142,68,173,.75)', caption: rangoCaption(desde,hasta)});

  // Resumen
  const totalSl = sl.length;
  const totalPe = pe.reduce((acc,r)=> acc + (Number(r.helicoidal)||0) + (Number(r.swellex)||0), 0);
  const promSlump = totalSl ? mean(sl.map(r=>Number(r.slump)||0)) : 0;
  const promTemp = totalSl ? mean(sl.map(r=>Number(r.temp)||0)) : 0;
  const promAire = totalSl ? mean(sl.map(r=>Number(r.presionAire)||0)) : 0;

  $('#resumenReporte').innerHTML = `
    <ul>
      <li><strong>Rango:</strong> ${rangoCaption(desde,hasta)}</li>
      <li><strong>Registros Slump:</strong> ${totalSl}</li>
      <li><strong>Pernos instalados:</strong> ${formatNum(totalPe)} unid.</li>
      <li><strong>Promedios globales:</strong> Slump ${formatNum(promSlump)} mm • T° ${formatNum(promTemp)} °C • Presión Aire ${formatNum(promAire)}</li>
      <li><strong>Labores consideradas:</strong> ${labores.length}</li>
    </ul>
  `;
}

function rangoCaption(desde,hasta){
  if(!desde && !hasta) return 'Todo el historial';
  if(desde && !hasta) return `Desde ${desde}`;
  if(!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
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
  // tablas y reportes al inicio
  await refreshDBTables();
  await buildReport();
})();
