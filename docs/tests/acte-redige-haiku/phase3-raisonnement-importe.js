{
  qualification: 'contentieux',
  objectifs: [
    { objectif: 'Obtenir la condamnation de Société Beta SARL au paiement des factures F-2025-014 et F-2025-021', obtenir: 'paiement_des_factures', prescription: 'prescription_de_cinq_ans' },
    { objectif: 'Obtenir l’indemnité forfaitaire pour frais de recouvrement de 40 euros par facture impayée', obtenir: 'indemnité_forfaitaire_de_recouvrement', prescription: 'prescription_de_cinq_ans' },
  ],
  paiement_des_factures: {
    si: [
      {
        condition: 'paiement_facture_014',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits', vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
      },
      {
        condition: 'paiement_facture_021',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits', vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_émission_021' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
      },
    ],
  },
  paiement_facture_014: {
    si: [
      {
        condition: 'facture_014_payable_à_trente_jours',
        delai: { de: 'date_d_émission_014', a: 'date_d_échéance_014', au_plus: { jours: 30 } },
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission`, vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_paiement' },
        ],
        decompte: 'décompte_de_trente_jours',
      },
      {
        condition: 'livraison_de_mars_2025',
        selon: [
          { source: 'LEGIARTI000000000105', citation: 'Celui qui réclame l’exécution d’une obligation doit la prouver', vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'livraison de mars 2025' },
        ],
      },
      {
        condition: 'facture_014_non_réglée',
        selon: [
          { source: 'LEGIARTI000000000105', citation: 'Celui qui réclame l’exécution d’une obligation doit la prouver', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_relevé' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu' },
        ],
      },
    ],
  },
  paiement_facture_021: {
    si: [
      {
        condition: 'facture_021_payable_à_trente_jours',
        delai: { de: 'date_d_émission_021', a: 'date_d_échéance_021', au_plus: { jours: 30 } },
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission`, vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_paiement' },
        ],
        decompte: 'décompte_de_trente_jours',
      },
      {
        condition: 'livraison_d_avril_2025',
        selon: [
          { source: 'LEGIARTI000000000105', citation: 'Celui qui réclame l’exécution d’une obligation doit la prouver', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_livraison_avril' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025' },
        ],
      },
      {
        condition: 'facture_021_non_réglée',
        selon: [
          { source: 'LEGIARTI000000000105', citation: 'Celui qui réclame l’exécution d’une obligation doit la prouver', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_relevé' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu' },
        ],
      },
    ],
    sauf: [
      {
        condition: 'contestation_de_conformité_recevable',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_réclamation' },
        ],
      },
    ],
  },
  contestation_de_conformité_recevable: {
    si: [
      {
        condition: 'réclamation_à_temps',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_réclamation' },
        ],
      },
      {
        condition: 'défauts_d_usinage_signalés',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_réclamation' },
        ],
        preuve: [
          { piece: 'pieces/05_courriel_reclamation.md', citation: `présentent des défauts d'usinage` },
        ],
        contredit: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Réserves : néant' },
        ],
      },
    ],
  },
  réclamation_à_temps: {
    si: [
      {
        condition: 'réclamation_dans_les_huit_jours_de_la_livraison',
        delai: { de: 'date_de_livraison_avril', a: 'date_de_réclamation', au_plus: { jours: 8 } },
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_réclamation' },
        ],
        decompte: 'décompte_de_huit_jours',
      },
    ],
  },
  indemnité_forfaitaire_de_recouvrement: {
    si: [
      {
        condition: 'retard_de_paiement_et_indemnité',
        selon: [
          { source: 'LEGIARTI000000000103', citation: 'Tout professionnel en situation de retard de paiement est de plein droit débiteur', vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
      },
    ],
  },
  retard_de_paiement_et_indemnité: {
    si: [
      {
        l_une: [
          {
            condition: 'paiement_facture_014',
            selon: [
              { source: 'LEGIARTI000000000103', citation: 'Tout professionnel en situation de retard de paiement est de plein droit débiteur', vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
            ],
          },
          {
            condition: 'paiement_facture_021',
            selon: [
              { source: 'LEGIARTI000000000103', citation: 'Tout professionnel en situation de retard de paiement est de plein droit débiteur', vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_émission_021' }, applicabilite: 'applicabilité_des_règles_commerciales' },
            ],
          },
        ],
        selon: [
          { source: 'LEGIARTI000000000103', citation: 'Tout professionnel en situation de retard de paiement est de plein droit débiteur', vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
      },
    ],
  },
  applicabilité_des_règles_commerciales: {
    si: [
      {
        condition: 'parties_professionnelles',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits', vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_émission_014' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
    ],
  },
  décompte_de_trente_jours: {
    si: [
      {
        condition: 'trente_jours_à_compter_de_l_émission',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission`, vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_paiement' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 3 mars 2025' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 2 avril 2025' },
        ],
      },
    ],
  },
  décompte_de_huit_jours: {
    si: [
      {
        condition: 'huit_jours_à_compter_de_la_livraison',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_réclamation' },
        ],
      },
    ],
  },
  validité_de_la_clause_de_paiement: {
    si: [
      {
        condition: 'contrat_cadre_conclu',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits', vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024' },
        ],
      },
    ],
  },
  validité_de_la_clause_de_réclamation: {
    si: [
      {
        condition: 'contrat_cadre_conclu',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_livraison_avril' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024' },
        ],
      },
    ],
  },
  prescription_de_cinq_ans: {
    si: [
      {
        condition: 'action_introduite_dans_les_cinq_ans',
        delai: { de: 'date_d_échéance_014', a: 'date_de_saisine', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000000000106', citation: 'se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes', vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        decompte: 'décompte_de_cinq_ans',
      },
    ],
  },
  décompte_de_cinq_ans: {
    si: [
      {
        condition: 'cinq_ans_à_compter_de_l_échéance',
        selon: [
          { source: 'LEGIARTI000000000106', citation: 'se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes', vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025' },
        ],
      },
    ],
  },
  valeurs: {
    date_d_émission_014: {
      valeur: '2025-03-03',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 3 mars 2025' },
      ],
    },
    date_d_échéance_014: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025' },
      ],
    },
    date_d_émission_021: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 2 avril 2025' },
      ],
    },
    date_d_échéance_021: {
      valeur: '2025-05-02',
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025' },
      ],
    },
    date_de_livraison_avril: {
      valeur: '2025-04-05',
      preuve: [
        { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025' },
      ],
    },
    date_de_réclamation: {
      valeur: '2025-05-30',
      preuve: [
        { piece: 'pieces/05_courriel_reclamation.md', citation: 'Courriel du 30 mai 2025' },
      ],
    },
    date_du_relevé: {
      valeur: '2025-09-01',
      preuve: [
        { piece: 'pieces/07_releve_de_compte.md', citation: 'Relevé de compte client au 1er septembre 2025' },
      ],
    },
    date_de_saisine: { valeur: null },
    montant_facture_014: {
      valeur: 12000,
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros' },
      ],
    },
    montant_facture_021: {
      valeur: 8400,
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros' },
      ],
    },
    montant_total: { formule: { somme: ['montant_facture_014', 'montant_facture_021'] } },
    nombre_de_factures: {
      valeur: 2,
      preuve: [
        { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu' },
      ],
    },
    indemnité_par_facture: {
      valeur: 40,
      selon: [
        { source: 'LEGIARTI000000000104', citation: `Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_émission_014' }, applicabilite: 'applicabilité_des_règles_commerciales' },
      ],
    },
    indemnités_totales: { formule: { produit: ['indemnité_par_facture', 'nombre_de_factures'] } },
  },
  acte: [
    { id: 's1', intitule: 'TRIBUNAL DE COMMERCE DE LYON' },
    { id: 's2', intitule: 'CONCLUSIONS EN DEMANDE', texte: ['POUR : Société Exemple SAS, demanderesse.', 'CONTRE : Société Beta SARL, défenderesse.'] },
    {
      id: 's3',
      intitule: 'I. FAITS ET PROCÉDURE',
      texte: [
        'Société Exemple SAS fournit des pièces usinées à Société Beta SARL en exécution d’un contrat-cadre du 10 janvier 2024.',
        'Les factures F-2025-014 et F-2025-021, d’un montant total de 20 400 euros, sont demeurées impayées malgré une mise en demeure du 20 juin 2025.',
      ],
    },
    {
      id: 's4',
      intitule: 'II. DISCUSSION',
      sections: [
        {
          id: 's5',
          intitule: 'A. Sur la créance',
          traite: 'paiement_des_factures',
          texte: [
            `Le contrat stipule que « Les factures sont payables à trente jours à compter de leur date d'émission ». Les deux échéances sont dépassées.`,
          ],
        },
        {
          id: 's6',
          intitule: 'B. Sur l’exception d’inexécution',
          traite: 'contestation_de_conformité_recevable',
          texte: [
            'La défenderesse invoque des défauts d’usinage. Or la marchandise a été reçue avec la mention « Réserves : néant » et la seule réclamation, du 30 mai 2025, est tardive : le contrat exige une réclamation écrite dans les huit jours de la livraison, à défaut de quoi les produits sont réputés acceptés sans réserve.',
          ],
        },
        {
          id: 's7',
          intitule: 'C. Sur l’indemnité forfaitaire',
          traite: 'indemnité_forfaitaire_de_recouvrement',
          texte: [
            'Chaque facture impayée à son échéance ouvre droit à une indemnité forfaitaire de 40 euros. Aux termes de l’article L. 441-10 du code de commerce, « Tout professionnel en situation de retard de paiement est de plein droit débiteur » d’une indemnité forfaitaire pour frais de recouvrement, dont le montant est fixé à 40 euros par l’article D. 441-5.',
          ],
        },
      ],
    },
    {
      id: 's8',
      intitule: 'PAR CES MOTIFS',
      texte: [
        'Condamner Société Beta SARL à payer à Société Exemple SAS la somme de 20 400 euros, outre 80 euros d’indemnités forfaitaires.',
      ],
    },
  ],
}