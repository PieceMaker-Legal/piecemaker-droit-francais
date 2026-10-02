r"""
Regex detectors for structured identifiers (stdlib only).

Port of the seven Presidio "generic" recognizers the scanner used (credit card, crypto,
e-mail, IBAN, IP, MAC, URL) together with the bits of Presidio's PatternRecognizer they
rely on: default regex flags, score raised to 1.0 when ``validate`` succeeds, result
dropped when ``validate`` fails or ``invalidate`` succeeds, and removal of results
contained in a higher-scored result of the same type. Patterns, scores and checksums are
unchanged; entity types and recognizer names are the ones Presidio produced
("EmailRecognizer", ...) because they end up in the JSON output.

Differences from the Presidio copy this replaces:
* ``regex`` -> ``re``. Their ``\w`` differs on combining marks (U+0300-036F, produced by
  NFD-normalised text): only ``regex`` counts them as word characters. The e-mail
  pattern, the one that matches letters of the person's name, adds that range back
  explicitly; the other patterns do not use ``\w`` (only ``\b``, see below).
  Superscripts and fractions (``²``, ``¹``, ``½``) are the reverse: ``re`` counts them as
  word characters, ``regex`` does not, so a footnote mark glued to a card number, IP or MAC
  address (no ``\b`` any more) now prevents the match, and one glued to an e-mail address ends
  up inside the detected span. Dotless i (U+0131) is case-folded to ``i`` by ``re`` but
  not by ``regex``. Measured on 30 000 random texts, these are the only differences besides
  the e-mail rule below.
* E-mail validation: Presidio kept an address only when ``tldextract`` found the domain's
  suffix in the Public Suffix List (a bundled snapshot when the network is down). The
  list is not available without that dependency, so ``_email_domain_is_valid`` only
  rejects a domain whose last label is purely numeric. Compared with ``tldextract`` this
  now KEEPS addresses on suffixes outside the list (``.local``, ``.corp``, ``.internal``,
  ``.test``, ``.invalid``, ``.co.zz``...) which are real addresses on intranets, and
  false positives such as ``image@2x.png``. Domains ending in digits (``a@b.123``,
  ``user@10.0.0.1``) are still rejected, as before. Keeping more is deliberate: a missed
  address is personal data left in clear, a spurious one is a harmless extra code.
* The URL recognizer never used ``tldextract`` (only a TLD alternation inside the regex),
  so its behaviour is unchanged. Duplicate TLDs of the original alternation are dropped
  (the alternation is otherwise identical and in the same order).
* Presidio's context words (``CONTEXT``) were never used by the scanner (no context
  enhancement is run) and are not ported; neither is the analysis explanation.
"""

import ipaddress
import re
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Callable, List, Optional, Tuple


@dataclass
class Detection:
    """One detected span. Attribute names are those the scanner reads downstream."""

    entity_type: str
    start: int
    end: int
    score: float
    recognition_metadata: dict = field(default_factory=dict)


# Presidio PatternRecognizer default.
_DEFAULT_FLAGS = re.DOTALL | re.MULTILINE | re.IGNORECASE


class PatternDetector:
    """Runs one entity type's regexes, then applies validation and de-duplication.

    ``patterns`` is a list of ``(regex, score)``. ``validate`` returns True (score becomes
    1.0) or False (result dropped); ``invalidate`` returns True to drop the result.
    """

    def __init__(
        self,
        name: str,
        entity_type: str,
        patterns: List[Tuple[str, float]],
        validate: Optional[Callable[[str], bool]] = None,
        invalidate: Optional[Callable[[str], bool]] = None,
        flags: int = _DEFAULT_FLAGS,
    ):
        self.name = name
        self.entity_type = entity_type
        self.supported_entities = [entity_type]
        self._patterns = [(re.compile(regex, flags), score) for regex, score in patterns]
        self._validate = validate
        self._invalidate = invalidate

    def _detection(self, start: int, end: int, score: float) -> Detection:
        return Detection(self.entity_type, start, end, score, {"recognizer_name": self.name})

    def analyze(self, text: str) -> List[Detection]:
        results = []
        for compiled, score in self._patterns:
            for match in compiled.finditer(text):
                start, end = match.span()
                if start == end:
                    continue
                matched = text[start:end]
                kept = score
                if self._validate is not None:
                    kept = 1.0 if self._validate(matched) else 0
                if self._invalidate is not None and self._invalidate(matched):
                    kept = 0
                if kept > 0:
                    results.append(self._detection(start, end, kept))
        return _remove_duplicates(results)


def _remove_duplicates(results: List[Detection]) -> List[Detection]:
    """Presidio's EntityRecognizer.remove_duplicates.

    Drops exact duplicates (same span, type and score) and any result contained in an
    already kept result of the same type; highest score first, then earliest, then longest.
    """
    unique = {(r.start, r.end, r.score, r.entity_type): r for r in results}
    ordered = sorted(unique.values(), key=lambda r: (-r.score, r.start, -(r.end - r.start)))
    kept: List[Detection] = []
    for r in ordered:
        if not any(
            r.start >= k.start and r.end <= k.end and r.entity_type == k.entity_type
            for k in kept
        ):
            kept.append(r)
    return kept


# ---------------------------------------------------------------------------
# Credit card
# ---------------------------------------------------------------------------

_CREDIT_CARD_PATTERNS = [
    (
        r"\b(?!1\d{12}(?!\d))((4\d{3})|(5[0-5]\d{2})|(6\d{3})|(1\d{3})|(3\d{3}))[- ]?(\d{3,4})[- ]?(\d{3,4})[- ]?(\d{3,5})\b",  # noqa: E501
        0.3,
    ),
]


def _is_valid_card(text: str) -> bool:
    """Luhn checksum, spaces and dashes ignored."""
    digits = [int(d) for d in text.replace("-", "").replace(" ", "")]
    checksum = sum(digits[-1::-2])
    for d in digits[-2::-2]:
        checksum += sum(int(c) for c in str(d * 2))
    return checksum % 10 == 0


# ---------------------------------------------------------------------------
# Crypto (Bitcoin: P2PKH / P2SH base58check, Bech32 / Bech32m)
# ---------------------------------------------------------------------------
# Validation algorithms: http://rosettacode.org/wiki/Bitcoin/address_validation#Python
# and https://github.com/sipa/bech32/blob/master/ref/python/segwit_addr.py

_CRYPTO_PATTERNS = [(r"(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,59}", 0.5)]

_BASE58 = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_BECH32_CONST = 1
_BECH32M_CONST = 0x2BC830A3


def _decode_base58(bc: bytes) -> bytes:
    origlen = len(bc)
    bc = bc.lstrip(_BASE58[0:1])
    n = 0
    for char in bc:
        n = n * 58 + _BASE58.index(char)  # ValueError on a character outside the alphabet
    return n.to_bytes(origlen - len(bc) + (n.bit_length() + 7) // 8, "big")


def _bech32_polymod(values: List[int]) -> int:
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def _is_valid_bech32(bech: str) -> bool:
    if any(ord(x) < 33 or ord(x) > 126 for x in bech) or (
        bech.lower() != bech and bech.upper() != bech
    ):
        return False
    bech = bech.lower()
    pos = bech.rfind("1")
    if pos < 1 or pos + 7 > len(bech) or len(bech) > 90:
        return False
    if not all(x in _BECH32_CHARSET for x in bech[pos + 1:]):
        return False
    hrp = bech[:pos]
    data = [_BECH32_CHARSET.find(x) for x in bech[pos + 1:]]
    expanded_hrp = [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]
    return _bech32_polymod(expanded_hrp + data) in (_BECH32_CONST, _BECH32M_CONST)


def _is_valid_crypto(text: str) -> bool:
    if text.startswith(("1", "3")):
        try:
            decoded = _decode_base58(text.encode())
        except ValueError:
            return False
        return decoded[-4:] == sha256(sha256(decoded[:-4]).digest()).digest()[:4]
    if text.startswith("bc1"):
        return _is_valid_bech32(text)
    return False


# ---------------------------------------------------------------------------
# E-mail
# ---------------------------------------------------------------------------
# \w plus the combining marks (see module docstring).
_W = r"\w\u0300-\u036f"
_EMAIL_PATTERNS = [
    (
        r"\b((([!#$%&'*+\-/=?^_`{|}~" + _W + r"])|([!#$%&'*+\-/=?^_`{|}~" + _W + r"]"
        r"[!#$%&'*+\-/=?^_`{|}~\." + _W + r"]{0,}[!#$%&'*+\-/=?^_`{|}~" + _W + r"]))[@]"
        r"[" + _W + r"]+([-.][" + _W + r"]+)*\.[" + _W + r"]+([-.][" + _W + r"]+)*)\b",
        0.5,
    ),
]


def _email_domain_is_valid(text: str) -> bool:
    """Replaces the tldextract check: only a purely numeric last label is rejected."""
    return not text.rpartition("@")[2].rpartition(".")[2].isdigit()


# ---------------------------------------------------------------------------
# IBAN
# ---------------------------------------------------------------------------

# Case-sensitive on purpose (Presidio passes DOTALL | MULTILINE only to this recognizer).
_IBAN_FLAGS = re.DOTALL | re.MULTILINE

# Trailing groups let the match fall back to a shorter span when the longest one fails
# validation ("DE89370400440532013000 2 days" -> keep the IBAN, drop " 2").
_IBAN_PATTERN = (
    r"(?<![A-Z0-9])([A-Z]{2}[0-9]{2}(?:[ -]?[A-Z0-9]{4}){2,6})"
    r"((?:[ -]?[A-Z0-9]{4})?)((?:[ -]?[A-Z0-9]{1,3})?)(?![A-Z0-9])"
)

# IBAN parts format (spaces are optional; the validated text has none anyway).
CK = "[0-9]{2}[ ]?"  # check digits
A = "[A-Z][ ]?"
A4 = "([A-Z][ ]?){4}"
C = "[a-zA-Z0-9][ ]?"
C2 = "([a-zA-Z0-9][ ]?){2}"
C3 = "([a-zA-Z0-9][ ]?){3}"
C4 = "([a-zA-Z0-9][ ]?){4}"
N = "[0-9][ ]?"
N2 = "([0-9][ ]?){2}"
N3 = "([0-9][ ]?){3}"
N4 = "([0-9][ ]?){4}"

# Per-country formats, from https://en.wikipedia.org/wiki/International_Bank_Account_Number
_IBAN_FORMAT_BY_COUNTRY = {
    # Albania (8n, 16c) ALkk bbbs sssx cccc cccc cccc cccc
    "AL": "(AL)" + CK + N4 + N4 + C4 + C4 + C4 + C4,
    # Andorra (8n, 12c) ADkk bbbb ssss cccc cccc cccc
    "AD": "(AD)" + CK + N4 + N4 + C4 + C4 + C4,
    # Austria (16n) ATkk bbbb bccc cccc cccc
    "AT": "(AT)" + CK + N4 + N4 + N4 + N4,
    # Azerbaijan    (4c,20n) AZkk bbbb cccc cccc cccc cccc cccc
    "AZ": "(AZ)" + CK + C4 + N4 + N4 + N4 + N4 + N4,
    # Bahrain   (4a,14c)    BHkk bbbb cccc cccc cccc cc
    "BH": "(BH)" + CK + A4 + C4 + C4 + C4 + C2,
    # Belarus (4c, 4n, 16c)   BYkk bbbb aaaa cccc cccc cccc cccc
    "BY": "(BY)" + CK + C4 + N4 + C4 + C4 + C4 + C4,
    # Belgium (12n)   BEkk bbbc cccc ccxx
    "BE": "(BE)" + CK + N4 + N4 + N4,
    # Bosnia and Herzegovina    (16n)   BAkk bbbs sscc cccc ccxx
    "BA": "(BA)" + CK + N4 + N4 + N4 + N4,
    # Brazil (23n,1a,1c) BRkk bbbb bbbb ssss sccc cccc ccct n
    "BR": "(BR)" + CK + N4 + N4 + N4 + N4 + N4 + N3 + A + C,
    # Bulgaria  (4a,6n,8c)  BGkk bbbb ssss ttcc cccc cc
    "BG": "(BG)" + CK + A4 + N4 + N + N + C2 + C4 + C2,
    # Costa Rica    (18n)   CRkk 0bbb cccc cccc cccc cc (0 = always zero)
    "CR": "(CR)" + CK + "[0]" + N3 + N4 + N4 + N4 + N2,
    # Croatia   (17n)   HRkk bbbb bbbc cccc cccc c
    "HR": "(HR)" + CK + N4 + N4 + N4 + N4 + N,
    # Cyprus    (8n,16c)    CYkk bbbs ssss cccc cccc cccc cccc
    "CY": "(CY)" + CK + N4 + N4 + C4 + C4 + C4 + C4,
    # Czech Republic    (20n)   CZkk bbbb ssss sscc cccc cccc
    "CZ": "(CZ)" + CK + N4 + N4 + N4 + N4 + N4,
    # Denmark   (14n)   DKkk bbbb cccc cccc cc
    "DK": "(DK)" + CK + N4 + N4 + N4 + N2,
    # Dominican Republic    (4a,20n)    DOkk bbbb cccc cccc cccc cccc cccc
    "DO": "(DO)" + CK + A4 + N4 + N4 + N4 + N4 + N4,
    # EAt Timor    (19n) TLkk bbbc cccc cccc cccc cxx
    "TL": "(TL)" + CK + N4 + N4 + N4 + N4 + N3,
    # Estonia   (16n) EEkk bbss cccc cccc cccx
    "EE": "(EE)" + CK + N4 + N4 + N4 + N4,
    # Faroe Islands    (14n) FOkk bbbb cccc cccc cx
    "FO": "(FO)" + CK + N4 + N4 + N4 + N2,
    # Finland   (14n) FIkk bbbb bbcc cccc cx
    "FI": "(FI)" + CK + N4 + N4 + N4 + N2,
    # France    (10n,11c,2n) FRkk bbbb bsss sscc cccc cccc cxx
    "FR": "(FR)" + CK + N4 + N4 + N2 + C2 + C4 + C4 + C + N2,
    # Georgia   (2c,16n)  GEkk bbcc cccc cccc cccc cc
    "GE": "(GE)" + CK + C2 + N2 + N4 + N4 + N4 + N2,
    # Germany   (18n) DEkk bbbb bbbb cccc cccc cc
    "DE": "(DE)" + CK + N4 + N4 + N4 + N4 + N2,
    # Gibraltar (4a,15c)  GIkk bbbb cccc cccc cccc ccc
    "GI": "(GI)" + CK + A4 + C4 + C4 + C4 + C3,
    # Greece    (7n,16c)  GRkk bbbs sssc cccc cccc cccc ccc
    "GR": "(GR)" + CK + N4 + N3 + C + C4 + C4 + C4 + C3,
    # Greenland     (14n) GLkk bbbb cccc cccc cc
    "GL": "(GL)" + CK + N4 + N4 + N4 + N2,
    # Guatemala (4c,20c)  GTkk bbbb mmtt cccc cccc cccc cccc
    "GT": "(GT)" + CK + C4 + C4 + C4 + C4 + C4 + C4,
    # Hungary   (24n) HUkk bbbs sssx cccc cccc cccc cccx
    "HU": "(HU)" + CK + N4 + N4 + N4 + N4 + N4 + N4,
    # Iceland   (22n) ISkk bbbb sscc cccc iiii iiii ii
    "IS": "(IS)" + CK + N4 + N4 + N4 + N4 + N4 + N2,
    # Ireland   (4c,14n)  IEkk aaaa bbbb bbcc cccc cc
    "IE": "(IE)" + CK + C4 + N4 + N4 + N4 + N2,
    # Israel (19n) ILkk bbbn nncc cccc cccc ccc
    "IL": "(IL)" + CK + N4 + N4 + N4 + N4 + N3,
    # Italy (1a,10n,12c)  ITkk xbbb bbss sssc cccc cccc ccc
    "IT": "(IT)" + CK + A + N3 + N4 + N3 + C + C3 + C + C4 + C3,
    # Jordan    (4a,22n)  JOkk bbbb ssss cccc cccc cccc cccc cc
    "JO": "(JO)" + CK + A4 + N4 + N4 + N4 + N4 + N4 + N2,
    # Kazakhstan    (3n,13c)  KZkk bbbc cccc cccc cccc
    "KZ": "(KZ)" + CK + N3 + C + C4 + C4 + C4,
    # Kosovo    (4n,10n,2n)   XKkk bbbb cccc cccc cccc
    "XK": "(XK)" + CK + N4 + N4 + N4 + N4,
    # Kuwait    (4a,22c)  KWkk bbbb cccc cccc cccc cccc cccc cc
    "KW": "(KW)" + CK + A4 + C4 + C4 + C4 + C4 + C4 + C2,
    # Latvia    (4a,13c)  LVkk bbbb cccc cccc cccc c
    "LV": "(LV)" + CK + A4 + C4 + C4 + C4 + C,
    # Lebanon   (4n,20c)  LBkk bbbb cccc cccc cccc cccc cccc
    "LB": "(LB)" + CK + N4 + C4 + C4 + C4 + C4 + C4,
    # LiechteNtein (5n,12c)  LIkk bbbb bccc cccc cccc c
    "LI": "(LI)" + CK + N4 + N + C3 + C4 + C4 + C,
    # Lithuania (16n) LTkk bbbb bccc cccc cccc
    "LT": "(LT)" + CK + N4 + N4 + N4 + N4,
    # Luxembourg    (3n,13c)  LUkk bbbc cccc cccc cccc
    "LU": "(LU)" + CK + N3 + C + C4 + C4 + C4,
    # Malta (4a,5n,18c)   MTkk bbbb ssss sccc cccc cccc cccc ccc
    "MT": "(MT)" + CK + A4 + N4 + N + C3 + C4 + C4 + C4 + C3,
    # Mauritania    (23n) MRkk bbbb bsss sscc cccc cccc cxx
    "MR": "(MR)" + CK + N4 + N4 + N4 + N4 + N4 + N3,
    # Mauritius (4a,19n,3a)   MUkk bbbb bbss cccc cccc cccc 000m mm
    "MU": "(MU)" + CK + A4 + N4 + N4 + N4 + N4 + N3 + A,
    # Moldova   (2c,18c)  MDkk bbcc cccc cccc cccc cccc
    "MD": "(MD)" + CK + C4 + C4 + C4 + C4 + C4,
    # Monaco    (10n,11c,2n)  MCkk bbbb bsss sscc cccc cccc cxx
    "MC": "(MC)" + CK + N4 + N4 + N2 + C2 + C4 + C4 + C + N2,
    # Montenegro    (18n) MEkk bbbc cccc cccc cccc xx
    "ME": "(ME)" + CK + N4 + N4 + N4 + N4 + N2,
    # Netherlands   (4a,10n)  NLkk bbbb cccc cccc cc
    "NL": "(NL)" + CK + A4 + N4 + N4 + N2,
    # North Macedonia   (3n,10c,2n)   MKkk bbbc cccc cccc cxx
    "MK": "(MK)" + CK + N3 + C + C4 + C4 + C + N2,
    # Norway    (11n) NOkk bbbb cccc ccx
    "NO": "(NO)" + CK + N4 + N4 + N3,
    # Pakistan  (4c,16n)  PKkk bbbb cccc cccc cccc cccc
    "PK": "(PK)" + CK + C4 + N4 + N4 + N4 + N4,
    # Palestinian territories   (4c,21n)  PSkk bbbb xxxx xxxx xccc cccc cccc c
    "PS": "(PS)" + CK + C4 + N4 + N4 + N4 + N4 + N,
    # Poland    (24n) PLkk bbbs sssx cccc cccc cccc cccc
    "PL": "(PL)" + CK + N4 + N4 + N4 + N4 + N4 + N4,
    # Portugal  (21n) PTkk bbbb ssss cccc cccc cccx x
    "PT": "(PT)" + CK + N4 + N4 + N4 + N4 + N,
    # Qatar (4a,21c)  QAkk bbbb cccc cccc cccc cccc cccc c
    "QA": "(QA)" + CK + A4 + C4 + C4 + C4 + C4 + C,
    # Romania   (4a,16c)  ROkk bbbb cccc cccc cccc cccc
    "RO": "(RO)" + CK + A4 + C4 + C4 + C4 + C4,
    # San Marino    (1a,10n,12c)  SMkk xbbb bbss sssc cccc cccc ccc
    "SM": "(SM)" + CK + A + N3 + N4 + N3 + C + C4 + C4 + C3,
    # Saudi Arabia  (2n,18c)  SAkk bbcc cccc cccc cccc cccc
    "SA": "(SA)" + CK + N2 + C2 + C4 + C4 + C4 + C4,
    # Serbia    (18n) RSkk bbbc cccc cccc cccc xx
    "RS": "(RS)" + CK + N4 + N4 + N4 + N4 + N2,
    # Slovakia  (20n) SKkk bbbb ssss sscc cccc cccc
    "SK": "(SK)" + CK + N4 + N4 + N4 + N4 + N4,
    # Slovenia  (15n) SIkk bbss sccc cccc cxx
    "SI": "(SI)" + CK + N4 + N4 + N4 + N3,
    # Spain (20n) ESkk bbbb ssss xxcc cccc cccc
    "ES": "(ES)" + CK + N4 + N4 + N4 + N4 + N4,
    # Sweden    (20n) SEkk bbbc cccc cccc cccc cccc
    "SE": "(SE)" + CK + N4 + N4 + N4 + N4 + N4,
    # Switzerland   (5n,12c)  CHkk bbbb bccc cccc cccc c
    "CH": "(CH)" + CK + N4 + N + C3 + C4 + C4 + C,
    # Tunisia   (20n) TNkk bbss sccc cccc cccc cccc
    "TN": "(TN)" + CK + N4 + N4 + N4 + N4 + N4,
    # Turkey    (5n,17c)  TRkk bbbb bxcc cccc cccc cccc cc
    "TR": "(TR)" + CK + N4 + N + C3 + C4 + C4 + C4 + C2,
    # United Arab Emirates  (3n,16n)  AEkk bbbc cccc cccc cccc ccc
    "AE": "(AE)" + CK + N4 + N4 + N4 + N4 + N3,
    # United Kingdom (4a,14n) GBkk bbbb ssss sscc cccc cc
    "GB": "(GB)" + CK + A4 + N4 + N4 + N4 + N2,
    # Vatican City  (3n,15n)  VAkk bbbc cccc cccc cccc cc
    "VA": "(VA)" + CK + N4 + N4 + N4 + N4 + N2,
    # Virgin Islands, British   (4c,16n)  VGkk bbbb cccc cccc cccc cccc
    "VG": "(VG)" + CK + C4 + N4 + N4 + N4 + N4,
}


_IBAN_DIGIT_VALUES = {
    ord(d): str(i) for i, d in enumerate("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
}


def _iban_check_digits(iban: str) -> str:
    """Check digits recomputed with the ISO 7064 mod 97-10 rule."""
    transformed = (iban[:2] + "00" + iban[4:]).upper()
    number = (transformed[4:] + transformed[:4]).translate(_IBAN_DIGIT_VALUES)
    return f"{98 - (int(number) % 97):0>2}"


def _is_valid_iban(text: str) -> bool:
    """Mod 97 checksum plus the country's format (prefix match, as in Presidio)."""
    iban = text.replace("-", "").replace(" ", "")
    try:
        if _iban_check_digits(iban) != iban[2:4]:
            return False
    except ValueError:  # a character outside 0-9A-Za-z
        return False
    country_format = _IBAN_FORMAT_BY_COUNTRY.get(iban[:2])
    return bool(country_format and re.match(country_format, iban, _IBAN_FLAGS))


class IbanDetector(PatternDetector):
    """IBAN needs its own loop: it tries the longest match first, then shorter ones."""

    def __init__(self):
        super().__init__("IbanRecognizer", "IBAN_CODE", [(_IBAN_PATTERN, 0.5)], flags=_IBAN_FLAGS)

    def analyze(self, text: str) -> List[Detection]:
        results = []
        for compiled, _ in self._patterns:
            for match in compiled.finditer(text):
                for group in (3, 2, 1):
                    start = match.start()
                    end = match.end(group) if match.end(group) > 0 else match.end()
                    if start == end:
                        continue
                    if _is_valid_iban(text[start:end]):
                        results.append(self._detection(start, end, 1.0))
                        break
        return results


# ---------------------------------------------------------------------------
# IP address
# ---------------------------------------------------------------------------

_IP_PATTERNS = [
    (
        r"\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",  # noqa: E501
        0.6,
    ),
    (
        r"\b(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\b",  # noqa: E501
        0.6,
    ),
    (r"::", 0.1),
]


def _is_invalid_ip(text: str) -> bool:
    try:
        ipaddress.ip_address(text)
    except ValueError:
        return True
    return False


# ---------------------------------------------------------------------------
# MAC address
# ---------------------------------------------------------------------------

_MAC_PATTERNS = [
    (r"\b[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b", 0.6),  # colon or hyphen
    (r"\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b", 0.6),  # Cisco dots
]


def _is_invalid_mac(text: str) -> bool:
    """Broadcast and all-zero addresses are rejected (the patterns already ensure 12 hex digits)."""
    return re.sub(r"[:\-.]", "", text).upper() in ("FFFFFFFFFFFF", "000000000000")


# ---------------------------------------------------------------------------
# URL (CommonRegex, https://github.com/madisonmay/CommonRegex, MIT, (c) 2014 Madison May)
# ---------------------------------------------------------------------------

_URL_TLDS = """
    com edu gov int mil net onl org pro red tel uno xxx academy accountant accountants actor
    adult africa agency airforce apartments app archi army art asia associates attorney
    auction audio auto autos baby band bar bargains beer berlin best bet bid bike bio black
    blackfriday blog blue boats bond boo boston bot boutique build builders business buzz
    cab cafe cam camera camp capital car cards care careers cars casa cash casino catering
    center ceo cfd charity chat cheap christmas church city claims cleaning click clinic
    clothing cloud club codes coffee college community company computer condos construction
    consulting contact contractors cooking cool coupons courses credit creditcard cricket
    cruises cyou dad dance date dating day degree delivery democrat dental dentist desi
    design dev diamonds diet digital direct directory discount doctor dog domains download
    earth eco education email energy engineer engineering enterprises equipment esq estate
    events exchange expert exposed express fail faith family fans farm fashion feedback film
    finance financial fish fishing fit fitness flights florist flowers football forsale
    foundation fun fund furniture futbol fyi gallery game games garden gay gdn gifts gives
    giving glass global gmbh gold golf graphics gratis green gripe group guide guitars guru
    hair hamburg haus health healthcare help hiphop hockey holdings holiday homes horse
    hospital host hosting house how icu info ink institute insure international investments
    irish jewelry jetzt juegos kaufen kids kitchen kiwi krd kyoto land lat law lawyer lease
    legal lgbt life lighting limited limo link live loan loans lol london love ltd ltda
    luxury maison management market marketing markets mba media melbourne meme memorial men
    miami mobi moda moe mom money monster mortgage motorcycles mov movie nagoya name navy
    network new news ngo ninja now nyc observer okinawa one ong online organic osaka page
    paris partners parts party pet phd photo photography photos pics pictures pink pizza
    place plumbing plus poker porn press productions prof promo properties property
    protection pub quest racing recipes rehab reise reisen rent rentals repair report
    republican rest restaurant review reviews rip rocks rodeo rsvp run saarland sale salon
    sarl sbs school schule science services sex sexy sh shoes shop shopping show singles
    site skin soccer social software solar solutions soy space spiegel study style sucks
    supply support surf surgery systems tax taxi team tech technology theater tips tires
    today tools top tours town toys trade training tube uk university vacations ventures vet
    video villas vin vip vision vlaanderen vodka vote voting voyage wales wang watch webcam
    website wedding wiki wine work works world wtf xyz yoga yokohama you zone ac ad ae af ag
    ai al am an ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bv
    bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec
    ee eg er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu
    gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp
    kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr
    ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm
    pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg si sj sk sl sm sn so sr st su sv
    sx sy sz tc td tf tg th tj tk tl tm tn to tp tr tt tv tw tz ua ug us uy uz va vc ve vg
    vi vn vu wf ws ye yt za zm zw
""".split()

_BASE_URL_REGEX = (
    r"((www\d{0,3}[.])?[a-z0-9.\-]+[.](?:" + "|".join(_URL_TLDS) + r")(?:/[^\s()<>\"']*)?)"
)
_URL_PATTERNS = [
    ("(?i)(?:https?://)" + _BASE_URL_REGEX, 0.6),  # standard
    ("(?i)" + _BASE_URL_REGEX, 0.5),  # no scheme
    (r'(?i)["\'](https?://' + _BASE_URL_REGEX + r')["\']', 0.6),  # quoted
    (r'(?i)["\'](' + _BASE_URL_REGEX + r')["\']', 0.5),  # quoted, no scheme
]


# ---------------------------------------------------------------------------
# Telephone (French numbering plan: 9 digits after the 0 / +33 prefix)
# ---------------------------------------------------------------------------
# No check digit exists, so the score is fixed. 1.0, like a validated identifier: the
# shape (prefix, exact length, bounds) is specific, and resolve_overlapping_spans breaks a
# same-length tie with GLiNER by score first, then by type (PERSON/ORGANIZATION/LOCATION
# rank before any other type). Anything below 1.0 would lose against a GLiNER span of the
# same length scoring higher; the phone is the better reading of those characters. A longer
# IBAN, SIRET, card or address containing the digits wins by length, whatever the score.
# Out of scope: numbers of other countries.

# Separators between pairs: space, dot, hyphen, no-break space, narrow no-break space.
_PHONE_SEP = r"[ .\-\u00a0\u202f]?"
_PHONE_PAIR = _PHONE_SEP + r"[0-9]{2}"
# Not inside a longer run of digits, not glued to a letter, an underscore or a "+".
_PHONE_START = r"(?<![\w+])"
_PHONE_END = r"(?!\w)"

_PHONE_PATTERNS = [
    # 06 12 34 56 78, 0612345678, 0262 12 34 56 (overseas national form, same plan)
    (_PHONE_START + r"0[1-9](?:" + _PHONE_PAIR + r"){4}" + _PHONE_END, 1.0),
    # +33 6 12 34 56 78, +33 (0)6 12 34 56 78, 0033 1 23 45 67 89
    (
        _PHONE_START + r"(?:\+|00)33" + _PHONE_SEP + r"(?:\(0\)" + _PHONE_SEP + r")?"
        r"[1-9]" + _PHONE_SEP + r"[0-9]{2}(?:" + _PHONE_PAIR + r"){3}" + _PHONE_END,
        1.0,
    ),
    # +262 262 12 34 56 (Réunion), +590 (Guadeloupe), +594 (Guyane), +596 (Martinique)
    (
        _PHONE_START + r"\+(?:262|590|594|596)" + _PHONE_SEP
        + r"[1-9][0-9]{2}(?:" + _PHONE_PAIR + r"){3}" + _PHONE_END,
        1.0,
    ),
]


# ---------------------------------------------------------------------------
# SIRET, SIREN, intra-community VAT number (French)
# ---------------------------------------------------------------------------
# Score 1.0 for all three, as for the phone number: a checksum (Luhn, VAT key) makes the
# shape specific, and the SIREN also requires a context word. The RCS number of a company
# IS its SIREN ("RCS Paris B 732 829 320"), so there is no RCS detector: the RCS context
# word is one of the SIREN's. The VAT number is detected because it spells out the SIREN
# (key + SIREN). A SIRET or VAT number contains a SIREN: the longer span wins in
# resolve_overlapping_spans, so the SIREN pattern firing inside them is harmless.
# Out of scope: VAT numbers with an alphanumeric key (old ones) and of other countries.

# Separators inside a number: space, dot, no-break space, narrow no-break space.
_ID_SEP = r"[ .\u00a0\u202f]?"
# Not inside a longer run of digits, not glued to a letter, an underscore or a "+".
_ID_START = r"(?<![\w+])"
_ID_END = r"(?!\w)"
_SIREN_NUMBER = r"[0-9]{3}" + _ID_SEP + r"[0-9]{3}" + _ID_SEP + r"[0-9]{3}"

_SIRET_PATTERNS = [(_ID_START + _SIREN_NUMBER + _ID_SEP + r"[0-9]{5}" + _ID_END, 0.5)]

# The SIREN must follow one of these words in the same sentence (no ". ", "? ", "! " or
# blank line in between), at most 80 characters away: Luhn lets one 9-digit number in ten
# through, and amounts ("123 456 789 euros") are 9-digit numbers too. A greffe letter and
# a city ("RCS Nanterre B 732 829 320", "registre du commerce et des sociétés de Paris
# sous le numéro 732 829 320") fit in the gap. "R.C.S." takes its final dot so that it
# does not read as the end of the sentence.
_SIREN_CONTEXT = (
    r"(?:\bSIRE[NT]\b|(?<!\w)R\.?C\.?S(?!\w)\.?|registre\s+du\s+commerce|immatricul[ée]e?s?"
    r"|num[ée]ro\s+unique\s+d['’]identification|(?<!\w)n\s?[°º]\s*d['’]identification)"
)
_SIREN_GAP = r"(?:(?![.!?](?:\s|$))(?!\n\s*\n).){0,80}?"
_SIREN_PATTERNS = [(_ID_START + _SIREN_NUMBER + _ID_END, 0.5)]
# The text before a candidate is checked for the context, anchored on the candidate: each
# number is judged on its own, whatever the other numbers around it.
_SIREN_CONTEXT_BEFORE = re.compile(_SIREN_CONTEXT + _SIREN_GAP + r"\Z", _DEFAULT_FLAGS)
_SIREN_CONTEXT_WINDOW = 150  # 80-character gap + the longest keyword

# "FR", 2-digit key, SIREN; spaces optional ("FR40732829320", "FR 40 732 829 320").
_VAT_SEP = r"[ \u00a0\u202f]?"
_VAT_PATTERNS = [
    (
        _ID_START + r"FR" + _VAT_SEP + r"[0-9]{2}" + _VAT_SEP + r"[0-9]{3}" + _VAT_SEP
        + r"[0-9]{3}" + _VAT_SEP + r"[0-9]{3}" + _ID_END,
        0.5,
    ),
]


def _digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def _is_valid_luhn_id(digits: str) -> bool:
    """Luhn (``_is_valid_card`` is the plain check); a run of zeros passes it, but is no number."""
    return int(digits) != 0 and _is_valid_card(digits)


def _is_valid_siren(text: str) -> bool:
    return _is_valid_luhn_id(_digits(text))


class SirenDetector(PatternDetector):
    """SIREN needs its own loop: a candidate counts only with a context word before it."""

    def __init__(self):
        super().__init__("FrSirenRecognizer", "SIREN", _SIREN_PATTERNS)

    def analyze(self, text: str) -> List[Detection]:
        results = []
        for compiled, _ in self._patterns:
            for match in compiled.finditer(text):
                start, end = match.span()
                if _is_valid_siren(match.group()) and _SIREN_CONTEXT_BEFORE.search(
                    text, max(0, start - _SIREN_CONTEXT_WINDOW), start
                ):
                    results.append(self._detection(start, end, 1.0))
        return results


def _is_valid_siret(text: str) -> bool:
    """Luhn on the 14 digits; La Poste (SIREN 356000000) instead needs a digit sum divisible by 5."""
    digits = _digits(text)
    if digits.startswith("356000000"):
        return sum(int(d) for d in digits) % 5 == 0
    return _is_valid_luhn_id(digits)


def _is_valid_vat(text: str) -> bool:
    """Key == (12 + 3 * (SIREN mod 97)) mod 97."""
    digits = _digits(text)
    return int(digits[:2]) == (12 + 3 * (int(digits[2:]) % 97)) % 97


# ---------------------------------------------------------------------------
# NIR (French social security number)
# ---------------------------------------------------------------------------
# 15 characters: sex, year, month, department (2 digits or 2A / 2B), commune, order, key.
# Score 1.0 after validation, as for the other identifiers: the key (97 - N mod 97) makes
# the shape specific, so no context word is required. A direct identifier (EDPB guidelines
# 01/2025), hence its own type. The month is not range-checked (fictitious months 20, 30-42,
# 50-99 exist). Sex digits: 1, 2 (born in France or abroad), 3, 4, 7, 8 (provisional
# numbers); 5, 6 and 9 are not personal numbers. The 13 digits cannot all be zero: the
# first one is not 0. A same-length CREDIT_CARD on the 15 contiguous digits (Luhn passes
# one time in ten) loses the tie through ``_TYPE_PRIORITY``; longer or shorter fragments
# (phone, SIREN, SIRET, card) lose by length or never fire in the grouped spellings.
# Out of scope: the 13-digit form without its key.

_NIR_PATTERNS = [
    (
        _ID_START + r"[1-478]" + _ID_SEP + r"[0-9]{2}" + _ID_SEP + r"[0-9]{2}" + _ID_SEP
        + r"(?:[0-9]{2}|2[AB])" + _ID_SEP + r"[0-9]{3}" + _ID_SEP + r"[0-9]{3}" + _ID_SEP
        + r"[0-9]{2}" + _ID_END,
        0.5,
    ),
]


def _is_valid_nir(text: str) -> bool:
    """Key == 97 - (N mod 97); in N, Corsica's 2A reads 19 and 2B reads 18 (INSEE rule)."""
    chars = re.sub(r"[ .\u00a0\u202f]", "", text).upper()
    number = int(chars[:13].replace("2A", "19").replace("2B", "18"))
    return int(chars[13:]) == 97 - number % 97


# ---------------------------------------------------------------------------
# Public factory
# ---------------------------------------------------------------------------

def build_detectors() -> List[PatternDetector]:
    """The seven ported detectors in their historical order, then the French ones."""
    return [
        PatternDetector("CreditCardRecognizer", "CREDIT_CARD", _CREDIT_CARD_PATTERNS,
                        validate=_is_valid_card),
        PatternDetector("CryptoRecognizer", "CRYPTO", _CRYPTO_PATTERNS,
                        validate=_is_valid_crypto),
        PatternDetector("EmailRecognizer", "EMAIL_ADDRESS", _EMAIL_PATTERNS,
                        validate=_email_domain_is_valid),
        IbanDetector(),
        PatternDetector("IpRecognizer", "IP_ADDRESS", _IP_PATTERNS,
                        invalidate=_is_invalid_ip),
        PatternDetector("MacAddressRecognizer", "MAC_ADDRESS", _MAC_PATTERNS,
                        invalidate=_is_invalid_mac),
        PatternDetector("UrlRecognizer", "URL", _URL_PATTERNS),
        PatternDetector("FrPhoneRecognizer", "TELEPHONE", _PHONE_PATTERNS),
        PatternDetector("FrSiretRecognizer", "SIRET", _SIRET_PATTERNS, validate=_is_valid_siret),
        SirenDetector(),
        PatternDetector("FrVatRecognizer", "TVA", _VAT_PATTERNS, validate=_is_valid_vat),
        PatternDetector("FrNirRecognizer", "NIR", _NIR_PATTERNS, validate=_is_valid_nir),
    ]
