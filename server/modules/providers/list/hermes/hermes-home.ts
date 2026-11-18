import os from 'node:os';
import path from 'node:path';

/** The Hermes root shared by every profile (`~/.hermes`). */
export function getHermesRoot(): string {
  return path.join(os.homedir(), '.hermes');
}

/**
 * The Hermes home this server works with: `HERMES_HOME` when set (a named
 * profile lives in `~/.hermes/profiles/<name>`), otherwise the default profile.
 * Read at call time so a profile chosen at startup applies everywhere.
 */
export function getHermesHome(): string {
  return process.env.HERMES_HOME || getHermesRoot();
}

/** Arguments that select the same profile in a command shown to the user. */
export function getHermesProfileArgs(): string[] {
  const profile = process.env.PIECEMAKER_HERMES_PROFILE;
  return profile ? ['-p', profile] : [];
}
