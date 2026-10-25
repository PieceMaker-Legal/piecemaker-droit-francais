{
  qualification: 'contentieux',
  objectifs: [
    { objectif: 'Obtenir la condamnation de Société Beta SARL au paiement des factures F-2025-014 et F-2025-021', obtenir: 'créance_factures_exigible', validite: 'validité_de_l_objectif_de_paiement', prescription: 'prescription_de_la_créance_factures' },
    { objectif: `Obtenir l'indemnité forfaitaire pour frais de recouvrement de 40 euros par facture impayée`, obtenir: 'indemnité_de_recouvrement_due', validite: 'validité_de_l_objectif_d_indemnité', prescription: 'prescription_de_l_indemnité_de_recouvrement' },
  ],
  créance_factures_exigible: {
    si: [
      {
        condition: 'contrat_de_fourniture_formé',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
      {
        condition: 'obligation_de_paiement',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: `Les factures sont payables à trente jours à compter de leur date d'émission.`, vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_de_paiement' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros. Échéance : 2 avril 2025.' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros. Échéance : 2 mai 2025.' },
        ],
      },
      {
        condition: 'créance_justifiée_et_non_payée',
        selon: [
          { source: 'LEGIARTI000000000105', citation: `Celui qui réclame l'exécution d'une obligation doit la prouver. Réciproquement, celui qui se prétend libéré doit justifier le paiement ou le fait qui a produit l'extinction de son obligation.`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_facture' }, applicabilite: 'applicabilité_de_l_article_1353' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Fourniture de pièces usinées, livraison de mars 2025.' },
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros.' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: `Fourniture de pièces usinées, livraison d'avril 2025.` },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros.' },
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu. Solde débiteur : 20 400,00 euros.' },
        ],
      },
      {
        condition: 'réclamation_de_conformité_tardive',
        selon: [
          { source: 'pieces/01_contrat_cadre.md', citation: 'Toute réclamation relative à la conformité des produits doit être formulée par écrit dans les huit jours de la livraison ; à défaut, les produits sont réputés acceptés sans réserve.', vigueur: { debut: '2024-01-10', fin: null }, validite: 'validité_de_la_clause_réclamation_de_conformité_tardive' },
        ],
        preuve: [
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025 par Société Beta SARL.' },
          { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Réserves : néant.' },
          { piece: 'pieces/05_courriel_reclamation.md', citation: '# Courriel du 30 mai 2025' },
        ],
      },
    ],
    sauf: [
      {
        condition: 'exception_d_inexécution_suffisamment_grave',
        selon: [
          { source: 'LEGIARTI000000000102', citation: `Une partie peut refuser d'exécuter son obligation, alors même que celle-ci est exigible, si l'autre n'exécute pas la sienne et si cette inexécution est suffisamment grave.`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_réception_avril' }, applicabilite: 'applicabilité_de_l_article_1219' },
        ],
      },
    ],
  },
  indemnité_de_recouvrement_due: {
    si: [
      {
        condition: 'retard_de_paiement_de_factures_professionnelles',
        selon: [
          { source: 'LEGIARTI000000000103', citation: `Tout professionnel en situation de retard de paiement est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement, dont le montant est fixé par décret.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' }, applicabilite: 'applicabilité_de_l_article_l' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Échéance : 2 mai 2025.' },
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
      {
        condition: 'montant_forfaitaire_de_quarante_euros_par_facture',
        selon: [
          { source: 'LEGIARTI000000000104', citation: `Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' }, applicabilite: 'applicabilité_de_l_article_d' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_1103: {
    si: [
      {
        condition: 'contrat_légalement_formé_entre_professionnels',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_contrat' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_1353: {
    si: [
      {
        condition: 'action_en_paiement_des_factures',
        selon: [
          { source: 'LEGIARTI000000000105', citation: `Celui qui réclame l'exécution d'une obligation doit la prouver. Réciproquement, celui qui se prétend libéré doit justifier le paiement ou le fait qui a produit l'extinction de son obligation.`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_facture' } },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros.' },
          { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_1219: {
    si: [
      {
        condition: 'contrat_de_fourniture_conclu_entre_professionnels',
        selon: [
          { source: 'LEGIARTI000000000102', citation: `Une partie peut refuser d'exécuter son obligation, alors même que celle-ci est exigible, si l'autre n'exécute pas la sienne et si cette inexécution est suffisamment grave.`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_réception_avril' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_l: {
    si: [
      {
        condition: 'retard_de_paiement_entre_professionnels',
        selon: [
          { source: 'LEGIARTI000000000103', citation: `Tout professionnel en situation de retard de paiement est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement, dont le montant est fixé par décret.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_d: {
    si: [
      {
        condition: 'indemnité_légale_pour_retard_de_paiement',
        selon: [
          { source: 'LEGIARTI000000000104', citation: `Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' } },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  validité_de_la_clause_de_paiement: {
    si: [
      {
        condition: 'contrat_conclu_entre_les_parties',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
    ],
  },
  validité_de_la_clause_réclamation_de_conformité_tardive: {
    si: [
      {
        condition: 'clause_convenue_par_les_parties',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
    ],
  },
  validité_de_l_objectif_de_paiement: {
    si: [
      {
        condition: 'créance_contractuelle_prouvée',
        selon: [
          { source: 'LEGIARTI000000000101', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_du_contrat' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
        ],
      },
    ],
  },
  validité_de_l_objectif_d_indemnité: {
    si: [
      {
        condition: 'retard_de_paiement',
        selon: [
          { source: 'LEGIARTI000000000103', citation: `Tout professionnel en situation de retard de paiement est de plein droit débiteur, à l'égard du créancier, d'une indemnité forfaitaire pour frais de recouvrement, dont le montant est fixé par décret.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' }, applicabilite: 'applicabilité_de_l_article_l' },
        ],
        preuve: [
          { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
        ],
      },
    ],
  },
  prescription_de_la_créance_factures: {
    si: [
      {
        condition: 'action_engagée_dans_les_cinq_ans',
        delai: { de: 'date_d_échéance_facture_014', a: 'date_de_l_action', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000000000106', citation: `Les obligations nées à l'occasion de leur commerce entre commerçants ou entre commerçants et non-commerçants se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_facture_014' }, applicabilite: 'applicabilité_de_l_article_1104' },
        ],
        decompte: 'décompte_de_la_prescription_commerciale',
      },
    ],
  },
  applicabilité_de_l_article_1104: {
    si: [
      {
        condition: 'obligations_commerciales_entre_sociétés',
        selon: [
          { source: 'LEGIARTI000000000106', citation: `Les obligations nées à l'occasion de leur commerce entre commerçants ou entre commerçants et non-commerçants se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_facture_014' } },
        ],
        preuve: [
          { piece: 'pieces/01_contrat_cadre.md', citation: 'Entre Société Exemple SAS, fournisseur, et Société Beta SARL, client.' },
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Fourniture de pièces usinées, livraison de mars 2025.' },
        ],
      },
    ],
  },
  décompte_de_la_prescription_commerciale: {
    si: [
      {
        condition: 'délai_quinquennal_des_obligations_commerciales',
        selon: [
          { source: 'LEGIARTI000000000106', citation: `Les obligations nées à l'occasion de leur commerce entre commerçants ou entre commerçants et non-commerçants se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_facture_014' }, applicabilite: 'applicabilité_de_l_article_1104' },
        ],
        preuve: [
          { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
        ],
      },
    ],
  },
  prescription_de_l_indemnité_de_recouvrement: {
    si: [
      {
        condition: 'action_engagée_dans_les_cinq_ans',
        delai: { de: 'date_d_échéance_facture_014', a: 'date_de_l_action', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000000000106', citation: `Les obligations nées à l'occasion de leur commerce entre commerçants ou entre commerçants et non-commerçants se prescrivent par cinq ans si elles ne sont pas soumises à des prescriptions spéciales plus courtes.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_d_échéance_facture_014' }, applicabilite: 'applicabilité_de_l_article_1104' },
        ],
        decompte: 'décompte_de_la_prescription_commerciale',
      },
    ],
  },
  valeurs: {
    montant_facture_014: {
      valeur: 12000,
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Montant TTC : 12 000,00 euros.' },
      ],
    },
    montant_facture_021: {
      valeur: 8400,
      preuve: [
        { piece: 'pieces/03_facture_F-2025-021.md', citation: 'Montant TTC : 8 400,00 euros.' },
      ],
    },
    montant_total_factures: {
      valeur: 20400,
      formule: { somme: ['montant_facture_014', 'montant_facture_021'] },
      preuve: [
        { piece: 'pieces/07_releve_de_compte.md', citation: 'Solde débiteur : 20 400,00 euros.' },
      ],
    },
    montant_indemnité_par_facture: {
      valeur: 40,
      selon: [
        { source: 'LEGIARTI000000000104', citation: `Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros.`, vigueur: { debut: '2019-04-26', fin: null, au: 'date_d_échéance' }, applicabilite: 'applicabilité_de_l_article_d' },
      ],
    },
    nombre_factures_impayées: {
      valeur: 2,
      preuve: [
        { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
      ],
    },
    montant_total_indemnité: {
      valeur: 80,
      formule: { produit: ['montant_indemnité_par_facture', 'nombre_factures_impayées'] },
      preuve: [
        { piece: 'pieces/07_releve_de_compte.md', citation: 'Factures F-2025-014 et F-2025-021 : aucun règlement reçu.' },
      ],
    },
    date_du_contrat: {
      valeur: '2024-01-10',
      preuve: [
        { piece: 'pieces/01_contrat_cadre.md', citation: 'Fait à Lyon le 10 janvier 2024.' },
      ],
    },
    date_de_facture: {
      valeur: '2025-03-03',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Émise par Société Exemple SAS à Société Beta SARL le 3 mars 2025.' },
      ],
    },
    date_d_échéance: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
      ],
    },
    date_d_échéance_facture_014: {
      valeur: '2025-04-02',
      preuve: [
        { piece: 'pieces/02_facture_F-2025-014.md', citation: 'Échéance : 2 avril 2025.' },
      ],
    },
    date_de_l_action: { valeur: null, preuve: [] },
    date_de_réception_avril: {
      valeur: '2025-04-05',
      preuve: [
        { piece: 'pieces/04_bon_de_livraison_avril.md', citation: 'Marchandise reçue le 5 avril 2025 par Société Beta SARL.' },
      ],
    },
  },
  hypotheses: [
    { nom: 'Hypothèse où la défense de gravité ne serait pas établie', faits: { contrat_de_fourniture_formé: vrai, obligation_de_paiement: vrai, créance_justifiée_et_non_payée: vrai, réclamation_de_conformité_tardive: vrai, exception_d_inexécution_suffisamment_grave: faux }, attendu: { créance_factures_exigible: vrai } },
    { nom: 'Deux factures professionnelles échues et impayées', faits: { retard_de_paiement_de_factures_professionnelles: vrai, montant_forfaitaire_de_quarante_euros_par_facture: vrai }, attendu: { indemnité_de_recouvrement_due: vrai } },
  ],
  acte: [
    {
      id: 's1',
      intitule: 'Conclusions en demande',
      texte: [
        'Tribunal de commerce de Lyon',
        'Pour Société Exemple SAS, demanderesse, contre Société Beta SARL, défenderesse.',
      ],
    },
    {
      id: 's2',
      intitule: 'Faits et procédure',
      texte: [
        `Société Exemple SAS et Société Beta SARL ont conclu un contrat-cadre de fourniture le 10 janvier 2024. Les factures sont payables à trente jours de leur date d'émission.`,
        `Société Exemple SAS a émis la facture F-2025-014, d'un montant de 12 000 euros TTC, le 3 mars 2025, échéance au 2 avril 2025, puis la facture F-2025-021, d'un montant de 8 400 euros TTC, le 2 avril 2025, échéance au 2 mai 2025.`,
        `La livraison d'avril a été reçue le 5 avril 2025 sans réserve. Le seul courriel de réclamation produit date du 30 mai 2025. Société Beta SARL y allègue des défauts d'usinage et annonce la suspension du paiement de la seconde facture.`,
        'Par lettre recommandée du 20 juin 2025, reçue le 23 juin, Société Exemple SAS a mis en demeure Société Beta SARL de régler 20 400 euros. Le relevé de compte au 1er septembre 2025 constate que les deux factures restent impayées.',
      ],
    },
    {
      id: 's3',
      intitule: 'Discussion — créance de factures',
      traite: 'créance_factures_exigible',
      texte: [
        'Le contrat prévoit le paiement des factures à trente jours de leur émission. Les factures établissent les créances de 12 000 euros et de 8 400 euros, soit 20 400 euros au total.',
        `En application de l'article 1353 du Code civil, Société Exemple SAS justifie les factures et leur échéance. Le relevé constate l'absence de règlement. Il appartient à Société Beta SARL, si elle se prétend libérée, d'établir le paiement ou une autre cause d'extinction. Aucune pièce ne justifie un paiement.`,
      ],
    },
    {
      id: 's7',
      intitule: 'Délai de réclamation contractuel',
      traite: 'réclamation_de_conformité_tardive',
      texte: [
        `La livraison d'avril a été reçue le 5 avril 2025 sans réserve. Le seul courriel de réclamation versé au dossier date du 30 mai 2025, au-delà du délai contractuel de huit jours. La clause du contrat prévoit qu'à défaut de réclamation dans ce délai, les produits sont réputés acceptés sans réserve.`,
      ],
    },
    {
      id: 's9',
      intitule: `Champ d'application de l'exception d'inexécution`,
      traite: 'contrat_de_fourniture_conclu_entre_professionnels',
      texte: [
        `Les parties ont conclu le contrat de fourniture le 10 janvier 2024. L'article 1219 du Code civil, en vigueur à la date de la livraison d'avril, peut être invoqué entre elles si les conditions qu'il prévoit sont réunies. La seule allégation de défauts ne suffit pas à établir leur gravité.`,
      ],
    },
    {
      id: 's8',
      intitule: `Réponse à l'exception d'inexécution`,
      traite: 'exception_d_inexécution_suffisamment_grave',
      texte: [
        'Le contrat prévoit une réclamation écrite dans les huit jours de la livraison, à défaut de quoi les produits sont réputés acceptés sans réserve. La livraison a été reçue le 5 avril 2025 sans réserve. Le seul courriel de réclamation produit date du 30 mai 2025, après le délai contractuel.',
        `Société Beta SARL allègue des défauts d'usinage et annonce suspendre le règlement. Cette allégation ne constitue pas à elle seule un constat technique et aucune pièce n'établit la gravité des défauts. L'article 1219 du Code civil permet de suspendre le paiement seulement si l'inexécution de l'autre partie est suffisamment grave. Sur les pièces produites, le bien-fondé de cette exception demeure contesté et devra être apprécié par le tribunal.`,
      ],
    },
    {
      id: 's5',
      intitule: 'Indemnité forfaitaire pour frais de recouvrement',
      traite: 'indemnité_de_recouvrement_due',
      texte: [
        `Les deux factures professionnelles sont échues et impayées. L'article L. 441-10 du Code de commerce prévoit de plein droit une indemnité forfaitaire en cas de retard de paiement ; l'article D. 441-5 en fixe le montant à 40 euros.`,
        'Société Exemple SAS sollicite 40 euros pour chacune des deux factures, soit 80 euros au total.',
      ],
    },
    {
      id: 's6',
      intitule: 'Par ces motifs',
      texte: [
        'Il est demandé au tribunal de commerce de Lyon de :',
        '— condamner Société Beta SARL à payer à Société Exemple SAS 12 000 euros TTC au titre de la facture F-2025-014 ;',
        '— condamner Société Beta SARL à payer à Société Exemple SAS 8 400 euros TTC au titre de la facture F-2025-021 ;',
        '— condamner Société Beta SARL à payer à Société Exemple SAS 80 euros au titre des indemnités forfaitaires de recouvrement, soit 40 euros par facture impayée ;',
        '— condamner Société Beta SARL aux dépens.',
      ],
    },
  ],
}
