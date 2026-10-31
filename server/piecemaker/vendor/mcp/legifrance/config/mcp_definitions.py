#/config/mcp_definitions.py 
#! MCP SERVEUR LOCAL
"""Définition des outils MCP disponibles"""

INITIALIZE_INSTRUCTIONS = (
    "Formule une seule requête à partir de la question de droit et reprends impérativement "
    "les termes choisis par l’utilisateur. N’ajoute ou ne substitue jamais un terme "
    "sémantiquement voisin sans avoir vérifié sa définition juridique. Par exemple, la "
    "résiliation d’un contrat, qui vaut pour l’avenir, ne se confond pas avec son annulation, "
    "qui produit un effet rétroactif. Tout contexte ajouté doit être juridiquement précis. "
    "Les guillemets recherchent une expression exacte ; ET exige les deux termes ; OU accepte "
    "une alternative ; les parenthèses regroupent les alternatives. Exemple : \"société anonyme\" "
    "ET \"révocation\" ET (\"dirigeant\" OU \"mandataire social\"). Si l’utilisateur indique "
    "un article, inclus-le obligatoirement dans la requête et adapte les dates de recherche à la "
    "version applicable de ce texte. Au-delà de 500 résultats, un avertissement signale le "
    "manque de contexte : resserre alors la requête. En cas d’incertitude sur les faits utiles ou le droit applicable, "
    "demande une clarification."
)

from tools.jurisprudence_search import (
    FAMILLES_PREMIER_DEGRE,
    JURIDICTIONS,
    MATIERES_CASSATION,
    PUBLICATIONS_CASSATION,
    PUBLICATIONS_RECUEIL,
    SIEGES_APPEL,
    SOURCES,
    VILLES_CAA,
)

QUERY_DESCRIPTION = "Requête unique, appliquée telle quelle à Légifrance et à Judilibre."

QUERY_PREMIERE_INSTANCE_DESCRIPTION = (
    "En première instance, sans `ET` ou `OU` explicite, les mots non entre guillemets "
    "sont reliés par `OU` afin d'élargir ce corpus limité."
)

FILTRES_RECHERCHE = {
    "sources": {
        "type": "array",
        "items": {"type": "string", "enum": SOURCES},
        "minItems": 1,
        "description": "Bases interrogées. Défaut : les deux. Judilibre ne couvre que l'ordre judiciaire."
    },
    "matiere": {
        "type": "array",
        "items": {"type": "string", "enum": list(MATIERES_CASSATION)},
        "minItems": 1,
        "description": "OBLIGATOIRE si `juridictions` contient cassation. Matière(s) de la question, appliquée(s) aux chambres de la Cour de cassation (Légifrance : CASSATION_FORMATION ; Judilibre : chamber). CIVIL (contrats, famille, immobilier, responsabilité civile), COMMERCIAL (sociétés, dirigeants, procédures collectives, concurrence), PENAL (chambre criminelle), SOCIAL (travail, sécurité sociale). Les formations transversales (assemblée plénière, chambre mixte, chambres réunies, avis) sont toujours incluses. N'énumérez les quatre que pour balayer volontairement toute la Cour."
    },
    "publication_cassation": {
        "type": "string",
        "enum": list(PUBLICATIONS_CASSATION),
        "default": "TOUS",
        "description": "Cour de cassation. PUBLIE = arrêts publiés au Bulletin ; INEDIT = non publiés."
    },
    "sieges_appel": {
        "type": "array",
        "items": {"type": "string", "enum": SIEGES_APPEL},
        "description": "Cour(s) d'appel ciblée(s) par ville. Sans valeur : toutes."
    },
    "types_premiere_instance": {
        "type": "array",
        "items": {"type": "string", "enum": list(FAMILLES_PREMIER_DEGRE)},
        "minItems": 1,
        "description": """OBLIGATOIRE si `juridictions` contient premiere_instance. A ce degre, c'est le nom de la juridiction qui porte la matiere.

Correspondance matiere -> famille:
- civil general: TRIBUNAL_JUDICIAIRE, TRIBUNAL_GRANDE_INSTANCE, TRIBUNAL_INSTANCE
- commercial: TRIBUNAL_COMMERCE
- social: CONSEIL_PRUDHOMMES, TRIBUNAL_SECURITE_SOCIALE
- penal: TRIBUNAL_CORRECTIONNEL
- baux ruraux: TRIBUNAL_BAUX_RURAUX
- petits litiges (juridictions et juges de proximite, supprimes en 2017): JURIDICTION_PROXIMITE
- Noumea, Papeete, Mamoudzou, Saint-Pierre: OUTRE_MER
- conflits de competence judiciaire/administratif: TRIBUNAL_CONFLITS

Chaque famille est etendue aux libelles reels de la facette Legifrance PREMIER_DEGRE_TYPE_JURIDICTION. Judilibre couvre TRIBUNAL_JUDICIAIRE et TRIBUNAL_COMMERCE."""
    },
    "villes_caa": {
        "type": "array",
        "items": {"type": "string", "enum": VILLES_CAA},
        "description": "Cour(s) administrative(s) d'appel ciblée(s) par ville. Sans valeur : toutes."
    },
    "publication_recueil": {
        "type": "string",
        "enum": PUBLICATIONS_RECUEIL,
        "default": "TOUS",
        "description": "Conseil d'État et CAA. PUBLIE = décisions publiées au recueil Lebon."
    }
}

INSTRUCTIONS_CONNEXION = (
    "Les identifiants PISTE sont absents : la recherche juridique n'est pas disponible. "
    "Propose à l'utilisateur de le guider avec l'outil `connexion`."
)

OUTIL_CONNEXION = {
    "name": "connexion",
    "description": """Connecte le serveur à Légifrance et JUDILIBRE avec des identifiants PISTE. Guide l'utilisateur étape par étape, une étape à la fois. PISTE est le portail officiel de l'État qui donne accès à ces bases. Le compte est gratuit.

Ne demande jamais le Client ID ni le Client Secret dans la conversation. Si l'utilisateur les colle quand même, dis-lui de ne pas le refaire et de les copier seulement dans le presse-papiers.

1. Créer le compte : https://piste.gouv.fr/registration
- Indiquer un nom et un e-mail. Cet e-mail sera l'identifiant.
- Choisir un mot de passe.
- Laisser « Code de l'organisation » vide : le compte est rattaché à « Universelle », qui donne accès à Légifrance et JUDILIBRE.
- Cocher « J'accepte les termes des CGU », passer la vérification, cliquer sur « S'inscrire ».
- Ouvrir l'e-mail PISTE, activer le compte, puis se connecter : https://piste.gouv.fr/se-connecter

2. Accepter les conditions d'utilisation : https://piste.gouv.fr/apimgt/consentement-cgu-api
- Dans « Recherche », taper Légifrance et cocher la ligne PROD.
- Recommencer avec JUDILIBRE et cocher sa ligne PROD.
- Cliquer sur « Valider mes choix CGU ».

3. Créer une application : https://piste.gouv.fr/apps
- Cliquer sur « Créer une application », laisser l'environnement PRODUCTION, puis valider.
- Renseigner au minimum un nom au choix, l'e-mail, le nom du cabinet et le nom du responsable.
- Dans « Sélectionner les API », cocher la colonne « Souscrite » pour JUDILIBRE et Légifrance. Si une case est grisée, revenir à l'étape 2.
- Enregistrer l'application.
- Ignorer l'application APP_SANDBOX_… créée automatiquement : ses identifiants ne fonctionnent pas avec les vraies bases.

4. Transmettre les identifiants par le presse-papiers
- Dans https://piste.gouv.fr/apps, ouvrir l'application créée, section « Identifiants Oauth ».
- Demander à l'utilisateur de copier le Client ID et de le confirmer, puis appeler cet outil avec etape=client_id.
- Demander à l'utilisateur de cliquer sur « Consulter le secret », de copier le Client Secret et de le confirmer, puis appeler cet outil avec etape=client_secret.

L'outil lit le presse-papiers de cet ordinateur, vérifie les identifiants auprès de PISTE et les enregistre dans un fichier local. Il ne renvoie jamais leur valeur. Après la connexion, les outils de recherche remplacent cet outil.""",
    "inputSchema": {
        "type": "object",
        "properties": {
            "etape": {
                "type": "string",
                "enum": ["client_id", "client_secret"],
                "description": "Identifiant que l'utilisateur vient de copier dans le presse-papiers."
            }
        },
        "required": ["etape"],
        "additionalProperties": False
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}
}

MCP_TOOLS = [
# ============================================================================
    # OUTILS RECHERCHE JURISPRUDENCE - VERSION OPTIMISÉE
    # ============================================================================
    {
        "name": "Search_Jurisprudence",
        "description": (
            "Outil unique de recherche jurisprudentielle : interroge en un appel Légifrance (fonds JURI "
            "et CETAT) et Judilibre (Cour de cassation, cours d'appel, tribunaux judiciaires et de "
            "commerce), applique les mêmes filtres et la même requête booléenne aux deux sources, puis "
            "fusionne les doublons (même juridiction, même date, même numéro). Légifrance n'a plus de "
            "décisions de cours d'appel depuis 2023 ni de première instance depuis 2024 : Judilibre "
            "les fournit. Le Conseil d'État et les CAA ne sont que dans Légifrance. Au-delà de 500 "
            "décisions après fusion des doublons, seules les 500 mieux classées sont rendues, avec un avertissement. Les résultats sont triés du plus récent au "
            "plus ancien ; `consulter_decision` lit ensuite un identifiant Légifrance ou Judilibre."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": f"{QUERY_DESCRIPTION} {QUERY_PREMIERE_INSTANCE_DESCRIPTION}"
                },
                "juridictions": {
                    "type": "array",
                    "items": {"type": "string", "enum": JURIDICTIONS},
                    "minItems": 1,
                    "description": "Juridictions interrogées ensemble. Défaut : cassation."
                },
                **FILTRES_RECHERCHE,
                "date_debut": {
                    "type": "string",
                    "description": "Date de décision minimale AAAA-MM-JJ. Défaut : 5 ans (cassation, Conseil d'État, première instance) ou 3 ans (cours d'appel, CAA)."
                },
                "date_fin": {
                    "type": "string",
                    "description": "Date de décision maximale AAAA-MM-JJ. Défaut : aujourd'hui."
                },
                "page_size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 10
                },
                "page_number": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 1
                }
            },
            "required": ["query", "juridictions"]
        }
    },
    {
        "name": "Search_Code",
        "description": "Recherche INTELLIGENTE dans les codes juridiques français (Code du travail, Code civil, etc.) avec parsing automatique des références d'articles et opérateurs logiques.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Requête Légifrance unique. Pour une référence d'article seule, "
                        "Search_Code cible le champ NUM_ARTICLE. Ajoute le nom du code si nécessaire, "
                        "par exemple : `752 code de procédure civile`."
                    )
                },
                "date": {
                    "type": "string",
                    "description": "Date de vigueur souhaitée au format YYYY-MM-DD (ex: '2020-01-15'). Par défaut, seuls les articles EN VIGUEUR aujourd'hui sont recherchés. Utilisez ce paramètre pour obtenir la version d'un article valable à une date passée."
                },
                "sort": {
                    "type": "string",
                    "enum": ["PERTINENCE", "DATE_VERSION_ASC", "DATE_VERSION_DESC"],
                    "default": "PERTINENCE",
                    "description": "Tri des résultats"
                },
                "page_size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 10,
                    "description": "Nombre de résultats par page"
                },
                "page_number": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 1,
                    "description": "Numéro de page"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "consulter_article",
        "description": "Consulte le texte intégral et les informations de vigueur d'une version précise d'article à partir de son identifiant officiel Légifrance LEGIARTI.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "article_id": {
                    "type": "string",
                    "pattern": "^LEGIARTI[0-9]+$",
                    "description": "Identifiant technique officiel de la version d'article, par exemple LEGIARTI000036762052. Cet identifiant est fourni par Search_Code."
                }
            },
            "required": ["article_id"]
        }
    },
        {
            "name": "consulter_decision",
            "description": "Texte intégral d'une décision : identifiant Légifrance (JURITEXT, CETATEXT) ou identifiant Judilibre (24 caractères hexadécimaux) rendu par Search_Jurisprudence.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text_id": {
                        "type": "string",
                        "description": "JURITEXT000006949246, CETATEXT000047444867 ou 65f1c2a8e4b0c0a1b2c3d4e5"
                    }
                },
                "required": ["text_id"]
            }
        },
    {
        "name": "Historique_Judiciaire",
        "description": (
            "Rend en un seul appel deux relevés distincts pour une décision, sans jamais les "
            "mélanger. 1° L'HISTORIQUE PROCÉDURAL STRICT : la décision attaquée, celle qu'elle "
            "attaquait, et les décisions qui attaquent une décision du fil. Chaque maillon repose "
            "exclusivement sur la métadonnée officielle « décision attaquée » (juridiction et date "
            "identiques) : aucun lien n'est déduit d'une citation. Les pourvois en cassation contre "
            "une décision sont obtenus par l'index inverse officiel de cette métadonnée "
            "(facettes CASSATION_DECISION_ATTAQUEE / LIEU_DECISION / DATE_DECISION_ATTAQUEE) : exact, "
            "mais résolu au seul couple juridiction + date — la métadonnée ne portant jamais de "
            "numéro, il ne distingue pas deux décisions de la même juridiction rendues le même jour. "
            "Le lien vers la décision attaquée d'un degré inférieur (premier degré → appel), lui, "
            "n'est pas indexé : il reste rapproché par une recherche bornée, que seule la métadonnée "
            "confirme ensuite. 2° LE RELEVÉ « CITÉE PAR » : toutes les décisions du fonds dont le "
            "texte reprend littéralement un numéro d'affaire de la décision de départ, avec la "
            "citation exacte et le lien Légifrance ; ce relevé recense sans rattacher — un précédent "
            "cité y figure comme un recours, et il revient au lecteur de trancher. Une décision "
            "attaquée nommée par les métadonnées mais absente de la base (jugements de première "
            "instance et beaucoup d'arrêts d'appel ne sont pas publiés) est déclarée non résolue, "
            "jamais devinée. Dans le fonds CETAT, la métadonnée « décision attaquée » n'est jamais "
            "renseignée : l'historique procédural d'une décision administrative y est vide par "
            "construction, seul le relevé « citée par » est exploitable. Un relevé tronqué par un "
            "plafond est signalé comme tel, afin qu'une absence ne soit jamais confondue avec une "
            "limite atteinte."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text_id": {
                    "type": "string",
                    "pattern": "^(JURITEXT|CETATEXT)[0-9]+$",
                    "description": (
                        "Identifiant officiel de la décision de départ : JURITEXT000047074185 "
                        "(ordre judiciaire) ou CETATEXT000047444867 (ordre administratif)."
                    )
                },
                "max_decisions": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 60,
                    "default": 20,
                    "description": "Nombre maximal de décisions retenues dans le fil."
                },
                "max_citations": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 200,
                    "default": 50,
                    "description": (
                        "Nombre maximal de décisions citantes relevées. 0 désactive le relevé "
                        "« citée par » et réserve le budget d'appels au fil procédural."
                    )
                },
                "max_api_calls": {
                    "type": "integer",
                    "minimum": 2,
                    "maximum": 600,
                    "default": 200,
                    "description": (
                        "Plafond d'appels API (recherches + consultations), fil procédural et "
                        "relevé des citations compris. Toute troncature par ce plafond est "
                        "signalée dans la télémétrie."
                    )
                }
            },
            "required": ["text_id"]
        }
    },
    # ============================================================================
    # TOOL 4 : TRACKING (BODACC)
    # ============================================================================
    {
        "name": "Tracking_BODACC",
        "description": "Search French BODACC for company situation with its SIREN number(procédure collective)",
        "inputSchema": {
            "type": "object",
            "properties": {
                "siren": {
                    "type": "string",
                    "description": "Numéro SIREN de l'entreprise (9 chiffres)"
                },
                "type_recherche": {
                    "type": "string",
                    "enum": ["complet", "procedures_collectives", "historique"],
                    "description": "Type de recherche à effectuer",
                    "default": "complet"
                }
            },
            "required": ["siren"]
        }
    },
    {
        "name": "dictionnaire_juridique",
        "description": (
            "Renvoie uniquement la définition d'un terme exact du lexique juridique officiel "
            "de justice.fr. À défaut de correspondance exacte, liste uniquement les intitulés "
            "du lexique qui contiennent tous les mots recherchés, sans leurs définitions. La "
            "casse et les accents sont ignorés. Aucun lien, compteur ou JSON n'est ajouté. Cet "
            "outil ne nécessite pas d'identifiants Légifrance."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "terme": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Terme juridique à rechercher dans les intitulés du lexique."
                }
            },
            "required": ["terme"],
            "additionalProperties": False
        }
    },

]

for _tool in MCP_TOOLS:
    _tool["annotations"] = {
        "readOnlyHint": True,
        "destructiveHint": False,
        "openWorldHint": True,
    }

# ============================================================================
# RESSOURCES MCP
# ============================================================================

MCP_RESOURCES = [
    {
        "uri": "resource://dictionnaire-juridique",
        "name": "Lexique API Légifrance",
        "description": "Définitions et terminologie des données de l’API Légifrance",
        "mimeType": "text/markdown"
    }
]


# ============================================================================
# MAPPING FILTRES PAR FOND
# ============================================================================
