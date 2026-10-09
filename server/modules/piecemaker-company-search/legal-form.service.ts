import categories from './legal-categories.json' with { type: 'json' };

const LEGAL_FORM_ABBREVIATIONS: Record<string, string> = {
  '1000': 'EI', '5202': 'SNC', '5306': 'SCS', '5308': 'SCA', '5310': 'SLP',
  '5385': 'SELCA', '5485': 'SELARL', '5498': 'EURL', '5499': 'SARL',
  '5585': 'SELAFA', '5685': 'SELAFA', '5710': 'SAS', '5720': 'SASU', '5785': 'SELAS',
  '5800': 'SE', '6210': 'GEIE', '6220': 'GIE', '6521': 'SCPI', '6533': 'GAEC',
  '6540': 'SCI', '6541': 'SCCV', '6589': 'SCM', '6597': 'SCEA', '6598': 'EARL',
};

export function resolveCompanyLegalForm(code: string, explicitForm = ''): string {
  if (explicitForm.trim()) return explicitForm.trim();
  const normalizedCode = code.trim();
  const abbreviation = LEGAL_FORM_ABBREVIATIONS[normalizedCode];
  if (abbreviation) return abbreviation;
  const label = (categories.labels as Record<string, string>)[normalizedCode] || '';
  return /^(SA|SARL|SCP)\b/.exec(label)?.[1] || label;
}
