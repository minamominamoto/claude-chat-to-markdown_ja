chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ scVisible: false, guardEnabled: true }, () => {
        if (chrome.runtime.lastError) console.error("Storage error:", chrome.runtime.lastError);
    });
});

// 拡張アイコンクリックで保存パネルの表示/非表示をトグル
chrome.action.onClicked.addListener(async (tab) => {
    chrome.storage.local.get('scVisible', async (data) => {
        const newState = !data.scVisible;
        await chrome.storage.local.set({ scVisible: newState });
        try {
            await chrome.action.setBadgeText({ text: newState ? "ON" : "" });
            await chrome.action.setBadgeBackgroundColor({ color: "#27ae60" });
        } catch (e) {
            console.warn("Badge update failed:", e);
        }
        if (tab?.id && tab.url && tab.url.startsWith('https://claude.ai/')) {
            chrome.tabs.sendMessage(tab.id, { scVisible: newState }).catch(() => {
                console.log("Content script not ready");
            });
        }
    });
});
