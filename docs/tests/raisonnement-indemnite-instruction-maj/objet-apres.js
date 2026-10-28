{
  qualification: 'contentieux',
  objectifs: [
    { objectif: `Obtenir le paiement de l'indemnité de départ de 480 000 euros bruts`, obtenir: 'paiement_de_l_indemnité', prescription: 'prescription_action_en_paiement_non_prescrite' },
  ],
  paiement_de_l_indemnité: {
    si: [
      {
        condition: 'engagement_contractuel_opposable',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
      },
      {
        condition: 'conditions_contractuelles_de_versement_remplies',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
      },
      {
        condition: 'delai_contractuel_de_paiement_ecoule',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
      },
      {
        condition: 'prescription_action_en_paiement_non_prescrite',
        selon: [
          { source: 'LEGIARTI000019017112', citation: `Les actions personnelles ou mobilières se prescrivent par cinq ans à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_connaissance_du_refus' }, applicabilite: 'applicabilité_de_l_article_2224' },
        ],
      },
      {
        l_une: [
          {
            condition: 'le_juge_retient_que_le_droit_contractuel_deja_approuve_est_hors_du_vote_ex_post',
            selon: [
              { source: 'LEGIARTI000042338905', citation: `l'assemblée générale statue sur les éléments fixes, variables et exceptionnels composant la rémunération totale et les avantages de toute nature versés au cours de l'exercice écoulé ou attribués au titre du même exercice`, vigueur: { debut: '2021-01-01', fin: null, au: 'date_du_vote_ex_post' }, applicabilite: 'applicabilité_de_l_article_l22_10_34' },
              { source: '683fd4c49fc9cbe0b56b0f7d', citation: `La cour considère donc qu'une indemnité de départ convenue au profit du dirigeant d'une société cotée lui est attribuée, au sens de l'article L. 22-10-34, II, du code de commerce, au jour de son approbation par les actionnaires au cours de l'assemblée générale ayant à se prononcer sur les comptes de l'exercice au cours duquel son contrat de mandat a été conclu` },
            ],
          },
          { condition: 'approbation_ex_post_favorable' },
        ],
        selon: [
          { source: 'LEGIARTI000042338905', citation: `l'assemblée générale statue sur les éléments fixes, variables et exceptionnels composant la rémunération totale et les avantages de toute nature versés au cours de l'exercice écoulé ou attribués au titre du même exercice`, vigueur: { debut: '2021-01-01', fin: null, au: 'date_du_vote_ex_post' }, applicabilite: 'applicabilité_de_l_article_l22_10_34' },
        ],
      },
    ],
  },
  engagement_contractuel_opposable: {
    si: [
      {
        condition: 'engagement_de_depart_decide_par_le_conseil',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: `Le conseil d'administration a décidé le 15 mars 2022 d'accorder à Jean Dupont un engagement d'indemnité de départ.` },
          { piece: 'pieces/05_refus_paiement_conseil.md', citation: `Nous ne contestons ni l'existence de l'engagement reproduit dans l'annexe de l'assemblée générale du 24 mai 2022` },
        ],
      },
      {
        condition: 'engagement_individualise_inclus_dans_politique_approuvee',
        selon: [
          { source: 'LEGIARTI000042338833', citation: `aucun engagement correspondant à des éléments de rémunération, des indemnités ou des avantages dus ou susceptibles d'être dus à raison de la prise, de la cessation ou du changement de leurs fonctions ou postérieurement à l'exercice de celles-ci, ne peut être pris par la société s'il n'est pas conforme à la politique de rémunération approuvée`, vigueur: { debut: '2021-01-01', fin: '2025-10-01', au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_l22_10_8' },
          { source: 'LEGIARTI000042922268', citation: `Les caractéristiques principales et les conditions de résiliation des engagements pris par la société elle-même ou par toute société contrôlée ou qui la contrôle, au sens des II et III de l'article L. 233-16, et correspondant à des éléments de rémunération, des indemnités ou des avantages dus ou susceptibles d'être dus à raison de la cessation ou d'un changement de fonctions`, vigueur: { debut: '2021-01-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_r22_10_14' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: `Elle approuve notamment le principe et les modalités de l'indemnité de départ décrite au paragraphe 4 de l'annexe.` },
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: 'La résolution est adoptée.' },
        ],
      },
      {
        condition: 'dupont_n_a_pas_participe_a_la_deliberation_du_conseil',
        selon: [
          { source: 'LEGIARTI000042338833', citation: `les personnes intéressées ne peuvent prendre part ni aux délibérations ni au vote sur l'élément ou l'engagement concerné`, vigueur: { debut: '2021-01-01', fin: '2025-10-01', au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_l22_10_8' },
        ],
      },
      {
        condition: 'engagement_compatible_avec_la_libre_revocabilite',
        selon: [
          { source: 'JURITEXT000006940172', citation: `une indemnité en cas de révocation du directeur général ou de non-renouvellement de son mandat est illicite comme portant atteinte au principe d'ordre public de la libre révocabilité`, vigueur: { debut: '2002-05-17', fin: null } },
        ],
      },
    ],
  },
  engagement_compatible_avec_la_libre_revocabilite: {
    si: [
      {
        condition: 'indemnite_non_dissuasive_au_regard_de_la_situation_financiere_de_la_societe',
        selon: [
          { source: 'JURITEXT000024821010', citation: `l'engagement qui y était souscrit par la société à son profit, en cas de cessation de ces fonctions, était d'une ampleur susceptible de porter une atteinte majeure à son équilibre financier` },
          { source: 'LEGIARTI000042338833', citation: `aucun engagement correspondant à des éléments de rémunération, des indemnités ou des avantages dus ou susceptibles d'être dus à raison de la prise, de la cessation ou du changement de leurs fonctions ou postérieurement à l'exercice de celles-ci, ne peut être pris par la société s'il n'est pas conforme à la politique de rémunération approuvée`, vigueur: { debut: '2021-01-01', fin: '2025-10-01', au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_l22_10_8' },
        ],
      },
    ],
  },
  indemnite_non_dissuasive_au_regard_de_la_situation_financiere_de_la_societe: {
    si: [
      {
        condition: 'montant_de_l_indemnité',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: 'Son montant est fixé à 480 000 euros bruts.' },
        ],
      },
      {
        condition: 'absence_d_atteinte_majeure_a_l_equilibre_financier_de_la_societe',
        selon: [
          { source: 'JURITEXT000024821010', citation: `l'engagement qui y était souscrit par la société à son profit, en cas de cessation de ces fonctions, était d'une ampleur susceptible de porter une atteinte majeure à son équilibre financier` },
        ],
      },
    ],
  },
  conditions_contractuelles_de_versement_remplies: {
    si: [
      {
        condition: 'revocation_sans_faute_grave_ou_lourde',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/03_lettre_revocation_decembre_2022.md', citation: 'Le conseil ne retient à votre encontre aucune faute grave ou lourde.' },
          { piece: 'pieces/03_lettre_revocation_decembre_2022.md', citation: 'a décidé de mettre fin à vos fonctions de directeur général avec effet le 19 décembre 2022' },
        ],
      },
      {
        condition: 'condition_de_performance_contractuelle_satisfaite',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: 'la moyenne de la marge opérationnelle du groupe au titre des exercices 2020 et 2021 doit être au moins égale à 8 %' },
          { piece: 'pieces/03_lettre_revocation_decembre_2022.md', citation: `que la moyenne de la marge opérationnelle des exercices 2020 et 2021 s'établit à 8,6 %, que la condition de performance fixée par l'engagement est satisfaite` },
          { piece: 'pieces/05_refus_paiement_conseil.md', citation: `Nous ne contestons ni l'existence de l'engagement reproduit dans l'annexe de l'assemblée générale du 24 mai 2022, ni son montant, ni la réalisation de la condition de performance constatée lors de votre révocation.` },
        ],
      },
      {
        condition: 'somme_reclamee_conforme_au_montant_contractuel',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: 'Son montant est fixé à 480 000 euros bruts.' },
          { piece: 'pieces/04_demande_paiement_dirigeant.md', citation: 'Je vous mets en demeure de verser la somme de 480 000 euros bruts.' },
        ],
      },
    ],
  },
  delai_contractuel_de_paiement_ecoule: {
    si: [
      {
        condition: 'trente_jours_depuis_cessation',
        delai: { de: 'date_cessation', a: 'date_de_remise_du_dossier', au_moins: { jours: 30 } },
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        decompte: 'décompte_de_trente_jours_depuis_cessation',
      },
    ],
  },
  prescription_action_en_paiement_non_prescrite: {
    si: [
      {
        condition: 'action_en_paiement_dans_le_delai_de_cinq_ans',
        delai: { de: 'date_de_connaissance_du_refus', a: 'date_de_remise_du_dossier', au_plus: { ans: 5 } },
        selon: [
          { source: 'LEGIARTI000019017112', citation: `Les actions personnelles ou mobilières se prescrivent par cinq ans à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer.`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_connaissance_du_refus' }, applicabilite: 'applicabilité_de_l_article_2224' },
        ],
        decompte: 'décompte_de_la_prescription_de_l_action',
      },
    ],
  },
  approbation_ex_post_favorable: {
    si: [
      {
        condition: 'approbation_favorable_a_l_ag_2023',
        selon: [
          { source: 'LEGIARTI000042338905', citation: `ne peuvent être versés qu'après approbation par une assemblée générale des éléments de rémunération de la personne concernée dans les conditions prévues à l'alinéa précédent`, vigueur: { debut: '2021-01-01', fin: null, au: 'date_du_vote_ex_post' }, applicabilite: 'applicabilité_de_l_article_l22_10_34' },
          { source: '683fd4c49fc9cbe0b56b0f7d', citation: `La cour retient que l'indemnité de départ stipulée au profit du président du directoire d'une société cotée est un élément exceptionnel de rémunération soumis à un vote ex-post individuel.` },
        ],
        contredit: [
          { piece: 'pieces/06_ag_2023_refus_approbation_ex_post.md', citation: `La quinzième résolution n'est pas adoptée.` },
        ],
      },
    ],
  },
  applicabilité_de_l_article_1103: {
    si: [
      {
        condition: 'contrat_conclu_apres_entree_en_vigueur_de_l_article_1103',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' } },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: `Le conseil d'administration a décidé le 15 mars 2022 d'accorder à Jean Dupont un engagement d'indemnité de départ.` },
        ],
      },
    ],
  },
  applicabilité_de_l_article_l22_10_8: {
    si: [
      {
        condition: 'actions_admises_sur_un_marche_reglemente',
        selon: [
          { source: 'LEGIARTI000042338833', citation: 'Dans les sociétés dont les actions sont admises aux négociations sur un marché réglementé', vigueur: { debut: '2021-01-01', fin: '2025-10-01', au: 'date_de_l_engagement' } },
        ],
        preuve: [
          { piece: 'pieces/01_extrait_kbis_et_identification_emetteur.md', citation: 'Les actions ordinaires de Société Exemple SA sont admises, depuis le 15 juin 2015 et sans interruption pendant les exercices 2022 et 2023, aux négociations sur le marché réglementé Euronext Paris.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_r22_10_14: {
    si: [
      {
        condition: 'politique_de_societe_cotee_applicable_a_l_engagement',
        selon: [
          { source: 'LEGIARTI000042922268', citation: `La politique de rémunération mentionnée au I de l'article L. 22-10-8`, vigueur: { debut: '2021-01-01', fin: null, au: 'date_de_l_engagement' } },
        ],
        preuve: [
          { piece: 'pieces/01_extrait_kbis_et_identification_emetteur.md', citation: 'Les actions ordinaires de Société Exemple SA sont admises, depuis le 15 juin 2015 et sans interruption pendant les exercices 2022 et 2023, aux négociations sur le marché réglementé Euronext Paris.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_2224: {
    si: [
      {
        condition: 'action_personnelle_en_paiement',
        selon: [
          { source: 'LEGIARTI000019017112', citation: 'Les actions personnelles ou mobilières se prescrivent par cinq ans', vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_connaissance_du_refus' } },
        ],
        preuve: [
          { piece: 'pieces/04_demande_paiement_dirigeant.md', citation: 'Je vous mets en demeure de verser la somme de 480 000 euros bruts.' },
        ],
      },
    ],
  },
  applicabilité_de_l_article_l22_10_34: {
    si: [
      {
        condition: 'actions_admises_sur_un_marche_reglemente_en_2023',
        selon: [
          { source: 'LEGIARTI000042338905', citation: 'Dans les sociétés dont les actions sont admises aux négociations sur un marché réglementé', vigueur: { debut: '2021-01-01', fin: null, au: 'date_du_vote_ex_post' } },
        ],
        preuve: [
          { piece: 'pieces/01_extrait_kbis_et_identification_emetteur.md', citation: 'Les actions ordinaires de Société Exemple SA sont admises, depuis le 15 juin 2015 et sans interruption pendant les exercices 2022 et 2023, aux négociations sur le marché réglementé Euronext Paris.' },
        ],
      },
    ],
  },
  décompte_de_trente_jours_depuis_cessation: {
    si: [
      {
        condition: 'date_de_cessation_et_delai_de_trente_jours',
        selon: [
          { source: 'LEGIARTI000032040777', citation: 'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.', vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_l_engagement' }, applicabilite: 'applicabilité_de_l_article_1103' },
        ],
        preuve: [
          { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: `L'indemnité est payable dans les trente jours suivant la cessation effective des fonctions.` },
          { piece: 'pieces/03_lettre_revocation_decembre_2022.md', citation: `avec effet le 19 décembre 2022 à l'issue de la réunion.` },
          { piece: 'pieces/04_demande_paiement_dirigeant.md', citation: 'Le délai contractuel de trente jours est écoulé.' },
        ],
      },
    ],
  },
  décompte_de_la_prescription_de_l_action: {
    si: [
      {
        condition: 'connaissance_du_refus_au_plus_tard_le_31_janvier_2023',
        selon: [
          { source: 'LEGIARTI000019017112', citation: `à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer`, vigueur: { debut: '2008-06-19', fin: null, au: 'date_de_connaissance_du_refus' }, applicabilite: 'applicabilité_de_l_article_2224' },
        ],
        preuve: [
          { piece: 'pieces/05_refus_paiement_conseil.md', citation: 'Paris, le 31 janvier 2023' },
        ],
      },
    ],
  },
  valeurs: {
    date_de_l_engagement: {
      valeur: '2022-03-15',
      preuve: [
        { piece: 'pieces/02_ag_2022_approbation_indemnite.md', citation: `Le conseil d'administration a décidé le 15 mars 2022 d'accorder à Jean Dupont un engagement d'indemnité de départ.` },
      ],
    },
    date_du_vote_ex_post: {
      valeur: '2023-05-25',
      preuve: [
        { piece: 'pieces/06_ag_2023_refus_approbation_ex_post.md', citation: 'Assemblée générale ordinaire du 25 mai 2023' },
      ],
    },
    date_cessation: {
      valeur: '2022-12-19',
      preuve: [
        { piece: 'pieces/03_lettre_revocation_decembre_2022.md', citation: `avec effet le 19 décembre 2022 à l'issue de la réunion.` },
      ],
    },
    date_de_connaissance_du_refus: {
      valeur: '2023-01-31',
      preuve: [
        { piece: 'pieces/05_refus_paiement_conseil.md', citation: 'Paris, le 31 janvier 2023' },
      ],
    },
    date_de_remise_du_dossier: {
      valeur: '2026-10-21',
      preuve: [
        { piece: 'README.md', citation: 'Le dossier est confié au conseil le 21 octobre 2026.' },
      ],
    },
  },
  hypotheses: [
    { nom: 'thèse contractuelle retenue et indemnité non dissuasive', faits: { engagement_de_depart_decide_par_le_conseil: vrai, engagement_individualise_inclus_dans_politique_approuvee: vrai, dupont_n_a_pas_participe_a_la_deliberation_du_conseil: vrai, montant_de_l_indemnité: vrai, absence_d_atteinte_majeure_a_l_equilibre_financier_de_la_societe: vrai, engagement_compatible_avec_la_libre_revocabilite: vrai, revocation_sans_faute_grave_ou_lourde: vrai, condition_de_performance_contractuelle_satisfaite: vrai, somme_reclamee_conforme_au_montant_contractuel: vrai, trente_jours_depuis_cessation: vrai, date_cessation: '2022-12-19', date_de_remise_du_dossier: '2026-10-21', connaissance_du_refus_au_plus_tard_le_31_janvier_2023: vrai, le_juge_retient_que_le_droit_contractuel_deja_approuve_est_hors_du_vote_ex_post: vrai, approbation_favorable_a_l_ag_2023: faux, approbation_ex_post_favorable: faux, vote_ex_post_negatif_sur_l_indemnite: vrai, contrat_conclu_apres_entree_en_vigueur_de_l_article_1103: vrai, actions_admises_sur_un_marche_reglemente: vrai, actions_admises_sur_un_marche_reglemente_en_2023: vrai, politique_de_societe_cotee_applicable_a_l_engagement: vrai, action_personnelle_en_paiement: vrai }, attendu: { paiement_de_l_indemnité: vrai } },
    { nom: 'lecture de Versailles retenue face au refus ex post', faits: { engagement_de_depart_decide_par_le_conseil: vrai, engagement_individualise_inclus_dans_politique_approuvee: vrai, dupont_n_a_pas_participe_a_la_deliberation_du_conseil: vrai, montant_de_l_indemnité: vrai, absence_d_atteinte_majeure_a_l_equilibre_financier_de_la_societe: vrai, engagement_compatible_avec_la_libre_revocabilite: vrai, revocation_sans_faute_grave_ou_lourde: vrai, condition_de_performance_contractuelle_satisfaite: vrai, somme_reclamee_conforme_au_montant_contractuel: vrai, trente_jours_depuis_cessation: vrai, date_cessation: '2022-12-19', date_de_remise_du_dossier: '2026-10-21', connaissance_du_refus_au_plus_tard_le_31_janvier_2023: vrai, le_juge_retient_que_le_droit_contractuel_deja_approuve_est_hors_du_vote_ex_post: faux, approbation_favorable_a_l_ag_2023: faux, approbation_ex_post_favorable: faux, vote_ex_post_negatif_sur_l_indemnite: vrai, contrat_conclu_apres_entree_en_vigueur_de_l_article_1103: vrai, actions_admises_sur_un_marche_reglemente: vrai, actions_admises_sur_un_marche_reglemente_en_2023: vrai, politique_de_societe_cotee_applicable_a_l_engagement: vrai, action_personnelle_en_paiement: vrai }, attendu: { paiement_de_l_indemnité: faux } },
  ],
}