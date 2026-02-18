export type FileType =
  | "rgb-image"
  | "grayscale-image"
  | "optical-flow"
  | "remap"
  | "other";

export type FileEntry = {
  path: string; // e.g. folder/sub/img1
  type: FileType;
  data: ArrayBuffer; // binary payload
  width?: number;
  height?: number;
  channels?: number; // 1 or 4 for images
};
