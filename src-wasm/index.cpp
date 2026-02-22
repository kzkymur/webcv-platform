#include "opencv2/core/mat.hpp"
#include <cstdint>
#include <cstring>
#include <opencv2/core/types.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>
#include <stdio.h>
#include <stdlib.h>

#include <opencv2/opencv.hpp>
#include <opencv2/core.hpp>
#include <vector>
#include <cmath>

#include <emscripten/emscripten.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

using namespace std;

// const int CHESS_NUM_X = 9, CHESS_NUM_Y = 6, BLOCK_SIZE = 25;
const int CHESS_NUM_X = 10, CHESS_NUM_Y = 7;
const double BLOCK_SIZE = 1.0f;

int getCanvasImgDataSize (int width, int height) {
  return width * height * 4 * sizeof(uint8_t);
}
cv::Mat readMat32F(const void* pointer, int width, int height) {
  cv::Mat img(height, width, CV_32F);
  memcpy(img.data, pointer, sizeof(float) * width * height);
  return img;
}
cv::Mat readPointsVec2f(const void* pointer, int length) {
  // Nx1, CV_32FC2 (compatible with writeMat(vecPoint2f2Mat(...)))
  cv::Mat pts(length, 1, CV_32FC2);
  memcpy(pts.data, pointer, sizeof(float) * length * 2);
  return pts;
}
cv::Mat readMat64F(const void* pointer, int width, int height) {
  cv::Mat img(height, width, CV_64F);
  memcpy(img.data, pointer, sizeof(double) * width * height);
  return img;
}
int* writeMat (cv::Mat mat) {
  int * dest;
  memcpy(dest, mat.data, mat.total() * mat.elemSize());
  return dest;
}
void writeMat (cv::Mat mat, void * dest) {
  memcpy(dest, mat.data, mat.total() * mat.elemSize());
}
cv::Mat readImg(const void* pointer, int width, int height) {
  cv::Mat img(height, width, CV_8UC4);
  memcpy(img.data, pointer, getCanvasImgDataSize(width, height));
  return img;
}
void* writeImg (cv::Mat mat, int width, int height) {
  void * dest;
  memcpy(dest, mat.data, getCanvasImgDataSize(width, height));
  return dest;
}
void writeImg (cv::Mat mat, int width, int height, void * dest) {
  memcpy(dest, mat.data, getCanvasImgDataSize(width, height));
}

cv::Mat vecPoint3f2Mat (vector<cv::Point3f> vec) {
  cv::Mat mat(vec.size(), 1, CV_32FC3);
  for (size_t i = 0; i < vec.size(); ++i) {
      mat.at<cv::Vec3f>(i, 0) = cv::Vec3f(vec[i].x, vec[i].y, vec[i].z);
  }
  return mat;
};
cv::Mat vecPoint2f2Mat (vector<cv::Point2f> vec) {
  cv::Mat mat(vec.size(), 1, CV_32FC2);
  for (size_t i = 0; i < vec.size(); ++i) {
      mat.at<cv::Vec2f>(i, 0) = cv::Vec2f(vec[i].x, vec[i].y);
  }
  return mat;
};
vector<cv::Point3f> mat2VecPoint3f (cv::Mat mat) {
  std::vector<cv::Point3f> vec;
  for (int i = 0; i < mat.rows; ++i) {
      cv::Vec3f point = mat.at<cv::Vec3f>(i, 0);
      vec.push_back(cv::Point3f(point[0], point[1], point[2]));
  }
  return vec;
}
vector<cv::Point2f> mat2VecPoint2f (cv::Mat mat) {
  std::vector<cv::Point2f> vec;
  for (int i = 0; i < mat.rows; ++i) {
      cv::Vec2f point = mat.at<cv::Vec2f>(i);
      vec.push_back(cv::Point2f(point[0], point[1]));
  }
  return vec;
}

EXTERN EMSCRIPTEN_KEEPALIVE void helloWorld(int argc, char ** argv) {
    printf("hellow world\n");
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getU8Buffer(int size) {
  return (int *)malloc(size * sizeof(uint8_t));
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getI32Buffer(int size) {
  return (int *)malloc(size * sizeof(int32_t));
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getU32Buffer(int size) {
  return (int *)malloc(size * sizeof(uint32_t));
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getFloatBuffer(int size) {
  return (int *)malloc(size * sizeof(float));
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getDoubleBuffer(int size) {
  return (int *)malloc(size * sizeof(double));
}

EXTERN EMSCRIPTEN_KEEPALIVE int * getImgBuffer(int width, int height) {
  return (int *)malloc(getCanvasImgDataSize(width, height));
}

EXTERN EMSCRIPTEN_KEEPALIVE void clearBuffer(int * pointer) {
  free(pointer);
}  

EXTERN EMSCRIPTEN_KEEPALIVE void timesBy2 (const void* pointer, int width, int height, void * dest) {
  const cv::Mat mat = readImg(pointer, width, height);
  mat *= 2;
  writeImg(mat, width, height, dest);
}

EXTERN EMSCRIPTEN_KEEPALIVE bool findChessboardCorners (const void* pointer, int width, int height, void * corners_img_dest) {
  const double BLOCK_SIZE = 1.0f;
  cv::Mat img = readImg(pointer, width, height);
  cv::Mat chess_img = img.clone();
  cv::Size patternsize(CHESS_NUM_X, CHESS_NUM_Y);
  cv::Size image_size = cv::Size(chess_img.cols, chess_img.rows);
  cv::Mat grayImg = cv::Mat(image_size, CV_8UC1);
  cv::cvtColor(chess_img, grayImg, cv::COLOR_RGBA2GRAY);
  // vector<cv::Point3f> corners_local;
  vector<cv::Point2f> image_points;

  // for (int i = 0; i < CHESS_NUM_X * CHESS_NUM_Y; i++) {
  //   corners_local.push_back(cv::Point3f(BLOCK_SIZE * (i % CHESS_NUM_X), BLOCK_SIZE * ((double)i / CHESS_NUM_Y), 0.0f));
  // }

  // チェスボードの内側コーナー位置を求める
  cout << "let's find chess corners" << endl;
  bool found = cv::findChessboardCorners(chess_img, cv::Size(CHESS_NUM_X, CHESS_NUM_Y), image_points, cv::CALIB_CB_ADAPTIVE_THRESH + cv::CALIB_CB_NORMALIZE_IMAGE + cv::CALIB_CB_FAST_CHECK);
  if (found) {
    cout << "chess corners found" << endl;
    writeMat(vecPoint2f2Mat(image_points), corners_img_dest);
    return true;
  } else {
    cout << "chess corners not found" << '\n' << endl;
    return false;
  }
}

static void buildChessObjectPoints(std::vector<std::vector<cv::Point3f>>& objPts, int nImages) {
  objPts.clear();
  std::vector<cv::Point3f> corners_local;
  corners_local.reserve(CHESS_NUM_X * CHESS_NUM_Y);
  for (int j = 0; j < CHESS_NUM_X * CHESS_NUM_Y; j++) {
    float x = (float)(BLOCK_SIZE * (j % CHESS_NUM_X));
    float y = (float)(BLOCK_SIZE * (j / CHESS_NUM_X));
    corners_local.push_back(cv::Point3f(x, y, 0.0f));
  }
  for (int i = 0; i < nImages; i++) objPts.push_back(corners_local);
}

EXTERN EMSCRIPTEN_KEEPALIVE bool calcInnerParams(uint32_t* pointersPointer, const int nPointer, const int imgWidth, const int imgHeight, void* intrMatrixDest, void* distCoeffsDest) {
  cv::Mat intr = cv::Mat::zeros(3, 3, CV_64F);
  cv::Mat dist = cv::Mat::zeros(8, 1, CV_64F);
  vector<cv::Mat> rvecs, tvecs;
  intr.at<double>(0,2) = ((double)imgWidth / 2.0);
  intr.at<double>(1,2) = ((double)imgHeight / 2.0);

  cout << "the number of used images is " << nPointer << endl;
  if (nPointer == 0) return false;

  cv::Size imageSize(imgWidth, imgHeight);
  vector<vector<cv::Point3f>> corners_3d = {};
  vector<vector<cv::Point2f>> corners_imgs = {};
  buildChessObjectPoints(corners_3d, nPointer);
  for (int i = 0; i < nPointer; i++) {
    // points are stored as Nx1 CV_32FC2
    cv::Mat pts = readPointsVec2f((void*)pointersPointer[i], CHESS_NUM_X * CHESS_NUM_Y);
    corners_imgs.push_back(mat2VecPoint2f(pts));
  }

  // インパラの計算
  cout << "let's calc intr" << endl;
  double rms = cv::calibrateCamera(corners_3d, corners_imgs, imageSize, intr, dist, rvecs, tvecs);
  cout << "intr found" << endl;
  cout << "rms is " << rms << endl;
  intr.convertTo(intr, CV_32F);
  dist.convertTo(dist, CV_32F);
  writeMat(intr, intrMatrixDest);
  writeMat(dist, distCoeffsDest);
  return true;
}

EXTERN EMSCRIPTEN_KEEPALIVE bool calcInnerParamsExt(uint32_t* pointersPointer, const int nPointer, const int imgWidth, const int imgHeight, void* intrMatrixDest, void* distCoeffsDest, void* rvecsDest, void* tvecsDest) {
  if (nPointer <= 0) return false;
  cv::Size imageSize(imgWidth, imgHeight);
  vector<vector<cv::Point3f>> objPts;
  buildChessObjectPoints(objPts, nPointer);
  vector<vector<cv::Point2f>> imgPts;
  for (int i = 0; i < nPointer; i++) {
    cv::Mat pts = readPointsVec2f((void*)pointersPointer[i], CHESS_NUM_X * CHESS_NUM_Y);
    imgPts.push_back(mat2VecPoint2f(pts));
  }
  cv::Mat intr = cv::Mat::eye(3, 3, CV_64F);
  cv::Mat dist = cv::Mat::zeros(8, 1, CV_64F);
  vector<cv::Mat> rvecs, tvecs;
  double rms = cv::calibrateCamera(objPts, imgPts, imageSize, intr, dist, rvecs, tvecs);
  (void)rms;
  intr.convertTo(intr, CV_32F);
  dist.convertTo(dist, CV_32F);
  writeMat(intr, intrMatrixDest);
  writeMat(dist, distCoeffsDest);
  // Flatten rvecs/tvecs to Nx3 float arrays
  cv::Mat rv(nPointer, 3, CV_32F);
  cv::Mat tv(nPointer, 3, CV_32F);
  for (int i = 0; i < nPointer; i++) {
    cv::Mat r, t;
    rvecs[i].convertTo(r, CV_32F);
    tvecs[i].convertTo(t, CV_32F);
    for (int k = 0; k < 3; k++) {
      rv.at<float>(i, k) = r.at<float>(k);
      tv.at<float>(i, k) = t.at<float>(k);
    }
  }
  writeMat(rv, rvecsDest);
  writeMat(tv, tvecsDest);
  return true;
}

EXTERN EMSCRIPTEN_KEEPALIVE bool calcInnerParamsFisheyeExt(uint32_t* pointersPointer, const int nPointer, const int imgWidth, const int imgHeight, void* intrMatrixDest, void* distCoeffsDest, void* rvecsDest, void* tvecsDest) {
  if (nPointer <= 0) return false;
  using namespace cv::fisheye;
  cv::Size imageSize(imgWidth, imgHeight);
  vector<vector<cv::Point3f>> objPts;
  buildChessObjectPoints(objPts, nPointer);
  vector<vector<cv::Point2f>> imgPts;
  for (int i = 0; i < nPointer; i++) {
    cv::Mat pts = readPointsVec2f((void*)pointersPointer[i], CHESS_NUM_X * CHESS_NUM_Y);
    imgPts.push_back(mat2VecPoint2f(pts));
  }
  cv::Mat intr = cv::Mat::eye(3, 3, CV_64F);
  cv::Mat dist = cv::Mat::zeros(4, 1, CV_64F); // k1..k4
  vector<cv::Mat> rvecs, tvecs;
  double rms = calibrate(objPts, imgPts, imageSize, intr, dist, rvecs, tvecs, 0,
                         cv::TermCriteria(cv::TermCriteria::COUNT + cv::TermCriteria::EPS, 20, 1e-6));
  (void)rms;
  intr.convertTo(intr, CV_32F);
  dist.convertTo(dist, CV_32F);
  writeMat(intr, intrMatrixDest);
  writeMat(dist, distCoeffsDest);
  // Flatten rvecs/tvecs to Nx3 float arrays
  cv::Mat rv(nPointer, 3, CV_32F);
  cv::Mat tv(nPointer, 3, CV_32F);
  for (int i = 0; i < nPointer; i++) {
    cv::Mat r, t;
    rvecs[i].convertTo(r, CV_32F);
    tvecs[i].convertTo(t, CV_32F);
    for (int k = 0; k < 3; k++) {
      rv.at<float>(i, k) = r.at<float>(k);
      tv.at<float>(i, k) = t.at<float>(k);
    }
  }
  writeMat(rv, rvecsDest);
  writeMat(tv, tvecsDest);
  return true;
}

EXTERN EMSCRIPTEN_KEEPALIVE void calcUndistMap(void* intrP, void* distP, int imgWidth, const int imgHeight, void* mapXDest, void* mapYDest) {
  cout << "calcUndistMap" << endl;
  cv::Mat mapX, mapY;
  cv::Mat mapR = cv::Mat::eye(3, 3, CV_64F);

  cv::Mat intr = readMat32F(intrP, 3, 3);
  cv::Mat dist = readMat32F(distP, 1, 8);
  cv::Size imageSize(imgWidth, imgHeight);

  cout << "getOptimalNewCameraMatrix" << endl;
  cv::Mat new_intrinsic = cv::getOptimalNewCameraMatrix(intr, dist, imageSize, 0);
  cout << "initUndistortRectifyMap" << endl;
  cv::initUndistortRectifyMap(intr, dist, mapR, new_intrinsic, imageSize, CV_32FC1, mapX, mapY);

  writeMat(mapX, mapXDest);
  writeMat(mapY, mapYDest);
}

EXTERN EMSCRIPTEN_KEEPALIVE void undistort(void * org, int width, int height, void * mapX, void * mapY, void* dest) {
  cv::Mat img = readImg(org, width, height);
  cv::Mat undistorted;
  cv::Mat mapXMat = readMat32F(mapX, width, height);
  cv::Mat mapYMat = readMat32F(mapY, width, height);
  cv::remap(img, undistorted, mapXMat, mapYMat, cv::INTER_LINEAR);
  writeMat(undistorted, dest);
}

cv::Point2f undistortPoint(cv::Point2f p, cv::Mat cameraMat, cv::Mat  distCoeffs) {
  cv::Mat R;
  cv::Mat mp(1,1,CV_32FC2);
  mp.at<cv::Point2f>(0) = p;
  cv::Mat dest(1,1,CV_32FC2);
  cv::undistortPoints(mp, dest, cameraMat, distCoeffs, R, cameraMat);
  return dest.at<cv::Point2f>(0);
}

EXTERN EMSCRIPTEN_KEEPALIVE void undistortPoint(int x, int y, void * cameraMat, void * distCoeffs, void * dest) {
  cv::Point2f p = cv::Point2f((float)x, (float)y);
  cv::Mat intr = readMat32F(cameraMat, 3, 3);
  cv::Mat dist = readMat32F(distCoeffs, 1, 8);

  cv::Point2f up = undistortPoint(p, intr, dist);
  cv::Mat destMat(1,1,CV_32FC2);
  destMat.at<cv::Point2f>(0) = up;
  writeMat(destMat, dest);
}

EXTERN EMSCRIPTEN_KEEPALIVE void calcHomography(void * galvoDots, void * cameraDos, int length, void* dest) {
  vector<cv::Point2f> camera = mat2VecPoint2f(readMat32F(cameraDos, 2, length));
  vector<cv::Point2f> galvo = mat2VecPoint2f(readMat32F(galvoDots, 2, length));
  cv::Mat h = cv::findHomography(camera, galvo, cv::FM_LMEDS);
  h.convertTo(h, CV_32F);
  writeMat(h, dest);
}

EXTERN EMSCRIPTEN_KEEPALIVE void calcHomographyUndist(void * aDots, void * bDots, int length, void* intrA, void* distA, void* intrB, void* distB, void* dest) {
  // Inputs are points in raw image pixel coordinates. Undistort both sets, then compute H from A->B in undistorted pixel space.
  // Read points
  cv::Mat aMat = readPointsVec2f(aDots, length);
  cv::Mat bMat = readPointsVec2f(bDots, length);
  // Undistort
  cv::Mat intrAm = readMat32F(intrA, 3, 3);
  cv::Mat distAm = readMat32F(distA, 1, 8);
  cv::Mat intrBm = readMat32F(intrB, 3, 3);
  cv::Mat distBm = readMat32F(distB, 1, 8);
  cv::Mat aUD, bUD;
  cv::undistortPoints(aMat, aUD, intrAm, distAm, cv::noArray(), intrAm);
  cv::undistortPoints(bMat, bUD, intrBm, distBm, cv::noArray(), intrBm);
  // Compute H from A to B
  std::vector<cv::Point2f> aPts = mat2VecPoint2f(aUD);
  std::vector<cv::Point2f> bPts = mat2VecPoint2f(bUD);
  cv::Mat h = cv::findHomography(aPts, bPts, cv::RANSAC);
  h.convertTo(h, CV_32F);
  writeMat(h, dest);
}

// Variant with quality metrics: outputs H (3x3 float) and writes two floats to metricsDest:
// metricsDest[0] = RMSE (px) over inliers in undist domain, metricsDest[1] = inlier count (as float)
EXTERN EMSCRIPTEN_KEEPALIVE void calcHomographyUndistQuality(
  void * aDots, void * bDots, int length,
  void* intrA, void* distA, void* intrB, void* distB,
  void* hDest, void* metricsDest
) {
  // Read and undistort points
  cv::Mat aMat = readPointsVec2f(aDots, length);
  cv::Mat bMat = readPointsVec2f(bDots, length);
  cv::Mat intrAm = readMat32F(intrA, 3, 3);
  cv::Mat distAm = readMat32F(distA, 1, 8);
  cv::Mat intrBm = readMat32F(intrB, 3, 3);
  cv::Mat distBm = readMat32F(distB, 1, 8);
  cv::Mat aUD, bUD;
  cv::undistortPoints(aMat, aUD, intrAm, distAm, cv::noArray(), intrAm);
  cv::undistortPoints(bMat, bUD, intrBm, distBm, cv::noArray(), intrBm);

  // Compute H with RANSAC and get inlier mask
  std::vector<cv::Point2f> aPts = mat2VecPoint2f(aUD);
  std::vector<cv::Point2f> bPts = mat2VecPoint2f(bUD);
  cv::Mat inlierMask;
  cv::Mat h64 = cv::findHomography(aPts, bPts, cv::RANSAC, 3.0, inlierMask);
  cv::Mat h;
  h64.convertTo(h, CV_32F);
  writeMat(h, hDest);

  // Compute RMSE on inliers in undist domain
  double se = 0.0;
  int inliers = 0;
  for (int i = 0; i < (int)aPts.size(); i++) {
    if (inlierMask.empty() || inlierMask.at<uchar>(i)) {
      // Apply homography H to aPts[i] (copy of applyH without relying on its forward declaration)
      float x = aPts[i].x, y = aPts[i].y;
      float X = h.at<float>(0,0)*x + h.at<float>(0,1)*y + h.at<float>(0,2);
      float Y = h.at<float>(1,0)*x + h.at<float>(1,1)*y + h.at<float>(1,2);
      float Z = h.at<float>(2,0)*x + h.at<float>(2,1)*y + h.at<float>(2,2);
      if (Z == 0.f) Z = 1e-6f;
      cv::Point2f p(X / Z, Y / Z);
      double dx = (double)p.x - (double)bPts[i].x;
      double dy = (double)p.y - (double)bPts[i].y;
      se += dx * dx + dy * dy;
      inliers++;
    }
  }
  float rmse = (inliers > 0) ? (float)std::sqrt(se / (double)inliers) : 1e9f;
  cv::Mat metrics(1, 2, CV_32F);
  metrics.at<float>(0) = rmse;
  metrics.at<float>(1) = (float)inliers;
  writeMat(metrics, metricsDest);
}

EXTERN EMSCRIPTEN_KEEPALIVE void Transform(int x, int y, void * homography, void * cameraMat, void * distCoeffs, void* dest) {
  cv::Point2f p = cv::Point2f((float)x, (float)y);
  cv::Mat h = readMat32F(homography, 3, 3);
  cv::Mat intr = readMat32F(cameraMat, 3, 3);
  cv::Mat dist = readMat32F(distCoeffs, 1, 8);

  cv::Point2f up = undistortPoint(p, intr, dist);
  cv::Mat upm = (cv::Mat_<float>(3, 1) << up.x, up.y, 1.0f);
  cv::Mat result = h * upm;

  cv::Point3f resultPoint(result.at<float>(0), result.at<float>(1), result.at<float>(2));
  cv::Mat destMat(1,1,CV_32FC3);
  destMat.at<cv::Point3f>(0) = resultPoint;

  writeMat(destMat, dest);
}

static inline cv::Point2f applyH(const cv::Mat& H, const cv::Point2f& p) {
  float x = p.x, y = p.y;
  float X = H.at<float>(0,0)*x + H.at<float>(0,1)*y + H.at<float>(0,2);
  float Y = H.at<float>(1,0)*x + H.at<float>(1,1)*y + H.at<float>(1,2);
  float Z = H.at<float>(2,0)*x + H.at<float>(2,1)*y + H.at<float>(2,2);
  if (Z == 0.f) Z = 1e-6f;
  return cv::Point2f(X/Z, Y/Z);
}

EXTERN EMSCRIPTEN_KEEPALIVE void calcInterRemapUndist(void * intrA, void * distA, int widthA, int heightA,
                                                      void * intrB, void * distB, int widthB, int heightB,
                                                      void * homographyAtoB,
                                                      void * mapXDest, void * mapYDest) {
  // Produce map such that for each pixel in A (raw pixel grid), we undistort -> apply H (A_undist -> B_undist) -> coordinates in B_undist pixel grid
  // The output mapX/mapY has size widthA*heightA, sampling positions in B_undist.
  cv::Mat intrAm = readMat32F(intrA, 3, 3);
  cv::Mat distAm = readMat32F(distA, 1, 8);
  cv::Mat intrBm = readMat32F(intrB, 3, 3);
  cv::Mat distBm = readMat32F(distB, 1, 8);
  (void)distBm; // not used (we map to undist domain of B)
  cv::Mat H = readMat32F(homographyAtoB, 3, 3);
  cv::Mat mapX(heightA, widthA, CV_32F);
  cv::Mat mapY(heightA, widthA, CV_32F);

  for (int y = 0; y < heightA; y++) {
    for (int x = 0; x < widthA; x++) {
      // Undistort A pixel
      cv::Point2f pA((float)x, (float)y);
      cv::Point2f uA = undistortPoint(pA, intrAm, distAm);
      // Map to B undist pixel via H
      cv::Point2f uB = applyH(H, uA);
      mapX.at<float>(y, x) = uB.x;
      mapY.at<float>(y, x) = uB.y;
    }
  }
  writeMat(mapX, mapXDest);
  writeMat(mapY, mapYDest);
}
