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
    "SA_01": ("SA", {"Calice", "Calice SA"}),
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
    "PERS_MORALE_01": (None, {"Calice International"}),
    "PERS_MORALE_02": (None, {"Comptoir des Vignes"}),
    "SELARL_01": ("SELARL", {"SELARL du Parc"}),
    "CORP_01": ("CORP", {"Nénuphar Corporation"}),
}

SPAN_TEXTS = {
    "VILLE": ["Paris", "Lyon", "Paris", "Bordeaux", "Bordeaux", "Lyon", "Lyon"],
    "DATE": ["3 mars 2026", "12 janvier 2026"],
    "PERSON": [
        "Jean Dupont", "Camille Lefèvre", "Marie Martin", "Paul Durand", "Jean Dupont",
        "Marie Martin",
    ],
    "DATE_OF_BIRTH": ["14 mars 1984"],
    "LOCATION": ["12 rue des Lilas", "8 place du Marché", "4 avenue des Tilleuls"],
    "CODE_POSTAL": ["75011", "33000", "69002"],
    "NIR": ["1 84 03 99 990 042 36"],
    "TELEPHONE": ["+33 1 42 86 10 24", "06 12 34 56 78"],
    "EMAIL_ADDRESS": ["jean.dupont@calice-exemple.fr", "contact@parc-exemple.fr"],
    "CREDIT_CARD": ["4111 1111 1111 1111"],
    "IBAN_CODE": ["FR03 3000 6000 1112 3456 7890 189"],
    "IP_ADDRESS": ["203.0.113.44"],
    "MAC_ADDRESS": ["02:11:22:33:44:55"],
    "MOT_DE_PASSE": ["Lilas-2026!"],
    "ORGANIZATION": [
        "Calice", "Calice", "Calice", "Hortensia SA", "Hortensia International Ltd",
        "Lilas SARL", "Brumaire SAS", "Nimbus", "unipersonnelle", "Vieux Comptoir",
        "Exemple GmbH", "Aster Aktiengesellschaft",
        "Pivoine Limited Liability Company", "Pivoine LLC", "Muguet", "Muguet PLC",
        "Rose", "Rose SE", "unipersonnelle", "Jasmin", "Dahlia GmbH & Co. KG",
        "Pensée BV", "Iris SNC", "Capucine", "Laurier", "Fuchsia Incorporated",
        "Oliva OHG", "Comptoir des Vignes", "SELARL du Parc", "Nénuphar Corporation",
    ],
    "SIREN": ["847 221 306"],
    "SIRET": ["847 221 306 00016"],
    "TVA": ["FR 90 847 221 306"],
    "URL": ["https://calice-exemple.fr/dossier"],
    "IMMATRICULATION": ["AB-123-CD"],
    "TRANSACTION_DATE": ["2 novembre 2025"],
}

SPAN_RECOGNIZER = {
    "VILLE": "GLiNER2Recognizer",
    "DATE": "GLiNER2Recognizer",
    "PERSON": "GLiNER2Recognizer",
    "DATE_OF_BIRTH": "GLiNER2Recognizer",
    "LOCATION": "GLiNER2Recognizer",
    "CODE_POSTAL": "GLiNER2Recognizer",
    "NIR": "FrNirRecognizer",
    "TELEPHONE": "FrPhoneRecognizer",
    "EMAIL_ADDRESS": "EmailRecognizer",
    "CREDIT_CARD": "CreditCardRecognizer",
    "IBAN_CODE": "IbanRecognizer",
    "IP_ADDRESS": "GLiNER2Recognizer",
    "MAC_ADDRESS": "MacAddressRecognizer",
    "MOT_DE_PASSE": "GLiNER2Recognizer",
    "ORGANIZATION": "GLiNER2Recognizer",
    "SIREN": "FrSirenRecognizer",
    "SIRET": "FrSiretRecognizer",
    "TVA": "FrVatRecognizer",
    "URL": "UrlRecognizer",
    "IMMATRICULATION": "FrPlateRecognizer",
    "TRANSACTION_DATE": "GLiNER2Recognizer",
}

EXPECTED_MAPPING = {
    "Paris": "VILLE_01",
    "Lyon": "VILLE_02",
    "Bordeaux": "VILLE_03",
    "3 mars 2026": "DATE_04",
    "12 janvier 2026": "DATE_05",
    "Jean Dupont": "PERSONNE_PHYSIQUE_01",
    "Camille Lefèvre": "PERSONNE_PHYSIQUE_02",
    "Marie Martin": "PERSONNE_PHYSIQUE_03",
    "Paul Durand": "PERSONNE_PHYSIQUE_04",
    "14 mars 1984": "DATE_NAISSANCE_06",
    "12 rue des Lilas": "ADRESSE_01",
    "8 place du Marché": "ADRESSE_02",
    "4 avenue des Tilleuls": "ADRESSE_03",
    "75011": "CODE_POSTAL_07",
    "33000": "CODE_POSTAL_08",
    "69002": "CODE_POSTAL_09",
    "1 84 03 99 990 042 36": "NIR_10",
    "+33 1 42 86 10 24": "TELEPHONE_11",
    "06 12 34 56 78": "TELEPHONE_12",
    "jean.dupont@calice-exemple.fr": "COURRIEL_13",
    "contact@parc-exemple.fr": "COURRIEL_14",
    "4111 1111 1111 1111": "CARTE_15",
    "FR03 3000 6000 1112 3456 7890 189": "IBAN_16",
    "203.0.113.44": "ADRESSE_IP_17",
    "02:11:22:33:44:55": "ADRESSE_MAC_18",
    "Lilas-2026!": "MOT_DE_PASSE_19",
    "847 221 306": "SIREN_01",
    "847 221 306 00016": "SIRET_20",
    "FR 90 847 221 306": "TVA_21",
    "https://calice-exemple.fr/dossier": "LIEN_22",
    "AB-123-CD": "IMMATRICULATION_23",
    "2 novembre 2025": "DATE_OPERATION_24",
    "Calice": "SA_01",
    "Hortensia SA": "SA_02",
    "Hortensia International Ltd": "LTD_01",
    "Lilas SARL": "SARL_01",
    "Brumaire SAS": "SAS_01",
    "Nimbus": "SASU_01",
    "unipersonnelle": "PERS_MORALE_01",
    "Comptoir des Vignes": "PERS_MORALE_02",
    "Vieux Comptoir": "SCI_01",
    "Exemple GmbH": "GMBH_01",
    "Aster Aktiengesellschaft": "AG_01",
    "Pivoine Limited Liability Company": "LLC_01",
    "Pivoine LLC": "LLC_01",
    "Muguet": "PLC_01",
    "Muguet PLC": "PLC_01",
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

EXPECTED_STORED = {
    "personnes_physiques": {
        "PERSONNE_PHYSIQUE_01": {"original": "Jean Dupont", "variants": ["Jean Dupont"], "recognizer": "GLiNER2Recognizer"},
        "PERSONNE_PHYSIQUE_02": {"original": "Camille Lefèvre", "variants": ["Camille Lefèvre"], "recognizer": "GLiNER2Recognizer"},
        "PERSONNE_PHYSIQUE_03": {"original": "Marie Martin", "variants": ["Marie Martin"], "recognizer": "GLiNER2Recognizer"},
        "PERSONNE_PHYSIQUE_04": {"original": "Paul Durand", "variants": ["Paul Durand"], "recognizer": "GLiNER2Recognizer"},
    },
    "societes": {
        "SA_01": {"original": "Calice", "variants": ["Calice"], "legalForm": "SA", "recognizer": "GLiNER2Recognizer"},
        "SA_02": {"original": "Hortensia SA", "variants": ["Hortensia SA"], "legalForm": "SA", "recognizer": "GLiNER2Recognizer"},
        "LTD_01": {"original": "Hortensia International Ltd", "variants": ["Hortensia International Ltd"], "legalForm": "LTD", "recognizer": "GLiNER2Recognizer"},
        "SARL_01": {"original": "Lilas SARL", "variants": ["Lilas SARL"], "legalForm": "SARL", "recognizer": "GLiNER2Recognizer"},
        "SAS_01": {"original": "Brumaire SAS", "variants": ["Brumaire SAS"], "legalForm": "SAS", "recognizer": "GLiNER2Recognizer"},
        "SASU_01": {"original": "Nimbus", "variants": ["Nimbus"], "legalForm": "SASU", "recognizer": "GLiNER2Recognizer"},
        "PERS_MORALE_01": {"original": "unipersonnelle", "variants": ["unipersonnelle"], "recognizer": "GLiNER2Recognizer"},
        "PERS_MORALE_02": {"original": "Comptoir des Vignes", "variants": ["Comptoir des Vignes"], "recognizer": "GLiNER2Recognizer"},
        "SCI_01": {"original": "Vieux Comptoir", "variants": ["Vieux Comptoir"], "legalForm": "SCI", "recognizer": "GLiNER2Recognizer"},
        "GMBH_01": {"original": "Exemple GmbH", "variants": ["Exemple GmbH"], "legalForm": "GMBH", "recognizer": "GLiNER2Recognizer"},
        "AG_01": {"original": "Aster Aktiengesellschaft", "variants": ["Aster Aktiengesellschaft"], "legalForm": "AG", "recognizer": "GLiNER2Recognizer"},
        "LLC_01": {"original": "Pivoine Limited Liability Company", "variants": ["Pivoine Limited Liability Company", "Pivoine LLC"], "legalForm": "LLC", "recognizer": "GLiNER2Recognizer"},
        "PLC_01": {"original": "Muguet PLC", "variants": ["Muguet", "Muguet PLC"], "legalForm": "PLC", "recognizer": "GLiNER2Recognizer"},
        "SE_01": {"original": "Rose SE", "variants": ["Rose", "Rose SE"], "legalForm": "SE", "recognizer": "GLiNER2Recognizer"},
        "EURL_01": {"original": "Jasmin", "variants": ["Jasmin"], "legalForm": "EURL", "recognizer": "GLiNER2Recognizer"},
        "GMBHCOKG_01": {"original": "Dahlia GmbH & Co. KG", "variants": ["Dahlia GmbH & Co. KG"], "legalForm": "GMBHCOKG", "recognizer": "GLiNER2Recognizer"},
        "BV_01": {"original": "Pensée BV", "variants": ["Pensée BV"], "legalForm": "BV", "recognizer": "GLiNER2Recognizer"},
        "SNC_01": {"original": "Iris SNC", "variants": ["Iris SNC"], "legalForm": "SNC", "recognizer": "GLiNER2Recognizer"},
        "EARL_01": {"original": "Capucine", "variants": ["Capucine"], "legalForm": "EARL", "recognizer": "GLiNER2Recognizer"},
        "GIE_01": {"original": "Laurier", "variants": ["Laurier"], "legalForm": "GIE", "recognizer": "GLiNER2Recognizer"},
        "INC_01": {"original": "Fuchsia Incorporated", "variants": ["Fuchsia Incorporated"], "legalForm": "INC", "recognizer": "GLiNER2Recognizer"},
        "OHG_01": {"original": "Oliva OHG", "variants": ["Oliva OHG"], "legalForm": "OHG", "recognizer": "GLiNER2Recognizer"},
        "SELARL_01": {"original": "SELARL du Parc", "variants": ["SELARL du Parc"], "legalForm": "SELARL", "recognizer": "GLiNER2Recognizer"},
        "CORP_01": {"original": "Nénuphar Corporation", "variants": ["Nénuphar Corporation"], "legalForm": "CORP", "recognizer": "GLiNER2Recognizer"},
    },
    "adresses": {
        "ADRESSE_01": {"original": "12 rue des Lilas", "variants": ["12 rue des Lilas"], "recognizer": "GLiNER2Recognizer"},
        "ADRESSE_02": {"original": "8 place du Marché", "variants": ["8 place du Marché"], "recognizer": "GLiNER2Recognizer"},
        "ADRESSE_03": {"original": "4 avenue des Tilleuls", "variants": ["4 avenue des Tilleuls"], "recognizer": "GLiNER2Recognizer"},
    },
    "siren": {
        "SIREN_01": {"original": "847 221 306", "variants": ["847 221 306"], "recognizer": "FrSirenRecognizer"},
    },
    "autres": {
        "VILLE_01": {"original": "Paris", "variants": ["Paris"], "recognizer": "GLiNER2Recognizer"},
        "VILLE_02": {"original": "Lyon", "variants": ["Lyon"], "recognizer": "GLiNER2Recognizer"},
        "VILLE_03": {"original": "Bordeaux", "variants": ["Bordeaux"], "recognizer": "GLiNER2Recognizer"},
        "DATE_04": {"original": "3 mars 2026", "variants": ["3 mars 2026"], "recognizer": "GLiNER2Recognizer"},
        "DATE_05": {"original": "12 janvier 2026", "variants": ["12 janvier 2026"], "recognizer": "GLiNER2Recognizer"},
        "DATE_NAISSANCE_06": {"original": "14 mars 1984", "variants": ["14 mars 1984"], "recognizer": "GLiNER2Recognizer"},
        "CODE_POSTAL_07": {"original": "75011", "variants": ["75011"], "recognizer": "GLiNER2Recognizer"},
        "CODE_POSTAL_08": {"original": "33000", "variants": ["33000"], "recognizer": "GLiNER2Recognizer"},
        "CODE_POSTAL_09": {"original": "69002", "variants": ["69002"], "recognizer": "GLiNER2Recognizer"},
        "NIR_10": {"original": "1 84 03 99 990 042 36", "variants": ["1 84 03 99 990 042 36"], "recognizer": "FrNirRecognizer"},
        "TELEPHONE_11": {"original": "+33 1 42 86 10 24", "variants": ["+33 1 42 86 10 24"], "recognizer": "FrPhoneRecognizer"},
        "TELEPHONE_12": {"original": "06 12 34 56 78", "variants": ["06 12 34 56 78"], "recognizer": "FrPhoneRecognizer"},
        "COURRIEL_13": {"original": "jean.dupont@calice-exemple.fr", "variants": ["jean.dupont@calice-exemple.fr"], "recognizer": "EmailRecognizer"},
        "COURRIEL_14": {"original": "contact@parc-exemple.fr", "variants": ["contact@parc-exemple.fr"], "recognizer": "EmailRecognizer"},
        "CARTE_15": {"original": "4111 1111 1111 1111", "variants": ["4111 1111 1111 1111"], "recognizer": "CreditCardRecognizer"},
        "IBAN_16": {"original": "FR03 3000 6000 1112 3456 7890 189", "variants": ["FR03 3000 6000 1112 3456 7890 189"], "recognizer": "IbanRecognizer"},
        "ADRESSE_IP_17": {"original": "203.0.113.44", "variants": ["203.0.113.44"], "recognizer": "GLiNER2Recognizer"},
        "ADRESSE_MAC_18": {"original": "02:11:22:33:44:55", "variants": ["02:11:22:33:44:55"], "recognizer": "MacAddressRecognizer"},
        "MOT_DE_PASSE_19": {"original": "Lilas-2026!", "variants": ["Lilas-2026!"], "recognizer": "GLiNER2Recognizer"},
        "SIRET_20": {"original": "847 221 306 00016", "variants": ["847 221 306 00016"], "recognizer": "FrSiretRecognizer"},
        "TVA_21": {"original": "FR 90 847 221 306", "variants": ["FR 90 847 221 306"], "recognizer": "FrVatRecognizer"},
        "LIEN_22": {"original": "https://calice-exemple.fr/dossier", "variants": ["https://calice-exemple.fr/dossier"], "recognizer": "UrlRecognizer"},
        "IMMATRICULATION_23": {"original": "AB-123-CD", "variants": ["AB-123-CD"], "recognizer": "FrPlateRecognizer"},
        "DATE_OPERATION_24": {"original": "2 novembre 2025", "variants": ["2 novembre 2025"], "recognizer": "GLiNER2Recognizer"},
    },
}


def _pattern_hits(text):
    results = resolve_overlapping_spans(
        run_pattern_recognizers(text, build_pattern_recognizers())
    )
    found = {}
    for result in results:
        found.setdefault(result.entity_type, set()).add(text[result.start:result.end])
    return found


def _stored(extracted):
    stored = {}
    for bucket, entries in extracted.items():
        stored[bucket] = {}
        for code, entry in entries.items():
            item = {
                "original": entry.get("original"),
                "variants": entry.get("variants"),
                "recognizer": entry.get("recognizer"),
            }
            if "legalForm" in entry:
                item["legalForm"] = entry["legalForm"]
            stored[bucket][code] = item
    return stored


def _scan_before_database():
    gliner_dir = Path(__file__).resolve().parent / "presidio-gliner"
    sys.path.insert(0, str(gliner_dir))
    os.environ["HF_HUB_OFFLINE"] = "1"
    from huggingface_hub import try_to_load_from_cache
    from model_config import PREFERRED_GLINER_MODEL

    weights = try_to_load_from_cache(repo_id=PREFERRED_GLINER_MODEL, filename="model.safetensors")
    if not isinstance(weights, str) or not os.path.isfile(weights):
        raise unittest.SkipTest("modèle GLiNER2-PII absent du cache")
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
        consolidated = pipeline.read_individual_mappings([output])
        converted = pipeline.convert_to_anonymization_format(consolidated)
        merged = pipeline.merge_with_existing_mapping(converted, None, frozenset())
    return payload, merged


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

    def test_pseudonyms_are_french(self):
        coded = pipeline.convert_to_anonymization_format({"entities": {
            "EMAIL_ADDRESS": [{"text": "ada@exemple.fr", "score": 1, "recognizer": "EmailRecognizer"}],
            "DATE_OF_BIRTH": [{"text": "14 mars 1984", "score": 1, "recognizer": "GLiNER2Recognizer"}],
            "CREDIT_CARD": [{"text": "4111 1111 1111 1111", "score": 1, "recognizer": "CreditCardRecognizer"}],
            "IP_ADDRESS": [{"text": "203.0.113.44", "score": 1, "recognizer": "IpRecognizer"}],
            "URL": [{"text": "https://calice-exemple.fr", "score": 1, "recognizer": "UrlRecognizer"}],
            "IBAN_CODE": [{"text": "FR0330006000111234567890189", "score": 1, "recognizer": "IbanRecognizer"}],
            "MAC_ADDRESS": [{"text": "02:11:22:33:44:55", "score": 1, "recognizer": "MacAddressRecognizer"}],
            "CRYPTO": [{"text": "0xabc", "score": 1, "recognizer": "CryptoRecognizer"}],
            "PASSEPORT": [{"text": "12AB34567", "score": 1, "recognizer": "GLiNER2Recognizer"}],
            "CODE_POSTAL": [{"text": "75011", "score": 1, "recognizer": "GLiNER2Recognizer"}],
        }})
        mapping = coded["mapping"]
        self.assertEqual(mapping["ada@exemple.fr"], "COURRIEL_01")
        self.assertEqual(mapping["14 mars 1984"], "DATE_NAISSANCE_02")
        self.assertEqual(mapping["4111 1111 1111 1111"], "CARTE_03")
        self.assertEqual(mapping["203.0.113.44"], "ADRESSE_IP_04")
        self.assertEqual(mapping["https://calice-exemple.fr"], "LIEN_05")
        self.assertEqual(mapping["FR0330006000111234567890189"], "IBAN_06")
        self.assertEqual(mapping["02:11:22:33:44:55"], "ADRESSE_MAC_07")
        self.assertEqual(mapping["0xabc"], "CRYPTO_ACTIF_08")
        self.assertEqual(mapping["12AB34567"], "PASSEPORT_09")
        self.assertEqual(mapping["75011"], "CODE_POSTAL_10")
        self.assertNotIn("NAISSANCE", coded["extracted_data"])

    def test_case_dates_carry_their_iso_date_and_the_birth_date_does_not(self):
        coded = pipeline.convert_to_anonymization_format({"entities": {
            "DOCUMENT_DATE": [{"text": "1er mars 2024", "score": 1, "recognizer": "GLiNER2Recognizer"}],
            "DATE_OF_BIRTH": [{"text": "14 mars 1984", "score": 1, "recognizer": "GLiNER2Recognizer"}],
        }})
        merged = pipeline.merge_with_existing_mapping(coded, None, frozenset())
        autres = merged["extracted_data"]["autres"]
        self.assertEqual(autres["DATE_PIECE_01"]["doc_date_iso"], "2024-03-01")
        self.assertNotIn("doc_date_iso", autres["DATE_NAISSANCE_02"])

    def test_a_city_named_twice_stays_readable_and_takes_no_code(self):
        places = ["Lyon", "12 rue des Lilas", "Vannes", "Lyon", "4 avenue des Tilleuls", "Vannes"]
        coded = pipeline.convert_to_anonymization_format({"entities": {"LOCATION": [
            {"text": place, "score": 1, "recognizer": "GLiNER2Recognizer"} for place in places
        ]}})
        self.assertEqual(coded["mapping"], {"12 rue des Lilas": "ADRESSE_01", "4 avenue des Tilleuls": "ADRESSE_02"})
        self.assertEqual(coded["ignored"], ["Lyon", "Vannes"])
        merged = pipeline.merge_with_existing_mapping(coded, None, frozenset())
        self.assertEqual(set(merged["extracted_data"]["adresses"]), {"ADRESSE_01", "ADRESSE_02"})

    def test_document_date_comes_from_the_dating_formula_not_from_a_purchase(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent / "presidio-gliner"))
        import scanner_worker
        from pattern_detectors import Detection

        self.assertEqual(scanner_worker._dating_formula_date("Paris, le 3 mars 2026\n\nObjet"), "3 mars 2026")
        self.assertEqual(scanner_worker._dating_formula_date("Fait à Lyon le 1er avril 2024."), "1er avril 2024")
        self.assertIsNone(scanner_worker._dating_formula_date("audience du 3 mars 2026"))
        text = "Le bon de commande du 2 novembre 2025 fonde la saisine."
        start = text.index("2 novembre 2025")
        purchase = Detection("TRANSACTION_DATE", start, start + len("2 novembre 2025"), 0.98)
        self.assertTrue(scanner_worker._typed_as_other_date("2 novembre 2025", text, [purchase]))
        self.assertFalse(scanner_worker._typed_as_other_date("3 mars 2026", text, [purchase]))

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
        self.assertEqual(result["mapping"]["Calice International"], "PERS_MORALE_01")
        self.assertEqual(result["mapping"]["Hortensia SA"], "SA_02")
        self.assertEqual(result["mapping"]["Hortensia International Ltd"], "LTD_01")
        self.assertEqual(result["mapping"]["Comptoir des Vignes"], "PERS_MORALE_02")
        self.assertNotIn("NAISSANCE", result["extracted_data"])
        self.assertNotIn("14 mars 1984", result["mapping"])

    def test_scanner_on_the_page(self):
        payload, merged = _scan_before_database()

        self.assertNotIn("NAISSANCE", payload["entities"])
        self.assertNotIn("date of birth", json.dumps(payload))
        self.assertEqual(
            {key: [item["text"] for item in items] for key, items in payload["entities"].items()},
            SPAN_TEXTS,
        )
        for entity_type, items in payload["entities"].items():
            for item in items:
                self.assertEqual(item["recognizer"], SPAN_RECOGNIZER[entity_type], item["text"])
                self.assertGreaterEqual(item["score"], 0.5, item["text"])
        for entity_type, texts in EXPECTED_PATTERNS.items():
            self.assertTrue(texts <= set(SPAN_TEXTS[entity_type]), entity_type)

        meta = payload["document_meta"]
        self.assertEqual(meta.get("nature"), "assignation")
        self.assertIsNone(meta.get("doc_date"))
        self.assertIsNone(meta.get("doc_date_iso"))
        self.assertEqual(meta.get("juridiction"), "tribunal")
        self.assertIsInstance(meta.get("nature_confidence"), float)

        self.assertEqual(merged["mapping"], EXPECTED_MAPPING)
        self.assertIsNone(merged.get("ignored"))
        for city in ("Paris", "Lyon", "Bordeaux"):
            self.assertTrue(merged["mapping"][city].startswith("VILLE_"), city)
        self.assertEqual(_stored(merged["extracted_data"]), EXPECTED_STORED)
        self.assertNotIn("NAISSANCE", merged["extracted_data"])
        for bucket, entries in merged["extracted_data"].items():
            for code, entry in entries.items():
                expected_keys = {"original", "code", "variants", "score", "recognizer"}
                if bucket == "adresses":
                    expected_keys.add("parsed")
                if "legalForm" in EXPECTED_STORED[bucket][code]:
                    expected_keys.add("legalForm")
                if code.startswith(("DATE_0", "DATE_OPERATION_")):
                    expected_keys.add("doc_date_iso")
                self.assertEqual(set(entry), expected_keys, code)
                self.assertEqual(entry["code"], code)
                self.assertIsInstance(entry["score"], float)
                self.assertEqual(merged["reverse_mapping"][code], [entry["original"]], code)
                if bucket == "adresses":
                    self.assertEqual(entry["parsed"]["street_part"], entry["original"], code)
                    self.assertEqual(entry["parsed"]["anonymization_strategy"], "partial", code)
                    self.assertFalse(entry["parsed"]["is_city_only"], code)
        self.assertEqual(set(merged["reverse_mapping"]), {
            code for entries in EXPECTED_STORED.values() for code in entries
        })


if __name__ == "__main__":
    unittest.main()
