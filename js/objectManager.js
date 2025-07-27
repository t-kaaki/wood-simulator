import { state, saveHistoryState } from './stateManager.js';
import { scene, transformControls, renderer, camera } from './sceneManager.js';
import { getInitialLabel } from './utils.js';
import { updateSelectedPartInfo as updateUIPanel } from './uiManager.js';

const COLLISION_TOLERANCE = 0.01;

// --- Public Functions ---

export function removeMeshById(meshId) {
    const mesh = state.allMeshes[meshId];
    if (!mesh) return;

    scene.remove(mesh);

    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
        });
    } else {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
    }
    if (mesh.geometry) mesh.geometry.dispose();

    if (transformControls.object === mesh) {
        transformControls.detach();
        deselectObject();
    }

    delete state.allMeshes[meshId];
}

/**
 * ★修正: 新しい板材をシーンに追加する関数
 * 名前の重複を自動で回避し、次の名前候補を入力欄に設定する機能を追加
 */
export function addNewWoodPart() {
    const nameInputEl = document.getElementById('new-wood-name');
    const nameInput = nameInputEl.value.trim();
    const width = parseFloat(document.getElementById('new-wood-width').value);
    const height = parseFloat(document.getElementById('new-wood-height').value);
    const depth = parseFloat(document.getElementById('new-wood-depth').value);

    if (isNaN(width) || isNaN(height) || isNaN(depth) || width <= 0 || height <= 0 || depth <= 0) {
        alert('有効な寸法（正の数値）を入力してください。');
        return;
    }

    saveHistoryState();

    // --- 自動命名ロジック ---
    const existingNames = Object.values(state.woodLayouts).map(node => node.woodName);
    let finalName = nameInput;
    while (existingNames.includes(finalName)) {
        finalName = getNextName(finalName);
    }
    // --- ここまで ---

    const partId = `part_${Date.now()}_${Object.keys(state.allMeshes).length}`;

    const newWoodData = {
        id: partId,
        woodName: finalName, // 確定したユニークな名前を使用
        displayName: '',
        originalDimensions: { width, height, depth },
        meshId: partId,
        isActive: true,
        isWaste: false,
        bounds: { x: 0, y: 0, width, depth },
        dimensions: { width, height, depth },
        children: []
    };
    
    let maxZ = 0;
    Object.values(state.allMeshes).forEach(mesh => {
        if (mesh && mesh.visible) {
            const box = new THREE.Box3().setFromObject(mesh);
            maxZ = Math.max(maxZ, box.max.z);
        }
    });
    const initialPositionZ = maxZ + newWoodData.originalDimensions.depth / 2 + 50;

    const mesh = createMeshForNode(newWoodData);
    mesh.position.set(0, height / 2, initialPositionZ);
    
    state.allMeshes[partId] = mesh;
    state.woodLayouts[partId] = newWoodData;

    // ★追加: 次の推奨名を入力欄に設定
    nameInputEl.value = getNextName(finalName);

    deselectObject();
    saveHistoryState();
}


export function deleteSelectedWoodPart() {
    if (!state.selectedObject) {
        alert('削除する部品を選択してください。');
        return;
    }

    const { rootNode } = findNodeAndParent(state.selectedObject.userData.partId);
    if (!rootNode) {
        console.error("選択された部品のルートノードが見つかりません。", state.selectedObject);
        return;
    }

    const confirmation = confirm(`「${rootNode.woodName}」とその派生部品をすべて削除しますか？\nこの操作は元に戻せません。`);
    if (!confirmation) return;

    saveHistoryState();
    removeMeshesFromSceneAndAllMeshes(rootNode);
    delete state.woodLayouts[rootNode.id];
    deselectObject();
    saveHistoryState();
}

export function selectObject(object) {
    if (state.selectedObject === object) return;
    deselectObject();
    state.selectedObject = object;
    if (state.selectedObject) {
        if (Array.isArray(state.selectedObject.material)) {
            state.selectedObject.material.forEach(m => m.emissive.setHex(0x555555));
        }
        transformControls.attach(state.selectedObject);
        document.getElementById('transform-ui').classList.remove('hidden');
        updateSelectedPartInfo();
    }
}

export function deselectObject() {
    if (state.selectedObject) {
        if (Array.isArray(state.selectedObject.material)) {
            state.selectedObject.material.forEach(m => m.emissive.setHex(0x000000));
        }
    }
    state.selectedObject = null;
    transformControls.detach();
    document.getElementById('transform-ui').classList.add('hidden');
    document.getElementById('selected-part-info').innerHTML = '選択されていません';
}

export function updateSelectedPartInfo() {
    if (!state.selectedObject) return;
    const { node } = findNodeAndParent(state.selectedObject.userData.partId);
    if (!node) return;
    updateUIPanel(node, state.selectedObject);
}

export function updateMeshTexture(mesh, newName) {
    if (!mesh || !Array.isArray(mesh.material)) return;
    
    const initialLabel = getInitialLabel(newName);

    if (mesh.material[2] && mesh.material[2].map) mesh.material[2].map.dispose();
    if (mesh.material[3] && mesh.material[3].map) mesh.material[3].map.dispose();

    const textureLabel = createWoodTexture(initialLabel, false);
    const textureLabelFlipped = createWoodTexture(initialLabel, true);

    mesh.material[2].map = textureLabel;
    mesh.material[3].map = textureLabelFlipped;
    
    mesh.material[2].needsUpdate = true;
    mesh.material[3].needsUpdate = true;
}

export function clearAllMeshes() {
    deselectObject();
    Object.values(state.allMeshes).forEach(mesh => {
        if (mesh) {
            scene.remove(mesh);
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
            } else {
                if (mesh.material.map) mesh.material.map.dispose();
                mesh.material.dispose();
            }
            if (mesh.geometry) mesh.geometry.dispose();
        }
    });
    state.allMeshes = {};
}

export function recreateMeshesFromState(savedState) {
    function recreate(node) {
        if (savedState.positions[node.id] && savedState.quaternions[node.id]) {
            const mesh = createMeshForNode(node);
            const pos = savedState.positions[node.id], quat = savedState.quaternions[node.id];
            if (pos && quat) {
                mesh.position.set(pos.x, pos.y, pos.z);
                mesh.quaternion.set(quat._x, quat._y, quat._z, quat._w);
            }
            mesh.visible = node.isActive;
        }
        node.children.forEach(child => recreate(child));
    }
    for (const rootId in state.woodLayouts) {
        recreate(state.woodLayouts[rootId]);
    }
}

export function findNodeAndParent(partId, startNode = null) {
    if (!startNode) {
        for (const rootId in state.woodLayouts) {
            const result = findNodeAndParent(partId, state.woodLayouts[rootId]);
            if (result.node) {
                result.rootNode = state.woodLayouts[rootId];
                return result;
            }
        }
        return { node: null, parentNode: null, rootNode: null };
    }
    if (startNode.id === partId) return { node: startNode, parentNode: null };
    for (const child of startNode.children) {
        if (child.id === partId) return { node: child, parentNode: startNode };
        const found = findNodeAndParent(partId, child);
        if (found.node) return found;
    }
    return { node: null, parentNode: null };
}

export function enforceFloorConstraint(object) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const minY = box.min.y;
    if (minY < 0) {
        object.position.y -= minY;
    }
}

export function checkCollision(object) {
    if (!object) return false;
    object.updateWorldMatrix(true, false);
    
    const objectBox = new THREE.Box3().setFromObject(object);
    objectBox.expandByScalar(-COLLISION_TOLERANCE);

    for (const meshId in state.allMeshes) {
        const mesh = state.allMeshes[meshId];
        if (mesh === object || !mesh.visible) continue;

        const otherBox = new THREE.Box3().setFromObject(mesh);
        otherBox.expandByScalar(-COLLISION_TOLERANCE);

        if (objectBox.intersectsBox(otherBox)) {
            return true;
        }
    }
    return false;
}

export function createMeshForNode(node) {
    const d = node.dimensions;
    const geometry = new THREE.BoxGeometry(d.width, d.height, d.depth);
    
    const initialLabel = getInitialLabel(node.displayName);
    const textureNoLabel = createWoodTexture('');
    const textureLabel = createWoodTexture(initialLabel, false);
    const textureLabelFlipped = createWoodTexture(initialLabel, true);

    const matNoLabel = new THREE.MeshStandardMaterial({ map: textureNoLabel });
    const matLabel = new THREE.MeshStandardMaterial({ map: textureLabel });
    const matLabelFlipped = new THREE.MeshStandardMaterial({ map: textureLabelFlipped });

    const materials = [matNoLabel, matNoLabel, matLabel, matLabelFlipped, matNoLabel, matNoLabel];
    
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = node.displayName || node.woodName;
    mesh.userData.partId = node.id;
    mesh.userData.isActive = node.isActive;
    mesh.visible = node.isActive;
    scene.add(mesh);
    state.allMeshes[node.id] = mesh;
    node.meshId = node.id;
    return mesh;
}


// --- Dynamic Measurement Helpers ---

export function updateDynamicMeasurement() {
    clearDynamicMeasurement();
    if (!transformControls.dragging || !transformControls.object || !transformControls.axis) return;

    const movingObject = transformControls.object;
    const axis = transformControls.axis.toLowerCase();
    const movingBox = new THREE.Box3().setFromObject(movingObject);

    let positiveTargets = [];
    let negativeTargets = [];

    for (const meshId in state.allMeshes) {
        const otherObject = state.allMeshes[meshId];
        if (otherObject === movingObject || !otherObject.visible) continue;
        const otherBox = new THREE.Box3().setFromObject(otherObject);

        const dist = movingBox.min[axis] > otherBox.max[axis] 
            ? movingBox.min[axis] - otherBox.max[axis] 
            : otherBox.min[axis] - movingBox.max[axis];

        if (dist < 0) continue;

        if (movingBox.getCenter(new THREE.Vector3())[axis] < otherBox.getCenter(new THREE.Vector3())[axis]) {
            positiveTargets.push({ dist, obj: otherObject });
        } else {
            negativeTargets.push({ dist, obj: otherObject });
        }
    }

    positiveTargets.sort((a, b) => a.dist - b.dist);
    negativeTargets.sort((a, b) => a.dist - b.dist);

    positiveTargets.slice(0, 3).forEach((target, index) => drawDynamicMeasureLine(movingObject, target.obj, axis, 1, index));
    negativeTargets.slice(0, 3).forEach((target, index) => drawDynamicMeasureLine(movingObject, target.obj, axis, -1, index));
}

export function clearDynamicMeasurement() {
    state.dynamicMeasureHelpers.forEach(helper => {
        if (helper.userData.element) {
            helper.userData.element.remove();
        }
        scene.remove(helper);
    });
    state.dynamicMeasureHelpers = [];
}

export function updateLabels() {
    const labels = state.dynamicMeasureHelpers.filter(h => h.userData.element);
    if (labels.length === 0) return;

    const screenLabels = labels.map(label => {
        const vec = new THREE.Vector3().copy(label.position);
        vec.project(camera);
        const x = (vec.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
        const y = (vec.y * -0.5 + 0.5) * renderer.domElement.clientHeight;
        return { label, x, y, element: label.userData.element };
    });

    screenLabels.sort((a, b) => a.y - b.y);

    const labelHeight = 18; 
    for (let i = 0; i < screenLabels.length; i++) {
        if (screenLabels[i].adjusted) continue;

        let cluster = [screenLabels[i]];
        for (let j = i + 1; j < screenLabels.length; j++) {
            if (Math.abs(screenLabels[j].y - screenLabels[i].y) < labelHeight && Math.abs(screenLabels[j].x - screenLabels[i].x) < 50) {
                cluster.push(screenLabels[j]);
            }
        }

        if (cluster.length > 1) {
            const startY = cluster.reduce((sum, item) => sum + item.y, 0) / cluster.length - (cluster.length - 1) * labelHeight / 2;
            cluster.forEach((item, index) => {
                item.y = startY + index * labelHeight;
                item.adjusted = true;
            });
        }
    }

    screenLabels.forEach(item => {
        item.element.style.left = `${item.x}px`;
        item.element.style.top = `${item.y}px`;
    });
}


// --- Private Helper Functions ---

/**
 * ★新規: 次のアルファベット名候補を生成するヘルパー関数
 * @param {string} name - 現在の名前
 * @returns {string} - 次の名前候補
 */
function getNextName(name) {
    // 末尾がA-Yの場合 (大文字小文字を区別しない)
    const matchAlpha = name.match(/^(.*)([A-Y])$/i);
    if (matchAlpha) {
        const base = matchAlpha[1];
        const char = matchAlpha[2];
        const nextChar = String.fromCharCode(char.charCodeAt(0) + 1);
        return base + nextChar;
    }
    // 末尾がZの場合 (大文字小文字を区別しない)
    const matchZ = name.match(/^(.*)(Z)$/i);
    if (matchZ) {
        return name + 'A';
    }
    // 末尾がアルファベットでない場合
    return name + 'A';
}

function createWoodTexture(label = '', isFlipped = false) {
    const cacheKey = `${label}_${isFlipped}`;
    if (state.woodGrainTextureCache[cacheKey]) {
        return state.woodGrainTextureCache[cacheKey].clone();
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const canvasSize = 256;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    context.fillStyle = '#d2b48c';
    context.fillRect(0, 0, canvasSize, canvasSize);

    context.strokeStyle = 'rgba(139, 90, 43, 0.5)';
    context.lineWidth = 2;

    for (let i = 0; i < 30; i++) {
        context.beginPath();
        const y = Math.random() * canvasSize * 1.5 - canvasSize * 0.25;
        context.moveTo(0, y);
        context.bezierCurveTo(
            canvasSize / 3,       y + (Math.random() - 0.5) * 40,
            canvasSize * 2 / 3,   y + (Math.random() - 0.5) * 40,
            canvasSize,           y + (Math.random() - 0.5) * 20
        );
        context.stroke();
    }

    if (label) {
        context.save();
        context.translate(canvasSize / 2, canvasSize / 2);
        if (isFlipped) context.rotate(Math.PI);
        context.font = 'bold 128px sans-serif';
        context.fillStyle = 'rgba(255, 255, 255, 0.7)';
        context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        context.lineWidth = 8;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.strokeText(label, 0, 0);
        context.fillText(label, 0, 0);
        context.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    
    state.woodGrainTextureCache[cacheKey] = texture;
    return texture.clone();
}

function removeMeshesFromSceneAndAllMeshes(node) {
    if (state.allMeshes[node.id]) {
        const mesh = state.allMeshes[node.id];
        scene.remove(mesh);
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => {
                if (m.map) m.map.dispose();
                m.dispose();
            });
        } else {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
        }
        if (mesh.geometry) mesh.geometry.dispose();
        delete state.allMeshes[node.id];
        if (transformControls.object === mesh) {
            transformControls.detach();
        }
    }
    node.children.forEach(child => removeMeshesFromSceneAndAllMeshes(child));
}

function drawDynamicMeasureLine(obj1, obj2, axis, dir, rank) {
    const box1 = new THREE.Box3().setFromObject(obj1);
    const box2 = new THREE.Box3().setFromObject(obj2);
    
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const center1 = box1.getCenter(new THREE.Vector3());
    const center2 = box2.getCenter(new THREE.Vector3());

    start[axis] = dir === 1 ? box1.max[axis] : box1.min[axis];
    end[axis] = dir === 1 ? box2.min[axis] : box2.max[axis];
    
    const size1 = box1.getSize(new THREE.Vector3());
    let offsetAxis, otherAxis;

    if (axis === 'x') { offsetAxis = 'z'; otherAxis = 'y'; } 
    else { offsetAxis = 'x'; otherAxis = axis === 'y' ? 'z' : 'y'; }

    const offsetAmount = (size1[offsetAxis] / 2) * 0.7;
    let offset = 0;
    if (rank === 1) offset = offsetAmount;
    if (rank === 2) offset = -offsetAmount;

    start[offsetAxis] = end[offsetAxis] = center1[offsetAxis] + offset;
    start[otherAxis] = end[otherAxis] = (center1[otherAxis] + center2[otherAxis]) / 2;

    const distance = Math.abs(start[axis] - end[axis]);
    
    const color = rank === 0 ? 0x0000ff : 0x8888ff;
    const lineMaterial = new THREE.LineDashedMaterial({ color: color, dashSize: 5, gapSize: 3 });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();
    scene.add(line);
    
    const label = createMeasurementLabel(`${distance.toFixed(0)} mm`);
    label.position.lerpVectors(start, end, 0.5);
    scene.add(label);

    state.dynamicMeasureHelpers.push(line, label);
}

function createMeasurementLabel(text) {
    const div = document.createElement('div');
    div.className = 'measurement-label';
    div.textContent = text;
    const label = new THREE.Object3D();
    label.userData.element = div;
    document.getElementById('canvas-container').appendChild(div);
    return label;
}