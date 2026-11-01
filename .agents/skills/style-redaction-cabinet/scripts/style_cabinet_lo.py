import uno
from com.sun.star.beans import PropertyValue

MODELE = "__MODELE__"


def option(nom, valeur):
    item = PropertyValue()
    item.Name = nom
    item.Value = valeur
    return item


def chapitres(doc):
    desktop = XSCRIPTCONTEXT.getDesktop()
    source = desktop.loadComponentFromURL(MODELE, "_blank", 0, (option("Hidden", True), option("AsTemplate", True)))
    try:
        regles, cibles = source.getChapterNumberingRules(), doc.getChapterNumberingRules()
        for niveau in range(regles.getCount()):
            uno.invoke(cibles, "replaceByIndex", (niveau, uno.Any("[]com.sun.star.beans.PropertyValue", regles.getByIndex(niveau))))
    finally:
        source.close(True)


def styler(doc):
    if not doc.supportsService("com.sun.star.text.TextDocument"):
        return
    if doc.isReadonly() or doc.isModified() or not doc.hasLocation():
        return
    if any(arg.Name == "Hidden" and arg.Value for arg in doc.getArgs()):
        return
    doc.getStyleFamilies().loadStylesFromURL(MODELE, (
        option("LoadTextStyles", True),
        option("LoadPageStyles", True),
        option("LoadNumberingStyles", True),
        option("OverwriteStyles", True),
    ))
    chapitres(doc)
    doc.setModified(False)


def appliquer(evenement):
    try:
        styler(evenement.Source)
    except Exception:
        pass


g_exportedScripts = (appliquer,)
