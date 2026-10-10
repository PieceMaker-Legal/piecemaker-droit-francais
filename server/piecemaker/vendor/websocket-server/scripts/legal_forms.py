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


# Phrases ignore case and folded accents. Short sigles stay case-sensitive, so "sa"
# is not SA. Overlapping matches keep the longest one: "limited liability company"
# is LLC, "société par actions simplifiée unipersonnelle" is SASU. Tokens are mirrored
# in legal-forms.cjs and party-codes.ts.

_WORDS_BEFORE = 8
_WORDS_AFTER = 6
_LEGAL_FORM_LOOKAHEAD = 120
_SEPARATOR_RE = re.compile(r"[\s,;:–—\-]*")
_WORD_RE = re.compile(r"\S+")
_ACCENT_FOLDS = {
    "à": "[àa]", "á": "[áa]", "â": "[âa]", "ä": "[äa]",
    "è": "[èe]", "é": "[ée]", "ê": "[êe]", "ë": "[ëe]",
    "ì": "[ìi]", "í": "[íi]", "î": "[îi]", "ï": "[ïi]",
    "ò": "[òo]", "ó": "[óo]", "ô": "[ôo]", "ö": "[öo]",
    "ù": "[ùu]", "ú": "[úu]", "û": "[ûu]", "ü": "[üu]",
    "ç": "[çc]", "ñ": "[ñn]", "ß": "(?:ß|ss)",
}
_APOSTROPHES = "'’‘"


def _dotted(letters: str) -> str:
    tight = r"\.?".join(letters)
    spaced = r"\.\s*".join(letters) + r"\.?"
    return f"{tight}|{spaced}"


def _phrase_pattern(phrase: str) -> str:
    parts = []
    for char in phrase:
        if char == " ":
            parts.append(r"\s+")
        elif char in _APOSTROPHES:
            parts.append("['’‘]")
        elif char in _ACCENT_FOLDS:
            parts.append(_ACCENT_FOLDS[char])
        else:
            parts.append(re.escape(char))
    return "(?i:" + "".join(parts) + ")"


_PHRASES = [
    ("SELAFA", "société d'exercice libéral à forme anonyme", "French"),
    ("SELASU", "société d'exercice libéral par actions simplifiée unipersonnelle", "French"),
    ("SELARL", "société d'exercice libéral à responsabilité limitée", "French"),
    ("SELAS", "société d'exercice libéral par actions simplifiée", "French"),
    ("SELCA", "société d'exercice libéral en commandite par actions", "French"),
    ("SELCS", "société d'exercice libéral en commandite simple", "French"),
    ("SEL", "société d'exercice libéral", "French"),
    ("SASU", "société par actions simplifiée unipersonnelle", "French"),
    ("SAS", "société par actions simplifiée", "French"),
    ("EURL", "entreprise unipersonnelle à responsabilité limitée", "French"),
    ("EARL", "exploitation agricole à responsabilité limitée", "French"),
    ("SCIC", "société coopérative d'intérêt collectif", "French"),
    ("SCOP", "société coopérative et participative", "French"),
    ("SCOP", "société coopérative ouvrière de production", "French"),
    ("GAEC", "groupement agricole d'exploitation en commun", "French"),
    ("SCPI", "société civile de placement immobilier", "French"),
    ("SICAV", "société d'investissement à capital variable", "French"),
    ("SCCV", "société civile de construction-vente", "French"),
    ("SCEA", "société civile d'exploitation agricole", "French"),
    ("GFA", "groupement foncier agricole", "French"),
    ("GFR", "groupement foncier rural", "French"),
    ("SPLA", "société publique locale d'aménagement", "French"),
    ("SEMOP", "société d'économie mixte à opération unique", "French"),
    ("SEM", "société d'économie mixte", "French"),
    ("SPL", "société publique locale", "French"),
    ("SCA", "société en commandite par actions", "French"),
    ("SCS", "société en commandite simple", "French"),
    ("SARL", "société à responsabilité limitée", "French"),
    ("SCI", "société civile immobilière", "French"),
    ("SNC", "société en nom collectif", "French"),
    ("GIE", "groupement d'intérêt économique", "French"),
    ("SLP", "société de libre partenariat", "French"),
    ("SCP", "société civile professionnelle", "French"),
    ("SCM", "société civile de moyens", "French"),
    ("SA", "société anonyme", "French"),
    ("SE", "société européenne", "Other"),
    ("SCE", "société coopérative européenne", "Other"),
    ("EEIG", "groupement européen d'intérêt économique", "British"),
    ("SPFPL", "société de participations financières de profession libérale", "French"),
    ("LLLP", "limited liability limited partnership", "American"),
    ("PLLC", "professional limited liability company", "American"),
    ("LLC", "limited liability company", "American"),
    ("LLP", "limited liability partnership", "British"),
    ("LP", "limited partnership", "American"),
    ("PLC", "public limited company", "British"),
    ("CLG", "company limited by guarantee", "British"),
    ("CIC", "community interest company", "British"),
    ("CIO", "charitable incorporated organisation", "British"),
    ("CIO", "charitable incorporated organization", "British"),
    ("LTD", "private limited company", "British"),
    ("LTD", "limited", "British"),
    ("INC", "incorporated", "American"),
    ("CORP", "corporation", "American"),
    ("PC", "professional corporation", "American"),
    ("PA", "professional association", "American"),
    ("EEIG", "european economic interest grouping", "British"),
    ("RTM", "right to manage company", "British"),
    ("GMBHCOKG", "gmbh und co. kg", "German"),
    ("GMBH", "gemeinnützige gesellschaft mit beschränkter haftung", "German"),
    ("GMBH", "gesellschaft mit beschränkter haftung", "German"),
    ("AG", "aktiengesellschaft", "German"),
    ("KGAA", "kommanditgesellschaft auf aktien", "German"),
    ("KG", "kommanditgesellschaft", "German"),
    ("OHG", "offene handelsgesellschaft", "German"),
    ("GBR", "gesellschaft bürgerlichen rechts", "German"),
    ("PARTG", "partnerschaftsgesellschaft mit beschränkter berufshaftung", "German"),
    ("PARTG", "partnerschaftsgesellschaft", "German"),
    ("UG", "unternehmergesellschaft", "German"),
    ("EG", "eingetragene genossenschaft", "German"),
    ("EK", "eingetragener kaufmann", "German"),
    ("EK", "eingetragene kauffrau", "German"),
    ("SE", "societas europaea", "Other"),
    ("SCE", "societas cooperativa europaea", "Other"),
    ("SA", "sociedad anónima", "Spanish"),
    ("SA", "sociedade anónima", "Portuguese"),
    ("SA", "sociedade anônima", "Portuguese"),
    ("SL", "sociedad de responsabilidad limitada", "Spanish"),
    ("SL", "sociedad limitada", "Spanish"),
    ("SPA", "società per azioni", "Italian"),
    ("SRL", "società a responsabilità limitata", "Italian"),
    ("BV", "besloten vennootschap", "Dutch"),
    ("NV", "naamloze vennootschap", "Dutch"),
    ("LDA", "sociedade por quotas", "Portuguese"),
    ("AB", "aktiebolag", "Swedish"),
    ("OY", "julkinen osakeyhtiö", "Finnish"),
    ("OY", "osakeyhtiö", "Finnish"),
    ("APS", "anpartsselskab", "Danish"),
    ("AS", "allmennaksjeselskap", "Norwegian"),
    ("AS", "aksjeselskab", "Norwegian"),
    ("AS", "aktieselskab", "Danish"),
    ("PTYLTD", "proprietary limited", "Other"),
    ("PVTLTD", "private limited", "Other"),
]

_RAW_PATTERNS = [
    ("GMBHCOKG", r"(?i:gmbh\s*(?:&|und)\s*co\.?\s*kg)", "German"),
    ("SARL", r"(?i:sàrl|s\.à\s*r\.l\.?)", "French"),
    ("PTYLTD", r"(?i:pty\.?\s+ltd\.?)", "Other"),
    ("PVTLTD", r"(?i:pvt\.?\s+ltd\.?)", "Other"),
]

_SIGLES = [
    ("SELAFA", _dotted("SELAFA"), "French"),
    ("SELASU", _dotted("SELASU"), "French"),
    ("SELARL", _dotted("SELARL"), "French"),
    ("SELCA", _dotted("SELCA"), "French"),
    ("SELCS", _dotted("SELCS"), "French"),
    ("SELAS", _dotted("SELAS"), "French"),
    ("SASU", _dotted("SASU"), "French"),
    ("SARLU", _dotted("SARLU"), "French"),
    ("SARL", _dotted("SARL"), "French"),
    ("EURL", _dotted("EURL"), "French"),
    ("EARL", _dotted("EARL"), "French"),
    ("SCOP", _dotted("SCOP"), "French"),
    ("SCIC", _dotted("SCIC"), "French"),
    ("GAEC", _dotted("GAEC"), "French"),
    ("SPFPL", _dotted("SPFPL"), "French"),
    ("SAS", _dotted("SAS"), "French"),
    ("SICAV", _dotted("SICAV"), "French"),
    ("SCCV", _dotted("SCCV"), "French"),
    ("SCEA", _dotted("SCEA"), "French"),
    ("SCPI", _dotted("SCPI"), "French"),
    ("SPLA", _dotted("SPLA"), "French"),
    ("SEMOP", _dotted("SEMOP"), "French"),
    ("SAU", _dotted("SAU"), "Spanish"),
    ("SLU", _dotted("SLU"), "Spanish"),
    ("SCI", _dotted("SCI"), "French"),
    ("SCA", _dotted("SCA"), "French"),
    ("SCS", _dotted("SCS"), "French"),
    ("SCP", _dotted("SCP"), "French"),
    ("SCM", _dotted("SCM"), "French"),
    ("SNC", _dotted("SNC"), "French"),
    ("GFA", _dotted("GFA"), "French"),
    ("GFR", _dotted("GFR"), "French"),
    ("GIE", _dotted("GIE"), "French"),
    ("SLP", _dotted("SLP"), "French"),
    ("SPL", _dotted("SPL"), "French"),
    ("SEL", _dotted("SEL"), "French"),
    ("SEM", _dotted("SEM"), "French"),
    ("SCE", _dotted("SCE"), "Other"),
    ("EEIG", _dotted("EEIG") + "|" + _dotted("GEIE"), "British"),
    ("CIC", _dotted("CIC"), "British"),
    ("CIO", _dotted("CIO"), "British"),
    ("CLG", _dotted("CLG"), "British"),
    ("RTM", _dotted("RTM"), "British"),
    ("PLC", _dotted("PLC"), "British"),
    ("LTD", _dotted("LTD") + r"|Ltd\.?", "British"),
    ("LLLP", _dotted("LLLP"), "American"),
    ("PLLC", _dotted("PLLC"), "American"),
    ("LLC", _dotted("LLC"), "American"),
    ("LLP", _dotted("LLP"), "American"),
    ("INC", _dotted("INC") + r"|Inc\.?", "American"),
    ("CORP", _dotted("CORP") + r"|Corp\.?", "American"),
    ("LP", _dotted("LP"), "American"),
    ("GP", _dotted("GP"), "American"),
    ("PC", _dotted("PC"), "American"),
    ("PA", _dotted("PA"), "American"),
    ("CO", r"Co\.?|CO", "American"),
    ("PARTG", r"(?i:partgmbb|partg\s?mbb|partg)", "German"),
    ("GMBH", r"(?i:ggmbh|gmbh)", "German"),
    ("KGAA", r"(?i:kgaa)", "German"),
    ("OHG", r"(?i:ohg)", "German"),
    ("GBR", r"(?i:gbr)", "German"),
    ("KG", r"KG", "German"),
    ("AG", r"AG", "German"),
    ("UG", r"UG\s*\(haftungsbeschränkt\)|UG", "German"),
    ("EG", r"eG", "German"),
    ("EK", r"e\.?K\.?", "German"),
    ("SE", r"SE", "Other"),
    ("SA", _dotted("SA"), "French"),
    ("BV", _dotted("BV"), "Dutch"),
    ("NV", _dotted("NV"), "Dutch"),
    ("SPA", _dotted("SPA") + r"|S\.?p\.?A\.?", "Italian"),
    ("SRL", _dotted("SRL") + r"|S\.?r\.?l\.?", "Italian"),
    ("SL", _dotted("SL"), "Spanish"),
    ("LDA", r"Lda\.?|LDA", "Portuguese"),
    ("AB", r"AB", "Swedish"),
    ("OY", r"Oyj|Oy", "Finnish"),
    ("APS", r"ApS", "Danish"),
    ("AS", r"A/S|ASA|AS", "Norwegian"),
]


def _build_legal_forms():
    ranked = [(len(phrase), token, _phrase_pattern(phrase), nationality) for token, phrase, nationality in _PHRASES]
    ranked.extend((len(pattern), token, pattern, nationality) for token, pattern, nationality in _RAW_PATTERNS)
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [(token, pattern, nationality) for _, token, pattern, nationality in ranked] + list(_SIGLES)


_LEGAL_FORMS = _build_legal_forms()
_FORM_NATIONALITY = {}
for _token, _pattern, _nationality in _LEGAL_FORMS:
    _FORM_NATIONALITY.setdefault(_token, _nationality)

_COMPILED_FORMS = [
    (token, re.compile(rf"(?<![\w'’-])(?:{pattern})(?![\w'’-])"))
    for token, pattern, _nationality in _LEGAL_FORMS
]
_LEGAL_FORM_RE = re.compile(
    r"(?<![\w'’-])(?:"
    + "|".join(pattern for _token, pattern, _nationality in _LEGAL_FORMS)
    + r")(?![\w'’-])"
)


def _matches(text: str):
    found = []
    for index, (token, compiled) in enumerate(_COMPILED_FORMS):
        for match in compiled.finditer(text):
            found.append((match.start(), -(match.end() - match.start()), index, match.end(), token))
    found.sort()
    kept = []
    covered_until = -1
    for start, _length, _index, end, token in found:
        if start < covered_until:
            continue
        kept.append((start, end, token))
        covered_until = end
    return kept


def _best_form(text: str):
    matches = _matches(text)
    return matches[0][2] if matches else None


def _strip_legal_forms(text: str) -> str:
    while True:
        matches = _matches(text)
        if not matches:
            return text
        start, end, _token = matches[0]
        text = f"{text[:start]} {text[end:]}"


def extract_legal_form(entity_text: str, trailing_context: str = ""):
    """Return ``(form_token, nationality)`` read literally from the text.

    ``(None, None)`` when no legal form is written.
    """
    for candidate in (normalize_entity_text(entity_text),
                      normalize_entity_text(trailing_context)[:_LEGAL_FORM_LOOKAHEAD]):
        if not candidate:
            continue
        token = _best_form(candidate)
        if token:
            return token, _FORM_NATIONALITY.get(token)
    return None, None


def company_key(text: str) -> str:
    """Comparison key with the legal form, accents, case and punctuation removed."""
    decomposed = unicodedata.normalize("NFKD", _strip_legal_forms(normalize_entity_text(text)))
    folded = "".join(char for char in decomposed if not unicodedata.combining(char)).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", folded).split())


def _window_bounds(source: str, start: int, end: int):
    before = source[max(0, start - 600):start]
    before_words = list(_WORD_RE.finditer(before))
    if before_words:
        window_start = max(0, start - 600) + before_words[max(0, len(before_words) - _WORDS_BEFORE)].start()
    else:
        window_start = start
    after = source[end:end + 600]
    after_words = list(_WORD_RE.finditer(after))
    if after_words:
        window_end = end + after_words[min(len(after_words), _WORDS_AFTER) - 1].end()
    else:
        window_end = end
    return window_start, window_end


def form_around_span(source: str, start: int, end: int):
    """Legal form written in the span, or in the words immediately before or after it."""
    if not source or not isinstance(start, int) or not isinstance(end, int):
        return None
    start = max(0, min(start, len(source)))
    end = max(start, min(end, len(source)))
    inside = list(dict.fromkeys(token for _start, _end, token in _matches(source[start:end])))
    if len(inside) == 1:
        return inside[0]
    if len(inside) > 1:
        return inside[-1]
    window_start, window_end = _window_bounds(source, start, end)
    adjacent = []
    for relative_start, relative_end, token in _matches(source[window_start:window_end]):
        absolute_start = window_start + relative_start
        absolute_end = window_start + relative_end
        before_gap = source[absolute_end:start]
        after_gap = source[end:absolute_start]
        if absolute_end <= start and _SEPARATOR_RE.fullmatch(before_gap or ""):
            adjacent.append(token)
        elif absolute_start >= end and _SEPARATOR_RE.fullmatch(after_gap or ""):
            adjacent.append(token)
    distinct = list(dict.fromkeys(adjacent))
    if len(distinct) == 1:
        return distinct[0]
    return None


def context_forms(corpus: str, mention: str):
    """Forms adjacent to each word-bounded hit of ``mention``. Empty when they disagree."""
    mention = normalize_entity_text(mention)
    if not corpus or len(mention) < 2:
        return []
    pattern = re.compile(rf"(?<![\w'’\-]){re.escape(mention)}(?![\w'’\-])")
    found = []
    for match in pattern.finditer(corpus):
        form = form_around_span(corpus, match.start(), match.end())
        if form and form not in found:
            found.append(form)
    return found


def _occurrence_form(entity: dict, corpora: dict, cache: dict):
    text = entity["text"]
    source = entity.get("source_file") or ""
    corpus = corpora.get(source) or ""
    start, end = entity.get("start"), entity.get("end")
    if corpus and isinstance(start, int) and isinstance(end, int) and 0 <= start <= end <= len(corpus):
        own = form_around_span(corpus, start, end)
        if own:
            return own
    if corpus:
        cache_key = (source, text)
        if cache_key not in cache:
            cache[cache_key] = context_forms(corpus, text)
        found = cache[cache_key]
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            return None
    return extract_legal_form(text)[0]


def cluster_indexes_by_stem(key_lists, forms):
    """Group indexes whose stems match, then split a group that carries two forms.

    Only an exact stem matches: "Calice International" stays apart from "Calice".
    Mentions with no form join the group only when the group has a single form.
    """
    count = len(key_lists)
    parent = list(range(count))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    owner = {}
    for index, keys in enumerate(key_lists):
        for key in keys:
            if not key:
                continue
            previous = owner.get(key)
            if previous is None:
                owner[key] = index
            else:
                union(index, previous)

    components = {}
    for index in range(count):
        components.setdefault(find(index), []).append(index)

    clusters = []
    for members in components.values():
        present = list(dict.fromkeys(forms[index] for index in members if forms[index]))
        if len(present) <= 1:
            clusters.append(members)
            continue
        clusters.extend([index for index in members if forms[index] == form] for form in present)
        formless = [index for index in members if not forms[index]]
        if formless:
            clusters.append(formless)
    return sorted(clusters, key=min)


def resolve_company_occurrences(occurrences, corpora=None):
    """Group company mentions, then read each mention's neighbouring words for its form.

    One agreed form keeps the variants together. Two forms split them into two
    legal entities. The returned dicts carry ``entity_type`` and ``legalForm``.
    """
    corpora = corpora or {}
    prepared = []
    for entity in occurrences or []:
        if not isinstance(entity, dict):
            continue
        text = normalize_entity_text(str(entity.get("text") or ""))
        if not text:
            continue
        prepared.append({
            "text": text,
            "start": entity.get("start"),
            "end": entity.get("end"),
            "source_file": entity.get("source_file") or "",
            "score": entity.get("score", 1.0),
            "recognizer": entity.get("recognizer", "unknown"),
        })
    if not prepared:
        return []

    cache = {}
    forms = [_occurrence_form(entity, corpora, cache) for entity in prepared]
    keys = []
    for entity in prepared:
        key = company_key(entity["text"])
        keys.append([key] if key else [])

    resolved = []
    for cluster in cluster_indexes_by_stem(keys, forms):
        texts = list(dict.fromkeys(prepared[index]["text"] for index in cluster))
        present = list(dict.fromkeys(forms[index] for index in cluster if forms[index]))
        form = present[0] if len(present) == 1 else None
        resolved.append({
            "text": max(texts, key=len),
            "variants": texts,
            "score": max(prepared[index]["score"] for index in cluster),
            "recognizer": prepared[cluster[0]]["recognizer"],
            "entity_type": f"ORGANIZATION_{form}" if form else "ORGANIZATION",
            "legalForm": form,
        })
    return resolved
