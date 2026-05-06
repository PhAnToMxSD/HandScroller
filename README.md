# Hand Preview Scroll

A lightweight local web app that uses the laptop camera and hand landmarks to scroll a PDF without touching the keyboard or trackpad.

## Run it

1. Open a terminal in this folder.
2. Start the local server:

## Gesture control

Keep your hand in view of the camera.

- Hand above the center band: scroll up.
- Hand below the center band: scroll down.
- Hand near the center: pause.

## Notes

- The app renders PDFs in the browser with PDF.js.
- Hand tracking uses MediaPipe Hands in the browser.
- If the camera does not start, check browser permission settings and make sure another app is not using the webcam.
- On macOS, also confirm the browser is allowed under System Settings > Privacy & Security > Camera.
