/** default label for a new passkey, e.g. "iPad · 18/11/2026" */
export function deviceName() {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = ipad
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  return `${os} · ${new Date().toLocaleDateString()}`;
}
