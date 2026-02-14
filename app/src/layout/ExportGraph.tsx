import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportGraphProps {
  canvas: HTMLCanvasElement | undefined | null;
  filename: string;
}

const ExportGraph: React.FC<ExportGraphProps> = (props) => {
  const { canvas, filename } = props;
  return (
    <Button
      id="save"
      className="w-full"
      onClick={() => {
        canvas?.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${filename}.png`;
            a.click();
          }
        });
      }}
    >
      <Download className="mr-3 h-5 w-5" />
      Export Graph
    </Button>
  );
};

export default ExportGraph;
