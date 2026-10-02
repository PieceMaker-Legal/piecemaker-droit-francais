"""
Legal-form vocabulary and entity-text normalisation (stdlib only).

Shared by the scanner (scan_utils.py, which re-exports these names) and by the
pipeline (convert_and_scan_pipeline.py), which runs without presidio/GLiNER and
therefore must not import scan_utils. `legal-forms.cjs` mirrors `_LEGAL_FORMS`.
"""

import re
import unicodedata


# ---------------------------------------------------------------------------
# Entity text normalisation
# ---------------------------------------------------------------------------

_ZERO_WIDTH_RE = re.compile(r"[​‌‍﻿]")


def normalize_entity_text(text: str) -> str:
    """Canonical form of an entity string, used as the deduplication key.

    Conversion artefacts mean the same entity is written several ways — "Heights
    Capital", "Heights  Capital", "Heights\\nCapital". Keying on the raw substring
    makes those count as different entities and, downstream, gives the same company
    several anonymisation codes. Measured on ZETABIO_URD before normalisation:
    1273 "distinct" entities collapsing to 971 once normalised.

    Offsets are never touched — only the string used for identity and mapping.
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# Legal form extraction
# ---------------------------------------------------------------------------
# Replaces the previous zero-shot classify_text call, which asked a 221-label
# classifier to guess an organisation's legal form from a +-180 character window.
# Measured on 25 real contexts from ZETABIO_URD, that call cost 2 890 ms each
# (81 min for the document's 1 689 ORGANIZATION occurrences) and answered with forms
# like "Osakeyhtiö", "EIRELI", "No Liability" and "ANS" for French and American
# biotech companies — confident and wrong.
#
# A legal form is not a thing to infer: it is either written next to the name or it
# does not exist in the text. Measured on the same document, 11% of distinct
# organisation names carry one literally (63 of 576) and 89% carry none anywhere —
# for those the correct output is a plain ORGANIZATION, which is what the pipeline
# already falls back to. The proportion is document-type dependent and will be far
# higher on French filings ("ORBEX SA", "MARLOWE SA") than on an English URD.

# (canonical token, regex alternatives, nationality) — longest/most specific first,
# so SASU wins over SAS, SARL over SA, SELARL over SARL, SCIC over SCI, LLLP over
# LLP over LP. `_LEGAL_FORM_RE` is a single ordered alternation of named groups and
# Python's `re` is leftmost/first-alternative (not longest-match): the token that
# codes an organisation (`ORGANIZATION_<token>` → code `<token>_1`) is the first
# entry in this list whose pattern matches at the earliest position, so a more
# specific sigle must appear before the shorter one it contains.
#
# Coverage requested: French forms (commercial, civil, libéral, coopératif,
# agricole), plus the foreign forms a French firm meets in its files — British,
# American and German especially. The regex is case-sensitive (no re.IGNORECASE),
# which is deliberate: it keeps two-letter sigles (SA, SE, AG, KG, PA, CO…) from
# matching lowercase words, since a legal form is written in its canonical case.
_LEGAL_FORMS = [
    # ── France — exercice libéral (before SARL / SAS / SEL) ──
    ("SELARL", r"S\.?E\.?L\.?A\.?R\.?L\.?",                   "French"),
    ("SELAS",  r"S\.?E\.?L\.?A\.?S\.?",                       "French"),
    ("SELCA",  r"S\.?E\.?L\.?C\.?A\.?",                       "French"),
    ("SELCS",  r"S\.?E\.?L\.?C\.?S\.?",                       "French"),
    # ── France — commercial / civil / coopératif / agricole ──
    ("SASU",  r"S\.?A\.?S\.?U\.?",                            "French"),
    ("SARL",  r"S\.?A\.?R\.?L\.?",                            "French"),
    ("EURL",  r"E\.?U\.?R\.?L\.?",                            "French"),
    ("EARL",  r"E\.?A\.?R\.?L\.?",                            "French"),
    ("SCOP",  r"S\.?C\.?O\.?P\.?",                            "French"),
    ("SCIC",  r"S\.?C\.?I\.?C\.?",                            "French"),
    ("GAEC",  r"G\.?A\.?E\.?C\.?",                            "French"),
    ("SAS",   r"S\.?A\.?S\.?",                                "French"),
    ("SCI",   r"S\.?C\.?I\.?",                                "French"),  # société civile immobilière
    ("SCA",   r"S\.?C\.?A\.?",                                "French"),
    ("SCS",   r"S\.?C\.?S\.?",                                "French"),
    ("SCP",   r"S\.?C\.?P\.?",                                "French"),
    ("SCM",   r"S\.?C\.?M\.?",                                "French"),
    ("SNC",   r"S\.?N\.?C\.?",                                "French"),
    ("GIE",   r"G\.?I\.?E\.?",                                "French"),
    ("SLP",   r"S\.?L\.?P\.?",                                "French"),
    ("SEL",   r"S\.?E\.?L\.?",                                "French"),
    ("SEM",   r"S\.?E\.?M\.?",                                "French"),
    # ── Royaume-Uni ──
    ("EEIG",  r"E\.?E\.?I\.?G\.?",                            "British"),
    ("CIC",   r"C\.?I\.?C\.?",                                "British"),
    ("CIO",   r"C\.?I\.?O\.?",                                "British"),
    ("CLG",   r"C\.?L\.?G\.?",                                "British"),
    ("RTM",   r"R\.?T\.?M\.?",                                "British"),
    ("PLC",   r"P\.?L\.?C\.?|Public\s+Limited\s+Company",     "British"),
    ("LTD",   r"Ltd\.?|Limited",                              "British"),
    # ── États-Unis (LLLP > LLP > LP ; PLLC > PLC/LLC) ──
    ("LLLP",  r"L\.?L\.?L\.?P\.?",                            "American"),
    ("PLLC",  r"P\.?L\.?L\.?C\.?",                            "American"),
    ("LLC",   r"L\.?L\.?C\.?|Limited\s+Liability\s+Company",  "American"),
    ("LLP",   r"L\.?L\.?P\.?",                                "American"),
    ("INC",   r"Inc\.?|Incorporated",                         "American"),
    ("CORP",  r"Corp\.?|Corporation",                         "American"),
    ("LP",    r"L\.?P\.?",                                    "American"),
    ("GP",    r"G\.?P\.?",                                    "American"),
    ("PC",    r"P\.?C\.?",                                    "American"),
    ("PA",    r"P\.?A\.?",                                    "American"),
    ("CO",    r"Co\.?|Company",                               "American"),
    # ── Allemagne (gGmbH before GmbH ; KGaA before KG) ──
    ("PARTG", r"PartG\s?mbB|PartGmbB|PartG",                  "German"),
    ("GMBH",  r"gGmbH|GmbH|Gesellschaft\s+mit\s+beschränkter\s+Haftung", "German"),
    ("KGAA",  r"KGaA",                                        "German"),
    ("OHG",   r"OHG",                                         "German"),
    ("GBR",   r"GbR",                                         "German"),
    ("KG",    r"KG",                                          "German"),
    ("AG",    r"AG|Aktiengesellschaft",                       "German"),
    ("UG",    r"UG\s*\(haftungsbeschränkt\)|UG",              "German"),
    ("EG",    r"eG",                                          "German"),
    ("EK",    r"e\.?K\.?",                                    "German"),
    # ── Autres formes européennes / internationales ──
    ("SE",    r"SE|Societas\s+Europaea",                      "Other"),
    ("SA",    r"S\.?A\.?|Société\s+Anonyme",                 "French"),
    ("BV",    r"B\.?V\.?",                                    "Dutch"),
    ("NV",    r"N\.?V\.?",                                    "Dutch"),
    ("SPA",   r"S\.?p\.?A\.?",                                "Italian"),
    ("SRL",   r"S\.?r\.?l\.?",                                "Italian"),
    ("SL",    r"S\.?L\.?",                                    "Spanish"),
    ("LDA",   r"Lda\.?",                                      "Portuguese"),
    ("AB",    r"AB",                                          "Swedish"),
    ("OY",    r"Oyj|Oy",                                      "Finnish"),
    ("APS",   r"ApS",                                         "Danish"),
    ("AS",    r"A/S|ASA|AS",                                  "Norwegian"),
    ("PTYLTD", r"Pty\.?\s+Ltd\.?",                            "Other"),
    ("PVTLTD", r"Pvt\.?\s+Ltd\.?",                            "Other"),
]

_LEGAL_FORM_RE = re.compile(
    r"(?<![\w'’-])(?:"
    + "|".join(f"(?P<{token}>{pattern})" for token, pattern, _ in _LEGAL_FORMS)
    + r")(?![\w'’-])"
)

_FORM_NATIONALITY = {token: nationality for token, _, nationality in _LEGAL_FORMS}

# Trailing characters inspected after the entity when the name itself carries no form
# ("la société Donchéry, SARL au capital de ...").
_LEGAL_FORM_LOOKAHEAD = 30


def extract_legal_form(entity_text: str, trailing_context: str = ""):
    """Return ``(form_token, nationality)`` read literally from the text.

    ``(None, None)`` when no legal form is written — which is the common case and
    means the entity stays a plain ORGANIZATION.
    """
    for candidate in (normalize_entity_text(entity_text),
                      normalize_entity_text(trailing_context)[:_LEGAL_FORM_LOOKAHEAD]):
        if not candidate:
            continue
        match = _LEGAL_FORM_RE.search(candidate)
        if match and match.lastgroup:
            return match.lastgroup, _FORM_NATIONALITY.get(match.lastgroup)
    return None, None
