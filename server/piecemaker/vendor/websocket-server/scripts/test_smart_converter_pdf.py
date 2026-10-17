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


if __name__ == "__main__":
    unittest.main()
