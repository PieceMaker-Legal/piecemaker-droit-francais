import categories from './legal-categories.json' with { type: 'json' };

const LEGAL_FORM_ABBREVIATIONS: Record<string, string> = {
  '1000': 'Entrepreneur individuel', '5202': 'SNC', '5306': 'SCS', '5308': 'SCA', '5310': 'SLP',
  '5385': 'SELCA', '5485': 'SELARL', '5498': 'EURL', '5499': 'SARL',
  '5585': 'SELAFA', '5685': 'SELAFA', '5710': 'SAS', '5720': 'SASU', '5785': 'SELAS',
  '5800': 'SE', '6210': 'GEIE', '6220': 'GIE', '6521': 'SCPI', '6533': 'GAEC',
  '6540': 'SCI', '6541': 'SCCV', '6589': 'SCM', '6597': 'SCEA', '6598': 'EARL',
};

const LEGAL_FORMS = new Map([...Object.values(categories.labels), ...Object.values(LEGAL_FORM_ABBREVIATIONS), 'SA', 'SARL', 'SCP'].map((form) => [form.toUpperCase(), form]));
LEGAL_FORMS.set('EI', 'Entrepreneur individuel');

export function resolveCompanyLegalForm(code: string, explicitForm = ''): string {
  const normalizedCode = code.trim();
  const abbreviation = LEGAL_FORM_ABBREVIATIONS[normalizedCode];
  const label = (categories.labels as Record<string, string>)[normalizedCode] || '';
  const resolvedForm = abbreviation || /^(SA|SARL|SCP)\b/.exec(label)?.[1] || label;
  const recognizedForm = LEGAL_FORMS.get(explicitForm.trim().toUpperCase()) || '';
  if (!resolvedForm || recognizedForm === resolvedForm || (resolvedForm === 'SAS' && recognizedForm === 'SASU') || (resolvedForm === 'SARL' && recognizedForm === 'EURL')) return recognizedForm || resolvedForm;
  return resolvedForm;
}
