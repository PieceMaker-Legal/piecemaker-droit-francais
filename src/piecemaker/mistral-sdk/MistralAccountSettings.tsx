import { useEffect, useRef, useState } from 'react';

import { mistralSdkApi } from '@/shared/api';
import type { MistralSdkAuthStatus } from '@/shared/types';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';

export function MistralAccountSettings({ onConnected }: { onConnected?: () => void } = {}) {
  const notified = useRef(false);
  const [status, setStatus] = useState<MistralSdkAuthStatus | null>(null);
  const [busy, setBusy] = useState<'login' | 'logout' | 'check' | null>(null);
  const [error, setError] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [checkResult, setCheckResult] = useState('');

  useEffect(() => {
    if (status?.authenticated && !notified.current) {
      notified.current = true;
      onConnected?.();
    } else if (status && !status.authenticated) notified.current = false;
  }, [status, onConnected]);

  useEffect(() => {
    let active = true;
    const refresh = () => mistralSdkApi.status().then(value => {
      if (active) setStatus(value);
    }).catch(cause => { if (active) setError(cause.message); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const pending = status?.loginState === 'pending';
  const connect = async () => {
    setBusy('login');
    setError('');
    setCheckResult('');
    try {
      const { url } = await mistralSdkApi.login();
      setLoginUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      setStatus(await mistralSdkApi.status());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(null); }
  };

  const disconnect = async () => {
    setBusy('logout');
    setError('');
    try {
      setStatus(await mistralSdkApi.logout());
      setLoginUrl('');
      setCheckResult('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };

  const check = async () => {
    setBusy('check');
    setError('');
    setCheckResult('');
    try { setCheckResult((await mistralSdkApi.check()).response); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-6" data-testid="mistral-sdk-account">
      <div className="flex items-center gap-3">
        <LLMProviderLogo provider="mistral" className="h-6 w-6" />
        <div>
          <h3 className="text-lg font-medium">Mistral</h3>
          <p className="text-sm text-muted-foreground">Connexion à votre compte Mistral Pro ou Team</p>
        </div>
      </div>
      <div className="space-y-4 rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-900/20">
        <div className="flex items-center justify-between gap-3">
          <span>{!status ? 'Vérification de la connexion…' : pending ? 'Terminez la connexion dans votre navigateur.' : status.authenticated ? 'Votre compte Mistral est connecté.' : 'Connectez votre compte pour utiliser Mistral.'}</span>
          <Badge variant="secondary">{status?.authenticated ? 'Connecté' : pending ? 'Connexion en cours' : 'Non connecté'}</Badge>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void connect()} disabled={Boolean(busy) || pending}>
            {busy === 'login' || pending ? 'Connexion en cours…' : status?.authenticated ? 'Reconnecter le compte' : 'Se connecter avec Mistral'}
          </Button>
          {status?.authenticated && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void check()}>{busy === 'check' ? 'Vérification…' : 'Vérifier la connexion'}</Button>}
          {(status?.authenticated || pending) && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void disconnect()}>{pending ? 'Annuler la connexion' : 'Déconnecter'}</Button>}
        </div>
        {pending && loginUrl && <a href={loginUrl} target="_blank" rel="noreferrer" className="block text-sm underline">Ouvrir la page de connexion Mistral</a>}
        {checkResult && <p role="status" className="text-sm text-green-700 dark:text-green-300">{checkResult}</p>}
        {(error || status?.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error || status?.error}</p>}
      </div>
    </div>
  );
}
