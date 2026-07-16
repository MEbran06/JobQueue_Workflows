import type { DragEvent } from 'react';
import { TYPE_META } from '../constants.ts';
import type { StepType } from '../constants.ts';

const PALETTE_TYPES = Object.keys(TYPE_META) as StepType[];

function onPaletteDrag(e: DragEvent<HTMLDivElement>, type: StepType) {
  e.dataTransfer.setData('type', type);
}

interface PaletteProps {
  width: number;
}

function Palette({ width }: PaletteProps) {
  return (
    <div id="palette" style={{ width }}>
      <h2>Steps</h2>
      {PALETTE_TYPES.map((type) => {
        const meta = TYPE_META[type];
        return (
          <div
            key={type}
            className={`palette-item ${type}`}
            draggable="true"
            onDragStart={(e) => onPaletteDrag(e, type)}
          >
            {meta.icon} {meta.label}
          </div>
        );
      })}
    </div>
  );
}

export default Palette;
