"""Reference annotation for three fixed slices of EXEMPLE_URD_2023.

ANNOTATED BY CLAUDE, NOT BY THE USER. It encodes one explicit editorial rule that a
lawyer may want to overrule, so it must be reviewed before any of it is treated as
ground truth:

  * A *named, identifiable* body is an ORGANIZATION (FDA, EMA, Sofinnova Partners SAS).
  * A *generic institutional role* is not (Institutional Review Board, IBC, DSMB,
    "advisory committee", "Board of Directors").
  * Job titles are never PERSON ("Chief Executive Officer", "Chairman").
  * Products, clinical trials, genes, laws and standards are not entities
    (LUMEVOQ®, REVERSE, ND4, PDUFA, GMP).
  * Journals and publications are not organisations (Ophthalmology Therapy).

Recall is scored over DISTINCT entities, not occurrences: anonymisation substitutes by
string globally, so detecting an entity once is enough to redact every mention.
"""

GOLD = {
    "slice_A": {
        "PERSON": [],
        "ORGANIZATION": [
            "Exemple Biologics", "Exemple", "EMA", "FDA", "MHRA",
            "CAT", "Santhera",
        ],
        "LOCATION": ["Europe", "United States", "European Union", "France",
                     "United Kingdom", "UK"],
    },
    "slice_B": {
        "PERSON": [],
        "ORGANIZATION": [
            "FDA", "NIH", "NIH Office of Biotechnology Activities", "OBA", "RAC",
            "Exemple Biologics", "National Institute of Health",
        ],
        "LOCATION": ["U.S."],
    },
    "slice_C": {
        "PERSON": [
            "Paul Durand", "Philippe Thévenet", "Michael Kowalski", "Laura Martin",
            "Peter Goodwin", "Simone Sautter", "Maritza McAllister", "Elsy Bellini",
            "Françoise de Fontaine", "Natalie Moore", "Cédric Morel",
        ],
        "ORGANIZATION": [
            "Exemple Biologics", "Exemple Biologics France SAS",
            "Sofinnova Partners SAS", "AMF",
        ],
        "LOCATION": [],
    },
}

# Distinctive token used for relaxed matching of a person: a prediction counts as
# finding the person if it carries the surname ("Mr. Durand", "Durand", "Paul Durand").
PERSON_KEY = {
    "Paul Durand": "durand", "Philippe Thévenet": "thévenet", "Michael Kowalski": "kowalski",
    "Laura Martin": "martin", "Peter Goodwin": "goodwin",
    "Simone Sautter": "sautter", "Maritza McAllister": "mcallister",
    "Elsy Bellini": "bellini", "Françoise de Fontaine": "fontaine",
    "Natalie Moore": "moore", "Cédric Morel": "morel",
}
