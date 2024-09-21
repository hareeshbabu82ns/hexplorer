import ImageViewer from "../_components/image-viewer";
import MarkdownViewer from "../_components/markdown-viewer";
import PDFViewer from "../_components/pdf-viewer";

const FileViewPage = ({ params }: { params: { path: string[] } }) => {
  const filePath = params.path.join("/");
  const fileExt = filePath.split(".").pop();

  switch (fileExt) {
    case "md":
      return <MarkdownViewer filePath={filePath} />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
      return <ImageViewer filePath={filePath} />;
    // case "pdf":
    //   return <PDFViewer filePath={filePath} />;
    default:
      return <div>Unsupported file type</div>;
  }
};

export default FileViewPage;
