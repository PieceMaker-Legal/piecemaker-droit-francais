/**
 * Translation keys PieceMaker adds on top of CloudCLI, as opposed to the wording
 * overrides under `overrides/`.
 *
 * Kept hand-written and separate on purpose: `scripts/piecemaker/generate-i18n-overrides.mjs`
 * rewrites `overrides/` wholesale from the upstream locales, so a key that has no upstream
 * counterpart could not survive there.
 *
 * Two kinds of additions live here:
 * - The workspace tab label (`common.tabs.dossier`), translated for every locale.
 * - The `addons` namespace, covering every PieceMaker-authored `src/piecemaker/addons/`
 *   component. It is `fr`-only for now: it externalizes today's French wording so the
 *   feature stops hardcoding literals, without yet translating it into the other locales.
 *   The panel itself is written in French, like the PieceMaker administration UI it comes
 *   from: it drives French-law procedure, and its vocabulary (bordereau, pièce, tampon) has
 *   no settled equivalent in the other locales.
 */

type AdditionBundles = Record<string, Record<string, Record<string, unknown>>>;

const addonsFr = {
  common: {
    retry: 'Réessayer',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    close: 'Fermer',
    open: 'Ouvrir',
    useInSession: 'Utiliser dans la session',
    library: 'Bibliothèque',
    libraryBreadcrumb: 'Fil d’Ariane de la bibliothèque',
    loadingLibrary: 'Chargement de la bibliothèque…',
    loadingWorkflows: 'Chargement des workflows…',
    noWorkflows: 'Aucun workflow disponible.',
    noWorkflowsMatch: 'Aucun workflow ne correspond à ces filtres.',
    noSearchResults: 'Aucun résultat pour cette recherche.',
    noDocumentsInFolder: 'Aucun document dans ce dossier.',
    partialResults: 'Affichage partiel — affinez la recherche.',
    searchDocumentPlaceholder: 'Rechercher un document…',
    searchWorkflowPlaceholder: 'Rechercher un workflow…',
    typeAssistant: 'Assistant',
    typeTabular: 'Tabulaire',
  },
  nav: {
    sidebarLabel: 'Espaces PieceMaker',
    library: 'Library',
    tabularReview: 'Tabular review',
    workflows: 'Workflows',
    organisation: 'Organisation',
  },
  viewer: {
    workspaceLabel: 'Espace PieceMaker',
    nav: 'Navigation PieceMaker',
    backToSession: 'Revenir à la session',
    backToHome: 'Revenir à l’accueil',
  },
  organisation: {
    skillsTab: 'Skills et agents',
    configTab: 'MCP et configuration',
  },
  libraryPage: {
    files: 'Fichiers',
    templates: 'Modèles',
    download: 'Télécharger',
    downloading: 'Téléchargement…',
  },
  tabularReview: {
    untitled: 'Revue sans titre',
    loadingList: 'Chargement des revues tabulaires…',
    noReviews: 'Aucune revue tabulaire disponible.',
    running: 'En cours',
    documentCount: '{{count}} document{{plural}}',
    backToList: 'Retour aux revues',
    loadingDetail: 'Chargement de la revue…',
    noRows: 'Cette revue ne contient aucune ligne.',
    itemColumn: 'Élément',
    columnFallback: 'Colonne {{index}}',
    flag: { green: 'Conforme', grey: 'Neutre', yellow: 'À vérifier', red: 'Problème' },
    status: { pending: 'En attente', generating: 'Génération…', error: 'Erreur' },
  },
  workflowsPage: {
    tabAll: 'Tous',
    tabAddons: 'Add-ons',
    searchAddonsPlaceholder: 'Rechercher un add-on…',
    noInstructions: 'Aucune instruction disponible pour ce workflow.',
  },
  addonsPanel: {
    allSources: 'Toutes les sources',
    sourcePieceMaker: 'PieceMaker',
    sourceClaudeForLegalFr: 'Claude for Legal France',
    loading: 'Chargement des add-ons…',
    noAddons: 'Aucun add-on disponible.',
    noAddonsMatch: 'Aucun add-on ne correspond à ces filtres.',
    backToPacks: 'Retour aux packs',
    resources: 'Ressources',
    noInstructions: 'Aucune instruction disponible pour cet add-on.',
  },
  documentPicker: {
    title: 'Choisir des documents',
    selectedCount: '{{count}} document{{plural}} sélectionné{{plural}}',
  },
  workflowPicker: {
    title: 'Choisir un workflow',
    promptLabel: 'Précisez votre demande (facultatif)',
    promptPlaceholder: 'Ex. Vérifie la clause de non-concurrence de ce contrat.',
    confirm: 'Utiliser ce workflow',
  },
  composer: {
    workflowButton: 'Workflow',
    subAgentsButton: 'Sous-agents',
    subAgentsPopoverTitle: 'Sous-agents de l’organisation',
    noSubAgents: 'Aucun sous-agent disponible.',
    added: 'Ajouté',
    add: 'Ajouter',
    quickActionsLabel: 'Actions rapides',
    workflowSelected: 'Workflow sélectionné : {{title}}',
    workflowInstructions: 'Instructions du workflow :\n{{instructions}}',
    subAgentsContext: 'Sous-agents à inclure dans le contexte :\n{{list}}',
    requestPrefix: 'Demande :\n{{prompt}}',
    subAgentContext: 'Sous-agent à inclure dans le contexte : {{name}}\n{{content}}',
  },
  errors: {
    workspaceUnavailable: 'L’espace PieceMaker est indisponible.',
    quickActionsUnavailable: 'Les actions rapides sont indisponibles.',
    workflowsUnavailable: 'Les workflows sont indisponibles.',
    workflowUnavailable: 'Le workflow est indisponible.',
    organisationAgentsUnavailable: 'Les agents de l’organisation sont indisponibles.',
    subAgentUnavailable: 'Le sous-agent est indisponible.',
    subAgentUnreadable: 'Le sous-agent est illisible.',
    resourceUnavailable: 'La ressource PieceMaker est indisponible.',
    documentUnavailable: 'Le document PieceMaker est indisponible.',
    documentsCannotBeAttached: 'Les documents ne peuvent pas être ajoutés.',
    subAgentsUnavailable: 'Les sous-agents sont indisponibles.',
  },
};

/** Case-file tab label, using each locale's term for a legal case file. */
export const PIECEMAKER_I18N_ADDITIONS: AdditionBundles = {
  fr:      { common: { tabs: { dossier: 'Dossier' } }, addons: addonsFr },
  en:      { common: { tabs: { dossier: 'Case file' } } },
  es:      { common: { tabs: { dossier: 'Expediente' } } },
  it:      { common: { tabs: { dossier: 'Fascicolo' } } },
  de:      { common: { tabs: { dossier: 'Dossier' } } },
  tr:      { common: { tabs: { dossier: 'Dava dosyası' } } },
  ru:      { common: { tabs: { dossier: 'Досье' } } },
  ja:      { common: { tabs: { dossier: '案件' } } },
  ko:      { common: { tabs: { dossier: '사건' } } },
  'zh-CN': { common: { tabs: { dossier: '案件' } } },
  'zh-TW': { common: { tabs: { dossier: '案件' } } },
};
