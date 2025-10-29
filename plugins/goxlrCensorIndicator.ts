/**
 * goxlrBleepMicIndicator - Bleep (green) + Cough (red) with full teardown + toast notifications
 * Optimized to reduce DOM thrashing, logging overhead, and redundant work.
 */

type CleanupFn = () => void;

const WS_URL = "ws://127.0.0.1:14564/api/websocket"; // GoXLR Utility WebSocket
const GREEN = "#57F287"; // success green
const RED = "#ED4245"; // danger red
const RECONNECT_MS = 2000;
const UI_REFRESH_MS = 50; // debounce UI refresh to avoid rapid thrashing
const MIC_SELECTOR =
    'button[aria-label="Mute"], button[aria-label="Unmute"], button[role="switch"][aria-label="Mute"], button[role="switch"][aria-label="Unmute"]';
const RE_BLEEP = /\/button_down\/Bleep$/;
const RE_COUGH = /\/button_down\/Cough$/;
const DEBUG = false;

// Toasts (Vencord webpack common)
let Toasts: any | null = null;
let showToast: ((msg: string, type?: any) => void) | null = null;

// Runtime state
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

let bleepActive = false;
let coughActive = false;

let micBtn: HTMLButtonElement | null = null;
let mo: MutationObserver | null = null;
let cleanupFns: CleanupFn[] = [];
let styleEl: HTMLStyleElement | null = null;

// Cache and state for minimizing DOM updates
let lastAppliedState: UiState = "off";
let lastAppliedBtn: HTMLButtonElement | null = null;
let uiRefreshTimer: number | null = null;
let pendingReason: string | null = null;

// Running guard to prevent reconnection after stop
let running = false;

// lottie element cache per mic button
const lottieCache = new WeakMap<HTMLElement, HTMLElement | null>();

function log(...args: any[]) {
    if (DEBUG) console.log("[GOXLR]", ...args);
}
function warn(...args: any[]) {
    console.warn("[GOXLR]", ...args);
}
function err(...args: any[]) {
    console.error("[GOXLR]", ...args);
}

// Lazy-get toasts from Vencord webpack common
function ensureToasts() {
    try {
        if (Toasts && showToast) return;
        // @ts-ignore - available in Vencord runtime
        const common =
            (window as any).Vencord?.Webpack?.common ??
            (window as any).Vencord?.Webpack?.modules?.common;
        Toasts = common?.Toasts ?? null;
        showToast = common?.showToast ?? null;
        log("ensureToasts()", {
            hasToasts: !!Toasts,
            hasShowToast: !!showToast,
        });
    } catch (e) {
        err("ensureToasts() failed:", e);
    }
}

function toast(msg: string, type?: any) {
    try {
        ensureToasts();
        if (showToast) {
            showToast(msg, type ?? Toasts?.Type?.INFO);
        } else {
            // Fallback to console if toasts aren’t available
            log("Toast:", msg);
        }
    } catch (e) {
        err("toast() failed:", e);
    }
}

function ensureStyleSheet() {
    try {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.id = "goxlr-bleep-style";
        styleEl.textContent = `
/* Scoped overrides while active */
.goxlr-bleep { color: ${GREEN} !important; }
.goxlr-bleep [class*="lottieIcon"] { --__lottieIconColor: ${GREEN} !important; color: ${GREEN} !important; }
.goxlr-bleep [class*="lottieIcon"] svg path { fill: ${GREEN} !important; stroke: ${GREEN} !important; }

.goxlr-cough { color: ${RED} !important; }
.goxlr-cough [class*="lottieIcon"] { --__lottieIconColor: ${RED} !important; color: ${RED} !important; }
.goxlr-cough [class*="lottieIcon"] svg path { fill: ${RED} !important; stroke: ${RED} !important; }
`;
        document.head.appendChild(styleEl);
        cleanupFns.push(() => {
            styleEl?.remove();
            styleEl = null;
        });
        log("ensureStyleSheet(): injected stylesheet");
    } catch (e) {
        err("ensureStyleSheet() failed:", e);
    }
}

function findMicButton(): HTMLButtonElement | null {
    try {
        // Reuse cached button if still in DOM
        if (micBtn && micBtn.isConnected) {
            return micBtn;
        }
        const el = document.querySelector(
            MIC_SELECTOR,
        ) as HTMLButtonElement | null;
        log("findMicButton()", { found: !!el });
        return el ?? null;
    } catch (e) {
        err("findMicButton() failed:", e);
        return null;
    }
}

// Cached lottie resolver that survives re-renders
function getLottieIcon(container: HTMLElement | null): HTMLElement | null {
    if (!container) return null;
    const cached = lottieCache.get(container);
    if (cached && cached.isConnected) return cached;
    const el = container.querySelector<HTMLElement>('[class*="lottieIcon"]');
    lottieCache.set(container, el ?? null);
    log("getLottieIcon()", { found: !!el });
    return el ?? null;
}

type UiState = "off" | "green" | "red";

function deriveUiState(): UiState {
    if (coughActive) return "red";
    if (bleepActive) return "green";
    return "off";
}

function applyUi(state: UiState) {
    try {
        ensureStyleSheet();

        const btn = micBtn && micBtn.isConnected ? micBtn : findMicButton();
        if (!btn) {
            warn("applyUi(): mic button not found");
            return;
        }

        // Skip if nothing changed (prevents redundant DOM writes)
        if (lastAppliedState === state && lastAppliedBtn === btn) {
            log("applyUi(): no-op", { state });
            micBtn = btn; // keep cache fresh anyway
            return;
        }

        // Clear both classes first, then add the one needed
        btn.classList.remove("goxlr-bleep", "goxlr-cough");

        const lottie = getLottieIcon(btn);

        if (state === "red") {
            btn.classList.add("goxlr-cough");
            if (lottie) {
                lottie.style.setProperty(
                    "--__lottieIconColor",
                    RED,
                    "important",
                );
                lottie.style.setProperty("color", RED, "important");
            }
        } else if (state === "green") {
            btn.classList.add("goxlr-bleep");
            if (lottie) {
                lottie.style.setProperty(
                    "--__lottieIconColor",
                    GREEN,
                    "important",
                );
                lottie.style.setProperty("color", GREEN, "important");
            }
        } else {
            if (lottie) {
                lottie.style.removeProperty("--__lottieIconColor");
                lottie.style.removeProperty("color");
            }
        }

        micBtn = btn;
        lastAppliedBtn = btn;
        lastAppliedState = state;

        log("applyUi()", { state });
    } catch (e) {
        err("applyUi() failed:", e);
    }
}

function refreshUi(reason: string) {
    const state = deriveUiState();
    log("refreshUi()", { reason, bleepActive, coughActive, state });
    applyUi(state);
}

// Debounced UI refresh helper to avoid excessive work
function scheduleUiRefresh(reason: string) {
    if (!running) return;
    pendingReason = reason;
    if (uiRefreshTimer != null) return;
    uiRefreshTimer = window.setTimeout(() => {
        uiRefreshTimer = null;
        const r = pendingReason ?? "scheduled";
        pendingReason = null;
        refreshUi(r);
    }, UI_REFRESH_MS);
}

// Remove all traces when disabling
function clearAllStyles() {
    try {
        // Remove classes from any existing mic buttons
        document.querySelectorAll(MIC_SELECTOR).forEach((btn) => {
            btn.classList.remove("goxlr-bleep", "goxlr-cough");
            const lottie = (btn as HTMLElement).querySelector<HTMLElement>(
                '[class*="lottieIcon"]',
            );
            if (lottie) {
                lottie.style.removeProperty("--__lottieIconColor");
                lottie.style.removeProperty("color");
            }
        });
        // Remove stylesheet
        if (styleEl) {
            styleEl.remove();
            styleEl = null;
        }

        // Reset cache state
        lastAppliedBtn = null;
        lastAppliedState = "off";
        micBtn = null;
        lottieCache.clear();

        log("clearAllStyles(): cleaned classes, inline vars, and stylesheet");
    } catch (e) {
        err("clearAllStyles() failed:", e);
    }
}

function attachMutationObserver() {
    try {
        if (mo) return;
        mo = new MutationObserver(() => {
            // Coalesced refresh after UI re-render if needed
            scheduleUiRefresh("mutation");
        });
        mo.observe(document.body, { childList: true, subtree: true });
        cleanupFns.push(() => {
            mo?.disconnect();
            mo = null;
        });
        log("attachMutationObserver(): attached");
    } catch (e) {
        err("attachMutationObserver() failed:", e);
    }
}

function parseJSON(data: any): any | null {
    if (data == null) return null;
    if (typeof data === "string") {
        try {
            return JSON.parse(data);
        } catch {
            warn("parseJSON(): non-JSON string");
            return null;
        }
    }
    if (data instanceof ArrayBuffer) {
        try {
            return JSON.parse(new TextDecoder().decode(data));
        } catch {
            warn("parseJSON(): non-JSON binary");
            return null;
        }
    }
    if (typeof data === "object") return data;
    return null;
}

// Process { data: { Patch: [{op,path,value}, ...] } } and update local button states
function processPatchForButtons(parsed: any): boolean {
    try {
        const data = parsed?.data;
        const patches = Array.isArray(data?.Patch) ? data.Patch : null;
        if (!patches) return false;

        let changed = false;

        for (const p of patches) {
            const op = p?.op;
            const path = p?.path as string;
            const value = p?.value;

            if (op !== "replace" || typeof path !== "string") continue;

            if (RE_BLEEP.test(path)) {
                if (typeof value === "boolean") {
                    if (bleepActive !== value) changed = true;
                    bleepActive = value;
                    log("processPatchForButtons(): Bleep match", {
                        path,
                        value,
                    });
                } else {
                    warn("processPatchForButtons(): Bleep non-boolean", {
                        value,
                    });
                }
            } else if (RE_COUGH.test(path)) {
                if (typeof value === "boolean") {
                    if (coughActive !== value) changed = true;
                    coughActive = value;
                    log("processPatchForButtons(): Cough match", {
                        path,
                        value,
                    });
                } else {
                    warn("processPatchForButtons(): Cough non-boolean", {
                        value,
                    });
                }
            }
        }

        return changed;
    } catch (e) {
        err("processPatchForButtons() failed:", e);
        return false;
    }
}

function onWsMessage(ev: MessageEvent) {
    try {
        const parsed = parseJSON(ev.data);
        log("WebSocket message received");
        if (!parsed) return;

        const changed = processPatchForButtons(parsed);
        if (changed) scheduleUiRefresh("ws-patch");
    } catch (e) {
        err("onWsMessage() failed:", e);
    }
}

function scheduleReconnect() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (!running) {
        reconnectTimer = null;
        return;
    }
    reconnectTimer = window.setTimeout(() => {
        log("Reconnect timer fired");
        openWs();
    }, RECONNECT_MS);
}

function openWs() {
    try {
        if (!running) return;
        closeWs();
        log("openWs(): connecting", { url: WS_URL });
        ws = new WebSocket(WS_URL);

        ws.addEventListener("open", () => {
            log("WebSocket open");
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            // If your Utility requires an initial request to stream state, send it here:
            // safeSend({ Request: "GetStatus" });
            // safeSend({ Request: "GetHttpState" });
            // safeSend("Ping");
        });
        ws.addEventListener("message", onWsMessage);
        ws.addEventListener("close", (ev) => {
            warn("WebSocket close", { code: ev.code, reason: ev.reason });
            scheduleReconnect();
        });
        ws.addEventListener("error", (e) => {
            err("WebSocket error", e);
            try {
                ws?.close();
            } catch {}
        });

        cleanupFns.push(() => {
            if (reconnectTimer) window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
        });
        cleanupFns.push(() => {
            if (uiRefreshTimer != null) {
                window.clearTimeout(uiRefreshTimer);
                uiRefreshTimer = null;
            }
        });
    } catch (e) {
        err("openWs() failed:", e);
        scheduleReconnect();
    }
}

function closeWs() {
    try {
        if (!ws) return;
        log("closeWs(): closing socket");
        ws.removeEventListener("message", onWsMessage);
        // We can't remove inline arrow listeners, but scheduleReconnect() is guarded by `running`
        ws.close();
        ws = null;
    } catch (e) {
        err("closeWs() failed:", e);
    }
}

function safeSend(payload: any) {
    try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            warn("safeSend(): WS not open", { readyState: ws?.readyState });
            return;
        }
        const toSend =
            typeof payload === "string" ? payload : JSON.stringify(payload);
        ws.send(toSend);
        log("safeSend(): sent");
    } catch (e) {
        err("safeSend() failed:", e);
    }
}

// DevTools helpers
(window as any).__goxlr = {
    setBleep: (v: boolean) => {
        bleepActive = v;
        scheduleUiRefresh("manual-bleep");
    },
    setCough: (v: boolean) => {
        coughActive = v;
        scheduleUiRefresh("manual-cough");
    },
    ping: () => safeSend("Ping"),
};

export default {
    name: "GoXLR Implementation",
    description: "Bleep and cough button indicator.",
    authors: [{ name: "Vermin", id: "1287307742805229608" }],
    start() {
        try {
            log("plugin.start()");
            running = true;
            ensureToasts();
            ensureStyleSheet();
            attachMutationObserver();
            // Clear any stale timers before starting
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (uiRefreshTimer != null) {
                window.clearTimeout(uiRefreshTimer);
                uiRefreshTimer = null;
            }
            refreshUi("start");
            openWs();
            toast("GoXLR Mic Color: Enabled", Toasts?.Type?.SUCCESS);
        } catch (e) {
            err("plugin.start() failed:", e);
        }
    },
    stop() {
        try {
            log("plugin.stop()");
            running = false;
            // Reset states first
            bleepActive = false;
            coughActive = false;
            // Remove all UI traces
            clearAllStyles();
            // Teardown runtime
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (uiRefreshTimer != null) {
                window.clearTimeout(uiRefreshTimer);
                uiRefreshTimer = null;
            }
            closeWs();
            if (mo) {
                mo.disconnect();
                mo = null;
            }
            for (const fn of cleanupFns.splice(0)) {
                try {
                    fn();
                } catch (e) {
                    err("cleanup failed:", e);
                }
            }
            micBtn = null;
            // Notify
            ensureToasts();
            toast("GoXLR Mic Color: Disabled", Toasts?.Type?.INFO);
        } catch (e) {
            err("plugin.stop() failed:", e);
        }
    },
};
