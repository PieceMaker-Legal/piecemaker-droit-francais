import unittest

import convert_and_scan_pipeline as pipeline


def person(code, *texts):
    return code, {"original": texts[0], "code": code, "variants": list(texts)}


def mapping_of(*people, ignored=()):
    return {
        "mapping": {text: code for code, entry in people for text in entry["variants"]},
        "reverse_mapping": {code: list(entry["variants"]) for code, entry in people},
        "extracted_data": {"personnes_physiques": dict(people)},
        **({"ignored": list(ignored)} if ignored else {}),
    }


class VariantesNomsTest(unittest.TestCase):
    def test_parties_du_nom(self):
        self.assertEqual(pipeline.person_name_parts("Jean Dupont"), ["Jean", "Dupont"])
        self.assertEqual(pipeline.person_name_parts("Monsieur Jean Dupont"), ["Jean", "Dupont"])
        self.assertEqual(pipeline.person_name_parts("Jean-Pierre DUPONT"), ["Jean-Pierre", "DUPONT"])
        self.assertEqual(pipeline.person_name_parts("Jean de La Fontaine"), ["Jean", "Fontaine", "de La Fontaine"])
        self.assertEqual(pipeline.person_name_parts("J. Dupont"), ["Dupont"])
        self.assertEqual(pipeline.person_name_parts("Dupont"), [])
        self.assertEqual(pipeline.person_name_parts("Maître Dupont"), [])

    def test_prenom_et_nom_deviennent_variantes_du_meme_code(self):
        merged = pipeline.merge_with_existing_mapping({}, mapping_of(person("PERSONNE_PHYSIQUE_01", "Jean Dupont")))
        self.assertEqual(merged["mapping"]["Jean"], "PERSONNE_PHYSIQUE_01")
        self.assertEqual(merged["mapping"]["Dupont"], "PERSONNE_PHYSIQUE_01")
        self.assertEqual(merged["reverse_mapping"]["PERSONNE_PHYSIQUE_01"], ["Jean Dupont", "Jean", "Dupont"])
        entry = merged["extracted_data"]["personnes_physiques"]["PERSONNE_PHYSIQUE_01"]
        self.assertEqual(entry["variants"], ["Jean Dupont", "Jean", "Dupont"])

    def test_dirigeant_recoit_aussi_ses_variantes(self):
        merged = pipeline.merge_with_existing_mapping({}, mapping_of(person("DIRIGEANT_01", "Jean Dupont")))
        self.assertEqual(merged["mapping"]["Dupont"], "DIRIGEANT_01")

    def test_nom_partage_va_aux_deux_personnes(self):
        merged = pipeline.merge_with_existing_mapping({}, mapping_of(
            person("PERSONNE_PHYSIQUE_01", "Jean Dupont"),
            person("PERSONNE_PHYSIQUE_02", "Marie Dupont"),
        ))
        self.assertIn("Dupont", merged["reverse_mapping"]["PERSONNE_PHYSIQUE_01"])
        self.assertIn("Dupont", merged["reverse_mapping"]["PERSONNE_PHYSIQUE_02"])
        self.assertIn(merged["mapping"]["Dupont"], {"PERSONNE_PHYSIQUE_01", "PERSONNE_PHYSIQUE_02"})
        self.assertEqual(merged["mapping"]["Marie"], "PERSONNE_PHYSIQUE_02")

    def test_partie_tenue_par_une_autre_entite_ou_supprimee_reste_hors(self):
        existing = mapping_of(person("PERSONNE_PHYSIQUE_01", "Jean Paris"), ignored=["jean"])
        existing["mapping"]["Paris"] = "ADRESSE_01"
        existing["reverse_mapping"]["ADRESSE_01"] = ["Paris"]
        merged = pipeline.merge_with_existing_mapping({}, existing)
        self.assertEqual(merged["mapping"]["Paris"], "ADRESSE_01")
        self.assertNotIn("Jean", merged["mapping"])
        self.assertEqual(merged["reverse_mapping"]["PERSONNE_PHYSIQUE_01"], ["Jean Paris"])

    def test_un_second_passage_ne_change_rien(self):
        once = pipeline.merge_with_existing_mapping({}, mapping_of(person("PERSONNE_PHYSIQUE_01", "Jean Dupont")))
        twice = pipeline.merge_with_existing_mapping({}, once)
        self.assertEqual(twice["mapping"], once["mapping"])
        self.assertEqual(twice["reverse_mapping"], once["reverse_mapping"])


if __name__ == "__main__":
    unittest.main()
