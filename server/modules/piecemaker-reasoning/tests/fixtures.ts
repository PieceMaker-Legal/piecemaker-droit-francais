import { printReasoningDocument } from '../document.js';
import { LiteralError, parseLiteral } from '../format.js';

export const EXAMPLE_LITERAL = `{
  objectifs: [
    {
      objectif: \`Obtenir de Société Beta SARL le paiement de la pénalité de retard\`,
      obtenir: 'pénalité_encourue',
    },
  ],
  valeurs: {
    date_de_conclusion_du_contrat: { valeur: '2024-01-15', preuve: [{ piece: 'pieces/01_contrat.md', citation: \`Fait le 15/01/2024\` }] },
  },
  pénalité_encourue: {
    but: \`Établir que la pénalité de retard est due par le débiteur mis en demeure\`,
    si: [
      { pénalité_stipulée: true,
        selon: [{ source: 'LEGIARTI000000000005', citation: \`la pénalité n'est encourue que lorsque le débiteur est mis en demeure\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1231_5' }] },
      { l_une: [
          { mise_en_demeure: true },
          { inexécution_définitive: true },
        ],
        selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1231_5' }] },
    ],
  },
  mise_en_demeure: { true: [{ preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: \`vous met en demeure\` }] }] },
  applicabilité_de_l_article_1231_5: {
    but: \`Montrer que l'article 1231-5 s'applique à ce contrat\`,
    si: [
      { contrat_stipulant_une_pénalité: true,
        selon: [{ source: 'LEGIARTI000000000005', citation: \`Lorsque le contrat stipule une pénalité\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] },
    ],
  },
  contrat_stipulant_une_pénalité: { true: [{ preuve: [{ piece: 'pieces/01_contrat.md', citation: \`une pénalité est due\` }] }] },
  pénalité_stipulée: {
    but: \`Montrer que le contrat prévoit la pénalité pour ce retard\`,
    si: [
      { retard_de_livraison: true,
        selon: [{ source: 'pieces/01_contrat.md', citation: \`En cas de retard de livraison\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
    sauf: [
      { force_majeure_contractuelle: true,
        selon: [{ source: 'pieces/01_contrat.md', citation: \`sauf force majeure au sens de l'article 12\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  retard_de_livraison: { true: [{ preuve: [{ piece: 'pieces/05_bon_de_livraison.md', citation: \`Livré le 14/06/2025\` }] }] },
  force_majeure_contractuelle: {
    but: \`Vérifier si la force majeure du contrat écarte la pénalité\`,
    si: [
      { l_une: [{ force_majeure: true }, { grève: true }],
        selon: [{ source: 'pieces/01_contrat.md', citation: \`ainsi que les grèves\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  grève: {
    but: \`Vérifier si une grève visée par le contrat est survenue\`,
    si: [
      { l_une: [
          { grève_nationale: true },
          { grève_du_secteur: true },
        ],
        selon: [{ source: 'pieces/01_contrat.md', citation: \`grève nationale ou propre au secteur\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  grève_du_secteur: { false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: \`mouvement limité à notre atelier\` }] }] },
  hypotheses: [
    { nom: \`grève nationale : pas de pénalité\`, faits: { retard_de_livraison: vrai, mise_en_demeure: vrai, grève_nationale: vrai }, attendu: { pénalité_encourue: faux } },
  ],
}
`;

export const yamlOf = (code: string) => {
  try { return printReasoningDocument(parseLiteral(code).value); } catch (error) {
    if (error instanceof LiteralError && !/^\s*(?:\{|export\s+default)/u.test(code)) return code;
    throw error;
  }
};
