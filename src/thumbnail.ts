export type ThumbnailMetadata = {
  thumbnail_url?: string;
  thumbnail_urls?: string[];
};

export function thumbnailUrlCandidates(metadata: ThumbnailMetadata) {
  const urls: string[] = [];
  for (const url of [...(metadata.thumbnail_urls ?? []), metadata.thumbnail_url]) {
    if (typeof url !== "string") {
      continue;
    }
    const trimmed = url.trim();
    if (trimmed && !urls.includes(trimmed)) {
      urls.push(trimmed);
    }
  }
  return urls;
}
