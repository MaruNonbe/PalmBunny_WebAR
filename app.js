/**
 * Palm VRM Dance WebAR
 *
 * 動的import + try/catchで全体を包み、
 * どこで失敗しても必ずアラートで検知できるようにしてあります。
 */

(async () => {
  try {
ーー

    const MODEL_URL = "./palm-dance.glb";

    const videoEl = document.getElementById("cameraVideo");
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
    const scaleValue = document.getElementById("scaleValue");
    const offsetYRange = document.getElementById("offsetYRange");
    const offsetYValue = document.getElementById("offsetYValue");
    const rotationYRange = document.getElementById("rotationYRange");
    const rotationYValue = document.getElementById("rotationYValue");

    function setStatus(text) {
      statusBar.textContent = text;
    }

    function showError(message) {
      errorBox.textContent = message;
      errorBox.classList.remove("hidden");
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: threeCanvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 20);
    camera.position.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.3));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(0.5, 1, 0.8);
    scene.add(dirLight);

    const modelAnchor = new THREE.Group();
    modelAnchor.visible = false;
    scene.add(modelAnchor);

    let mixer = null;
    let modelHeight = 1.0;

    function resizeRenderer() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", () => {
      resizeRenderer();
      handController.resizeDebugCanvas(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    });
    resizeRenderer();

    function loadModel() {
      return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        setStatus("ダンスモデルを読み込み中…");
        loader.load(
          MODEL_URL,
          (gltf) => {
            const root = gltf.scene;
            modelAnchor.add(root);

            const box = new THREE.Box3().setFromObject(root);
            modelHeight = Math.max(box.max.y - box.min.y, 0.5);
            root.position.y -= box.min.y;

            if (gltf.animations && gltf.animations.length > 0) {
              mixer = new THREE.AnimationMixer(root);
              const action = mixer.clipAction(gltf.animations[0]);
              action.setLoop(THREE.LoopRepeat, Infinity);
              action.play();
            }

            setStatus("手のひらを画面に映してください");
            resolve();
          },
          (progress) => {
            if (progress.total) {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              setStatus(`ダンスモデルを読み込み中… ${pct}%`);
            }
          },
          (err) => reject(err)
        );
      });
    }

    const handController = new HandDragonController({
      video: videoEl,
      debugCanvas,
    });

    let handLandmarker = null;

    async function setupHandLandmarker() {
      setStatus("手検出モデルを読み込み中…");
      const { HandLandmarker, FilesetResolver } = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
      );
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }

    async function setupCamera() {
      setStatus("カメラにアクセス中…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 960, height: 1280 },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
    }

    const PLACEMENT_DISTANCE = 0.6;
    const ndcVector = new THREE.Vector3();

    function screenPointToWorld(x, y, distance) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ndcVector.set((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5);
      ndcVector.unproject(camera);
      const dir = ndcVector.sub(camera.position).normalize();
      return camera.position.clone().add(dir.multiplyScalar(distance));
    }

    let tuneScale = parseFloat(scaleRange.value);
    let tuneOffsetY = parseFloat(offsetYRange.value);
    let tuneRotationY = parseFloat(rotationYRange.value);

    scaleRange.addEventListener("input", () => {
      tuneScale = parseFloat(scaleRange.value);
      scaleValue.textContent = tuneScale.toFixed(1);
    });
    offsetYRange.addEventListener("input", () => {
      tuneOffsetY = parseFloat(offsetYRange.value);
      offsetYValue.textContent = tuneOffsetY.toFixed(2);
    });
    rotationYRange.addEventListener("input", () => {
      tuneRotationY = parseFloat(rotationYRange.value);
      rotationYValue.textContent = tuneRotationY.toFixed(2);
    });

    tuneToggleButton.addEventListener("click", () => {
      tunePanel.classList.toggle("hidden");
    });

    let debugOn = false;
    debugToggleButton.addEventListener("click", () => {
      debugOn = !debugOn;
      handController.setDebugEnabled(debugOn);
      debugToggleButton.textContent = debugOn ? "デバッグ ON" : "デバッグ OFF";
    });

    let landmarksOn = true;
    landmarkToggleButton.addEventListener("click", () => {
      landmarksOn = !landmarksOn;
      handController.setLandmarksEnabled(landmarksOn);
      landmarkToggleButton.textContent = landmarksOn ? "ランドマーク ON" : "ランドマーク OFF";
    });

    const clock = new THREE.Clock();
    let lastHandSeenAt = 0;

    function animate() {
      requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (mixer) mixer.update(delta);

      if (handLandmarker && videoEl.readyState >= 2) {
        const results = handLandmarker.detectForVideo(videoEl, performance.now());
        const handInfo = handController.extractHandInfo(results);

        if (handInfo) {
          lastHandSeenAt = performance.now();
          modelAnchor.visible = true;

          const worldPos = screenPointToWorld(
            handInfo.screenCenter.x,
            handInfo.screenCenter.y,
            PLACEMENT_DISTANCE
          );
          modelAnchor.position.copy(worldPos);

          const baseScale = (handInfo.palmSize / modelHeight) * 3.4;
          const finalScale = baseScale * tuneScale;
          modelAnchor.scale.setScalar(finalScale);

          modelAnchor.rotation.y = tuneRotationY;
          modelAnchor.position.y += tuneOffsetY * finalScale;

          setStatus(`手のひらを検出中 (${handInfo.handedness === "Left" ? "左手" : "右手"})`);
        } else if (performance.now() - lastHandSeenAt > 400) {
          modelAnchor.visible = false;
          setStatus("手のひらを画面に映してください");
        }
      }

      renderer.render(scene, camera);
    }

    alert("E: 初期化完了。ボタンにイベントを登録します");

    startButton.addEventListener("click", async () => {
      alert("1: ボタン押下を検知");
      startButton.disabled = true;
      try {
        alert("2: カメラ起動を試みます");
        await setupCamera();
        alert("3: カメラ起動 完了");
        resizeRenderer();
        handController.resizeDebugCanvas(window.innerWidth, window.innerHeight, window.devicePixelRatio);

        alert("4: 手検出モデル/ダンスモデルの読み込みを試みます");
        await Promise.all([setupHandLandmarker(), loadModel()]);
        alert("5: 読み込み完了");

        startPanel.classList.add("hidden");
        animate();
      } catch (err) {
        alert("エラー発生(ボタン後): " + (err && err.message ? err.message : String(err)));
        console.error(err);
        showError(`起動に失敗しました: ${err.message || err}`);
        startButton.disabled = false;
      }
    });
  } catch (err) {
    alert("初期化エラー: " + (err && err.message ? err.message : String(err)));
    console.error(err);
  }
})();
