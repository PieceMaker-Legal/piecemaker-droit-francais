import json
import sys
from pathlib import Path

import tiktoken

directory = Path(sys.argv[1])
encoding = tiktoken.get_encoding('o200k_base')
rows = []
for case in json.loads((directory / 'payloads.json').read_text()):
    rows.append({
        'cas': case['name'],
        'contexte_complet': len(encoding.encode(case['full'])),
        'contexte_cible': len(encoding.encode(case['targeted'])),
    })
report = {
    'encodage': encoding.name,
    'mesure': 'Taille des contextes préparés, sans appel LLM ni estimation de facture.',
    'appels_llm': 0,
    'cas': rows,
    'total_complet': sum(row['contexte_complet'] for row in rows),
    'total_cible': sum(row['contexte_cible'] for row in rows),
}
(directory / 'tokens.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
