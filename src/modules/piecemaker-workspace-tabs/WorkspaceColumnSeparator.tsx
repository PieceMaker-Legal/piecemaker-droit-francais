import { useRef } from 'react';

export function WorkspaceColumnSeparator({ orientation, label, value, onMove }: {
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  onMove: (delta: number) => void;
}) {
  const coordinateRef = useRef(0);
  const horizontal = orientation === 'horizontal';
  return <div
    role="separator" aria-label={label} aria-orientation={orientation}
    aria-valuenow={Math.round(value)} tabIndex={0}
    className={`piecemaker-workspace-divider ${horizontal ? 'is-horizontal' : ''}`}
    onPointerDown={(event) => {
      event.preventDefault();
      coordinateRef.current = horizontal ? event.clientY : event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const coordinate = horizontal ? event.clientY : event.clientX;
      const delta = coordinate - coordinateRef.current;
      coordinateRef.current = coordinate;
      onMove(delta);
    }}
    onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
    onKeyDown={(event) => {
      const delta = event.key === (horizontal ? 'ArrowDown' : 'ArrowRight') ? 10
        : event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft') ? -10 : 0;
      if (!delta) return;
      event.preventDefault();
      onMove(delta);
    }}
  />;
}
