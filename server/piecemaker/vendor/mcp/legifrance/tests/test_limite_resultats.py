from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import handlers
from tools import jurisprudence_search as recherche


def decision_legifrance(rang):
    numero = f"22-{rang:02d}.{rang:03d}"
    return {
        "titles": [{"id": f"JURITEXT{rang:012d}", "title": f"Cour de cassation, civile, Chambre civile 1, 12 mars 2024, {numero}"}],
        "date": "2024-03-12",
    }


def decision_judilibre(rang, annee="22"):
    return {
        "id": f"{rang:024x}",
        "jurisdiction": "cc",
        "decision_date": "2024-03-12",
        "numbers": [f"{annee}-{rang:02d}.{rang:03d}"],
    }


class ClientSimule:
    def __init__(self, legifrance=(), judilibre=(), total_legifrance=None, total_judilibre=None):
        self.decisions_legifrance = list(legifrance)
        self.decisions_judilibre = list(judilibre)
        self.total_legifrance = len(self.decisions_legifrance) if total_legifrance is None else total_legifrance
        self.total_judilibre = len(self.decisions_judilibre) if total_judilibre is None else total_judilibre
        self.listes_legifrance = 0
        self.listes_judilibre = 0
        self.lectures = 0

    def search_with_criteres(self, page_number, page_size, **_):
        if page_size > 1:
            self.listes_legifrance += 1
        debut = (page_number - 1) * page_size
        return {"totalResultNumber": self.total_legifrance, "results": self.decisions_legifrance[debut:debut + page_size]}

    def judilibre(self, chemin, parametres):
        if chemin == "/decision":
            self.lectures += 1
            return {"text": ""}
        valeurs = dict(parametres)
        taille = int(valeurs["page_size"])
        if taille > 1:
            self.listes_judilibre += 1
        debut = int(valeurs["page"]) * taille
        return {
            "total": self.total_judilibre,
            "results": self.decisions_judilibre[debut:debut + taille],
            "next_page": debut + taille < len(self.decisions_judilibre),
        }


def plan(requete="contrat"):
    return recherche.preparer({"query": requete, "matiere": "CIVIL", "date_debut": "2020-01-01", "date_fin": "2025-01-01"})


class LimiteResultatsTests(unittest.TestCase):
    def test_les_doublons_entre_sources_ne_comptent_pas(self):
        client = ClientSimule(
            [decision_legifrance(r) for r in range(1, 301)],
            [decision_judilibre(r) for r in range(1, 301)],
        )
        collecte = recherche.collecter(plan(), client)
        self.assertEqual(len(collecte["resultats"]), 300)
        self.assertEqual(collecte["fusionnees"], 300)
        self.assertEqual(collecte["total_avant_fusion"], 600)

    def test_une_page_judilibre_incomplete_ne_coupe_pas_la_liste(self):
        client = ClientSimule(judilibre=[decision_judilibre(r) for r in range(1, 61)])
        lire = client.judilibre

        def page_incomplete(chemin, parametres):
            reponse = lire(chemin, parametres)
            reponse["results"] = reponse["results"][:36]
            return reponse

        client.judilibre = page_incomplete
        collecte = recherche.collecter(plan(), client)
        self.assertEqual(len(collecte["resultats"]), 46)

    def test_plus_de_500_decisions_distinctes_donnent_un_avertissement_et_500_resultats(self):
        client = ClientSimule(
            [decision_legifrance(r) for r in range(1, 301)],
            [decision_judilibre(r, annee="23") for r in range(1, 301)],
        )
        collecte = recherche.collecter(plan('"clause pénale"'), client)
        self.assertEqual(len(collecte["resultats"]), 500)
        self.assertLessEqual(client.lectures, 500)
        self.assertTrue(any("Plus de 500" in a for a in collecte["avertissements"]))

    def test_les_decisions_gardees_sont_les_mieux_classees(self):
        client = ClientSimule(
            [decision_legifrance(r) for r in range(1, 301)],
            [decision_judilibre(r, annee="23") for r in range(1, 301)],
        )
        rangs = [r["rang"] for r in recherche.collecter(plan(), client)["resultats"]]
        self.assertEqual(max(rangs), 250)

    def test_legifrance_au_dela_de_500_est_liste_avec_un_avertissement(self):
        client = ClientSimule([decision_legifrance(r) for r in range(1, 601)], total_judilibre=0)
        collecte = recherche.collecter(plan(), client)
        self.assertEqual(len(collecte["resultats"]), 500)
        self.assertEqual(len(collecte["avertissements"]), 1)

    def test_judilibre_au_dela_du_plafond_est_liste_avec_un_avertissement(self):
        client = ClientSimule(judilibre=[decision_judilibre(r) for r in range(1, 1201)])
        collecte = recherche.collecter(plan(), client)
        self.assertEqual(len(collecte["resultats"]), 500)
        self.assertLessEqual(client.listes_judilibre, recherche.PLAFOND_JUDILIBRE // recherche.JUDILIBRE_PAGE)
        self.assertEqual(len(collecte["avertissements"]), 1)

    def test_le_corpus_reste_refuse_sans_liste_au_dela_de_500(self):
        client = ClientSimule(total_legifrance=501, total_judilibre=0)
        with self.assertRaises(recherche.RechercheTropLarge):
            recherche.collecter(plan(), client, refuser_si_trop_large=True)
        self.assertEqual(client.listes_legifrance, 0)

    def test_search_code_au_dela_de_500_rend_un_avertissement(self):
        reponse_api = {"totalResultNumber": 501, "results": []}
        with mock.patch.object(handlers.legifrance_client, "search_with_criteres", return_value=reponse_api):
            reponse = handlers.handle_search_code({"query": "contrat"}, "local")
        self.assertFalse(reponse["isError"])
        self.assertIn("Plus de 500", reponse["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
