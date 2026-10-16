import json
import os
import tempfile
import unittest
from pathlib import Path


class ModelConfigTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.hub = Path(self.home.name) / "hub"
        os.environ["HF_HUB_CACHE"] = str(self.hub)
        import importlib
        import model_config
        importlib.reload(model_config)
        self.config = model_config

    def tearDown(self):
        self.home.cleanup()
        os.environ.pop("HF_HUB_CACHE", None)

    def test_checkpoint_matches_pinned_revision(self):
        checkpoint = json.loads(Path(self.config.__file__).with_name("gliner-checkpoint.json").read_text(encoding="utf-8"))
        self.assertEqual(self.config.PREFERRED_GLINER_MODEL, "fastino/gliner2-privacy-filter-PII-multi")
        self.assertEqual(self.config.PREFERRED_GLINER_REVISION, "59894c087cb2923b01f337d4ee72f6ff84d5bdd6")
        self.assertEqual(self.config.PREFERRED_GLINER_REVISION, checkpoint["revision"])
        self.assertEqual(len(self.config.PREFERRED_GLINER_REVISION), 40)
        self.assertIn("encoder_config/config.json", self.config.REQUIRED_SNAPSHOT_FILES)
        self.assertIn("tokenizer.json", self.config.REQUIRED_SNAPSHOT_FILES)

    def test_cached_only_when_every_pinned_file_is_present(self):
        snapshot = Path(self.config.gliner_snapshot_directory())
        self.assertFalse(self.config.is_model_cached(self.config.PREFERRED_GLINER_MODEL))
        for relative in self.config.REQUIRED_SNAPSHOT_FILES:
            path = snapshot / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("x", encoding="utf-8")
        self.assertTrue(self.config.is_model_cached(self.config.PREFERRED_GLINER_MODEL))
        (snapshot / "tokenizer.json").unlink()
        self.assertFalse(self.config.is_model_cached(self.config.PREFERRED_GLINER_MODEL))

    def test_refs_main_is_forty_ascii_bytes_without_newline(self):
        self.config.write_refs_main()
        refs = Path(self.config.model_repo_directory(self.config.PREFERRED_GLINER_MODEL)) / "refs" / "main"
        payload = refs.read_bytes()
        self.assertEqual(payload, self.config.PREFERRED_GLINER_REVISION.encode("ascii"))
        self.assertEqual(len(payload), 40)
        self.assertNotIn(b"\n", payload)


if __name__ == "__main__":
    unittest.main()
