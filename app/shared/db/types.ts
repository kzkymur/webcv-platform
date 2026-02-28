export type FileType =
  | "rgb-image"
  | "grayscale-image"
  | "optical-flow"
  | "remap"
  | "remapXY"
  | "homography-json"
  | "undist-json"
  | "figure"
  | "other";

export type FileEntry = {
  path: string; // e.g. folder/sub/img1
  type: FileType;
  // For listings, `data` may be omitted for performance; callers that need
  // payloads should fetch via `getFile(path)`.
  data?: ArrayBuffer; // binary payload
  width?: number;
  height?: number;
  channels?: number; // 1 or 4 for images
};
