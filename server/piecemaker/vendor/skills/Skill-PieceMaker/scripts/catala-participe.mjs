const IRREGULAR = new Set(`fini rempli établi saisi réuni fourni garanti investi agi subi choisi bâti averti converti accompli abouti aboli franchi rétabli sorti servi suivi poursuivi consenti
pris compris appris repris surpris entrepris mis admis permis promis transmis commis remis omis soumis démis acquis requis conquis assis clos inclus exclu conclu dissous absous
dû reçu perçu déçu conçu obtenu tenu retenu maintenu soutenu venu survenu intervenu convenu advenu parvenu devenu prévu vu revu pourvu connu reconnu méconnu lu élu relu
rendu vendu perdu attendu entendu répondu suspendu défendu étendu prétendu fondu confondu répandu résolu voulu pu su eu cru valu fallu paru apparu disparu couru encouru
battu débattu combattu interrompu rompu corrompu vécu convaincu vaincu fait défait refait satisfait dit prédit interdit contredit prescrit inscrit souscrit transcrit décrit
construit réduit traduit introduit conduit déduit induit instruit détruit reproduit soustrait ouvert offert couvert découvert recouvert souffert atteint éteint joint
contraint astreint restreint peint plaint enfreint né due dus dues`.split(/\s+/));
const NOUNS = new Set(`durée année journée entrée idée arrivée assemblée clé degré gré marché comité procédé santé côté pré café musée lycée liberté volonté bonté traité député
employé salarié associé délégué préposé intéressé retraité assuré accusé`.split(/\s+/));
const NOUN_SUFFIX = /(?:ité|iété|erté|neté)$/;
const ITE_VERBS = new Set('cité limité hérité évité mérité invité habité visité édité débité crédité imité facilité sollicité exploité quitté acquitté acheté jeté rejeté projeté été'.split(' '));

const forms = (word) => [word, word.replace(/s$/, ''), word.replace(/e$/, ''), word.replace(/es$/, '')];

const verbal = (word) => !forms(word).some((form) => NOUNS.has(form)) && forms(word).some((form) => IRREGULAR.has(form)
  || (form.length > 2 && form.endsWith('é') && !NOUNS.has(form) && (!NOUN_SUFFIX.test(form) || ITE_VERBS.has(form))));

export const participle = (text) => text.toLowerCase().split(/[^\p{L}'’-]+/u)
  .flatMap((word) => word.replace(/^.*['’]/, '').split('-')).some(verbal);

const NOT_INFINITIVE = new Set(`salaire loyer dossier titre registre notaire mandataire bénéficiaire commissaire locataire propriétaire actionnaire destinataire signataire contraire
ordre nombre membre terme offre lettre livre droit délivrance premier dernier courrier créancier débiteur huissier héritier ouvrier salarier chantier métier atelier papier
calendrier danger étranger février janvier septembre octobre novembre décembre avenir plaisir souvenir pouvoir devoir avoir savoir`.split(/\s+/));

export const infinitive = (text) => {
  const first = text.trim().toLowerCase().split(/[^\p{L}'’-]+/u)[0].replace(/^(?:s|se)['’]/, '');
  return /(?:er|ir|re)$/.test(first) && !NOT_INFINITIVE.has(first);
};
