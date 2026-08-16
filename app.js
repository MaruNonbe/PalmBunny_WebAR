/**
 * Palm VRM Dance WebAR
 *
 * 動作実績のある「手のひら龍」アプリの構成に合わせて実装しています。
 * (Orthographicカメラ + 時間ベースの手検出間引き + カメラ自動フォールバック)
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import { HandDragonController } from "./HandDragonController.js";

/**
 * 調整用定数
 */
let MODEL_SCALE = 1.0;
let MODEL_ROTATION_Y = 0.0;
let MODEL_OFFSET_Y = 0.0;

const PALM_SIZE_TO_MODEL_SCALE = 3.4;

// 手検出の間隔(ms)。重い場合は 80〜120 に上げる
const HAND_DETECTION_INTERVAL_MS = 60;

// カメラ解像度
const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 480;

const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MODEL_URL = "./palm-dance.glb";

/**
 * DOM
 */
const video = document.getElementById("cameraVideo");
const threeCanvas = document.getElementById("threeCanvas");
const debugCanvas = document.getElementById("debugCanvas");

const startPanel = document.getElementById("startPanel");
const startButton = document.getElementById("startButton");

const statusBar = document.getElementById("statusBar");
const errorBox = document.getElementById("errorBox");

const debugToggleButton = document.getElementById("debugToggleButton");
const landmarkToggleButton = document.getElementById("landmarkToggleButton");
const tuneToggleButton = document.getElementById("tuneToggleButton");
const tunePanel = document.getElementById("tunePanel");

const scaleRange = document.getElementById("scaleRange");
const offsetYRange = document.getElementById("offsetYRange");
const rotationYRange = document.getElementById("rotationYRange");

const scaleValue = document.getElementById("scaleValue");
const offsetYValue = document.getElementById("offsetYValue");
const rotationYValue = document.getElementById("rotationYValue");

/**
 * Three.js
 */
let scene, camera, renderer;
let modelRoot, modelScene, mixer;

/**
 * MediaPipe
 */
let handLandmarker;
let handController;

/**
 * 状態
 */
let started = false;
let debugEnabled = false;
let landmarksEnabled = true;

let lastDetectionTime = 0;
let lastVideoTime = -1;

const targetPosition = new THREE.Vector3();
const smoothedPosition = new THREE.Vector3();
let targetScale = 1;
let smoothedScale = 1;
let modelOpacitySet = false;

startButton.addEventListener("click", async () => {
  if (started) return;
  started = true;
  hideError();
  setStatus("カメラ準備中");

  try {
    initThree();
    initHandController();
    setupUI();
    handleResize();

    await initCamera();
    await initMediaPipe();
    await loadModel();

    startPanel.classList.add("hidden");
    setStatus("手のひらをカメラに向けてください");

    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    showError("起動に失敗しました。\n\n" + (error && error.message ? error.message : String(error)));
    setStatus("エラーが発生しました");
    started = false;
  }
});

async function initCamera() {
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.autoplay = true;

  const environmentConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: CAMERA_WIDTH },
      height: { ideal: CAMERA_HEIGHT },
    },
  };
  const userConstraints = {
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(environmentConstraints);
  } catch (error) {
    console.warn("背面カメラ起動に失敗。前面カメラへフォールバックします。", error);
    stream = await navigator.mediaDevices.getUserMedia(userConstraints);
  }

  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });

  setStatus("手のひらをカメラに向けてください");
}

async function initMediaPipe() {
  setStatus("手検出モデルを読み込み中…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

function initThree() {
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    alpha: true,
    antialias: true,
  });
  renderer.setClearColor(0x000000, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(3, 4, 5);
  scene.add(keyLight);

  modelRoot = new THREE.Group();
  modelRoot.visible = false;
  scene.add(modelRoot);
}

function initHandController() {
  handController = new HandDragonController({ video, debugCanvas });
}

function loadModel() {
  return new Promise((resolve, reject) => {
    setStatus("ダンスモデルを読み込み中…");
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        modelScene = gltf.scene;
        modelScene.name = "DanceModel";

               modelScene.traverse((child) => {
          if (child.isMesh) {
            child.frustumCulled = false;
          }
        });

    

        const box = new THREE.Box3().setFromObject(modelScene);
        modelScene.position.y -= box.min.y;

        modelRoot.add(modelScene);

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(modelScene);
          const action = mixer.clipAction(gltf.animations[0]);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }

        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });
}

function setupUI() {
  debugToggleButton.addEventListener("click", () => {
    debugEnabled = !debugEnabled;
    debugToggleButton.textContent = debugEnabled ? "デバッグ ON" : "デバッグ OFF";
    handController.setDebugEnabled(debugEnabled);
  });

  landmarkToggleButton.addEventListener("click", () => {
    landmarksEnabled = !landmarksEnabled;
    landmarkToggleButton.textContent = landmarksEnabled ? "ランドマーク ON" : "ランドマーク OFF";
    handController.setLandmarksEnabled(landmarksEnabled);
  });

  tuneToggleButton.addEventListener("click", () => {
    tunePanel.classList.toggle("hidden");
  });

  scaleRange.addEventListener("input", () => {
    MODEL_SCALE = Number(scaleRange.value);
    scaleValue.textContent = MODEL_SCALE.toFixed(1);
  });

  offsetYRange.addEventListener("input", () => {
    MODEL_OFFSET_Y = Number(offsetYRange.value);
    offsetYValue.textContent = MODEL_OFFSET_Y.toFixed(2);
  });

  rotationYRange.addEventListener("input", () => {
    MODEL_ROTATION_Y = Number(rotationYRange.value);
    rotationYValue.textContent = MODEL_ROTATION_Y.toFixed(2);
  });

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", () => {
    setTimeout(handleResize, 300);
  });
}

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (renderer) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  }
  if (camera) {
    const aspect = width / height;
    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
  }
  if (handController) {
    handController.resizeDebugCanvas(width, height, dpr);
  }
}

function animate(now) {
  requestAnimationFrame(animate);

  const delta = 0.016;

  detectHandsIfNeeded(now);

  if (mixer) mixer.update(delta);

  smoothedPosition.lerp(targetPosition, 0.25);
  smoothedScale = THREE.MathUtils.lerp(smoothedScale, targetScale, 0.25);

  modelRoot.position.copy(smoothedPosition);
  modelRoot.scale.setScalar(smoothedScale);
  if (modelScene) modelScene.rotation.y = MODEL_ROTATION_Y;

  renderer.render(scene, camera);
}

function detectHandsIfNeeded(now) {
  if (!handLandmarker || !video.videoWidth) return;
  if (now - lastDetectionTime < HAND_DETECTION_INTERVAL_MS) return;
  if (video.currentTime === lastVideoTime) return;

  lastDetectionTime = now;
  lastVideoTime = video.currentTime;

  let results;
  try {
    results = handLandmarker.detectForVideo(video, now);
  } catch (error) {
    console.warn("手検出エラー", error);
    return;
  }

  const handInfo = handController.extractHandInfo(results);

  if (!handInfo) {
    modelRoot.visible = false;
    setStatus("手のひらをカメラに向けてください");
    return;
  }

  const world = screenToWorld(handInfo.screenCenter.x, handInfo.screenCenter.y);

  targetPosition.set(world.x, world.y + MODEL_OFFSET_Y, 0);
  targetScale = THREE.MathUtils.clamp(
    MODEL_SCALE * PALM_SIZE_TO_MODEL_SCALE * handInfo.palmSize,
    0.1,
    6
  );

  modelRoot.visible = true;
  setStatus(`手のひらを検出中 (${handInfo.handedness === "Left" ? "左手" : "右手"})`);
}

function screenToWorld(screenX, screenY) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  const x = (screenX / width) * 2 * aspect - aspect;
  const y = -(screenY / height) * 2 + 1;

  return { x, y };
}

function setStatus(message) {
  statusBar.textContent = message;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}
