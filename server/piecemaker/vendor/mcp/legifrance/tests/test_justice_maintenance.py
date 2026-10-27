import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location("justice_lexicon", Path(__file__).resolve().parents[1] / "tools" / "justice_lexicon.py")
lexicon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lexicon)


class JusticeMaintenanceTests(unittest.TestCase):
    def test_maintenance_is_reported_without_parsing_a_definition(self):
        session = SimpleNamespace(get=lambda *args, **kwargs: SimpleNamespace(text="<title>Site en cours de maintenance | Justice.fr</title>", raise_for_status=lambda: None))
        client = lexicon.JusticeLexiconClient(session=session)
        with self.assertRaisesRegex(lexicon.JusticeLexiconError, "temporairement en maintenance"):
            client.lookup("exemple")

    def test_regular_lexicon_entries_are_still_parsed(self):
        entries = lexicon.parse_lexicon_page('<dt class="lexique-content-titre">Terme fictif</dt><dd>Définition fictive.</dd>')
        self.assertEqual(entries[0]["terme"], "Terme fictif")
        self.assertEqual(entries[0]["definition"], "Définition fictive.")
