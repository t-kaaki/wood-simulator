import { state, saveHistoryState, undo, saveToFile, loadFromFile, resetAll } from './stateManager.js';
import { camera, controls, renderer, transformControls } from './sceneManager.js';
import { selectObject, deselectObject, addNewWoodPart, deleteSelectedWoodPart, updateMeshTexture, findNodeAndParent, checkCollision, enforceFloorConstraint } from './objectManager.js';
import { generateWoodDiagrams, generateProjectionViews, deselectAllDiagramItems, applyCutFromDiagram, applyMerge, updateDiagramCutPreview, updateDiagramCutSliderRange } from './diagramManager.js';
import { handleExport } from './exportManager.js';
import { generateUniquePartName } from './utils.js';

let currentFontSize;
const FONT_SIZE_STEP = 1;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 20;
const MOVE_STEP = 1;
const ROTATE_STEP = Math.PI / 2;

export function initUI() {
    const modalIds = ['help-modal', 'usage-guide-modal', 'wood-diagram-modal', 'projection-modal'];
    modalIds.forEach(id => {
        const template = document.getElementById(`${id}-template`);
        const modal = document.getElementById(id);
        if (template && modal) {
            modal.appendChild(template.content.cloneNode(true));
        }
    });
}

export function applyFontSize(size) {
    const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
    document.documentElement.style.fontSize = `${newSize}px`;
    currentFontSize = newSize;
    localStorage.setItem('woodSimulatorFontSize', newSize);
    if (renderer) {
        const container = document.getElementById('canvas-container');
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
}

export function updateSelectedPartInfo(node, selectedObject) {
    const d = node.dimensions;
    const box = new THREE.Box3().setFromObject(selectedObject);
    const floorHeight = box.min.y;

    document.getElementById('selected-part-info').innerHTML = 
      `<div class="font-bold text-indigo-600">${node.displayName || node.woodName}</div>` +
      `<div>寸法: 厚さ ${Math.round(d.height)} x 幅 ${Math.round(d.depth)} x 長さ ${Math.round(d.width)} mm</div>` +
      `<div>床からの高さ: ${Math.round(floorHeight)} mm</div>`;
    
    document.getElementById('part-name-input').value = node.displayName || '';
}

export function initEventListeners() {
    setupMainControls();
    setupTransformUI();
    setupAddWoodForm();
    setupModalControls();
    setupDiagramControls();
    setupExportControls();
    setupCanvasInteractions();
}

// --- Private Event Listener Setup Functions ---

function setupMainControls() {
    document.getElementById('load-button').addEventListener('click', () => document.getElementById('load-input').click());
    document.getElementById('load-input').addEventListener('change', loadFromFile);
    
    document.getElementById('save-button').addEventListener('click', () => {
        const now = new Date();
        const Y = now.getFullYear();
        const M = String(now.getMonth() + 1).padStart(2, '0');
        const D = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const defaultFilename = `wood_shelf_data_${Y}${M}${D}_${h}${m}.json`;
        const userInput = prompt('ファイル名を入力してください:', defaultFilename);
        if (userInput === null) return;
        let finalFilename = userInput.trim();
        if (finalFilename === '') finalFilename = defaultFilename;
        if (!finalFilename.toLowerCase().endsWith('.json')) finalFilename += '.json';
        saveToFile(finalFilename);
    });

    document.getElementById('reset-all').addEventListener('click', resetAll);
    document.getElementById('undo').addEventListener('click', undo);

    document.getElementById('reset-view').addEventListener('click', () => { 
        camera.position.set(0, 150, 800);
        controls.target.set(0, 0, 0); 
    });
    document.getElementById('isometric-view').addEventListener('click', () => {
        const distance = camera.position.length();
        const newPos = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(distance);
        camera.position.copy(newPos);
        controls.target.set(0, 0, 0);
    });

    document.getElementById('font-size-increase').addEventListener('click', () => applyFontSize(currentFontSize + FONT_SIZE_STEP));
    document.getElementById('font-size-decrease').addEventListener('click', () => applyFontSize(currentFontSize - FONT_SIZE_STEP));
}

function setupTransformUI() {
    document.querySelectorAll('#transform-ui button[data-axis]').forEach(button => button.addEventListener('click', () => {
        if (!state.selectedObject) return;
        const originalPosition = state.selectedObject.position.clone();
        state.selectedObject.position[button.dataset.axis] += parseInt(button.dataset.dir) * MOVE_STEP;
        enforceFloorConstraint(state.selectedObject);
        if (checkCollision(state.selectedObject)) {
            state.selectedObject.position.copy(originalPosition);
        } else {
            saveHistoryState();
        }
    }));
    
    document.querySelectorAll('#transform-ui button[data-rot]').forEach(button => button.addEventListener('click', () => {
        if (!state.selectedObject) return;
        const originalQuaternion = state.selectedObject.quaternion.clone();
        const axis = new THREE.Vector3();
        if (button.dataset.rot === 'x') axis.set(1, 0, 0);
        else if (button.dataset.rot === 'y') axis.set(0, 1, 0);
        else axis.set(0, 0, 1);
        const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(axis, ROTATE_STEP);
        state.selectedObject.quaternion.premultiply(rotationQuaternion);
        enforceFloorConstraint(state.selectedObject);
        if (checkCollision(state.selectedObject)) {
            state.selectedObject.quaternion.copy(originalQuaternion);
        } else {
            saveHistoryState();
        }
    }));

    document.getElementById('apply-part-name').addEventListener('click', () => {
        if (!state.selectedObject) return;
        const { node } = findNodeAndParent(state.selectedObject.userData.partId);
        if (!node) return;
        saveHistoryState();
        const baseName = document.getElementById('part-name-input').value.trim();
        const newName = generateUniquePartName(baseName, node.id, state.woodLayouts);
        node.displayName = newName;
        updateMeshTexture(state.selectedObject, newName);
        updateSelectedPartInfo(node, state.selectedObject);
        saveHistoryState();
    });

    document.getElementById('delete-selected-wood').addEventListener('click', deleteSelectedWoodPart);
    document.getElementById('hide-part').addEventListener('click', () => {
        if (!state.selectedObject) return;
        const { node } = findNodeAndParent(state.selectedObject.userData.partId);
        if (node) {
            saveHistoryState();
            node.isActive = false;
            node.isWaste = true;
            state.selectedObject.visible = false;
            deselectObject();
            saveHistoryState();
        }
    });
}

function setupAddWoodForm() {
    document.getElementById('add-new-wood').addEventListener('click', addNewWoodPart);
    document.getElementById('add-wood-header').addEventListener('click', () => {
        const form = document.getElementById('add-wood-form');
        const icon = document.getElementById('add-wood-toggle-icon');
        form.classList.toggle('hidden');
        icon.textContent = form.classList.contains('hidden') ? '▶' : '▼';
    });
}

function setupModalControls() {
    document.getElementById('show-help').addEventListener('click', () => document.getElementById('help-modal').classList.add('active'));
    document.getElementById('help-close').addEventListener('click', () => document.getElementById('help-modal').classList.remove('active'));

    document.getElementById('show-usage-guide').addEventListener('click', () => document.getElementById('usage-guide-modal').classList.add('active'));
    document.getElementById('usage-guide-close').addEventListener('click', () => document.getElementById('usage-guide-modal').classList.remove('active'));

    document.getElementById('show-wood-diagram').addEventListener('click', () => {
        generateWoodDiagrams();
        document.getElementById('wood-diagram-modal').classList.add('active');
    });
    document.getElementById('wood-diagram-close').addEventListener('click', () => {
        deselectAllDiagramItems();
        document.getElementById('wood-diagram-modal').classList.remove('active');
    });

    document.getElementById('projection-view').addEventListener('click', () => {
        generateProjectionViews();
        document.getElementById('projection-modal').classList.add('active');
    });
    document.getElementById('projection-close').addEventListener('click', () => document.getElementById('projection-modal').classList.remove('active'));
}

function setupDiagramControls() {
    const diagramCutSlider = document.getElementById('diagram-cut-slider');
    const diagramCutInput = document.getElementById('diagram-cut-input');
    
    // ★修正: イベントリスナーを修正・有効化
    diagramCutSlider.addEventListener('input', e => {
        diagramCutInput.value = e.target.value;
        updateDiagramCutPreview();
    });
    diagramCutInput.addEventListener('input', e => {
        let value = parseInt(e.target.value);
        const min = parseInt(diagramCutSlider.min);
        const max = parseInt(diagramCutSlider.max);
        if (isNaN(value)) return;
        if (value < min) value = min;
        if (value > max) value = max;
        e.target.value = value;
        diagramCutSlider.value = value;
        updateDiagramCutPreview();
    });

    document.getElementById('diagram-cut-width').addEventListener('click', e => {
        e.target.classList.add('active');
        document.getElementById('diagram-cut-depth').classList.remove('active');
        updateDiagramCutSliderRange();
    });
    document.getElementById('diagram-cut-depth').addEventListener('click', e => {
        e.target.classList.add('active');
        document.getElementById('diagram-cut-width').classList.remove('active');
        updateDiagramCutSliderRange();
    });

    // ★修正: カット基準ボタンのイベントリスナーを修正
    document.querySelectorAll('#diagram-cut-controls .toggle-btn[data-origin]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#diagram-cut-controls .toggle-btn[data-origin]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const slider = document.getElementById('diagram-cut-slider');
            if (btn.dataset.origin === 'end') {
                slider.classList.add('rtl');
            } else {
                slider.classList.remove('rtl');
            }
            
            updateDiagramCutPreview();
        });
    });

    document.getElementById('diagram-apply-cut').addEventListener('click', applyCutFromDiagram);
    document.getElementById('diagram-cancel-cut').addEventListener('click', deselectAllDiagramItems);
    document.getElementById('diagram-apply-merge').addEventListener('click', applyMerge);
    document.getElementById('diagram-cancel-merge').addEventListener('click', deselectAllDiagramItems);

    document.getElementById('diagram-apply-part-name').addEventListener('click', () => {
        if (!state.diagramSelectedNodeId) return;
        const { node } = findNodeAndParent(state.diagramSelectedNodeId);
        if (!node) return;
        
        saveHistoryState();
        const baseName = document.getElementById('diagram-part-name-input').value.trim();
        const newName = generateUniquePartName(baseName, node.id, state.woodLayouts);
        node.displayName = newName;
        
        const mesh = state.allMeshes[node.id];
        if (mesh) updateMeshTexture(mesh, newName);
        
        generateWoodDiagrams();
        deselectAllDiagramItems();
        saveHistoryState();
    });

    document.getElementById('diagram-hide-part').addEventListener('click', () => {
        if (!state.diagramSelectedNodeId) return;
        const { node } = findNodeAndParent(state.diagramSelectedNodeId);
        if (node) {
            saveHistoryState();
            node.isActive = false;
            node.isWaste = true;
            if (state.allMeshes[node.id]) {
                state.allMeshes[node.id].visible = false;
            }
            saveHistoryState();
            generateWoodDiagrams(); 
        }
    });
}

function setupExportControls() {
    document.getElementById('export-drawing-button').addEventListener('click', () => {
        document.getElementById('export-drawing-modal').classList.add('active');
    });
    document.getElementById('export-cancel-button').addEventListener('click', () => {
        document.getElementById('export-drawing-modal').classList.remove('active');
    });
    document.getElementById('export-form').addEventListener('submit', handleExport);
}

function setupCanvasInteractions() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('click', (event) => {
        if (transformControls.dragging) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(Object.values(state.allMeshes).filter(m => m && m.visible));
        
        selectObject(intersects.length > 0 ? intersects[0].object : null);
    });
}