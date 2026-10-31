from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.mcp_definitions import MCP_TOOLS
from tools.handlers import TOOL_HANDLERS


class OutilsExposesTests(unittest.TestCase):
    def test_search_jurisprudence_est_le_seul_outil_de_jurisprudence(self):
        noms = [outil["name"] for outil in MCP_TOOLS]
        self.assertEqual(noms, ["Search_Jurisprudence", "Search_Code", "consulter_article", "consulter_decision", "Historique_Judiciaire", "Tracking_BODACC", "dictionnaire_juridique"])

    def test_chaque_outil_expose_a_un_gestionnaire(self):
        for outil in MCP_TOOLS:
            self.assertIn(outil["name"], TOOL_HANDLERS)

    def test_tous_les_outils_sont_en_lecture_seule(self):
        for outil in MCP_TOOLS:
            self.assertTrue(outil["annotations"]["readOnlyHint"])


if __name__ == "__main__":
    unittest.main()
