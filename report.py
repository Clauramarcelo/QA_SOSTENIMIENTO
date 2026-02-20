# report.py — CE Offline (PyScript)
import io, base64, asyncio
import numpy as np
import matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt
from js import document, window, console

def _to_hours(mins):
    if mins is None: return None
    try: return float(mins) / 60.0
    except: return None

def _eps_pos(y, eps=0.01):
    try: y = float(y)
    except: return None
    return max(eps, y)

def _fig_to_base64(fig, dpi=160):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    plt.close(fig)
    return b64

async def _wait_js_api(timeout_ms=4000):
    waited, step = 0, 100
    while waited < timeout_ms:
        try:
            if hasattr(window, "ceExportData") and callable(window.ceExportData):
                return True
        except: pass
        await asyncio.sleep(step/1000); waited += step
    return False

CURVAS = {
    "J1":{"h":[0.10,0.20,1.0,6.0,24.0],"mpa":[0.9,0.1,0.20,0.7,2.0],"style":dict(color="#0ea5e9",lw=2.2,marker="o",ms=5,label="J1")},
    "J2":{"h":[0.10,1.0,6.0,24.0],"mpa":[0.2,0.5,1.7,5.0],"style":dict(color="#22c55e",lw=2.2,marker="s",ms=5,label="J2")},
    "J3":{"h":[0.10,1.0,6.0,24.0],"mpa":[0.5,1.5,5.0,15.0],"style":dict(color="#f97316",lw=2.2,marker="^",ms=6,label="J3")},
}

def _plot_resistencias(data_resist, titulo="Resistencias iniciales (log–log)"):
    fig, ax = plt.subplots(figsize=(8.8,5.4))
    ax.set_xscale("log"); ax.set_yscale("log")
    for key in ["J1","J2","J3"]:
        c = CURVAS[key]
        x = np.array([max(0.05,h) for h in c["h"]], float)
        y = np.array([_eps_pos(m) for m in c["mpa"]], float)
        ax.plot(x, y, **c["style"])
    xs_A, ys_A, xs_B, ys_B = [], [], [], []
    for r in (data_resist or []):
        mpa = _eps_pos(r.get("resistencia"))
        h   = _to_hours(r.get("edadMin"))
        if mpa is None or h is None or h <= 0: continue
        if str(r.get("metodo","")).upper() == "B":
            xs_B.append(h); ys_B.append(mpa)
        else:
            xs_A.append(h); ys_A.append(mpa)
    if xs_A: ax.scatter(xs_A,ys_A,c="#7c3aed",s=42,marker="o",edgecolors="white",linewidths=0.6,label="Medido A")
    if xs_B: ax.scatter(xs_B,ys_B,c="#ef4444",s=54,marker="D",edgecolors="white",linewidths=0.6,label="Medido B")
    ax.set_title(titulo,fontsize=12,fontweight="bold")
    ax.set_xlabel("Edad (horas) — escala log"); ax.set_ylabel("Resistencia (MPa) — escala log")
    ax.grid(True,which="both",ls="--",lw=0.5,alpha=0.35); ax.legend(loc="best",fontsize=9,frameon=True)
    ax.set_xlim(0.08,30); ax.set_ylim(0.08,20)
    return _fig_to_base64(fig)

async def runPythonResist(desde_iso, hasta_iso):
    try:
        if not await _wait_js_api(4000):
            console.error("[Py] ceExportData no está disponible todavía."); return False
        jsobj = await window.ceExportData(desde_iso, hasta_iso)
        data = jsobj.to_py()
        resist = data.get("resist", [])
        b64 = _plot_resistencias(resist)
        for img_id in ("chartResistImg","chartResistImgReport"):
            img = document.getElementById(img_id)
            if img: img.setAttribute("src", f"data:image/png;base64,{b64}")
        return True
    except Exception as e:
        console.error(f"[Py] runPythonResist error: {e}"); return False

async def runPythonReport(desde_iso, hasta_iso): return True

# Exponer en window
window.runPythonResist = runPythonResist
window.runPythonReport = runPythonReport

# Auto-intento al cargar (si hay fecha visible)
async def _auto_draw():
    try:
        img = document.getElementById("chartResistImg")
        if not img: return
        if not await _wait_js_api(4000): return
        try:
            rDia = document.getElementById("rDia"); day = rDia.value if rDia and rDia.value else None
        except: day = None
        if not day:
            try: day = window.todayISO()
            except: day = None
        if day: await runPythonResist(day, day)
    except Exception as e:
        console.warn(f"[Py] _auto_draw warn: {e}")
asyncio.ensure_future(_auto_draw())
