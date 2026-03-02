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
  // Payloadは OPFS(Origin Private File System) の個別ファイルに保存されます。
  // 一覧取得では `data` を返しません。必要な場合は `getFile(path)` を呼んでください。
  data?: ArrayBuffer; // binary payload
  width?: number;
  height?: number;
  channels?: number; // 1 or 4 for images
};
