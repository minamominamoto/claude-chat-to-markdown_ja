// claude-chat-to-markdown — Claude.ai 専用の会話保存＋誤送信防止ツール
(function() {
    'use strict';

    const VER = "v0.18_no_nest";

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
        return new Promise(resolve => {
            const blob = new Blob([content], { type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); resolve(); }, 400);
        });
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

        // --- MD+ZIP: 会話MDを保存し、ZIP生成プロンプトを送信 ---
        createBtn('MD+ZIP', '#2980b9', () => {
            const base = getFileNameBase();
            const elements = scanConversation();
            const ordered = sortByDOMOrder(elements.filter(r => r.text.length >= 5));

            // 逐語会話とファイル名リスト
            const conversation = ordered
                .filter(r => r.role === 'User' || r.role === 'Model')
                .map(r => ({ role: r.role, text: r.text }));
            const fileSet = new Set();
            ordered.filter(r => r.role === 'File').forEach(r => fileSet.add(r.text));
            // このスクリプト自身が生成したファイル（多重ネスト防止）を除外
            const isSelfGenerated = (n) => /(_uploads\.zip|_downloads\.zip|_record\.md|_story\.md|_session\.json)$/.test(n);
            const files = Array.from(fileSet).filter(n => !isSelfGenerated(n));

            // 生DOM（照合用）
            const main = document.querySelector('main') || document.body;
            const rawDOM = main ? main.innerHTML : '';

            const instruction =
                'これは過去のClaudeセッションの記録です。目的は、後でLLMがこのファイル1つを参照すれば経緯を正確に把握でき、' +
                '人間が読んでも他のファイルを開かずに完結する「自己完結した正確なログ」を作ることです。\n\n' +
                '入力は2つ。(A) conversation = 拡張機能が抽出した逐語の対話。(B) rawDOM = 同じセッションの生DOM（照合・補完用）。\n\n' +
                '【最重要原則】対話部分は要約・整形・改変を一切しない。conversationの文言をそのまま使い、rawDOMで取りこぼし（コードブロック・リスト・数式など）があれば補完する。あなたの言葉で言い換えない。\n\n' +
                '以下の3つを生成し、すべて present_files でダウンロードできる形で出力してください。\n\n' +
                '【1. 記録版Markdown（' + base + '_record.md）】' +
                '逐語の対話を時系列でそのまま記録する。filesに挙がった各ファイル（アップロード・生成の両方）の内容を、該当箇所にコードブロックで埋め込む。' +
                'ただしこの拡張機能が過去に生成したファイル（末尾が _uploads.zip / _downloads.zip / _record.md / _session.json）は中身を展開せず、名前の言及のみとする（多重ネスト防止）。' +
                'テキストはそのまま、200KB超は先頭10行のみ、zipは展開してテキストのみ、mhtmlは除外。これ1ファイルで対話とファイル内容が完結するようにする。\n\n' +
                '【2. ' + base + '_uploads.zip】このセッションでアップロード/ペーストされたファイルの実体をまとめる。\n\n' +
                '【3. ' + base + '_downloads.zip】あなたがこのセッションで生成したファイルの実体をまとめる。';
            const sessionJSON = JSON.stringify({ instruction, session: base, files, conversation, rawDOM }, null, 2);

            const runSequence = async () => {
                // 1. 会話MD保存（逐語・拡張機能完結）
                await saveBlob(buildChatMD(), `${base}.md`, 'text/markdown');

                // 2. セッションJSONをClaudeの入力欄にアップロード
                const jsonFile = new File([sessionJSON], `${base}_session.json`, { type: 'application/json' });
                const dt = new DataTransfer();
                dt.items.add(jsonFile);
                const fileInput = document.querySelector('input[type="file"]');
                if (fileInput) {
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    await saveBlob(sessionJSON, `${base}_session.json`, 'application/json');
                    alert('ファイル入力欄が見つかりませんでした。ダウンロードしたsession.jsonを手動でアップロードしてください。');
                    return;
                }

                // 3. プロンプト送信（ファイル添付を待ってから）
                const prompt = 'アップロードした session.json の instruction に従って、記録版MD（逐語・ファイル内容埋め込み）・uploads.zip・downloads.zip の3つを出力してください。対話は要約せず逐語のままにしてください。';
                await new Promise(r => setTimeout(r, 1500));
                const inputEl = document.querySelector(
                    '[contenteditable="true"].ProseMirror, ' +
                    'div[contenteditable="true"][data-testid], ' +
                    'div[contenteditable="true"]'
                );
                if (inputEl) {
                    inputEl.focus();
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, prompt);
                    await new Promise(r => setTimeout(r, 300));
                    const sendBtn = document.querySelector(
                        'button[aria-label*="送信"], button[aria-label*="Send"], ' +
                        'button[data-testid*="send"], button[type="submit"]'
                    );
                    if (sendBtn) sendBtn.click();
                    else inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
                    }));
                }
                navigator.clipboard.writeText(prompt).catch(() => {});
            };
            runSequence();
        });

        // --- 最初に: 新規チャット冒頭でアップロードファイルのバージョン同期を依頼 ---
        createBtn('最初に', '#16a085', () => {
            const prompt =
                'このチャットでこれからアップロード/ペーストするファイルについてのお願いです。' +
                '同名のファイルでも上書きせず、バージョン番号を付けて別個のファイルとして扱ってください。' +
                'ファイルを受け取るたびに、あなたが認識した保存名（例：filename_v1.ext）を応答で明示してください。' +
                'これは後でセッション全体を正確に記録・参照するための準備です。';
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
