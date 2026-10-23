"""Outils communs : polices, styles, formatage français, registre des valeurs attendues."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.units import mm

FD = "/usr/share/fonts/truetype/dejavu/"
for name, f in [
    ("Serif", "DejaVuSerif.ttf"), ("Serif-B", "DejaVuSerif-Bold.ttf"),
    ("Serif-I", "DejaVuSerif-Italic.ttf"), ("Serif-BI", "DejaVuSerif-BoldItalic.ttf"),
    ("Sans", "DejaVuSans.ttf"), ("Sans-B", "DejaVuSans-Bold.ttf"),
    ("Sans-I", "DejaVuSans-Oblique.ttf"), ("Sans-BI", "DejaVuSans-BoldOblique.ttf"),
    ("Cond", "DejaVuSansCondensed.ttf"), ("Cond-B", "DejaVuSansCondensed-Bold.ttf"),
]:
    pdfmetrics.registerFont(TTFont(name, FD + f))
for fam in ("Serif", "Sans"):
    addMapping(fam, 0, 0, fam); addMapping(fam, 1, 0, fam + "-B")
    addMapping(fam, 0, 1, fam + "-I"); addMapping(fam, 1, 1, fam + "-BI")
addMapping("Cond", 0, 0, "Cond"); addMapping("Cond", 1, 0, "Cond-B")
addMapping("Cond", 0, 1, "Cond"); addMapping("Cond", 1, 1, "Cond-B")

NBSP = " "
NNBSP = " "

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def eur(v, dec=False, sep=" ", sym=True):
    """84000 -> '84 000 €' ; dec=True -> '23 100,00 €'."""
    if dec:
        s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", sep)
    else:
        s = f"{int(v):,}".replace(",", sep)
    return s + (sep + "€" if sym else "")


def num(v, sep=" "):
    return f"{int(v):,}".replace(",", sep)


def date_fr(iso, er=True):
    y, m, d = (int(x) for x in iso.split("-"))
    j = "1er" if (d == 1 and er) else str(d)
    return f"{j} {MOIS[m - 1]} {y}"


def date_num(iso):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


# ---- valeurs attendues ----------------------------------------------------
def F(valeur, type_, citation, unite=None, page=None, note=None):
    d = {"valeur": valeur, "type": type_, "citation": citation}
    if unite:
        d["unite"] = unite
    if page:
        d["page_imposee"] = page
    if note:
        d["note"] = note
    return d


def ABSENT(note):
    return {"valeur": None, "absent": True, "note": note}


# ---- styles ---------------------------------------------------------------
def styles_bail(font="Serif", size=10.2):
    lead = size * 1.42
    return {
        "titre": ParagraphStyle("t", fontName=font + "-B", fontSize=15, leading=20,
                                alignment=TA_CENTER, spaceAfter=4),
        "soustitre": ParagraphStyle("st", fontName=font, fontSize=10, leading=14,
                                    alignment=TA_CENTER, spaceAfter=14),
        "h": ParagraphStyle("h", fontName=font + "-B", fontSize=size + 0.6, leading=lead,
                            spaceBefore=9, spaceAfter=4),
        "p": ParagraphStyle("p", fontName=font, fontSize=size, leading=lead,
                            alignment=TA_JUSTIFY, spaceAfter=5),
        "c": ParagraphStyle("c", fontName=font, fontSize=size, leading=lead,
                            alignment=TA_CENTER, spaceAfter=5),
        "small": ParagraphStyle("s", fontName=font, fontSize=8, leading=10),
    }


def styles_sans(size=9.5):
    return {
        "titre": ParagraphStyle("t", fontName="Sans-B", fontSize=20, leading=25,
                                textColor=colors.HexColor("#14324a"), spaceAfter=4),
        "soustitre": ParagraphStyle("st", fontName="Sans", fontSize=11, leading=15,
                                    textColor=colors.HexColor("#4a6378"), spaceAfter=10),
        "h": ParagraphStyle("h", fontName="Sans-B", fontSize=11.5, leading=15,
                            textColor=colors.HexColor("#14324a"), spaceBefore=10, spaceAfter=4),
        "p": ParagraphStyle("p", fontName="Sans", fontSize=size, leading=size * 1.45,
                            alignment=TA_JUSTIFY, spaceAfter=5),
        "pl": ParagraphStyle("pl", fontName="Sans", fontSize=size, leading=size * 1.45,
                             alignment=TA_LEFT, spaceAfter=3),
        "pr": ParagraphStyle("pr", fontName="Sans", fontSize=size, leading=size * 1.45,
                             alignment=TA_RIGHT),
        "cell": ParagraphStyle("cell", fontName="Sans", fontSize=8.6, leading=11),
        "cellb": ParagraphStyle("cellb", fontName="Sans-B", fontSize=8.6, leading=11),
        "small": ParagraphStyle("s", fontName="Sans", fontSize=7.5, leading=9.5,
                                textColor=colors.HexColor("#555555")),
    }


def build_pdf(path, flow, pagesize=A4, footer=None, margins=(22, 22, 20, 20), font="Serif"):
    """footer: texte en pied de page (avec {page})."""
    l, r, t, b = margins

    def deco(c, doc):
        if footer:
            c.saveState()
            c.setFont(font, 7.5)
            c.setFillGray(0.35)
            c.drawCentredString(pagesize[0] / 2, 10 * mm, footer.format(page=doc.page))
            c.restoreState()

    doc = SimpleDocTemplate(path, pagesize=pagesize, leftMargin=l * mm, rightMargin=r * mm,
                            topMargin=t * mm, bottomMargin=b * mm,
                            title="", author="", creator="")
    doc.build(flow, onFirstPage=deco, onLaterPages=deco)
