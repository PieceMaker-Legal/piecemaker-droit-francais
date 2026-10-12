import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type CommandResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type RunCommand = (binary: string, args: string[], timeoutMs: number) => Promise<CommandResult>;

export type TailscaleStatus = {
  installed: boolean;
  running: boolean;
  dnsName: string | null;
  ownerLogin: string | null;
  httpsEnabled: boolean;
};

export type ServeEntry = { proxy: string | null; funnel: boolean };

export const runCommand: RunCommand = (binary, args, timeoutMs) => new Promise((resolve) => {
  execFile(binary, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
    const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
    resolve({
      code: failure ? (typeof failure.code === 'number' ? failure.code : -1) : 0,
      stdout: String(stdout || ''),
      stderr: failure && failure.code === 'ENOENT' ? 'ENOENT' : String(stderr || ''),
      timedOut: Boolean(failure?.killed),
    });
  });
});

export function tailscaleCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') {
    return ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  }
  if (platform === 'win32') {
    const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean) as string[];
    return programFiles.map((root) => path.win32.join(root, 'Tailscale', 'tailscale.exe'));
  }
  return ['/usr/bin/tailscale', '/usr/local/bin/tailscale'];
}

export function findTailscale(exists: (file: string) => boolean = existsSync, platform: NodeJS.Platform = process.platform): string {
  return tailscaleCandidates(platform).find((file) => exists(file)) || 'tailscale';
}

export function parseStatus(json: string): Omit<TailscaleStatus, 'installed'> {
  const status = JSON.parse(json);
  const self = status.Self || {};
  const owner = status.User?.[String(self.UserID)] || null;
  return {
    running: status.BackendState === 'Running',
    dnsName: typeof self.DNSName === 'string' && self.DNSName ? self.DNSName.replace(/\.$/, '') : null,
    ownerLogin: typeof owner?.LoginName === 'string' ? owner.LoginName : null,
    httpsEnabled: Array.isArray(status.CertDomains) && status.CertDomains.length > 0,
  };
}

export function parseServeEntry(json: string, dnsName: string, httpsPort: number): ServeEntry {
  const config = json.trim() ? JSON.parse(json) : {};
  const hostPort = `${dnsName}:${httpsPort}`;
  const proxy = config.Web?.[hostPort]?.Handlers?.['/']?.Proxy;
  return { proxy: typeof proxy === 'string' ? proxy : null, funnel: Boolean(config.AllowFunnel?.[hostPort]) };
}

export function consentUrl(output: string): string | null {
  return output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0] || null;
}

export function createTailscale(binary: string = findTailscale(), run: RunCommand = runCommand) {
  return {
    async status(): Promise<TailscaleStatus> {
      const result = await run(binary, ['status', '--json'], 10_000);
      if (result.stderr === 'ENOENT') return { installed: false, running: false, dnsName: null, ownerLogin: null, httpsEnabled: false };
      try {
        return { installed: true, ...parseStatus(result.stdout) };
      } catch {
        return { installed: true, running: false, dnsName: null, ownerLogin: null, httpsEnabled: false };
      }
    },

    async serveEntry(dnsName: string, httpsPort: number): Promise<ServeEntry> {
      const result = await run(binary, ['serve', 'status', '--json'], 10_000);
      if (result.code !== 0) throw new Error(result.stderr.trim() || 'Lecture de la configuration Tailscale Serve impossible.');
      return parseServeEntry(result.stdout, dnsName, httpsPort);
    },

    async serve(httpsPort: number, target: string): Promise<{ consentUrl: string | null }> {
      const result = await run(binary, ['serve', '--bg', '--yes', `--https=${httpsPort}`, target], 20_000);
      const url = consentUrl(`${result.stdout}\n${result.stderr}`);
      if (url) return { consentUrl: url };
      if (result.code !== 0 || result.timedOut) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Tailscale Serve n’a pas répondu.');
      return { consentUrl: null };
    },

    async stop(httpsPort: number): Promise<void> {
      const result = await run(binary, ['serve', `--https=${httpsPort}`, 'off'], 10_000);
      if (result.code !== 0) throw new Error(result.stderr.trim() || 'Arrêt de Tailscale Serve impossible.');
    },
  };
}

export type Tailscale = ReturnType<typeof createTailscale>;
