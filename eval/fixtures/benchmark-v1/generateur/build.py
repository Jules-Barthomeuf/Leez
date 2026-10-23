"""Génère le jeu de benchmark Leez v1 : 20 documents fictifs + valeurs attendues vérifiées."""
import json, os, random, re, shutil, sys, email, email.policy
from email.message import EmailMessage
import numpy as np
import pdfplumber, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from pypdf import PdfReader, PdfWriter
from reportlab.platypus import PageBreak
from common import *
from baux import bail, avenant
from autres import teaser, piece_comptable, etat_locatif_pdf
import degrade as dg

random.seed(42); np.random.seed(42)
OUT = sys.argv[1] if len(sys.argv) > 1 else "leez-benchmark-v1"
shutil.rmtree(OUT, ignore_errors=True)
DOCS, ATT, NAT, TXT = (os.path.join(OUT, d) for d in ("documents", "attendu", "reference/natifs", "reference/texte_natif"))
for d in (DOCS, ATT, NAT, TXT):
    os.makedirs(d)
import tempfile; TMP = tempfile.mkdtemp(prefix="leez-bench-")

MANIFEST, ATTENDUS = [], {}


def enregistre(id_, fichier, doc_type, deal, fmt, defauts, natif=None, champs=None, lignes=None,
               segments=None, notes=None, partie=None):
    MANIFEST.append({"id": id_, "fichier": f"documents/{fichier}", "doc_type": doc_type, "dossier": deal,
                     "format": fmt, "defauts": defauts,
                     "natif_reference": f"reference/natifs/{os.path.basename(natif)}" if natif and fmt != "pdf_natif" else None})
    a = {"id": id_, "fichier": f"documents/{fichier}", "doc_type": doc_type, "dossier": deal, "format": fmt}
    if champs is not None: a["champs"] = champs
    if lignes is not None: a["lignes"] = lignes
    if segments is not None: a["segments"] = segments
    if notes: a["notes"] = notes
    ATTENDUS[id_] = (a, natif, partie)


def natif(nom):
    return os.path.join(TMP, nom)


def localise(pdf, needle):
    """Renvoie (index_page, x0, top, x1, bottom) en fractions de page pour la 1re occurrence."""
    with pdfplumber.open(pdf) as doc:
        for i, pg in enumerate(doc.pages):
            r = pg.search(needle)
            if r:
                m = r[0]
                return i, m["x0"] / pg.width, m["top"] / pg.height, m["x1"] / pg.width, m["bottom"] / pg.height
    raise ValueError(f"introuvable pour retouche : {needle}")


# ============================ DOSSIER A — LYON ==============================
B01 = dict(
    bailleur="SCI LES ARCHERS INVEST", bailleur_desc="société civile immobilière au capital de 1 000 €, dont le siège social est 8 quai Saint-Antoine, 69002 Lyon",
    bailleur_rcs_ville="Lyon", bailleur_siren="999 104 237", bailleur_rep="M. Paul Ferrand, en sa qualité de gérant", bailleur_rep_court="M. Paul Ferrand",
    preneur="MAISON VERLAINE OPTIQUE", preneur_desc="société par actions simplifiée au capital de 50 000 €, dont le siège social est 3 rue du Plat, 69002 Lyon",
    preneur_rcs_ville="Lyon", preneur_siren="999 412 886", preneur_rep="Mme Claire Verlaine, en sa qualité de présidente", preneur_rep_court="Mme Claire Verlaine",
    adresse="14 rue des Archers, 69002 Lyon",
    designation="un local commercial situé au rez-de-chaussée de l'immeuble, comprenant une surface de vente avec vitrine sur rue, une réserve et un sanitaire, ainsi qu'un sous-sol à usage de stockage relié par un escalier intérieur.",
    surface=142, surface_txt="142 m², dont 98 m² au rez-de-chaussée et 44 m² en sous-sol",
    destination="vente au détail d'articles d'optique, de lunetterie et d'audioprothèse",
    duree=9, date_effet="2021-04-01", date_fin="2030-03-31", triennale="oui",
    loyer=84000, loyer_lettres="quatre-vingt-quatre mille euros",
    periodicite="trimestriellement", periodicite_code="trimestriel", terme="d'avance", terme_code="echoir",
    indice="ICC", indice_base_trim="4e trimestre 2020", indice_base_val="1 795", indice_base_code="ICC_T4_2020",
    depot=21000, depot_mois=3, tf=True, tva=True, variante=0, ville_signature="Lyon", date_signature="2021-03-15")
f = natif("B01.pdf"); ch = bail(f, B01); shutil.copy(f, f"{DOCS}/B01_bail_lyon_optique.pdf")
enregistre("B01", "B01_bail_lyon_optique.pdf", "bail_commercial", "A-Lyon", "pdf_natif", [], f, ch,
           notes=["Indice d'origine ICC, remplacé par l'ILC par l'avenant A01 : l'extraction du bail seul doit rendre ICC."])

f = natif("A01.pdf")
ch = avenant(f, dict(numero=1, date="2023-01-16", bail_date="2021-03-15", adresse=B01["adresse"], ville="Lyon",
    bailleur=B01["bailleur"], bailleur_desc="société civile immobilière, représentée par M. Paul Ferrand, gérant",
    preneur=B01["preneur"], preneur_desc="société par actions simplifiée, représentée par Mme Claire Verlaine, présidente",
    expose="Les parties ont souhaité substituer à l'indice du coût de la construction (ICC), jugé trop volatil, l'indice des loyers commerciaux (ILC), mieux adapté à l'activité du Preneur.",
    articles=[("Substitution d'indice", "À compter du 1er avril 2023, le loyer sera indexé en fonction de la variation de l'indice des loyers commerciaux (ILC) publié par l'INSEE, en lieu et place de l'indice du coût de la construction (ICC). L'indice de base retenu pour la prochaine indexation est celui du 3e trimestre 2022, soit 128,59."),
              ("Loyer en vigueur", "Le montant du loyer annuel en vigueur à la date des présentes, soit 89 250 € hors taxes et hors charges, demeure inchangé jusqu'à la prochaine indexation.")],
    champs={"objet": F("substitution_indice", "enum", "Substitution d'indice"),
            "nouvel_indice": F("ILC", "enum", "en lieu et place de l'indice du coût de la construction (ICC)"),
            "nouvel_indice_base": F("ILC_T3_2022=128.59", "indice_base", "celui du 3e trimestre 2022, soit 128,59"),
            "date_effet_modification": F("2023-04-01", "date", "À compter du 1er avril 2023"),
            "loyer_en_vigueur_ht_hc": F("89250.00", "montant", "soit 89 250 € hors taxes et hors charges", "EUR"),
            "nouvelle_duree_annees": ABSENT("Durée inchangée")}))
shutil.copy(f, f"{DOCS}/A01_avenant1_lyon_indice.pdf")
enregistre("A01", "A01_avenant1_lyon_indice.pdf", "avenant", "A-Lyon", "pdf_natif", [], f, ch)

f = natif("T01.pdf")
teaser(f, dict(titre="Lyon 2e – Murs de commerce loués à un opticien",
    accroche="Local commercial de 142 m² en pied d'immeuble, Presqu'île, bail 3-6-9 en cours",
    chiffres=[("Adresse", "14 rue des Archers, 69002 Lyon"), ("Type d'actif", "Murs de commerce – pied d'immeuble"),
              ("Surface", "142 m² (98 m² RDC + 44 m² sous-sol)"), ("Locataire", "Verlaine Optique (SAS Maison Verlaine Optique)"),
              ("Bail", "Bail commercial 3-6-9 ayant pris effet le 1er avril 2021"), ("Prochaine échéance triennale", "31 mars 2027"),
              ("Loyer annuel en cours", "92 400 € HT HC"), ("Indexation", "Annuelle – ILC"),
              ("Prix de présentation", "1 340 000 € net vendeur"), ("Rendement net vendeur", "6,90 %"),
              ("Rendement acte en main", "6,41 % (frais d'acquisition estimés à 7,5 %)")],
    paragraphes=[("Situation", "Au cœur de la Presqu'île, à deux pas de la place Bellecour, la rue des Archers bénéficie d'un flux piéton soutenu et d'un environnement commercial de qualité (enseignes de prêt-à-porter, restauration, services). Station de métro Bellecour à 3 minutes à pied."),
                 ("Le locataire", "Verlaine Optique est un opticien indépendant implanté à Lyon depuis 2009, exploitant trois magasins. Le locataire a réalisé d'importants travaux d'aménagement lors de son installation dans les lieux en 2021."),
                 ("Points à noter", "Le loyer a été indexé chaque année depuis la prise d'effet. Un avenant de 2023 a modifié l'indice de référence du bail. Data room disponible après signature d'un engagement de confidentialité.")],
    mandataire=["Cabinet Saône Commerce – Transactions murs commerciaux", "Antoine Mercier – a.mercier@saone-commerce.example – 04 00 00 00 00"]))
shutil.copy(f, f"{DOCS}/T01_teaser_lyon.pdf")
enregistre("T01", "T01_teaser_lyon.pdf", "teaser", "A-Lyon", "pdf_natif", [], f, {
    "type_actif": F("commerce_pied_immeuble", "enum", "Murs de commerce – pied d'immeuble"),
    "adresse": F("14 rue des Archers, 69002 Lyon", "adresse", "14 rue des Archers, 69002 Lyon"),
    "code_postal": F("69002", "texte", "69002 Lyon"), "ville": F("Lyon", "texte", "69002 Lyon"),
    "surface_m2": F("142", "surface", "142 m² (98 m² RDC + 44 m² sous-sol)", "m2"),
    "locataire": F("MAISON VERLAINE OPTIQUE", "texte", "Verlaine Optique (SAS Maison Verlaine Optique)"),
    "date_effet_bail": F("2021-04-01", "date", "ayant pris effet le 1er avril 2021"),
    "prochaine_echeance": F("2027-03-31", "date", "31 mars 2027"),
    "loyer_annuel_ht_hc": F("92400.00", "montant", "92 400 € HT HC", "EUR"),
    "indice": F("ILC", "enum", "Annuelle – ILC"),
    "prix": F("1340000.00", "montant", "1 340 000 € net vendeur", "EUR"),
    "prix_base": F("net_vendeur", "enum", "1 340 000 € net vendeur"),
    "rendement_annonce_pct": F("6.90", "pourcentage", "6,90 %", note="Rendement net vendeur annoncé"),
    "rendement_aem_annonce_pct": F("6.41", "pourcentage", "6,41 % (frais d'acquisition estimés à 7,5 %)"),
    "taxe_fonciere_refacturee": ABSENT("Le teaser ne dit rien de la taxe foncière"),
    "mandataire": F("Cabinet Saône Commerce", "texte", "Cabinet Saône Commerce")})

f = natif("Q01.pdf")
piece_comptable(f, dict(emetteur="Cabinet Gestion Rhodanienne",
    emetteur_lignes=["Administrateur de biens – mandataire de la SCI Les Archers Invest", "22 cours Gambetta, 69007 Lyon", "Tél. 04 00 00 00 01"],
    destinataire=["MAISON VERLAINE OPTIQUE", "14 rue des Archers", "69002 Lyon"], titre="QUITTANCE DE LOYER",
    infos=["Quittance n° 2026-T3-0147", "Locaux : local commercial – 14 rue des Archers, 69002 Lyon",
           "Période : du 01/07/2026 au 30/09/2026", "Date d'émission : 05/07/2026"],
    lignes=[["Loyer commercial 3e trimestre 2026", "23 100,00 €", "4 620,00 €", "27 720,00 €"],
            ["Provision sur charges", "1 200,00 €", "240,00 €", "1 440,00 €"],
            ["Remboursement taxe foncière 2026", "3 412,00 €", "682,40 €", "4 094,40 €"]],
    totaux=[["Total", "27 712,00 €", "5 542,40 €", "33 254,40 €"]],
    mentions=["Reçu de MAISON VERLAINE OPTIQUE la somme de 33 254,40 € TTC au titre du loyer et des charges de la période indiquée ci-dessus, dont quittance, sous réserve de tous droits.",
              "TVA acquittée sur les débits. Taux de TVA appliqué : 20 %."]))
shutil.copy(f, f"{DOCS}/Q01_quittance_lyon_T3-2026.pdf")
enregistre("Q01", "Q01_quittance_lyon_T3-2026.pdf", "quittance", "A-Lyon", "pdf_natif", [], f, {
    "type_piece": F("quittance", "enum", "QUITTANCE DE LOYER"),
    "emetteur": F("Cabinet Gestion Rhodanienne", "texte", "Cabinet Gestion Rhodanienne"),
    "locataire": F("MAISON VERLAINE OPTIQUE", "texte", "MAISON VERLAINE OPTIQUE"),
    "periode_debut": F("2026-07-01", "date", "du 01/07/2026 au 30/09/2026"),
    "periode_fin": F("2026-09-30", "date", "du 01/07/2026 au 30/09/2026"),
    "loyer_ht": F("23100.00", "montant", "23 100,00 €", "EUR"),
    "provisions_charges_ht": F("1200.00", "montant", "1 200,00 €", "EUR"),
    "taxe_fonciere_ht": F("3412.00", "montant", "3 412,00 €", "EUR"),
    "tva_totale": F("5542.40", "montant", "5 542,40 €", "EUR"),
    "total_ttc": F("33254.40", "montant", "33 254,40 €", "EUR"),
    "date_emission": F("2026-07-05", "date", "Date d'émission : 05/07/2026")})

# =========================== DOSSIER B — MARSEILLE ==========================
LOTS_B = [("A", "Brico Sud Distribution", "Bricolage", 1850, 185000, "2022-01-01", "2027-12-31", "2031-12-31", "ILC", "Oui"),
          ("B", "Croquettes & Co", "Animalerie", 620, 74400, "2021-07-01", "2027-06-30", "2030-06-30", "ILC", "Oui"),
          ("C", "Sportissime Méditerranée", "Articles de sport", 1100, 121000, "2019-09-01", "2028-08-31", "2028-08-31", "ILC", "Oui"),
          ("D", "VACANT", "—", 480, 0, None, None, None, None, None)]
f = natif("T04.pdf")
teaser(f, dict(titre="Marseille 11e – Retail park de 4 cellules",
    accroche="Ensemble commercial de 4 050 m² en entrée de zone, 3 enseignes en place, une cellule vacante",
    chiffres=[("Adresse", "Vallon Rouge, 210 route des Camoins, 13011 Marseille"),
              ("Type d'actif", "Retail park – ensemble commercial de périphérie"), ("Surface totale", "4 050 m² SDP"),
              ("Nombre de cellules", "4 (dont 1 vacante)"), ("Taux d'occupation", "88 % (en surface)"),
              ("Loyer total en place", "380 400 € HT HC par an"), ("Prix", "5 450 000 € acte en main"),
              ("Rendement acte en main", "6,98 %"), ("Fiscalité", "Taxe foncière intégralement refacturée aux locataires"),
              ("Stationnement", "160 places")],
    paragraphes=[("Situation", "Le parc d'activités du Vallon Rouge se situe en entrée de la zone commerciale de l'est marseillais, à 2 minutes de l'échangeur autoroutier, avec une forte visibilité depuis la route des Camoins."),
                 ("Potentiel", "La cellule D, vacante depuis mars 2026, offre un potentiel de réversion estimé à 52 800 € HT HC par an sur la base des valeurs locatives constatées dans la zone. Les trois locataires en place sont des enseignes régionales établies.")],
    tableau=("État locatif simplifié", ["Cellule", "Enseigne", "Surface", "Loyer annuel HT HC", "Fin de bail"],
             [["A", "Brico Sud Distribution", "1 850 m²", "185 000 €", "31/12/2031"],
              ["B", "Croquettes & Co", "620 m²", "74 400 €", "30/06/2030"],
              ["C", "Sportissime Méditerranée", "1 100 m²", "121 000 €", "31/08/2028"],
              ["D", "Vacant", "480 m²", "—", "—"],
              ["Total", "", "4 050 m²", "380 400 €", ""]], [20, 62, 28, 38, 26]),
    tableau_total=True,
    mandataire=["Provence Retail Advisory", "Lucie Ferraud – l.ferraud@provence-retail.example – 04 00 00 00 02"]))
shutil.copy(f, f"{DOCS}/T04_teaser_marseille_multilots.pdf")
lignes_t04 = []
for lot, loc, act, s, l, eff, tri, fin, ind, tf in LOTS_B:
    lignes_t04.append({"lot": F(lot, "texte", lot), "locataire": F(None if loc == "VACANT" else loc, "texte", "Vacant" if loc == "VACANT" else loc),
                       "surface_m2": F(str(s), "surface", f"{num(s)} m²", "m2"),
                       "loyer_annuel_ht_hc": F(f"{l}.00" if l else None, "montant", eur(l) if l else "—", "EUR"),
                       "date_fin_bail": F(fin, "date", date_num(fin) if fin else "—")})
enregistre("T04", "T04_teaser_marseille_multilots.pdf", "teaser", "B-Marseille", "pdf_natif", ["tableau"], f, {
    "type_actif": F("retail_park", "enum", "Retail park – ensemble commercial de périphérie"),
    "adresse": F("210 route des Camoins, 13011 Marseille", "adresse", "Vallon Rouge, 210 route des Camoins, 13011 Marseille"),
    "code_postal": F("13011", "texte", "13011 Marseille"), "ville": F("Marseille", "texte", "13011 Marseille"),
    "surface_m2": F("4050", "surface", "4 050 m² SDP", "m2"),
    "nombre_lots": F("4", "nombre", "4 (dont 1 vacante)"),
    "taux_occupation_pct": F("88", "pourcentage", "88 % (en surface)"),
    "locataire": ABSENT("Multi-locataires : voir lignes"),
    "date_effet_bail": ABSENT("Multi-locataires"), "indice": ABSENT("Non précisé"),
    "loyer_annuel_ht_hc": F("380400.00", "montant", "380 400 € HT HC par an", "EUR",
                            note="Ne pas confondre avec le potentiel de réversion de 52 800 € (valeur locative, pas un loyer)"),
    "prix": F("5450000.00", "montant", "5 450 000 € acte en main", "EUR"),
    "prix_base": F("acte_en_main", "enum", "5 450 000 € acte en main"),
    "rendement_annonce_pct": F("6.98", "pourcentage", "6,98 %", note="Rendement acte en main"),
    "taxe_fonciere_refacturee": F(True, "booleen", "Taxe foncière intégralement refacturée aux locataires"),
    "mandataire": F("Provence Retail Advisory", "texte", "Provence Retail Advisory")}, lignes=lignes_t04)

# État locatif Excel
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Etat locatif"
ws["A1"] = "ÉTAT LOCATIF – SCI VALLON ROUGE"; ws["A1"].font = Font(bold=True, size=14)
ws["A2"] = "Parc d'activités du Vallon Rouge – 210 route des Camoins – 13011 Marseille"
ws["A3"] = "Situation au 30/09/2026 – loyers indexés en vigueur"; ws["A3"].font = Font(italic=True)
ent = ["Lot", "Locataire", "Activité", "Surface (m²)", "Loyer annuel HT HC (€)", "Date d'effet", "Prochaine échéance triennale", "Fin de bail", "Indice", "TF refacturée"]
fill = PatternFill("solid", fgColor="DCE6F0"); thin = Side(style="thin", color="999999")
for j, h in enumerate(ent, 1):
    c = ws.cell(row=5, column=j, value=h); c.font = Font(bold=True); c.fill = fill
    c.alignment = Alignment(wrap_text=True, vertical="center"); c.border = Border(bottom=thin)
import datetime as dt
D = lambda s: dt.date.fromisoformat(s) if s else None
lignes_e01 = []
for i, (lot, loc, act, s, l, eff, tri, fin, ind, tf) in enumerate(LOTS_B):
    r = 6 + i
    vals = [lot, loc, act, s, l, D(eff), D(tri), D(fin), ind, tf]
    for j, vv in enumerate(vals, 1):
        c = ws.cell(row=r, column=j, value=vv)
        if j in (6, 7, 8) and vv: c.number_format = "DD/MM/YYYY"
        if j == 5: c.number_format = '#,##0 "€"'
        if j == 4: c.number_format = "#,##0"
    cell = lambda col: f"Etat locatif!{col}{r}"
    lignes_e01.append({"lot": F(lot, "texte", cell("A")), "locataire": F(None if loc == "VACANT" else loc, "texte", cell("B")),
                       "surface_m2": F(str(s), "surface", cell("D"), "m2"),
                       "loyer_annuel_ht_hc": F(f"{l}.00", "montant", cell("E"), "EUR"),
                       "date_effet": F(eff, "date", cell("F")) if eff else ABSENT("Lot vacant"),
                       "prochaine_echeance": F(tri, "date", cell("G")) if tri else ABSENT("Lot vacant"),
                       "date_fin_bail": F(fin, "date", cell("H")) if fin else ABSENT("Lot vacant"),
                       "indice": F(ind, "enum", cell("I")) if ind else ABSENT("Lot vacant"),
                       "taxe_fonciere_refacturee": F(True, "booleen", cell("J")) if tf else ABSENT("Lot vacant")})
ws["A10"] = "TOTAL"; ws["A10"].font = Font(bold=True)
ws["D10"] = "=SUM(D6:D9)"; ws["E10"] = "=SUM(E6:E9)"; ws["E10"].number_format = '#,##0 "€"'
ws["D10"].font = ws["E10"].font = Font(bold=True)
ws["A12"] = "Taux d'occupation (surface) :"; ws["E12"] = "=1-D9/D10"; ws["E12"].number_format = "0.0%"
for col, w in zip("ABCDEFGHIJ", [6, 28, 18, 12, 18, 12, 16, 12, 8, 10]):
    ws.column_dimensions[col].width = w
ws2 = wb.create_sheet("Notes")
ws2["A1"] = "Le lot D est vacant depuis le 15/03/2026 (départ de l'ancien locataire)."
ws2["A2"] = "Les surfaces sont des surfaces de plancher issues du permis de construire."
wb.save(f"{DOCS}/E01_etat_locatif_marseille.xlsx")
enregistre("E01", "E01_etat_locatif_marseille.xlsx", "etat_locatif", "B-Marseille", "xlsx",
           ["en-tête décalé (ligne 5)", "ligne de total en formule", "lot vacant", "2e onglet"], None,
           {"date_situation": F("2026-09-30", "date", "Etat locatif!A3"),
            "surface_totale_m2": F("4050", "surface", "Etat locatif!D10", "m2", note="Cellule en formule =SUM(D6:D9)"),
            "loyer_total_ht_hc": F("380400.00", "montant", "Etat locatif!E10", "EUR", note="Cellule en formule =SUM(E6:E9)")},
           lignes=lignes_e01)

f = natif("B02.pdf")
B02 = dict(bailleur="SCI VALLON ROUGE", bailleur_desc="société civile immobilière au capital de 10 000 €, dont le siège social est 210 route des Camoins, 13011 Marseille",
    bailleur_rcs_ville="Marseille", bailleur_siren="999 287 540", bailleur_rep="M. Henri Castellan, en sa qualité de gérant", bailleur_rep_court="M. Henri Castellan",
    preneur="SPORTISSIME MÉDITERRANÉE", preneur_desc="société par actions simplifiée au capital de 200 000 €, dont le siège social est 45 boulevard de la Valbarelle, 13011 Marseille",
    preneur_rcs_ville="Marseille", preneur_siren="999 630 118", preneur_rep="M. Karim Benali, en sa qualité de directeur général", preneur_rep_court="M. Karim Benali",
    adresse="Parc d'activités du Vallon Rouge, 210 route des Camoins, 13011 Marseille",
    designation="la cellule commerciale n° C, d'un seul niveau, comprenant une surface de vente, une réserve avec quai de livraison et des locaux sociaux, ainsi que la jouissance non exclusive des parkings communs.",
    surface=1100, surface_txt="1 100 m²", destination="vente au détail d'articles de sport, de textile et de chaussures de sport",
    duree=9, date_effet="2019-09-01", date_fin="2028-08-31", triennale="oui", loyer=110000, loyer_lettres="cent dix mille euros",
    periodicite="trimestriellement", periodicite_code="trimestriel", terme="d'avance", terme_code="echoir",
    indice="ILC", indice_base_trim="2e trimestre 2019", indice_base_val="114,47", indice_base_code="ILC_T2_2019",
    depot=None, garantie_txt="En garantie de l'exécution de ses obligations, le Preneur remettra au Bailleur, au plus tard à la date de prise d'effet du bail, une garantie autonome à première demande d'un montant égal à six mois de loyer hors taxes, émise par un établissement bancaire de premier rang.",
    garantie_val="garantie_autonome_premiere_demande_6_mois", garantie_cit="garantie autonome à première demande d'un montant égal à six mois de loyer",
    tf=True, tva=True, variante=1, ville_signature="Marseille", date_signature="2019-07-22")
ch = bail(f, B02); shutil.copy(f, f"{NAT}/B02_natif.pdf")
dg.pdf_vers_scan(f, f"{DOCS}/B02_bail_marseille_lotC_scan.pdf", "correct")
enregistre("B02", "B02_bail_marseille_lotC_scan.pdf", "bail_commercial", "B-Marseille", "pdf_scan",
           ["scan 200 dpi niveaux de gris", "légère inclinaison", "pas de couche texte"], f"{NAT}/B02_natif.pdf", ch,
           notes=["Loyer d'origine 110 000 € ; loyer indexé en vigueur 121 000 € (état locatif E01) : écart normal, pas une anomalie."])

f = natif("Q02.pdf")
piece_comptable(f, dict(emetteur="SCI VALLON ROUGE", emetteur_lignes=["210 route des Camoins", "13011 Marseille", "SIREN 999 287 540"],
    destinataire=["CROQUETTES & CO", "Cellule B – Parc d'activités du Vallon Rouge", "13011 Marseille"], titre="QUITTANCE DE LOYER",
    infos=["Mois d'octobre 2026 – cellule B", "Période : du 01/10/2026 au 31/10/2026", "Date d'émission : 01/10/2026"],
    lignes=[["Loyer octobre 2026", "6 200,00 €", "1 240,00 €", "7 440,00 €"], ["Provision charges communes", "410,00 €", "82,00 €", "492,00 €"]],
    totaux=[["Total", "6 610,00 €", "1 322,00 €", "7 932,00 €"]],
    mentions=["Le bailleur reconnaît avoir reçu la somme de 7 932,00 € TTC en paiement du loyer et des charges du mois d'octobre 2026, dont quittance.",
              "Fait à Marseille. Pour la SCI Vallon Rouge, le gérant."]))
shutil.copy(f, f"{NAT}/Q02_natif.pdf")
dg.pdf_vers_scan(f, f"{DOCS}/Q02_quittance_marseille_lotB_scan.pdf", "moyen", trous=True)
enregistre("Q02", "Q02_quittance_marseille_lotB_scan.pdf", "quittance", "B-Marseille", "pdf_scan",
           ["scan moyen", "perforations de classeur", "pas de couche texte"], f"{NAT}/Q02_natif.pdf", {
    "type_piece": F("quittance", "enum", "QUITTANCE DE LOYER"),
    "emetteur": F("SCI VALLON ROUGE", "texte", "SCI VALLON ROUGE"),
    "locataire": F("CROQUETTES & CO", "texte", "CROQUETTES & CO"),
    "periode_debut": F("2026-10-01", "date", "du 01/10/2026 au 31/10/2026"),
    "periode_fin": F("2026-10-31", "date", "du 01/10/2026 au 31/10/2026"),
    "loyer_ht": F("6200.00", "montant", "6 200,00 €", "EUR", note="Loyer mensuel ; x12 = 74 400 €, cohérent avec E01"),
    "provisions_charges_ht": F("410.00", "montant", "410,00 €", "EUR"),
    "taxe_fonciere_ht": ABSENT("Pas de ligne taxe foncière sur cette quittance"),
    "tva_totale": F("1322.00", "montant", "1 322,00 €", "EUR"),
    "total_ttc": F("7932.00", "montant", "7 932,00 €", "EUR"),
    "date_emission": F("2026-10-01", "date", "Date d'émission : 01/10/2026")})

# ============================ DOSSIER C — PARIS =============================
f = natif("T05.pdf")
teaser(f, dict(titre="Paris 9e – Immeuble de bureaux multilocataire",
    accroche="Immeuble indépendant de 1 480 m² sur 4 niveaux, entièrement loué à 3 locataires",
    chiffres=[("Adresse", "48 rue de Provence, 75009 Paris"), ("Type d'actif", "Immeuble de bureaux"),
              ("Surface", "1 480 m² utiles (R+3)"), ("Nombre de locataires", "3"), ("Loyer total", "612 400 € HT HC par an"),
              ("Durée résiduelle moyenne des baux (WALB)", "4,1 ans"), ("Prix", "10 900 000 € hors droits"),
              ("Rendement", "5,62 % hors droits"), ("Indexation", "ILAT et ILC selon les baux"),
              ("Fiscalité", "Taxe foncière refacturée aux locataires")],
    paragraphes=[("Situation", "Au cœur du quartier central des affaires élargi, entre l'Opéra et la gare Saint-Lazare, l'immeuble bénéficie d'une desserte exceptionnelle (métro, RER, gare)."),
                 ("L'immeuble", "Immeuble en pierre de taille du XIXe siècle restructuré en 2018, plateaux lumineux de 380 à 450 m² environ, ascenseur, climatisation réversible, DPE C.")],
    tableau=("Locataires", ["Étage", "Locataire", "Surface", "Loyer annuel", "Fin de bail"],
             [["RDC + 1er", "Altitude Conseil", "640 m²", "262 880 €", "30/06/2031"],
              ["2e", "Cabinet Morel Avocats", "452 m²", "205 320 €", "31/12/2029"],
              ["3e", "Studio Kéa", "388 m²", "144 200 €", "31/03/2028"],
              ["Total", "", "1 480 m²", "612 400 €", ""]], [26, 58, 26, 34, 30]),
    tableau_total=True,
    mandataire=["Opéra Investissement – Capital Markets", "Hugo Lambert – h.lambert@opera-invest.example – 01 00 00 00 03"]))
shutil.copy(f, f"{DOCS}/T05_teaser_paris_bureaux.pdf")
enregistre("T05", "T05_teaser_paris_bureaux.pdf", "teaser", "C-Paris", "pdf_natif", ["tableau"], f, {
    "type_actif": F("bureaux", "enum", "Immeuble de bureaux"),
    "adresse": F("48 rue de Provence, 75009 Paris", "adresse", "48 rue de Provence, 75009 Paris"),
    "code_postal": F("75009", "texte", "75009 Paris"), "ville": F("Paris", "texte", "75009 Paris"),
    "surface_m2": F("1480", "surface", "1 480 m² utiles (R+3)", "m2"),
    "nombre_lots": F("3", "nombre", "Nombre de locataires 3"),
    "locataire": ABSENT("Multi-locataires : voir lignes"), "date_effet_bail": ABSENT("Multi-locataires"),
    "loyer_annuel_ht_hc": F("612400.00", "montant", "612 400 € HT HC par an", "EUR"),
    "walb_annonce_annees": F("4.1", "nombre", "4,1 ans", "ans"),
    "prix": F("10900000.00", "montant", "10 900 000 € hors droits", "EUR"),
    "prix_base": F("hors_droits", "enum", "10 900 000 € hors droits"),
    "rendement_annonce_pct": F("5.62", "pourcentage", "5,62 % hors droits"),
    "indice": F("ILAT+ILC", "enum", "ILAT et ILC selon les baux"),
    "taxe_fonciere_refacturee": F(True, "booleen", "Taxe foncière refacturée aux locataires"),
    "mandataire": F("Opéra Investissement", "texte", "Opéra Investissement")},
    lignes=[{"locataire": F("Altitude Conseil", "texte", "Altitude Conseil"), "surface_m2": F("640", "surface", "640 m²", "m2"),
             "loyer_annuel_ht_hc": F("262880.00", "montant", "262 880 €", "EUR"), "date_fin_bail": F("2031-06-30", "date", "30/06/2031")},
            {"locataire": F("Cabinet Morel Avocats", "texte", "Cabinet Morel Avocats"), "surface_m2": F("452", "surface", "452 m²", "m2"),
             "loyer_annuel_ht_hc": F("205320.00", "montant", "205 320 €", "EUR"), "date_fin_bail": F("2029-12-31", "date", "31/12/2029")},
            {"locataire": F("Studio Kéa", "texte", "Studio Kéa"), "surface_m2": F("388", "surface", "388 m²", "m2"),
             "loyer_annuel_ht_hc": F("144200.00", "montant", "144 200 €", "EUR"), "date_fin_bail": F("2028-03-31", "date", "31/03/2028")}])

f = natif("B05.pdf")
B05 = dict(bailleur="FONCIÈRE HAUSSMANN-PROVENCE", bailleur_desc="société par actions simplifiée au capital de 2 500 000 €, dont le siège social est 48 rue de Provence, 75009 Paris",
    bailleur_rcs_ville="Paris", bailleur_siren="999 845 302", bailleur_rep="M. Laurent Delacroix, en sa qualité de président", bailleur_rep_court="M. Laurent Delacroix",
    preneur="ALTITUDE CONSEIL", preneur_desc="société par actions simplifiée au capital de 120 000 €, ayant son siège social dans les lieux loués",
    preneur_rcs_ville="Paris", preneur_siren="999 573 914", preneur_rep="Mme Sophie Garnier, en sa qualité de présidente", preneur_rep_court="Mme Sophie Garnier",
    adresse="48 rue de Provence, 75009 Paris",
    designation="des locaux à usage de bureaux situés au rez-de-chaussée et au premier étage de l'immeuble, ainsi que huit emplacements de stationnement au deuxième sous-sol.",
    surface=612, surface_txt="612 m² utiles", destination="bureaux et activités de conseil aux entreprises",
    duree=9, date_effet="2022-07-01", date_fin="2031-06-30", triennale="premiere", loyer=248000, loyer_lettres="deux cent quarante-huit mille euros",
    periodicite="trimestriellement", periodicite_code="trimestriel", terme="d'avance", terme_code="echoir", franchise=4,
    indice="ILAT", indice_base_trim="1er trimestre 2022", indice_base_val="120,73", indice_base_code="ILAT_T1_2022",
    depot=62000, depot_mois=3, tf=True, tva=True, variante=2, ville_signature="Paris", date_signature="2022-06-10")
ch = bail(f, B05); shutil.copy(f, f"{DOCS}/B05_bail_paris_bureaux.pdf")
enregistre("B05", "B05_bail_paris_bureaux.pdf", "bail_commercial", "C-Paris", "pdf_natif", ["franchise", "renonciation 1re triennale"], f, ch)

f = natif("E02.pdf")
etat_locatif_pdf(f, dict(titre="État locatif – 48 rue de Provence, 75009 Paris", soustitre="Propriétaire : Foncière Haussmann-Provence – situation au 30/09/2026",
    entetes=["Étage", "Locataire", "Activité", "Surface (m²)", "Loyer annuel HT HC", "Date d'effet", "Fin de bail", "Indice", "Dépôt de garantie"],
    largeurs=[22, 46, 28, 22, 32, 24, 24, 16, 30],
    lignes=[["RDC + 1er", "Altitude Conseil", "Conseil", "640", "262 880 €", "01/07/2022", "30/06/2031", "ILAT", "62 000 €"],
            ["2e", "Cabinet Morel Avocats", "Avocats", "452", "205 320 €", "01/01/2020", "31/12/2029", "ILAT", "51 330 €"],
            ["3e", "Studio Kéa", "Architecture", "388", "144 200 €", "01/04/2019", "31/03/2028", "ILC", "36 050 €"],
            ["Total", "", "", "1 480", "612 400 €", "", "", "", "149 380 €"]],
    notes=["Loyers indexés en vigueur au 30/09/2026.", "Surfaces utiles communiquées par le bailleur, non certifiées par un géomètre."]))
shutil.copy(f, f"{DOCS}/E02_etat_locatif_paris.pdf")
enregistre("E02", "E02_etat_locatif_paris.pdf", "etat_locatif", "C-Paris", "pdf_natif", ["tableau paysage", "ligne de total"], f,
    {"date_situation": F("2026-09-30", "date", "situation au 30/09/2026"),
     "surface_totale_m2": F("1480", "surface", "1 480", "m2"), "loyer_total_ht_hc": F("612400.00", "montant", "612 400 €", "EUR")},
    lignes=[{"locataire": F(n, "texte", n), "surface_m2": F(s, "surface", s, "m2"), "loyer_annuel_ht_hc": F(l, "montant", lc, "EUR"),
             "date_effet": F(e, "date", date_num(e)), "date_fin_bail": F(fi, "date", date_num(fi)), "indice": F(i, "enum", i),
             "depot_garantie": F(d, "montant", dc, "EUR")}
            for n, s, l, lc, e, fi, i, d, dc in [
                ("Altitude Conseil", "640", "262880.00", "262 880 €", "2022-07-01", "2031-06-30", "ILAT", "62000.00", "62 000 €"),
                ("Cabinet Morel Avocats", "452", "205320.00", "205 320 €", "2020-01-01", "2029-12-31", "ILAT", "51330.00", "51 330 €"),
                ("Studio Kéa", "388", "144200.00", "144 200 €", "2019-04-01", "2028-03-31", "ILC", "36050.00", "36 050 €")]])

f = natif("Q03.pdf")
piece_comptable(f, dict(emetteur="Foncière Haussmann-Provence – Gestion locative",
    emetteur_lignes=["48 rue de Provence, 75009 Paris", "quittancement@fhp.example"],
    destinataire=["ALTITUDE CONSEIL", "48 rue de Provence", "75009 Paris"], titre="AVIS D'ÉCHÉANCE",
    infos=["Référence locataire : ALT-0091", "Échéance du 01/10/2026", "Période : du 01/10/2026 au 31/12/2026", "Date d'émission : 15/09/2026"],
    lignes=[["Loyer bureaux 4e trimestre 2026", "66 200,00 €", "13 240,00 €", "79 440,00 €"],
            ["Provisions sur charges et taxes", "9 180,00 €", "1 836,00 €", "11 016,00 €"]],
    totaux=[["Total à payer", "75 380,00 €", "15 076,00 €", "90 456,00 €"]],
    mentions=["Montant payable au plus tard le 01/10/2026 par virement. Le présent avis ne vaut pas quittance.",
              "Les provisions incluent la quote-part de taxe foncière et de taxe sur les bureaux en Île-de-France."]))
shutil.copy(f, f"{DOCS}/Q03_avis_echeance_paris_T4-2026.pdf")
enregistre("Q03", "Q03_avis_echeance_paris_T4-2026.pdf", "quittance", "C-Paris", "pdf_natif", ["avis d'échéance, pas une quittance"], f, {
    "type_piece": F("avis_echeance", "enum", "AVIS D'ÉCHÉANCE"),
    "emetteur": F("Foncière Haussmann-Provence", "texte", "Foncière Haussmann-Provence"),
    "locataire": F("ALTITUDE CONSEIL", "texte", "ALTITUDE CONSEIL"),
    "periode_debut": F("2026-10-01", "date", "du 01/10/2026 au 31/12/2026"),
    "periode_fin": F("2026-12-31", "date", "du 01/10/2026 au 31/12/2026"),
    "loyer_ht": F("66200.00", "montant", "66 200,00 €", "EUR", note="x4 = 264 800 € ≠ 262 880 € de l'état locatif E02 : anomalie volontaire"),
    "provisions_charges_ht": F("9180.00", "montant", "9 180,00 €", "EUR"),
    "taxe_fonciere_ht": ABSENT("Incluse dans les provisions, non isolée"),
    "tva_totale": F("15076.00", "montant", "15 076,00 €", "EUR"),
    "total_ttc": F("90456.00", "montant", "90 456,00 €", "EUR"),
    "date_emission": F("2026-09-15", "date", "Date d'émission : 15/09/2026")})

# ============================= DOSSIER D — NICE =============================
f = natif("T02.pdf")
teaser(f, dict(titre="Nice centre – Murs de restaurant",
    accroche="Local de 85 m² avec terrasse en hyper-centre, bail renouvelé en 2025",
    chiffres=[("Adresse", "21 rue Pastorelli, 06000 Nice"), ("Type d'actif", "Murs de commerce – restauration"),
              ("Surface", "85 m² + terrasse de 20 m²"), ("Locataire", "Le Comptoir Niçois (SARL)"),
              ("Bail", "Renouvelé pour 9 ans à compter du 1er octobre 2025"), ("Loyer", "41 400 € HT HC / an"),
              ("Prix", "690 000 € net vendeur"), ("Rendement", "6,00 % net vendeur"), ("Taxe foncière", "Refacturée au preneur")],
    paragraphes=[("Situation", "À 200 mètres de l'avenue Jean-Médecin et de la place Masséna, dans une rue piétonne très fréquentée le midi par les actifs du quartier."),
                 ("Le locataire", "Restaurant traditionnel exploité par le même gérant depuis 2016, licence IV attachée au fonds.")],
    mandataire=["Riviera Commerces", "Sarah Benhamou – s.benhamou@riviera-commerces.example – 04 00 00 00 04"]))
shutil.copy(f, f"{NAT}/T02_natif.pdf")
dg.pdf_vers_scan(f, f"{DOCS}/T02_teaser_nice_scan.pdf", "moyen")
enregistre("T02", "T02_teaser_nice_scan.pdf", "teaser", "D-Nice", "pdf_scan", ["scan moyen", "pas de couche texte"], f"{NAT}/T02_natif.pdf", {
    "type_actif": F("commerce_restauration", "enum", "Murs de commerce – restauration"),
    "adresse": F("21 rue Pastorelli, 06000 Nice", "adresse", "21 rue Pastorelli, 06000 Nice"),
    "code_postal": F("06000", "texte", "06000 Nice"), "ville": F("Nice", "texte", "06000 Nice"),
    "surface_m2": F("85", "surface", "85 m² + terrasse de 20 m²", "m2", note="La terrasse (domaine public) n'est pas de la surface louée"),
    "locataire": F("LE COMPTOIR NIÇOIS", "texte", "Le Comptoir Niçois (SARL)"),
    "date_effet_bail": F("2025-10-01", "date", "Renouvelé pour 9 ans à compter du 1er octobre 2025"),
    "loyer_annuel_ht_hc": F("41400.00", "montant", "41 400 € HT HC / an", "EUR"),
    "prix": F("690000.00", "montant", "690 000 € net vendeur", "EUR"), "prix_base": F("net_vendeur", "enum", "690 000 € net vendeur"),
    "rendement_annonce_pct": F("6.00", "pourcentage", "6,00 % net vendeur"),
    "indice": ABSENT("Non précisé dans le teaser"),
    "taxe_fonciere_refacturee": F(True, "booleen", "Refacturée au preneur"),
    "mandataire": F("Riviera Commerces", "texte", "Riviera Commerces")})

f = natif("B03.pdf")
B03 = dict(bailleur="SCI BAIE DES ANGES PATRIMOINE", bailleur_desc="société civile immobilière au capital de 1 500 €, dont le siège social est 9 rue de la Liberté, 06000 Nice",
    bailleur_rcs_ville="Nice", bailleur_siren="999 361 775", bailleur_rep="Mme Hélène Ricci, en sa qualité de gérante", bailleur_rep_court="Mme Hélène Ricci",
    preneur="LE COMPTOIR NIÇOIS", preneur_desc="société à responsabilité limitée au capital de 8 000 €, dont le siège social est 21 rue Pastorelli, 06000 Nice",
    preneur_rcs_ville="Nice", preneur_siren="999 718 402", preneur_rep="M. Marc Giordano, en sa qualité de gérant", preneur_rep_court="M. Marc Giordano",
    adresse="21 rue Pastorelli, 06000 Nice",
    designation="un local commercial à usage de restaurant situé au rez-de-chaussée, comprenant une salle, une cuisine équipée d'une extraction, des sanitaires et une réserve.",
    surface=85, surface_txt="85 m²", destination="restauration traditionnelle, sur place et à emporter, avec vente de boissons alcoolisées dans le cadre de la licence attachée au fonds",
    duree=9, date_effet="2016-10-01", date_fin="2025-09-30", triennale="oui", loyer=36000, loyer_lettres="trente-six mille euros",
    periodicite="mensuellement", periodicite_code="mensuel", terme="d'avance", terme_code="echoir",
    indice="ILC", indice_base_trim="2e trimestre 2016", indice_base_val="108,40", indice_base_code="ILC_T2_2016",
    depot=9000, depot_mois=3, tf=True, tva=False, variante=2, taille=10.8, ville_signature="Nice", date_signature="2016-09-12")
ch = bail(f, B03); shutil.copy(f, f"{NAT}/B03_natif.pdf")
pg_l, x0, y0, x1, y1 = localise(f, "trente-six mille euros")
pg_i, ix0, iy0, ix1, iy1 = localise(f, "soit 108,40")
with pdfplumber.open(f) as d_: nb03 = len(d_.pages)
ret = {0: [lambda im: dg.tampon(im, "ENREGISTRÉ", (0.78, 0.07), sous="SIE Nice – 20 sept. 2016", taille=40, angle=8)]}
ret.setdefault(pg_l, []).append(lambda im, y=y1: dg.manuscrit(im, "→ 41 400 € depuis oct. 2025 (avenant)", (0.40, y + 0.004), taille=30))
ret.setdefault(pg_l, []).append(lambda im, a=(x0, y0, x1, y1): dg.souligner(im, a[3] + 0.002, a[0], a[2]))
ret.setdefault(pg_i, []).append(lambda im, a=(ix0, iy0, ix1, iy1): dg.entourer(im, (a[0] - 0.01, a[1] - 0.008, a[2] + 0.01, a[3] + 0.008)))
ret.setdefault(pg_i, []).append(lambda im: dg.manuscrit(im, "vérifier indice ?", (0.70, 0.04), taille=28, angle=6))
ret.setdefault(nb03 - 1, []).append(lambda im: dg.tampon(im, "COPIE", (0.5, 0.55), taille=90, angle=-25, alpha=0.45))
dg.pdf_vers_scan(f, f"{DOCS}/B03_bail_nice_scan_degrade.pdf", "degrade", retouches=ret, gris=False, trous=True)
enregistre("B03", "B03_bail_nice_scan_degrade.pdf", "bail_commercial", "D-Nice", "pdf_scan",
           ["scan dégradé couleur", "tampon d'enregistrement p.1", "annotation manuscrite contradictoire sur le loyer",
            "indice entouré au stylo", "tampon COPIE sur la dernière page", "perforations"], f"{NAT}/B03_natif.pdf", ch,
           notes=["Piège : l'annotation manuscrite « 41 400 € » n'est pas le loyer du bail. La valeur attendue est le texte imprimé (36 000 €).",
                  "Le bail est échu au 30/09/2025 et renouvelé par l'avenant A02."])

f = natif("A02.pdf")
ch = avenant(f, dict(numero=1, date="2025-07-08", bail_date="2016-09-12", adresse=B03["adresse"], ville="Nice",
    bailleur=B03["bailleur"], bailleur_desc="société civile immobilière, représentée par Mme Hélène Ricci, gérante",
    preneur=B03["preneur"], preneur_desc="société à responsabilité limitée, représentée par M. Marc Giordano, gérant",
    expose="Le bail arrivant à expiration le 30 septembre 2025, les parties se sont rapprochées afin de convenir de son renouvellement amiable, sans qu'il soit besoin de délivrer congé ni demande de renouvellement.",
    articles=[("Renouvellement", "Le bail est renouvelé pour une durée de neuf (9) années à compter du 1er octobre 2025, pour se terminer le 30 septembre 2034."),
              ("Loyer du bail renouvelé", "Le loyer annuel du bail renouvelé est fixé d'un commun accord à la somme de 41 400 € hors taxes et hors charges, payable mensuellement et d'avance."),
              ("Indexation", "L'indexation annuelle se poursuivra sur la base de l'indice des loyers commerciaux (ILC), l'indice de base étant celui du 1er trimestre 2025, soit 135,30.")],
    champs={"objet": F("renouvellement", "enum", "Renouvellement"),
            "nouvelle_duree_annees": F("9", "nombre", "durée de neuf (9) années à compter du 1er octobre 2025", "ans"),
            "date_effet_modification": F("2025-10-01", "date", "à compter du 1er octobre 2025"),
            "nouvelle_date_fin": F("2034-09-30", "date", "pour se terminer le 30 septembre 2034"),
            "nouveau_loyer_annuel_ht_hc": F("41400.00", "montant", "la somme de 41 400 € hors taxes et hors charges", "EUR"),
            "nouvel_indice_base": F("ILC_T1_2025=135.30", "indice_base", "celui du 1er trimestre 2025, soit 135,30")}))
shutil.copy(f, f"{NAT}/A02_natif.pdf")
dg.pdf_vers_scan(f, f"{DOCS}/A02_avenant_nice_renouvellement_scan.pdf", "moyen")
enregistre("A02", "A02_avenant_nice_renouvellement_scan.pdf", "avenant", "D-Nice", "pdf_scan", ["scan moyen", "pas de couche texte"],
           f"{NAT}/A02_natif.pdf", ch, notes=["Avenant qui change la durée (renouvellement 9 ans) et le loyer."])

# =========================== DOSSIER E — BORDEAUX ===========================
f = natif("B06.pdf")
B06 = dict(bailleur="SCI INTENDANCE 33", bailleur_desc="société civile immobilière au capital de 5 000 €, dont le siège social est 12 allées de Tourny, 33000 Bordeaux",
    bailleur_rcs_ville="Bordeaux", bailleur_siren="999 529 064", bailleur_rep="M. Olivier Lafon, en sa qualité de gérant", bailleur_rep_court="M. Olivier Lafon",
    preneur="PHARMACIE DU PORT DE LA LUNE", preneur_desc="société d'exercice libéral à responsabilité limitée au capital de 150 000 €, dont le siège social est 57 cours Alsace-et-Lorraine, 33000 Bordeaux",
    preneur_rcs_ville="Bordeaux", preneur_siren="999 486 230", preneur_rep="Mme Juliette Barrère, pharmacienne titulaire, en sa qualité de gérante", preneur_rep_court="Mme Juliette Barrère",
    adresse="57 cours Alsace-et-Lorraine, 33000 Bordeaux",
    designation="un local commercial à usage d'officine de pharmacie situé au rez-de-chaussée, comprenant un espace de vente, un local de préparation, un bureau et une réserve, ainsi qu'une cave au sous-sol.",
    surface=168, surface_txt=f"168{NBSP}m²", destination="officine de pharmacie, parapharmacie et vente de matériel médical",
    duree=10, date_effet="2024-01-01", date_fin="2033-12-31", triennale="non", loyer=58000, loyer_lettres="cinquante-huit mille euros",
    periodicite="trimestriellement", periodicite_code="trimestriel", terme="à terme échu", terme_code="echu",
    indice="ILC", indice_base_trim="3e trimestre 2023", indice_base_val="132,15", indice_base_code="ILC_T3_2023",
    depot=14500, depot_mois=3, tf=True, tva=False, variante=0, sep=NBSP, ville_signature="Bordeaux", date_signature="2023-12-04")
ch = bail(f, B06); shutil.copy(f, f"{DOCS}/B06_bail_bordeaux_pharmacie.pdf")
enregistre("B06", "B06_bail_bordeaux_pharmacie.pdf", "bail_commercial", "E-Bordeaux", "pdf_natif",
           ["espaces insécables dans les montants", "bail ferme 10 ans", "loyer à terme échu", "pas de TVA"], f, ch)

msg = EmailMessage()
msg["From"] = "Thomas Rivière <t.riviere@cabinet-dupre-transactions.example>"
msg["To"] = "Analyste Investissement <analyste@fonds-exemple.example>"
msg["Subject"] = "TR: Off-market Bordeaux – murs de pharmacie cours Alsace-et-Lorraine"
msg["Date"] = "Wed, 21 Oct 2026 09:42:17 +0200"
msg["Message-ID"] = "<20261021094217.4471@cabinet-dupre-transactions.example>"
corps = """Bonjour,

Comme évoqué au téléphone, je vous transmets une opportunité off-market à Bordeaux, en exclusivité pour quelques jours :

- Murs d'une pharmacie au 57 cours Alsace-et-Lorraine, 33000 Bordeaux
- Surface : 168 m² + cave
- Locataire : Pharmacie du Port de la Lune (SELARL), dans les lieux depuis 2009
- Bail ferme de 10 ans à compter du 1er janvier 2024, sans faculté de résiliation triennale
- Loyer : 58 000 € HT HC par an, indexé ILC, non soumis à TVA
- Prix demandé : 980 000 € frais d'agence inclus, hors frais de notaire
- Rendement : 5,92 %

Le propriétaire souhaite une réponse rapide. Je peux vous ouvrir la data room (bail, avenants, taxes foncières 2023-2025, DPE) dès réception d'une lettre de confidentialité signée.

Bien cordialement,

Thomas Rivière
Cabinet Dupré Transactions – Commerce & Investissement
06 00 00 00 05

-----Message d'origine-----
De : Olivier Lafon
Envoyé : lundi 12 octobre 2026 18:05
À : Thomas Rivière
Objet : Pharmacie cours Alsace-Lorraine

Thomas,
Suite à notre rendez-vous, je confirme que je suis vendeur. J'avais en tête un prix autour de 1 050 000 €, mais je suis prêt à discuter si l'acquéreur est sérieux et rapide.
Olivier
"""
msg.set_content(corps)
html = "<html><body>" + "".join(f"<p>{esc(par).replace(chr(10), '<br>')}</p>" for par in corps.split("\n\n")) + "</body></html>"
msg.add_alternative(html, subtype="html")
with open(f"{DOCS}/T03_teaser_bordeaux_email.eml", "wb") as fh:
    fh.write(bytes(msg))
enregistre("T03", "T03_teaser_bordeaux_email.eml", "teaser", "E-Bordeaux", "eml",
           ["teaser dans le corps du mail", "fil transféré avec un ancien prix", "texte + HTML"], None, {
    "type_actif": F("commerce_pharmacie", "enum", "Murs d'une pharmacie"),
    "adresse": F("57 cours Alsace-et-Lorraine, 33000 Bordeaux", "adresse", "57 cours Alsace-et-Lorraine, 33000 Bordeaux"),
    "code_postal": F("33000", "texte", "33000 Bordeaux"), "ville": F("Bordeaux", "texte", "33000 Bordeaux"),
    "surface_m2": F("168", "surface", "Surface : 168 m² + cave", "m2"),
    "locataire": F("PHARMACIE DU PORT DE LA LUNE", "texte", "Pharmacie du Port de la Lune (SELARL)"),
    "date_effet_bail": F("2024-01-01", "date", "à compter du 1er janvier 2024"),
    "duree_ferme_annees": F("10", "nombre", "Bail ferme de 10 ans", "ans"),
    "loyer_annuel_ht_hc": F("58000.00", "montant", "58 000 € HT HC par an", "EUR"),
    "indice": F("ILC", "enum", "indexé ILC"), "option_tva": F(False, "booleen", "non soumis à TVA"),
    "prix": F("980000.00", "montant", "980 000 € frais d'agence inclus", "EUR",
              note="Le prix de 1 050 000 € du message d'origine est un ancien souhait du vendeur, pas le prix demandé"),
    "prix_base": F("fai_hors_frais_notaire", "enum", "frais d'agence inclus, hors frais de notaire"),
    "rendement_annonce_pct": F("5.92", "pourcentage", "Rendement : 5,92 %"),
    "taxe_fonciere_refacturee": ABSENT("Non mentionnée dans le mail"),
    "mandataire": F("Cabinet Dupré Transactions", "texte", "Cabinet Dupré Transactions")}, partie="text/plain")

# =========================== DOSSIER F — TOULOUSE ===========================
B04 = dict(bailleur="SCI CAPITOLE 18", bailleur_desc="société civile immobilière au capital de 2 000 €, dont le siège social est 9 rue Croix-Baragnon, 31000 Toulouse",
    bailleur_rcs_ville="Toulouse", bailleur_siren="999 152 609", bailleur_rep="M. Bernard Esquirol, en sa qualité de gérant", bailleur_rep_court="M. Bernard Esquirol",
    preneur="BOULANGERIES GARONNE", preneur_desc="société par actions simplifiée au capital de 300 000 €, dont le siège social est 5 allée Jean-Jaurès, 31000 Toulouse",
    preneur_rcs_ville="Toulouse", preneur_siren="999 804 557", preneur_rep="M. Thierry Cazals, en sa qualité de président", preneur_rep_court="M. Thierry Cazals",
    adresse="18 rue d'Alsace-Lorraine, 31000 Toulouse",
    designation="une boutique située au rez-de-chaussée, à usage de boulangerie-pâtisserie, comprenant un espace de vente, un fournil et un laboratoire.",
    surface=82, surface_txt="82 m²", destination="boulangerie, pâtisserie, viennoiserie, snacking et vente de boissons non alcoolisées",
    duree=9, date_effet="2018-06-01", date_fin="2027-05-31", triennale="oui", loyer=45000, loyer_lettres="quarante-cinq mille euros",
    periodicite="mensuellement", periodicite_code="mensuel", terme="d'avance", terme_code="echoir",
    indice="ILC", indice_base_trim="4e trimestre 2017", indice_base_val="111,33", indice_base_code="ILC_T4_2017",
    depot=11250, depot_mois=3, tf=True, tva=True, variante=1, ville_signature="Toulouse", date_signature="2018-05-14")
part = {"bailleur": B04["bailleur"], "bailleur_desc": "société civile immobilière, représentée par M. Bernard Esquirol, gérant",
        "preneur": B04["preneur"], "preneur_desc": "société par actions simplifiée, représentée par M. Thierry Cazals, président",
        "adresse": B04["adresse"], "ville": "Toulouse", "bail_date": "2018-05-14"}
fb, fa1, fa2 = natif("B04_bail.pdf"), natif("B04_av1.pdf"), natif("B04_av2.pdf")
ch_b = bail(fb, B04)
ch_a1 = avenant(fa1, dict(part, numero=1, date="2019-11-20",
    expose="Le Preneur a sollicité la mise à disposition d'une réserve supplémentaire attenante, actuellement libre de toute occupation.",
    articles=[("Extension de l'assiette du bail", "À compter du 1er janvier 2020, l'assiette du bail est étendue à une réserve de 30 m² située au rez-de-chaussée sur cour, portant la surface totale des locaux loués à 112 m²."),
              ("Loyer", "En conséquence, à compter du 1er janvier 2020, le loyer annuel est porté à la somme de 48 600 € hors taxes et hors charges.")],
    champs={"objet": F("extension_surface", "enum", "Extension de l'assiette du bail"),
            "nouvelle_surface_m2": F("112", "surface", "portant la surface totale des locaux loués à 112 m²", "m2"),
            "nouveau_loyer_annuel_ht_hc": F("48600.00", "montant", "le loyer annuel est porté à la somme de 48 600 € hors taxes et hors charges", "EUR"),
            "date_effet_modification": F("2020-01-01", "date", "À compter du 1er janvier 2020, l'assiette")}))
ch_a2 = avenant(fa2, dict(part, numero=2, date="2021-03-02",
    expose="En raison des mesures administratives de fermeture partielle liées à la crise sanitaire, le Preneur a sollicité un aménagement temporaire du loyer.",
    articles=[("Aménagement temporaire du loyer", "Pour la période du 1er avril 2021 au 30 juin 2021, le loyer est réduit de 50 %. À compter du 1er juillet 2021, le loyer contractuel en vigueur s'applique à nouveau sans autre modification.")],
    champs={"objet": F("reduction_temporaire", "enum", "Aménagement temporaire du loyer"),
            "reduction_pct": F("50", "pourcentage", "le loyer est réduit de 50 %"),
            "periode_debut": F("2021-04-01", "date", "Pour la période du 1er avril 2021 au 30 juin 2021"),
            "periode_fin": F("2021-06-30", "date", "Pour la période du 1er avril 2021 au 30 juin 2021"),
            "nouveau_loyer_annuel_ht_hc": ABSENT("Réduction temporaire : le loyer contractuel n'est pas modifié durablement")}))
fa1_scan = natif("B04_av1_scan.pdf")
dg.pdf_vers_scan(fa1, fa1_scan, "moyen")
w_dist, w_nat = PdfWriter(), PdfWriter()
segs, page0 = [], 0
for typ, src_dist, src_nat, chs in [("bail_commercial", fb, fb, ch_b), ("avenant", fa1_scan, fa1, ch_a1), ("avenant", fa2, fa2, ch_a2)]:
    rd, rn = PdfReader(src_dist), PdfReader(src_nat)
    for pg in rd.pages: w_dist.add_page(pg)
    for pg in rn.pages: w_nat.add_page(pg)
    segs.append({"doc_type": typ, "pages": [page0 + 1, page0 + len(rn.pages)], "champs": chs})
    page0 += len(rn.pages)
w_dist.write(f"{DOCS}/B04_bail_toulouse_avec_avenants_1-2.pdf")
w_nat.write(f"{NAT}/B04_natif.pdf")
enregistre("B04", "B04_bail_toulouse_avec_avenants_1-2.pdf", "bail_commercial", "F-Toulouse", "pdf_mixte",
           ["un seul PDF : bail + avenant 1 + avenant 2", "avenant 1 scanné au milieu de pages natives", "découpage en sous-documents"],
           f"{NAT}/B04_natif.pdf", segments=segs,
           notes=["Les pages des segments et des citations sont celles du PDF fusionné.",
                  "Le loyer en vigueur après les avenants 1 et 2 est 48 600 € ; l'avenant A03 le ramène à 47 000 € au 01/07/2026."])

f = natif("A03.pdf")
ch = avenant(f, dict(part, numero=3, date="2026-05-18",
    expose="Les avenants n° 1 du 20 novembre 2019 et n° 2 du 2 mars 2021 ont modifié l'assiette du bail et aménagé temporairement le loyer. Le Preneur a sollicité une révision du loyer à la baisse, en contrepartie d'un engagement de durée.",
    articles=[("Loyer", "À compter du 1er juillet 2026, le loyer annuel est fixé à la somme de 47 000 € hors taxes et hors charges. Ce montant constituera le nouveau loyer de référence pour les indexations ultérieures."),
              ("Prorogation", "Le bail, qui devait expirer le 31 mai 2027, est prorogé de trois années, soit jusqu'au 31 mai 2030. Le Preneur renonce à donner congé avant cette date.")],
    champs={"objet": F("baisse_loyer_prorogation", "enum", "Prorogation"),
            "nouveau_loyer_annuel_ht_hc": F("47000.00", "montant", "le loyer annuel est fixé à la somme de 47 000 € hors taxes et hors charges", "EUR"),
            "date_effet_modification": F("2026-07-01", "date", "À compter du 1er juillet 2026"),
            "nouvelle_date_fin": F("2030-05-31", "date", "soit jusqu'au 31 mai 2030")}))
shutil.copy(f, f"{DOCS}/A03_avenant3_toulouse_loyer.pdf")
enregistre("A03", "A03_avenant3_toulouse_loyer.pdf", "avenant", "F-Toulouse", "pdf_natif", ["renvoie à des avenants précédents"], f, ch)

f = natif("T06.pdf")
teaser(f, dict(titre="Toulouse hyper-centre – Murs de boulangerie",
    accroche="Boutique de 112 m² rue d'Alsace-Lorraine, locataire réseau régional, bail prorogé jusqu'en 2030",
    chiffres=[("Adresse", "18 rue d'Alsace-Lorraine, 31000 Toulouse"), ("Type d'actif", "Murs de commerce – boulangerie"),
              ("Surface", "112 m² (82 m² boutique + 30 m² réserve)"), ("Locataire", "Boulangeries Garonne (SAS, 14 points de vente)"),
              ("Fin du bail", "31 mai 2030 (après avenant de prorogation)"), ("Loyer", "47 000 € HT HC / an depuis le 1er juillet 2026"),
              ("Indexation", "ILC"), ("Prix", "760 000 € net vendeur"), ("Rendement", "6,18 % net vendeur"),
              ("Taxe foncière", "Refacturée au preneur")],
    paragraphes=[("Situation", "Artère commerçante majeure entre le Capitole et le square Charles-de-Gaulle, métro Capitole et Jean-Jaurès à proximité immédiate."),
                 ("Le locataire", "Réseau régional de 14 boulangeries, en croissance, dont c'est l'un des points de vente les plus performants.")],
    tableau=("Annexe – Historique du bail", ["Date", "Acte", "Effet sur le loyer"],
             [["14/05/2018", "Bail commercial 9 ans", "Loyer initial 45 000 €"],
              ["20/11/2019", "Avenant n° 1 – extension réserve 30 m²", "Loyer porté à 48 600 €"],
              ["02/03/2021", "Avenant n° 2 – aménagement temporaire", "−50 % d'avril à juin 2021"],
              ["18/05/2026", "Avenant n° 3 – baisse de loyer et prorogation", "Loyer de 47 000 € au 01/07/2026"]], [28, 82, 64]),
    saut_tableau=True,
    mandataire=["Garonne Immobilier d'Entreprise", "Camille Roux – c.roux@garonne-ie.example – 05 00 00 00 06"]))
shutil.copy(f, f"{NAT}/T06_natif.pdf")
with pdfplumber.open(f) as d_: nb06 = len(d_.pages)
ret = {0: [lambda im: dg.tampon(im, "CONFIDENTIEL", (0.72, 0.12), taille=50, angle=-10, alpha=0.6)]}
dg.pdf_vers_scan(f, f"{DOCS}/T06_teaser_toulouse_scan.pdf", "moyen", retouches=ret, gris=False, pivot90=(nb06 - 1,) if nb06 > 1 else ())
enregistre("T06", "T06_teaser_toulouse_scan.pdf", "teaser", "F-Toulouse", "pdf_scan",
           ["scan moyen couleur", "tampon CONFIDENTIEL", "dernière page scannée à 90°"], f"{NAT}/T06_natif.pdf", {
    "type_actif": F("commerce_pied_immeuble", "enum", "Murs de commerce – boulangerie"),
    "adresse": F("18 rue d'Alsace-Lorraine, 31000 Toulouse", "adresse", "18 rue d'Alsace-Lorraine, 31000 Toulouse"),
    "code_postal": F("31000", "texte", "31000 Toulouse"), "ville": F("Toulouse", "texte", "31000 Toulouse"),
    "surface_m2": F("112", "surface", "112 m² (82 m² boutique + 30 m² réserve)", "m2"),
    "locataire": F("BOULANGERIES GARONNE", "texte", "Boulangeries Garonne (SAS, 14 points de vente)"),
    "date_effet_bail": ABSENT("Absente en clair : seule la date de signature du bail (14/05/2018) figure en annexe"),
    "date_fin_bail": F("2030-05-31", "date", "31 mai 2030 (après avenant de prorogation)"),
    "loyer_annuel_ht_hc": F("47000.00", "montant", "47 000 € HT HC / an depuis le 1er juillet 2026", "EUR"),
    "indice": F("ILC", "enum", "Indexation ILC"),
    "prix": F("760000.00", "montant", "760 000 € net vendeur", "EUR"), "prix_base": F("net_vendeur", "enum", "760 000 € net vendeur"),
    "rendement_annonce_pct": F("6.18", "pourcentage", "6,18 % net vendeur"),
    "taxe_fonciere_refacturee": F(True, "booleen", "Refacturée au preneur"),
    "mandataire": F("Garonne Immobilier d'Entreprise", "texte", "Garonne Immobilier d'Entreprise")})

# ============================== VÉRIFICATION ================================
def norm(s):
    s = s.replace(NBSP, " ").replace(NNBSP, " ").replace("­", "")
    return re.sub(r"\s+", " ", s).strip()


def pages_texte(pdf):
    with pdfplumber.open(pdf) as d:
        return [p.extract_text() or "" for p in d.pages]


def verifie_champ(nom, c, pages, decal=0, erreurs=None, ctx=""):
    if c.get("absent") or c.get("citation") is None:
        return
    q = norm(c["citation"])
    trouve = [i + 1 for i, t in enumerate(pages) if q in norm(t)]
    if not trouve:
        erreurs.append(f"{ctx}.{nom} : citation introuvable « {c['citation']} »")
        return
    c["page"] = c.pop("page_imposee", trouve[0]) + decal
    if len(trouve) > 1:
        c["pages_autres_occurrences"] = [p + decal for p in trouve[1:]]


erreurs = []
for id_, (a, nat, partie) in ATTENDUS.items():
    fmt = a["format"]
    if fmt == "xlsx":
        wb = openpyxl.load_workbook(f"{OUT}/{a['fichier']}")
        def chk(nom, c):
            if c.get("absent"): return
            sh, ref = c["citation"].split("!")
            v = wb[sh][ref].value
            c["cellule"] = c.pop("citation")
            if isinstance(v, str) and v.startswith("="):
                return
            if c["valeur"] is None and v in (None, "VACANT"): return
            if isinstance(v, (int, float)) and c["valeur"] is not None and abs(float(v) - float(c["valeur"])) < 0.005: return
            if hasattr(v, "isoformat") and v.isoformat()[:10] == c["valeur"]: return
            if v == c["valeur"] or (isinstance(v, str) and c["valeur"] is not None and str(c["valeur"]) in v) \
               or (c["type"] == "booleen" and v == "Oui") or (c["type"] == "date" and isinstance(v, str) and date_num(c["valeur"]) in v):
                return
            erreurs.append(f"{id_}.{nom} : cellule {ref} = {v!r} ≠ {c['valeur']!r}")
        for k, c in a.get("champs", {}).items(): chk(k, c)
        for l in a.get("lignes", []):
            for k, c in l.items(): chk(k, c)
        continue
    if fmt == "eml":
        import email
        m = email.message_from_bytes(open(f"{OUT}/{a['fichier']}", "rb").read(), policy=email.policy.default)
        body = norm(m.get_body(preferencelist=("plain",)).get_content())
        for k, c in a["champs"].items():
            if c.get("absent"): continue
            if norm(c["citation"]) not in body:
                erreurs.append(f"{id_}.{k} : citation absente du corps du mail")
            c["partie"] = "text/plain"
        continue
    pages = pages_texte(nat)
    json.dump({"id": id_, "source": "texte extrait du PDF natif avant dégradation", "pages": [{"page": i + 1, "texte": t} for i, t in enumerate(pages)]},
              open(f"{TXT}/{id_}.json", "w"), ensure_ascii=False, indent=1)
    if "segments" in a:
        for s in a["segments"]:
            sous = pages[s["pages"][0] - 1:s["pages"][1]]
            for k, c in s["champs"].items():
                verifie_champ(k, c, sous, s["pages"][0] - 1, erreurs, f"{id_}[{s['doc_type']} p.{s['pages']}]")
    for k, c in a.get("champs", {}).items():
        verifie_champ(k, c, pages, 0, erreurs, id_)
    for i, l in enumerate(a.get("lignes", [])):
        for k, c in l.items():
            verifie_champ(k, c, pages, 0, erreurs, f"{id_}.lignes[{i}]")
    a["nombre_pages"] = len(pages)

for id_, (a, _, _) in ATTENDUS.items():
    json.dump(a, open(f"{ATT}/{id_}.json", "w"), ensure_ascii=False, indent=2)

ANOM = [
    {"id": "ANO-C1", "dossier": "C-Paris", "type": "surface_divergente", "gravite": "moyenne",
     "faits": [{"doc": "B05", "champ": "surface_m2", "valeur": "612"}, {"doc": "E02", "ligne": "Altitude Conseil", "champ": "surface_m2", "valeur": "640"},
               {"doc": "T05", "ligne": "Altitude Conseil", "champ": "surface_m2", "valeur": "640"}],
     "explication": "Le bail indique 612 m² utiles, l'état locatif et le teaser 640 m². Écart de 28 m² (4,6 %)."},
    {"id": "ANO-C2", "dossier": "C-Paris", "type": "loyer_quittance_divergent", "gravite": "haute",
     "faits": [{"doc": "Q03", "champ": "loyer_ht", "valeur": "66200.00", "annualise": "264800.00"},
               {"doc": "E02", "ligne": "Altitude Conseil", "champ": "loyer_annuel_ht_hc", "valeur": "262880.00"}],
     "explication": "Le loyer appelé (66 200 € par trimestre, soit 264 800 €/an) dépasse le loyer de l'état locatif de 1 920 €/an."},
    {"id": "FAUX-D1", "dossier": "D-Nice", "type": "fausse_anomalie_resolue_par_avenant",
     "faits": [{"doc": "B03", "champ": "loyer_annuel_ht_hc", "valeur": "36000.00"}, {"doc": "T02", "champ": "loyer_annuel_ht_hc", "valeur": "41400.00"},
               {"doc": "A02", "champ": "nouveau_loyer_annuel_ht_hc", "valeur": "41400.00"}],
     "explication": "L'écart bail / teaser est expliqué par le renouvellement (A02). Le système ne doit pas lever d'anomalie une fois A02 pris en compte."},
    {"id": "FAUX-F1", "dossier": "F-Toulouse", "type": "fausse_anomalie_resolue_par_avenant",
     "faits": [{"doc": "B04", "segment": 1, "champ": "loyer_annuel_ht_hc", "valeur": "45000.00"},
               {"doc": "B04", "segment": 2, "champ": "nouveau_loyer_annuel_ht_hc", "valeur": "48600.00"},
               {"doc": "A03", "champ": "nouveau_loyer_annuel_ht_hc", "valeur": "47000.00"},
               {"doc": "T06", "champ": "loyer_annuel_ht_hc", "valeur": "47000.00"}],
     "explication": "Chaîne bail + 3 avenants : le loyer en vigueur au 23/10/2026 est 47 000 €, cohérent avec le teaser."},
    {"id": "FAUX-A1", "dossier": "A-Lyon", "type": "fausse_anomalie_resolue_par_avenant",
     "faits": [{"doc": "B01", "champ": "indice", "valeur": "ICC"}, {"doc": "A01", "champ": "nouvel_indice", "valeur": "ILC"},
               {"doc": "T01", "champ": "indice", "valeur": "ILC"}],
     "explication": "Indice du bail (ICC) remplacé par l'ILC à compter du 01/04/2023."},
    {"id": "INFO-B1", "dossier": "B-Marseille", "type": "vacance",
     "faits": [{"doc": "E01", "ligne": "D", "champ": "loyer_annuel_ht_hc", "valeur": "0.00"}, {"doc": "T04", "champ": "taux_occupation_pct", "valeur": "88"}],
     "explication": "Lot D vacant (480 m²). Le potentiel de réversion de 52 800 € du teaser n'est pas un loyer."},
    {"id": "INFO-E1", "dossier": "E-Bordeaux", "type": "prix_remplace_dans_le_fil",
     "faits": [{"doc": "T03", "champ": "prix", "valeur": "980000.00"}],
     "explication": "Le fil de mail contient un ancien prix (1 050 000 €) : seul 980 000 € est le prix demandé."}]
json.dump(ANOM, open(f"{OUT}/anomalies_attendues.json", "w"), ensure_ascii=False, indent=2)
MANIFEST.sort(key=lambda m: m["id"])
json.dump({"version": "1.0", "genere_le": "2026-10-23", "date_de_reference": "2026-10-23",
           "avertissement": "Documents entièrement fictifs. Noms, SIREN (préfixe 999), adresses et indices INSEE sont inventés ou approximatifs : ne pas les utiliser comme référence réelle.",
           "documents": MANIFEST}, open(f"{OUT}/manifest.json", "w"), ensure_ascii=False, indent=2)

print(f"{len(MANIFEST)} documents")
if erreurs:
    print("ERREURS :"); [print(" -", e) for e in erreurs]; sys.exit(1)
print("Toutes les citations retrouvées.")
