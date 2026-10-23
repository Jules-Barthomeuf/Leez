"""Convertit des PDF avec Docling et ecrit, pour chacun, <id>.json (document
Docling) et <id>.timing.json (temps mesure, modeles charges une seule fois).
Usage : python docling_run.py <dossier_sortie> <pdf> [<pdf>...]
Appele par packages/parsing/docling.js avec l'interpreteur DOCLING_PYTHON."""
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

from docling.datamodel.base_models import InputFormat  # noqa: E402
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions  # noqa: E402
from docling.document_converter import DocumentConverter, PdfFormatOption  # noqa: E402


def main():
    sortie = sys.argv[1]
    fichiers = sys.argv[2:]
    os.makedirs(sortie, exist_ok=True)
    options = PdfPipelineOptions(do_ocr=True, do_table_structure=True)
    options.ocr_options = RapidOcrOptions(lang=["fr", "en"])
    options.table_structure_options.do_cell_matching = True
    convertisseur = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    for chemin in fichiers:
        identifiant = os.path.splitext(os.path.basename(chemin))[0]
        debut = time.time()
        erreur = None
        try:
            resultat = convertisseur.convert(chemin)
            document = resultat.document.export_to_dict()
            with open(os.path.join(sortie, identifiant + ".json"), "w", encoding="utf-8") as f:
                json.dump(document, f, ensure_ascii=False)
        except Exception as e:  # noqa: BLE001
            erreur = str(e)
        with open(os.path.join(sortie, identifiant + ".timing.json"), "w", encoding="utf-8") as f:
            json.dump({"ms": int((time.time() - debut) * 1000), "erreur": erreur}, f)
        print(f"{identifiant}: {int((time.time() - debut) * 1000)} ms" + (f" ERREUR {erreur}" if erreur else ""), flush=True)


if __name__ == "__main__":
    main()
