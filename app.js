/***********************
 * CONFIG
 ***********************/
const LIMITS = {
  slump: { min: 8, max: 11 } // pulgadas OK
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid(){ return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function todayISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function setStatus(el, msg, ms=2500){
  if (!el) return;
  el.textContent = msg;
  if (ms) setTimeout(()=>{ if (el.textContent===msg) el.textContent=''; }, ms);
}
function parseDateISO(iso){
  if (!iso) return null;
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}
function inRange(dateIso, desdeIso, hastaIso){
  if (!desdeIso && !hastaIso) return true;
  const x = parseDateISO(dateIso);
  const d0 = desdeIso ? parseDateISO(desdeIso) : null;
  const d1 = hastaIso ? parseDateISO(hastaIso) : null;
  if (d0 && x < d0) return false;
  if (d1 && x > d1) return false;
  return true;
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
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v*100)/100).toFixed(2).replace(/\.00$/,'');
}
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function truncate(s,n){ s=String(s ?? ''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function rangoCaption(desde,hasta){
  if (!desde && !hasta) return 'Todo el historial';
  if (desde && !hasta) return `Desde ${desde}`;
  if (!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
}

/***********************
 * Slump: pulgadas con fracciones
 ***********************/
function parseInchFraction(input){
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;

  s = s.replace(/["”″]/g,'').trim();     // quitar comillas
  s = s.replace(/\s+/g,' ');

  // decimal directo
  if (/^\d+(\.\d+)?$/.test(s)){
    const v = Number(s);
    return { value: v, text: `${formatNum(v)}"` };
  }
  // "a b/c" o "b/c"
  const parts = s.split(' ');
  let whole = 0, frac = null;
  if (parts.length === 1){
    frac = parts[0];
  } else if (parts.length === 2){
    whole = Number(parts[0]);
    frac = parts[1];
    if (Number.isNaN(whole)) return null;
  } else return null;

  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!den) return null;

  const value = whole + (num/den);
  const text = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + `"`;
  return { value, text };
}

/***********************
 * IndexedDB
 ***********************/
const DB_NAME = 'ce_qc_db';
const DB_VER  = 3; // subimos versión (no rompe datos, solo asegura upgrade)
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const dbx = e.target.result;

      const mkStore = (name) => {
        if (!dbx.objectStoreNames.contains(name)){
          const s = dbx.createObjectStore(name, { keyPath:'id' });
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
