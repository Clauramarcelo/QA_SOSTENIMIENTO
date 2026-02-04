/***********************
 * CONFIG
 ***********************/
const LIMITS = {
  slump: { min: 8, max: 11 }, // pulgadas (ajusta)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function setStatus(el, msg, ms = 2500) {
  if (!el) return;
  el.textContent = msg;
  if (ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
}
function parseDateISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function inRange(dateIso, desdeIso, hastaIso) {
  if (!desdeIso && !hastaIso) return true;
  const x = parseDateISO(dateIso);
  const d0 = desdeIso ? parseDateISO(desdeIso) : null;
  const d1 = hastaIso ? parseDateISO(hastaIso) : null;
  if (d0 && x < d0) return false;
  if (d1 && x > d1) return false;
  return true;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[m]));
}
function formatNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, "");
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function truncate(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function rangoCaption(desde, hasta) {
  if (!desde && !hasta) return "Todo el historial";
  if (desde && !hasta) return `Desde ${desde}`;
  if (!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} a ${hasta}`;
}

/***********************
 * Slump: pulgadas con fracciones
 ***********************/
function parseInchFraction(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;

  s = s.replace(/["”″]/g, "").trim(); // quitar comillas
  s = s.replace(/\s+/g, " ");

  // decimal directo
  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    return { value: v, text: `${formatNum(v)}"` };
  }

  // "a b/c" o "b/c"
  const parts = s.split(" ");
  let whole = 0, frac = null;

  if (parts.length === 1) frac = parts[0];
  else if (parts.length === 2) {
    whole = Number(parts[0]);
    frac = parts[1];
    if (Number.isNaN(whole)) return null;
  } else return null;

  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(frac);
  if (!m) return null;

  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!den) return null;

  const value = whole + (num / den);
  const text = (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) + `"`;
  return { value, text };
}

/***********************
 * IndexedDB
 ***********************/
const DB_NAME = "ce_qc_db";
const DB_VER = 2; // no necesitas cambiar para nuevos campos
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      const mkStore = (name) => {
        if (!_db.objectStoreNames.contains(name)) {
          const s = _db.createObjectStore(name, { keyPath: "id" });
          s.createIndex("fecha", "fecha", { unique: false });
          s.createIndex("labor", "labor", { unique: false });
        }
      };
      mkStore("slump");
      mkStore("resist");
      mkStore("pernos");
    };

    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}
function addRecord(store, rec) {
  rec.id = uid();
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").add(rec);
    r.onsuccess = () => resolve(rec);
    r.onerror = () => reject(r.error);
  });
}
function deleteRecord(store, id) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").delete(id);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}
function clearStore(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").clear();
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}
function getAll(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
async function getAllFiltered(store, desdeIso, hastaIso) {
  const rows = await getAll(store);
  return rows
    .filter((r) => inRange(r.fecha, desdeIso, hastaIso))
    .sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || "")));
}

/***********************
 * Tabs
 ***********************/
function initTabs() {
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const name = btn.dataset.tab;
      $$(".panel").forEach((p) => p.classList.remove("active"));
      $(`#tab-${name}`).classList.add("active");

      if (name === "bd") refreshDBTables();
      if (name === "reporte") buildReport();
    });
  });
}

/***********************
 * Rows con data-label (cards móvil)
 ***********************/
function makeRow(cells) {
  const tr = document.createElement("tr");
  cells.forEach(({ label, html }) => {
    const td = document.createElement("td");
    td.setAttribute("data-label", label);
    td.innerHTML = `<div class="cell-right">${html}</div>`;
    tr.appendChild(td);
  });
  return tr;
}
function delBtn(store, id) {
  return `<button class="btn btn-danger" data-del="${store}:${id}">Eliminar</button>`;
}

/***********************
 * Formularios
 ***********************/
function initForms() {
  [
    '#formSlump input[name=fecha]',
    '#formResist input[name=fecha]',
    '#formPernos input[name=fecha]',
    "#fDesde", "#fHasta",
    "#rDesde", "#rHasta",
  ].forEach((sel) => { const el = $(sel); if (el) el.value = todayISO(); });

  //¡Hecho, Cesar! 👌  
Te dejo **el código completo** (listo para copiar/pegar) para que lo subas a tu GitHub y quede:

✅ **Pestaña 1 (Slump y T°)**  
- **N° Mixer** separado  
- **Hora de salida (HS)** como `input time` independiente  
- **Horas ordenadas en bloque** (Slump / HS / H_LL) a un costado visualmente (en una fila limpia)

✅ **Pestaña Reporte**  
- Gráficos **Lollipop “estilo Python/matplotlib”**: escala “nice”, grid suave, ticks, banda objetivo Slump min–max y puntos verde/rojo según cumplimiento. (Tu base ya era lollipop en canvas, la mejoré a nivel pro). [2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/manifest%20(1).json)[1](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html).html)  
- **Cards premium** (más KPIs, mejor mejor diseño)

✅ **Exportar PDF en “Registros / Base de Datos”**  
- Agrego botón “Exportar PDF” y lo dejo funcionando con impresión → “Guardar como PDF”. (En tu código el PDF del Reporte ya estaba cableado a `#btnPDF`; aquí loquí lo amplío para Registros también). [2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/manifest%20(1).json)[1](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html).html)  

---

# 📁 Estructura esperada del repol repo (como tu GitHub)
Tu captura muestra que ya tienes todo al root (perfecto para GitHub Pages Pages): `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`. [1](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/index%20(1).html)[2](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/manifest%20(1).json).json).json)  

---

# ✅ 1) `index.html`.html` (COMPLETO)
> Reemplaza todo tu `index.html` por esto.

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
 " />
  <title>CE - Control de Calidad (Offline)</title>

  <link rel="manifest" href="manifest.json">

