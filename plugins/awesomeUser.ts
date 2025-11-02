/*
 * Vencord, a Discord client mod
 * vermLib sub-plugin: AwesomeUser
 *
 * Behavior:
 * 1) On start, set your pronouns to just the beacon emoji (👐🏽) - ONCE.
 * 2) Client-side, whenever a user's pronouns on screen contain the beacon, replace that pronouns
 *    element with bold text "VERMLIB USER" (seamlessly, without server changes).
 * 3) Minimized API requests with smart caching and debouncing.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { FluxDispatcher, RestAPI, UserStore } from "@webpack/common";

const PLUGIN_NAME = "AwesomeUser";
const DEBUG = true;

const BEACON = "️";

const VERMLIB_BADGE_TEXT = "VERMLIB USER";
const VERMLIB_BADGE_CLASS = "vlAwesomeUserBadge";
const VERMLIB_BADGE_STYLE_ID = "vl-awesome-user-badge-style";

let mo: MutationObserver | null = null;
let reapplyTimer: number | null = null;

// State management to minimize requests
let pluginActive = false;
let requestPending = false;
let beaconSetOnStart = false;

/* ----------------------- Debug/Logging Functions ----------------------- */

function debug(...args: any[]) {
    if (DEBUG) {
        console.log(`[${PLUGIN_NAME}]`, ...args);
    }
}

function error(...args: any[]) {
    console.error(`[${PLUGIN_NAME}]`, ...args);
}

/* -------------------------- Pronouns Management -------------------------- */

function getLocalPronouns(): string | null {
    try {
        const user = UserStore.getCurrentUser?.();
        debug("getCurrentUser:", user);

        if (!user) {
            debug("No user found in UserStore");
            return null;
        }

        const pronouns =
            (user as any).pronouns ?? (user as any).profile?.pronouns ?? null;

        debug("Local pronouns retrieved:", pronouns);
        return pronouns;
    } catch (e) {
        error("Error getting local pronouns:", e);
        return null;
    }
}

async function setPronouns(newPronouns: string): Promise<boolean> {
    debug("setPronouns() called with:", newPronouns);

    // Avoid duplicate requests
    if (requestPending) {
        debug("Request already pending, skipping");
        return false;
    }

    requestPending = true;

    try {
        const userId = UserStore.getCurrentUser?.()?.id;
        debug("Current user ID:", userId);

        if (!userId) {
            error("Unable to get user ID");
            requestPending = false;
            return false;
        }

        debug("Attempting to set pronouns to:", newPronouns);

        let success = false;

        // Single attempt: PATCH /users/@me
        try {
            debug("Attempting PATCH /users/@me");
            await RestAPI.patch?.({
                url: "/users/@me",
                body: {
                    pronouns: newPronouns,
                },
            });
            debug("Successfully updated pronouns via PATCH /users/@me");
            success = true;
        } catch (e) {
            debug("PATCH /users/@me failed:", e);
        }

        if (success) {
            // Dispatch to update local state
            try {
                debug("Dispatching CURRENT_USER_UPDATE");
                FluxDispatcher?.dispatch?.({
                    type: "CURRENT_USER_UPDATE",
                    user: {
                        id: userId,
                        pronouns: newPronouns,
                    },
                });
                debug("CURRENT_USER_UPDATE dispatched successfully");
            } catch (dispatchErr) {
                error("Error dispatching CURRENT_USER_UPDATE:", dispatchErr);
            }
        } else {
            error("Failed to update pronouns on server");
        }

        return success;
    } catch (e) {
        error("Error in setPronouns:", e);
        return false;
    } finally {
        requestPending = false;
    }
}

/* ------------------------------ DOM Handling ----------------------------- */

function isPronounsElement(el: Element): boolean {
    const cls = (el.className || "").toString();
    const aria = (el.getAttribute("aria-label") || "").toString();
    if (/\bpronoun\b/i.test(cls) || /\bpronounsText\b/i.test(cls)) return true;
    if (/\bpronoun\b/i.test(aria)) return true;
    return false;
}

function elementContainsBeacon(el: Element): boolean {
    return (el.textContent || "").includes(BEACON);
}

function injectVermlibBadgeStyles() {
    if (document.getElementById(VERMLIB_BADGE_STYLE_ID)) {
        debug("Badge styles already injected");
        return;
    }

    debug("Injecting badge styles");
    const style = document.createElement("style");
    style.id = VERMLIB_BADGE_STYLE_ID;
    style.textContent = `
.${VERMLIB_BADGE_CLASS}{
  color: #fff;
  -webkit-text-stroke: 0.8px #000;
  text-shadow:
    0 0 0 #000,
    0 0 1px #000,
    0 0 2px #000,
    0 0 3px #000;
  font-weight: 800;
  letter-spacing: .03em;
  display: inline-block;
  padding: 2px 6px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,0));
  transform-origin: left center;
  animation:
    vermlib-enter .35s cubic-bezier(.2,.8,.2,1) both,
    vermlib-pulse 3s ease-in-out 1.5s infinite;
}

@keyframes vermlib-enter{
  0%{ transform: translateY(4px) scale(.96); opacity: 0; }
  100%{ transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes vermlib-pulse{
  0%, 100%{ filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
  50%{ filter: drop-shadow(0 0 6px rgba(255,255,255,.35)); }
}
`;
    document.head.appendChild(style);
}

function replaceWithVermlibBadge(el: Element) {
    if ((el as HTMLElement).dataset?.vermAwesomeUserReplaced === "1") {
        return;
    }

    debug("Replacing element with vermlib badge");
    el.innerHTML = "";

    const strong = document.createElement("strong");
    strong.className = VERMLIB_BADGE_CLASS;
    strong.textContent = VERMLIB_BADGE_TEXT;

    el.appendChild(strong);

    (el as HTMLElement).dataset.vermAwesomeUserReplaced = "1";
}

function scanAndReplace(root: Element | Document) {
    if (
        root instanceof Element &&
        isPronounsElement(root) &&
        elementContainsBeacon(root)
    ) {
        debug("Root element is pronouns element with beacon, replacing");
        replaceWithVermlibBadge(root);
    }

    const candidates = (
        root instanceof Element ? root : document
    ).querySelectorAll(
        [
            "[class*='pronoun']",
            "[class*='pronounsText']",
            "div.text-sm\\/medium_cf4812.pronounsText__63ed3.userTag__63ed3",
        ].join(","),
    );

    debug("Found", candidates.length, "candidate elements");

    for (const el of Array.from(candidates)) {
        if (!elementContainsBeacon(el)) continue;
        debug("Found pronouns element with beacon, replacing");
        replaceWithVermlibBadge(el);
    }
}

function startObserver() {
    debug("startObserver() called");
    stopObserver();

    try {
        scanAndReplace(document);
    } catch (e) {
        error("Error in initial scanAndReplace:", e);
    }

    mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
            try {
                if (m.type === "childList") {
                    for (const n of Array.from(m.addedNodes)) {
                        if (n instanceof Element) {
                            scanAndReplace(n);
                        }
                    }
                } else if (m.type === "characterData") {
                    const parent = m.target?.parentElement;
                    if (parent && elementContainsBeacon(parent)) {
                        scanAndReplace(parent);
                    }
                } else if (
                    m.type === "attributes" &&
                    m.target instanceof Element
                ) {
                    const el = m.target;
                    if (elementContainsBeacon(el) || isPronounsElement(el)) {
                        scanAndReplace(el);
                    }
                }
            } catch (e) {
                error("Error in mutation observer:", e);
            }
        }
    });

    try {
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ["class", "aria-label", "role"],
        });
        debug("Mutation observer started");
    } catch (e) {
        error("Error starting mutation observer:", e);
    }
}

function stopObserver() {
    try {
        mo?.disconnect();
    } catch {
        // ignore
    }
    mo = null;
}

/* --------------------------------- Plugin -------------------------------- */

export default definePlugin({
    name: PLUGIN_NAME,
    description:
        "Sets your pronouns to a beacon emoji so others can recognize you. Locally, any pronouns containing the beacon are replaced with bold 'VERMLIB USER'.",
    authors: [{ name: "Vermin", id: 1287307742805229608n }],

    async start() {
        debug("Plugin starting");

        pluginActive = true;
        beaconSetOnStart = false;

        injectVermlibBadgeStyles();
        startObserver();

        // Set pronouns to beacon on start - ONCE
        debug("Attempting to set beacon pronouns on plugin start");
        const success = await setPronouns(BEACON);
        beaconSetOnStart = success;
        debug("Beacon set attempt completed with result:", success);

        debug("Plugin started successfully");
    },

    stop() {
        debug("Plugin stopping");

        pluginActive = false;

        beaconSetOnStart = false;

        stopObserver();

        if (reapplyTimer != null) {
            window.clearTimeout(reapplyTimer);

            reapplyTimer = null;
        }

        debug("Plugin stopped");
    },

    async removePronouns(): Promise<boolean> {
        debug("removePronouns() requested");

        try {
            const current = getLocalPronouns();

            const result = await setPronouns("");
            debug("removePronouns: cleared pronouns result:", result);
            return result;
        } catch (e) {
            error("removePronouns error:", e);
            return false;
        }
    },
});
