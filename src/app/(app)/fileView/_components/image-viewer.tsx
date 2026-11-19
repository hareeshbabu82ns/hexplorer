/* eslint-disable @next/next/no-img-element */
export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="max-h-[80vh] max-w-full rounded border" />;
}
