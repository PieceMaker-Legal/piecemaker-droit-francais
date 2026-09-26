type ShellEnvironmentWarningProps = {
  shell: string;
  reason: string;
  onDismiss: () => void;
};

export function ShellEnvironmentWarning({ shell, reason, onDismiss }: ShellEnvironmentWarningProps) {
  return (
    <div className="piecemaker-shell-warning" role="alert">
      <div className="piecemaker-shell-warning__text">
        <strong>Environnement du terminal non chargé.</strong>{' '}
        PieceMaker n'a pas pu lire la configuration de {shell} ({reason}). Claude, Codex et les outils
        installés dans votre terminal peuvent être introuvables. Vérifiez vos fichiers de démarrage du
        shell (.zprofile, .zshrc…), puis redémarrez l'application.
      </div>
      <button type="button" className="piecemaker-shell-warning__close" onClick={onDismiss} aria-label="Masquer l'avertissement">
        ×
      </button>
    </div>
  );
}
