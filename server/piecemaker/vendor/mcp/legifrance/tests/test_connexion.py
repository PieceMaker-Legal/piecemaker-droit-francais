import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mcp_stdio_server as serveur
from tools import connexion_piste as connexion
from tools.legifrance_client import legifrance_client

CLIENT_ID = "identifiant-fictif"
SECRET = "secret-fictif"


class ConnexionTests(unittest.TestCase):
    def setUp(self):
        dossier = tempfile.TemporaryDirectory()
        self.addCleanup(dossier.cleanup)
        self.fichier = Path(dossier.name) / "sous-dossier" / ".env"
        env = mock.patch.dict(os.environ, {"LEGIFRANCE_ENV_FILE": str(self.fichier)})
        env.start()
        self.addCleanup(env.stop)
        for attribut, valeur in (("client_id", None), ("client_secret", None), ("access_token", "ancien")):
            patch = mock.patch.object(legifrance_client, attribut, valeur)
            patch.start()
            self.addCleanup(patch.stop)
        connexion._client_id = None

    def appeler(self, etape, presse_papiers, refus=None):
        with mock.patch.object(connexion, "lire_presse_papiers", return_value=presse_papiers), \
                mock.patch.object(connexion, "valider", return_value=refus) as valider:
            return connexion.handle_connexion({"etape": etape}, "local"), valider

    def outils(self):
        return [outil["name"] for outil in serveur.handle_tools_list({})["tools"]]

    def test_sans_cles_seul_l_outil_connexion_est_expose(self):
        self.assertEqual(self.outils(), ["connexion"])
        self.assertIn("connexion", serveur.handle_initialize({})["instructions"])

    def test_avec_cles_l_outil_connexion_n_est_plus_expose(self):
        legifrance_client.client_id, legifrance_client.client_secret = CLIENT_ID, SECRET
        self.assertNotIn("connexion", self.outils())
        self.assertIn("Search_Jurisprudence", self.outils())

    def test_la_connexion_enregistre_en_0600_sans_renvoyer_les_valeurs(self):
        premiere, _ = self.appeler("client_id", CLIENT_ID)
        seconde, valider = self.appeler("client_secret", SECRET)
        valider.assert_called_once_with(CLIENT_ID, SECRET)
        self.assertFalse(seconde["isError"])
        for reponse in (premiere, seconde):
            self.assertNotIn(CLIENT_ID, reponse["content"][0]["text"])
            self.assertNotIn(SECRET, reponse["content"][0]["text"])
        contenu = self.fichier.read_text(encoding="utf-8")
        self.assertIn(f"LEGIFRANCE_CLIENT_ID={CLIENT_ID}\n", contenu)
        self.assertIn(f"LEGIFRANCE_CLIENT_SECRET={SECRET}\n", contenu)
        self.assertIn("LEGIFRANCE_ENV=production\n", contenu)
        self.assertEqual(stat.S_IMODE(self.fichier.stat().st_mode), 0o600)
        self.assertEqual(legifrance_client.client_secret, SECRET)
        self.assertIsNone(legifrance_client.access_token)
        self.assertNotIn("connexion", self.outils())

    def test_les_autres_lignes_du_fichier_sont_conservees(self):
        self.fichier.parent.mkdir()
        self.fichier.write_text("# note\nAUTRE=valeur\nLEGIFRANCE_CLIENT_ID=ancien\n", encoding="utf-8")
        connexion.enregistrer(CLIENT_ID, SECRET)
        contenu = self.fichier.read_text(encoding="utf-8")
        self.assertIn("# note\n", contenu)
        self.assertIn("AUTRE=valeur\n", contenu)
        self.assertNotIn("ancien", contenu)

    def test_un_refus_de_piste_n_ecrit_rien_et_garde_l_outil(self):
        self.appeler("client_id", CLIENT_ID)
        reponse, _ = self.appeler("client_secret", SECRET, refus="PISTE refuse ces identifiants.")
        self.assertTrue(reponse["isError"])
        self.assertFalse(self.fichier.exists())
        self.assertEqual(self.outils(), ["connexion"])

    def test_le_secret_sans_client_id_est_refuse(self):
        reponse, valider = self.appeler("client_secret", SECRET)
        self.assertTrue(reponse["isError"])
        valider.assert_not_called()

    def test_le_client_id_recopie_comme_secret_est_refuse(self):
        self.appeler("client_id", CLIENT_ID)
        reponse, valider = self.appeler("client_secret", CLIENT_ID)
        self.assertTrue(reponse["isError"])
        valider.assert_not_called()

    def test_un_presse_papiers_qui_n_est_pas_un_identifiant_est_refuse(self):
        for contenu in ("", "un texte avec des espaces", "x" * 201):
            reponse, _ = self.appeler("client_id", contenu)
            self.assertTrue(reponse["isError"])
        self.assertIsNone(connexion._client_id)

    def test_un_presse_papiers_inaccessible_indique_le_fichier(self):
        reponse, _ = self.appeler("client_id", None)
        self.assertTrue(reponse["isError"])
        self.assertIn(str(self.fichier), reponse["content"][0]["text"])

    def test_le_serveur_notifie_le_changement_apres_la_reponse(self):
        self.appeler("client_id", CLIENT_ID)
        requete = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "connexion", "arguments": {"etape": "client_secret"}},
        }
        sortie = io.StringIO()
        with mock.patch.object(connexion, "lire_presse_papiers", return_value=SECRET), \
                mock.patch.object(connexion, "valider", return_value=None), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps(requete) + "\n")), \
                mock.patch.object(sys, "stdout", sortie):
            serveur.main()
        lignes = [json.loads(ligne) for ligne in sortie.getvalue().splitlines()]
        self.assertEqual(lignes[0]["id"], 1)
        self.assertEqual(lignes[1]["method"], "notifications/tools/list_changed")


if __name__ == "__main__":
    unittest.main()
