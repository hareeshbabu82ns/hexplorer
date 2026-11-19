import { ImageResponse } from "next/og";

export const runtime = "edge";
const SIZES = [180, 192, 512];

export function generateStaticParams() {
  return [...SIZES.map((s) => ({ size: String(s) })), { size: "maskable-512" }];
}

/** app icons for the web manifest / apple-touch-icon, drawn at build time */
export function GET(_req: Request, { params }: { params: { size: string } }) {
  const maskable = params.size.startsWith("maskable-");
  const size = Number(params.size.replace("maskable-", ""));
  if (!SIZES.includes(size)) return new Response("not found", { status: 404 });
  // maskable icons must keep the logo inside the central 80% safe zone
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #22c55e 0%, #15803d 100%)",
          borderRadius: maskable || size === 180 ? 0 : Math.round(size * 0.22),
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: glyph,
            fontWeight: 800,
            color: "white",
            letterSpacing: -glyph * 0.04,
          }}
        >
          H
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
