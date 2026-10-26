import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import convert_and_scan_pipeline as pipeline


FIRST_TEXT = "Piece fictive de Alice Martin. MARQUEUR-ALPHA-4471.\n"
SECOND_TEXT = "Piece fictive de Bruno Lefevre. MARQUEUR-BETA-9083.\n"


class HomonymMarkdownTests(unittest.TestCase):
    def setUp(self):
        environment = mock.patch.dict(os.environ, {"PYTHONUTF8": "1"})
        environment.start()
        self.addCleanup(environment.stop)

        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        root = Path(workspace.name)
        self.case_root = root / "dossier"
        self.output = root / "sortie"
        self.first = self.case_root / "a" / "exemple.txt"
        self.second = self.case_root / "b" / "exemple.txt"
        for source, text in ((self.first, FIRST_TEXT), (self.second, SECOND_TEXT)):
            source.parent.mkdir(parents=True)
            source.write_text(text, encoding="utf-8")

    def test_single_source_uses_stable_digest_name(self):
        names = pipeline.markdown_stems_for_batch([str(self.first)], str(self.case_root))
        self.assertEqual(names[str(self.first)], f"exemple-{pipeline._source_digest(str(self.first), str(self.case_root))}")

    def test_incremental_sources_keep_stable_distinct_names(self):
        first_name = pipeline.markdown_stems_for_batch([str(self.first)], str(self.case_root))[str(self.first)]
        second_name = pipeline.markdown_stems_for_batch([str(self.second)], str(self.case_root))[str(self.second)]
        together = pipeline.markdown_stems_for_batch([str(self.first), str(self.second)], str(self.case_root))

        self.assertEqual(together[str(self.first)], first_name)
        self.assertEqual(together[str(self.second)], second_name)
        self.assertNotEqual(first_name, second_name)

    def test_literal_digest_suffix_source_does_not_collide(self):
        first_name = pipeline.markdown_stems_for_batch([str(self.first)], str(self.case_root))[str(self.first)]
        literal = self.case_root / "c" / f"{first_name}.txt"
        literal.parent.mkdir(parents=True)
        literal.write_text("MARQUEUR-LITTERAL-3017", encoding="utf-8")
        names = pipeline.markdown_stems_for_batch([str(self.first), str(literal)], str(self.case_root))

        self.assertEqual(names[str(self.first)], first_name)
        self.assertNotEqual(names[str(literal)], first_name)

    def test_canonical_name_is_pinned_for_javascript_parity(self):
        source = self.case_root / "Pièces" / "a" / "exemple.docx"
        names = pipeline.markdown_stems_for_batch([str(source)], str(self.case_root))
        self.assertEqual(names[str(source)], "exemple-f746693ae66db90e")

    def test_homonyms_get_distinct_markdown_files_with_their_own_content(self):
        sources = [str(self.first), str(self.second)]
        names = pipeline.markdown_stems_for_batch(sources, str(self.case_root))
        self.assertNotEqual(names[sources[0]], names[sources[1]])

        markdown_to_source = {}
        for source in sources:
            success, md_path, _reason = pipeline.convert_file(
                source,
                str(self.output),
                engine="markitdown",
                output_name=names[source],
            )
            self.assertTrue(success, source)
            markdown_to_source[Path(md_path)] = source

        self.assertEqual(len(markdown_to_source), 2)
        self.assertEqual(
            sorted(path.name for path in self.output.glob("*.md")),
            sorted(f"{names[source]}.md" for source in sources),
        )

        expectations = {
            str(self.first): ("MARQUEUR-ALPHA-4471", "MARQUEUR-BETA-9083"),
            str(self.second): ("MARQUEUR-BETA-9083", "MARQUEUR-ALPHA-4471"),
        }
        for md_path, source in markdown_to_source.items():
            content = md_path.read_text(encoding="utf-8")
            own_marker, other_marker = expectations[source]
            self.assertIn(own_marker, content)
            self.assertNotIn(other_marker, content)
            self.assertEqual(md_path.name, f"{names[source]}.md")


if __name__ == "__main__":
    unittest.main()
