type ShellResult = {
  exitCode: number | null;
  output: string;
  errorOutput: string;
};

export type DesktopUpdateDependencies = {
  appRoot: string;
  platform: NodeJS.Platform;
  repository: string | null;
  applicationPid: number;
  environment: NodeJS.ProcessEnv;
  runInstaller(command: string, environment: NodeJS.ProcessEnv): Promise<ShellResult>;
  launchDetached(command: string): void;
  logInfo(message: string): void;
};

export type DesktopUpdateResult =
  | { success: true; output: string; message: string }
  | { success: false; error: string; output?: string; errorOutput?: string };

const MAC_BUNDLE_APP_ROOT = /^(.+\.app)\/Contents\/Resources\/app\/?$/;
const SERVER_ONLY_VARIABLES = ['ELECTRON_RUN_AS_NODE', 'HOST', 'SERVER_PORT', 'PORT', 'CLOUDCLI_HOME', 'DATABASE_PATH'];
const RELAUNCH_DELAY_SECONDS = 3;
const QUIT_GRACE_SECONDS = 30;
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function withoutAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function desktopBundlePath(appRoot: string, platform: NodeJS.Platform): string | null {
  if (platform !== 'darwin') return null;
  return MAC_BUNDLE_APP_ROOT.exec(appRoot)?.[1] ?? null;
}

export function installerCommand(repository: string): string {
  const scriptUrl = `https://raw.githubusercontent.com/${repository}/main/desktop-bootstrap/install.sh`;
  return `curl -fsSL ${shellQuote(scriptUrl)} | sh -s -- --no-launch`;
}

export function relaunchCommand(bundlePath: string, applicationPid: number): string {
  const bundle = shellQuote(bundlePath);
  return [
    `sleep ${RELAUNCH_DELAY_SECONDS}`,
    `osascript -e ${shellQuote(`tell application "${bundlePath}" to quit`)} >/dev/null 2>&1`,
    `i=0; while kill -0 ${applicationPid} 2>/dev/null && [ $i -lt ${QUIT_GRACE_SECONDS} ]; do sleep 1; i=$((i+1)); done`,
    `kill ${applicationPid} 2>/dev/null`,
    'sleep 1',
    `open ${bundle}`,
  ].join('; ');
}

export function installerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...environment };
  for (const variable of SERVER_ONLY_VARIABLES) delete cleaned[variable];
  return cleaned;
}

export function createDesktopUpdateService(dependencies: DesktopUpdateDependencies) {
  const { repository } = dependencies;
  const bundlePath = repository ? desktopBundlePath(dependencies.appRoot, dependencies.platform) : null;

  return {
    isDesktopInstall(): boolean {
      return bundlePath !== null;
    },

    async update(): Promise<DesktopUpdateResult> {
      if (!bundlePath || !repository) {
        return { success: false, error: "Mise à jour intégrée disponible uniquement dans l'application de bureau macOS." };
      }

      dependencies.logInfo(`Mise à jour de ${bundlePath} depuis ${repository}`);
      const result = await dependencies.runInstaller(
        installerCommand(repository),
        installerEnvironment(dependencies.environment),
      );

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: "Échec du téléchargement ou de l'installation de la nouvelle version",
          output: withoutAnsi(result.output),
          errorOutput: withoutAnsi(result.errorOutput),
        };
      }

      dependencies.launchDetached(relaunchCommand(bundlePath, dependencies.applicationPid));
      return {
        success: true,
        output: withoutAnsi(result.output),
        message: "Nouvelle version installée. L'application redémarre dans quelques secondes.",
      };
    },
  };
}
