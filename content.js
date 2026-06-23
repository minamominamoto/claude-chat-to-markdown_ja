// claude-chat-to-markdown — Claude.ai 専用の会話保存＋誤送信防止ツール
(function() {
    'use strict';

    const VER = "claude-ctm-v1.2";

    // ============================================================
    // スクレイプ用ユーティリティ
    // ============================================================
    const CLASS_TO_HEADING = { 'Nn35F': '###' };

    function classToHeading(el) {
        for (const [cls, md] of Object.entries(CLASS_TO_HEADING)) {
            if (el.classList && el.classList.contains(cls)) return md;
        }
        return null;
    }

    function isNoiseElement(el) {
        if (!el || !el.tagName) return true;
        if (el.tagName === 'BUTTON') return true;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
        if (el.closest && el.closest('button')) return true;
        if (el.closest && el.closest('[aria-hidden="true"]')) return true;
        if (el.id === 'cctm-panel' || (el.closest && el.closest('#cctm-panel'))) return true;
        return false;
    }

    function elementUID(el) {
        const path = [];
        let cur = el, depth = 0;
        while (cur && cur.tagName !== 'HTML' && depth < 50) {
            const parent = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode : null);
            if (!parent) break;
            const siblings = parent.children ? Array.from(parent.children) : [];
            path.unshift(`${cur.tagName}[${siblings.indexOf(cur)}]`);
            cur = cur.parentElement || (cur.parentNode && cur.parentNode.host);
            depth++;
        }
        return path.join('/');
    }

    function getText(el) {
        try { return (el.innerText || el.textContent || '').trim(); } catch(e) { return ''; }
    }

    function textTop(el) {
        try {
            const t = el.offsetTop;
            if (typeof t === 'number' && !isNaN(t)) return t;
            return el.getBoundingClientRect().top;
        } catch(e) { return 0; }
    }

    // DOM上の物理順序で並び替え（会話の時系列を復元）
    function sortByDOMOrder(arr) {
        return [...arr].sort((a, b) => {
            if (!a.el || !b.el) return 0;
            try {
                const pos = a.el.compareDocumentPosition(b.el);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                return textTop(a.el) - textTop(b.el);
            } catch(e) {
                return textTop(a.el) - textTop(b.el);
            }
        });
    }

    // ============================================================
    // Claude DOM を1回だけスキャンして会話要素を返す（状態を持たない）
    // ============================================================
    function scanConversation() {
        const elements = [];
        const seenIDs = new Set();

        const recordContained = (el) => elements.some(r =>
            r.el && r.el.contains && (r.el.contains(el) || el.contains(r.el)));

        const collect = (selector, role, evidence) => {
            document.querySelectorAll(selector).forEach(el => {
                if (isNoiseElement(el)) return;
                const text = getText(el);
                if (text.length < 5) return;
                const uid = elementUID(el);
                if (seenIDs.has(uid)) return;
                if (recordContained(el)) return;
                elements.push({ el, uid, role, evidence, text, heading: classToHeading(el) });
                seenIDs.add(uid);
            });
        };

        // User / Model
        collect('[data-testid="user-message"]', 'User', 'Claude: [data-testid="user-message"]');
        collect('.font-claude-response', 'Model', 'Claude: .font-claude-response');

        // 添付ファイル名（h3から取得）
        document.querySelectorAll('[data-testid="file-thumbnail"]').forEach(el => {
            const h3 = el.querySelector('h3');
            const fname = h3 ? h3.textContent.trim() : '';
            if (!fname || fname.length < 1) return;
            const uid = elementUID(el);
            if (seenIDs.has(uid)) return;
            elements.push({
                el, uid, role: 'File',
                evidence: 'Claude: attachment (name only; content not in DOM)',
                text: fname, heading: null
            });
            seenIDs.add(uid);
        });

        return elements;
    }

    // ============================================================
    // ヘッダ・ファイル名
    // ============================================================
    function getHeaderText() {
        const explanation = 'Claude.ai 専用ハンドラが User/Model を判定し、添付は file-thumbnail のファイル名のみを File として記録（ファイルの中身・生成ファイルの実体は DOM に無いため対象外）。';
        return `URL: ${location.href}\nVERSION: ${VER}\nHANDLER: claude.ai\nEXPLANATION: ${explanation}\n--------------------\n`;
    }

    function getFileNameBase() {
        const n = new Date();
        const ut = n.getTime();
        const ts = n.getFullYear() + ('0'+(n.getMonth()+1)).slice(-2) + ('0'+n.getDate()).slice(-2) + ('0'+n.getHours()).slice(-2) + ('0'+n.getMinutes()).slice(-2);
        return `AI_claude_ai_${location.pathname.split('/').pop()||'root'}_${ut}_${ts}`;
    }

    function saveBlob(content, name, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    }

    // 会話MD文字列を生成
    function buildChatMD() {
        const elements = scanConversation();
        const ordered = sortByDOMOrder(elements.filter(r => r.text.length >= 5));
        const body = ordered.map((r, i) => {
            const prefix = r.heading ? `${r.heading} ` : '';
            return `## ${r.role} (記録 ${i+1})\n> Evidence: ${r.evidence}\n\n${prefix}${r.text}`;
        }).join('\n\n---\n');
        return getHeaderText() + '---\n\n' + body;
    }

    // ============================================================
    // UI パネル
    // ============================================================
    function showPanel(visible) {
        const panel = document.getElementById('cctm-panel');
        if (panel) panel.style.display = visible ? 'flex' : 'none';
    }

    function initUI() {
        if (document.getElementById('cctm-panel')) return;
        const c = document.createElement('div');
        c.id = 'cctm-panel';
        c.style.cssText = 'position:fixed!important;top:120px!important;right:20px!important;z-index:2147483647;display:none;flex-direction:column;gap:5px;background:rgba(0,0,0,0.9);padding:8px;border-radius:8px;border:1px solid #666;cursor:move;user-select:none;';

        // ドラッグ移動
        let dragX = 0, dragY = 0, dragging = false;
        c.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            dragX = e.clientX - c.getBoundingClientRect().left;
            dragY = e.clientY - c.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            c.style.setProperty('left', (e.clientX - dragX) + 'px', 'important');
            c.style.setProperty('top', (e.clientY - dragY) + 'px', 'important');
            c.style.setProperty('right', 'auto', 'important');
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        const createBtn = (txt, clr, fn) => {
            const b = document.createElement('button');
            b.textContent = txt;
            b.style.cssText = `background:${clr};color:white;border:none;border-radius:4px;width:110px;height:32px;cursor:pointer;font-size:12px;font-weight:bold;`;
            b.onclick = fn;
            c.appendChild(b);
        };

        // --- MD: 会話ログMDを保存 ---
        createBtn('MD', '#2ecc71', () => {
            const base = getFileNameBase();
            saveBlob(buildChatMD(), `${base}.md`, 'text/markdown');
        });

        // --- MD+ZIP: 会話MD・アップロード内包MDを保存し、ZIP生成プロンプトを送信 ---
        createBtn('MD+ZIP', '#2980b9', () => {
            const base = getFileNameBase();

            // 1. 会話MD
            saveBlob(buildChatMD(), `${base}.md`, 'text/markdown');

            // 2. アップロード内包MD（テキスト系添付）
            const TEXT_EXTS = new Set([
                'md','txt','json','js','ts','jsx','tsx','py','rb','go','rs',
                'java','c','cpp','h','hpp','cs','php','swift','kt','sh','bash',
                'zsh','fish','html','htm','css','scss','sass','less','xml','yaml',
                'yml','toml','ini','cfg','conf','env','sql','graphql','r','m',
                'ipynb','csv','tsv','log'
            ]);
            const getExt = (fn) => { const m = fn.match(/\.([a-zA-Z0-9]+)$/); return m ? m[1].toLowerCase() : ''; };
            let uploadsMD = getHeaderText() + '---\n\n# アップロード/ペースト テキストファイル内包\n';
            let hasAttach = false;
            const seenAttach = new Set();
            document.querySelectorAll('[data-testid="file-thumbnail"]').forEach(thumb => {
                const h3 = thumb.querySelector('h3');
                const fname = h3 ? h3.textContent.trim() : '';
                if (!fname || !TEXT_EXTS.has(getExt(fname))) return;
                if (seenAttach.has(fname)) return;
                seenAttach.add(fname);
                hasAttach = true;
                let content = null;
                const msgEl = thumb.closest('[data-testid="user-message"]') ||
                              thumb.closest('[class*="message"]') || thumb.parentElement;
                if (msgEl) {
                    const pre = msgEl.querySelector('pre, code, textarea, [class*="file-content"], [class*="fileContent"]');
                    if (pre) content = pre.textContent.trim();
                }
                uploadsMD += `\n\n---\n## ${fname}\n\n`;
                if (content) {
                    uploadsMD += `\`\`\`${getExt(fname)}\n${content}\n\`\`\`\n`;
                } else {
                    uploadsMD += `> ※内容はDOM上に展開されていないため取得できませんでした。\n`;
                }
            });
            if (hasAttach) {
                saveBlob(uploadsMD, `${base}_uploads.md`, 'text/markdown');
            }

            // 3. ZIP生成プロンプトを送信
            const prompt =
                `このセッションのファイルを2つのZIPにまとめてダウンロードしてください。\n\n` +
                `1. アップロードしたファイルとペーストしたファイルの実体を「${base}_uploads.zip」という名前のZIPに。\n` +
                `2. あなたがこのセッションで生成したファイルを「${base}_downloads.zip」という名前のZIPに。`;
            const inputEl = document.querySelector(
                '[contenteditable="true"].ProseMirror, ' +
                'div[contenteditable="true"][data-testid], ' +
                'div[contenteditable="true"]'
            );
            if (inputEl) {
                inputEl.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, prompt);
                setTimeout(() => {
                    const sendBtn = document.querySelector(
                        'button[aria-label*="送信"], button[aria-label*="Send"], ' +
                        'button[data-testid*="send"], button[type="submit"]'
                    );
                    if (sendBtn) sendBtn.click();
                    else inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
                    }));
                }, 300);
            }
            navigator.clipboard.writeText(prompt).catch(() => {});
        });

        // --- ガード ON/OFF トグル ---
        const guardBtn = document.createElement('button');
        guardBtn.style.cssText = 'background:#8e44ad;color:white;border:none;border-radius:4px;width:110px;height:32px;cursor:pointer;font-size:12px;font-weight:bold;';
        const refreshGuardBtn = () => {
            chrome.storage.local.get('guardEnabled', (data) => {
                const on = data.guardEnabled !== false; // 未設定はON扱い
                guardBtn.textContent = on ? 'ガード: ON' : 'ガード: OFF';
                guardBtn.style.background = on ? '#8e44ad' : '#7f8c8d';
            });
        };
        guardBtn.onclick = () => {
            chrome.storage.local.get('guardEnabled', (data) => {
                const newState = !(data.guardEnabled !== false); // 反転
                chrome.storage.local.set({ guardEnabled: newState }, () => {
                    // 同一タブのenterGuardへ通知
                    chrome.runtime.sendMessage({ guardEnabled: newState }).catch(() => {});
                    window.postMessage({ __cctmGuard: newState }, '*');
                    refreshGuardBtn();
                });
            });
        };
        c.appendChild(guardBtn);
        refreshGuardBtn();

        document.body.appendChild(c);
    }

    // ============================================================
    // 起動
    // ============================================================
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.scVisible !== undefined) showPanel(msg.scVisible);
    });

    const runner = () => {
        if (document.body) {
            initUI();
            chrome.storage.local.get('scVisible', (data) => showPanel(!!data.scVisible));
        } else {
            setTimeout(runner, 100);
        }
    };
    runner();

    // ============================================================
    // enter-guard: Ctrl+Enterで境界封印を注入し誤送信を防止
    // ============================================================
    (function enterGuard() {
        let guardEnabled = true;
        chrome.storage.local.get('guardEnabled', (data) => {
            if (data.guardEnabled !== undefined) guardEnabled = data.guardEnabled;
            updateBadge();
        });
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.guardEnabled !== undefined) { guardEnabled = msg.guardEnabled; updateBadge(); }
        });
        // パネルのガードボタンからの同一ページ内通知
        window.addEventListener('message', (e) => {
            if (e.source === window && e.data && typeof e.data.__cctmGuard === 'boolean') {
                guardEnabled = e.data.__cctmGuard;
                updateBadge();
            }
        });

        const style = document.createElement('style');
        style.textContent = `
            .cg-badge {
                position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
                padding: 5px 16px; border-radius: 20px; font-size: 11px; font-weight: bold;
                z-index: 2147483647; transition: background 0.2s, color 0.2s, box-shadow 0.2s;
                font-family: monospace; border: 1px solid rgba(255,255,255,0.2);
                cursor: grab; user-select: none;
            }
            .cg-badge.cg-dragging { cursor: grabbing; transition: none; }
            .cg-locked { background: #34495e; color: #bdc3c7; }
            .cg-active { background: #27ae60; color: #fff; box-shadow: 0 0 20px #2ecc71; }
            .cg-off { background: #7f8c8d; color: #ecf0f1; opacity: 0.7; }
        `;
        document.head.appendChild(style);

        const badge = document.createElement('div');
        badge.className = 'cg-badge cg-locked';
        badge.textContent = '🔒 GUARD ACTIVE';

        function updateBadge() {
            if (guardEnabled) {
                badge.className = 'cg-badge cg-locked';
                badge.textContent = '🔒 GUARD ACTIVE';
            } else {
                badge.className = 'cg-badge cg-off';
                badge.textContent = '⚪ GUARD OFF';
            }
        }

        const attachBadge = () => {
            if (document.body) {
                document.body.appendChild(badge);
                chrome.storage.local.get('badgePos', (data) => {
                    if (data.badgePos && typeof data.badgePos.left === 'number') {
                        badge.style.left = data.badgePos.left + 'px';
                        badge.style.top = data.badgePos.top + 'px';
                        badge.style.transform = 'none';
                    }
                });
            } else setTimeout(attachBadge, 100);
        };
        attachBadge();

        // バッジドラッグ
        (function enableDrag() {
            let dragging = false, offsetX = 0, offsetY = 0, moved = false;
            badge.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                dragging = true; moved = false;
                const rect = badge.getBoundingClientRect();
                offsetX = e.clientX - rect.left; offsetY = e.clientY - rect.top;
                badge.style.left = rect.left + 'px'; badge.style.top = rect.top + 'px';
                badge.style.transform = 'none';
                badge.classList.add('cg-dragging');
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                moved = true;
                let x = e.clientX - offsetX, y = e.clientY - offsetY;
                x = Math.max(0, Math.min(x, window.innerWidth - badge.offsetWidth));
                y = Math.max(0, Math.min(y, window.innerHeight - badge.offsetHeight));
                badge.style.left = x + 'px'; badge.style.top = y + 'px';
            });
            window.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false; badge.classList.remove('cg-dragging');
                if (moved) chrome.storage.local.set({ badgePos: {
                    left: parseFloat(badge.style.left) || 0,
                    top: parseFloat(badge.style.top) || 0
                }});
            });
        })();

        window.addEventListener('keydown', (event) => {
            if (!guardEnabled) return;
            const activeEl = document.activeElement;
            if (!activeEl) return;
            const isInput = activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT' || activeEl.isContentEditable;
            if (!isInput) return;

            // Ctrl+Enter: 封印を注入（送信しない）
            if (event.ctrlKey && event.key === 'Enter') {
                event.preventDefault();
                event.stopImmediatePropagation();
                const raw = activeEl.isContentEditable ? activeEl.innerText : activeEl.value;
                if (!raw.trim()) {
                    badge.textContent = '⚠️ EMPTY (Type something first)';
                    setTimeout(updateBadge, 1000);
                } else if (!raw.includes('::role_User:')) {
                    const seal = `\n\n::role_User:${Date.now()}`;
                    if (activeEl.isContentEditable) {
                        activeEl.appendChild(document.createTextNode(seal));
                    } else {
                        const s = activeEl.selectionStart, e2 = activeEl.selectionEnd, v = activeEl.value;
                        activeEl.value = v.substring(0, s) + seal + v.substring(e2);
                        activeEl.selectionStart = activeEl.selectionEnd = s + seal.length;
                    }
                    activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                    badge.textContent = '✅ SEALED (Press ENTER to Send)';
                    badge.className = 'cg-badge cg-active';
                    activeEl.focus();
                }
                return;
            }

            // 通常Enter: 封印がなければブロック
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                const content = activeEl.isContentEditable ? activeEl.innerText : activeEl.value;
                if (!content.includes('::role_User:')) {
                    event.stopImmediatePropagation();
                    badge.textContent = '⚠️ SEAL REQUIRED (Ctrl+Enter)';
                    setTimeout(updateBadge, 800);
                } else {
                    setTimeout(updateBadge, 500);
                }
            }
        }, true);
    })();
})();
