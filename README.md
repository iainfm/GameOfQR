# GameOfQR

GameOfQR is a web-based project that brings Conway's Game of Life to life using QR codes as the initial state. Instead of manually drawing patterns or using pre-made seeds, this app allows users to either upload a QR code image or scan one directly using their device's camera. The black and white grid encoded in the QR code serves as the starting configuration for the Game of Life simulation.

## Features

- **Upload QR Code**: Select an image file containing a valid QR code to generate the initial grid for the Game of Life.
- **Live QR Camera Scan**: Use your device's camera (on supported browsers and secure connections) to scan a QR code and immediately start the simulation based on the decoded grid.
- **Interactive Simulation**: Visualizes Conway's Game of Life, animating cell generations derived from your QR code's pattern.
- **Responsive and Mobile-Friendly**: Designed to work on desktop and most modern mobile browsers, including Android and iOS devices.

## How It Works

1. **Load or Scan a QR Code**
    - You can upload a QR code image or, if on a supported mobile browser, scan a QR code using your camera.
    - The app decodes the QR code to obtain a black-and-white grid pattern.

2. **Seed the Game of Life Grid**
    - The resulting pattern from the QR code populates the starting state of Conway's Game of Life.

3. **Watch the Evolution**
    - The simulation plays out according to the classic Game of Life rules, driven by the unique arrangement from your code.

## Technical Notes

- The app is built with modern JavaScript, using browser APIs for file reading, camera access (`getUserMedia`), and QR code decoding.
- **Camera Access Requirements**:
    - Camera functionality requires a secure context; use **HTTPS**.
    - Not all browsers or in-app webviews on Android support `getUserMedia`. For best results, use Chrome or Firefox.
    - The app checks for feature support and shows helpful messages if the camera isn't available or supported.

## Troubleshooting

- **Camera unavailable error**: On Android, you may see "Camera unavailable: Cannot read properties of undefined (reading getUserMedia)" if:
    - You are using HTTP (not HTTPS).
    - Your browser does not support the camera API (use the latest Chrome/Firefox).
    - You are in an in-app or embedded webview without proper permissions.
- **QR Decoding issues**: Make sure the QR code image is clear and undistorted.

## Project Motivation

This project is a playful exploration of encoding and visual computation. By seeding Conway's Game of Life with patterns derived from QR codes, it transforms digital information into unexpected evolving art.

## License

MIT
