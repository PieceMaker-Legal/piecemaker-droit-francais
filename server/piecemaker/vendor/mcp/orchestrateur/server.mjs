import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRelayServer, decisionFields, replyFields } from './client.mjs';

const text = z.string().min(1);
const optionalText = text.optional();
const contextIds = z.array(text).optional().describe('Identifiants des messages du projet à transmettre au fil.');
const provider = z.enum(['auto', 'claude', 'codex', 'mistral']).optional();
const thread = {
  title: text, instructions: text,
  provider: provider.describe('Avec auto, le serveur choisit un fournisseur connecté.'),
};
const reaction = { message_id: text, emoji: text };
const steps = z.array(z.object({
  label: text,
  status: z.enum(['todo', 'doing', 'done']).describe('Étape à faire, en cours ou terminée.'),
})).optional();
const positiveInteger = z.number().int().positive();
const perProvider = schema => z.strictObject({ claude: schema, codex: schema, mistral: schema }).partial().optional();

export function createServer() {
  return createRelayServer('orchestrateur', {
    post_message: ['Publie un message dans le chat du projet.', {
      ...replyFields,
      decision_ids: z.array(text).optional().describe('Identifiants des décisions à joindre au message.'),
      notify: z.boolean().optional().describe('Envoyer aussi une notification à l’avocat.'),
    }],
    edit_message: ['Corrige un message de l’orchestrateur.', { message_id: text, text }],
    react: ['Ajoute une réaction de l’orchestrateur à un message.', reaction],
    unreact: ['Retire une réaction de l’orchestrateur.', reaction],
    post_widget: ['Publie une carte interactive. Une action de l’avocat déclenche un événement widget_action.', {
      type: z.enum(['buttons', 'draft', 'comparison', 'steps']), title: optionalText, body: z.string().optional(),
      buttons: z.array(z.object({
        action_id: text.describe('Identifiant renvoyé dans widget_action après le clic.'),
        label: text,
        style: z.enum(['primary', 'secondary', 'danger']).optional(),
      })).optional(),
      draft: z.object({ to: z.string().optional(), subject: z.string().optional(), body: z.string() }).optional(),
      columns: z.array(z.string()).optional(),
      rows: z.array(z.object({
        label: text,
        cells: z.array(z.string()).describe('Valeurs de la ligne dans l’ordre des colonnes.'),
      })).optional(),
      steps,
    }],
    update_widget: ['Met à jour une carte déjà publiée.', { message_id: text, steps, body: z.string().optional() }],
    ask_decision: ['Publie une carte de décision. Le choix de l’avocat revient dans un événement decision.', decisionFields],
    close_decision: ['Ferme une décision en enregistrant un choix ou en retirant la carte.', {
      decision_id: text,
      chose: z.number().int().min(0).max(3).optional().describe('Index du choix, à partir de zéro. Omettre pour retirer la décision.'),
    }],
    post_thread_card: ['Présente la décision d’un fil dans le chat du projet et transmet le choix au fil.', {
      decision_id: text, text: optionalText,
    }],
    start_thread: ['Crée un fil, publie sa carte et lance le travail ou le met en attente.', {
      ...thread,
      ack_project: text.describe('Message publié avec la carte du fil dans le chat du projet.'),
      ack_thread: text.describe('Message d’ouverture transmis au fil.'),
      context_message_ids: contextIds,
      model: optionalText,
      effort: optionalText.describe('Niveau de raisonnement du modèle.'),
      folder: optionalText.describe('Dossier de travail du fil. Un dossier non autorisé exige l’accord de l’avocat.'),
    }],
    message_thread: ['Envoie un message au fil. Un fil résolu se rouvre et un fil occupé reçoit le message au prochain tour.', {
      thread_id: text, text, context_message_ids: contextIds,
    }],
    read_thread: ['Lit les réponses, les livrables et les derniers messages du fil.', {
      thread_id: text,
      limit: positiveInteger.optional().describe('Nombre maximal de réponses et de messages récents, 20 par défaut.'),
    }],
    list_threads: ['Liste les fils par activité avec leur état et leurs livrables.', {
      state: z.enum(['queued', 'working', 'blocked', 'review_ready', 'done', 'failed', 'stopped']).optional(),
    }],
    rename_thread: ['Renomme le fil.', { thread_id: text, title: text }],
    set_thread_resolved: ['Marque le fil comme terminé ou le remet en relecture.', {
      thread_id: text, resolved: z.boolean().describe('Vrai pour terminer le fil, faux pour le remettre en relecture.'),
    }],
    set_thread_reminder: ['Programme ou annule un rappel pour le fil.', {
      thread_id: text, days: z.number().min(0).max(30).describe('Délai en jours, de 0 à 30. Zéro annule le rappel.'),
    }],
    switch_model: ['Change le modèle ou son niveau de raisonnement pour les prochains tours du fil.', {
      thread_id: text, model: optionalText, effort: optionalText.describe('Niveau de raisonnement du modèle.'),
    }],
    send_later: ['Programme un rappel unique à destination de l’orchestrateur.', {
      text,
      at: z.iso.datetime({ offset: true }).describe('Date et heure du rappel au format ISO 8601, avec fuseau horaire.'),
    }],
    create_routine: ['Programme le lancement récurrent d’un fil.', {
      cron: text.describe('Cinq champs dans l’ordre minute, heure, jour du mois, mois et jour de la semaine.'), ...thread,
    }],
    delete_routine: ['Supprime une routine.', { routine_id: text }],
    list_routines: ['Liste les routines du projet.', {}],
    lookup: ['Lance une recherche rapide en lecture seule.', { question: text }],
    read_memory: ['Lit la mémoire du projet et sa révision.', {}],
    update_memory: ['Remplace le texte complet de la mémoire si la révision est à jour.', {
      text: z.string(),
      revision: z.number().int().nonnegative().describe('Révision de la mémoire renvoyée par read_memory.'),
    }],
    get_project_settings: ['Lit les réglages du projet.', {}],
    update_project_settings: ['Modifie les réglages fournis pour le projet.', {
      instructions: z.string().optional(), orchestrator_provider: provider, orchestrator_model: z.string().optional(),
      default_provider: provider.describe('Fournisseur par défaut des nouveaux fils.'),
      default_models: perProvider(text).describe('Modèle des nouveaux fils pour chaque fournisseur.'),
      concurrency: perProvider(positiveInteger).describe('Nombre maximal de fils simultanés par fournisseur.'),
      folders: z.array(text).optional().describe('Dossiers supplémentaires autorisés pour les fils. Tout nouvel accès exige l’accord de l’avocat.'),
      recycle_after: positiveInteger.optional().describe('Nombre de tours avant le renouvellement de la session de l’orchestrateur.'),
    }],
    list_providers: ['Indique quels fournisseurs sont installés et connectés.', {}],
    list_devices: ['Liste les dossiers connus et indique ceux auxquels les fils peuvent accéder.', {}],
    suggest_connectors: ['Propose à l’avocat de connecter un fournisseur ou un connecteur.', {
      target: text.describe('Nom du fournisseur ou du connecteur de la Bibliothèque à connecter.'),
      reconnect: z.boolean().optional().describe('Proposer une reconnexion au service.'),
      reason: optionalText,
    }],
    list_thread_connectors: ['Liste les serveurs MCP déclarés dans le dossier du fil.', { thread_id: text }],
    list_project_artifacts: ['Liste les artifacts du projet.', {}],
    list_deliverables: ['Liste les livrables du projet.', {}],
    update_deliverable: ['Crée ou met à jour un livrable du projet.', {
      deliverable_id: optionalText.describe('Identifiant du livrable existant. Omettre pour en créer un.'),
      kind: z.enum(['document', 'piece', 'artifact']).optional(),
      ref: optionalText.describe('Chemin relatif au dossier ou référence de l’artifact. Obligatoire à la création.'),
      title: optionalText,
      state: z.enum(['brouillon', 'a_relire']).optional().describe('État du livrable. Seul l’avocat peut le valider.'),
      thread_id: optionalText,
    }],
    propose_project_setup: ['Propose une mise en route. L’accord de l’avocat applique les instructions et lance les fils.', {
      instructions: optionalText, threads: z.array(z.object(thread)).describe('Fils à lancer après l’accord de l’avocat.'),
    }],
    no_reply_needed: ['Termine le tour sans publier de réponse.', {
      reason: z.enum(['nothing_to_add', 'not_for_me', 'holding_updates']).describe('Rien à ajouter, message destiné à un autre agent ou nouvelles à regrouper.'),
    }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createServer().connect(new StdioServerTransport());
}
