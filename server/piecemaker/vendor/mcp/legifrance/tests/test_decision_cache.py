import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import decision_history
from tools import jurisprudence_search as recherche
from tools.legifrance_client import LegifranceClient

LEGIFRANCE_ID = "JURITEXT000099990001"
JUDILIBRE_ID = "0123456789abcdef01234567"
REPONSE_LEGIFRANCE = {"text": {"titre": "Cour de cassation, 12 mars 2024, 22-10.001", "texte": "Texte fictif."}}
ARTICLE_ID = "LEGIARTI000099990001"
ARTICLE_CLOS = {"article": {"num": "1", "texte": "Texte d'article fictif.", "dateDebut": 1262304000000, "dateFin": 1577836800000}}
ARTICLE_EN_VIGUEUR = {"article": {"num": "1", "texte": "Texte d'article fictif.", "dateDebut": 1577836800000, "dateFin": 32472144000000}}
REPONSE_JUDILIBRE = {"id": JUDILIBRE_ID, "location": "Cour de cassation", "decision_date": "2024-03-12", "text": "Texte Judilibre fictif."}


class ClientJudilibre:
    def __init__(self):
        self.appels = 0

    def judilibre(self, route, parametres):
        self.appels += 1
        return REPONSE_JUDILIBRE


class CacheDecisions(unittest.TestCase):
    def setUp(self):
        dossier = tempfile.TemporaryDirectory()
        self.addCleanup(dossier.cleanup)
        environnement = mock.patch.dict(os.environ, {"PIECEMAKER_HOME": dossier.name})
        environnement.start()
        self.addCleanup(environnement.stop)
        self.decisions = Path(dossier.name) / "decisions"
        self.client = LegifranceClient.__new__(LegifranceClient)

    def fichier(self, identifiant):
        return json.loads((self.decisions / f"{identifiant}.json").read_text(encoding="utf-8"))

    def test_une_decision_legifrance_ne_sollicite_l_api_qu_une_fois(self):
        with mock.patch.object(LegifranceClient, "_request", return_value=REPONSE_LEGIFRANCE) as requete:
            premiere = self.client.get_decision_text(LEGIFRANCE_ID)
            seconde = self.client.get_decision_text(f" {LEGIFRANCE_ID} ")
        self.assertEqual(requete.call_count, 1)
        self.assertEqual(premiere, seconde)
        entree = self.fichier(LEGIFRANCE_ID)
        self.assertEqual(entree["id"], LEGIFRANCE_ID)
        self.assertEqual(entree["texte"], "Texte fictif.")
        self.assertEqual(entree["titre"], "Cour de cassation, 12 mars 2024, 22-10.001")

    def test_une_decision_judilibre_ne_sollicite_l_api_qu_une_fois(self):
        client = ClientJudilibre()
        recherche.decision_judilibre(client, JUDILIBRE_ID)
        self.assertEqual(recherche.decision_judilibre(client, JUDILIBRE_ID), REPONSE_JUDILIBRE)
        self.assertEqual(client.appels, 1)
        self.assertIn("Cour de cassation", self.fichier(JUDILIBRE_ID)["titre"])

    def test_une_reponse_sans_texte_n_est_pas_gardee(self):
        with mock.patch.object(LegifranceClient, "_request", return_value={"text": {}}) as requete:
            self.client.get_decision_text(LEGIFRANCE_ID)
            self.client.get_decision_text(LEGIFRANCE_ID)
        self.assertEqual(requete.call_count, 2)
        self.assertFalse((self.decisions / f"{LEGIFRANCE_ID}.json").exists())

    def test_une_ancienne_entree_sans_reponse_brute_est_remplacee(self):
        self.decisions.mkdir(parents=True)
        (self.decisions / f"{LEGIFRANCE_ID}.json").write_text(
            json.dumps({"id": LEGIFRANCE_ID, "texte": "Ancien texte."}), encoding="utf-8")
        with mock.patch.object(LegifranceClient, "_request", return_value=REPONSE_LEGIFRANCE) as requete:
            self.assertEqual(self.client.get_decision_text(LEGIFRANCE_ID), REPONSE_LEGIFRANCE)
        self.assertEqual(requete.call_count, 1)
        self.assertEqual(self.fichier(LEGIFRANCE_ID)["texte"], "Texte fictif.")

    def test_un_identifiant_avec_chemin_n_ecrit_rien(self):
        with mock.patch.object(LegifranceClient, "_request", return_value=REPONSE_LEGIFRANCE):
            self.client.get_decision_text("../evasion")
        self.assertFalse(self.decisions.exists())

    def test_un_article_en_cache_ne_sollicite_pas_l_api(self):
        with mock.patch.object(LegifranceClient, "_request", return_value=ARTICLE_CLOS) as requete:
            self.client.get_article(ARTICLE_ID)
            self.assertEqual(self.client.get_article(ARTICLE_ID), ARTICLE_CLOS)
        self.assertEqual(requete.call_count, 1)
        entree = json.loads((self.decisions.parent / "articles" / f"{ARTICLE_ID}.json").read_text(encoding="utf-8"))
        self.assertEqual(entree["reponse"], ARTICLE_CLOS)

    def test_une_version_close_reste_en_cache_sans_expiration(self):
        articles = self.decisions.parent / "articles"
        articles.mkdir(parents=True)
        (articles / f"{ARTICLE_ID}.json").write_text(json.dumps({"at": "2020-01-01", "reponse": ARTICLE_CLOS}), encoding="utf-8")
        with mock.patch.object(LegifranceClient, "_request") as requete:
            self.assertEqual(self.client.get_article(ARTICLE_ID), ARTICLE_CLOS)
        requete.assert_not_called()

    def test_une_version_en_vigueur_est_relue_le_lendemain(self):
        articles = self.decisions.parent / "articles"
        articles.mkdir(parents=True)
        (articles / f"{ARTICLE_ID}.json").write_text(json.dumps({"at": "2020-01-01", "reponse": ARTICLE_EN_VIGUEUR}), encoding="utf-8")
        with mock.patch.object(LegifranceClient, "_request", return_value=ARTICLE_EN_VIGUEUR) as requete:
            self.client.get_article(ARTICLE_ID)
            self.client.get_article(ARTICLE_ID)
        self.assertEqual(requete.call_count, 1)

    def test_un_article_sans_texte_n_est_pas_garde(self):
        with mock.patch.object(LegifranceClient, "_request", return_value={"article": {"texte": ""}}) as requete:
            self.client.get_article(ARTICLE_ID)
            self.client.get_article(ARTICLE_ID)
        self.assertEqual(requete.call_count, 2)
        self.assertFalse((self.decisions.parent / "articles").exists())

    def test_le_controle_historique_n_est_calcule_qu_une_fois_par_jour(self):
        with mock.patch.object(LegifranceClient, "_request", return_value=REPONSE_LEGIFRANCE):
            self.client.get_decision_text(LEGIFRANCE_ID)
        with mock.patch.object(decision_history, "build_decision_history", return_value={}) as historique, \
                mock.patch.object(decision_history, "controle_historique", return_value=("aucun", ["- Rien."])):
            premier = decision_history.render_controle(LEGIFRANCE_ID)
            second = decision_history.render_controle(LEGIFRANCE_ID)
        self.assertEqual(historique.call_count, 1)
        self.assertEqual(premier, second)

    def test_un_controle_en_echec_n_est_pas_memorise(self):
        with mock.patch.object(LegifranceClient, "_request", return_value=REPONSE_LEGIFRANCE):
            self.client.get_decision_text(LEGIFRANCE_ID)
        with mock.patch.object(decision_history, "build_decision_history", side_effect=Exception("panne")) as historique:
            self.assertIn("Contrôle impossible", decision_history.render_controle(LEGIFRANCE_ID))
            decision_history.render_controle(LEGIFRANCE_ID)
        self.assertEqual(historique.call_count, 2)


if __name__ == "__main__":
    unittest.main()
