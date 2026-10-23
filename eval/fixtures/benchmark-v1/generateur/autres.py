"""Teasers, quittances, avis d'échéance, états locatifs (PDF et Excel), email."""
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from common import *

BLEU = colors.HexColor("#14324a")
GRIS = colors.HexColor("#eef2f5")


def chiffres_cles(rows, st, widths=(62 * mm, 104 * mm)):
    data = [[Paragraph(esc(a), st["cellb"]), Paragraph(esc(b), st["cell"])] for a, b in rows]
    t = Table(data, colWidths=widths)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), GRIS),
                           ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c5d0d9")),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t


def teaser(path, p):
    """p : titre, accroche, chiffres (liste (libellé, valeur)), paragraphes (liste (titre, texte)),
    tableau (optionnel), mandataire, champs (dict déjà construit)."""
    st = styles_sans()
    fl = []
    fl.append(Paragraph(esc(p.get("bandeau", "OPPORTUNITÉ D'INVESTISSEMENT – DIFFUSION RESTREINTE")), st["small"]))
    fl.append(Spacer(1, 6))
    fl.append(Paragraph(esc(p["titre"]), st["titre"]))
    fl.append(Paragraph(esc(p["accroche"]), st["soustitre"]))
    fl.append(Paragraph("Chiffres clés", st["h"]))
    fl.append(chiffres_cles(p["chiffres"], st))
    for titre, texte in p["paragraphes"]:
        fl.append(Paragraph(esc(titre), st["h"]))
        for t in (texte if isinstance(texte, list) else [texte]):
            fl.append(Paragraph(esc(t), st["p"]))
    if p.get("tableau"):
        titre, entetes, lignes, largeurs = p["tableau"]
        if p.get("saut_tableau"):
            from reportlab.platypus import PageBreak
            fl.append(PageBreak())
        fl.append(Paragraph(esc(titre), st["h"]))
        data = [[Paragraph(esc(h), st["cellb"]) for h in entetes]]
        data += [[Paragraph(esc(c), st["cellb"] if i == len(lignes) - 1 and p.get("tableau_total") else st["cell"])
                  for c in l] for i, l in enumerate(lignes)]
        t = Table(data, colWidths=[w * mm for w in largeurs], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), GRIS),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#c5d0d9")),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        fl.append(t)
    fl.append(Spacer(1, 10))
    fl.append(Paragraph("Contact", st["h"]))
    for l in p["mandataire"]:
        fl.append(Paragraph(esc(l), st["pl"]))
    fl.append(Spacer(1, 8))
    fl.append(Paragraph(esc("Document non contractuel, établi sur la base des informations communiquées par le propriétaire. "
                            "Les informations qu'il contient sont confidentielles et ne peuvent être communiquées à des tiers "
                            "sans l'accord préalable du mandataire. Honoraires à la charge du vendeur sauf mention contraire."), st["small"]))
    build_pdf(path, fl, footer=p.get("footer", "{page}"), font="Sans", margins=(18, 18, 16, 18))


def piece_comptable(path, p):
    """Quittance ou avis d'échéance."""
    st = styles_sans(9.2)
    fl = []
    entete = Table([[Paragraph("<b>" + esc(p["emetteur"]) + "</b><br/>" + "<br/>".join(esc(x) for x in p["emetteur_lignes"]), st["pl"]),
                     Paragraph("<br/>".join(esc(x) for x in p["destinataire"]), st["pl"])]],
                   colWidths=[90 * mm, 80 * mm])
    entete.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("BOX", (1, 0), (1, 0), 0.5, colors.grey),
                                ("LEFTPADDING", (1, 0), (1, 0), 8), ("TOPPADDING", (1, 0), (1, 0), 6)]))
    fl.append(entete)
    fl.append(Spacer(1, 14))
    fl.append(Paragraph(esc(p["titre"]), st["titre"]))
    for l in p["infos"]:
        fl.append(Paragraph(esc(l), st["pl"]))
    fl.append(Spacer(1, 8))
    data = [[Paragraph("<b>Désignation</b>", st["cell"]), Paragraph("<b>Montant HT</b>", st["cell"]),
             Paragraph("<b>TVA</b>", st["cell"]), Paragraph("<b>Montant TTC</b>", st["cell"])]]
    for lig in p["lignes"]:
        data.append([Paragraph(esc(c), st["cell"]) for c in lig])
    for lig in p["totaux"]:
        data.append([Paragraph("<b>" + esc(c) + "</b>", st["cell"]) for c in lig])
    t = Table(data, colWidths=[78 * mm, 32 * mm, 28 * mm, 32 * mm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b9c3cc")),
                           ("BACKGROUND", (0, 0), (-1, 0), GRIS),
                           ("ALIGN", (1, 1), (-1, -1), "RIGHT")]))
    fl.append(t)
    fl.append(Spacer(1, 10))
    for l in p["mentions"]:
        fl.append(Paragraph(esc(l), st["p"]))
    build_pdf(path, fl, font="Sans", margins=(18, 18, 16, 18), footer=p.get("footer"))


def etat_locatif_pdf(path, p):
    st = styles_sans(8.6)
    fl = [Paragraph(esc(p["titre"]), st["titre"]), Paragraph(esc(p["soustitre"]), st["soustitre"])]
    data = [[Paragraph("<b>" + esc(h) + "</b>", st["cell"]) for h in p["entetes"]]]
    for i, l in enumerate(p["lignes"]):
        s = st["cellb"] if i == len(p["lignes"]) - 1 else st["cell"]
        data.append([Paragraph(esc(c), s) for c in l])
    t = Table(data, colWidths=[w * mm for w in p["largeurs"]], repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b9c3cc")),
                           ("BACKGROUND", (0, 0), (-1, 0), GRIS),
                           ("BACKGROUND", (0, -1), (-1, -1), GRIS),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    fl.append(t)
    fl.append(Spacer(1, 8))
    for l in p["notes"]:
        fl.append(Paragraph(esc(l), st["small"]))
    build_pdf(path, fl, pagesize=landscape(A4), font="Sans", margins=(14, 14, 14, 16),
              footer="État locatif – document établi par le bailleur – page {page}")
