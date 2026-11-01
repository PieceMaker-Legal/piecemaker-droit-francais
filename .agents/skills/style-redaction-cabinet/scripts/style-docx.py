#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

SKILL = Path(__file__).resolve().parent.parent
DEFAUT = SKILL / 'references' / 'style-docx-defaut.json'
SOCLE = SKILL / 'templates' / 'style-docx-defaut.docx'
MACRO = Path(__file__).resolve().parent / 'style_cabinet_lo.py'
REFERENCE = SKILL / 'references' / 'configuration-style-docx.md'
CONFIG = Path(os.environ.get('PIECEMAKER_STYLE_DOCX', Path.home() / '.piecemaker' / 'custom' / 'style-docx'))
PROFIL = CONFIG / 'profil.json'
BASE = CONFIG / 'base.docx'
TEST = CONFIG / 'test-style.docx'
MODELE_LO = 'style-cabinet.ott'
MACRO_LO = 'style_cabinet.py'

ALIGNEMENTS = {'justifie': 'both', 'gauche': 'left', 'centre': 'center', 'droite': 'right'}
FORMATS = {'romain_maj': 'upperRoman', 'romain_min': 'lowerRoman', 'lettre_maj': 'upperLetter', 'lettre_min': 'lowerLetter', 'decimal': 'decimal', 'aucun': 'none'}
PAGINATIONS = ('page/total', 'page', 'aucune')
FACTORY = "/org.openoffice.Setup/Office/Factories/org.openoffice.Setup:Factory['com.sun.star.text.TextDocument']"
EVENTS = '/org.openoffice.Office.Events/ApplicationEvents/Bindings'
SCRIPT_URL = f'vnd.sun.star.script:{MACRO_LO}$appliquer?language=Python&amp;location=user'


def erreur(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def twips_cm(valeur):
    return round(valeur * 1440 / 2.54)


def twips_pt(valeur):
    return round(valeur * 20)


def lire_profil(chemin):
    profil = json.loads(Path(chemin).read_text(encoding='utf8'))
    fautes = []
    niveaux = profil.get('niveaux', [])
    if len(niveaux) != 9:
        fautes.append(f'niveaux : 9 attendus, {len(niveaux)} trouvés')
    for index, niveau in enumerate(niveaux, 1):
        if niveau.get('format') not in FORMATS:
            fautes.append(f'niveau {index} : format inconnu « {niveau.get("format")} »')
        if niveau.get('format') != 'aucun' and f'%{index}' not in niveau.get('modele', ''):
            fautes.append(f'niveau {index} : le modèle doit contenir %{index}')
    blocs = [('corps', profil.get('corps', {})), ('titre', profil.get('titre', {})), ('sous_titre', profil.get('sous_titre', {})), ('citation', profil.get('citation', {}))]
    blocs += [(f'niveau {index}', niveau) for index, niveau in enumerate(niveaux, 1)]
    for nom, bloc in blocs:
        if bloc.get('alignement') not in ALIGNEMENTS:
            fautes.append(f'{nom} : alignement inconnu « {bloc.get("alignement")} »')
        if not bloc.get('taille'):
            fautes.append(f'{nom} : taille manquante')
    if not profil.get('police'):
        fautes.append('police manquante')
    if profil.get('page', {}).get('pagination') not in PAGINATIONS:
        fautes.append('page.pagination : page/total, page ou aucune')
    if fautes:
        erreur('Profil invalide :\n- ' + '\n- '.join(fautes))
    return profil


def proprietes_texte(profil, bloc):
    xml = f'<w:rFonts w:ascii="{escape(profil["police"])}" w:hAnsi="{escape(profil["police"])}" w:cs="{escape(profil["police"])}"/>'
    if bloc.get('gras'):
        xml += '<w:b/>'
    if bloc.get('italique'):
        xml += '<w:i/>'
    if bloc.get('majuscules'):
        xml += '<w:caps/>'
    xml += f'<w:color w:val="{bloc.get("couleur", "000000")}"/><w:sz w:val="{round(bloc["taille"] * 2)}"/><w:szCs w:val="{round(bloc["taille"] * 2)}"/>'
    if bloc.get('souligne'):
        xml += '<w:u w:val="single"/>'
    return f'<w:rPr>{xml}</w:rPr>'


def proprietes_paragraphe(bloc, debut='', fin=''):
    xml = debut
    if bloc.get('encadre'):
        xml += '<w:pBdr>' + ''.join(f'<w:{bord} w:val="single" w:sz="4" w:space="{espace}" w:color="auto"/>' for bord, espace in (('top', 12), ('left', 4), ('bottom', 12), ('right', 4))) + '</w:pBdr>'
    if bloc.get('fond'):
        xml += f'<w:shd w:val="clear" w:color="auto" w:fill="{bloc["fond"]}"/>'
    xml += f'<w:spacing w:before="{twips_pt(bloc.get("avant", 0))}" w:after="{twips_pt(bloc.get("apres", 0))}" w:line="{round(bloc.get("interligne", 1) * 240)}" w:lineRule="auto"/>'
    gauche, premiere = bloc.get('retrait_gauche_cm', 0), bloc.get('premiere_ligne_cm', 0)
    if gauche or premiere:
        xml += f'<w:ind w:left="{twips_cm(gauche)}" w:firstLine="{twips_cm(premiere)}"/>'
    xml += f'<w:jc w:val="{ALIGNEMENTS[bloc["alignement"]]}"/>' + fin
    return f'<w:pPr>{xml}</w:pPr>'


def style_paragraphe(ancien, style_id, nom, profil, bloc, base='Normal', suivant='Normal', ppr_debut='', ppr_fin='', priorite=9):
    lien = re.search(r'<w:link w:val="[^"]+"/>', ancien or '')
    defaut = ' w:default="1"' if style_id == 'Normal' else ''
    entete = f'<w:name w:val="{nom}"/>'
    if base:
        entete += f'<w:basedOn w:val="{base}"/><w:next w:val="{suivant}"/>'
    if lien:
        entete += lien.group(0)
    return f'<w:style w:type="paragraph"{defaut} w:styleId="{style_id}">{entete}<w:uiPriority w:val="{priorite}"/><w:qFormat/>{proprietes_paragraphe(bloc, ppr_debut, ppr_fin)}{proprietes_texte(profil, bloc)}</w:style>'


def poser_style(styles, style_id, bloc_xml):
    motif = re.compile(rf'<w:style [^>]*w:styleId="{style_id}"[^>]*>.*?</w:style>', re.S)
    if motif.search(styles):
        return motif.sub(lambda _: bloc_xml, styles, count=1)
    return styles.replace('</w:styles>', bloc_xml + '</w:styles>')


def ancien_style(styles, style_id):
    trouve = re.search(rf'<w:style [^>]*w:styleId="{style_id}"[^>]*>.*?</w:style>', styles, re.S)
    return trouve.group(0) if trouve else None


def texte_lie(styles, style_id, rpr):
    motif = re.compile(rf'(<w:style [^>]*w:styleId="{style_id}Char"[^>]*>)(.*?)(</w:style>)', re.S)
    return motif.sub(lambda m: m.group(1) + re.sub(r'<w:rPr>.*?</w:rPr>', '', m.group(2), flags=re.S) + rpr + m.group(3), styles)


def patcher_styles(styles, profil, num_id):
    speciaux = (
        ('Normal', 'Normal', profil['corps'], {'base': None, 'priorite': 0}),
        ('Title', 'Title', profil['titre'], {'priorite': 10}),
        ('Subtitle', 'Subtitle', profil['sous_titre'], {'priorite': 11}),
        ('Quote', 'Quote', profil['citation'], {'priorite': 29}),
    )
    for style_id, nom, bloc, options in speciaux:
        styles = poser_style(styles, style_id, style_paragraphe(ancien_style(styles, style_id), style_id, nom, profil, bloc, **options))
        styles = texte_lie(styles, style_id, proprietes_texte(profil, bloc))
    for index, niveau in enumerate(profil['niveaux']):
        style_id = f'Heading{index + 1}'
        numero = f'<w:numPr><w:ilvl w:val="{index}"/><w:numId w:val="{num_id}"/></w:numPr>' if niveau['format'] != 'aucun' else '<w:numPr><w:numId w:val="0"/></w:numPr>'
        xml = style_paragraphe(ancien_style(styles, style_id), style_id, f'heading {index + 1}', profil, {k: v for k, v in niveau.items() if k not in ('retrait_gauche_cm', 'premiere_ligne_cm')}, ppr_debut=f'<w:keepNext/><w:keepLines/>{numero}', ppr_fin=f'<w:outlineLvl w:val="{index}"/>')
        styles = poser_style(styles, style_id, xml)
        styles = texte_lie(styles, style_id, proprietes_texte(profil, niveau))
    note = {'taille': profil['note']['taille'], 'alignement': profil['corps']['alignement']}
    ancienne = ancien_style(styles, 'FootnoteText')
    styles = poser_style(styles, 'FootnoteText', style_paragraphe(ancienne, 'FootnoteText', 'footnote text', profil, note, suivant='FootnoteText', priorite=99))
    styles = texte_lie(styles, 'FootnoteText', proprietes_texte(profil, note))
    return styles


def niveau_numerotation(index, niveau):
    style = f'<w:pStyle w:val="Heading{index + 1}"/>'
    if niveau['format'] == 'aucun':
        return f'<w:lvl w:ilvl="{index}"><w:start w:val="1"/><w:numFmt w:val="none"/>{style}<w:suff w:val="nothing"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{twips_cm(niveau.get("retrait_gauche_cm", 0))}" w:firstLine="0"/></w:pPr></w:lvl>'
    return f'<w:lvl w:ilvl="{index}"><w:start w:val="1"/><w:numFmt w:val="{FORMATS[niveau["format"]]}"/>{style}<w:lvlText w:val="{escape(niveau["modele"])}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{twips_cm(niveau.get("retrait_gauche_cm", 0))}" w:hanging="{twips_cm(niveau.get("suspendu_cm", 0))}"/></w:pPr></w:lvl>'


def patcher_numerotation(numbering, profil):
    if numbering is None:
        numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>'
    numbering = re.sub(r'<w:pStyle w:val="Heading[1-9]"/>', '', numbering)
    abstrait = max([int(v) for v in re.findall(r'w:abstractNumId="(\d+)"', numbering)] + [-1]) + 1
    num_id = max([int(v) for v in re.findall(r'<w:num w:numId="(\d+)"', numbering)] + [0]) + 1
    niveaux = ''.join(niveau_numerotation(i, n) for i, n in enumerate(profil['niveaux']))
    definition = f'<w:abstractNum w:abstractNumId="{abstrait}"><w:multiLevelType w:val="multilevel"/>{niveaux}</w:abstractNum>'
    premier = re.search(r'<w:num w:numId=', numbering)
    position = premier.start() if premier else numbering.index('</w:numbering>')
    numbering = numbering[:position] + definition + numbering[position:]
    instance = f'<w:num w:numId="{num_id}"><w:abstractNumId w:val="{abstrait}"/></w:num>'
    fin = list(re.finditer(r'</w:num>', numbering))
    position = fin[-1].end() if fin else numbering.index('</w:numbering>')
    return numbering[:position] + instance + numbering[position:], num_id


def patcher_marges(document, profil):
    marges = profil['page']['marges_cm']
    valeurs = {'top': marges['haut'], 'right': marges['droite'], 'bottom': marges['bas'], 'left': marges['gauche']}

    def remplacer(balise):
        texte = balise.group(0)
        for attribut, valeur in valeurs.items():
            texte = re.sub(rf'w:{attribut}="-?\d+"', f'w:{attribut}="{twips_cm(valeur)}"', texte)
        return texte

    return re.sub(r'<w:pgMar [^>]*/>', remplacer, document)


def champ(code):
    return f'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> {code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'


def pied_de_page(pagination):
    contenu = {'page/total': champ('PAGE') + '<w:r><w:t xml:space="preserve"> / </w:t></w:r>' + champ('NUMPAGES'), 'page': champ('PAGE'), 'aucune': ''}[pagination]
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>{contenu}</w:p></w:ftr>'


def vider_corps(document):
    fin = re.search(r'<w:sectPr(?:(?!<w:sectPr).)*</w:body>', document, re.S)
    debut = document.index('<w:body>') + len('<w:body>')
    return document[:debut] + '<w:p/>' + document[fin.start():]


def ajouter_part_numerotation(parts):
    types = parts['[Content_Types].xml'].decode('utf8')
    if '/word/numbering.xml' not in types:
        parts['[Content_Types].xml'] = types.replace('</Types>', '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>').encode('utf8')
    liens = parts['word/_rels/document.xml.rels'].decode('utf8')
    if 'numbering.xml' not in liens:
        parts['word/_rels/document.xml.rels'] = liens.replace('</Relationships>', '<Relationship Id="rIdStyleNumerotation" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>').encode('utf8')


def produire(source, sortie, profil, vide=False, socle=False):
    with zipfile.ZipFile(source) as archive:
        ordre = archive.namelist()
        parts = {nom: archive.read(nom) for nom in ordre}
    numbering = parts['word/numbering.xml'].decode('utf8') if 'word/numbering.xml' in parts else None
    numbering, num_id = patcher_numerotation(numbering, profil)
    if 'word/numbering.xml' not in parts:
        ordre.append('word/numbering.xml')
        ajouter_part_numerotation(parts)
    parts['word/numbering.xml'] = numbering.encode('utf8')
    parts['word/styles.xml'] = patcher_styles(parts['word/styles.xml'].decode('utf8'), profil, num_id).encode('utf8')
    document = patcher_marges(parts['word/document.xml'].decode('utf8'), profil)
    if vide:
        document = vider_corps(document)
        if 'word/footnotes.xml' in parts:
            parts['word/footnotes.xml'] = re.sub(r'<w:footnote w:id="[1-9]\d*".*?</w:footnote>', '', parts['word/footnotes.xml'].decode('utf8'), flags=re.S).encode('utf8')
    parts['word/document.xml'] = document.encode('utf8')
    if socle:
        parts['word/footer1.xml'] = pied_de_page(profil['page']['pagination']).encode('utf8')
    Path(sortie).parent.mkdir(parents=True, exist_ok=True)
    temporaire = Path(f'{sortie}.tmp')
    with zipfile.ZipFile(temporaire, 'w', zipfile.ZIP_DEFLATED) as archive:
        for nom in ordre:
            archive.writestr(nom, parts[nom])
    temporaire.replace(sortie)


def trouver_soffice():
    candidats = [shutil.which('soffice'), '/Applications/LibreOffice.app/Contents/MacOS/soffice', r'C:\Program Files\LibreOffice\program\soffice.exe']
    for candidat in candidats:
        if candidat and Path(candidat).exists():
            return candidat
    erreur('LibreOffice est introuvable. Installez LibreOffice, puis relancez la commande.')


def profil_lo():
    surcharge = os.environ.get('PIECEMAKER_STYLE_DOCX_LO')
    if surcharge:
        return Path(surcharge)
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'LibreOffice' / '4' / 'user'
    if sys.platform == 'win32':
        return Path(os.environ['APPDATA']) / 'LibreOffice' / '4' / 'user'
    return Path.home() / '.config' / 'libreoffice' / '4' / 'user'


def libreoffice_ouvert():
    if os.environ.get('PIECEMAKER_STYLE_DOCX_LO'):
        return False
    if sys.platform == 'win32':
        return 'soffice.bin' in subprocess.run(['tasklist'], capture_output=True, text=True).stdout
    return subprocess.run(['pgrep', '-x', 'soffice'], capture_output=True).returncode == 0


def fichier_url(chemin):
    return Path(chemin).resolve().as_uri()


def convertir_modele(soffice, base, destination):
    with tempfile.TemporaryDirectory() as dossier:
        fait = subprocess.run([soffice, f'-env:UserInstallation={fichier_url(dossier)}/profil', '--headless', '--convert-to', 'ott:writer8_template', '--outdir', dossier, str(base)], capture_output=True, text=True, timeout=180)
        produit = Path(dossier) / f'{Path(base).stem}.ott'
        if not produit.exists():
            erreur(f'Conversion du modèle LibreOffice impossible : {fait.stderr or fait.stdout}')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(produit, destination)


def retirer_items(xcu):
    xcu = re.sub(rf'<item oor:path="{re.escape(FACTORY)}"><prop oor:name="ooSetupFactoryTemplateFile"[^>]*>.*?</prop></item>\s*', '', xcu, flags=re.S)
    return re.sub(rf'<item oor:path="{re.escape(EVENTS)}"><node oor:name="OnLoad"[^>]*>.*?</node></item>\s*', '', xcu, flags=re.S)


def lire_xcu(user):
    fichier = user / 'registrymodifications.xcu'
    if fichier.exists():
        return fichier, fichier.read_text(encoding='utf8')
    return fichier, '<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n</oor:items>\n'


def installer_libreoffice(profil, soffice):
    user = profil_lo()
    modele = user / 'template' / MODELE_LO
    convertir_modele(soffice, BASE, modele)
    scripts = user / 'Scripts' / 'python'
    scripts.mkdir(parents=True, exist_ok=True)
    (scripts / MACRO_LO).write_text(MACRO.read_text(encoding='utf8').replace('__MODELE__', fichier_url(modele)), encoding='utf8')
    fichier, xcu = lire_xcu(user)
    sauvegarde = CONFIG / 'registrymodifications.avant.xcu'
    if fichier.exists() and not sauvegarde.exists():
        shutil.copyfile(fichier, sauvegarde)
    items = f'<item oor:path="{FACTORY}"><prop oor:name="ooSetupFactoryTemplateFile" oor:op="fuse"><value>{escape(fichier_url(modele))}</value></prop></item>\n'
    if profil.get('ouverture', {}).get('appliquer_aux_documents_existants'):
        items += f'<item oor:path="{EVENTS}"><node oor:name="OnLoad" oor:op="replace"><prop oor:name="BindingURL" oor:op="fuse"><value>{SCRIPT_URL}</value></prop></node></item>\n'
    fichier.write_text(retirer_items(xcu).replace('</oor:items>', items + '</oor:items>'), encoding='utf8')


def ouvrir(fichier, soffice):
    if sys.platform == 'darwin' and not os.environ.get('PIECEMAKER_STYLE_DOCX_LO'):
        subprocess.Popen(['open', '-a', 'LibreOffice', str(fichier)])
    else:
        subprocess.Popen([soffice, str(fichier)])


def cmd_etat(_):
    if PROFIL.exists():
        print(f'Style Word : CONFIGURÉ. Profil : {PROFIL}.')
        print(f'Ne lis ni ce profil ni {REFERENCE.name} : le style est déjà injecté par `creer` et dans LibreOffice.')
        print(f'Ouvre le profil seulement si l\'utilisateur demande de modifier le style, puis relance `appliquer --profil {PROFIL}`.')
    else:
        print('Style Word : À CONFIGURER.')
        print(f'Propose la configuration à l\'utilisateur, en suivant {REFERENCE}.')
        print('Si l\'utilisateur refuse, `creer` applique le profil par défaut.')


def cmd_appliquer(args):
    profil = lire_profil(args.profil or (PROFIL if PROFIL.exists() else DEFAUT))
    soffice = trouver_soffice()
    if libreoffice_ouvert():
        erreur('LibreOffice est ouvert : il écraserait sa configuration à la fermeture. Fermez LibreOffice, puis relancez la commande.')
    CONFIG.mkdir(parents=True, exist_ok=True)
    produire(SOCLE, TEST, profil, socle=True)
    produire(SOCLE, BASE, profil, vide=True, socle=True)
    installer_libreoffice(profil, soffice)
    temporaire = PROFIL.with_suffix('.tmp')
    temporaire.write_text(json.dumps(profil, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporaire.replace(PROFIL)
    print(f'Style appliqué. Profil : {PROFIL}. Document test : {TEST}.')
    if not args.sans_ouvrir:
        ouvrir(TEST, soffice)
        print('Document test ouvert dans LibreOffice.')


def cmd_creer(args):
    sortie = Path(args.sortie)
    if sortie.exists():
        erreur(f'{sortie} existe déjà.')
    configure = PROFIL.exists()
    profil = lire_profil(PROFIL if configure else DEFAUT)
    if args.depuis:
        produire(args.depuis, sortie, profil)
    elif configure and BASE.exists():
        sortie.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE, sortie)
    else:
        produire(SOCLE, sortie, profil, vide=True, socle=True)
    if args.markdown_file:
        subprocess.run(['docx', 'insert', str(sortie), '--at-end', '--markdown-file', args.markdown_file], check=True, stdout=subprocess.DEVNULL)
        if not args.depuis:
            subprocess.run(['docx', 'delete', str(sortie), '--at', 'p0'], check=True, stdout=subprocess.DEVNULL)
    print(f'{sortie} créé avec le style {"du cabinet" if configure else "par défaut (style Word à configurer)"}.')


def cmd_retirer(_):
    if libreoffice_ouvert():
        erreur('LibreOffice est ouvert. Fermez LibreOffice, puis relancez la commande.')
    user = profil_lo()
    fichier, xcu = lire_xcu(user)
    if fichier.exists():
        fichier.write_text(retirer_items(xcu), encoding='utf8')
    (user / 'template' / MODELE_LO).unlink(missing_ok=True)
    (user / 'Scripts' / 'python' / MACRO_LO).unlink(missing_ok=True)
    PROFIL.unlink(missing_ok=True)
    print('Style retiré de LibreOffice. Style Word : à configurer.')


def main():
    parser = argparse.ArgumentParser(prog='style-docx.py')
    commandes = parser.add_subparsers(dest='commande', required=True)
    commandes.add_parser('etat').set_defaults(action=cmd_etat)
    appliquer = commandes.add_parser('appliquer')
    appliquer.add_argument('--profil')
    appliquer.add_argument('--sans-ouvrir', action='store_true')
    appliquer.set_defaults(action=cmd_appliquer)
    creer = commandes.add_parser('creer')
    creer.add_argument('sortie')
    creer.add_argument('--markdown-file')
    creer.add_argument('--depuis')
    creer.set_defaults(action=cmd_creer)
    commandes.add_parser('retirer').set_defaults(action=cmd_retirer)
    args = parser.parse_args()
    args.action(args)


if __name__ == '__main__':
    main()
