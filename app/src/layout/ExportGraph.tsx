import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/utils/dom";

interface ExportGraphProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  filename: string;
}

const ExportGraph: React.FC<ExportGraphProps> = (props) => {
  const { canvasRef, filename } = props;
  return (
    <Button
      className="w-full"
      onClick={() => {
        canvasRef.current?.toBlob((blob) => {
          if (blob) downloadBlob(blob, `${filename}.png`);
        });
      }}
    >
      <Download className="mr-3 h-5 w-5" />
      Export Graph
    </Button>
  );
};

export default ExportGraph;
