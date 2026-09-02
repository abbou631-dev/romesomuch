const files = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/experiences/*.jpeg",
  { eager: true },
);

const byName = new Map<string, ImageMetadata>(
  Object.entries(files).map(([path, mod]) => [
    path.split("/").pop()!.replace(".jpeg", ""),
    mod.default,
  ]),
);

export const photo = (name: string): ImageMetadata => {
  const file = byName.get(name);
  if (!file) throw new Error(`Missing photo asset: ${name}.jpeg`);
  return file;
};
