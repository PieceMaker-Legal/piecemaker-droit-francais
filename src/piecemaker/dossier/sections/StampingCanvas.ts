/**
 * Renders the cabinet stamp (border + top/bottom text) on an off-DOM canvas.
 *
 * Ported from the standalone PieceMaker admin's canvas generator
 * (`PieceMaker-Installer/admin/stamp-builder.mjs`) so both UIs draw pixel-identical
 * stamps. The piece number is deliberately never drawn here: the backend centers it
 * on the 100pt square at stamping time (`stamping-routes.cjs`), so the saved stamp
 * stays reusable across every piece.
 */

export type StampShape = 'circle' | 'oval' | 'rounded' | 'rect';
export type StampBorder = 'single' | 'double';
export type StampFont = 'sans' | 'serif' | 'mono';

export type StampConfig = {
  topText: string;
  bottomText: string;
  shape: StampShape;
  border: StampBorder;
  font: StampFont;
  color: string;
  lineWidth: number;
};

export const DEFAULT_STAMP_CONFIG: StampConfig = {
  topText: 'CABINET',
  bottomText: 'PIÈCE COMMUNIQUÉE',
  shape: 'circle',
  border: 'double',
  font: 'sans',
  color: '#1f4f45',
  lineWidth: 10,
};

const CANVAS_SIZE = 600;
const CENTER = CANVAS_SIZE / 2;

const FONT_FAMILIES: Record<StampFont, string> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Courier, monospace',
};

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function traceBorder(context: CanvasRenderingContext2D, shape: StampShape, inset: number): void {
  const radius = 276 - inset;
  if (shape === 'circle') {
    context.beginPath();
    context.arc(CENTER, CENTER, radius, 0, Math.PI * 2);
    context.stroke();
  } else if (shape === 'oval') {
    context.beginPath();
    context.ellipse(CENTER, CENTER, radius, radius * 0.72, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (shape === 'rounded') {
    roundedRectPath(context, 24 + inset, 90 + inset, 552 - inset * 2, 420 - inset * 2, 58);
    context.stroke();
  } else {
    context.strokeRect(24 + inset, 90 + inset, 552 - inset * 2, 420 - inset * 2);
  }
}

function fitFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferredSize: number,
  fontFamily: string,
  minimumSize = 18,
): number {
  let size = preferredSize;
  do {
    context.font = `700 ${size}px ${fontFamily}`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 1;
  } while (size > minimumSize);
  return minimumSize;
}

function straightText(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  maxWidth: number,
  preferredSize: number,
  fontFamily: string,
): void {
  if (!text) return;
  const size = fitFontSize(context, text, maxWidth, preferredSize, fontFamily);
  context.font = `700 ${size}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, CENTER, y);
}

type CurvedTextOptions = {
  radius: number;
  centerAngle: number;
  direction: 1 | -1;
  maxArc: number;
};

function curvedText(
  context: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  { radius, centerAngle, direction, maxArc }: CurvedTextOptions,
): void {
  if (!text) return;
  const characters = [...text];
  let fontSize = 58;
  let widths: number[] = [];
  let totalWidth = 0;
  do {
    context.font = `700 ${fontSize}px ${fontFamily}`;
    widths = characters.map((character) => context.measureText(character).width + fontSize * 0.06);
    totalWidth = widths.reduce((sum, width) => sum + width, 0);
    fontSize -= 1;
  } while (totalWidth / radius > maxArc && fontSize > 24);

  const totalAngle = totalWidth / radius;
  let angle = centerAngle - (direction * totalAngle) / 2;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  characters.forEach((character, index) => {
    const characterAngle = widths[index] / radius;
    angle += (direction * characterAngle) / 2;
    context.save();
    context.translate(CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius);
    context.rotate(angle + (direction === 1 ? Math.PI / 2 : -Math.PI / 2));
    context.fillText(character, 0, 0);
    context.restore();
    angle += (direction * characterAngle) / 2;
  });
}

/** Draws `config` on a fresh 600x600 canvas and returns it as a PNG data URL. */
export function renderStampDataUrl(config: StampConfig): string {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Le canvas 2D est indisponible dans ce navigateur.');

  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.strokeStyle = config.color;
  context.fillStyle = config.color;
  context.lineWidth = config.lineWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const fontFamily = FONT_FAMILIES[config.font];

  traceBorder(context, config.shape, 0);
  if (config.border === 'double') traceBorder(context, config.shape, 24);

  if (config.shape === 'circle' || config.shape === 'oval') {
    const radius = config.shape === 'circle' ? 205 : 185;
    const verticalScale = config.shape === 'circle' ? 1 : 0.76;
    context.save();
    context.translate(CENTER, CENTER);
    context.scale(1, verticalScale);
    context.translate(-CENTER, -CENTER);
    curvedText(context, config.topText, fontFamily, { radius, centerAngle: -Math.PI / 2, direction: 1, maxArc: Math.PI * 1.25 });
    curvedText(context, config.bottomText, fontFamily, { radius, centerAngle: Math.PI / 2, direction: -1, maxArc: Math.PI * 1.25 });
    context.restore();

    context.beginPath();
    context.arc(96, CENTER, 7, 0, Math.PI * 2);
    context.arc(504, CENTER, 7, 0, Math.PI * 2);
    context.fill();
  } else {
    straightText(context, config.topText, 205, 470, 72, fontFamily);
    straightText(context, config.bottomText, 405, 470, 52, fontFamily);
  }

  return canvas.toDataURL('image/png');
}
