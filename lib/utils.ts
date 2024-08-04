import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAgo(date: Date, lang = "en") {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  // if less than one hour -> display minutes
  if (diffInMinutes < 60) {
    return `${diffInMinutes} min`;
  }

  // if less than a day -> display hours
  if (diffInHours < 24) {
    return `${diffInHours}h`;
  }

  const yearNow = now.getFullYear();
  const yearDate = date.getFullYear();

  // if in the same year -> display day of the month + month in long ex: 12 Nov.
  if (yearNow === yearDate) {
    return new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date);
  }

  // Define the formatter for the date
  const formatter = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

  // if it's last year or older -> display date, month, and year ex: 12 Nov. 2020
  return formatter.format(date);
}

// export function formatSize(size: number): string {
//   if (size === 0) return "0 Bytes";
//   const k = 1024;
//   const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
//   const i = Math.floor(Math.log(size) / Math.log(k));
//   const formattedSize = parseFloat((size / Math.pow(k, i)).toFixed(2));
//   return `${formattedSize} ${sizes[i]}`;
// }

export function formatSize(bytes: number, decimals: number = 0): string {
  if (!+bytes) return "0 Byt";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function joinHttpPaths(base: string, path: string) {
  // Remove trailing slash from base if present
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  // Remove leading slash from path if present
  if (path.startsWith("/")) {
    path = path.slice(1);
  }

  // Return the joined path
  return `${base}/${path}`;
}

export function checkFileType(filename: string) {
  const extension = filename.split(".").pop() ?? "";
  const imageExtensions = ["jpg", "jpeg", "png", "gif", "svg"];
  const audioExtensions = ["mp3", "wav", "ogg"];
  const videoExtensions = ["mp4", "mkv", "avi", "webm"];
  const pdfExtensions = ["pdf"];
  const zipExtensions = ["zip", "rar", "7z", "tar", "gz", "bz2"];

  if (imageExtensions.includes(extension)) return "image";
  else if (audioExtensions.includes(extension)) return "audio";
  else if (videoExtensions.includes(extension)) return "video";
  else if (pdfExtensions.includes(extension)) return "pdf";
  else if (zipExtensions.includes(extension)) return "zip";
  else return "file";
}
