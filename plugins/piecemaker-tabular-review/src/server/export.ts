import path from 'node:path';

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';

import type { Cell, ExportFormat, ExportResult, Flag, Review, ReviewRow } from '../shared.js';
import { FLAG_COLORS, FLAG_LABELS, FLAGS } from '../shared.js';
import { reviewDirectory, UserError, writeFileAtomic } from './paths.js';
import { readReview } from './reviews.js';
import { createZip } from './zip.js';

type CellContent = { flag: Flag | null; summary: string[]; reasoning: string[] };

export function markdownToLines(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1].trim()));
}

function rowStatusText(row: ReviewRow): string {
  if (row.status === 'error') return `Erreur : ${row.error ?? 'session IA en échec'}`;
  if (row.status === 'cancelled') return 'Annulée';
  if (row.status === 'pending' || row.status === 'running') return 'Non traitée';
  return '';
}

export function cellContent(review: Review, row: ReviewRow, columnIndex: number): CellContent {
  const cell: Cell | undefined = review.cells[row.id]?.[String(columnIndex)];
  if (!cell) return { flag: null, summary: [rowStatusText(row) || '—'], reasoning: [] };
  const citations = (cell.citations ?? []).map((citation, index) => `[${index + 1}] « ${citation.quote} » (${citation.document})${citation.verified ? '' : ' — extrait non retrouvé dans la source'}`);
  return { flag: cell.flag, summary: markdownToLines(cell.summary), reasoning: [...markdownToLines(cell.reasoning), ...citations] };
}

function metaLines(review: Review): string[] {
  return [
    `Modèle : ${review.templateName}`,
    ...(review.research ? [`Requête Légifrance : ${review.research.query}`, `Critères : ${review.research.criteria.join(' · ')}`] : []),
    `Dossier : ${review.projectPath}`,
    `Date : ${new Date(review.createdAt).toLocaleString('fr-FR')}`,
    `IA : ${review.provider} — ${review.model}`,
  ];
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function run(text: string, options: { bold?: boolean; italic?: boolean; color?: string; size?: number } = {}): string {
  const properties = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    options.bold ? '<w:b/>' : '',
    options.italic ? '<w:i/>' : '',
    options.color ? `<w:color w:val="${options.color.replace('#', '')}"/>` : '',
    `<w:sz w:val="${options.size ?? 18}"/>`,
  ].join('');
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function paragraph(runs: string, spacingAfter = 40): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${spacingAfter}"/></w:pPr>${runs}</w:p>`;
}

function tableCell(content: string, width: number, shading?: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : ''}</w:tcPr>${content}</w:tc>`;
}

function docxCell(content: CellContent): string {
  const paragraphs = content.summary.map((line, index) => paragraph(`${index === 0 && content.flag ? run('● ', { color: FLAG_COLORS[content.flag], size: 18 }) : ''}${run(line)}`));
  for (const line of content.reasoning) paragraphs.push(paragraph(run(line, { italic: true, color: '#6b7280', size: 15 })));
  return paragraphs.join('') || paragraph(run(''));
}

export function buildDocx(review: Review): Buffer {
  const pageWidth = 16838 - 2 * 720;
  const labelWidth = Math.round(pageWidth * (review.columns.length > 6 ? 0.14 : 0.18));
  const columnWidth = Math.floor((pageWidth - labelWidth) / Math.max(1, review.columns.length));
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>`).join('');
  const grid = `<w:tblGrid><w:gridCol w:w="${labelWidth}"/>${review.columns.map(() => `<w:gridCol w:w="${columnWidth}"/>`).join('')}</w:tblGrid>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tableCell(paragraph(run('Document', { bold: true })), labelWidth, 'F3F4F6')}${review.columns.map((column) => tableCell(paragraph(run(column.name, { bold: true })), columnWidth, 'F3F4F6')).join('')}</w:tr>`;
  const rows = review.rows.map((row) => {
    const label = paragraph(run(row.label, { bold: true })) + row.documents.map((document) => paragraph(run(document.source, { color: '#6b7280', size: 14 }))).join('');
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tableCell(label, labelWidth)}${review.columns.map((column) => tableCell(docxCell(cellContent(review, row, column.index)), columnWidth)).join('')}</w:tr>`;
  }).join('');
  const legend = paragraph(FLAGS.map((flag) => `${run('● ', { color: FLAG_COLORS[flag] })}${run(`${FLAG_LABELS[flag]}    `, { size: 16 })}`).join(''), 160);
  const body = [
    paragraph(run(review.title, { bold: true, size: 32 }), 80),
    ...metaLines(review).map((line) => paragraph(run(line, { color: '#4b5563', size: 18 }), 20)),
    legend,
    `<w:tbl><w:tblPr><w:tblW w:w="${pageWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${header}${rows}</w:tbl>`,
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>',
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', content: documentXml },
  ]);
}

const PDF_REPLACEMENTS: Record<string, string> = {
  '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '‑': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '✕': 'x', '✓': 'v',
};

function pdfSanitizer(font: PDFFont): (value: string) => string {
  const supported = new Set(font.getCharacterSet());
  return (value) => [...value.replace(/\t/g, ' ')].map((character) => {
    const code = character.codePointAt(0)!;
    if (supported.has(code)) return character;
    if (PDF_REPLACEMENTS[character]) return PDF_REPLACEMENTS[character];
    const base = character.normalize('NFD')[0];
    return base && supported.has(base.codePointAt(0)!) ? base : '';
  }).join('');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  const push = () => {
    lines.push(current);
    current = '';
  };
  for (const word of text.split(/ +/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) push();
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current || !lines.length) push();
  return lines;
}

type PdfLine = { text: string; font: PDFFont; size: number; color: [number, number, number] };

function hexColor(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export async function buildPdf(review: Review): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(review.title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const clean = pdfSanitizer(regular);
  const [pageWidth, pageHeight] = [841.89, 595.28];
  const margin = 28;
  const padding = 4;
  const size = 7.5;
  const smallSize = 6.5;
  const lineHeight = (fontSize: number) => fontSize * 1.28;
  const tableWidth = pageWidth - 2 * margin;
  const labelWidth = Math.min(150, tableWidth * (review.columns.length > 6 ? 0.14 : 0.18));
  const columnWidth = (tableWidth - labelWidth) / Math.max(1, review.columns.length);
  const widths = [labelWidth, ...review.columns.map(() => columnWidth)];
  const ink: [number, number, number] = [0.07, 0.09, 0.15];
  const muted: [number, number, number] = [0.42, 0.45, 0.5];
  const maxCellHeight = pageHeight - 2 * margin - 60;

  const toLines = (text: string, font: PDFFont, fontSize: number, color: [number, number, number], width: number): PdfLine[] =>
    wrap(clean(text), font, fontSize, width).map((line) => ({ text: line, font, size: fontSize, color }));

  const clampLines = (lines: PdfLine[]): PdfLine[] => {
    let height = 0;
    const kept: PdfLine[] = [];
    for (const line of lines) {
      if (height + lineHeight(line.size) > maxCellHeight - 2 * padding) {
        kept.push({ ...line, text: '[…] voir la version Word', font: italic, color: muted });
        break;
      }
      height += lineHeight(line.size);
      kept.push(line);
    }
    return kept;
  };

  let page: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;

  const drawText = (line: PdfLine, x: number, y: number) => {
    page.drawText(line.text, { x, y, size: line.size, font: line.font, color: rgb(...line.color) });
  };

  const drawRow = (cells: { lines: PdfLine[]; flag: Flag | null }[], fill?: [number, number, number]) => {
    const heights = cells.map((cell) => cell.lines.reduce((total, line) => total + lineHeight(line.size), 0) + 2 * padding);
    const height = Math.max(...heights, 14);
    let x = margin;
    cells.forEach((cell, index) => {
      page.drawRectangle({ x, y: cursor - height, width: widths[index], height, borderColor: rgb(0.82, 0.84, 0.86), borderWidth: 0.5, ...(fill ? { color: rgb(...fill) } : {}) });
      let y = cursor - padding;
      cell.lines.forEach((line, lineIndex) => {
        y -= lineHeight(line.size);
        const offset = lineIndex === 0 && cell.flag ? 8 : 0;
        if (offset) page.drawCircle({ x: x + padding + 2.5, y: y + line.size * 0.32, size: 2.5, color: rgb(...hexColor(FLAG_COLORS[cell.flag!])) });
        drawText(line, x + padding + offset, y + 1.5);
      });
      x += widths[index];
    });
    cursor -= height;
  };

  const headerCells = () => [
    { lines: toLines('Document', bold, size, ink, labelWidth - 2 * padding), flag: null },
    ...review.columns.map((column) => ({ lines: toLines(column.name, bold, size, ink, columnWidth - 2 * padding), flag: null })),
  ];

  toLines(review.title, bold, 16, ink, tableWidth).forEach((line) => {
    cursor -= lineHeight(16);
    drawText(line, margin, cursor);
  });
  cursor -= 4;
  for (const meta of metaLines(review)) {
    cursor -= lineHeight(8);
    drawText({ text: clean(meta), font: regular, size: 8, color: muted }, margin, cursor);
  }
  cursor -= lineHeight(8) + 2;
  let legendX = margin;
  for (const flag of FLAGS) {
    page.drawCircle({ x: legendX + 3, y: cursor + 2.5, size: 3, color: rgb(...hexColor(FLAG_COLORS[flag])) });
    const label = clean(FLAG_LABELS[flag]);
    page.drawText(label, { x: legendX + 9, y: cursor, size: 7.5, font: regular, color: rgb(...muted) });
    legendX += regular.widthOfTextAtSize(label, 7.5) + 24;
  }
  cursor -= 12;
  drawRow(headerCells(), [0.95, 0.96, 0.97]);

  for (const row of review.rows) {
    const labelLines = [
      ...toLines(row.label, bold, size, ink, labelWidth - 2 * padding),
      ...row.documents.flatMap((document) => toLines(document.source, regular, smallSize, muted, labelWidth - 2 * padding)),
    ];
    const cells = [
      { lines: clampLines(labelLines), flag: null as Flag | null },
      ...review.columns.map((column) => {
        const content = cellContent(review, row, column.index);
        const width = columnWidth - 2 * padding - (content.flag ? 8 : 0);
        const lines = [
          ...content.summary.flatMap((line) => toLines(line, regular, size, ink, width)),
          ...content.reasoning.flatMap((line) => toLines(line, italic, smallSize, muted, width)),
        ];
        return { lines: clampLines(lines), flag: content.flag };
      }),
    ];
    const height = Math.max(...cells.map((cell) => cell.lines.reduce((total, line) => total + lineHeight(line.size), 0) + 2 * padding));
    if (cursor - height < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - margin;
      drawRow(headerCells(), [0.95, 0.96, 0.97]);
    }
    drawRow(cells);
  }

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    const label = `${index + 1} / ${pages.length}`;
    current.drawText(label, { x: pageWidth - margin - regular.widthOfTextAtSize(label, 7), y: margin / 2, size: 7, font: regular, color: rgb(...muted) });
  });
  return Buffer.from(await pdf.save());
}

export async function exportReview(project: string, file: string, format: unknown): Promise<ExportResult> {
  if (format !== 'docx' && format !== 'pdf') throw new UserError('Format d’export non pris en charge.');
  const review = readReview(project, file);
  const content = format === 'docx' ? buildDocx(review) : await buildPdf(review);
  const filename = `${path.basename(file, '.json')}.${format satisfies ExportFormat}`;
  const target = path.join(reviewDirectory(project), filename);
  writeFileAtomic(target, content);
  return { path: target, filename, base64: content.toString('base64') };
}
