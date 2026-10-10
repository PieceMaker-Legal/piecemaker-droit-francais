import ast
import json
import tempfile
import unittest
from pathlib import Path

import convert_and_scan_pipeline as pipeline
import legal_forms


ROOT = Path(__file__).resolve().parents[5]


def _span(text, fragment, start_at=0):
    start = text.index(fragment, start_at)
    return start, start + len(fragment)


def _occurrence(text, fragment, source, start_at=0):
    start, end = _span(text, fragment, start_at)
    return {"text": fragment, "start": start, "end": end, "source_file": source, "score": 0.9}


def _convert(text, fragments):
    with tempfile.TemporaryDirectory() as directory:
        source = str(Path(directory) / "piece.md")
        Path(source).write_text(text, encoding="utf-8")
        entities = [_occurrence(text, fragment, source, start) for fragment, start in fragments]
        return pipeline.convert_to_anonymization_format({"entities": {"ORGANIZATION": entities}})


class LegalFormTests(unittest.TestCase):
    def test_phrases_and_sigles(self):
        cases = {
            "Calice SA": "SA",
            "société anonyme": "SA",
            "Société Anonyme": "SA",
            "la sa maison": None,
            "Calice sa": None,
            "société par actions simplifiée unipersonnelle": "SASU",
            "société par actions simplifiée": "SAS",
            "société à responsabilité limitée": "SARL",
            "Limited Liability Company": "LLC",
            "limited": "LTD",
            "Public Limited Company": "PLC",
            "Aktiengesellschaft": "AG",
            "Kommanditgesellschaft auf Aktien": "KGAA",
            "Kommanditgesellschaft": "KG",
            "Gesellschaft mit beschränkter Haftung": "GMBH",
            "GmbH & Co. KG": "GMBHCOKG",
            "Company": None,
            "Exemple Corporation": "CORP",
            "professional corporation": "PC",
            "osakeyhtiö": "OY",
            "societas europaea": "SE",
            "Sàrl": "SARL",
            "Exemple S.A.S.": "SAS",
            "Exemple S. A.": "SA",
        }
        for text, expected in cases.items():
            self.assertEqual(legal_forms.extract_legal_form(text)[0], expected, text)

    def test_a_longer_name_is_another_company(self):
        text = "La société anonyme Calice a signé, puis Calice SA confirme, et Calice International aussi."
        first = text.index("Calice a")
        result = _convert(text, [
            ("Calice", first),
            ("Calice SA", 0),
            ("Calice International", 0),
        ])
        societes = result["extracted_data"]["societes"]
        self.assertEqual(set(societes), {"SA_01", "PERS_MORALE_01"})
        self.assertEqual(societes["SA_01"]["legalForm"], "SA")
        self.assertEqual(set(societes["SA_01"]["variants"]), {"Calice", "Calice SA"})
        self.assertEqual(result["mapping"]["Calice SA"], "SA_01")
        self.assertEqual(result["mapping"]["Calice International"], "PERS_MORALE_01")

    def test_two_forms_split_one_stem(self):
        text = "Hortensia SA assigne Hortensia International Ltd."
        result = _convert(text, [("Hortensia SA", 0), ("Hortensia International", 0)])
        societes = result["extracted_data"]["societes"]
        by_form = {entry["legalForm"]: code for code, entry in societes.items()}
        self.assertEqual(by_form, {"SA": "SA_01", "LTD": "LTD_01"})
        self.assertEqual(set(societes["SA_01"]["variants"]), {"Hortensia SA"})
        self.assertEqual(set(societes["LTD_01"]["variants"]), {"Hortensia International"})

    def test_holding_prefix_does_not_merge(self):
        text = "Holding Calice rencontre Calice SA."
        result = _convert(text, [("Holding Calice", 0), ("Calice SA", 0)])
        codes = set(result["extracted_data"]["societes"])
        self.assertEqual(codes, {"PERS_MORALE_01", "SA_01"})

    def test_formless_company_is_padded_personne_morale(self):
        text = "Brumaire Conseil intervient."
        result = _convert(text, [("Brumaire Conseil", 0)])
        entry = result["extracted_data"]["societes"]["PERS_MORALE_01"]
        self.assertNotIn("legalForm", entry)

    def test_later_file_joins_the_same_company_or_stays_apart(self):
        sa = _convert("Calice SA signe.", [("Calice SA", 0)])
        same = _convert("Calice comparaît.", [("Calice", 0)])
        joined = pipeline.merge_with_existing_mapping(same, sa)
        self.assertEqual(set(joined["extracted_data"]["societes"]), {"SA_01"})
        self.assertEqual(joined["mapping"]["Calice"], "SA_01")
        self.assertEqual(joined["extracted_data"]["societes"]["SA_01"]["legalForm"], "SA")

        subsidiary = _convert("Calice International comparaît.", [("Calice International", 0)])
        apart = pipeline.merge_with_existing_mapping(subsidiary, sa)
        self.assertEqual(set(apart["extracted_data"]["societes"]), {"SA_01", "PERS_MORALE_01"})
        self.assertEqual(apart["mapping"]["Calice International"], "PERS_MORALE_01")

        other = _convert("Hortensia International Ltd comparaît.", [("Hortensia International", 0)])
        hortensia = _convert("Hortensia SA assigne.", [("Hortensia SA", 0)])
        split = pipeline.merge_with_existing_mapping(other, hortensia)
        forms = {entry["legalForm"]: code for code, entry in split["extracted_data"]["societes"].items()}
        self.assertEqual(forms, {"SA": "SA_01", "LTD": "LTD_01"})

    def test_second_company_of_the_same_form_increments(self):
        first = _convert("Calice SA signe.", [("Calice SA", 0)])
        second = _convert("Lilas SA signe.", [("Lilas SA", 0)])
        merged = pipeline.merge_with_existing_mapping(second, first)
        self.assertEqual(set(merged["extracted_data"]["societes"]), {"SA_01", "SA_02"})
        self.assertEqual(merged["extracted_data"]["societes"]["SA_02"]["legalForm"], "SA")

    def test_legacy_unpadded_code_keeps_its_number(self):
        existing = {
            "mapping": {"Vieux Comptoir": "SA_1"},
            "reverse_mapping": {"SA_1": ["Vieux Comptoir"]},
            "extracted_data": {"societes": {"SA_1": {
                "original": "Vieux Comptoir", "code": "SA_1", "variants": ["Vieux Comptoir"],
            }}},
        }
        new = _convert("Lilas SA signe.", [("Lilas SA", 0)])
        merged = pipeline.merge_with_existing_mapping(new, existing)
        self.assertIn("SA_1", merged["extracted_data"]["societes"])
        self.assertIn("SA_02", merged["extracted_data"]["societes"])

    def test_tokens_are_mirrored(self):
        cjs = (ROOT / "server/piecemaker/vendor/websocket-server/legal-forms.cjs").read_text(encoding="utf-8")
        typescript = (ROOT / "plugins/piecemaker-dossier/src/party-codes.ts").read_text(encoding="utf-8")
        for token in legal_forms._FORM_NATIONALITY:
            self.assertIn(f"'{token}'", cjs)
            self.assertIn(f"'{token}'", typescript)

    def test_gliner_labels_mask_secrets_and_skip_names(self):
        source = Path(__file__).with_name("presidio-gliner").joinpath("scanner_worker.py").read_text(encoding="utf-8")
        tables = {
            node.targets[0].id: ast.literal_eval(node.value)
            for node in ast.parse(source).body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in ("ENTITY_MAPPING", "ENTITY_DESCRIPTIONS")
        }
        mapping, descriptions = tables["ENTITY_MAPPING"], tables["ENTITY_DESCRIPTIONS"]
        self.assertEqual(set(mapping), set(descriptions))
        for label in ("full_name", "first_name", "middle_name", "last_name"):
            self.assertNotIn(label, mapping)
        expected = {
            "date_of_birth": "DATE_OF_BIRTH", "date": "DATE", "document_date": "DOCUMENT_DATE",
            "transaction_date": "TRANSACTION_DATE", "city": "VILLE", "country": "PAYS",
            "state_or_region": "REGION", "postal_code": "CODE_POSTAL",
            "password": "MOT_DE_PASSE", "secret": "SECRET", "api_key": "CLE_API",
            "access_token": "JETON_ACCES", "recovery_code": "CODE_RECUPERATION",
        }
        for label, entity_type in expected.items():
            self.assertEqual(mapping[label], entity_type, label)
        self.assertIsNone(descriptions["date_of_birth"])

    def test_source_file_is_kept_on_each_mention(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = {
                "source_file": str(Path(directory) / "piece.md"),
                "entities": {"ORGANIZATION": [{"text": "Calice SA", "start": 0, "end": 9}]},
            }
            path = Path(directory) / "piece_sensitive_map.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            consolidated = pipeline.read_individual_mappings([str(path)])
            self.assertEqual(
                consolidated["entities"]["ORGANIZATION"][0]["source_file"],
                payload["source_file"],
            )


if __name__ == "__main__":
    unittest.main()
