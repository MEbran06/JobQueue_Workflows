interface ZoomControlProps {
  zoom: number;
  onReset: () => void;
}

function ZoomControl({ zoom, onReset }: ZoomControlProps) {
  return (
    <button className="zoom-control" onClick={onReset} title="Reset zoom">
      {Math.round(zoom * 100)}%
    </button>
  );
}

export default ZoomControl;
