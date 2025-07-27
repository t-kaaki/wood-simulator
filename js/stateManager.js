import { recreateMeshesFromState, clearAllMeshes, findNodeAndParent } from './objectManager.js';

const MAX_HISTORY = 20;

// アプリケーションの状態を一元管理
export const state = {
    allMeshes: {},
    selectedObject: null,
    woodLayouts: {},
    history: [],
    diagramSelectedNodeId: null,
    selectedCutParentId: null,
    isColliding: false,
    lastValidTransform: {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion()
    },
    woodGrainTextureCache: {},
    dynamicMeasureHelpers: [],
};

/**
 * 現在の状態を履歴に保存する
 */
export function saveHistoryState() {
    const currentState = {
        layouts: JSON.parse(JSON.stringify(state.woodLayouts)),
        positions: {},
        quaternions: {}
    };
    for (const id in state.allMeshes) {
        if (state.allMeshes[id]) {
            currentState.positions[id] = state.allMeshes[id].position.clone();
            currentState.quaternions[id] = state.allMeshes[id].quaternion.clone();
        }
    }

    if (state.history.length > 0) {
        const lastState = state.history[state.history.length - 1];
        if (JSON.stringify(lastState.layouts) === JSON.stringify(currentState.layouts) &&
            JSON.stringify(lastState.positions) === JSON.stringify(currentState.positions)) {
            return;
        }
    }

    state.history.push(currentState);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    try {
        localStorage.setItem('woodShelfSimulatorData', JSON.stringify(currentState));
    } catch (e) {
        console.error("データ保存エラー:", e);
    }
}

/**
 * 状態を復元する
 * @param {object} savedState - 復元する状態オブジェクト
 */
export function restoreFromState(savedState) {
    clearAllMeshes();
    state.woodLayouts = savedState.layouts;
    recreateMeshesFromState(savedState);
}

/**
 * アプリケーション起動時にlocalStorageからデータを読み込む
 */
export function loadInitialState() {
    const savedData = localStorage.getItem('woodShelfSimulatorData');
    if (savedData) {
        try {
            restoreFromState(JSON.parse(savedData));
        } catch (e) {
            console.error("データ復元エラー:", e);
            state.woodLayouts = {};
            state.allMeshes = {};
        }
    }
    state.history = [];
    saveHistoryState();
}

/**
 * 操作を一つ元に戻す
 */
export function undo() {
    if (state.history.length <= 1) {
        alert('これ以上元に戻せません。');
        return;
    }
    state.history.pop();
    const prevState = state.history[state.history.length - 1];
    restoreFromState(prevState);
    try {
        localStorage.setItem('woodShelfSimulatorData', JSON.stringify(prevState));
    } catch (e) {
        console.error("Undo後データ保存エラー:", e);
    }
}

/**
 * 現在の状態をJSONファイルとして保存する
 * ★修正: ファイル名を引数で受け取るように変更
 * @param {string} filename - 保存するファイル名
 */
export function saveToFile(filename) {
    const currentState = {
        layouts: state.woodLayouts,
        positions: {},
        quaternions: {}
    };
    for (const id in state.allMeshes) {
        if (state.allMeshes[id]) {
            currentState.positions[id] = state.allMeshes[id].position.clone();
            currentState.quaternions[id] = state.allMeshes[id].quaternion.clone();
        }
    }
    const dataStr = JSON.stringify(currentState, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ★修正: 引数で受け取ったファイル名を使用
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * JSONファイルから状態を読み込む
 * @param {Event} event - ファイル入力のイベント
 */
export function loadFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm('現在の作業内容は破棄されます。ファイルを読み込みますか？')) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const loadedState = JSON.parse(e.target.result);
            if (loadedState && typeof loadedState.layouts === 'object' && typeof loadedState.positions === 'object') {
                restoreFromState(loadedState);
                state.history = [];
                saveHistoryState();
                alert('データの読み込みが完了しました。');
            } else {
                throw new Error('無効なファイル形式です。');
            }
        } catch (error) {
            console.error('ファイルの読み込みに失敗しました:', error);
            alert(`ファイルの読み込みに失敗しました。\nエラー: ${error.message}`);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

/**
 * 全てのデータをリセットする
 */
export function resetAll() {
    if (!confirm('全てのシミュレーションデータをリセットしてもよろしいですか？\nこの操作は元に戻せません。')) {
        return;
    }
    localStorage.removeItem('woodShelfSimulatorData');
    clearAllMeshes();
    state.woodLayouts = {};
    state.history = [];
    saveHistoryState();
}