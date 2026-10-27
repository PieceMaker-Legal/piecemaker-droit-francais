import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class WarmupDownloadTests(unittest.TestCase):
    def load_warmup(self, snapshot):
        spec = importlib.util.spec_from_file_location("warmup_download_test", Path(__file__).with_name("warmup.py"))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"mineru_improved_1": SimpleNamespace(mineru_available=lambda: False), "huggingface_hub": SimpleNamespace(snapshot_download=snapshot)}):
            spec.loader.exec_module(module)
        return module

    def test_download_is_limited_to_the_pinned_checkpoint_files(self):
        snapshot = Mock()
        warmup = self.load_warmup(snapshot)
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"HF_HUB_CACHE": root}), patch.dict(sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot)}):
            self.assertTrue(warmup.download_gliner2_model(warmup.PREFERRED_GLINER_MODEL, "Modèle fictif"))
        self.assertEqual(snapshot.call_args.kwargs["revision"], warmup.PREFERRED_GLINER_REVISION)
        self.assertEqual(snapshot.call_args.kwargs["allow_patterns"], list(warmup.REQUIRED_SNAPSHOT_FILES))

    def test_download_failure_does_not_report_success(self):
        snapshot = Mock(side_effect=RuntimeError("Échec réseau fictif"))
        warmup = self.load_warmup(snapshot)
        with patch.dict(sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot)}):
            self.assertFalse(warmup.download_gliner2_model(warmup.PREFERRED_GLINER_MODEL, "Modèle fictif"))
