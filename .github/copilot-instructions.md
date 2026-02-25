# GalvoWeb 2.0 - Web Application Documentation

## Overview

GalvoWeb 2.0 is a browser-based single-page application (SPA) for operating galvo scanners via GUI with real-time camera feedback.
This serverless solution enables researchers and students to control galvo scanners through an intuitive web interface, utilizing computer vision for precise calibration and control.

## Project Objective

- **Primary Goal**: Provide an accessible, browser-based interface for galvo scanner operation
- **Target Users**: Researchers and students working with galvo scanner systems
- **Key Benefits**: 
  - No server infrastructure required (runs entirely in browser)
  - Real-time visual feedback through camera integration
  - Precise calibration using computer vision algorithms
  - Direct hardware communication via Web Serial API

## Architecture

### Technology Stack
- **Frontend Framework**: React with TypeScript
- **Computer Vision**: OpenCV.js (WebAssembly compiled)
- **Hardware Communication**: Web Serial API → Teensy 4.0 → Galvo Scanner
- **Build System**: Webpack with custom configuration for WebAssembly
- **Package Manager**: pnpm

### System Architecture
```
Browser (React SPA)
    ↓ Web Serial API
Teensy 4.0 (Arduino)
    ↓ XY Protocol
Galvo Scanner Hardware
    ↑ Camera Feedback
OpenCV.js (Calibration & Vision)
```

## Key Components

### Core Modules

1. **Camera System** ([`src/component/Nodes.tsx`](../src/node/Nodes.tsx))
   - [`CameraVideoNode`](../src/node/Nodes.tsx): Live camera feed
   - [`CalibratedCameraNode`](../src/node/Nodes.tsx): Camera with distortion correction

2. **Galvo Control** ([`src/component/Nodes.tsx`](../src/node/Nodes.tsx))
   - [`GalvoHomographyNode`](../src/node/Nodes.tsx): Calibration interface
   - [`GalvoOperationsNode`](../src/node/Nodes.tsx): Direct galvo control
   - [`GalvoSequencerNode`](../src/node/Nodes.tsx): Sequence programming

3. **Hardware Interface** ([`src/component/Nodes.tsx`](../src/node/Nodes.tsx))
   - [`SerialDeviceNode`](../src/node/Nodes.tsx): Teensy communication

### Calibration System

The heart of the system is the homography calculation ([`src/util/calcHomography.ts`](../src/util/calcHomography.ts)):

- **Camera-Galvo Correspondence**: Maps camera coordinates to galvo coordinates
- **Laser Point Detection**: Real-time detection of laser points in camera feed
- **Automatic Calibration**: Grid-based calibration process using [`calcHomography`](../src-wasm/index.cpp)

### WebAssembly Integration

Computer vision operations are handled by [`src-wasm/index.cpp`](../src-wasm/index.cpp):
- [`calcHomography`](../src-wasm/index.cpp): Homography matrix calculation
- [`undistortPoint`](../src-wasm/index.cpp): Camera distortion correction
- [`Transform`](../src-wasm/index.cpp): Coordinate transformation

## Development Setup

### Prerequisites
- Node.js with pnpm
- Emscripten SDK (emsdk) for WebAssembly compilation
- Modern browser with Web Serial API support

### Initial Setup
```bash
# Clone and initialize submodules
git clone <repository-url>
cd GalvoWeb2.0
git submodule update --init

# Build OpenCV.js
python opencv/platforms/js/build_js.py opencv-build --build_wasm --emscripten_dir ~/emsdk/upstream/emscripten

# Build WebAssembly module
cd src-wasm
emcmake cmake
cd ..

# Install dependencies
pnpm install
```

### Development Commands
```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Run linting
pnpm lint
```

## Current Implementation Status

### ✅ Completed Features
- Basic galvo scanner control via Web Serial API
- Camera integration with live feed
- Homography-based calibration system
- Real-time coordinate transformation
- Node-based UI architecture
- WebAssembly-based computer vision

## API Reference

### SerialCommunicator ([`app/shared/module/serialInterface.ts`](../app/shared/module/serialInterface.ts))
Main interface for hardware communication:
```typescript
// Set galvo position
teency.setGalvoPos({ x: number, y: number })
```

### Homography Calculation ([`src/util/calcHomography.ts`](../src/util/calcHomography.ts))
Core calibration functions:
```typescript
// Calculate homography matrix
calcHomographyMatrix(module, orgCtx, teency, nDots, colorThreshold, duration)

// Detect laser points
detectLaserPoint(ctx, colorThreshold, fps, timeout)
```

## File Structure

```
src/
├── component/          # React components
│   ├── Nodes.tsx      # Main node definitions
│   └── ...            # Individual component files
├── util/              # Utility functions
│   ├── calcHomography.ts  # Calibration logic
│   └── ...
├── module/            # Core modules
│   └── teencyInterface.ts # Hardware communication
├── wasm/             # WebAssembly utilities
└── store/            # State management
```

## Hardware Communication Protocol

The system communicates with Teensy 4.0 using a simple text protocol ([`teensy/src/main.cpp`](../teensy/src/main.cpp)):

- **Mode A**: Laser control (`A<intensity>`)
- **Mode B**: Galvo positioning (`B<x>,<y>`)

## Contributing

When developing new features:

1. Follow the existing node-based architecture
2. Use TypeScript for type safety
3. Leverage OpenCV.js for computer vision tasks
4. Test with actual hardware when possible
5. Update documentation for new features

## Browser Compatibility

- **Required**: Web Serial API support
- **Recommended**: Chrome/Edge 89+, Opera 75+
- **Note**: Firefox requires experimental flag enablement
