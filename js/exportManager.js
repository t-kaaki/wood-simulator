import { state } from './stateManager.js';
import { camera, controls, scene, renderer, transformControls } from './sceneManager.js';
import { deselectObject } from './objectManager.js';
import { generateWoodDiagrams, generateProjectionViews } from './diagramManager.js';
import { formatDate } from './utils.js';

/**
 * 図面出力フォームの送信を処理する
 * @param {Event} event - フォーム送信イベント
 */
export async function handleExport(event) {
    event.preventDefault();
    const form = document.getElementById('export-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.classList.add('active');

    const id = document.getElementById('export-id').value;
    const name = document.getElementById('export-name').value;
    const target = form.querySelector('input[name="export-target"]:checked').value;
    const format = form.querySelector('input[name="export-format"]:checked').value;
    const date = new Date();
    const dateStr = formatDate(date);
    const { jsPDF } = window.jspdf;

    try {
        const targets = {
            isometric: { name: '等角図風', generator: generateIsometricViewCanvas },
            diagram: { name: '材料取り図', generator: generateDiagramCanvas },
            projection: { name: '製作図', generator: generateProjectionCanvas }
        };

        if (target === 'all') {
            const canvases = {};
            for (const key in targets) {
                const sourceCanvas = await targets[key].generator();
                canvases[key] = addFooterWithInfo(sourceCanvas, id, name, date);
            }
            if (format === 'pdf') {
                const firstKey = Object.keys(canvases)[0];
                const firstCanvas = canvases[firstKey];
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [firstCanvas.width, firstCanvas.height] });
                
                Object.keys(canvases).forEach((key, index) => {
                    const canvas = canvases[key];
                    if (index > 0) pdf.addPage([canvas.width, canvas.height]);
                    pdf.addImage(canvas, 'PNG', 0, 0, canvas.width, canvas.height);
                });
                pdf.save(`${id},${name},全部,${dateStr}.pdf`);
            } else {
                for (const key in canvases) {
                    downloadCanvas(canvases[key], `${id},${name},${targets[key].name},${dateStr}.png`);
                }
            }
        } else if (target === 'layout') {
            const isoCanvas = await targets.isometric.generator();
            const diagramCanvas = await targets.diagram.generator();
            const projCanvas = await targets.projection.generator();

            const layoutCanvas = document.createElement('canvas');
            const ctx = layoutCanvas.getContext('2d');
            const W = 1920, H = 1080, P = 20;
            layoutCanvas.width = W; layoutCanvas.height = H;
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);

            const G = 40;
            const blockW = (W - (P * 2) - G) / 2;

            const leftX = P;
            const infoH = 80;
            const diagramH = H - P * 3 - infoH;
            ctx.drawImage(diagramCanvas, leftX, P, blockW, diagramH);
            ctx.strokeRect(leftX, P, blockW, diagramH);
            
            ctx.strokeRect(leftX, P + diagramH + P, blockW, infoH);
            ctx.fillStyle = 'black'; ctx.font = '24px sans-serif';
            ctx.fillText(`番号: ${id}`, leftX + 10, P + diagramH + P + 30);
            ctx.fillText(`名前: ${name}`, leftX + 10, P + diagramH + P + 60);
            ctx.fillText(`日時: ${date.toLocaleString()}`, leftX + 250, P + diagramH + P + 45);

            const rightX = leftX + blockW + G;
            const projH = H * 0.5;
            const isoH = H - P * 3 - projH;
            ctx.drawImage(projCanvas, rightX, P, blockW, projH);
            ctx.strokeRect(rightX, P, blockW, projH);
            ctx.drawImage(isoCanvas, rightX, P * 2 + projH, blockW, isoH);
            ctx.strokeRect(rightX, P * 2 + projH, blockW, isoH);

            if (format === 'pdf') {
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
                pdf.addImage(layoutCanvas, 'PNG', 0, 0, W, H);
                pdf.save(`${id},${name},レイアウト,${dateStr}.pdf`);
            } else {
                downloadCanvas(layoutCanvas, `${id},${name},レイアウト,${dateStr}.png`);
            }
        } else {
            const sourceCanvas = await targets[target].generator();
            const canvasWithInfo = addFooterWithInfo(sourceCanvas, id, name, date);

            if (format === 'pdf') {
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvasWithInfo.width, canvasWithInfo.height] });
                pdf.addImage(canvasWithInfo, 'PNG', 0, 0, canvasWithInfo.width, canvasWithInfo.height);
                pdf.save(`${id},${name},${targets[target].name},${dateStr}.pdf`);
            } else {
                downloadCanvas(canvasWithInfo, `${id},${name},${targets[target].name},${dateStr}.png`);
            }
        }
    } catch (error) {
        console.error('図面出力エラー:', error);
        alert('図面の生成に失敗しました。');
    } finally {
        loadingOverlay.classList.remove('active');
        document.getElementById('export-drawing-modal').classList.remove('active');
    }
}

// --- Private Helper Functions ---

function addFooterWithInfo(sourceCanvas, id, name, date) {
    const footerHeight = 80;
    const padding = 20;
    const fontSize = 24;

    const newCanvas = document.createElement('canvas');
    newCanvas.width = sourceCanvas.width;
    newCanvas.height = sourceCanvas.height + footerHeight;
    const ctx = newCanvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const dateStr = date.toLocaleString('ja-JP');
    const infoText = `番号: ${id}   名前: ${name}   日時: ${dateStr}`;
    
    const textY = sourceCanvas.height + footerHeight / 2;
    ctx.fillText(infoText, padding, textY);

    return newCanvas;
}


async function captureElementAsCanvas(element, options = {}) {
    return await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2,
        ...options
    });
}

async function generateIsometricViewCanvas() {
    const gridHelper = scene.children.find(c => c.isGridHelper);
    const axesHelper = scene.children.find(c => c.isAxesHelper);

    const originalState = {
        cameraPos: camera.position.clone(),
        controlsTarget: controls.target.clone(),
        gridVisible: gridHelper ? gridHelper.visible : false,
        axesVisible: axesHelper ? axesHelper.visible : false,
        transformVisible: transformControls.visible,
        size: new THREE.Vector2()
    };
    renderer.getSize(originalState.size);
    const originalPixelRatio = renderer.getPixelRatio();

    scene.background = new THREE.Color(0xffffff);
    if (gridHelper) gridHelper.visible = false;
    if (axesHelper) axesHelper.visible = false;
    transformControls.visible = false;
    deselectObject();

    const overallBox = new THREE.Box3();
    Object.values(state.allMeshes).filter(m => m && m.visible).forEach(mesh => {
        overallBox.expandByObject(mesh);
    });

    if (!overallBox.isEmpty()) {
        const center = overallBox.getCenter(new THREE.Vector3());
        const sphere = overallBox.getBoundingSphere(new THREE.Sphere());
        const radius = sphere.radius;
        
        const fov = camera.fov * (Math.PI / 180);
        const distance = radius / Math.sin(fov / 2);

        const direction = new THREE.Vector3(1, 1, 1).normalize();
        const newCameraPos = new THREE.Vector3().copy(center).add(direction.multiplyScalar(distance * 1.2));

        camera.position.copy(newCameraPos);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        controls.target.copy(center);
    }
    
    const scale = 2;
    renderer.setPixelRatio(scale);
    renderer.setSize(originalState.size.width, originalState.size.height);
    renderer.render(scene, camera);

    const canvas = document.createElement('canvas');
    canvas.width = originalState.size.width * scale;
    canvas.height = originalState.size.height * scale;
    const context = canvas.getContext('2d');
    context.drawImage(renderer.domElement, 0, 0);

    scene.background = new THREE.Color(0xf0f4f8);
    if (gridHelper) gridHelper.visible = originalState.gridVisible;
    if (axesHelper) axesHelper.visible = originalState.axesVisible;
    transformControls.visible = originalState.transformVisible;
    camera.position.copy(originalState.cameraPos);
    controls.target.copy(originalState.controlsTarget);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(originalPixelRatio);
    renderer.setSize(originalState.size.width, originalState.size.height);
    renderer.render(scene, camera);

    return canvas;
}


/**
 * ★修正: 材料取り図のキャンバスを生成する関数
 * 木目もJavaScriptで直接描画するように変更
 */
async function generateDiagramCanvas() {
    const printContainer = document.getElementById('print-container');
    const template = document.getElementById('wood-diagram-modal-template');
    const diagramModalContent = template.content.cloneNode(true);
    
    printContainer.innerHTML = '';
    printContainer.appendChild(diagramModalContent);
    const clonedModalRoot = printContainer.querySelector('.full-modal-content');
    clonedModalRoot.style.width = '1200px';

    generateWoodDiagrams(printContainer);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 端材要素にCanvasで斜線を描画
    const wasteParts = printContainer.querySelectorAll('.waste-part');
    wasteParts.forEach(part => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const w = part.offsetWidth;
        const h = part.offsetHeight;
        canvas.width = w;
        canvas.height = h;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        const gap = 10;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const totalLength = w + h;
        for (let c = 0; c < totalLength; c += gap) {
            const p1 = { x: Math.max(0, c - h), y: Math.min(h, c) };
            const p2 = { x: Math.min(w, c), y: Math.max(0, c - w) };
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
        part.appendChild(canvas);
    });

    // ★新規: 木目を持つ部品要素にCanvasで木目を描画
    const woodParts = printContainer.querySelectorAll('.wood-diagram-part:not(.waste-part)');
    if (woodParts.length > 0) {
        // スケールを再計算して、CSSで描画される木目の間隔を再現
        let maxMasterWidth = 0;
        for (const rootId in state.woodLayouts) {
            const rootNode = state.woodLayouts[rootId];
            if (rootNode && rootNode.originalDimensions) {
                maxMasterWidth = Math.max(maxMasterWidth, rootNode.originalDimensions.width);
            }
        }
        const containerWidth = printContainer.querySelector('#wood-diagrams-container').clientWidth || 1100;
        const maxWidth = containerWidth > 800 ? 800 : containerWidth - 40;
        const scale = maxMasterWidth > 0 ? maxWidth / maxMasterWidth : 1;
        const grainSpacing = 8 * scale;
        const woodGrainColor = 'rgba(139, 90, 43, 0.25)';

        woodParts.forEach(part => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const w = part.offsetWidth;
            const h = part.offsetHeight;
            canvas.width = w;
            canvas.height = h;
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.pointerEvents = 'none';

            ctx.strokeStyle = woodGrainColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let y = grainSpacing; y < h; y += grainSpacing) {
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
            }
            ctx.stroke();
            part.appendChild(canvas);
        });
    }

    const header = clonedModalRoot.querySelector('.flex.justify-between.items-center');
    if (header) header.style.display = 'none';

    const canvas = await captureElementAsCanvas(clonedModalRoot);
    
    if (header) header.style.display = 'flex';

    printContainer.innerHTML = '';
    return canvas;
}

async function generateProjectionCanvas() {
    const printContainer = document.getElementById('print-container');
    const template = document.getElementById('projection-modal-template');
    const projectionModalContent = template.content.cloneNode(true);

    printContainer.innerHTML = '';
    printContainer.appendChild(projectionModalContent);
    const clonedModalRoot = printContainer.querySelector('.full-modal-content');
    clonedModalRoot.style.width = '1200px';
    clonedModalRoot.style.height = '850px';

    generateProjectionViews(printContainer);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const svgContainer = printContainer.querySelector('#projection-svg-container');
    const canvas = await captureElementAsCanvas(svgContainer);
    
    printContainer.innerHTML = '';
    return canvas;
}

function downloadCanvas(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
}