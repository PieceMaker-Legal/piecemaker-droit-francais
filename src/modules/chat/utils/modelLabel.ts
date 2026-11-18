/**
 * Model families, in the spelling they are shown in. The provider reports a
 * full id (`claude-opus-5-5`, `claude-haiku-4-5-20251001`); the label names the
 * family and its release (`Opus 5.5`, `Haiku 4.5`) so the exact model that
 * answered is visible, and the full id stays in the tooltip.
 */
const MODEL_FAMILY_LABELS: ReadonlyArray<readonly [token: string, label: string]> = [
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
  ['fable', 'Fable'],
];

/** `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `opus`, `claude-opus-5[1m]`. */
const CLAUDE_MODEL_ID = /^(?:claude-)?([a-z]+)(?:-(\d+)(?:-(\d{1,2}))?)?(?:-\d{8})?(\[1m\])?$/;

/**
 * Shortens a reported model id to the label shown under a reply and in the
 * composer, or `null` when there is nothing to show. Used by chat's
 * MessageModelLabel and ComposerModelMenu.
 *
 * An id from no known family is shown verbatim rather than dropped, so an
 * unrecognized model still reports itself honestly. A `[1m]` suffix is kept as
 * "1M" instead of being folded into the base model: Claude Code writes the
 * base id on assistant rows today, but if a provider ever reports the 1M
 * variant it must not read as the 200K one.
 */
export const formatAnsweringModelLabel = (model: string | undefined | null): string | null => {
  const reportedModel = model?.trim();
  if (!reportedModel) {
    return null;
  }

  const normalized = reportedModel.toLowerCase();
  const contextSuffix = normalized.endsWith('[1m]') ? ' 1M' : '';
  const match = CLAUDE_MODEL_ID.exec(normalized);
  const exactFamily = match ? MODEL_FAMILY_LABELS.find(([token]) => token === match[1]) : undefined;
  if (match && exactFamily) {
    const version = match[2] ? ` ${match[2]}${match[3] ? `.${match[3]}` : ''}` : '';
    return `${exactFamily[1]}${version}${contextSuffix}`;
  }

  // Older id shapes (`claude-3-5-sonnet-20241022`) still name their family.
  const family = MODEL_FAMILY_LABELS.find(([token]) => normalized.includes(token));
  if (!family) {
    return reportedModel;
  }

  return `${family[1]}${contextSuffix}`;
};
