"""
Shared utilities for PII scanning scripts (presidio_scan.py, gliner2_presidio_scan.py).

Extracted from presidio_scan.py to avoid code duplication.
"""

import json
import os
import re
import sys
import warnings
from datetime import datetime, timezone
from typing import Dict, List

from pattern_detectors import Detection, build_detectors

# Legal-form vocabulary and entity normalisation live in legal_forms.py (stdlib only,
# shared with the pipeline); re-exported here so existing imports keep working.
from legal_forms import (  # noqa: E402,F401
    _FORM_NATIONALITY,
    _LEGAL_FORM_LOOKAHEAD,
    _LEGAL_FORM_RE,
    _LEGAL_FORMS,
    _ZERO_WIDTH_RE,
    extract_legal_form,
    normalize_entity_text,
)

_CORPORATE_SUFFIXES_RE = re.compile(
    r'\b(?:SELARL|SELAS|SELCA|SELCS|SASU|SARL|EURL|EARL|SCOP|SCIC|GAEC'
    r'|SAS|SCI|SCA|SCS|SCP|SCM|SNC|SCR|GIE|SLP|SEL|SEM|SA|SE'
    r'|EEIG|CIC|CIO|CLG|RTM|Ltd|Limited|PLC'
    r'|LLLP|PLLC|LLC|LLP|Inc|Corp|LP|GP|PC'
    r'|gGmbH|GmbH|KGaA|PartG|OHG|GbR|KG|AG|UG'
    r'|NV|BV|SpA|Srl|Lda|ApS)\b',
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Span arbitration
# ---------------------------------------------------------------------------

# Preference when two spans of different types cover the same characters. A name is
# more specific than the organisation it belongs to, which is more specific than the
# place it sits in. A 14-digit SIRET that also passes Luhn is a valid CREDIT_CARD on the
# very same span, at the same length and score: SIRET ranks just after those three, so it
# wins that tie (and only that one: every other type keeps sharing the last rank, below
# SIRET, which no other detector can match on an identical span).
_TYPE_PRIORITY = {
    "PERSON": 0,
    "ORGANIZATION": 1,
    "LOCATION": 2,
    "SIRET": 3,
}


def _type_rank(entity_type: str) -> int:
    if entity_type in _TYPE_PRIORITY:
        return _TYPE_PRIORITY[entity_type]
    if entity_type.startswith("ORGANIZATION_"):
        return _TYPE_PRIORITY["ORGANIZATION"]
    return len(_TYPE_PRIORITY)


def resolve_overlapping_spans(results: List[Detection]) -> List[Detection]:
    """Keep one entity per stretch of text, whatever the types involved.

    The detectors' own de-duplication (``pattern_detectors._remove_duplicates``) only
    drops a contained span when the two results share an ``entity_type``. Cross-type overlaps therefore survive: measured
    on ZETABIO_URD, 81 spans carried two types at once and 179 pairs overlapped —
    including LOCATION "French" nested inside ORGANIZATION "French Monetary and
    Financial Code". Since anonymisation substitutes entity strings one after the
    other, the inner span rewrites part of the outer one and corrupts the output.

    Resolution order: longest span wins, then highest score, then type priority.
    """
    ranked = sorted(
        (r for r in results if r.score > 0),
        key=lambda r: (-(r.end - r.start), -r.score, _type_rank(r.entity_type), r.start),
    )

    kept: List[Detection] = []
    for candidate in ranked:
        if any(candidate.start < k.end and k.start < candidate.end for k in kept):
            continue
        kept.append(candidate)

    return sorted(kept, key=lambda r: r.start)




# ---------------------------------------------------------------------------
# NER score adjustment heuristics
# ---------------------------------------------------------------------------

def adjust_ner_scores(results: List[Detection], text: str) -> List[Detection]:
    """Adjust NER scores: penalize likely-false PERSON, rescue high-quality ORGANIZATION."""
    for r in results:
        entity_text = text[r.start:r.end]

        if r.entity_type == "PERSON":
            if len(entity_text) <= 2:
                r.score = 0.0
                continue
            if entity_text.isupper() and len(entity_text) > 3:
                r.score *= 0.3
            if ' ' not in entity_text.strip():
                r.score *= 0.6

        elif r.entity_type == "ORGANIZATION":
            if len(entity_text) <= 3:
                r.score = 0.0
                continue
            if entity_text.isupper():
                r.score = 0.0
                continue

            is_multi_word = ' ' in entity_text.strip()
            context_window = text[r.end:r.end + 30]
            has_suffix = bool(_CORPORATE_SUFFIXES_RE.search(context_window))

            if is_multi_word or has_suffix:
                r.score = 0.85

    return results


# ---------------------------------------------------------------------------
# Pattern recognizer factory
# ---------------------------------------------------------------------------

def build_pattern_recognizers() -> list:
    """Instantiate the regex detectors (see pattern_detectors.py)."""
    return build_detectors()


# Words that make a dotted quad plausibly an actual address rather than a heading number.
_NETWORK_CONTEXT_RE = re.compile(
    r"\b(?:ip|adresse ip|address|serveur|server|host|hôte|réseau|network|dns|gateway"
    r"|passerelle|subnet|masque|port|ping|tcp|udp|localhost)\b",
    re.IGNORECASE,
)
_DOTTED_QUAD_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")

# A bare domain is only credible with a recognisable TLD; conversion glues sentences
# together ("…in 2023. The…" → "2023.Th") and those look like domains otherwise.
_PLAUSIBLE_TLD_RE = re.compile(
    r"\.(?:com|org|net|edu|gov|int|eu|fr|be|ch|lu|uk|de|es|it|nl|pt|ca|us|io|co|info"
    r"|biz|dev|app|ai|legal|law|gouv|europa)(?:$|[/:?#])",
    re.IGNORECASE,
)


def _is_plausible_ip(entity_text: str, text: str, start: int, end: int) -> bool:
    """Reject document section numbers matched as IPv4 addresses.

    Measured on ZETABIO_URD: 31 of 31 distinct IP_ADDRESS hits were heading numbers
    ("3.7.2.2", "13.1.1.2", "19.1.5.2"). Anonymising those rewrites every cross
    reference in the document.

    Heuristic: a dotted quad whose every octet is <= 31 reads like a section number
    unless networking vocabulary sits nearby. This deliberately trades a rare true
    positive (private ranges such as 10.0.0.1 stated without context) for the far more
    common false positive in legal and financial documents.
    """
    if not _DOTTED_QUAD_RE.match(entity_text):
        return True

    octets = [int(o) for o in entity_text.split(".")]
    if any(o > 31 for o in octets):
        return True

    window = text[max(0, start - 60): min(len(text), end + 60)]
    return bool(_NETWORK_CONTEXT_RE.search(window))


def _is_plausible_url(entity_text: str) -> bool:
    """Reject sentence fragments glued into pseudo-domains ("2023.Th", "occur.Th")."""
    lowered = entity_text.lower()
    if lowered.startswith(("http://", "https://", "www.")):
        return True
    if "/" in entity_text:
        return True
    return bool(_PLAUSIBLE_TLD_RE.search(lowered))


def _pattern_result_is_plausible(result: Detection, text: str) -> bool:
    entity_text = text[result.start:result.end]
    if result.entity_type == "IP_ADDRESS":
        return _is_plausible_ip(entity_text, text, result.start, result.end)
    if result.entity_type == "URL":
        return _is_plausible_url(entity_text)
    return True


def run_pattern_recognizers(text: str, recognizers: list) -> List[Detection]:
    """Run all pattern recognizers on *text* and return combined results.

    Results are filtered for the false-positive classes these recognizers are known to
    produce on converted documents (see _is_plausible_ip / _is_plausible_url).
    """
    all_results: List[Detection] = []
    for rec in recognizers:
        try:
            results = rec.analyze(text)
            all_results.extend(
                r for r in results if _pattern_result_is_plausible(r, text)
            )
        except Exception as exc:  # noqa: BLE001
            warnings.warn(f"[pattern] {rec.name} raised: {exc}", stacklevel=2)
    return all_results


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def build_output_payload(
    results: List[Detection],
    text: str,
    source_file: str,
    extra_summary: Dict = None,
) -> dict:
    """Build the JSON entity-map payload from a list of Detection."""
    entities_map: Dict[str, list] = {}
    for r in results:
        # The mapping is keyed by entity string downstream, so store the normalised
        # form — a raw substring carrying a hard line break would never match the
        # document again. Offsets stay as detected.
        entities_map.setdefault(r.entity_type, []).append({
            "text": normalize_entity_text(text[r.start:r.end]),
            "start": r.start,
            "end": r.end,
            "score": r.score,
            "recognizer": r.recognition_metadata.get("recognizer_name", "unknown")
            if r.recognition_metadata else "unknown",
        })

    summary = {
        "total_entities_found": len(results),
        "entity_types": list(entities_map.keys()),
    }
    if extra_summary:
        summary.update(extra_summary)

    return {
        "source_file": os.path.abspath(source_file),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "entities": entities_map,
        "summary": summary,
    }


def print_summary(entities_map: dict, source_file: str, output_path: str) -> None:
    """Print a summary table to stdout."""
    total = sum(len(hits) for hits in entities_map.values())
    print(f"Scanned : {source_file}")
    print(f"Output  : {output_path}")
    print(f"{'Entity type':<25} {'Count':>5}")
    print("-" * 32)
    for etype, hits in sorted(entities_map.items()):
        print(f"{etype:<25} {len(hits):>5}")
    print("-" * 32)
    print(f"{'TOTAL':<25} {total:>5}")


# ---------------------------------------------------------------------------
# CLI validation
# ---------------------------------------------------------------------------

def validate_md_input(md_file: str) -> bool:
    """Validate that *md_file* is a readable .md file. Prints errors to stderr.

    Returns True if valid, False otherwise.
    """
    if not md_file.lower().endswith(".md"):
        print("ERROR: Le fichier doit être un fichier Markdown (.md)", file=sys.stderr)
        return False

    if not os.path.isfile(md_file):
        print(f"ERROR: Fichier non trouvé: {md_file}", file=sys.stderr)
        return False

    return True
