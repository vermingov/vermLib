// src/userplugins/hideMicNotice/index.ts
import definePlugin from "@utils/types";

let observer: MutationObserver | null = null;

// Track elements we hide so we can restore them safely
const hiddenNodes = new Set<HTMLElement>();
const HIDDEN_ATTR = "data-hidden-by-hideMicErrorNotice";

function isMicNoticeContainer(el: HTMLElement): boolean {
    const txt = (el.textContent || "").trim();
    const hasClose = !!el.querySelector('[aria-label="Dismiss"]');
    const hasVisit = /Visit Settings/i.test(txt);
    const hasError =
        /Error:\s*3002/i.test(txt) ||
        /not detecting any input from your mic/i.test(txt);
    const classStr = el.className || "";
    const hasNoticeClass = /(?:^|\s)(notice|colorDanger)(?:__|--|\b)/i.test(
        classStr,
    );
    return hasNoticeClass || (hasClose && hasVisit) || hasError;
}

function hideBannerElement(el: HTMLElement) {
    if (hiddenNodes.has(el)) return;
    const prev = el.style.display;
    el.setAttribute(HIDDEN_ATTR, prev ? prev : "__EMPTY__");
    el.style.display = "none";
    hiddenNodes.add(el);
}

function queryMicNotices(): HTMLElement[] {
    const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
            '[class*="notice__"], [class*="colorDanger__"]',
        ),
    );
    return candidates.filter(isMicNoticeContainer);
}

function hideMicBannersOnce() {
    for (const el of queryMicNotices()) {
        hideBannerElement(el);
    }
}

function hideContainer(node: Element) {
    if (node instanceof HTMLElement && isMicNoticeContainer(node)) {
        hideBannerElement(node);
    }
}

function scanNode(_node: Node) {
    hideMicBannersOnce();
}

function scanInitial() {
    hideMicBannersOnce();
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
        hideMicBannersOnce();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
    scanInitial();
}

function stopObserver() {
    observer?.disconnect();
    observer = null;

    // Restore any elements we hid
    for (const el of hiddenNodes) {
        const prev = el.getAttribute(HIDDEN_ATTR);
        if (prev === "__EMPTY__") {
            el.style.display = "";
        } else if (prev != null) {
            el.style.display = prev;
        } else {
            el.style.display = "";
        }
        el.removeAttribute(HIDDEN_ATTR);
    }
    hiddenNodes.clear();
}

export default definePlugin({
    name: "HideMicErrorNotice",
    description:
        "Hide Discord's mic input warning banner (Error 3002) automatically.",
    authors: [{ name: "LocalUser", id: 0n }],
    start() {
        startObserver();
    },
    stop() {
        stopObserver();
    },
});
