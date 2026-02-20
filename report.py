# report.py — CE Offline (PyScript)
# Requiere: numpy, matplotlib (definidos en pyscript.json)

import io, base64, math, asyncio
import numpy as np
import matplotlib
matplotlib.use("agg")  # backend no interactivo
import matplotlib.pyplot as plt

from js import document, window, console, ceExportData

# ------------------------------
# Utilitarios
# ------------------------------
def _to_hours(mins):
    """Convierte minutos a horas (float). Admite None."""
    if mins is None:
        return None
    try:
        return float(mins) / 60.0
    except Exception:
        return None

def _eps_pos(y, eps=0.01):
    """Evita y=0 en eje log: aplica piso mínimo."""
    try:
        y = float(y)
    except Exception:
        return None
    return max(eps, y)

def _fig_to_base64(fig, dpi=160):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    plt.close(fig)
    return b64

# ------------------------------
# Curvas patrón J1, J2, J3 (del usuario)
# Usamos horas (h) en X y MPa en Y
# ------------------------------
CURVAS = {
    "J1": {
        "h": [0.10, 0.20, 1.0, 6.0, 24.0],
        "mpa":[0.9,  0.1,  0.20,0.7, 2.0],
        "style": dict(color="#0ea5e9", lw=2.2, marker="o", ms=5, label="J1")
    },
    "J2": {
        "h": [0.10, 1.0, 6.0, 24.0],
        "mpa":[0.2,  0.5, 1.7, 5.0],
        "style": dict(color="#22c55e", lw=2.2, marker="s", ms=5, label="J2")
    },
    "J3": {
        "h": [0.10, 1.0, 6.0, 24.0],
        "mpa":[0.5,  1.5, 5.0, 15.0],
        "style": dict(color="#f97316", lw=2.2, marker="^", ms=6, label="J3")
    },
}

# ------------------------------
# Plot principal (log–log)
# ------------------------------
def _plot_resistencias(data_resist, titulo="Resistencias iniciales (log–log)"):
    """
    data_resist: lista de dicts con:
      - edadMin (minutos)
      - resistencia (MPa)
      - metodo ('A' o 'B')
      - fecha, labor, etc. (opcionales)
    """
    # Preparar figura
    fig, ax = plt.subplots(figsize=(8.8, 5.4))
    ax.set_xscale("log")
    ax.set_yscale("log")

    # 1) Curvas patrón
    for key in ["J1", "J2", "J3"]:
        c = CURVAS[key]
        x = np.array([max(0.05, h) for h in c["h"]], dtype=float)  # x>0 para log
        y = np.array([_eps_pos(m) for m in c["mpa"]], dtype=float) # y>0 para log
        ax.plot(x, y, **c["style"])

    # 2) Tus datos desde IndexedDB (filtrados por rango por ceExportData)
    #    Puntos A y B con markers distintos:
    xs_A, ys_A = [], []
    xs_B, ys_B = [], []
    for r in (data_resist or []):
        mpa = _eps_pos(r.get("resistencia"))
        h = _to_hours(r.get("edadMin"))
        if mpa is None or h is None or h <= 0:
            continue
        if str(r.get("metodo", "")).upper() == "B":
            xs_B.append(h); ys_B.append(mpa)
        else:
            xs_A.append(h); ys_A.append(mpa)

    # Pinta puntos (si hay). A en morado, B en rojo.
    if xs_A:
        ax.scatter(xs_A, ys_A, c="#7c3aed", s=42, marker="o", edgecolors="white",
                   linewidths=0.6, label="Medido A")
    if xs_B:
        ax.scatter(xs_B, ys_B, c="#ef4444", s=54, marker="D", edgecolors="white",
                   linewidths=0.6, label="Medido B")

    # 3) Formato general
    ax.set_title(titulo, fontsize=12, fontweight="bold")
    ax.set_xlabel("Edad (horas) — escala log")
    ax.set_ylabel("Resistencia (MPa) — escala log")
    ax.grid(True, which="both", ls="--", lw=0.5, alpha=0.35)
    ax.legend(loc="best", fontsize=9, frameon=True)

    # Rango sugerido (cubrir 0.1h a 24h)
    ax.set_xlim(left=0.08, right=30)
    ax.set_ylim(bottom=0.08, top=20)

    return _fig_to_base64(fig)

# ------------------------------
# Funciones expuestas a JS
# ------------------------------
async def runPythonResist(desde_iso, hasta_iso):
    """
    Genera el gráfico de resistencias (log–log) con J1/J2/J3 + puntos medidos,
    y lo inyecta en:
      - #chartResistImg         (pestaña 2)
      - #chartResistImgReport   (pestaña 5)
    """
    try:
      # Pedimos los datos filtrados por rango al bridge JS
      jsobj = await ceExportData(desde_iso, hasta_iso)   # Promise JS
      data = jsobj.to_py()                               # dict Python
      resist = data.get("resist", [])

      # Graficar
      b64 = _plot_resistencias(resist)

      # Inyectar en ambas pestañas (si existen)
      for img_id in ("chartResistImg", "chartResistImgReport"):
          img = document.getElementById(img_id)
          if img:
              img.setAttribute("src", f"data:image/png;base64,{b64}")

      return True
    except Exception as e:
      console.error(f"[Py] runPythonResist error: {e}")
      return False

async def runPythonReport(desde_iso, hasta_iso):
    """
    (Opcional) Si lo necesitas para otros gráficos del reporte diario.
    De momento no genera nada adicional; lo dejamos como stub.
    """
    return True

# Exponer al window (PyScript)
window.runPythonResist = runPythonResist
window.runPythonReport = runPythonReport

