import { useEffect, useRef } from 'react';

interface ResizerProps {
  axis: 'x' | 'y';
  onResize: (delta: number) => void;
}

function Resizer({ axis, onResize }: ResizerProps) {
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      onResize(axis === 'x' ? e.movementX : e.movementY);
    }
    function onMouseUp() {
      draggingRef.current = false;
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [axis, onResize]);

  return (
    <div
      className={`resizer resizer-${axis}`}
      onMouseDown={(e) => {
        e.preventDefault();
        draggingRef.current = true;
      }}
    />
  );
}

export default Resizer;
