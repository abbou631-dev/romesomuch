const files = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/experiences/*.{jpeg,jpg,png,webp,avif}",
  { eager: true },
);

// Content refers to a photo by name ("vatican-gallery"); the CMS writes a full
// path ("/src/assets/experiences/vatican-gallery.jpeg"). Both resolve here.
const key = (value: string) => value.split("/").pop()!.replace(/\.[^.]+$/, "");

const byName = new Map<string, ImageMetadata>(
  Object.entries(files).map(([path, mod]) => [key(path), mod.default]),
);

export const photo = (name: string): ImageMetadata => {
  const file = byName.get(key(name));
  if (!file) throw new Error(`Missing photo asset: ${name}`);
  return file;
};
