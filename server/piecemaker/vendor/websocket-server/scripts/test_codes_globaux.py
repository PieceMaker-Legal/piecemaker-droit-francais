import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import convert_and_scan_pipeline as pipeline


def base_avec(nodes, mappings):
    directory = tempfile.mkdtemp()
    base = Path(directory) / "base.db"
    with closing(sqlite3.connect(base)) as connection:
        connection.execute("CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, data_json TEXT)")
        connection.execute("CREATE TABLE piecemaker_mappings (project_id TEXT, masked_value TEXT)")
        connection.executemany("INSERT INTO piecemaker_nodes VALUES (?, ?, ?)", nodes)
        connection.executemany("INSERT INTO piecemaker_mappings VALUES (?, ?)", mappings)
        connection.commit()
    return str(base)


def nouvelle_personne(nom, reserves):
    return pipeline.merge_with_existing_mapping(
        pipeline.convert_to_anonymization_format({"entities": {"PERSON": [{"text": nom, "score": 0.9}]}}),
        None,
        reserves,
    )


class CodesGlobauxTest(unittest.TestCase):
    def test_un_code_porte_seulement_par_data_code_reste_reserve(self):
        base = base_avec([("dossier-a", "personne-libre", json.dumps({"code": "PERSONNE_PHYSIQUE_04"}))], [])
        reserves = pipeline.load_reserved_codes(base)
        self.assertIn("PERSONNE_PHYSIQUE_04", reserves)
        self.assertEqual(set(nouvelle_personne("Marie Martin", reserves)["reverse_mapping"]), {"PERSONNE_PHYSIQUE_05"})

    def test_la_numerotation_depasse_cinq_chiffres_sans_borne(self):
        base = base_avec([], [("dossier-a", "PERSONNE_PHYSIQUE_12345"), ("dossier-b", "PERSONNE_PHYSIQUE_999999")])
        reserves = pipeline.load_reserved_codes(base)
        self.assertEqual(set(nouvelle_personne("Marie Martin", reserves)["reverse_mapping"]), {"PERSONNE_PHYSIQUE_1000000"})


if __name__ == "__main__":
    unittest.main()
