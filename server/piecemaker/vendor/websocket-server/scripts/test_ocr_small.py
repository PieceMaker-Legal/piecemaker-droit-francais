import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ocr_markdown import page_markdown
import ocr_small_models


def box(x, y, width=40):
    return [[x, y], [x + width, y], [x + width, y + 10], [x, y + 10]]


class CoordinateMarkdownTests(unittest.TestCase):
    def test_sparse_table_keeps_the_empty_cell_and_every_label(self):
        entries = []
        for index, label in enumerate(('Alpha', 'Beta', 'Gamma', 'Delta')):
            y = 20 + index * 20
            entries += [(label, box(0, y, 60)), (str(201 + index), box(200, y))]
            if index != 1:
                entries.append((str(101 + index), box(100, y)))
        entries.reverse()
        result = page_markdown({'lines': [text for text, _ in entries], 'boxes': [position for _, position in entries]})
        self.assertIn('| Alpha | 101 | 201 |', result)
        self.assertIn('| Beta |  | 202 |', result)
        self.assertIn('| Delta | 104 | 204 |', result)
        self.assertEqual(result.count('Gamma'), 1)

    def test_prose_keeps_reading_order_without_inventing_a_table(self):
        result = page_markdown({'lines': ['Deuxième ligne', 'Première ligne'], 'boxes': [box(0, 40, 200), box(0, 20, 200)]})
        self.assertEqual(result, 'Première ligne\nDeuxième ligne\n')
        self.assertEqual(page_markdown({'lines': [], 'boxes': []}), '')

    def test_invalid_coordinates_cannot_silently_drop_text(self):
        with self.assertRaises(ValueError):
            page_markdown({'lines': ['Texte'], 'boxes': []})
        with self.assertRaises(ValueError):
            page_markdown({'lines': ['Texte'], 'boxes': [box(float('nan'), 20)]})


class ModelDownloadTests(unittest.TestCase):
    def test_download_rejects_corruption_and_only_marks_a_verified_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            model = {'kind': 'det', 'modelId': 'exemple/ocr', 'revision': 'revision', 'files': [{'path': 'weights.bin', 'size': 4, 'sha256': hashlib.sha256(b'good').hexdigest()}]}
            with patch.object(ocr_small_models, 'CHECKPOINTS', [model]), patch.dict(os.environ, {'HF_HUB_CACHE': directory}):
                snapshot = ocr_small_models.snapshot_directory(model)
                snapshot.mkdir(parents=True)
                weights = snapshot / 'weights.bin'
                weights.write_bytes(b'bad!')
                with patch('huggingface_hub.snapshot_download', return_value=str(snapshot)):
                    with self.assertRaises(RuntimeError):
                        ocr_small_models.download_models()
                    self.assertFalse((snapshot / '.piecemaker-ocr-small.json').exists())
                    weights.write_bytes(b'good')
                    ocr_small_models.download_models()
                self.assertEqual(json.loads((snapshot / '.piecemaker-ocr-small.json').read_text())['revision'], 'revision')
                self.assertTrue(ocr_small_models.models_cached())
                weights.unlink()
                self.assertFalse(ocr_small_models.models_cached())


if __name__ == '__main__':
    unittest.main()
