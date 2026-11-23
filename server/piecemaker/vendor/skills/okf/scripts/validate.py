#!/usr/bin/env python3
"""Validate an Open Knowledge Format (OKF) bundle.

OKF v0.3 conformance (https://github.com/open-knowledge-format/open-knowledge-format,
SPEC.md §3.2/§4/§8; the Google Cloud repository is deprecated):
  1. Every non-reserved .md file that wants to be a concept begins with a
     parseable YAML frontmatter block containing a non-empty `type`.
  2. A .md file with no frontmatter (or no `type`) is not a concept: consumers
     skip it; it does not affect conformance.
  3. Reserved files follow their structure when present: index.md and log.md take
     no frontmatter; only the bundle-root index.md may carry frontmatter, and only
     to declare bundle metadata (okf_version, title, description, license).

These rules are the hard spec requirements; violating any of them is an ERROR.
Under --strict the validator additionally reports producer-quality LINTs:
  - broken links, links missing .md, orphan concepts, missing recommended fields
    (title/description);
  - malformed optional families (`generated`/`verified`/`sources`/`status`/
    `stale_after`, and `runtime` on `type: Attested Computation`) when present;
  - migration nudges for the fields v0.2 superseded (`timestamp` -> the
    `generated` family, body `# Citations` -> frontmatter `sources`);
  - LOF socle (Context-OKF house rule, auto-detected when the bundle is
    LOF-constructed, i.e. `fondations/lof.md` is present; see
    skills/okf/references/socle-lof-okf.md): the reference instantiation must
    carry the Foundry's own objects -- BFO, the Foundry, the six published
    patterns ODP-001..006 -- and every pattern or ontology concept carries its
    LOF source asset through `resource` (no link-only knowledge); the asset
    must exist in the bundle.
None of these are spec violations -- consumers MUST tolerate them -- but they
still fail the --strict gate (exit 1) so producers can keep a bundle tidy.

Usage:
    python validate.py <bundle-path>
    python validate.py <bundle-path> --strict

Exit code: 0 = conformant, 1 = errors (and, under --strict, any lints),
2 = bad invocation / PyYAML not installed.

Requires PyYAML for authoritative YAML parsing:  pip install pyyaml
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from okf_common import (
    FRONTMATTER_RE,
    extract_links,
    is_external,
    is_nonempty_string,
    normalize_verified,
    parse_frontmatter,
    parse_iso8601,
    path_part,
    resolve_link,
)

try:
    import yaml
except ImportError:
    yaml = None

RESERVED = {"index.md", "log.md"}
RECOMMENDED_FIELDS = ("title", "description")


def iter_markdown_files(root):
    return sorted(p for p in root.rglob("*.md") if p.is_file())


def _check_iso(msgs, label, value):
    if value is not None and parse_iso8601(value) is None:
        msgs.append(f"'{label}' is not a valid ISO 8601 datetime: {value!r}")


def _has_citations_heading(text):
    return any(line.strip() == "# Citations" for line in text.splitlines())


def v02_lints(data, text):
    """Producer-quality nudges for the optional OKF v0.2 families (spec §5, §10).

    Never spec violations: these families are optional and their absence is a
    plain, fully conformant v0.1-shaped concept.
    """
    msgs = []

    if "timestamp" in data and "generated" not in data:
        msgs.append("legacy 'timestamp' field present without 'generated'; "
                     "consider migrating to generated: {by, at} (OKF v0.2 §13.1)")
    if _has_citations_heading(text):
        msgs.append("body has a '# Citations' heading; OKF v0.2 moves provenance to "
                     "frontmatter 'sources' + footnote attribution (§13.1)")

    generated = data.get("generated")
    if isinstance(generated, dict):
        if not is_nonempty_string(generated.get("by")):
            msgs.append("'generated' is missing required 'by' (actor)")
        _check_iso(msgs, "generated.at", generated.get("at"))
    elif generated is not None:
        msgs.append("'generated' should be a mapping with 'by' and 'at'")

    for v in normalize_verified(data):
        if not is_nonempty_string(v.get("by")):
            msgs.append("a 'verified' entry is missing 'by' (actor)")
        _check_iso(msgs, "verified[].at", v.get("at"))

    sources = data.get("sources")
    if isinstance(sources, list):
        for i, src in enumerate(sources):
            if isinstance(src, dict):
                if not is_nonempty_string(src.get("resource")):
                    msgs.append(f"sources[{i}] is missing required 'resource'")
                _check_iso(msgs, f"sources[{i}].last_modified", src.get("last_modified"))
            else:
                msgs.append(f"sources[{i}] should be a mapping")
    elif sources is not None:
        msgs.append("'sources' should be a list of source entries")

    usage_window = data.get("usage_window")
    if isinstance(usage_window, dict):
        _check_iso(msgs, "usage_window.from", usage_window.get("from"))
        _check_iso(msgs, "usage_window.to", usage_window.get("to"))

    _check_iso(msgs, "stale_after", data.get("stale_after"))

    status = data.get("status")
    if status is not None and status not in ("draft", "stable", "deprecated"):
        msgs.append(f"'status' should be one of draft|stable|deprecated (found: {status!r})")

    if data.get("type") == "Attested Computation" and not is_nonempty_string(data.get("runtime")):
        msgs.append("type 'Attested Computation' is missing required 'runtime'")

    return msgs


# --- Socle LOF (Context-OKF house rule) -------------------------------------
# LOF is the rule base for CONSTRUCTING an OKF bundle, never content to embed
# (mapping: skills/okf/references/socle-lof-okf.md). These instantiation
# checks only run when the bundle is LOF-constructed (fondations/lof.md is
# present), so ordinary OKF bundles stay untouched.
LOF_MARKER = ("fondations", "lof.md")
LOF_REQUIRED = tuple(
    ["fondations/bfo.md", "fondations/lof.md"]
    + [f"patterns/odp-00{i}.md" for i in range(1, 7)]
)
LOF_SOURCE_GROUPS = ("patterns", "ontologies")


def lof_structure_lints(root, data_by_rel, paths_by_rel):
    """LOF structuring lints: mirror the Foundry, carry the sources.

    Every reference concept (BFO, the Foundry, the six published patterns)
    must exist, and every pattern/ontology concept must carry its LOF source
    asset through `resource`, resolving inside the bundle.
    """
    lints = []
    for req in LOF_REQUIRED:
        if req not in data_by_rel:
            lints.append((".", f"LOF structure: required LOF concept '{req[:-3]}' is missing"))
    for rel in sorted(data_by_rel):
        if rel.split("/", 1)[0] not in LOF_SOURCE_GROUPS:
            continue
        data = data_by_rel[rel]
        res = data.get("resource")
        if not is_nonempty_string(res):
            lints.append((rel, "LOF rule: missing 'resource' pointing at the LOF source asset"))
        elif is_external(res):
            lints.append((rel, "LOF rule: 'resource' must point at the vendored "
                               f"source asset, not an external URL ({res})"))
        else:
            target = resolve_link(path_part(res), paths_by_rel[rel], root)
            if not target.resolve().exists():
                lints.append((rel, f"LOF rule: 'resource' does not resolve in the bundle: {res}"))
    return lints


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate an Open Knowledge Format (OKF) bundle."
    )
    parser.add_argument("bundle", help="path to the OKF bundle directory")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also run producer-quality lint checks and fail (exit 1) on any lints",
    )
    args = parser.parse_args(argv)

    if yaml is None:
        print("error: PyYAML is required to validate OKF bundles. "
              "Install it with: pip install pyyaml", file=sys.stderr)
        return 2

    root = Path(args.bundle)
    if not root.is_dir():
        print(f"error: not a directory: {root}", file=sys.stderr)
        return 2

    errors = []
    lints = []
    # House rule (Context-OKF, also safe for Legal-OKF): files under assets/
    # are data, never concepts. Exclude them from concept checks, link checks
    # and orphan checks. Non-.md assets are already excluded by iter_markdown_files.
    files = [md for md in iter_markdown_files(root)
             if "assets" not in [p.name for p in md.relative_to(root).parents]]
    text_by_rel = {}
    data_by_rel = {}   # concept rel -> parsed frontmatter (LOF rule)
    paths_by_rel = {}  # concept rel -> Path (LOF rule)
    link_destinations = set()  # resolved .md paths referenced by non-log files

    # Pass 1: conformance (rules 1-3) + collect link destinations.
    for md in files:
        rel = md.relative_to(root).as_posix()
        try:
            text = md.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            errors.append((rel, "file is not valid UTF-8"))
            continue
        text_by_rel[rel] = text

        is_reserved = md.name in RESERVED
        is_root_index = md.name == "index.md" and md.parent == root

        if not is_reserved:
            data, err = parse_frontmatter(text)
            if err:
                errors.append((rel, err))
            elif not is_nonempty_string(data.get("type")):
                errors.append((rel, "frontmatter is missing a non-empty 'type' string"))
            else:
                data_by_rel[rel] = data
                paths_by_rel[rel] = md
                if args.strict:
                    for field in RECOMMENDED_FIELDS:
                        if not is_nonempty_string(data.get(field)):
                            lints.append((rel, f"missing recommended field '{field}'"))
                    for msg in v02_lints(data, text):
                        lints.append((rel, msg))
        elif FRONTMATTER_RE.match(text):
            # Rule 3: reserved files carry no frontmatter, except the bundle-root
            # index.md, which may declare only okf_version. Default error.
            if md.name == "log.md":
                errors.append((rel, "log.md must not carry a frontmatter block"))
            elif not is_root_index:
                errors.append((rel, "only the bundle-root index.md may carry frontmatter"))
            else:
                data, err = parse_frontmatter(text)
                if err:
                    errors.append((rel, f"root index.md frontmatter is invalid: {err}"))
                else:
                    allowed = {"okf_version"}
                    if (data or {}).get("okf_version") == "0.3":
                        # OKF v0.3 §8.1: bundle metadata in the root index.md.
                        allowed |= {"title", "description", "license"}
                    extra = [k for k in (data or {}) if k not in allowed]
                    if extra:
                        errors.append((rel, "root index.md frontmatter may only declare "
                                            f"okf_version, plus title/description/license "
                                            f"for v0.3 (found: {', '.join(extra)})"))
                    elif args.strict and "okf_version" in (data or {}):
                        # P3.10: if declared, okf_version should be a non-empty string.
                        if not is_nonempty_string(data.get("okf_version")):
                            lints.append((rel, "root index.md 'okf_version' should be a "
                                               "non-empty string"))

        if md.name != "log.md":  # historical log links are expected to dangle
            for target in extract_links(text):
                if is_external(target) or target.startswith("#"):
                    continue
                part = path_part(target)
                if part.endswith(".md"):
                    link_destinations.add(resolve_link(part, md, root).resolve())

    # Pass 2 (--strict only): links + orphans (producer-quality lints).
    if args.strict:
        for md in files:
            rel = md.relative_to(root).as_posix()
            text = text_by_rel.get(rel)
            if text is None:
                continue

            if md.name != "log.md":
                for target in extract_links(text):
                    if is_external(target) or target.startswith("#"):
                        continue
                    part = path_part(target)
                    if part.endswith(".md"):
                        # P0.2: resolve the same way the orphan set does so both
                        # passes agree on case-insensitive filesystems / with '..'.
                        if not resolve_link(part, md, root).resolve().exists():
                            lints.append((rel, f"broken link to '{target}'"))
                    elif part and not part.endswith("/") and (
                        part.startswith("/") or part.startswith("./") or part.startswith("../")
                    ):
                        last = part.rsplit("/", 1)[-1]
                        if "." not in last:
                            lints.append(
                                (rel, f"intra-bundle link '{target}' is missing the .md extension")
                            )

            if md.name not in RESERVED and md.resolve() not in link_destinations:
                lints.append(
                    (rel, "orphan concept: not reachable from any index.md or linked by any concept")
                )

        if not (root / "index.md").exists():
            lints.append((".", "bundle has no root index.md (recommended for navigation)"))

        # LOF structuring rule: only for LOF-mirrored bundles.
        if (root.joinpath(*LOF_MARKER)).is_file():
            for rel, msg in lof_structure_lints(root, data_by_rel, paths_by_rel):
                lints.append((rel, msg))

    for rel, msg in errors:
        print(f"ERROR  {rel}: {msg}")
    if args.strict:
        if lints:
            print("note: LINTs below are producer-quality lints, NOT spec violations; "
                  "consumers MUST tolerate them.")
        for rel, msg in lints:
            print(f"LINT   {rel}: {msg}")

    summary = f"{len(files)} file(s), {len(errors)} error(s)"
    if args.strict:
        summary += f", {len(lints)} lint(s)"
    print(summary)

    if errors:
        return 1
    if args.strict and lints:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
