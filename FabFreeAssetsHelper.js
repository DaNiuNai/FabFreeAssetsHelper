// ==UserScript==
// @name         FabFreeAssetsHelper
// @namespace    http://tampermonkey.net/
// @version      v1.0
// @description  Fab 免费资产一键入库 - 支持极速/稳定模式
// @author       https://github.com/DaNiuNai
// @match        https://www.fab.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ==========================================
  // 🎨 CSS 样式
  // ==========================================
  const css = `
        :root {
            --uf-bg: rgba(20, 20, 25, 0.95); /* 加深背景，提高可读性 */
            --uf-border: rgba(255, 255, 255, 0.15);
            --uf-accent: #3b82f6;
            --uf-text: #f3f4f6;
            --uf-success: #10b981;
            --uf-danger: #ef4444;
        }

        #uf-container {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 360px;
            height: 400px; /* 强制固定高度 */
            background: var(--uf-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--uf-border);
            border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
            color: var(--uf-text);
            font-family: Consolas, Monaco, "Courier New", monospace;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: height 0.3s ease;
        }

        #uf-container.minimized {
            height: 48px !important;
            width: 200px !important;
        }

        /* 顶部拖拽栏 */
        .uf-header {
            padding: 10px 15px;
            background: rgba(255,255,255,0.05);
            border-bottom: 1px solid var(--uf-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: grab;
            user-select: none;
            flex-shrink: 0;
        }
        .uf-header:active { cursor: grabbing; }

        /* 统计区域 */
        .uf-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            padding: 10px;
            background: rgba(0,0,0,0.3);
            border-bottom: 1px solid var(--uf-border);
            flex-shrink: 0;
        }
        .uf-stat-box { text-align: center; }
        .uf-stat-num { font-size: 18px; font-weight: bold; color: #fff; }
        .uf-stat-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; }

        /* 日志区域 (关键修复) */
        #uf-log {
            flex: 1; /* 自动填充剩余空间 */
            overflow-y: auto;
            padding: 10px;
            font-size: 11px;
            background: rgba(0,0,0,0.2);
            scroll-behavior: smooth;
        }
        /* 美化滚动条 */
        #uf-log::-webkit-scrollbar { width: 6px; }
        #uf-log::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }

        .uf-log-line { margin-bottom: 3px; display: flex; gap: 6px; line-height: 1.4; border-bottom: 1px dashed rgba(255,255,255,0.05); }
        .uf-ts { color: #6b7280; flex-shrink: 0; }

        /* 底部控制栏 */
        .uf-footer {
            padding: 12px;
            background: rgba(255,255,255,0.02);
            border-top: 1px solid var(--uf-border);
            flex-shrink: 0;
        }

        .uf-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; }
        .uf-btn-group { display: flex; gap: 8px; }
        .uf-btn {
            flex: 1; padding: 8px; border: none; border-radius: 6px;
            font-weight: 600; cursor: pointer; color: white; transition: 0.2s;
        }
        .uf-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* 开关样式 */
        .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #4b5563; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--uf-accent); }
        input:checked + .slider:before { transform: translateX(16px); }
    `;

  // ==========================================
  // 🧠 核心逻辑
  // ==========================================

  let STATE = { isRunning: false, useConcurrency: false, totalAdded: 0 };

  const CORE = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    getCookie: (name) => {
      const v = `; ${document.cookie}`.split(`; ${name}=`);
      if (v.length === 2) return v.pop().split(";").shift();
      return "";
    },

    // API: 获取列表
    getItems: async (cookies, next, url) => {
      const cursor = next ? `&cursor=${next}` : "";
      // 失败重试 3 次
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(`${url}${cursor}`, {
            headers: { accept: "application/json", cookie: cookies },
          });
          if (!res.ok) throw new Error(res.status);
          let data = await res.json();
          return [
            data.cursors?.next ?? null,
            data.results?.map((r) => r.uid) ?? [],
          ];
        } catch (e) {
          await CORE.sleep(1000);
        }
      }
      return [null, []];
    },

    // API: 批量检查状态
    checkStatus: async (cookies, token, uids) => {
      if (!uids.length) return {};
      try {
        const res = await fetch(
          `https://www.fab.com/i/users/me/listings-states?${uids
            .map((u) => `listing_ids=${u}`)
            .join("&")}`,
          { headers: { "x-csrftoken": token } }
        );
        const data = await res.json();
        return data.reduce((acc, item) => {
          acc[item.uid] = item.acquired;
          return acc;
        }, {});
      } catch {
        return {};
      }
    },

    // API: 获取 OfferID (优先专业版)
    getDetails: async (cookies, token, uid) => {
      try {
        const res = await fetch(`https://www.fab.com/i/listings/${uid}`, {
          headers: { "x-csrftoken": token },
        });
        const data = await res.json();
        let offerId = null,
          type = null;
        if (data.licenses) {
          const free = data.licenses.filter((l) => l.priceTier?.price === 0);
          const target = free.find((l) => l.slug === "professional") || free[0];
          if (target) {
            offerId = target.offerId;
            type = target.slug;
          }
        }
        return { uid, offerId, type, title: data.title };
      } catch {
        return { uid, offerId: null, title: "Unknown" };
      }
    },

    // 入库逻辑
    addToLib: async (cookies, token, uid, offerId) => {
      try {
        // 1. 使用原生 FormData，浏览器会自动生成正确的 Boundary，彻底解决 400 Bad Request
        const formData = new FormData();
        formData.append("offer_id", offerId);

        const response = await fetch(
          `https://www.fab.com/i/listings/${uid}/add-to-library`,
          {
            method: "POST",
            headers: {
              "x-csrftoken": token,
              "x-requested-with": "XMLHttpRequest",
              // 注意：这里千万不要手动设置 Content-Type，让浏览器自己设！
            },
            body: formData,
          }
        );

        // 2. 只有 HTTP 204 (No Content) 或 200 才算成功
        if (response.ok) {
          return true;
        } else {
          console.error(`HTTP Error: ${response.status}`); // 在控制台打印真实错误码
          return false;
        }
      } catch (e) {
        console.error(e);
        return false;
      }
    },
  };

  // ==========================================
  // ⚙️ 任务流程
  // ==========================================
  const RUN_TASK = async (isIncremental) => {
    UI.setRunning(true);
    UI.log("🚀 任务启动...", "#fff");

    let token = CORE.getCookie("fab_csrftoken");
    if (!token) {
      UI.log("❌ 未登录，无 Token", "#ef4444");
      UI.setRunning(false);
      return;
    }

    let url =
      "https://www.fab.com/i/listings/search?is_free=1&sort_by=-createdAt";
    let next = null,
      page = 1,
      emptyPages = 0;
    STATE.totalAdded = 0;
    UI.updateStats(0, 1);

    try {
      do {
        if (!STATE.isRunning) break;

        // 1. 获取本页 UID
        const [newNext, uids] = await CORE.getItems(document.cookie, next, url);
        if (!uids.length) break;

        // 2. 检查已拥有
        const states = await CORE.checkStatus(document.cookie, token, uids);
        const targets = uids.filter((u) => states[u] === false);

        UI.log(
          `📄 第 ${page} 页: 扫描 ${uids.length} | 新发现: ${targets.length}`
        );
        UI.updateStats(null, page);

        if (targets.length === 0) {
          emptyPages++;
          // 增量模式下，连续 5 页无新物品则停止
          if (isIncremental && emptyPages >= 5) {
            UI.log("🏁 连续无新物品，检查完成。", "#10b981");
            break;
          }
        } else {
          emptyPages = 0;

          // 定义单个处理函数
          const processItem = async (uid) => {
            const info = await CORE.getDetails(document.cookie, token, uid);
            if (info.offerId) {
              const success = await CORE.addToLib(
                document.cookie,
                token,
                uid,
                info.offerId
              );
              if (success) {
                UI.log(`✅ 入库: ${info.title}`, "#10b981");
                STATE.totalAdded++;
                UI.updateStats(STATE.totalAdded, null);
              } else {
                // 这里显示失败，是因为现在 addToLib 会返回 false 了
                UI.log(`❌ 失败 (Code 400/429): ${info.title}`, "#ef4444");
              }
            } else {
              UI.log(`⚠️ 无 OfferID: ${info.title}`, "#eab308");
            }
          };

          // 3. 执行领取 (并发或串行)
          if (STATE.useConcurrency) {
            // 极速模式：建议不要太快，否则真的全是 400/429
            const chunks = [];
            const chunkSize = 5; // 限制并发数为 5，防止服务器拒绝
            for (let i = 0; i < targets.length; i += chunkSize) {
              chunks.push(targets.slice(i, i + chunkSize));
            }

            for (let chunk of chunks) {
              if (!STATE.isRunning) break;
              await Promise.all(chunk.map(processItem));
              await CORE.sleep(300); // 批次间隔
            }
          } else {
            // 稳定模式
            for (const t of targets) {
              if (!STATE.isRunning) break;
              await processItem(t);
              await CORE.sleep(300); // 单个间隔
            }
          }
        }
        next = newNext;
        page++;
      } while (next);
    } catch (e) {
      UI.log(`🔥 异常中止: ${e.message}`, "#ef4444");
    }

    UI.setRunning(false);
    UI.log(`🎉 结束! 共入库 ${STATE.totalAdded} 个`, "#10b981");
  };

  // ==========================================
  // 🖥️ UI
  // ==========================================
  const UI = {
    el: null,
    logEl: null,

    init: () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);

      const div = document.createElement("div");
      div.id = "uf-container";
      div.innerHTML = `
                <div class="uf-header">
                    <div style="font-weight:bold; display:flex; align-items:center; gap:8px;">
                        <span id="uf-dot" style="width:8px; height:8px; background:#6b7280; border-radius:50%;"></span>
                        Fab 免费资产入库助手
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button id="uf-min" style="background:none; border:none; color:#9ca3af; cursor:pointer;">_</button>
                        <button id="uf-close" style="background:none; border:none; color:#9ca3af; cursor:pointer;">×</button>
                    </div>
                </div>
                <div class="uf-stats">
                    <div class="uf-stat-box"><div class="uf-stat-num" id="val-added">0</div><div class="uf-stat-label">本次入库</div></div>
                    <div class="uf-stat-box"><div class="uf-stat-num" id="val-page">1</div><div class="uf-stat-label">扫描页数</div></div>
                </div>
                <div id="uf-log"></div>
                <div class="uf-footer">
                    <div class="uf-row">
                        <span title="并发数限制为5，防止报错">🚀 极速模式 (慎用)</span>
                        <label class="switch"><input type="checkbox" id="uf-toggle"><span class="slider"></span></label>
                    </div>
                    <div class="uf-btn-group">
                        <button class="uf-btn" id="btn-check" style="background:#3b82f6;">⚡ 增量扫描</button>
                        <button class="uf-btn" id="btn-full" style="background:#10b981;">🐢 全量扫描</button>
                    </div>
                </div>
            `;
      document.body.appendChild(div);
      UI.el = div;
      UI.logEl = div.querySelector("#uf-log");

      // 绑定事件
      div.querySelector("#uf-close").onclick = () => div.remove();
      div.querySelector("#uf-min").onclick = () => {
        div.classList.toggle("minimized");
        const isMin = div.classList.contains("minimized");
        div.querySelector(".uf-stats").style.display = isMin ? "none" : "grid";
        div.querySelector("#uf-log").style.display = isMin ? "none" : "block";
        div.querySelector(".uf-footer").style.display = isMin
          ? "none"
          : "block";
      };

      // 拖拽
      const header = div.querySelector(".uf-header");
      let isDragging = false,
        startX,
        startY,
        initLeft,
        initTop;
      header.onmousedown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = div.getBoundingClientRect();
        initLeft = rect.left;
        initTop = rect.top;
        div.style.right = "auto";
        div.style.bottom = "auto";
        div.style.left = initLeft + "px";
        div.style.top = initTop + "px";
        div.style.transition = "none";
      };
      document.onmousemove = (e) => {
        if (isDragging) {
          div.style.left = initLeft + e.clientX - startX + "px";
          div.style.top = initTop + e.clientY - startY + "px";
        }
      };
      document.onmouseup = () => {
        isDragging = false;
        div.style.transition = "height 0.3s ease";
      };

      // 按钮
      div.querySelector("#uf-toggle").onchange = (e) =>
        (STATE.useConcurrency = e.target.checked);
      div.querySelector("#btn-check").onclick = () => {
        if (!STATE.isRunning) RUN_TASK(true);
      };
      div.querySelector("#btn-full").onclick = () => {
        if (!STATE.isRunning) RUN_TASK(false);
      };
    },

    log: (msg, color) => {
      if (!UI.logEl) return;
      // 🟢 限制日志行数：防止无限变长
      if (UI.logEl.children.length > 50) {
        UI.logEl.removeChild(UI.logEl.firstChild);
      }

      const line = document.createElement("div");
      line.className = "uf-log-line";
      const time = new Date().toTimeString().split(" ")[0];
      line.innerHTML = `<span class="uf-ts">[${time}]</span><span style="color:${
        color || "#d1d5db"
      }">${msg}</span>`;
      UI.logEl.appendChild(line);
      UI.logEl.scrollTop = UI.logEl.scrollHeight;
    },

    updateStats: (add, page) => {
      if (add !== null) document.querySelector("#val-added").textContent = add;
      if (page !== null) document.querySelector("#val-page").textContent = page;
    },

    setRunning: (active) => {
      STATE.isRunning = active;
      document.querySelector("#uf-dot").style.background = active
        ? "#10b981"
        : "#6b7280";
      document.querySelector("#uf-dot").style.boxShadow = active
        ? "0 0 8px #10b981"
        : "none";
      document.querySelector("#btn-check").disabled = active;
      document.querySelector("#btn-full").disabled = active;
      document.querySelector("#uf-toggle").disabled = active;
    },
  };

  UI.init();
  UI.log("👋 系统就绪，等待指令...", "#9ca3af");
})();
