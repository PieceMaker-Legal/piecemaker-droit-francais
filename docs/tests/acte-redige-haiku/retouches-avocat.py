import zipfile, re, sys
S, D = sys.argv[1], sys.argv[2]
src = S + '/conclusions-export-v2.docx'; dst = S + '/lo/avocat.docx'
z = zipfile.ZipFile(src); files = {n: z.read(n) for n in z.namelist()}
x = files['word/document.xml'].decode()
def sub(old, new):
    global x
    assert x.count(old) == 1, (old[:60], x.count(old))
    x = x.replace(old, new)
sub("en invoquant des défauts d'usinage.</w:t>", "en invoquant des défauts d'usinage. Cette réclamation est intervenue cinquante-cinq jours après la livraison.</w:t>")
sub("aucune pièce ne démontre la réalité ni la gravité des défauts allégués", '</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">aucune pièce ne démontre la réalité ni la gravité des défauts allégués</w:t></w:r><w:r><w:t xml:space="preserve">')
sub("à payer 12 000,00 euros TTC.</w:t>", "à payer 12 000,00 euros TTC, avec intérêts au taux légal à compter du 23 juin 2025.</w:t>")
m = re.search(r'<w:sdt><w:sdtPr><w:alias w:val="PieceMaker s5"/>.*?</w:sdt>', x)
new = '<w:p><w:pPr><w:pStyle w:val="Titre2"/></w:pPr><w:r><w:t xml:space="preserve">C bis. Sur la résistance abusive</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Société Beta SARL a reconnu par téléphone « que la marchandise était conforme », ce qui caractérise sa mauvaise foi.</w:t></w:r></w:p>'
x = x[:m.end()] + new + x[m.end():]
x2 = re.sub(r'<w:sdt><w:sdtPr><w:alias w:val="PieceMaker s8"/>.*?</w:sdt>', '', x, count=1); assert x2 != x; x = x2
files['word/document.xml'] = x.encode()
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as o:
    for n, b in files.items(): o.writestr(n, b)
p = D + '/.piecemaker/raisonnement.js'; s = open(p).read()
old = "'Société Exemple SAS demande donc la condamnation de Société Beta SARL à payer 12 000,00 euros TTC.',"
assert s.count(old) == 1
s = s.replace(old, "'Le tribunal condamnera donc Société Beta SARL à payer à Société Exemple SAS 12 000,00 euros TTC.',")
old2 = "soit 40 euros par facture impayée.`,\n"
assert s.count(old2) == 1
s = s.replace(old2, old2 + "        'Condamner Société Beta SARL aux dépens.',\n")
open(p, 'w').write(s)
print('ok')
