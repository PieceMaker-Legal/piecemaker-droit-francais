import unittest
from unittest.mock import patch

import scanner_worker


class DocumentMetadataTest(unittest.TestCase):
    def test_classifier_uses_reduced_families_and_keeps_unknown_indeterminate(self):
        class Model:
            def classify_text(self, text, schema, **kwargs):
                self.labels = schema["nature_document"]
                return {"nature_document": {"label": "autre", "confidence": 0.5}}

            def extract_json(self, *args, **kwargs):
                return {}

        model = Model()
        with patch.object(scanner_worker, "_gliner_model", model), patch.object(scanner_worker, "DOC_META_ENABLED", True):
            metadata = scanner_worker.extract_document_meta("Document fictif sans intitulé.", [])
        self.assertIn("acte de procédure", model.labels)
        self.assertIn("décision judiciaire", model.labels)
        self.assertNotIn("assignation", model.labels)
        self.assertNotIn("jugement", model.labels)
        self.assertNotIn("autre", model.labels)
        self.assertEqual(metadata["nature"], "indéterminé")


if __name__ == "__main__":
    unittest.main()
