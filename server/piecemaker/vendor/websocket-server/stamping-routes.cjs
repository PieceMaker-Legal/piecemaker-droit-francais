// Routes tampon et tamponnage, extraites de `websocket-server/server.cjs` de
// PieceMaker-Installer (endpoints /api/tampon/* et /api/stamping) pour être
// montées sur le serveur CloudCLI. La logique est reprise telle quelle ; seules
// les dépendances au module `server.cjs` (PIECEMAKER_HOME, readUserConfig,
// readFileStripBOM) sont devenues des paramètres ou des fonctions locales.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { convertToPdf } = require('./lib/office-to-pdf.cjs');
const {
  detectStampImage,
  stampDataUrl,
  stampedPiecesDirectory,
} = require('./lib/stamping.cjs');
const { isInside, resolveConfiguredLegalCaseFolder } = require('./workspace-paths.cjs');

const ORIGINALS_SUBFOLDER = 'pièces originales';
const DOSSIER_FOLDERS_FILE = 'dossier_folders.json';

function stripBOM(content) {
  return typeof content === 'string' && content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readFileStripBOM(filePath, encoding = 'utf8') {
  return stripBOM(fs.readFileSync(filePath, encoding));
}

/**
 * Chemin réel de l'original d'une pièce. Les compilations écrites par la
 * version courante stockent le chemin complet, mais celles d'avant n'ont que
 * le nom du fichier : on le retrouve là où les originales ont été déposées au
 * fil des versions, sans jamais sortir du dossier juridique (`basename`).
 */
function resolvePieceFile(declaredPath, workingFolder, documentId) {
  const declared = String(declaredPath || '').trim();
  if (!declared) return null;
  if (path.isAbsolute(declared) && fs.existsSync(declared)) return declared;

  const name = path.basename(declared);
  return [
    path.join(workingFolder, ORIGINALS_SUBFOLDER, name),
    path.join(workingFolder, `fichiers_sources_${documentId}`, name),
    path.join(workingFolder, name),
  ].find((candidate) => fs.existsSync(candidate)) || null;
}

// Une pièce est désignée par son chemin relatif au dossier juridique. On refuse
// tout chemin absolu ou remontant hors du dossier, puis on exige un fichier.
function resolveCaseRelativeFile(caseFolder, relativePath) {
  const relative = String(relativePath || '').trim();
  if (!relative || path.isAbsolute(relative)) return null;
  const candidate = path.resolve(caseFolder, relative);
  if (candidate !== caseFolder && !isInside(caseFolder, candidate)) return null;
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function createStampingRouter({ homeDir = path.join(os.homedir(), '.piecemaker') } = {}) {
  const express = require('express');
  const router = express.Router();

  const configPath = path.join(homeDir, 'config.json');
  const getSystemDataPath = (...segments) => path.join(homeDir, ...segments);

  const readUserConfig = () => {
    try {
      return fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    } catch {
      return {};
    }
  };

  const readDossierFolders = () => {
    try {
      const file = getSystemDataPath(DOSSIER_FOLDERS_FILE);
      return fs.existsSync(file) ? JSON.parse(readFileStripBOM(file, 'utf8')) : {};
    } catch {
      return {};
    }
  };

  const rememberDossierFolder = (documentId, folder) => {
    if (!documentId || !folder) throw new Error('documentId et dossier de travail requis.');
    const legalCase = resolveConfiguredLegalCaseFolder(readUserConfig(), folder);
    const registry = readDossierFolders();
    if (registry[documentId] === legalCase) return legalCase;
    registry[documentId] = legalCase;
    const registryFile = getSystemDataPath(DOSSIER_FOLDERS_FILE);
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), 'utf8');
    return legalCase;
  };

  const getDossierFolder = (documentId) => readDossierFolders()[documentId] || null;

  router.post('/tampon/save', (req, res) => {
    try {
      const { tamponImage } = req.body;
      if (!tamponImage) return res.status(400).json({ error: 'Image du tampon requise' });

      const tamponPath = getSystemDataPath('tampon.png');
      fs.mkdirSync(path.dirname(tamponPath), { recursive: true });

      const match = String(tamponImage).match(/^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!match) {
        return res.status(400).json({ error: 'Format d’image du tampon non supporté. Utilisez PNG ou JPEG.' });
      }

      // Le nom historique reste `tampon.png` pour ne pas casser les
      // installations existantes. La signature binaire fait foi à la lecture.
      const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
      let image;
      try {
        image = detectStampImage(buffer);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      fs.writeFileSync(tamponPath, buffer);
      res.json({ success: true, filename: 'tampon.png', format: image.format, path: tamponPath });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/tampon/load', (req, res) => {
    try {
      const tamponPath = getSystemDataPath('tampon.png');
      if (!fs.existsSync(tamponPath)) return res.status(404).json({ error: 'Aucun tampon configuré' });

      // Les versions historiques pouvaient stocker un JPEG dans `tampon.png`.
      const buffer = fs.readFileSync(tamponPath);
      const image = detectStampImage(buffer);
      res.json({
        success: true,
        tamponImage: stampDataUrl(buffer),
        filename: 'tampon.png',
        format: image.format,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/tampon/delete', (req, res) => {
    try {
      const tamponPath = getSystemDataPath('tampon.png');
      if (fs.existsSync(tamponPath)) fs.unlinkSync(tamponPath);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/stamping', async (req, res) => {
    try {
      const { pieces, documentId, folder } = req.body;

      if (!pieces || !Array.isArray(pieces) || pieces.length === 0) {
        return res.status(400).json({ error: 'Liste de pièces requise (array d\'IDs)' });
      }
      if (!documentId) return res.status(400).json({ error: 'ID du document requis' });

      // Les pièces tamponnées vont TOUJOURS dans le dossier juridique du
      // documentId concerné, sous-dossier « Pièces tamponnées ».
      const requestedFolder = String(folder || '').trim() || getDossierFolder(documentId);
      if (!requestedFolder) {
        return res.status(400).json({
          error: 'Dossier de travail inconnu. Indiquez le dossier de travail (paramètre "folder").',
        });
      }
      if (!fs.existsSync(requestedFolder) || !fs.statSync(requestedFolder).isDirectory()) {
        return res.status(400).json({ error: `Dossier de travail introuvable : ${requestedFolder}` });
      }

      // rememberDossierFolder refuse tout dossier hors d'un dossier juridique enregistré.
      let workingFolder;
      try {
        workingFolder = rememberDossierFolder(documentId, requestedFolder);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const tamponPath = getSystemDataPath('tampon.png');
      if (!fs.existsSync(tamponPath)) {
        return res.status(400).json({
          error: 'Aucun tampon configuré. Enregistrez-en un depuis la section « Tampon et pièces ».',
        });
      }

      // Un ancien tampon JPEG peut légitimement porter le nom `tampon.png`.
      const tamponBuffer = fs.readFileSync(tamponPath);
      const tamponFormat = detectStampImage(tamponBuffer).format;

      // Une compilation `compilation_dossier_<documentId>.json` n'existe plus que
      // pour les dossiers chargés par l'ancien flux Word ; l'interface désigne
      // désormais les pièces par leur chemin relatif au dossier juridique.
      const compilationPath = path.join(workingFolder, `compilation_dossier_${documentId}.json`);
      let documentsArray = [];
      if (fs.existsSync(compilationPath)) {
        const compilationData = JSON.parse(readFileStripBOM(compilationPath, 'utf8'));
        // Deux formes coexistent sur disque : un objet
        // `{ informations_dossier, documents }` et, pour les plus anciennes, le tableau nu.
        documentsArray = Array.isArray(compilationData) ? compilationData : compilationData.documents || [];
        if (!Array.isArray(documentsArray)) {
          return res.status(500).json({ error: 'Structure de compilation invalide : documents doit être un tableau' });
        }
      }

      const tamponnedDir = stampedPiecesDirectory(workingFolder);
      fs.mkdirSync(tamponnedDir, { recursive: true });

      const { PDFDocument, rgb } = require('pdf-lib');
      const results = [];

      // Dossier temporaire des PDF intermédiaires (Excel, Word, images, texte).
      const conversionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-conversion-'));

      for (let i = 0; i < pieces.length; i++) {
        const pieceId = pieces[i];
        const pieceNumber = i + 1;

        // Deux origines pour l'`id` d'une pièce : une entrée de compilation (flux
        // Word/MCP) résolue par son `filename`, ou un chemin relatif au dossier
        // juridique résolu directement.
        const document = documentsArray.find((doc) => doc.id === pieceId);
        const declaredName = document ? document.filename : pieceId;

        try {
          const filePath = document
            ? resolvePieceFile(document.filename, workingFolder, documentId)
            : resolveCaseRelativeFile(workingFolder, pieceId);

          if (!filePath) {
            results.push({
              pieceNumber,
              id: pieceId,
              filename: declaredName,
              success: false,
              error: `Fichier introuvable : ${declaredName || 'nom de fichier absent'}`,
            });
            continue;
          }

          const outputFileName = `Pièce n°${pieceNumber}.pdf`;
          const outputPath = path.join(tamponnedDir, outputFileName);

          // Passage en PDF de l'original (Excel/Word via LibreOffice, images et
          // texte via pdf-lib, PDF laissé tel quel).
          const conversion = await convertToPdf(filePath, conversionDir);
          const pdfDoc = await PDFDocument.load(fs.readFileSync(conversion.pdfPath));
          const firstPage = pdfDoc.getPages()[0];

          // Incorporer l'image en fonction de sa signature binaire.
          const tamponImg = tamponFormat === 'png'
            ? await pdfDoc.embedPng(tamponBuffer)
            : await pdfDoc.embedJpg(tamponBuffer);

          const squareSize = 100;
          const { width, height } = firstPage.getSize();
          const x = width - squareSize - 20;
          const y = height - squareSize - 20;

          const scale = Math.min(squareSize / tamponImg.width, squareSize / tamponImg.height);
          const scaledWidth = tamponImg.width * scale;
          const scaledHeight = tamponImg.height * scale;

          firstPage.drawImage(tamponImg, {
            x: x + (squareSize - scaledWidth) / 2,
            y: y + (squareSize - scaledHeight) / 2,
            width: scaledWidth,
            height: scaledHeight,
          });

          // Numéro de pièce centré sur le tampon. Pour pdf-lib, `y` est la
          // baseline du texte : l'ajustement d'un tiers de corps le recentre.
          const fontSize = 16;
          const textString = String(pieceNumber);
          const textWidth = fontSize * textString.length * 0.6; // Approximation

          firstPage.drawText(textString, {
            x: x + (squareSize - textWidth) / 2,
            y: y + squareSize / 2 - fontSize / 3,
            size: fontSize,
            color: rgb(0, 0, 0),
          });

          fs.writeFileSync(outputPath, await pdfDoc.save());

          results.push({
            pieceNumber,
            id: pieceId,
            filename: declaredName,
            outputFileName,
            outputPath,
            converted: conversion.converted,
            conversionEngine: conversion.engine,
            success: true,
          });
        } catch (error) {
          results.push({ pieceNumber, id: pieceId, filename: declaredName, success: false, error: error.message });
        }
      }

      try {
        fs.rmSync(conversionDir, { recursive: true, force: true });
      } catch {
        // Le nettoyage des PDF intermédiaires est opportuniste.
      }

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      res.json({
        success: true,
        folder: workingFolder,
        tamponnedDir,
        results,
        summary: { total: pieces.length, success: successCount, failure: failureCount },
        message: `Tamponnage terminé : ${successCount} pièce(s) traitée(s), ${failureCount} erreur(s).`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createStampingRouter };
