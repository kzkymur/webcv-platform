import { WasmWorkerClient } from "@/shared/wasm/client";
import { getFile, putFile } from "@/shared/db";
import { fileToRGBA, jsonFile, remapFile } from "@/shared/util/fileEntry";
import { sanitize } from "@/shared/util/strings";

export type CameraModel = "normal" | "fisheye";

export type Det = {
  ts: string;
  cam: string;
  path: string;
  width: number;
  height: number;
  points: Float32Array;
};

export async function detectCornersForRows(
  wrk: WasmWorkerClient,
  camA: string,
  camB: string,
  rows: { ts: string; cams: Record<string, string> }[],
  log: (s: string) => void
) {
  const detA: Det[] = [];
  const detB: Det[] = [];
  for (const r of rows) {
    for (const cam of [camA, camB]) {
      const path = r.cams[cam];
      if (!path) continue;
      const fe = await getFile(path);
      if (!fe) continue;
      const { rgba, width, height } = fileToRGBA(fe);
      const res = await wrk.cvFindChessboardCorners(rgba, width, height);
      if (!res.found) {
        log(`× Corner detection failed: ${r.ts} cam=${cam}`);
        continue;
      }
      const det: Det = { ts: r.ts, cam, path, width, height, points: res.points };
      if (cam === camA) detA.push(det); else detB.push(det);
      log(`✓ Corners detected: ${r.ts} cam=${cam} (${width}x${height})`);
    }
  }
  return { detA, detB };
}

export async function computeAndSaveIntrinsics(
  wrk: WasmWorkerClient,
  camName: string,
  model: CameraModel,
  dets: Det[],
  runTs: string,
  log: (s: string) => void
) {
  if (dets.length === 0) return { intr: null, dist: null, rvecs: null, tvecs: null } as const;
  const width = dets[0].width, height = dets[0].height;
  try {
    if (model === "fisheye") {
      const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsFisheyeExt(
        width,
        height,
        dets.map((d) => d.points)
      );
      log(`✓ Intrinsics/Extrinsics computed (${camName}, fisheye)${ok ? "" : " (warning: ok=false)"}`);
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_intrinsics.json`,
          { width, height, intrinsics3x3: Array.from(intr) }
        )
      );
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_distCoeffs.json`,
          { distCoeffs: Array.from(dist) }
        )
      );
      if (rvecs && tvecs) {
        const frames = dets.map((d, i) => ({
          ts: d.ts,
          rvec: Array.from(rvecs.slice(i * 3, i * 3 + 3)),
          tvec: Array.from(tvecs.slice(i * 3, i * 3 + 3)),
        }));
        await putFile(
          jsonFile(
            `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_extrinsics.json`,
            { frames }
          )
        );
      }
      return { intr, dist, rvecs, tvecs } as const;
    } else {
      const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsExt(
        width,
        height,
        dets.map((d) => d.points)
      );
      log(`✓ Intrinsics/Extrinsics computed (${camName})${ok ? "" : " (warning: ok=false)"}`);
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_intrinsics.json`,
          { width, height, intrinsics3x3: Array.from(intr) }
        )
      );
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_distCoeffs.json`,
          { distCoeffs: Array.from(dist) }
        )
      );
      if (rvecs && tvecs) {
        const frames = dets.map((d, i) => ({
          ts: d.ts,
          rvec: Array.from(rvecs.slice(i * 3, i * 3 + 3)),
          tvec: Array.from(tvecs.slice(i * 3, i * 3 + 3)),
        }));
        await putFile(
          jsonFile(
            `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_extrinsics.json`,
            { frames }
          )
        );
      }
      return { intr, dist, rvecs, tvecs } as const;
    }
  } catch (e: any) {
    log(`! Intrinsics (${camName}) failed: ${String(e)}`);
    return { intr: null, dist: null, rvecs: null, tvecs: null } as const;
  }
}

export async function saveUndistortionMaps(
  wrk: WasmWorkerClient,
  camName: string,
  width: number,
  height: number,
  intr: Float32Array | null,
  dist: Float32Array | null,
  runTs: string,
  log: (s: string) => void
) {
  if (!intr || !dist) return;
  try {
    const { mapX, mapY } = await wrk.cvCalcUndistMap(width, height, intr, dist);
    await putFile(
      remapFile(
        `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_remapX`,
        mapX,
        width,
        height
      )
    );
    await putFile(
      remapFile(
        `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_remapY`,
        mapY,
        width,
        height
      )
    );
    log(`✓ Undistortion map (${camName}) saved`);
  } catch (e: any) {
    log(`! Undistortion map (${camName}) failed: ${String(e)}`);
  }
}

export async function computeAndSaveInterMapping(
  wrk: WasmWorkerClient,
  detA: Det[],
  detB: Det[],
  intrA: Float32Array | null,
  distA: Float32Array | null,
  intrB: Float32Array | null,
  distB: Float32Array | null,
  camA: string,
  camB: string,
  runTs: string,
  log: (s: string) => void
) {
  let saved = 0;
  if (!intrA || !distA || !intrB || !distB) {
    log("! Inter mapping skipped: intrinsics missing");
    return saved;
  }
  for (const a of detA) {
    const b = detB.find((x) => x.ts === a.ts);
    if (!b) continue;
    try {
      const { H } = await wrk.cvCalcHomographyUndist(
        a.points,
        b.points,
        intrA,
        distA,
        intrB,
        distB
      );
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(
            camB
          )}_${a.ts}_H_undist.json`,
          { homography3x3: Array.from(H) }
        )
      );
      const { mapX, mapY } = await wrk.cvCalcInterRemapUndist(
        a.width,
        a.height,
        b.width,
        b.height,
        intrA,
        distA,
        intrB,
        distB,
        H
      );
      await putFile(
        remapFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(
            camB
          )}_${a.ts}_mappingX`,
          mapX,
          a.width,
          a.height
        )
      );
      await putFile(
        remapFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(
            camB
          )}_${a.ts}_mappingY`,
          mapY,
          a.width,
          a.height
        )
      );
      saved++;
    } catch (e: any) {
      log(`! Homography save failed: ${a.ts} (${String(e)})`);
    }
  }
  log(`✓ Inter-camera mapping saved (undist domain): ${saved}/${detA.length}`);
  return saved;
}

