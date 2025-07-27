import { initUI, applyFontSize, initEventListeners } from './uiManager.js';
import { initScene, startAnimation } from './sceneManager.js';
import { loadInitialState } from './stateManager.js';

// アプリケーションのエントリーポイント
document.addEventListener('DOMContentLoaded', () => {
    // 1. UIの初期化（テンプレートからモーダルを生成）
    initUI();

    // 2. フォントサイズをlocalStorageから復元
    const savedFontSize = localStorage.getItem('woodSimulatorFontSize');
    applyFontSize(savedFontSize ? parseFloat(savedFontSize) : 16);

    // 3. 3Dシーンの初期化
    initScene();

    // 4. 保存された状態（データ）をlocalStorageから復元
    loadInitialState();

    // 5. 全てのイベントリスナーを設定
    initEventListeners();

    // 6. アニメーションループを開始
    startAnimation();
});