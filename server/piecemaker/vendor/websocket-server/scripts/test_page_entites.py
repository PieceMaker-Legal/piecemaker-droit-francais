import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import convert_and_scan_pipeline as pipeline
from scan_utils import (
    build_pattern_recognizers,
    resolve_overlapping_spans,
    run_pattern_recognizers,
)

PAGE = Path(__file__).resolve().parent / "fixtures" / "page_entites.md"

MENTIONS = [
    "Calice",
    "Calice SA",
    "Calice International",
    "Hortensia SA",
    "Hortensia International Ltd",
    "Lilas SARL",
    "Brumaire SAS",
    "Nimbus",
    "Vieux Comptoir",
    "Exemple GmbH",
    "Aster Aktiengesellschaft",
    "Pivoine Limited Liability Company",
    "Pivoine LLC",
    "Muguet",
    "Muguet PLC",
    "Rose",
    "Rose SE",
    "Jasmin",
    "Dahlia GmbH & Co. KG",
    "Pensée BV",
    "Iris SNC",
    "Capucine",
    "Laurier",
    "Fuchsia Incorporated",
    "Oliva OHG",
    "Comptoir des Vignes",
    "SELARL du Parc",
    "Nénuphar Corporation",
]

EXPECTED_PATTERNS = {
    "NIR": {"1 84 03 99 990 042 36"},
    "TELEPHONE": {"+33 1 42 86 10 24", "06 12 34 56 78"},
    "EMAIL_ADDRESS": {"jean.dupont@calice-exemple.fr", "contact@parc-exemple.fr"},
    "CREDIT_CARD": {"4111 1111 1111 1111"},
    "IBAN_CODE": {"FR03 3000 6000 1112 3456 7890 189"},
    "IP_ADDRESS": {"203.0.113.44"},
    "MAC_ADDRESS": {"02:11:22:33:44:55"},
    "SIREN": {"847 221 306"},
    "SIRET": {"847 221 306 00016"},
    "TVA": {"FR 90 847 221 306"},
    "URL": {"https://calice-exemple.fr/dossier"},
    "IMMATRICULATION": {"AB-123-CD"},
}

EXPECTED_COMPANIES = {
    "SA_01": ("SA", {"Calice", "Calice SA", "Calice International"}),
    "SA_02": ("SA", {"Hortensia SA"}),
    "LTD_01": ("LTD", {"Hortensia International Ltd"}),
    "SARL_01": ("SARL", {"Lilas SARL"}),
    "SAS_01": ("SAS", {"Brumaire SAS"}),
    "SASU_01": ("SASU", {"Nimbus"}),
    "SCI_01": ("SCI", {"Vieux Comptoir"}),
    "GMBH_01": ("GMBH", {"Exemple GmbH"}),
    "AG_01": ("AG", {"Aster Aktiengesellschaft"}),
    "LLC_01": ("LLC", {"Pivoine Limited Liability Company", "Pivoine LLC"}),
    "PLC_01": ("PLC", {"Muguet", "Muguet PLC"}),
    "SE_01": ("SE", {"Rose", "Rose SE"}),
    "EURL_01": ("EURL", {"Jasmin"}),
    "GMBHCOKG_01": ("GMBHCOKG", {"Dahlia GmbH & Co. KG"}),
    "BV_01": ("BV", {"Pensée BV"}),
    "SNC_01": ("SNC", {"Iris SNC"}),
    "EARL_01": ("EARL", {"Capucine"}),
    "GIE_01": ("GIE", {"Laurier"}),
    "INC_01": ("INC", {"Fuchsia Incorporated"}),
    "OHG_01": ("OHG", {"Oliva OHG"}),
    "PERS_MORALE_01": (None, {"Comptoir des Vignes"}),
    "SELARL_01": ("SELARL", {"SELARL du Parc"}),
    "CORP_01": ("CORP", {"Nénuphar Corporation"}),
}

SCANNED_CODES = {
    "Jean Dupont": "PERSONNE_PHYSIQUE_01",
    "Camille Lefèvre": "PERSONNE_PHYSIQUE_02",
    "Marie Martin": "PERSONNE_PHYSIQUE_03",
    "Paul Durand": "PERSONNE_PHYSIQUE_04",
    "12 rue des Lilas": "ADRESSE_01",
    "8 place du Marché": "ADRESSE_02",
    "4 avenue des Tilleuls": "ADRESSE_03",
    "Calice": "SA_01",
    "Hortensia SA": "SA_02",
    "Hortensia International Ltd": "LTD_01",
    "Lilas SARL": "SARL_01",
    "Brumaire SAS": "SAS_01",
    "Nimbus": "SASU_01",
    "Vieux Comptoir": "SCI_01",
    "Exemple GmbH": "GMBH_01",
    "Aster Aktiengesellschaft": "AG_01",
    "Pivoine Limited Liability Company": "LLC_01",
    "Pivoine LLC": "LLC_01",
    "Muguet": "PLC_01",
    "Rose": "SE_01",
    "Rose SE": "SE_01",
    "Jasmin": "EURL_01",
    "Dahlia GmbH & Co. KG": "GMBHCOKG_01",
    "Pensée BV": "BV_01",
    "Iris SNC": "SNC_01",
    "Capucine": "EARL_01",
    "Laurier": "GIE_01",
    "Fuchsia Incorporated": "INC_01",
    "Oliva OHG": "OHG_01",
    "SELARL du Parc": "SELARL_01",
    "Nénuphar Corporation": "CORP_01",
}


def _pattern_hits(text):
    results = resolve_overlapping_spans(
        run_pattern_recognizers(text, build_pattern_recognizers())
    )
    found = {}
    for result in results:
        found.setdefault(result.entity_type, set()).add(text[result.start:result.end])
    return found


def _company_result(text):
    occurrences = []
    for fragment in MENTIONS:
        start = text.index(fragment)
        occurrences.append({
            "text": fragment,
            "start": start,
            "end": start + len(fragment),
            "source_file": str(PAGE),
            "score": 0.9,
        })
    return pipeline.convert_to_anonymization_format({"entities": {"ORGANIZATION": occurrences}})


class PageEntitesTests(unittest.TestCase):
    def setUp(self):
        self.text = PAGE.read_text(encoding="utf-8")

    def test_page_stays_one_page(self):
        self.assertGreaterEqual(len(self.text.split()), 300)
        self.assertLessEqual(len(self.text.split()), 500)
        self.assertIn("né le 14 mars 1984", self.text)

    def test_pattern_identifiers_are_detected(self):
        self.assertEqual(_pattern_hits(self.text), EXPECTED_PATTERNS)

    def test_company_mentions_keep_their_legal_form(self):
        result = _company_result(self.text)
        societes = result["extracted_data"]["societes"]
        self.assertEqual(set(societes), set(EXPECTED_COMPANIES))
        for code, (form, variants) in EXPECTED_COMPANIES.items():
            self.assertEqual(set(societes[code]["variants"]), variants, code)
            if form is None:
                self.assertNotIn("legalForm", societes[code])
            else:
                self.assertEqual(societes[code]["legalForm"], form, code)
        self.assertEqual(result["mapping"]["Calice International"], "SA_01")
        self.assertEqual(result["mapping"]["Hortensia SA"], "SA_02")
        self.assertEqual(result["mapping"]["Hortensia International Ltd"], "LTD_01")
        self.assertEqual(result["mapping"]["Comptoir des Vignes"], "PERS_MORALE_01")
        self.assertNotIn("NAISSANCE", result["extracted_data"])
        self.assertNotIn("14 mars 1984", result["mapping"])

    def test_scanner_on_the_page(self):
        gliner_dir = Path(__file__).resolve().parent / "presidio-gliner"
        sys.path.insert(0, str(gliner_dir))
        os.environ["HF_HUB_OFFLINE"] = "1"
        from huggingface_hub import try_to_load_from_cache
        from model_config import PREFERRED_GLINER_MODEL

        weights = try_to_load_from_cache(repo_id=PREFERRED_GLINER_MODEL, filename="model.safetensors")
        if not isinstance(weights, str) or not os.path.isfile(weights):
            self.skipTest("modèle GLiNER2-PII absent du cache")
        import scanner_worker
        from gliner2 import GLiNER2
        from scanner_worker import scan_file

        if scanner_worker._gliner_model is None:
            scanner_worker._gliner_model = GLiNER2.from_pretrained(
                str(Path(weights).parent),
                local_files_only=True,
                map_location="cpu",
            )

        with tempfile.TemporaryDirectory() as directory:
            output = scan_file(str(PAGE), directory)
            payload = json.loads(Path(output).read_text(encoding="utf-8"))

        self.assertNotIn("NAISSANCE", payload["entities"])
        self.assertNotIn("date of birth", json.dumps(payload))
        self.assertEqual(
            [item["text"] for item in payload["entities"].get("DATE_OF_BIRTH", [])],
            ["14 mars 1984"],
        )
        self.assertEqual(
            [item["text"] for item in payload["entities"].get("EXPIRATION_DATE", [])],
            ["12 janvier 2026"],
        )
        self.assertEqual(
            [item["text"] for item in payload["entities"].get("TRANSACTION_DATE", [])],
            ["2 novembre 2025"],
        )
        found = {
            entity_type: {item["text"] for item in items}
            for entity_type, items in payload["entities"].items()
        }
        for entity_type, texts in EXPECTED_PATTERNS.items():
            self.assertTrue(texts <= found.get(entity_type, set()), (entity_type, found.get(entity_type)))

        entities = {"entities": payload["entities"]}
        for items in entities["entities"].values():
            for item in items:
                item["source_file"] = payload["source_file"]
        coded = pipeline.convert_to_anonymization_format(entities)
        self.assertNotIn("NAISSANCE", coded["extracted_data"])
        self.assertEqual(coded["mapping"].get("14 mars 1984"), "DATE_OF_BIRTH_01")
        self.assertEqual(coded["mapping"].get("12 janvier 2026"), "EXPIRATION_DATE_15")
        self.assertEqual(coded["mapping"].get("2 novembre 2025"), "TRANSACTION_DATE_16")
        for text, code in SCANNED_CODES.items():
            self.assertEqual(coded["mapping"].get(text), code, text)
        societes = coded["extracted_data"]["societes"]
        self.assertEqual(societes["SA_01"]["legalForm"], "SA")
        self.assertEqual(societes["SA_02"]["legalForm"], "SA")
        self.assertEqual(societes["LTD_01"]["legalForm"], "LTD")
        self.assertNotEqual(coded["mapping"]["Hortensia SA"], coded["mapping"]["Hortensia International Ltd"])
        morale = coded["mapping"]["Comptoir des Vignes"]
        self.assertTrue(morale.startswith("PERS_MORALE_"), morale)
        self.assertNotIn("legalForm", societes[morale])
        court = coded["mapping"]["Tribunal de commerce de Paris"]
        self.assertTrue(court.startswith("PERS_MORALE_"), court)
        self.assertNotEqual(court, morale)
        bare = coded["mapping"].get("unipersonnelle")
        if bare is not None:
            self.assertTrue(bare.startswith("PERS_MORALE_"), bare)
            self.assertNotIn("legalForm", societes[bare])


if __name__ == "__main__":
    unittest.main()
