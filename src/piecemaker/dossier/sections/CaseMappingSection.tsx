import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, EllipsisVertical, Fingerprint, Loader2, MapPin, Plus, Save, ShieldCheck, Tag, Trash2, UserRound, UsersRound } from 'lucide-react';

import { invalidatePmGet, pmGetCached, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import {
  applyProcedureParties,
  buildMappingDocument,
  MappingValidationError,
  groupMappingByCode,
  normalizeProcedureInfo,
  partyCategoryForCode,
  profileRelationshipId,
  sortMappingGroupsByProcedureParty,
  updateProcedurePartyForProfile,
  type MappingDocument,
  type MappingGroup,
  type ProcedureInfo,
  type ProcedureParty,
} from '@/piecemaker/dossier/sections/MappingModel';
import CaseMappingDialog from '@/piecemaker/dossier/sections/CaseMappingDialog';
import ProcedurePartyProfileDialog from '@/piecemaker/dossier/sections/ProcedurePartyProfileDialog';
import { ActionMenu, Button, Input } from '@/shared/ui';

type MappingResponse = Partial<MappingDocument> & {
  name: string;
  exists: boolean;
  commit?: { created?: boolean };
};

type ProfileSide = 'client' | 'adversaire';
type ProfileEditSide = ProfileSide | 'tiers';

type RelationshipRole = 'Avocat' | 'Dirigeant' | 'Actionnaire';

type CaseMappingSectionProps = {
  caseId: string;
  refreshVersion: number;
  onRepositoryChange: () => Promise<void>;
};

const PROFILE_KINDS: Record<string, { label: string; icon: typeof UserRound; badgeClass: string; canBeProcedureParty: boolean }> = {
  personnes_physiques: { label: 'Personne physique', icon: UserRound, badgeClass: 'bg-primary/10 text-primary', canBeProcedureParty: true },
  societes: { label: 'Personne morale', icon: Building2, badgeClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', canBeProcedureParty: true },
  adresses: { label: 'Adresse', icon: MapPin, badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', canBeProcedureParty: false },
  siren: { label: 'Identifiant d’entreprise', icon: Fingerprint, badgeClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', canBeProcedureParty: false },
  autres: { label: 'Autre donnée personnelle', icon: Tag, badgeClass: 'bg-muted text-muted-foreground', canBeProcedureParty: false },
};

const RELATIONSHIP_ROLES: RelationshipRole[] = ['Avocat', 'Dirigeant', 'Actionnaire'];
const CUSTOM_RELATIONSHIP_ROLE = 'custom';
const RELATIONSHIP_SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

function normalizedDocument(data: Partial<MappingDocument>): MappingDocument {
  const mapping = data.mapping || {};
  const reverseMapping = data.reverse_mapping || {};
  const information = normalizeProcedureInfo(data.informations_dossier);
  const codeAliases = new Map<string, string>();
  for (const party of [...information.parties_clientes, ...information.parties_adverses]) {
    for (const assignment of party.mapping_assignments) {
      if (assignment.original_code && assignment.code) codeAliases.set(assignment.original_code, assignment.code);
      for (const variant of assignment.variants) {
        const currentCode = mapping[variant];
        if (currentCode && assignment.code) codeAliases.set(currentCode, assignment.code);
      }
    }
  }
  const resolveCurrentCode = (code: string): string => {
    const seen = new Set<string>();
    let current = code;
    while (!seen.has(current)) {
      seen.add(current);
      const next = codeAliases.get(current);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  };
  return {
    mapping,
    reverse_mapping: reverseMapping,
    informations_dossier: {
      ...information,
      relations: information.relations.map((relation) => ({
        ...relation,
        source: resolveCurrentCode(relation.source),
        target: resolveCurrentCode(relation.target),
      })),
    },
  };
}

function profileIdentity(party: ProcedureParty): string {
  return party.type === 'societe' ? party.societe_nom.trim() : party.nom.trim();
}

function sameIdentity(left: string, right: string): boolean {
  return left.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr') === right.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr');
}

function profileType(group: MappingGroup): ProcedureParty['type'] {
  return partyCategoryForCode(group.code) === 'societes' ? 'societe' : 'personne_physique';
}

function partyForProfile(info: ProcedureInfo, group: MappingGroup): { side: ProfileSide; party: ProcedureParty } | null {
  for (const [side, parties] of [['client', info.parties_clientes], ['adversaire', info.parties_adverses]] as const) {
    const party = parties.find((candidate) => partyMatchesProfile(candidate, group));
    if (party) return { side, party };
  }
  return null;
}

function partyMatchesProfile(party: ProcedureParty, group: MappingGroup): boolean {
  return party.mapping_assignments.some((assignment) => sameIdentity(assignment.principal, group.principal)) || sameIdentity(profileIdentity(party), group.principal);
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

function newProfileGroup(groups: MappingGroup[]): MappingGroup {
  const usedCodes = new Set(groups.flatMap((group) => [group.code, group.principal, ...group.variants]));
  let number = 1;
  let code = '';
  do {
    code = `PERSONNE_PHYSIQUE_${String(number).padStart(2, '0')}`;
    number += 1;
  } while (usedCodes.has(code));
  return { code, principal: code, variants: [] };
}

function updateProfilePrincipal(groups: MappingGroup[], profile: MappingGroup, party: ProcedureParty, detectedVariants?: string[]): MappingGroup[] {
  const principal = profileIdentity(party);
  if (!principal) return groups;
  return groups.map((group) => {
    if (group.code !== profile.code) return group;
    const variants = [...new Set(detectedVariants || [group.principal, ...group.variants])]
      .filter((variant) => variant.trim() && !sameIdentity(variant, principal));
    return {
      ...group,
      principal,
      variants,
    };
  });
}

export default function CaseMappingSection({ caseId, refreshVersion, onRepositoryChange }: CaseMappingSectionProps) {
  const [document, setDocument] = useState<MappingDocument | null>(null);
  const [groups, setGroups] = useState<MappingGroup[]>([]);
  const [profileInfo, setProfileInfo] = useState<ProcedureInfo>(normalizeProcedureInfo());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileToEdit, setProfileToEdit] = useState<MappingGroup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedProfile, setDraggedProfile] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [invalidRow, setInvalidRow] = useState<number | null>(null);

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

  const sortedGroups = useMemo(() => sortMappingGroupsByProcedureParty(groups, profileInfo), [groups, profileInfo]);

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

  const removeProfile = (group: MappingGroup) => {
    setGroups((previous) => previous.filter((candidate) => candidate.code !== group.code));
    setProfileInfo((previous) => {
      const belongsToProfile = (party: ProcedureParty) => party.mapping_assignments.some((assignment) => sameIdentity(assignment.principal, group.principal)) || sameIdentity(profileIdentity(party), group.principal);
      return {
        ...previous,
        parties_clientes: previous.parties_clientes.filter((party) => !belongsToProfile(party)),
        parties_adverses: previous.parties_adverses.filter((party) => !belongsToProfile(party)),
        relations: previous.relations.filter((relation) => relation.source !== group.code && relation.target !== group.code),
      };
    });
    setProfileToEdit((current) => current?.code === group.code ? null : current);
    setMessage('Profil supprimé. Enregistrez les profils pour appliquer la suppression.');
    setError(null);
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

  const saveProfile = async (side: ProfileEditSide, party: ProcedureParty, detectedVariants: string[]) => {
    if (!document || !profileToEdit) return;
    setSaving(true);
    setError(null);
    try {
      const nextInfo = side === 'tiers'
        ? {
          ...profileInfo,
          parties_clientes: profileInfo.parties_clientes.filter((candidate) => !partyMatchesProfile(candidate, profileToEdit)),
          parties_adverses: profileInfo.parties_adverses.filter((candidate) => !partyMatchesProfile(candidate, profileToEdit)),
        }
        : updateProcedurePartyForProfile(profileInfo, profileToEdit, side, party);
      if (nextInfo.relations.some((relation) => !relation.role.trim())) throw new Error('Nommez chaque lien entre profils avant d’enregistrer.');
      const nextGroups = side === 'tiers'
        ? groups
        : updateProfilePrincipal(groups, profileToEdit, party, detectedVariants);
      const mapping = buildMappingDocument(nextGroups);
      await saveDocument(applyProcedureParties(mapping, document.informations_dossier, nextInfo), 'Profils enregistrés');
      setProfileToEdit(null);
      setError(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !document) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement des profils…</div>;
  if (!document) return <div className="mx-auto max-w-md py-16 text-center text-sm"><p className="text-destructive">{error || 'Profils indisponibles.'}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadMapping()}>Réessayer</Button></div>;

  const saveMappingOnly = async () => {
    if (!document) return;
    setSaving(true);
    setError(null);
    setInvalidRow(null);
    try {
      const mapping = buildMappingDocument(groups);
      await saveDocument({ ...mapping, informations_dossier: document.informations_dossier }, 'Mapping enregistré');
      setMappingOpen(false);
    } catch (cause) {
      if (cause instanceof MappingValidationError) setInvalidRow(cause.rowIndex ?? null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const promoteToParty = (group: MappingGroup) => {
    setMappingOpen(false);
    setProfileToEdit(group);
  };

  const addParty = () => {
    const group = newProfileGroup(groups);
    setGroups((previous) => [...previous, group]);
    setProfileToEdit(group);
    setMessage('Nouvelle partie ajoutée. Renseignez sa position puis enregistrez.');
    setError(null);
  };

  const renderProfileCard = (group: MappingGroup) => {
    const selected = partyForProfile(profileInfo, group);
    const related = profileInfo.relations.filter((relation) => relation.target === group.code);
    const kind = selected
      ? (selected.party.type === 'societe' ? 'societes' : 'personnes_physiques')
      : partyCategoryForCode(group.code);
    const profileKind = PROFILE_KINDS[kind] || PROFILE_KINDS.autres;
    const KindIcon = profileKind.icon;
    return <article key={group.code} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'link'; event.dataTransfer.setData('text/plain', group.code); setDraggedProfile(group.code); }} onDragEnd={() => setDraggedProfile(null)} className={`group relative flex min-h-[17rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md ${selected?.side === 'client' ? 'border-emerald-500/50' : selected?.side === 'adversaire' ? 'border-red-500/50' : ''}`}>
              <div className={`h-1.5 ${selected?.side === 'client' ? 'bg-emerald-500' : selected?.side === 'adversaire' ? 'bg-red-500' : 'bg-primary/40'}`} />
              <div className="flex items-start gap-3 p-4 pb-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${profileKind.badgeClass}`}><KindIcon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{group.principal}</p><p className="mt-1 text-[11px] text-muted-foreground">{profileKind.label} · {group.variants.length + 1} écriture{group.variants.length ? 's' : ''} détectée{group.variants.length ? 's' : ''}</p></div><ActionMenu label="" icon={EllipsisVertical} iconOnly variant="ghost" size="icon" ariaLabel={`Options pour ${group.principal}`} triggerClassName="h-8 w-8 shrink-0" menuClassName="min-w-[150px]" items={[{ key: 'edit', label: 'Modifier', icon: UsersRound, onSelect: () => setProfileToEdit(group) }, { key: 'delete', label: 'Supprimer', icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: () => removeProfile(group) }]} /></div>
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
              
            </article>;
  };

  const clientGroups = sortedGroups.filter((group) => partyForProfile(profileInfo, group)?.side === 'client');
  const adverseGroups = sortedGroups.filter((group) => partyForProfile(profileInfo, group)?.side === 'adversaire');

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setMappingOpen(true)}><Tag className="h-3.5 w-3.5" />Mapping</Button>
        <Button variant="outline" size="sm" onClick={addParty}><Plus className="h-3.5 w-3.5" />Ajouter une partie</Button>
      </div>

      {clientGroups.length === 0 && adverseGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">Aucune partie désignée</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Ouvrez le mapping pour désigner une entité détectée comme partie, ou ajoutez une partie.</p><Button variant="outline" size="sm" className="mt-4" onClick={() => setMappingOpen(true)}><Tag className="h-3.5 w-3.5" />Ouvrir le mapping</Button></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3" role="region" aria-label="Parties clientes">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Parties clientes</h3>
            {clientGroups.length === 0
              ? <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Aucune partie cliente désignée.</p>
              : <div className="space-y-4">{clientGroups.map((group) => renderProfileCard(group))}</div>}
          </div>
          <div className="space-y-3" role="region" aria-label="Parties adverses">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Parties adverses</h3>
            {adverseGroups.length === 0
              ? <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Aucune partie adverse désignée.</p>
              : <div className="space-y-4">{adverseGroups.map((group) => renderProfileCard(group))}</div>}
          </div>
        </div>
      )}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className={`min-w-0 flex-1 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || message || 'Glissez un profil sur un autre pour créer un lien.'}</span>
        <Button size="sm" onClick={() => void saveProfiles()} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer les profils</Button>
      </div>

      <CaseMappingDialog
        open={mappingOpen}
        groups={groups}
        saving={saving}
        invalidRowIndex={invalidRow}
        onOpenChange={setMappingOpen}
        onChange={setGroups}
        onSave={() => void saveMappingOnly()}
        onPromote={promoteToParty}
      />

      {profileToEdit && <ProcedurePartyProfileDialog
        open
        mapping={currentMappingSafe(groups)}
        group={profileToEdit}
        initialParty={partyForProfile(profileInfo, profileToEdit)?.party || newParty(profileToEdit, 'client')}
        initialSide={partyForProfile(profileInfo, profileToEdit)?.side || 'tiers'}
        saving={saving}
        onOpenChange={(open) => { if (!open) setProfileToEdit(null); }}
        onSave={saveProfile}
      />}
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
