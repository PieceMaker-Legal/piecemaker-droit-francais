#!/usr/bin/env node
const brut = (process.env.MODIFICATIONS || '').trim();
let texte = brut;
if (!texte) {
  const corps = (process.env.ISSUE_BODY || '').replace(/\r\n/g, '\n');
  const bloc = corps.match(/```json\n([\s\S]*?)\n```/);
  if (!bloc) {
    console.error('Aucun bloc ```json trouvé dans le ticket.');
    process.exit(1);
  }
  texte = bloc[1];
}
let liste;
try {
  liste = JSON.parse(texte);
} catch {
  console.error('JSON des modifications invalide.');
  process.exit(1);
}
if (!Array.isArray(liste) || !liste.length || liste.length > 200) {
  console.error('Il faut une liste de 1 à 200 modifications.');
  process.exit(1);
}
const propres = liste.map((m) => {
  if (!m || typeof m.id !== 'string' || typeof m.lu !== 'string') {
    console.error('Chaque modification doit avoir id et lu.');
    process.exit(1);
  }
  return { id: m.id, lu: m.lu, ...(typeof m.expected === 'string' ? { expected: m.expected } : {}) };
});
process.stdout.write(JSON.stringify(propres));
