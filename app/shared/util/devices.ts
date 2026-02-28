import { readNamespacedStore } from "@/shared/module/loaclStorage";

export type MediaDeviceInfoLite = Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">;

export async function listMergedVideoInputs(): Promise<MediaDeviceInfoLite[]> {
  const list = await navigator.mediaDevices?.enumerateDevices();
  const vids: MediaDeviceInfoLite[] = (list || []).filter((d) => d.kind === "videoinput");
  const ws = getWsCameras();
  const wsDevs: MediaDeviceInfoLite[] = ws.map((url) => ({ deviceId: url, label: `(WS) ${url}`, kind: "videoinput" as const }));
  return [...vids, ...wsDevs];
}

export function getWsCameras(): string[] {
  const st = readNamespacedStore<{ wsCameras?: string[] }>();
  return Array.isArray(st.wsCameras) ? st.wsCameras : [];
}

