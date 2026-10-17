import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import smart_converter


class MixedPdfRoutingTests(unittest.TestCase):
    def test_pdf_with_a_scanned_page_uses_ocr_engine(self):
        class Page:
            def __init__(self, text):
                self.text = text

            def extract_text(self):
                return self.text

        class Reader:
            pages = [Page("Native text " * 8), Page("")]

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "mixed.pdf"
            source.write_bytes(b"pdf")
            with (
                mock.patch.object(smart_converter, "HAS_PYPDF2", True),
                mock.patch.object(smart_converter, "HAS_MARKITDOWN", True),
                mock.patch.object(smart_converter, "PyPDF2") as pypdf,
                mock.patch.object(smart_converter, "mineru_available", return_value=True),
            ):
                pypdf.PdfReader.return_value = Reader()
                engine, _ = smart_converter.inspect_file(str(source))

        self.assertEqual(engine, "mineru")


class FakeMinerUProcess:
    def __init__(self, stderr_lines, returncode):
        self.stderr = iter(stderr_lines)
        self.returncode = returncode

    def wait(self):
        return self.returncode


class MinerUFailureReasonTests(unittest.TestCase):
    def test_failure_line_carries_the_last_mineru_diagnostic(self):
        stderr_lines = [
            "VLM Predict:   0%|          | 0/1 [00:00<?, ?it/s]\n",
            "Conversion arrêtée : moins de 0,8 Go de mémoire libre sur le poste.\n",
        ]
        captured = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "exemple.pdf"
            source.write_bytes(b"pdf")
            with (
                mock.patch.object(smart_converter.subprocess, "Popen", return_value=FakeMinerUProcess(stderr_lines, 1)),
                mock.patch("sys.stderr", captured),
                self.assertRaises(SystemExit) as exit_context,
            ):
                smart_converter.run_mineru(source, directory)

        self.assertEqual(exit_context.exception.code, 1)
        self.assertIn(
            "❌ MinerU failed with exit code 1 : Conversion arrêtée : moins de 0,8 Go de mémoire libre sur le poste.",
            captured.getvalue(),
        )


if __name__ == "__main__":
    unittest.main()
