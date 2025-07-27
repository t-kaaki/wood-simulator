import { state } from './stateManager.js';
import { updateSelectedPartInfo, checkCollision, enforceFloorConstraint, updateDynamicMeasurement, clearDynamicMeasurement, updateLabels } from './objectManager.js';
import { saveHistoryState } from './stateManager.js';

let scene, camera, renderer, controls, transformControls;
// ★追加: 裏側判定用のベクトル（毎フレームの生成を避けるため）
const backsideCheckCameraDir = new THREE.Vector3();
const backsideCheckWorldForward = new THREE.Vector3(0, 0, 1);


export function initScene() {
    const container = document.getElementById('canvas-container');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f4f8);

    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 5000);
    camera.position.set(0, 300, 800);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    renderer.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        alert('3D描画コンテキストが失われました。アプリケーションが不安定になっている可能性があります。\nページを再読み込みしてください。');
    }, false);


    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    transformControls = new THREE.TransformControls(camera, renderer.domElement);
    
    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 500, 300);
    scene.add(directionalLight);

    // Helpers
    scene.add(new THREE.GridHelper(1000, 20));
    scene.add(new THREE.AxesHelper(500));

    scene.add(transformControls);

    setupTransformControls();

    window.addEventListener('resize', onWindowResize);
}

function setupTransformControls() {
    transformControls.addEventListener('dragging-changed', e => {
        controls.enabled = !e.value;
        const object = transformControls.object;
        if (!object) return;

        if (e.value) { // ドラッグ開始
            state.lastValidTransform.position.copy(object.position);
            state.lastValidTransform.quaternion.copy(object.quaternion);
        } else { // ドラッグ終了
            if (state.isColliding) {
                object.position.copy(state.lastValidTransform.position);
                object.quaternion.copy(state.lastValidTransform.quaternion);
            }
            saveHistoryState();
        }
        Object.values(state.allMeshes).forEach(mesh => {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.emissive.setHex(mesh === state.selectedObject ? 0x555555 : 0x000000));
            }
        });
        clearDynamicMeasurement();
    });

    transformControls.addEventListener('objectChange', () => {
        const object = transformControls.object;
        if (!object) return;
        
        enforceFloorConstraint(object);
        
        state.isColliding = checkCollision(object);
        
        Object.values(state.allMeshes).forEach(mesh => {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.emissive.setHex(mesh === state.selectedObject ? 0x555555 : 0x000000));
            }
        });

        if(state.isColliding) {
            const objectBox = new THREE.Box3().setFromObject(object);
            for (const meshId in state.allMeshes) {
                const mesh = state.allMeshes[meshId];
                if (mesh === object || !mesh.visible) continue;
                const otherBox = new THREE.Box3().setFromObject(mesh);
                if (objectBox.intersectsBox(otherBox)) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.emissive.setHex(0xff0000));
                }
            }
            if (Array.isArray(object.material)) object.material.forEach(m => m.emissive.setHex(0xff0000));
        } else {
            state.lastValidTransform.position.copy(object.position);
            state.lastValidTransform.quaternion.copy(object.quaternion);
        }
        updateSelectedPartInfo();
        updateDynamicMeasurement();
    });
}

export function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
}

export function startAnimation() {
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateLabels();

    // ★修正: 裏側判定ロジックを追加
    const indicator = document.getElementById('backside-indicator');
    if (indicator) {
        camera.getWorldDirection(backsideCheckCameraDir);
        // カメラの向きと世界のZ軸の向きの内積を計算
        const dot = backsideCheckCameraDir.dot(backsideCheckWorldForward);
        // 内積が正なら、カメラはZ軸の正方向（裏側）を向いている
        if (dot > 0) {
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    if (renderer.getContext().isContextLost()) return;
    renderer.render(scene, camera);
}

// 他のモジュールから利用できるようにエクスポート
export { scene, camera, renderer, controls, transformControls };