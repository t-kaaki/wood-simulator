// 共通の便利機能

/**
 * 部品名から表示用の短いラベルを生成する (例: "側板-1" -> "側1")
 * @param {string} name - 部品名
 * @returns {string} 短いラベル
 */
export function getInitialLabel(name) {
    if (!name) return '';
    const match = name.match(/^([^-]+)-?(\d*)$/);
    if (match) {
        const base = match[1] ? match[1].charAt(0) : '';
        const num = match[2] || '';
        return `${base}${num}`;
    }
    return name.charAt(0);
}

/**
 * Dateオブジェクトを "YYYYMMDDHHmm" 形式の文字列にフォーマットする
 * @param {Date} date - フォーマットするDateオブジェクト
 * @returns {string} フォーマットされた文字列
 */
export function formatDate(date) {
    const Y = date.getFullYear();
    const M = ("0" + (date.getMonth() + 1)).slice(-2);
    const D = ("0" + date.getDate()).slice(-2);
    const h = ("0" + date.getHours()).slice(-2);
    const m = ("0" + date.getMinutes()).slice(-2);
    return `${Y}${M}${D}${h}${m}`;
}

/**
 * ユニークな部品名を生成する。既存の名前と重複する場合は連番を付与する。
 * @param {string} baseName - 基本となる部品名
 * @param {string} excludeId - チェック対象から除外する部品のID
 * @param {object} woodLayouts - 全てのレイアウトデータ
 * @returns {string} ユニークな部品名
 */
export function generateUniquePartName(baseName, excludeId, woodLayouts) {
    if (!baseName) return '';

    const allDisplayNames = [];
    function collectNames(node) {
        if (node.id !== excludeId && node.displayName) {
            allDisplayNames.push(node.displayName);
        }
        node.children.forEach(collectNames);
    }
    Object.values(woodLayouts).forEach(collectNames);

    if (!allDisplayNames.includes(baseName)) {
        return baseName;
    }

    let i = 2;
    while (true) {
        const newName = `${baseName}-${i}`;
        if (!allDisplayNames.includes(newName)) {
            return newName;
        }
        i++;
    }
}