const fs = require('fs');
const os = require('os');
const path = require('path');

const { convertToPdf } = require('./lib/office-to-pdf.cjs');
const {
  detectStampImage,
  stampDataUrl,
  stampedPiecesDirectory,
} = require('./lib/stamping.cjs');
const { isInside, resolveProjectCaseFolder } = require('./workspace-paths.cjs');

function lastStampingPath(caseFolder) {
  return path.join(caseFolder, '.piecemaker', 'last-stamping.json');
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

function stampingHandler(homeDir) {
  return async (req, res) => {
    try {
      const { pieces, folder } = req.body;

      if (!pieces || !Array.isArray(pieces) || pieces.length === 0) {
        return res.status(400).json({ error: 'Liste de pièces requise.' });
      }

      let workingFolder;
      try {
        workingFolder = resolveProjectCaseFolder(String(folder || '').trim());
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const tamponPath = path.join(homeDir, 'tampon.png');
      if (!fs.existsSync(tamponPath)) {
        return res.status(400).json({ error: 'Aucun tampon configuré. Créez-le dans le volet Bordereau.' });
      }

      // Un ancien tampon JPEG peut légitimement porter le nom `tampon.png`.
      const tamponBuffer = fs.readFileSync(tamponPath);
      const tamponFormat = detectStampImage(tamponBuffer).format;

      const tamponnedDir = stampedPiecesDirectory(workingFolder);
      fs.mkdirSync(tamponnedDir, { recursive: true });

      const { PDFDocument, rgb } = require('pdf-lib');
      const results = [];

      // Dossier temporaire des PDF intermédiaires (Excel, Word, images, texte).
      const conversionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-conversion-'));

      for (let i = 0; i < pieces.length; i++) {
        const pieceId = pieces[i];
        const pieceNumber = i + 1;

        try {
          const filePath = resolveCaseRelativeFile(workingFolder, pieceId);

          if (!filePath) {
            results.push({
              pieceNumber,
              id: pieceId,
              filename: pieceId,
              success: false,
              error: `Fichier introuvable : ${pieceId}`,
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
            filename: pieceId,
            outputFileName,
            outputPath,
            converted: conversion.converted,
            conversionEngine: conversion.engine,
            success: true,
          });
        } catch (error) {
          results.push({ pieceNumber, id: pieceId, filename: pieceId, success: false, error: error.message });
        }
      }

      try {
        fs.rmSync(conversionDir, { recursive: true, force: true });
      } catch {
        // Le nettoyage des PDF intermédiaires est opportuniste.
      }

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      const response = {
        success: true,
        folder: workingFolder,
        tamponnedDir,
        results,
        summary: { total: pieces.length, success: successCount, failure: failureCount },
        message: `Tamponnage terminé : ${successCount} pièce(s) traitée(s), ${failureCount} erreur(s).`,
      };
      const lastStampingFile = lastStampingPath(workingFolder);
      fs.mkdirSync(path.dirname(lastStampingFile), { recursive: true });
      const temporaryFile = `${lastStampingFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryFile, JSON.stringify(response, null, 2), 'utf8');
      fs.renameSync(temporaryFile, lastStampingFile);

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

function createStampingRouter({ homeDir = path.join(os.homedir(), '.piecemaker') } = {}) {
  const express = require('express');
  const router = express.Router();

  const getSystemDataPath = (...segments) => path.join(homeDir, ...segments);

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

  router.get('/stamping/last', (req, res) => {
    try {
      const file = lastStampingPath(resolveProjectCaseFolder(String(req.query.folder || '').trim()));
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Aucun bordereau enregistré.' });
      res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/stamping', stampingHandler(homeDir));

  return router;
}

function createStampingLocalRouter({ homeDir, isLoopback }) {
  const express = require('express');
  const router = express.Router();
  const stamp = stampingHandler(homeDir);
  router.post('/stamping', express.json(), (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: 'Réservé aux appels locaux.' });
    return stamp(req, res);
  });
  return router;
}

module.exports = { createStampingLocalRouter, createStampingRouter };
