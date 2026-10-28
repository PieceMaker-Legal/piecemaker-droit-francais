{
  qualification: 'contentieux',
  objectifs: [
    { objectif: 'Obtenir la condamnation de Société Beta SARL au paiement de la facture F-2025-014', obtenir: 'paiement_de_la_facture_de_mars', prescription: 'prescription_de_la_créance_de_mars' },
    { objectif: 'Obtenir la condamnation de Société Beta SARL au paiement de la facture F-2025-021', obtenir: 'paiement_de_la_facture_d_avril', prescription: 'prescription_de_la_créance_d_avril' },
    { objectif: `Obtenir l'indemnité forfaitaire pour frais de recouvrement de 40 euros pour la facture F-2025-014`, obtenir: 'indemnité_de_recouvrement_de_mars', prescription: 'prescription_de_la_créance_de_mars' },
    { objectif: `Obtenir l'indemnité forfaitaire pour frais de recouvrement de 40 euros pour la facture F-2025-021`, obtenir: 'indemnité_de_recouvrement_d_avril', prescription: 'prescription_de_la_créance_d_avril' },
  ],
  paiement_de_la_facture_de_mars: {
    si: [
      {
        condition: 'facture_de_mars_émise',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_émission_de_la_facture_de_mars' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 3 mars 2025.' },
        ],
      },
      {
        condition: 'livraison_de_mars_effectuée',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_émission_de_la_facture_de_mars' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Fourniture de pièces usinées, livraison de mars 2025.' },
        ],
      },
      {
        condition: 'échéance_de_mars_dépassée',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_échéance_de_mars' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
        ],
      },
      {
        condition: 'facture_de_mars_non_réglée',
        selon: [
          { source: 'LEGIARTI000000000105', citation: `celui qui se prétend libéré doit justifier le paiement ou le fait qui a produit l'extinction de son obligation`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_échéance_de_mars' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  paiement_de_la_facture_d_avril: {
    si: [
      {
        condition: 'facture_d_avril_émise',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_émission_de_la_facture_d_avril' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 2 avril 2025.' },
        ],
      },
      {
        condition: 'livraison_d_avril_effectuée',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'dans les huit jours de la livraison', vigueur: { debut: '2024-01-10', fin: null, au: 'date_de_livraison_d_avril' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025 par Société Beta SARL.' },
        ],
      },
      {
        condition: 'échéance_d_avril_dépassée',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_échéance_d_avril' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025.' },
        ],
      },
      {
        condition: 'facture_d_avril_non_réglée',
        selon: [
          { source: 'LEGIARTI000000000105', citation: `celui qui se prétend libéré doit justifier le paiement ou le fait qui a produit l'extinction de son obligation`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_d_échéance_d_avril' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
    sauf: [
      {
        condition: 'refus_fondé_sur_une_inexécution_grave',
        selon: [
          { source: 'LEGIARTI000000000102', citation: 'si cette inexécution est suffisamment grave', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_livraison_d_avril' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        contredit: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Réserves : néant.' },
          { piece: 'pieces/01_contrat_cadre.md', citation: 'dans les huit jours de la livraison' },
          { piece: 'pieces/01_contrat_cadre.md', citation: 'à défaut, les produits sont réputés acceptés sans réserve.' },
          { piece: 'pieces/05_courriel_reclamation.md', citation: 'Courriel du 30 mai 2025' },
        ],
      },
    ],
  },
  indemnité_de_recouvrement_de_mars: {
    si: [
      {
        condition: 'retard_de_paiement_de_mars',
        selon: [
          { source: 'LEGIARTI000000000103', citation: `est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance_de_mars' }, applicabilite: 'applicabilité_entre_professionnels' },
          { source: 'pieces/01_contrat_cadre.md', citation: `Tout retard de paiement rend exigible l'indemnité forfaitaire pour frais de recouvrement prévue par la loi.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_échéance_de_mars' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  indemnité_de_recouvrement_d_avril: {
    si: [
      {
        condition: 'retard_de_paiement_d_avril',
        selon: [
          { source: 'LEGIARTI000000000103', citation: `est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance_d_avril' }, applicabilite: 'applicabilité_entre_professionnels' },
          { source: 'pieces/01_contrat_cadre.md', citation: `Tout retard de paiement rend exigible l'indemnité forfaitaire pour frais de recouvrement prévue par la loi.`, vigueur: { debut: '2024-01-10', fin: null, au: 'date_d_échéance_d_avril' }, validite: 'validité_du_contrat_cadre' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
    sauf: [
      {
        condition: 'refus_fondé_sur_une_inexécution_grave',
        selon: [
          { source: 'LEGIARTI000000000102', citation: 'si cette inexécution est suffisamment grave', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_livraison_d_avril' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        contredit: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Réserves : néant.' },
          { piece: 'pieces/01_contrat_cadre.md', citation: 'dans les huit jours de la livraison' },
          { piece: 'pieces/01_contrat_cadre.md', citation: 'à défaut, les produits sont réputés acceptés sans réserve.' },
          { piece: 'pieces/05_courriel_reclamation.md', citation: 'Courriel du 30 mai 2025' },
        ],
      },
    ],
  },
  applicabilité_entre_professionnels: {
    si: [
      {
        condition: 'parties_professionnelles',
        selon: [
          { source: 'LEGIARTI000000000103', citation: 'Tout professionnel en situation de retard de paiement', vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance_de_mars' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
    ],
  },
  validité_du_contrat_cadre: {
    si: [
      {
        condition: 'contrat_cadre_légalement_formé',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024.' },
        ],
      },
    ],
  },
  prescription_de_la_créance_de_mars: {
    si: [
      {
        condition: 'délai_de_cinq_ans_non_écoulé_pour_mars',
        delai: { de: 'date_d_échéance_de_mars', a: 'date_de_la_mise_en_demeure', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000000000106', citation: 'se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes', vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_la_mise_en_demeure' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        decompte: 'décompte_du_délai_de_prescription_de_mars',
      },
    ],
  },
  décompte_du_délai_de_prescription_de_mars: {
    si: [
      {
        condition: 'point_de_départ_à_l_échéance_de_mars',
        selon: [
          { source: 'LEGIARTI000000000107', citation: `à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_de_mars' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
        ],
      },
    ],
  },
  prescription_de_la_créance_d_avril: {
    si: [
      {
        condition: 'délai_de_cinq_ans_non_écoulé_pour_avril',
        delai: { de: 'date_d_échéance_d_avril', a: 'date_de_la_mise_en_demeure', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000000000106', citation: 'se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes', vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_la_mise_en_demeure' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        decompte: 'décompte_du_délai_de_prescription_d_avril',
      },
    ],
  },
  décompte_du_délai_de_prescription_d_avril: {
    si: [
      {
        condition: 'point_de_départ_à_l_échéance_d_avril',
        selon: [
          { source: 'LEGIARTI000000000107', citation: `à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_d_avril' }, applicabilite: 'applicabilité_entre_professionnels' },
        ],
        preuve: [
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025.' },
        ],
      },
    ],
  },
  valeurs: {
    montant_de_la_facture_de_mars: {
      valeur: 12000,
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros.' },
      ],
    },
    montant_de_la_facture_d_avril: {
      valeur: 8400,
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros.' },
      ],
    },
    indemnité_forfaitaire_par_facture: {
      valeur: 40,
      selon: [
        { source: 'LEGIARTI000000000104', citation: `Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance_de_mars' }, applicabilite: 'applicabilité_entre_professionnels' },
      ],
    },
    date_de_conclusion_du_contrat: {
      valeur: '2024-01-10',
      preuve: [
        { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024.' },
      ],
    },
    date_d_émission_de_la_facture_de_mars: {
      valeur: '2025-03-03',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 3 mars 2025.' },
      ],
    },
    date_d_émission_de_la_facture_d_avril: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 2 avril 2025.' },
      ],
    },
    date_d_échéance_de_mars: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
      ],
    },
    date_d_échéance_d_avril: {
      valeur: '2025-05-02',
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025.' },
      ],
    },
    date_de_livraison_d_avril: {
      valeur: '2025-04-05',
      preuve: [
        { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025 par Société Beta SARL.' },
      ],
    },
    date_de_la_mise_en_demeure: {
      valeur: '2025-06-23',
      preuve: [
        { piece: 'pieces/06_mise_en_demeure.md', citation: 'Accusé de réception signé le 23 juin 2025.' },
      ],
    },
  },
  hypotheses: [
    { nom: 'toutes les conditions acquises, aucune exception', faits: { facture_de_mars_émise: vrai, livraison_de_mars_effectuée: vrai, échéance_de_mars_dépassée: vrai, facture_de_mars_non_réglée: vrai, retard_de_paiement_de_mars: vrai, facture_d_avril_émise: vrai, livraison_d_avril_effectuée: vrai, échéance_d_avril_dépassée: vrai, facture_d_avril_non_réglée: vrai, retard_de_paiement_d_avril: vrai, refus_fondé_sur_une_inexécution_grave: faux }, attendu: { paiement_de_la_facture_de_mars: vrai, paiement_de_la_facture_d_avril: vrai, indemnité_de_recouvrement_de_mars: vrai, indemnité_de_recouvrement_d_avril: vrai } },
    { nom: `inexécution grave de la livraison d'avril établie`, faits: { facture_de_mars_émise: vrai, livraison_de_mars_effectuée: vrai, échéance_de_mars_dépassée: vrai, facture_de_mars_non_réglée: vrai, retard_de_paiement_de_mars: vrai, facture_d_avril_émise: vrai, livraison_d_avril_effectuée: vrai, échéance_d_avril_dépassée: vrai, facture_d_avril_non_réglée: vrai, retard_de_paiement_d_avril: vrai, refus_fondé_sur_une_inexécution_grave: vrai }, attendu: { paiement_de_la_facture_de_mars: vrai, paiement_de_la_facture_d_avril: faux, indemnité_de_recouvrement_de_mars: vrai, indemnité_de_recouvrement_d_avril: faux } },
    { nom: 'facture de mars réglée par Beta', faits: { facture_de_mars_émise: vrai, livraison_de_mars_effectuée: vrai, échéance_de_mars_dépassée: vrai, facture_de_mars_non_réglée: faux, retard_de_paiement_de_mars: faux, facture_d_avril_émise: vrai, livraison_d_avril_effectuée: vrai, échéance_d_avril_dépassée: vrai, facture_d_avril_non_réglée: vrai, retard_de_paiement_d_avril: vrai, refus_fondé_sur_une_inexécution_grave: faux }, attendu: { paiement_de_la_facture_de_mars: faux, paiement_de_la_facture_d_avril: vrai, indemnité_de_recouvrement_de_mars: faux, indemnité_de_recouvrement_d_avril: vrai } },
  ],
  acte: [
    {
      id: 's1',
      intitule: 'Conclusions en demande',
      texte: [
        `Pour Société Exemple SAS, fournisseur, dont le siège est à [adresse], représentée par [représentant légal], ayant pour avocat [nom de l'avocat].`,
        'Contre Société Beta SARL, client, dont le siège est à [adresse], représentée par [représentant légal].',
        'Devant le tribunal de commerce de Lyon.',
      ],
    },
    {
      id: 's2',
      intitule: 'I. Faits et procédure',
      texte: [
        `Par contrat-cadre signé à Lyon le 10 janvier 2024, Société Exemple SAS fournit des pièces usinées à Société Beta SARL. Le contrat prévoit que « Les factures sont payables à trente jours à compter de leur date d'émission. » et que « Tout retard de paiement rend exigible l'indemnité forfaitaire pour frais de recouvrement prévue par la loi. »`,
        'Société Exemple SAS a émis la facture F-2025-014 le 3 mars 2025, pour 12 000,00 euros TTC, à échéance du 2 avril 2025, au titre de la livraison de mars 2025.',
        `Elle a émis la facture F-2025-021 le 2 avril 2025, pour 8 400,00 euros TTC, à échéance du 2 mai 2025, au titre de la livraison d'avril 2025. Le bon de livraison BL-0412 atteste de la réception de la marchandise le 5 avril 2025, sans aucune réserve.`,
        `Par courriel du 30 mai 2025, Société Beta SARL a indiqué suspendre le règlement de la facture F-2025-021 dans l'attente d'un avoir, en invoquant des défauts d'usinage. Cette réclamation est intervenue cinquante-cinq jours après la livraison.`,
        'Par lettre recommandée du 20 juin 2025, reçue le 23 juin 2025, Société Exemple SAS a mis en demeure Société Beta SARL de régler 20 400 euros sous huit jours. Le relevé de compte arrêté au 1er septembre 2025 ne fait apparaître aucun règlement : le solde débiteur est de 20 400,00 euros.',
      ],
    },
    {
      id: 's3',
      intitule: 'II. Discussion',
      sections: [
        {
          id: 's4',
          intitule: 'A. Sur le paiement de la facture F-2025-014',
          traite: 'paiement_de_la_facture_de_mars',
          texte: [
            `La facture F-2025-014 correspond à la livraison de mars 2025, qui n'est pas critiquée. Elle est échue depuis le 2 avril 2025 et n'a donné lieu à aucun règlement, comme l'établit le relevé de compte.`,
            `Il appartient à Société Beta SARL de justifier le paiement qui l'aurait libérée. Selon l'article 1353 du code civil, « celui qui se prétend libéré doit justifier le paiement ou le fait qui a produit l'extinction de son obligation ». Elle ne le fait pas.`,
            'Société Exemple SAS demande donc la condamnation de Société Beta SARL à payer 12 000,00 euros TTC.',
          ],
        },
        {
          id: 's5',
          intitule: 'B. Sur le paiement de la facture F-2025-021',
          traite: 'paiement_de_la_facture_d_avril',
          texte: [
            `La facture F-2025-021 est échue depuis le 2 mai 2025 et n'a pas été réglée. La livraison d'avril est établie par le bon de livraison signé le 5 avril 2025.`,
            `Société Beta SARL oppose la défectuosité de la livraison pour suspendre le paiement, en se fondant sur l'exception d'inexécution de l'article 1219 du code civil, selon lequel une partie peut refuser d'exécuter « si cette inexécution est suffisamment grave ». Cette exception ne peut pas prospérer, pour trois raisons.`,
            `Premièrement, le bon de livraison ne comporte aucune réserve (« Réserves : néant. »). Deuxièmement, l'article 6 du contrat impose une réclamation écrite « dans les huit jours de la livraison » et prévoit que, « à défaut, les produits sont réputés acceptés sans réserve ». Or la livraison a eu lieu le 5 avril 2025 et la première réclamation écrite est datée du 30 mai 2025, soit près de huit semaines plus tard. Troisièmement, **aucune pièce ne démontre la réalité ni la gravité des défauts allégués** : le courriel de Société Beta SARL n'est qu'une affirmation.`,
            'Société Exemple SAS demande donc la condamnation de Société Beta SARL à payer 8 400,00 euros TTC.',
          ],
        },
        {
          id: 's6',
          intitule: `C. Sur l'indemnité forfaitaire pour frais de recouvrement au titre de la facture F-2025-014`,
          traite: 'indemnité_de_recouvrement_de_mars',
          texte: [
            `Selon l'article L. 441-10 du code de commerce, le professionnel en situation de retard de paiement « est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement ». Le contrat prévoit de même que « Tout retard de paiement rend exigible l'indemnité forfaitaire pour frais de recouvrement prévue par la loi. » Le montant est fixé à 40 euros par l'article D. 441-5.`,
            'Cette indemnité est due de plein droit, sans mise en demeure préalable. Elle est due au titre de la facture F-2025-014 : 40 euros.',
          ],
        },
        {
          id: 's7',
          intitule: `D. Sur l'indemnité forfaitaire pour frais de recouvrement au titre de la facture F-2025-021`,
          traite: 'indemnité_de_recouvrement_d_avril',
          texte: [
            `Pour les mêmes motifs, l'indemnité de 40 euros est due au titre de la facture F-2025-021, l'exception d'inexécution invoquée n'étant pas établie (voir B).`,
          ],
        },
      ],
    },
    {
      id: 's9',
      intitule: 'III. Par ces motifs',
      texte: [
        'Il est demandé au tribunal de commerce de Lyon de :',
        'Condamner Société Beta SARL à payer à Société Exemple SAS la somme de 12 000,00 euros TTC au titre de la facture F-2025-014 ;',
        'Condamner Société Beta SARL à payer à Société Exemple SAS la somme de 8 400,00 euros TTC au titre de la facture F-2025-021 ;',
        `Condamner Société Beta SARL à payer à Société Exemple SAS la somme de 80 euros au titre de l'indemnité forfaitaire pour frais de recouvrement, soit 40 euros par facture impayée.`,
        'Condamner Société Beta SARL aux dépens.',
      ],
    },
  ],
}