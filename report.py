# report.py — Gráficos para CE Offline (PyScript)
# Incluye: runPythonReport (Slump/Presión) y runPythonResist (log–log)
# Basado en tu archivo anterior, se añadió runPythonResist y la utilería. [1](https://volcanperu-my.sharepoint.com/personal/claura_volcan_com_pe/Documents/Archivos%20de%20Microsoft%C2%A0Copilot%20Chat/styles.css)

import io, base64
from pyscript import window, web
import matplotlib.pyplot as plt
import numpy as np

PLOMO_BG = "#E5E7EB"
CARD_BG  = "#FFFFFF"
TXT      = "#111827"
ORANGE   = "#F97316"
ORANGE2  = "#FB923C"
EDGE     = "#9A3412"

def fig_to_dataurl(fig):
  buf = io.BytesIO()
  fig.savefig(buf, format="png", dpi=170, bbox_inches="tight")
  plt.close(fig)
  b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
  return "data:image/png;base64," + b64

def group_mean(rows, key_group, key_value):
  acc = {}
  for r in rows:
    k = (r.get(key_group) or "—").strip() or "—"
    try:
      v = float(r.get(key_value))
    except:
      continue
    s, n = acc.get(k, (0.0, 0))
    acc[k] = (s + v, n + 1)
  out = [(k, (s/n) if n else 0.0, n) for k,(s,n) in acc.items()]
  out.sort(key=lambda x: x[1])
  return out[-12:]

def bar_vertical_pro(title, xlabels, yvalues, ylabel="", band=None):
  fig, ax = plt.subplots(figsize=(8.6, 5.0))
  fig.patch.set_facecolor(PLOMO_BG)
  ax.set_facecolor(CARD_BG)
  x = np.arange(len(xlabels))
  if band:
    lo, hi = band
    ax.axhspan(lo, hi, color=ORANGE2, alpha=0.12, zorder=0)
    ax.axhline(lo, color=ORANGE2, alpha=0.45, linewidth=1.1)
    ax.axhline(hi, color=ORANGE2, alpha=0.45, linewidth=1.1)
    ax.text(len(x)-0.35, hi, f"Obj máx {hi}", fontsize=9, color=TXT, ha="right", va="bottom")
    ax.text(len(x)-0.35, lo, f"Obj mín {lo}", fontsize=9, color=TXT, ha="right", va="top")
  bars = ax.bar(x, yvalues, width=0.55, color=ORANGE, alpha=0.88, edgecolor=EDGE, linewidth=1.0, zorder=3)
  for b in bars:
    h = b.get_height()
    ax.text(b.get_x() + b.get_width()/2, h, f"{h:.2f}", fontsize=9, color=TXT, ha="center", va="bottom")
  ax.set_title(title, fontsize=14, fontweight="bold", color=TXT)
  if ylabel: ax.set_ylabel(ylabel, fontsize=10, color=TXT)
  ax.set_xticks(x)
  ax.set_xticklabels([lab[:18] + ("…" if len(lab) > 18 else "") for lab in xlabels], rotation=25, ha="right", fontsize=10, color=TXT)
  ax.tick_params(axis="y", labelsize=10, colors=TXT)
  ax.grid(axis="y", alpha=0.25, zorder=1)
  ax.spines["top"].set_visible(False)
  ax.spines["right"].set_visible(False)
  ax.spines["left"].set_alpha(0.25)
  ax.spines["bottom"].set_alpha(0.25)
  ymax = max(yvalues) if yvalues else 1
  ax.set_ylim(0, ymax * 1.20)
  return fig_to_dataurl(fig)

async def run_report(desde, hasta):
  data = await window.ceExportData(desde, hasta)
  slump = data.get("slump", [])
  s = group_mean(slump, "labor", "slumpValue")
  a = group_mean(slump, "labor", "presionAire")
  # Slump por labor (banda 8–11")
  if s:
    labs = [t[0] for t in s]
    vals = [t[1] for t in s]
    url = bar_vertical_pro('Slump promedio por labor (")', labs, vals, ylabel='Pulgadas (")', band=(8,11))
    web.page["#chartSlumpImg"].setAttribute("src", url)
  else:
    web.page["#chartSlumpImg"].removeAttribute("src")
  # Presión por labor
  if a:
    labs = [t[0] for t in a]
    vals = [t[1] for t in a]
    url = bar_vertical_pro('Presión de aire promedio por labor', labs, vals, ylabel='Presión')
    web.page["#chartAireImg"].setAttribute("src", url)
  else:
    web.page["#chartAireImg"].removeAttribute("src")

def scatter_loglog(title, xs, ys, xlabel="Horas (log)", ylabel="MPa (log)"):
  fig, ax = plt.subplots(figsize=(8.6, 5.0))
  fig.patch.set_facecolor(PLOMO_BG)
  ax.set_facecolor(CARD_BG)
  X = np.array(xs, dtype=float); Y = np.array(ys, dtype=float)
  m = (X > 0) & (Y > 0)
  X, Y = X[m], Y[m]
  if len(X) == 0:
    return None
  ax.plot(X, Y, color=ORANGE, linewidth=1.2, alpha=0.85, zorder=3)
  ax.scatter(X, Y, color=ORANGE, edgecolor=EDGE, s=32, zorder=4)
  ax.set_xscale('log'); ax.set_yscale('log')
  ax.set_title(title, fontsize=14, fontweight="bold", color=TXT)
  ax.set_xlabel(xlabel, fontsize=10, color=TXT)
  ax.set_ylabel(ylabel, fontsize=10, color=TXT)
  ax.grid(which='both', axis='both', alpha=0.28)
  ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
  ax.spines["left"].set_alpha(0.25); ax.spines["bottom"].set_alpha(0.25)
  return fig_to_dataurl(fig)

async def run_resist(desde, hasta):
  data = await window.ceExportData(desde, hasta)
  resist = data.get("resist", [])
  xs, ys = [], []
  for r in resist:
    try:
      if "edadMin" in r and r["edadMin"] is not None:
        h = float(r["edadMin"]) / 60.0
      else:
        ed = (r.get("edad") or "").strip()
        if ":" in ed:
          hh, mm = ed.split(":"); h = int(hh) + int(mm)/60.0
        else:
          h = float(ed)
      mpa = float(r.get("resistencia") or 0)
      if h > 0 and mpa > 0:
        xs.append(h); ys.append(mpa)
    except:
      continue
  url = scatter_loglog("Resistencias iniciales (log–log)", xs, ys)
  img    = web.page["#chartResistImg"] if web.page.querySelector("#chartResistImg") else None
  imgRep = web.page["#chartResistImgReport"] if web.page.querySelector("#chartResistImgReport") else None
  if url:
    if img:    img.setAttribute("src", url)
    if imgRep: imgRep.setAttribute("src", url)
  else:
    if img:    img.removeAttribute("src")
    if imgRep: imgRep.removeAttribute("src")

# Exponer a JS
window.runPythonReport = run_report
window.runPythonResist = run_resist
