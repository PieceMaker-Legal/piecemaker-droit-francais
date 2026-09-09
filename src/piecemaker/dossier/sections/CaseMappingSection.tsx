import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Plus, Save, ShieldCheck, Trash2, UserRound, UsersRound } from 'lucide-react';

import { invalidatePmGet, pmGetCached, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import {
  applyProcedureParties,
  buildMappingDocument,
  groupMappingByCode,
  normalizeProcedureInfo,
  profileRelationshipId,
  type MappingDocument,
  type MappingGroup,
  type ProcedureInfo,
  type ProcedureParty,
} from '@/piecemaker/dossier/sections/MappingModel';
import ProcedurePartiesDialog from '@/piecemaker/dossier/sections/ProcedurePartiesDialog';
import { Button, Input } from '@/shared/ui';

type MappingResponse = Partial<MappingDocument> & {
  name: string;
  exists: boolean;
  commit?: { created?: boolean };
};

type ProfileSide = 'client' | 'adversaire';

type RelationshipRole = 'Avocat' | 'Dirigeant' | 'Actionnaire';

type CaseMappingSectionProps = {
  caseId: string;
  refreshVersion: number;
  onRepositoryChange: () => Promise<void>;
};

const RELATIONSHIP_ROLES: RelationshipRole[] = ['Avocat', 'Dirigeant', 'Actionnaire'];
const CUSTOM_RELATIONSHIP_ROLE = 'custom';
const RELATIONSHIP_SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

function normalizedDocument(data: Partial<MappingDocument>): MappingDocument {
  return {
    mapping: data.mapping || {},
    reverse_mapping: data.reverse_mapping || {},
    informations_dossier: normalizeProcedureInfo(data.informations_dossier),
  };
}

function profileIdentity(party: ProcedureParty): string {
  return party.type === 'societe' ? party.societe_nom.trim() : party.nom.trim();
}

function sameIdentity(left: string, right: string): boolean {
  return left.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr') === right.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr');
}

function profileType(group: MappingGroup): ProcedureParty['type'] {
  const code = group.code.toUpperCase();
  return /MORALE|SOCIETE|\b(SAS|SARL|SA|SCI|SELARL|EURL)_/.test(code) || (/^(CLIENT|ADVERSAIRE)_/.test(code) && !code.includes('PHYSIQUE')) ? 'societe' : 'personne_physique';
}

function partyForProfile(info: ProcedureInfo, group: MappingGroup): { side: ProfileSide; party: ProcedureParty } | null {
  for (const [side, parties] of [['client', info.parties_clientes], ['adversaire', info.parties_adverses]] as const) {
    const party = parties.find((candidate) => candidate.mapping_assignments.some((assignment) => sameIdentity(assignment.principal, group.principal)) || sameIdentity(profileIdentity(candidate), group.principal));
    if (party) return { side, party };
  }
  return null;
}

function newParty(group: MappingGroup, side: ProfileSide): ProcedureParty {
  const type = profileType(group);
  return {
    type,
    position: side === 'client' ? 'demandeur' : 'defendeur',
    position_libelle: '',
    civilite: '',
    nom: type === 'personne_physique' ? group.principal : '',
    date_naissance: '',
    lieu_naissance: '',
    adresse: '',
    societe_nom: type === 'societe' ? group.principal : '',
    forme_sociale: '',
    siren: '',
    siege_social: '',
    pays: 'France',
    representant: '',
    mapping_assignments: [],
  };
}

function positionLabel(party: ProcedureParty): string {
  if (party.position === 'autre') return party.position_libelle || 'Autre rôle';
  return ({ demandeur: 'Demandeur', defendeur: 'Défendeur', appelant: 'Appelant', intime: 'Intimé', requerant: 'Requérant', mis_en_cause: 'Mis en cause', intervenant: 'Intervenant' } as Record<string, string>)[party.position] || party.position;
}

function profileLabel(groups: MappingGroup[], code: string): string {
  return groups.find((group) => group.code === code)?.principal || code;
}

function isLawyerRelationship(role: string): boolean {
  return role.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr') === 'avocat';
}

function relationshipRoleChoice(role: string): RelationshipRole | typeof CUSTOM_RELATIONSHIP_ROLE | '' {
  const normalizedRole = role.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr');
  return RELATIONSHIP_ROLES.find((option) => option.toLocaleLowerCase('fr') === normalizedRole) || (role.trim() ? CUSTOM_RELATIONSHIP_ROLE : '');
}

export default function CaseMappingSection({ caseId, refreshVersion, onRepositoryChange }: CaseMappingSectionProps) {
  const [document, setDocument] = useState<MappingDocument | null>(null);
  const [groups, setGroups] = useState<MappingGroup[]>([]);
  const [profileInfo, setProfileInfo] = useState<ProcedureInfo>(normalizeProcedureInfo());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedProfile, setDraggedProfile] = useState<string | null>(null);

  const loadMapping = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await pmGetCached<MappingResponse>('/mapping', { case: caseId });
      const nextDocument = normalizedDocument(data);
      setDocument(nextDocument);
      setGroups(groupMappingByCode(nextDocument.mapping, nextDocument.reverse_mapping));
      setProfileInfo(nextDocument.informations_dossier);
      setMessage(data.exists ? null : 'Ce dossier n’a pas encore de profils détectés.');
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    let active = true;
    pmGetCached<MappingResponse>('/mapping', { case: caseId })
      .then((data) => {
        if (!active) return;
        const nextDocument = normalizedDocument(data);
        setDocument(nextDocument);
        setGroups(groupMappingByCode(nextDocument.mapping, nextDocument.reverse_mapping));
        setProfileInfo(nextDocument.informations_dossier);
        setMessage(data.exists ? null : 'Ce dossier n’a pas encore de profils détectés.');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, refreshVersion]);

  const partyCounts = useMemo(() => ({
    client: profileInfo.parties_clientes.length,
    adversaire: profileInfo.parties_adverses.length,
  }), [profileInfo]);

  const lawyerPreviews = useMemo(() => {
    const previews = new Map<string, string>();
    if (!document) return previews;
    try {
      const preview = applyProcedureParties(buildMappingDocument(groups), document.informations_dossier, profileInfo);
      for (const relationship of preview.informations_dossier.relations) {
        if (isLawyerRelationship(relationship.role) && relationship.source.startsWith('AVOCAT_')) previews.set(relationship.id, relationship.source);
      }
    } catch {
      return previews;
    }
    return previews;
  }, [document, groups, profileInfo]);

  const currentMapping = () => {
    return buildMappingDocument(groups);
  };

  const saveDocument = async (nextDocument: MappingDocument, successMessage: string) => {
    const data = await pmPut<MappingResponse>('/mapping', { case: caseId, ...nextDocument });
    invalidatePmGet('/mapping', { case: caseId });
    const saved = normalizedDocument(data);
    setDocument(saved);
    setGroups(groupMappingByCode(saved.mapping, saved.reverse_mapping));
    setProfileInfo(saved.informations_dossier);
    setMessage(`${successMessage}${data.commit?.created ? ' et commité' : ''}.`);
    await onRepositoryChange();
  };

  const saveProfiles = async () => {
    if (!document) return;
    setSaving(true);
    setError(null);
    try {
      if (profileInfo.relations.some((relation) => !relation.role.trim())) throw new Error('Nommez chaque lien entre profils avant d’enregistrer.');
      const mapping = currentMapping();
      await saveDocument(applyProcedureParties(mapping, document.informations_dossier, profileInfo), 'Profils enregistrés');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const selectParty = (group: MappingGroup, side: ProfileSide) => {
    setProfileInfo((previous) => {
      const selected = partyForProfile(previous, group);
      if (selected?.side === side) return previous;
      const ownKey = side === 'client' ? 'parties_clientes' : 'parties_adverses';
      const otherKey = side === 'client' ? 'parties_adverses' : 'parties_clientes';
      const removeProfile = (party: ProcedureParty) => !sameIdentity(profileIdentity(party), group.principal);
      return {
        ...previous,
        [ownKey]: [...previous[ownKey], selected?.party || newParty(group, side)],
        [otherKey]: previous[otherKey].filter(removeProfile),
      };
    });
    setMessage('Sélection modifiée. Enregistrez les profils pour appliquer le mapping.');
    setError(null);
  };

  const removeParty = (group: MappingGroup) => {
    setProfileInfo((previous) => ({
      ...previous,
      parties_clientes: previous.parties_clientes.filter((party) => !sameIdentity(profileIdentity(party), group.principal)),
      parties_adverses: previous.parties_adverses.filter((party) => !sameIdentity(profileIdentity(party), group.principal)),
    }));
    setMessage('Sélection retirée. Enregistrez les profils pour appliquer le mapping.');
  };

  const addRelationship = (source: string, target: string) => {
    if (source === target) return;
    setProfileInfo((previous) => previous.relations.some((relation) => relation.source === source && relation.target === target)
      ? previous
      : { ...previous, relations: [...previous.relations, { id: profileRelationshipId(source, target, ''), source, original_source: '', target, role: '' }] });
    setDraggedProfile(null);
    setError(null);
  };

  const updateRelationship = (source: string, target: string, role: string) => {
    setProfileInfo((previous) => ({
      ...previous,
      relations: previous.relations.map((relation) => relation.source === source && relation.target === target ? { ...relation, role } : relation),
    }));
  };

  const removeRelationship = (source: string, target: string) => {
    setProfileInfo((previous) => ({ ...previous, relations: previous.relations.filter((relation) => relation.source !== source || relation.target !== target) }));
  };

  const saveParties = async (info: ProcedureInfo) => {
    if (!document) return;
    setSaving(true);
    try {
      if (info.relations.some((relation) => !relation.role.trim())) throw new Error('Nommez chaque lien entre profils avant d’enregistrer.');
      const mapping = currentMapping();
      await saveDocument(applyProcedureParties(mapping, document.informations_dossier, info), 'Profils enregistrés');
      setPartiesOpen(false);
      setError(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !document) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement des profils…</div>;
  if (!document) return <div className="mx-auto max-w-md py-16 text-center text-sm"><p className="text-destructive">{error || 'Profils indisponibles.'}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadMapping()}>Réessayer</Button></div>;

  return (
    <div className="space-y-5 p-4">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-primary/10 via-background to-emerald-500/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Cartographie du dossier</p><h2 className="mt-1 text-lg font-semibold tracking-tight">Profils et liens</h2><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Les profils détectés sont organisés ici. La sélection procédurale et les liens mettent à jour l’anonymisation sans exposer ses identifiants techniques.</p></div>
          <div className="flex shrink-0 gap-2 text-xs">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-700 dark:text-emerald-400">{partyCounts.client} client{partyCounts.client > 1 ? 's' : ''}</span>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-medium text-red-700 dark:text-red-400">{partyCounts.adversaire} adverse{partyCounts.adversaire > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => setPartiesOpen(true)}><UsersRound className="h-3.5 w-3.5" />Ajouter ou modifier des informations</Button>
          <span className="text-xs text-muted-foreground">Les modifications restent en attente jusqu’à l’enregistrement.</span>
        </div>
      </section>

      {groups.length === 0 ? (
        <section className="rounded-2xl border border-dashed p-10 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">Aucun profil détecté</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Lancez un scan PII ou ajoutez une partie à la procédure pour créer le premier profil.</p><Button variant="outline" size="sm" className="mt-4" onClick={() => setPartiesOpen(true)}><Plus className="h-3.5 w-3.5" />Ajouter un profil</Button></section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const selected = partyForProfile(profileInfo, group);
            const related = profileInfo.relations.filter((relation) => relation.target === group.code);
            const company = selected ? selected.party.type === 'societe' : profileType(group) === 'societe';
            return <article key={group.code} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'link'; event.dataTransfer.setData('text/plain', group.code); setDraggedProfile(group.code); }} onDragEnd={() => setDraggedProfile(null)} className={`group relative flex min-h-[17rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md ${selected?.side === 'client' ? 'border-emerald-500/50' : selected?.side === 'adversaire' ? 'border-red-500/50' : ''}`}>
              <div className={`h-1.5 ${selected?.side === 'client' ? 'bg-emerald-500' : selected?.side === 'adversaire' ? 'bg-red-500' : 'bg-primary/40'}`} />
              <div className="flex items-start gap-3 p-4 pb-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${company ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-primary/10 text-primary'}`}>{company ? <Building2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{group.principal}</p><p className="mt-1 text-[11px] text-muted-foreground">{company ? 'Personne morale' : 'Personne physique'} · {group.variants.length + 1} écriture{group.variants.length ? 's' : ''} détectée{group.variants.length ? 's' : ''}</p></div></div>
              <div className="px-4 pb-3">{selected ? <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected.side === 'client' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'}`}>{selected.side === 'client' ? 'Partie cliente' : 'Partie adverse'} · {positionLabel(selected.party)}</div> : <p className="text-[11px] text-muted-foreground">Aucune position procédurale</p>}</div>
              <div className="mx-4 rounded-xl border border-dashed bg-muted/20 p-2.5" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; }} onDrop={(event) => { event.preventDefault(); const source = draggedProfile || event.dataTransfer.getData('text/plain'); if (source) addRelationship(source, group.code); }}>
                {related.length ? (
                  <div className="space-y-2">
                    {related.map((relation) => {
                      const sourceLabel = profileLabel(groups, relation.source);
                      const roleChoice = relationshipRoleChoice(relation.role);
                      return (
                        <div key={relation.id} className="space-y-2 rounded-lg border bg-background/70 p-2">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Profil lié</p>
                              <p className="break-words text-xs font-medium" title={sourceLabel}>{sourceLabel}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeRelationship(relation.source, relation.target)} aria-label={`Supprimer le lien avec ${sourceLabel}`}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                          <label className="block space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            <span>Lien</span>
                            <select
                              className={RELATIONSHIP_SELECT_CLASS}
                              value={roleChoice}
                              onChange={(event) => updateRelationship(relation.source, relation.target, event.target.value === CUSTOM_RELATIONSHIP_ROLE ? 'Autre' : event.target.value)}
                              aria-label={`Lien avec ${sourceLabel}`}
                            >
                              <option value="">Choisir un lien</option>
                              {RELATIONSHIP_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                              <option value={CUSTOM_RELATIONSHIP_ROLE}>Personnalisé</option>
                            </select>
                          </label>
                          {roleChoice === CUSTOM_RELATIONSHIP_ROLE && <Input value={relation.role} onChange={(event) => updateRelationship(relation.source, relation.target, event.target.value)} className="h-8 text-xs" placeholder="Précisez le lien" aria-label={`Lien personnalisé avec ${sourceLabel}`} />}
                          {lawyerPreviews.get(relation.id) && <p className="text-[10px] text-primary">Pseudonyme proposé <span className="font-semibold">{lawyerPreviews.get(relation.id)}</span></p>}
                        </div>
                      );
                    })}
                    <p className="text-center text-[10px] leading-4 text-muted-foreground">Glissez un autre profil ici pour ajouter un lien</p>
                  </div>
                ) : <p className="text-center text-[11px] leading-4 text-muted-foreground">Glissez un profil ici<br />pour établir un lien</p>}
              </div>
              <div className="mt-auto flex gap-2 p-4 pt-3">{selected ? <Button variant="outline" size="sm" className="flex-1" onClick={() => removeParty(group)}>Retirer</Button> : <><Button variant="outline" size="sm" className="flex-1 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400" onClick={() => selectParty(group, 'client')}>Client</Button><Button variant="outline" size="sm" className="flex-1 border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-400" onClick={() => selectParty(group, 'adversaire')}>Adverse</Button></>}<Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setPartiesOpen(true)} aria-label={`Modifier ${group.principal}`}><UsersRound className="h-3.5 w-3.5" /></Button></div>
            </article>;
          })}
        </div>
      )}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className={`min-w-0 flex-1 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || message || 'Glissez un profil sur un autre pour créer un lien.'}</span>
        <Button size="sm" onClick={() => void saveProfiles()} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer les profils</Button>
      </div>

      {partiesOpen && <ProcedurePartiesDialog open mapping={currentMappingSafe(groups)} initialInfo={profileInfo} saving={saving} onOpenChange={setPartiesOpen} onSave={saveParties} />}
    </div>
  );
}

function currentMappingSafe(groups: MappingGroup[]): Pick<MappingDocument, 'mapping' | 'reverse_mapping'> {
  try {
    return buildMappingDocument(groups);
  } catch {
    return { mapping: {}, reverse_mapping: {} };
  }
}
