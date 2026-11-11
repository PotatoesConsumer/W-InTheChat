/**
 * camera.js
 *
 * The browser side of the optional camera extension (W11). Off until the player opts in.
 * MediaPipe Face Landmarker reads the webcam in this tab and returns face blendshape
 * scores, which expression.js turns into one word. The video is never drawn, saved or
 * sent anywhere; only the scores leave this file.
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
 * @returns {Promise<{stop: () => void}>} rejects if the camera is refused or missing
 */
export async function startCamera(onScores) {
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

    return {
      stop() {
        clearInterval(timer);
        landmarker.close();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  } catch (err) {
    // Don't leave the camera light on if MediaPipe failed to load.
    landmarker?.close();
    for (const track of stream.getTracks()) track.stop();
    throw err;
  }
}
