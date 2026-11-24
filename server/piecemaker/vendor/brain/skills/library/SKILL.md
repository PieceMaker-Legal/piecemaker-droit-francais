---
name: library
description: Read and link the Library of the central agent (`<brain>/Library/okf/`, the firm's Legal-OKF bundle of templates and guidelines, plus generated clients/ and projects/). Use when drafting an act from a template, applying a guideline, or linking a case document (project) to the template or guideline it follows.
---

# Library

The Library is the firm's Legal-OKF bundle, cloned in `<brain>/Library/`. Enter by `okf/index.md`, index first, follow only the links you need.

| Folder | Content | Who writes |
| --- | --- | --- |
| `domains/`, `templates/`, `guidelines/` | Firm templates and drafting rules | The lawyer (Library view) |
| `clients/` | One sheet per client party of each case folder | Generated, read-only |
| `projects/` | One sheet per docx artifact of each case folder | Generated, except its `## Liens` section |

1. Never edit `clients/`, `projects/` index files or a generated sheet outside `## Liens`: the server rewrites them on every read.
2. Link a project as soon as you know which template or guideline it follows: add `- [Title](/templates/<slug>.md)` under `## Liens` of `projects/<sheet>.md`. One line per link, nothing else.
3. A template file in `assets/` is read-only: copy it to the case folder before filling it.
4. Clients keep their anonymised codes. Never look for a real identity.
