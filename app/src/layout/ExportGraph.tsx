import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/utils/dom";

interface ExportGraphProps {
  canvas: HTMLCanvasElement | undefined | null;
  filename: string;
}

const ExportGraph: React.FC<ExportGraphProps> = (props) => {
  const { canvas, filename } = props;
  return (
    <Button
      className="w-full"
      onClick={() => {
        canvas?.toBlob((blob) => {
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
