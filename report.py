import io, base64
from pyscript import window, web
import matplotlib.pyplot as plt

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
    return out[-12:]  # top 12 para que se vea limpio

def bar_vertical_pro(title, xlabels, yvalues, ylabel="", band=None):
    import numpy as np

    fig, ax = plt.subplots(figsize=(8.6, 5.0))
    fig.patch.set_facecolor(PLOMO_BG)
    ax.set_facecolor(CARD_BG)

    x = np.arange(len(xlabels))

    # Banda objetivo (min,max) para slump (8–11)
    if band:
        lo, hi = band
        ax.axhspan(lo, hi, color=ORANGE2, alpha=0.12, zorder=0)
        ax.axhline(lo, color=ORANGE2, alpha=0.45, linewidth=1.1)
        ax.axhline(hi, color=ORANGE2, alpha=0.45, linewidth=1.1)
        ax.text(len(x)-0.35, hi, f"Obj máx {hi}", fontsize=9, color=TXT, ha="right", va="bottom")
        ax.text(len(x)-0.35, lo, f"Obj mín {lo}", fontsize=9, color=TXT, ha="right", va="top")

    # Barras finas + borde elegante
    bars = ax.bar(
        x, yvalues,
        width=0.55,                 # <<< más fino (evita “grueso”)
        color=ORANGE,
        alpha=0.88,
        edgecolor=EDGE,
        linewidth=1.0,
        zorder=3
    )

    # Etiquetas de valor arriba
    for b in bars:
        h = b.get_height()
        ax.text(
            b.get_x() + b.get_width()/2, h,
            f"{h:.2f}",
            fontsize=9, color=TXT,
            ha="center", va="bottom"
        )

    # Título y ejes
    ax.set_title(title, fontsize=14, fontweight="bold", color=TXT)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=10, color=TXT)

    ax.set_xticks(x)
    ax.set_xticklabels(
        [lab[:18] + ("…" if len(lab) > 18 else "") for lab in xlabels],
        rotation=25, ha="right",
        fontsize=10, color=TXT
    )
    ax.tick_params(axis="y", labelsize=10, colors=TXT)

    # Grid suave
    ax.grid(axis="y", alpha=0.25, zorder=1)

    # Limpiar bordes
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_alpha(0.25)
    ax.spines["bottom"].set_alpha(0.25)

    # Padding superior
    ymax = max(yvalues) if yvalues else 1
    ax.set_ylim(0, ymax * 1.20)

    return fig_to_dataurl(fig)

async def run_report(desde, hasta):
    data = await window.ceExportData(desde, hasta)
    slump = data.get("slump", [])

    s = group_mean(slump, "labor", "slumpValue")
    a = group_mean(slump, "labor", "presionAire")

    # Slump por labor (con banda 8–11)
    if s:
        labs = [t[0] for t in s]
        vals = [t[1] for t in s]
        url = bar_vertical_pro(
            'Slump promedio por labor (")',
            labs, vals,
            ylabel='Pulgadas (")',
            band=(8,11)
        )
        web.page["#chartSlumpImg"].setAttribute("src", url)
    else:
        web.page["#chartSlumpImg"].removeAttribute("src")

    # Presión por labor
    if a:
        labs = [t[0] for t in a]
        vals = [t[1] for t in a]
        url = bar_vertical_pro(
            'Presión de aire promedio por labor',
            labs, vals,
            ylabel='Presión'
        )
        web.page["#chartAireImg"].setAttribute("src", url)
    else:
        web.page["#chartAireImg"].removeAttribute("src")

# expone a JS
window.runPythonReport = run_report
