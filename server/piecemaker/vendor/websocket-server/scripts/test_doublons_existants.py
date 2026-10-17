import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import convert_and_scan_pipeline as pipeline

SURVIVANT = "PERSONNE_PHYSIQUE_" + "904"
DOUBLON = "PERSONNE_PHYSIQUE_" + "905"


def jumeau(code):
    return {
        "original": "Jean Dupont",
        "code": code,
        "category": "personnes_physiques",
        "variants": ["Jean Dupont", "M. Dupont"],
        "score": 0.9,
        "recognizer": "GLiNER2Recognizer",
    }


def graine_avec_jumeaux():
    return {
        "mapping": {"Jean Dupont": DOUBLON, "M. Dupont": DOUBLON},
        "reverse_mapping": {SURVIVANT: ["Jean Dupont", "M. Dupont"], DOUBLON: ["Jean Dupont", "M. Dupont"]},
        "extracted_data": {"personnes_physiques": {SURVIVANT: jumeau(SURVIVANT), DOUBLON: jumeau(DOUBLON)}},
        "ignored": [],
    }


class DoublonsExistantsTest(unittest.TestCase):
    def test_deux_codes_au_meme_nom_fusionnent_sans_nouvelle_piece(self):
        fusion = pipeline.merge_existing_duplicates(graine_avec_jumeaux())
        self.assertIsNotNone(fusion)
        self.assertEqual(set(fusion["reverse_mapping"]), {SURVIVANT})
        self.assertEqual(set(fusion["mapping"].values()), {SURVIVANT})
        self.assertEqual(fusion["extracted_data"]["personnes_physiques"][SURVIVANT]["codes_retires"], [DOUBLON])

    def test_un_mapping_sans_doublon_ne_produit_rien(self):
        graine = graine_avec_jumeaux()
        graine["mapping"] = {"Jean Dupont": SURVIVANT, "M. Dupont": SURVIVANT}
        del graine["reverse_mapping"][DOUBLON]
        del graine["extracted_data"]["personnes_physiques"][DOUBLON]
        self.assertIsNone(pipeline.merge_existing_duplicates(graine))
        self.assertIsNone(pipeline.merge_existing_duplicates({}))

    def test_un_code_retire_reste_reserve_pour_tous_les_dossiers(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base.db"
            with closing(sqlite3.connect(base)) as connection:
                connection.execute("CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, data_json TEXT)")
                connection.execute("CREATE TABLE piecemaker_mappings (project_id TEXT, masked_value TEXT)")
                connection.execute(
                    "INSERT INTO piecemaker_nodes VALUES (?, ?, ?)",
                    ("dossier-a", f"entity:{SURVIVANT}", json.dumps({"code": SURVIVANT, "codes_retires": [DOUBLON]})),
                )
                connection.execute("INSERT INTO piecemaker_mappings VALUES (?, ?)", ("dossier-a", SURVIVANT))
                connection.commit()
            reserves = pipeline.load_reserved_codes(str(base))
        self.assertIn(DOUBLON, reserves)
        nouveau = pipeline.merge_with_existing_mapping(
            pipeline.convert_to_anonymization_format({"entities": {"PERSON": [{"text": "Marie Martin", "score": 0.9}]}}),
            None,
            reserves,
        )
        self.assertNotIn(DOUBLON, nouveau["reverse_mapping"])


if __name__ == "__main__":
    unittest.main()
