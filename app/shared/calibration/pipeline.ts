import { WasmWorkerClient } from "@/shared/wasm/client";
import { getFile, putFile } from "@/shared/db";
import { fileToRGBA, jsonFile, remapFile, remapXYFile } from "@/shared/util/fileEntry";
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
    // Compute intrinsics/extrinsics depending on model
    const exec =
      model === "fisheye"
        ? await wrk.cvCalcInnerParamsFisheyeExt(
            width,
            height,
            dets.map((d) => d.points)
          )
        : await wrk.cvCalcInnerParamsExt(
            width,
            height,
            dets.map((d) => d.points)
          );

    const { ok, intr, dist, rvecs, tvecs } = exec;
    log(
      `✓ Intrinsics/Extrinsics computed (${camName}${model === "fisheye" ? ", fisheye" : ""})${
        ok ? "" : " (warning: ok=false)"
      }`
    );

    // Consolidated per-camera JSON (intrinsics + distCoeffs + optional extrinsics frames)
    const out: any = {
      width,
      height,
      model,
      intrinsics3x3: Array.from(intr),
      distCoeffs: Array.from(dist),
    };
    if (rvecs && tvecs) {
      out.frames = dets.map((d, i) => ({
        ts: d.ts,
        rvec: Array.from(rvecs.slice(i * 3, i * 3 + 3)),
        tvec: Array.from(tvecs.slice(i * 3, i * 3 + 3)),
      }));
    }
    await putFile(
      jsonFile(
        `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_calibration.json`,
        out
      )
    );
    return { intr, dist, rvecs, tvecs } as const;
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
      remapXYFile(
        `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_remapXY.xy`,
        mapX,
        mapY,
        width,
        height
      )
    );
    log(`✓ Undistortion map (${camName}) saved (XY)`);
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
  const candidates: { ts: string; H: Float32Array; rmse: number; inliers: number; total: number; a: Det; b: Det }[] = [];
  for (const a of detA) {
    const b = detB.find((x) => x.ts === a.ts);
    if (!b) continue;
    try {
      const { H, rmse, inliers, total } = await wrk.cvCalcHomographyUndistQuality(a.points, b.points, intrA, distA, intrB, distB);
      candidates.push({ ts: a.ts, H, rmse, inliers, total, a, b });
    } catch (e: any) {
      log(`! Homography quality failed: ${a.ts} (${String(e)})`);
    }
  }
  // Select best candidate and emit canonical files (without <ts>)
  if (candidates.length > 0) {
    const N = candidates[0].total || (detA[0]?.points?.length ?? 0) / 2;
    const best = candidates
      .map((c) => ({ ...c, inlierRatio: N > 0 ? c.inliers / N : 0 }))
      .sort((a, b) => (b.inlierRatio - a.inlierRatio) || (a.rmse - b.rmse))[0];
    try {
      // Canonical A->B JSON (with metrics)
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_H_undist.json`,
          { homography3x3: Array.from(best.H), metrics: { rmse: best.rmse, inliers: best.inliers, total: N, selectedTs: best.ts } }
        )
      );
      const aMatch = best.a;
      const bMatch = best.b;
      const widthA = aMatch.width;
      const heightA = aMatch.height;
      const widthB = bMatch.width;
      const heightB = bMatch.height;
      const { mapX, mapY } = await wrk.cvCalcInterRemapUndist(
        widthA,
        heightA,
        widthB,
        heightB,
        intrA,
        distA,
        intrB,
        distB,
        best.H
      );
      await putFile(
        remapXYFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_mappingXY.xy`,
          mapX,
          mapY,
          widthA,
          heightA
        )
      );
      // Also compute canonical B->A using the same selected ts (recompute H for B->A)
      const rev = await wrk.cvCalcHomographyUndistQuality(bMatch.points, aMatch.points, intrB, distB, intrA, distA);
      await putFile(
        jsonFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_to_cam-${sanitize(camA)}_H_undist.json`,
          { homography3x3: Array.from(rev.H), metrics: { rmse: rev.rmse, inliers: rev.inliers, total: N, selectedTs: best.ts } }
        )
      );
      const revMap = await wrk.cvCalcInterRemapUndist(
        widthB,
        heightB,
        widthA,
        heightA,
        intrB,
        distB,
        intrA,
        distA,
        rev.H
      );
      await putFile(
        remapXYFile(
          `2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_to_cam-${sanitize(camA)}_mappingXY.xy`,
          revMap.mapX,
          revMap.mapY,
          widthB,
          heightB
        )
      );
      log(`✓ Selected best mapping ts=${best.ts} (A→B inliers=${best.inliers}/${N}, rmse=${best.rmse.toFixed(3)}px). Canonical A→B and B→A files saved.`);
    } catch (e: any) {
      log(`! Canonical mapping save failed: ${String(e)}`);
    }
  }
  return saved;
}
