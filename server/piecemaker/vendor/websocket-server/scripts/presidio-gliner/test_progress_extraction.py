import os
import unittest

os.environ["HF_HUB_OFFLINE"] = "1"

from model_config import PREFERRED_GLINER_MODEL, is_model_cached
from scanner_worker import ENTITY_DESCRIPTIONS

SAMPLE = " ".join(
    "Jean Dupont habite 12 rue des Lilas à Paris et travaille pour Novartis SAS "
    "avec le Dr Paul Durand pendant que les patients attendent en France."
    for _ in range(60)
)


@unittest.skipUnless(is_model_cached(PREFERRED_GLINER_MODEL), "modèle GLiNER2-PII absent du cache")
class ProgressExtractionTest(unittest.TestCase):
    def test_same_entities_as_extract_entities_long_and_progress_reported(self):
        from gliner2 import GLiNER2
        from progress_extraction import extract_entities_with_progress

        model = GLiNER2.from_pretrained(PREFERRED_GLINER_MODEL, local_files_only=True, map_location="cpu")
        reference = model.extract_entities_long(
            SAMPLE, ENTITY_DESCRIPTIONS, threshold=0.5, include_confidence=True, include_spans=True
        )
        progress = []
        actual = extract_entities_with_progress(
            model, SAMPLE, ENTITY_DESCRIPTIONS, 0.5, on_progress=lambda done, total: progress.append((done, total))
        )
        self.assertEqual(actual, reference)
        self.assertTrue(actual["entities"])
        self.assertEqual(progress[-1][0], progress[-1][1])
        self.assertEqual([done for done, _ in progress], sorted({done for done, _ in progress}))


if __name__ == "__main__":
    unittest.main()
