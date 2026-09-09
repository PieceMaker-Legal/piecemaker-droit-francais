type MistralLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is Mistral. */
const MistralLogo = ({ className = 'w-5 h-5' }: MistralLogoProps) => (
  <img
    src="/Mistral-Icon-Gradient-RGB.svg"
    alt="Mistral"
    className={className}
    role="img"
    aria-label="Mistral"
  />
);

export default MistralLogo;
