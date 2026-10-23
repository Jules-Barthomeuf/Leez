"""Baux commerciaux et avenants. Chaque fonction écrit un PDF natif et renvoie les champs attendus."""
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors
from common import *

LETTRES = {3: "trois", 6: "six", 9: "neuf", 10: "dix", 12: "douze"}

ENTETES = [
    lambda n, t: f"ARTICLE {n} – {t.upper()}",
    lambda n, t: f"{n}. {t}",
    lambda n, t: f"Article {'premier' if n == 1 else n} : {t}",
]


def bail(path, p):
    """p : dictionnaire des paramètres du bail. Renvoie le dict des champs attendus."""
    v = p.get("variante", 0)
    st = styles_bail(size=p.get("taille", 10.2))
    H = lambda n, t: Paragraph(esc(ENTETES[v](n, t)), st["h"])
    P = lambda s: Paragraph(s, st["p"])
    champs = {}
    fl = []

    fl.append(Paragraph("BAIL COMMERCIAL", st["titre"]))
    fl.append(Paragraph(esc(p.get("soustitre", "Soumis aux articles L. 145-1 et suivants du Code de commerce")), st["soustitre"]))

    fl.append(P("<b>ENTRE LES SOUSSIGNÉS :</b>"))
    fl.append(P(f"La société <b>{esc(p['bailleur'])}</b>, {esc(p['bailleur_desc'])}, "
                f"immatriculée au Registre du Commerce et des Sociétés de {p['bailleur_rcs_ville']} "
                f"sous le numéro {p['bailleur_siren']}, représentée par {esc(p['bailleur_rep'])},"))
    fl.append(P("Ci-après dénommée « le Bailleur »,"))
    fl.append(P("<b>D'UNE PART,</b>"))
    fl.append(P("<b>ET :</b>"))
    fl.append(P(f"La société <b>{esc(p['preneur'])}</b>, {esc(p['preneur_desc'])}, "
                f"immatriculée au Registre du Commerce et des Sociétés de {p['preneur_rcs_ville']} "
                f"sous le numéro {p['preneur_siren']}, représentée par {esc(p['preneur_rep'])},"))
    fl.append(P("Ci-après dénommée « le Preneur »,"))
    fl.append(P("<b>D'AUTRE PART,</b>"))
    fl.append(P("IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :"))
    champs["bailleur"] = F(p["bailleur"], "texte", p["bailleur"])
    champs["preneur"] = F(p["preneur"], "texte", p["preneur"])
    champs["siren_preneur"] = F(p["preneur_siren"].replace(" ", ""), "siren", p["preneur_siren"])

    n = 1
    # Désignation
    fl.append(H(n, "Désignation")); n += 1
    adr = p["adresse"]
    fl.append(P(f"Le Bailleur donne à bail commercial au Preneur, qui accepte, les locaux ci-après désignés "
                f"dépendant d'un immeuble sis {esc(adr)} : {esc(p['designation'])}"))
    surf_cit = f"La surface totale des locaux est de {p['surface_txt']}"
    fl.append(P(esc(surf_cit) + esc(p.get("surface_suite", ", ainsi qu'il résulte du plan demeuré annexé aux présentes.")) +
                " Toute différence entre cette surface et la surface réelle ne pourra justifier ni réduction ni augmentation du loyer."))
    champs["adresse"] = F(adr, "adresse", adr)
    champs["surface_m2"] = F(str(p["surface"]), "surface", surf_cit, "m2")

    # Destination
    fl.append(H(n, "Destination")); n += 1
    dest_cit = f"exclusivement à l'activité de {p['destination']}"
    fl.append(P(f"Les locaux loués sont destinés {esc(dest_cit)}, à l'exclusion de toute autre activité, "
                "le Preneur faisant son affaire personnelle de l'obtention de toutes autorisations administratives nécessaires."))
    champs["destination"] = F(p["destination"], "texte", dest_cit)

    # Durée
    fl.append(H(n, "Durée")); n += 1
    d = p["duree"]
    if v == 1:
        duree_cit = f"pour une durée de {d} ans"
        eff_cit = f"à compter du {date_fr(p['date_effet'])}"
        fl.append(P(f"Le bail est conclu {esc(duree_cit)} {eff_cit}, pour expirer le {date_fr(p['date_fin'], er=False)}."))
    else:
        duree_cit = f"durée de {LETTRES[d]} ({d}) années entières et consécutives"
        eff_cit = f"commenceront à courir le {date_fr(p['date_effet'])}"
        fl.append(P(f"Le présent bail est consenti et accepté pour une {duree_cit} qui {eff_cit} "
                    f"pour se terminer le {date_fr(p['date_fin'], er=False)}."))
    champs["date_prise_effet"] = F(p["date_effet"], "date", eff_cit)
    champs["duree_annees"] = F(str(d), "nombre", duree_cit, "ans")

    tri = p["triennale"]
    if tri == "oui":
        cit = "le Preneur aura la faculté de donner congé à l'expiration de chaque période triennale"
        fl.append(P("Conformément aux dispositions de l'article L. 145-4 du Code de commerce, "
                    f"{cit}, dans les formes et délais prévus à l'article L. 145-9 du même code."))
        champs["duree_ferme_annees"] = F("3", "nombre", cit, "ans")
    elif tri == "premiere":
        cit = "le Preneur renonce expressément à la faculté de donner congé à l'expiration de la première période triennale"
        fl.append(P("Par dérogation à l'article L. 145-4 du Code de commerce, et compte tenu de la nature des locaux, "
                    f"{cit}. Il pourra en revanche donner congé à l'expiration de la deuxième période triennale."))
        champs["duree_ferme_annees"] = F("6", "nombre", cit, "ans")
    else:
        cit = "le Preneur renonce expressément à la faculté de donner congé à l'expiration de chacune des périodes triennales"
        fl.append(P("Le bail portant sur des locaux à usage exclusif de bureaux ou étant conclu pour une durée supérieure à neuf ans, "
                    f"{cit}. Le présent bail est en conséquence ferme pour toute sa durée."
                    if d > 9 else f"{cit}."))
        champs["duree_ferme_annees"] = F(str(d), "nombre", cit, "ans")

    # Loyer
    fl.append(H(n, "Loyer")); n += 1
    loyer_txt = eur(p["loyer"], sep=p.get("sep", " "))
    if v == 1:
        loyer_cit = f"Le loyer annuel est fixé à la somme de {loyer_txt} hors taxes et hors charges"
        fl.append(P(f"{esc(loyer_cit)} ({p['loyer_lettres']}). Il est payable {p['periodicite']} et {p['terme']}, "
                    "par virement sur le compte désigné par le Bailleur."))
    else:
        loyer_cit = f"loyer annuel de {loyer_txt} ({p['loyer_lettres']}) hors taxes et hors charges"
        fl.append(P(f"Le présent bail est consenti et accepté moyennant un {esc(loyer_cit)}, que le Preneur s'oblige "
                    f"à payer {p['periodicite']} et {p['terme']} entre les mains du Bailleur ou de son mandataire."))
    champs["loyer_annuel_ht_hc"] = F(f"{p['loyer']}.00", "montant", loyer_cit, "EUR")
    per_cit = f"{p['periodicite']} et {p['terme']}"
    champs["periodicite_paiement"] = F(p["periodicite_code"], "enum", per_cit)
    champs["terme_paiement"] = F(p["terme_code"], "enum", per_cit)
    if p.get("franchise"):
        fcit = f"franchise de loyer de {p['franchise']} mois"
        fl.append(P(f"Par exception, le Preneur bénéficiera d'une {fcit} à compter de la date de prise d'effet du bail, "
                    "les charges et taxes restant exigibles pendant cette période."))
        champs["franchise_loyer_mois"] = F(str(p["franchise"]), "nombre", fcit, "mois")
    else:
        champs["franchise_loyer_mois"] = ABSENT("Aucune franchise prévue")

    # Indexation
    fl.append(H(n, "Indexation")); n += 1
    noms = {"ILC": "Indice des Loyers Commerciaux (ILC)",
            "ILAT": "Indice des Loyers des Activités Tertiaires (ILAT)",
            "ICC": "Indice du Coût de la Construction (ICC)"}
    ind_cit = noms[p["indice"]]
    base_cit = f"celui du {p['indice_base_trim']}, soit {p['indice_base_val']}"
    fl.append(P("Le loyer sera indexé automatiquement chaque année, à la date anniversaire de la prise d'effet du bail, "
                f"en fonction de la variation de l'{ind_cit} publié trimestriellement par l'INSEE. "
                f"L'indice de base retenu est {base_cit}. L'indice de comparaison sera le dernier indice publié "
                "à la date de chaque indexation."))
    champs["indice"] = F(p["indice"], "enum", ind_cit)
    champs["indice_base"] = F(f"{p['indice_base_code']}={p['indice_base_val'].replace(',', '.')}", "indice_base", base_cit)

    # Garantie
    fl.append(H(n, "Dépôt de garantie" if p.get("depot") else "Garantie")); n += 1
    if p.get("depot"):
        dcit = f"dépôt de garantie de {eur(p['depot'], sep=p.get('sep', ' '))}"
        fl.append(P(f"Le Preneur verse ce jour au Bailleur, qui le reconnaît, un {dcit}, représentant "
                    f"{p['depot_mois']} mois de loyer hors taxes. Cette somme, non productive d'intérêts, sera restituée "
                    "au Preneur en fin de jouissance, déduction faite des sommes dont il pourrait être débiteur."))
        champs["depot_garantie"] = F(f"{p['depot']}.00", "montant", dcit, "EUR")
    else:
        fl.append(P(esc(p["garantie_txt"])))
        champs["depot_garantie"] = ABSENT("Pas de dépôt de garantie : garantie autonome à première demande à la place")
        champs["garantie_autre"] = F(p["garantie_val"], "texte", p["garantie_cit"])

    # Charges et impôts
    fl.append(H(n, "Charges, impôts et taxes")); n += 1
    fl.append(P("Le Preneur acquittera ses contributions personnelles, et notamment la cotisation foncière des entreprises, "
                "de manière que le Bailleur ne puisse en aucun cas être inquiété à ce sujet."))
    if p["tf"]:
        cit = "Le Preneur remboursera au Bailleur, en sus du loyer, la taxe foncière"
        fl.append(P(f"{cit} afférente aux locaux loués ainsi que la taxe d'enlèvement des ordures ménagères, "
                    "sur présentation de l'avis d'imposition."))
    else:
        cit = "La taxe foncière demeure à la charge exclusive du Bailleur"
        fl.append(P(f"{cit}, qui ne pourra en demander le remboursement au Preneur."))
    champs["taxe_fonciere_refacturee"] = F(p["tf"], "booleen", cit)

    # TVA
    fl.append(H(n, "Taxe sur la valeur ajoutée")); n += 1
    if p["tva"]:
        cit = "le Preneur acquittera la TVA au taux en vigueur en sus du loyer"
        fl.append(P(f"Le Bailleur ayant opté pour l'assujettissement des loyers à la taxe sur la valeur ajoutée, {cit} et des charges."))
    else:
        cit = "Les loyers ne sont pas soumis à la taxe sur la valeur ajoutée"
        fl.append(P(f"{cit}, le Bailleur n'ayant pas exercé l'option prévue à l'article 260-2° du Code général des impôts."))
    champs["option_tva"] = F(p["tva"], "booleen", cit)

    # Clauses usuelles
    fl.append(H(n, "Entretien et réparations")); n += 1
    fl.append(P("Le Preneur entretiendra les lieux loués en bon état de réparations locatives et d'entretien pendant toute la durée du bail. "
                "Les grosses réparations telles que définies à l'article 606 du Code civil demeurent à la charge du Bailleur, "
                "conformément à l'article R. 145-35 du Code de commerce."))
    fl.append(H(n, "Cession et sous-location")); n += 1
    fl.append(P("Le Preneur ne pourra céder son droit au présent bail qu'à l'acquéreur de son fonds de commerce, sous réserve d'en "
                "informer le Bailleur par acte extrajudiciaire. Toute sous-location, totale ou partielle, est interdite sans "
                "l'accord préalable et écrit du Bailleur."))
    fl.append(H(n, "Clause résolutoire")); n += 1
    fl.append(P("À défaut de paiement à son échéance d'un seul terme de loyer ou de ses accessoires, ou d'exécution d'une seule des "
                "conditions du présent bail, et un mois après un commandement de payer ou une sommation d'exécuter resté infructueux, "
                "le présent bail sera résilié de plein droit si bon semble au Bailleur."))
    fl.append(H(n, "État des risques et diagnostics")); n += 1
    fl.append(P("Sont annexés aux présentes l'état des risques et pollutions, le diagnostic de performance énergétique et, le cas échéant, "
                "l'annexe environnementale prévue à l'article L. 125-9 du Code de l'environnement."))
    fl.append(H(n, "Élection de domicile")); n += 1
    fl.append(P("Pour l'exécution des présentes, le Bailleur fait élection de domicile en son siège social et le Preneur dans les lieux loués."))
    fl.append(Spacer(1, 10))
    fl.append(P(f"Fait à {p['ville_signature']}, le {date_fr(p['date_signature'])}, en deux exemplaires originaux."))
    fl.append(Spacer(1, 8))
    t = Table([["Le Bailleur", "Le Preneur"], [esc(p["bailleur_rep_court"]), esc(p["preneur_rep_court"])]],
              colWidths=[80 * mm, 80 * mm], rowHeights=[16, 40])
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Serif", 9.5), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    fl.append(t)
    champs["date_signature"] = F(p["date_signature"], "date", f"le {date_fr(p['date_signature'])}, en deux exemplaires")

    build_pdf(path, fl, footer=p.get("footer", "Bail commercial – Paraphes : ______ / ______ – page {page}"))
    return champs


def avenant(path, p):
    st = styles_bail(size=10.2)
    P = lambda s: Paragraph(s, st["p"])
    fl, champs = [], {}
    num_txt = "N° 1" if p["numero"] == 1 else f"N° {p['numero']}"
    fl.append(Paragraph(f"AVENANT {num_txt} AU BAIL COMMERCIAL", st["titre"]))
    orig_cit = f"bail commercial en date du {date_fr(p['bail_date'])}"
    fl.append(Paragraph(f"portant sur des locaux sis {esc(p['adresse'])}", st["soustitre"]))
    champs["numero_avenant"] = F(str(p["numero"]), "nombre", f"AVENANT {num_txt}")
    fl.append(P("<b>ENTRE :</b>"))
    fl.append(P(f"La société <b>{esc(p['bailleur'])}</b>, {esc(p['bailleur_desc'])}, ci-après « le Bailleur »,"))
    fl.append(P("<b>ET :</b>"))
    fl.append(P(f"La société <b>{esc(p['preneur'])}</b>, {esc(p['preneur_desc'])}, ci-après « le Preneur »,"))
    champs["bailleur"] = F(p["bailleur"], "texte", p["bailleur"])
    champs["preneur"] = F(p["preneur"], "texte", p["preneur"])
    fl.append(Paragraph("<b>EXPOSÉ PRÉALABLE</b>", st["h"]))
    fl.append(P(f"Aux termes d'un {orig_cit}, le Bailleur a donné à bail au Preneur les locaux susvisés. "
                + esc(p["expose"])))
    champs["bail_date_origine"] = F(p["bail_date"], "date", orig_cit)
    fl.append(P("CECI EXPOSÉ, IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :"))
    for i, (titre, texte) in enumerate(p["articles"], 1):
        fl.append(Paragraph(f"Article {i} – {esc(titre)}", st["h"]))
        fl.append(P(esc(texte)))
    fl.append(Paragraph(f"Article {len(p['articles']) + 1} – Autres clauses", st["h"]))
    fl.append(P("Toutes les autres clauses et conditions du bail non modifiées par le présent avenant demeurent inchangées "
                "et continuent de recevoir pleine application."))
    fl.append(Spacer(1, 10))
    sig_cit = f"le {date_fr(p['date'])}"
    fl.append(P(f"Fait à {p['ville']}, {sig_cit}, en deux exemplaires originaux."))
    fl.append(Spacer(1, 8))
    t = Table([["Le Bailleur", "Le Preneur"]], colWidths=[80 * mm, 80 * mm], rowHeights=[50])
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Serif", 9.5), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    fl.append(t)
    champs["date_avenant"] = F(p["date"], "date", f"Fait à {p['ville']}, {sig_cit}")
    champs.update(p["champs"])
    build_pdf(path, fl, footer="Avenant " + num_txt + " – page {page}")
    return champs
