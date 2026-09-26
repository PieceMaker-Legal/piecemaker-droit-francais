import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';

export function startPluginsReloadAfterLogin(reload: () => void = () => window.location.reload()) {
  let pluginsFetchedSignedOut = !localStorage.getItem('auth-token');
  const handleSessionExpired = () => { pluginsFetchedSignedOut = true; };
  const handleTokenStored = () => {
    if (!pluginsFetchedSignedOut) return;
    pluginsFetchedSignedOut = false;
    reload();
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenStored);
  return () => {
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenStored);
  };
}
