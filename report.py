import io, base64
from pyscript import window, web
import matplotlib.pyplot as plt

PLOMO_BG = "#E5E7EB"     # plomo tipo papel
CARD_BG  = "#FFFFFF"
TXT      = "#111827"
GRID     = (0.0, 0.0, 0.0, 0.12)
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
    out = []
    for k, (s, n) in acc.items():
        out.append((k, (s / n) if n else 0.0, n))
    out.sort(key=lambda x: x[1])          # orden por valor
    return out[-14:]                      # top 14

def lollipop_vertical(title, xlabels, yvalues, ylabel=""):
    fig, ax = plt.subplots(figsize=(8.6, 5.0))
    fig.patch.set_facecolor(PLOMO_BG)
    ax.set_facecolor(CARD_BG)

    x = list(range(len(xlabels)))

    # stems
    ax.vlines(x, [0]*len(x), yvalues, colors=ORANGE2, linewidth=5, alpha=0.92, zorder=2)

    # heads
    ax.scatter(x, yvalues, s=140, color=ORANGE, edgecolor=EDGE, linewidth=1.0, zorder=3)

    # labels/title
    ax.set_title(title, fontsize=14, fontweight="bold", color=TXT)
    ax.set_xticks(x)
    ax.set_xticklabels(
        [lab[:18] + ("…" if len(lab) > 18 else "") for lab in xlabels],
        rotation=25, ha="right", fontsize=10, color=TXT
    )
    ax.tick_params(axis="y", labelsize=10, colors=TXT)

    if ylabel:
        ax.set_ylabel(ylabel, fontsize=10, color=TXT)

    # grid & spines
    ax.grid(axis="y", alpha=0.25)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_alpha(0.25)
    ax.spines["bottom"].set_alpha(0.25)

    # y-limit padding
    ymax = max(yvalues) if yvalues else 1
    ax.set_ylim(0, ymax * 1.15)

    return fig_to_dataurl(fig)

async def run_report(desde, hasta):
    data = await window.ceExportData(desde, hasta)

    slump = data.get("slump", [])
    s = group_mean(slump, "labor", "slumpValue")
    a = group_mean(slump, "labor", "presionAire")

    if s:
        labs = [t[0] for t in s]
        vals = [t[1] for t in s]
        url = lollipop_vertical('Slump promedio por labor (")', labs, vals, ylabel='Pulgadas (")')
        web.page["#chartSlumpImg"].setAttribute("src", url)
    else:
        web.page["#chartSlumpImg"].removeAttribute("src")

    if a:
        labs = [t[0] for t in a]
        vals = [t[1] for t in a]
        url = lollipop_vertical("Presión de aire promedio por labor", labs, vals, ylabel="Presión")
        web.page["#chartAireImg"].setAttribute("src", url)
    else:
        web.page["#chartAireImg"].removeAttribute("src")

# Exponer a JS
window.runPythonReport = run_report
