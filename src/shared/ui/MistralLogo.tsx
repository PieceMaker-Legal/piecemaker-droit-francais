type MistralLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is Mistral. */
const MistralLogo = ({ className = 'w-5 h-5' }: MistralLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Mistral"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L2 7v10l10 5 10-5V7L12 2z"
      className="fill-foreground"
    />
    <path
      d="M2 12l10 5 10-5M2 7l10 5 10-5"
      className="stroke-background"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default MistralLogo;
