/**
 * camera.js
 *
 * The browser side of the optional camera extension (W11). Off until the player opts in.
 * MediaPipe Face Landmarker reads the webcam in this tab and returns face blendshape
 * scores, which expression.js turns into one word. The video is shown in the facecam on
 * this screen only (drawCamera), never saved or sent anywhere; only the scores and
 * the word leave the tab.
 *
 * MediaPipe loads from a CDN on first use (about 6 MB), pinned to one version. Nothing
 * downloads unless the camera is turned on. It runs on the CPU so it doesn't compete
 * with the chat model for the GPU.
 */

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const EVERY_MS = 100; // 10 checks a second is plenty for expressions

/**
 * Asks for the camera and starts reading expressions.
 * @param {(scores: Record<string, number> | null) => void} onScores - About 10× a second;
 *   null when no face is found.
 * @param {() => void} [onEnded] - The camera went away (unplugged, or Iriun dropped).
 * @returns {Promise<{video: HTMLVideoElement, stop: () => void}>} rejects if the camera
 *   is refused or missing
 */
export async function startCamera(onScores, onEnded = () => {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240 },
    audio: false,
  });
  let landmarker;
  try {
    const video = document.createElement("video"); // never added to the page
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    const { FilesetResolver, FaceLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });

    const timer = setInterval(() => {
      if (video.readyState < 2) return;
      const result = landmarker.detectForVideo(video, performance.now());
      const categories = result.faceBlendshapes?.[0]?.categories;
      onScores(
        categories ? Object.fromEntries(categories.map((c) => [c.categoryName, c.score])) : null,
      );
    }, EVERY_MS);

    let stopped = false;
    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      landmarker.close();
      for (const track of stream.getTracks()) track.stop();
    }
    // stop() doesn't fire "ended"; this is the device going away by itself.
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        stop();
        onEnded();
      });
    }
    return { video, stop };
  } catch (err) {
    // Don't leave the camera light on if MediaPipe failed to load.
    landmarker?.close();
    for (const track of stream.getTracks()) track.stop();
    throw err;
  }
}

/**
 * Draws the live camera into the facecam frame, mirrored like a selfie view.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video
 * @param {{x: number, y: number, width: number, height: number}} frame
 * @param {string} expression - Shown in the corner label.
 */
export function drawCamera(ctx, video, { x, y, width, height }, expression) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.clip();
  ctx.fillStyle = "#1d1a28";
  ctx.fillRect(x, y, width, height);
  if (video.readyState >= 2) {
    // Cover the frame, cropping the longer side, and mirror it.
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    ctx.translate(x + width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(x + 6, y + 6, 104, 18, 4);
  ctx.fill();
  ctx.fillStyle = "#ff4d5e";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.fillText("●", x + 12, y + 19);
  ctx.fillStyle = "#e8e6ee";
  ctx.fillText(`LIVE · ${expression}`, x + 24, y + 19);
  ctx.restore();
}
