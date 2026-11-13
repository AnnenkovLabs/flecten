/** Explicit catalog capabilities; a false override wins over listed modalities. */
export function hasVision(
  model:
    | {
        vision?: boolean | undefined;
        modalities?:
          | { input?: readonly string[] | undefined; output?: readonly string[] | undefined }
          | undefined;
      }
    | undefined,
): boolean {
  return model?.vision ?? model?.modalities?.input?.includes("image") ?? false;
}

export function acceptsImages(modalities: readonly string[] | undefined): boolean {
  return !modalities?.length || modalities.includes("image");
}

export function canDescribeImages(model: Parameters<typeof hasVision>[0]): boolean {
  return (
    hasVision(model) &&
    (!model?.modalities?.output?.length || model.modalities.output.includes("text"))
  );
}
