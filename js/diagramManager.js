import { state, saveHistoryState } from './stateManager.js';
import { findNodeAndParent, createMeshForNode, selectObject, removeMeshById } from './objectManager.js';
import { getInitialLabel } from './utils.js';

const CUT_GAP = 5;

export function generateWoodDiagrams(targetElement = document.getElementById('wood-diagram-modal')) {
    const container = targetElement.querySelector('#wood-diagrams-container');
    if (!container) {
        console.error('Diagram container not found in target element.');
        return;
    }
    container.innerHTML = ''; 
    
    if (targetElement.id === 'wood-diagram-modal') {
        deselectAllDiagramItems();
    }
    
    const warningMessage = targetElement.querySelector('#diagram-warning-message');
    warningMessage.classList.add('hidden');
    let hasClearanceIssue = false;

    if (Object.keys(state.woodLayouts).length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500">表示する板材がありません。新しい板材を追加してください。</p>';
        return;
    }

    let maxMasterWidth = 0;
    for (const rootId in state.woodLayouts) {
        const rootNode = state.woodLayouts[rootId];
        if (rootNode && rootNode.originalDimensions) {
            maxMasterWidth = Math.max(maxMasterWidth, rootNode.originalDimensions.width);
        }
    }
    
    const containerWidth = container.clientWidth || 1100;
    const maxWidth = containerWidth > 800 ? 800 : containerWidth - 40;
    const scale = maxMasterWidth > 0 ? maxWidth / maxMasterWidth : 1;

    for (const rootId in state.woodLayouts) {
        const rootNode = state.woodLayouts[rootId];
        if (!rootNode || !rootNode.originalDimensions) continue;
        if (checkClearance(rootNode)) hasClearanceIssue = true;

        const diagramContainer = document.createElement('div');
        diagramContainer.innerHTML = `<h4 class="text-lg font-bold mb-2 text-indigo-700">${rootNode.woodName}</h4>`;
        
        if (checkWorkEfficiency(rootNode)) {
            const efficiencyWarningDiv = document.createElement('div');
            efficiencyWarningDiv.className = 'bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-2 rounded relative mb-2 text-sm';
            efficiencyWarningDiv.innerHTML = '<strong class="font-bold">作業効率のヒント:</strong> <span class="block sm:inline">部品を両端に寄せて配置すると、切断回数が減る場合があります。</span>';
            diagramContainer.appendChild(efficiencyWarningDiv);
        }
        
        const woodDiagram = document.createElement('div');
        woodDiagram.classList.add('wood-diagram');
        woodDiagram.style.width = `${rootNode.originalDimensions.width * scale}px`;
        woodDiagram.style.height = `${rootNode.originalDimensions.depth * scale}px`;
        
        const previewLine = document.createElement('div');
        previewLine.id = `diagram-preview-${rootId}`;
        previewLine.style.cssText = 'position: absolute; background-color: rgba(255, 0, 0, 0.7); display: none; pointer-events: none;';
        woodDiagram.appendChild(previewLine);
        
        drawPartRecursive(rootNode, woodDiagram, scale, rootNode);
        drawCutLinesRecursive(rootNode, woodDiagram, scale);

        diagramContainer.appendChild(woodDiagram);
        container.appendChild(diagramContainer);
    }
    if (hasClearanceIssue) warningMessage.classList.remove('hidden');
}

export function applyCutFromDiagram() {
    if (!state.diagramSelectedNodeId) return;
    const { node } = findNodeAndParent(state.diagramSelectedNodeId);
    if (!node) return;

    const cutOrigin = document.querySelector('#diagram-cut-controls .toggle-btn.active').dataset.origin;
    const cutDirection = document.querySelector('#diagram-cut-width').classList.contains('active') ? 'width' : 'depth';
    let cutValue = parseInt(document.getElementById('diagram-cut-slider').value);
    
    selectObject(state.allMeshes[node.id]);
    applyCut(cutDirection, cutOrigin, cutValue);
    generateWoodDiagrams();
}

export function applyMerge() {
    if (!state.selectedCutParentId) return;
    
    const { node: parentNode } = findNodeAndParent(state.selectedCutParentId);
    if (!parentNode || parentNode.children.length !== 2) return;

    const child1 = parentNode.children[0];
    const child2 = parentNode.children[1];

    if (child1.children.length > 0 || child2.children.length > 0) {
        let furtherCutPartName = (child1.children.length > 0) ? (child1.displayName || child1.woodName) : (child2.displayName || child2.woodName);
        alert(`統合しようとしている部品「${furtherCutPartName}」は、さらに細かくカットされています。\n先にそちらのカットから統合してください。`);
        return;
    }

    if (!confirm('このカットを元に戻し、部品を統合しますか？')) return;

    saveHistoryState();

    parentNode.children.forEach(childNode => {
        removeMeshById(childNode.id);
    });

    parentNode.isActive = true;
    parentNode.children = [];
    if (state.allMeshes[parentNode.id]) {
        state.allMeshes[parentNode.id].visible = true;
    } else {
        const mesh = createMeshForNode(parentNode);
        const historyState = state.history[state.history.length-1];
        if(historyState && historyState.positions[parentNode.id]) {
            mesh.position.copy(historyState.positions[parentNode.id]);
            mesh.quaternion.copy(historyState.quaternions[parentNode.id]);
        }
    }

    deselectAllDiagramItems();
    generateWoodDiagrams();
    saveHistoryState();
}

export function deselectAllDiagramItems() {
    document.querySelectorAll('.wood-diagram-part.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.cut-line.selected').forEach(el => el.classList.remove('selected'));
    state.diagramSelectedNodeId = null;
    state.selectedCutParentId = null;
    document.getElementById('diagram-cut-controls').classList.add('hidden');
    document.getElementById('diagram-merge-controls').classList.add('hidden');
    document.querySelectorAll('[id^=diagram-preview-]').forEach(el => el.style.display = 'none');
}

// ★修正: exportを追加
export function updateDiagramCutSliderRange() {
    if (!state.diagramSelectedNodeId) return;
    const { node } = findNodeAndParent(state.diagramSelectedNodeId);
    if (!node) return;
    const cutDir = document.querySelector('#diagram-cut-width').classList.contains('active') ? 'width' : 'depth';
    const dim = node.dimensions[cutDir];
    const slider = document.getElementById('diagram-cut-slider');
    const input = document.getElementById('diagram-cut-input');
    const minCut = 4;
    slider.min = minCut;
    slider.max = dim > (minCut * 2) ? dim - minCut : minCut;
    slider.value = Math.round(dim / 2);
    input.min = slider.min;
    input.max = slider.max;
    input.value = slider.value;
    updateDiagramCutPreview();
}

// ★修正: exportを追加
export function updateDiagramCutPreview() {
    if (!state.diagramSelectedNodeId) return;
    const { node, rootNode } = findNodeAndParent(state.diagramSelectedNodeId);
    if (!node || !rootNode || !rootNode.originalDimensions) return;
    
    const container = document.getElementById('wood-diagrams-container');
    let maxMasterWidth = Object.values(state.woodLayouts).reduce((max, r) => Math.max(max, r.originalDimensions.width), 0);
    const containerWidth = container.clientWidth;
    const maxWidth = containerWidth > 800 ? 800 : containerWidth - 40;
    const scale = maxMasterWidth > 0 ? maxWidth / maxMasterWidth : 1;
    
    const previewLine = document.getElementById(`diagram-preview-${rootNode.id}`);
    const cutOrigin = document.querySelector('#diagram-cut-controls .toggle-btn.active').dataset.origin;
    const cutDir = document.querySelector('#diagram-cut-width').classList.contains('active') ? 'width' : 'depth';
    let sliderVal = parseInt(document.getElementById('diagram-cut-slider').value);
    
    if (cutOrigin === 'end') {
        sliderVal = node.dimensions[cutDir] - sliderVal;
    }

    previewLine.style.display = 'block';
    if (cutDir === 'width') {
        previewLine.style.left = `${(node.bounds.x + sliderVal) * scale}px`;
        previewLine.style.top = `${node.bounds.y * scale}px`;
        previewLine.style.width = '2px';
        previewLine.style.height = `${node.bounds.depth * scale}px`;
    } else {
        previewLine.style.left = `${node.bounds.x * scale}px`;
        previewLine.style.top = `${(node.bounds.y + sliderVal) * scale}px`;
        previewLine.style.height = '2px';
        previewLine.style.width = `${node.bounds.width * scale}px`;
    }
}

// --- Private Helper Functions ---

function getActiveLeafNodes(node, list = []) {
    if (node.isActive && node.children.length === 0) {
        list.push(node);
    }
    node.children.forEach(child => getActiveLeafNodes(child, list));
    return list;
}

function checkClearance(rootNode) {
    const activeParts = getActiveLeafNodes(rootNode);
    const minClearance = 4;
    for (let i = 0; i < activeParts.length; i++) {
        for (let j = i + 1; j < activeParts.length; j++) {
            const a = activeParts[i].bounds;
            const b = activeParts[j].bounds;
            const overlapX = Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width);
            const overlapY = Math.max(a.y, b.y) < Math.min(a.y + a.depth, b.y + b.depth);
            if (overlapY) {
                const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
                if (gapX > -minClearance && gapX <= 0) return true;
            }
            if (overlapX) {
                const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.depth, b.y + b.depth);
                if (gapY > -minClearance && gapY <= 0) return true;
            }
        }
    }
    return false;
}

function checkWorkEfficiency(rootNode) {
    if (!rootNode || !rootNode.originalDimensions) return false;
    const activeParts = getActiveLeafNodes(rootNode);
    if (activeParts.length < 2) return false;
    let hasPartOnLeftEdge = false;
    let hasPartOnRightEdge = false;
    const masterWidth = rootNode.originalDimensions.width;
    const tolerance = 0.01;
    activeParts.forEach(part => {
        if (Math.abs(part.bounds.x) < tolerance) hasPartOnLeftEdge = true;
        if (Math.abs((part.bounds.x + part.bounds.width) - masterWidth) < tolerance) hasPartOnRightEdge = true;
    });
    return !(hasPartOnLeftEdge && hasPartOnRightEdge);
}

function drawPartRecursive(node, container, scale, rootNode) {
    if (node.isActive || node.isWaste) {
        const partDiv = document.createElement('div');
        partDiv.className = 'wood-diagram-part';
        if (node.isWaste) {
            partDiv.classList.add('waste-part');
        } else {
            const woodGrainColor = 'rgba(139, 90, 43, 0.25)';
            const grainSpacing = 8 * scale;
            partDiv.style.backgroundImage = `repeating-linear-gradient(0deg, transparent, transparent ${grainSpacing - 1}px, ${woodGrainColor} ${grainSpacing - 1}px, ${woodGrainColor} ${grainSpacing}px)`;
            partDiv.style.backgroundSize = `${rootNode.originalDimensions.width * scale}px ${rootNode.originalDimensions.depth * scale}px`;
            partDiv.style.backgroundPosition = `${-node.bounds.x * scale}px ${-node.bounds.y * scale}px`;
        }
        
        const displayWidth = node.bounds.width * scale;
        partDiv.style.left = `${node.bounds.x * scale}px`;
        partDiv.style.top = `${node.bounds.y * scale}px`;
        partDiv.style.width = `${displayWidth}px`;
        partDiv.style.height = `${node.bounds.depth * scale}px`;
        
        partDiv.innerHTML = `<span class="part-initial">${getInitialLabel(node.displayName)}</span><div class="part-dimensions"><span>${Math.round(node.dimensions.depth)}</span><span>x</span><span>${Math.round(node.dimensions.width)}</span></div>`;
        if (displayWidth < 120) partDiv.classList.add('vertical-layout');

        partDiv.dataset.nodeId = node.id;
        partDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (node.isWaste) {
                if (confirm('この端材を再表示しますか？')) {
                    saveHistoryState();
                    node.isWaste = false;
                    node.isActive = true;
                    if (state.allMeshes[node.id]) state.allMeshes[node.id].visible = true;
                    saveHistoryState();
                    generateWoodDiagrams();
                }
            } else {
                handleDiagramPartSelect(node, partDiv);
            }
        });
        container.appendChild(partDiv);
    }
    node.children.forEach(child => drawPartRecursive(child, container, scale, rootNode));
}

function drawCutLinesRecursive(parentNode, container, scale) {
    if (parentNode.children.length === 2) {
        const [child1, child2] = parentNode.children;
        const cutLine = document.createElement('div');
        cutLine.className = 'cut-line';
        cutLine.dataset.parentId = parentNode.id;
        
        const isVerticalCut = Math.abs(child1.bounds.y - child2.bounds.y) < 0.1 && Math.abs(child1.bounds.depth - child2.bounds.depth) < 0.1;
        if (isVerticalCut) {
            const boundaryX = (child1.bounds.x < child2.bounds.x) ? child1.bounds.x + child1.bounds.width : child2.bounds.x + child2.bounds.width;
            cutLine.style.cssText = `left: ${boundaryX * scale - 2}px; top: ${child1.bounds.y * scale}px; width: 4px; height: ${parentNode.dimensions.depth * scale}px;`;
        } else {
            const boundaryY = (child1.bounds.y < child2.bounds.y) ? child1.bounds.y + child1.bounds.depth : child2.bounds.y + child2.bounds.depth;
            cutLine.style.cssText = `left: ${child1.bounds.x * scale}px; top: ${boundaryY * scale - 2}px; width: ${parentNode.dimensions.width * scale}px; height: 4px;`;
        }
        
        cutLine.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCutLineSelect(parentNode.id, cutLine);
        });
        container.appendChild(cutLine);
    }
    parentNode.children.forEach(child => drawCutLinesRecursive(child, container, scale));
}

function handleDiagramPartSelect(node, partDiv) {
    deselectAllDiagramItems();
    partDiv.classList.add('selected');
    state.diagramSelectedNodeId = node.id;
    
    const controls = document.getElementById('diagram-cut-controls');
    const container = document.getElementById('wood-diagrams-container');
    const diagramOffsetTop = partDiv.closest('.wood-diagram').offsetTop;
    controls.style.top = `${diagramOffsetTop + partDiv.offsetTop + partDiv.offsetHeight / 2 - controls.offsetHeight / 2 + container.scrollTop}px`;
    controls.style.left = `${partDiv.offsetLeft + partDiv.offsetWidth + 10}px`;
    controls.classList.remove('hidden');
    
    document.getElementById('diagram-selected-part-name').textContent = `部品「${node.displayName || node.woodName}」をカット`;
    document.getElementById('diagram-part-name-input').value = node.displayName || '';
    updateDiagramCutSliderRange();
}

function handleCutLineSelect(parentNodeId, cutLineElement) {
    deselectAllDiagramItems();
    cutLineElement.classList.add('selected');
    state.selectedCutParentId = parentNodeId;

    const controls = document.getElementById('diagram-merge-controls');
    const container = document.getElementById('wood-diagrams-container');
    const diagramOffsetTop = cutLineElement.closest('.wood-diagram').offsetTop;
    controls.style.top = `${diagramOffsetTop + cutLineElement.offsetTop + cutLineElement.offsetHeight / 2 - controls.offsetHeight / 2 + container.scrollTop}px`;
    controls.style.left = `${cutLineElement.offsetLeft + cutLineElement.offsetWidth + 10}px`;
    controls.classList.remove('hidden');
}

function applyCut(cutDirection, cutOrigin, cutValue) {
    if (!state.selectedObject) return;
    saveHistoryState();
    const { node } = findNodeAndParent(state.selectedObject.userData.partId);
    if (!node) return;
    
    if (cutOrigin === 'end') cutValue = node.dimensions[cutDirection] - cutValue;

    node.isActive = false;
    state.allMeshes[node.id].visible = false;

    const child1 = { id: `part_${Date.now()}`, children: [], dimensions: {}, bounds: {}, woodName: `${node.woodName}_1`, displayName: '', isActive: true, isWaste: false };
    const child2 = { id: `part_${Date.now()+1}`, children: [], dimensions: {}, bounds: {}, woodName: `${node.woodName}_2`, displayName: '', isActive: true, isWaste: false };
    
    let posOffset1, posOffset2;
    if (cutDirection === 'width') {
        child1.dimensions = { ...node.dimensions, width: cutValue };
        child1.bounds = { ...node.bounds, width: cutValue };
        child2.dimensions = { ...node.dimensions, width: node.dimensions.width - cutValue };
        child2.bounds = { ...node.bounds, x: node.bounds.x + cutValue, width: node.dimensions.width - cutValue };
        posOffset1 = new THREE.Vector3(-(node.dimensions.width - child1.dimensions.width) / 2 - CUT_GAP / 2, 0, 0);
        posOffset2 = new THREE.Vector3((node.dimensions.width - child2.dimensions.width) / 2 + CUT_GAP / 2, 0, 0);
    } else { // depth
        child1.dimensions = { ...node.dimensions, depth: cutValue };
        child1.bounds = { ...node.bounds, depth: cutValue };
        child2.dimensions = { ...node.dimensions, depth: node.dimensions.depth - cutValue };
        child2.bounds = { ...node.bounds, y: node.bounds.y + cutValue, depth: node.dimensions.depth - cutValue };
        posOffset1 = new THREE.Vector3(0, 0, -(node.dimensions.depth - child1.dimensions.depth) / 2 - CUT_GAP / 2);
        posOffset2 = new THREE.Vector3(0, 0, (node.dimensions.depth - child2.dimensions.depth) / 2 + CUT_GAP / 2);
    }
    
    const mesh1 = createMeshForNode(child1);
    const mesh2 = createMeshForNode(child2);
    
    posOffset1.applyQuaternion(state.selectedObject.quaternion);
    posOffset2.applyQuaternion(state.selectedObject.quaternion);

    mesh1.position.copy(state.selectedObject.position).add(posOffset1);
    mesh2.position.copy(state.selectedObject.position).add(posOffset2);
    mesh1.quaternion.copy(state.selectedObject.quaternion);
    mesh2.quaternion.copy(state.selectedObject.quaternion);
    
    node.children.push(child1, child2);
    saveHistoryState();
}

export function generateProjectionViews(targetElement = document.getElementById('projection-modal')) {
    const container = targetElement.querySelector('#projection-svg-container');
    if (!container) {
        console.error('Projection container not found in target element.');
        return;
    }
    container.innerHTML = '';
    const visibleMeshes = Object.values(state.allMeshes).filter(m => m && m.visible);

    if (visibleMeshes.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500">表示する部品がありません。</p>';
        return;
    }

    const overallBox = new THREE.Box3();
    visibleMeshes.forEach(mesh => overallBox.expandByObject(mesh));
    const size = overallBox.getSize(new THREE.Vector3());
    
    const padding = 50, gap = 50;
    const frontView = { width: size.x, height: size.y };
    const topView = { width: size.x, height: size.z };
    const rightView = { width: size.z, height: size.y };

    const totalWidth = padding * 2 + frontView.width + gap + rightView.width;
    const totalHeight = padding * 2 + topView.height + gap + frontView.height;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
    container.appendChild(svg);

    const groups = {
        front: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        top: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        right: document.createElementNS('http://www.w3.org/2000/svg', 'g')
    };
    groups.front.setAttribute('transform', `translate(${padding}, ${padding + topView.height + gap})`);
    groups.top.setAttribute('transform', `translate(${padding}, ${padding})`);
    groups.right.setAttribute('transform', `translate(${padding + frontView.width + gap}, ${padding + topView.height + gap})`);
    Object.values(groups).forEach(g => svg.appendChild(g));

    const edges = [];
    const edgeHashes = new Set();
    visibleMeshes.forEach(mesh => {
        const edgeGeom = new THREE.EdgesGeometry(mesh.geometry, 1);
        const position = edgeGeom.attributes.position;
        for (let i = 0; i < position.count; i += 2) {
            const v1 = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            const v2 = new THREE.Vector3().fromBufferAttribute(position, i + 1).applyMatrix4(mesh.matrixWorld);
            const hash1 = `${v1.x.toFixed(3)},${v1.y.toFixed(3)},${v1.z.toFixed(3)}`;
            const hash2 = `${v2.x.toFixed(3)},${v2.y.toFixed(3)},${v2.z.toFixed(3)}`;
            const hash = hash1 < hash2 ? hash1 + '|' + hash2 : hash2 + '|' + hash1;
            if (!edgeHashes.has(hash)) {
                edges.push({ start: v1, end: v2 });
                edgeHashes.add(hash);
            }
        }
    });
    
    Object.entries(groups).forEach(([type, group]) => {
        edges.forEach(edge => {
            const p1 = projectPoint(edge.start, type, overallBox, frontView, topView, rightView);
            const p2 = projectPoint(edge.end, type, overallBox, frontView, topView, rightView);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
            line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
            line.setAttribute('stroke', 'black'); line.setAttribute('stroke-width', '1');
            group.appendChild(line);
        });
    });

    const addLabel = (text, x, y) => {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.textContent = text;
        label.setAttribute('x', x); label.setAttribute('y', y);
        label.setAttribute('font-size', '20'); label.setAttribute('font-family', 'sans-serif');
        svg.appendChild(label);
    };
    addLabel('平面図', padding, padding - 10);
    addLabel('正面図', padding, padding + topView.height + gap - 10);
    addLabel('右側面図', padding + frontView.width + gap, padding + topView.height + gap - 10);
}

function projectPoint(point, viewType, box, front, top, right) {
    switch (viewType) {
        case 'front': return { x: point.x - box.min.x, y: front.height - (point.y - box.min.y) };
        case 'top':   return { x: point.x - box.min.x, y: point.z - box.min.z };
        case 'right': return { x: right.width - (point.z - box.min.z), y: right.height - (point.y - box.min.y) };
    }
}