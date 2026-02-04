/**********************
 * CONFIG (ajusta rangos)
 **********************/
const LIMITS = {
  slump: { min: 8, max: 11 },     // pulgadas OK (AJUSTA a tu CE)
  temp:  { warn: 28, bad: 35 },   // °C
  aire:  { min: 5.5, max: 7.5 }   // presión (bar típico)
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

/**********************
 * Slump: parse pulgadas con fracciones
 * Ej: 9 3/4", 10 1/4", 7/8", 9.75"
 **********************/
function parseInchFraction(input){
  if(input === null || input === undefined) return null;
  let s = String(input).trim();
  if(!s) return null;

  s = s.replace(/["”″]/g,'').trim();     // quitar comillas
  s = s.replace(/\s+/g,' ');

  // decimal directo
  if(/^\d+(\.\d+)?$/.test(s)){
    const v = Number(s);
    return { value: v, text: `${formatNum(v)}"` };
  }

  const parts = s.split(' ');
  let whole = 0;
  let frac = null;

  if(parts.length === 1){
    frac = parts[0]; // "7/8"
  } else if(parts.length === 2){
    whole = Number(parts[0]);
    frac = parts[1]; // "3/4"
    if(Number.isNaN(whole)) return null;
  } else {
    return null;
  }

  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if(!m) return null;

  const num = Number(m[1]);
  const den = Number(m[2]);
  if(!den || Number.isNaN(num) || Number.isNaN(den)) return null;

  const value = whole + (num/den);
  const text = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + `"`;
  return { value, text };
}

/**********************
 * Badges
 **********************/
function badgeChip(cls, text){
  return `<span class="badge-chip ${cls}">${esc(text)}</span>`;
}
function statusSlump(inches){
  if(inches === null || inches === undefined || Number.isNaN(inches)) return {cls:'neutral', text:'Sin dato'};
  if(inches < LIMITS.slump.min) return {cls:'warn', text:`Bajo (${formatNum(inches)}")`};
  if(inches > LIMITS.slump.max) return {cls:'warn', text:`Alto (${formatNum(inches)}")`};
  return {cls:'ok', text:`OK (${formatNum(inches)}")`};
}
function statusTemp(v){
  if(v === null || v === undefined || Number.isNaN(v)) return {cls:'neutral', text:'Sin dato'};
  if(v >= LIMITS.temp.bad) return {cls:'bad', text:`Alerta (${formatNum(v)}°C)`};
  if(v >= LIMITS.temp.warn) return {cls:'warn', text:`Alta (${formatNum(v)}°C)`};
  return {cls:'ok', text:`OK (${formatNum(v)}°C)`};
}
function statusAire(v){
  if(v === null || v === undefined || Number.isNaN(v)) return {cls:'neutral', text:'Sin dato'};
  if(v < LIMITS.aire.min) return {cls:'warn', text:`Baja (${formatNum(v)})`};
  if(v > LIMITS.aire.max) return {cls:'warn', text:`Alta (${formatNum(v)})`};
  return {cls:'ok', text:`OK (${formatNum(v)})`};
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
const DB_VER = 2; // subimos versión por cambios de schema (slumpIn/slumpText)
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

  // Slump (pulgadas)
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
    const ok = confirm('¿Seguro que deseas borrar TODO? No se puede deshacer. Exporta antes.');
    if(!ok) return;
    await clearStore('slump');
    await clearStore('resist');
    await clearStore('pernos');
    refreshDBTables();
    buildReport();
    alert('Listo: Base de datos borrada.');
  });

  // Reporte botones
  $('#btnReporte').addEventListener('click', buildReport);
  $('#btnReporteTodo').addEventListener('click', ()=>{
    $('#rDesde').value=''; $('#rHasta').value='';
    buildReport();
  });

  $('#btnPDF').addEventListener('click', exportReportPDF);
  $('#btnShareImg').addEventListener('click', shareReportImage);

  // Export/Import global
  $('#btnExport').addEventListener('click', exportJSON);
  $('#importFile').addEventListener('change', importJSON);
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
    const s1 = statusSlump(Number(r.slumpIn));
    const s2 = statusTemp(Number(r.temp));
    const s3 = statusAire(Number(r.presionAire));
    const estado = badgeChip(s1.cls, s1.text) + badgeChip(s2.cls, s2.text) + badgeChip(s3.cls, s3.text);

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
      {label:'Estado', html: estado},
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
 * Export / Import JSON
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
  a.click(); a.remove();
}

async function importJSON(e){
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  let data;
  try{ data = JSON.parse(text); }catch{ alert('Archivo inválido.'); return; }

  const ok = confirm('Importar fusionará datos (no borra). ¿Continuar?');
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
  refreshDBTables();
  buildReport();
}

/**********************
 * Reporte: Lollipop charts (modernos)
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
function truncate(s,n){ s=String(s); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function rangoCaption(desde,hasta){
  if(!desde && !hasta) return 'Todo el historial';
  if(desde && !hasta) return `Desde ${desde}`;
  if(!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
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

  // layout horizontal: categorías en vertical
  const padL = 150;
  const padR = 24;
  const padT = 38;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  ctx.font = '12px system-ui';
  ctx.fillStyle = MUT;
  ctx.textAlign = 'left';
  ctx.fillText(caption || '', padL, 18);

  const n = labels.length || 1;
  const rowH = plotH / n;
  const maxV = Math.max(1, ...values);

  // grid vertical 5
  ctx.strokeStyle = 'rgba(17,24,39,.10)';
  for(let i=0;i<=5;i++){
    const x = padL + (plotW*(i/5));
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }

  for(let i=0;i<n;i++){
    const y = padT + rowH*i + rowH/2;
    const v = values[i] || 0;
    const xVal = padL + (v/maxV) * plotW;

    // etiqueta
    ctx.fillStyle = TXT;
    ctx.textAlign = 'right';
    ctx.fillText(truncate(labels[i], 18), padL - 10, y + 4);

    // línea
    ctx.strokeStyle = 'rgba(249,115,22,.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(xVal, y);
    ctx.stroke();

    // punto
    ctx.fillStyle = ACC;
    ctx.beginPath();
    ctx.arc(xVal, y, 6, 0, Math.PI*2);
    ctx.fill();

    // valor
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

  const gSl = groupByLabor(sl);
  const gPe = groupByLabor(pe);

  const labores = Array.from(new Set([...gSl.keys(), ...gPe.keys()])).sort((a,b)=>a.localeCompare(b));

  const slumpVals = labores.map(l=>{
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.slumpIn)||0)) : 0;
  });

  const tempVals = labores.map(l=>{
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.temp)||0)) : 0;
  });

  const aireVals = labores.map(l=>{
    const rows = gSl.get(l) || [];
    return rows.length ? mean(rows.map(r=>Number(r.presionAire)||0)) : 0;
  });

  const pernosVals = labores.map(l=>{
    const rows = gPe.get(l) || [];
    return sum(rows.map(r => (Number(r.helicoidal)||0) + (Number(r.swellex)||0)));
  });

  // Dibujar moderno
  drawLollipopChart($('#chartSlump'), labores, slumpVals, '"', caption);
  drawLollipopChart($('#chartTemp'), labores, tempVals, '°C', caption);
  drawLollipopChart($('#chartAire'), labores, aireVals, '', caption);
  drawLollipopChart($('#chartPernos'), labores, pernosVals, '', caption);

  // Resumen
  const totalSl = sl.length;
  const totalPe = pe.reduce((acc,r)=> acc + (Number(r.helicoidal)||0) + (Number(r.swellex)||0), 0);
  const promSlump = totalSl ? mean(sl.map(r=>Number(r.slumpIn)||0)) : 0;
  const promTemp = totalSl ? mean(sl.map(r=>Number(r.temp)||0)) : 0;
  const promAire = totalSl ? mean(sl.map(r=>Number(r.presionAire)||0)) : 0;

  $('#resumenReporte').innerHTML = `
    <ul>
      <li><strong>Rango:</strong> ${caption}</li>
      <li><strong>Registros Slump:</strong> ${totalSl}</li>
      <li><strong>Pernos instalados:</strong> ${formatNum(totalPe)} unid.</li>
      <li><strong>Promedios globales:</strong> Slump ${formatNum(promSlump)}" • T° ${formatNum(promTemp)}°C • Presión ${formatNum(promAire)}</li>
      <li><strong>Labores:</strong> ${labores.length}</li>
    </ul>
  `;
}

/**********************
 * PDF: Vista de impresión (Guardar como PDF)
 **********************/
function exportReportPDF(){
  // Genera una página imprimible con los charts como imágenes
  const desde = $('#rDesde').value || '';
  const hasta = $('#rHasta').value || '';
  const caption = rangoCaption(desde||null, hasta||null);

  const charts = [
    {title:'Slump (") promedio por Labor', id:'chartSlump'},
    {title:'Temperatura (°C) promedio por Labor', id:'chartTemp'},
    {title:'Presión de aire promedio por Labor', id:'chartAire'},
    {title:'Pernos instalados por Labor', id:'chartPernos'}
  ].map(c => ({
    title: c.title,
    dataUrl: document.getElementById(c.id).toDataURL('image/png')
  }));

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
      img{ width:100%; height:auto; border:1px solid #e5e7eb; border-radius:12px; }
      h2{ margin:0 0 6px; }
      h3{ margin:0 0 10px; font-size:14px; }
      @media print{
        .grid{ grid-template-columns: 1fr 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="head">
      <div>
        <div class="brand">CE Offline - Reporte</div>
        <div class="muted">Rango: <strong>${caption}</strong></div>
      </div>
      <div class="tag">PLOMO + NARANJA</div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Resumen</h3>
      ${resumen}
    </div>

    <div class="grid">
      ${charts.map(c=>`
        <div class="card">
          <h3>${c.title}</h3>
          <img src="${c.dataUrl}" />
        </div>
      `).join('')}
    </div>

    <script>
      setTimeout(()=>{ window.print(); }, 450);
    </script>
  </body>
  </html>
  `;

  const w = window.open('', '_blank');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/**********************
 * Compartir Imagen (PNG) listo para WhatsApp
 **********************/
async function shareReportImage(){
  // compone un lienzo vertical con los 4 charts
  const canvases = ['chartSlump','chartTemp','chartAire','chartPernos'].map(id => document.getElementById(id));
  const title = 'CE Reporte';
  const caption = rangoCaption($('#rDesde').value||null, $('#rHasta').value||null);

  const out = document.createElement('canvas');
  const W = 1200;
  const pad = 30;
  const blockH = 420;
  const H = pad*3 + 100 + blockH*4;
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');

  // fondo blanco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);

  // encabezado
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px Arial';
  ctx.fillText(title, pad, 50);
  ctx.fillStyle = '#6B7280';
  ctx.font = '16px Arial';
  ctx.fillText(`Rango: ${caption}`, pad, 78);

  // línea naranja
  ctx.strokeStyle = '#F97316';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(pad, 92);
  ctx.lineTo(W-pad, 92);
  ctx.stroke();

  // pegar charts
  let y = 110;
  for(const c of canvases){
    // escalar cada canvas al ancho
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(res=>{ img.onload = res; });

    const targetW = W - pad*2;
    const ratio = img.height / img.width;
    const targetH = Math.round(targetW * ratio);

    ctx.drawImage(img, pad, y, targetW, targetH);
    y += targetH + pad;
  }

  // export blob
  const blob = await new Promise(res=> out.toBlob(res, 'image/png', 0.95));
  const file = new File([blob], `CE_Reporte_${todayISO()}.png`, {type:'image/png'});

  // share si el navegador lo soporta
  if(navigator.canShare && navigator.canShare({files:[file]})){
    await navigator.share({
      title: 'Reporte CE',
      text: `Reporte CE (${caption})`,
      files: [file]
    });
  } else {
    // fallback: descargar
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    alert('Se descargó la imagen. Luego la puedes enviar por WhatsApp.');
  }
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
