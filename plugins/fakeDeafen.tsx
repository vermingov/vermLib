/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy, findByPropsLazy } from "@webpack";
import {
    showToast,
    Toasts,
    React,
    FluxDispatcher,
    SelectedChannelStore,
    AuthenticationStore,
} from "@webpack/common";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");
const VoiceStateStore = findByPropsLazy(
    "getVoiceStatesForChannel",
    "getCurrentClientVoiceChannelId",
);

let faking = false;
let origWS: typeof WebSocket.prototype.send;

function log(text: string) {
    new Logger("FakeDeafen", "#7b4af7").info(text);
}

function enableFakeDeafen() {
    if (faking) return;
    faking = true;

    WebSocket.prototype.send = function (data) {
        const dataType = Object.prototype.toString.call(data);

        switch (dataType) {
            case "[object String]": {
                let obj: any;
                try {
                    obj = JSON.parse(data as string);
                } catch {
                    // Not JSON, forward
                    origWS.apply(this, [data]);
                    return;
                }

                if (obj?.d?.self_deaf === false) {
                    // Block undeafen packet
                    return;
                }
                break;
            }
            case "[object ArrayBuffer]": {
                const decoder = new TextDecoder("utf-8");
                const decoded = decoder.decode(data as ArrayBuffer);
                if (decoded.includes("self_deafs\x05false")) {
                    // Block undeafen packet
                    return;
                }
                break;
            }
        }

        // Pass data to original websocket
        origWS.apply(this, [data]);
    };

    // After enabling interception, force deafen+blocked-undeafen to enter fake mode
    try {
        const chanId = SelectedChannelStore.getVoiceChannelId?.();
        const dispatchToggle = () =>
            FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_DEAF" });

        if (!chanId) {
            showToast(
                "Fake deafen enabled (join a voice channel to activate)",
                Toasts.Type.SUCCESS,
            );
        } else {
            // Always perform deafen then blocked-undeafen to ensure server-deaf + local-hear
            dispatchToggle();
            setTimeout(dispatchToggle, 50);
            showToast("Fake deafen enabled", Toasts.Type.SUCCESS);
        }
    } catch {}
}

function disableFakeDeafen() {
    if (!faking) return;
    faking = false;

    WebSocket.prototype.send = origWS;

    try {
        const dispatchToggle = () =>
            FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_DEAF" });

        const myId = AuthenticationStore.getId?.();
        const isActuallyDeaf = () => {
            const vs = myId
                ? VoiceStateStore.getVoiceStateForUser?.(myId)
                : null;
            return !!(vs?.deaf || vs?.selfDeaf);
        };

        if (isActuallyDeaf()) {
            // Robust undeafen with multiple retries until state flips
            const delays = [0, 150, 300, 600, 1000];
            const tryUndeafen = (i: number) => {
                dispatchToggle();
                if (i >= delays.length - 1) return;
                setTimeout(
                    () => {
                        if (isActuallyDeaf()) {
                            tryUndeafen(i + 1);
                        }
                    },
                    delays[i + 1],
                );
            };
            tryUndeafen(0);
        } else {
            // Normalize to ensure final state ends undeafened
            dispatchToggle(); // deafen
            setTimeout(() => {
                dispatchToggle(); // undeafen
                setTimeout(() => {
                    if (isActuallyDeaf()) dispatchToggle();
                }, 250);
            }, 80);
        }

        showToast("Fake deafen disabled", Toasts.Type.SUCCESS);
    } catch {}
}

function makeHeadphonesIcon(active: boolean) {
    return function () {
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path
                    d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM17.06 2.94a.48.48 0 0 0-.11-.77A11 11 0 0 0 2.18 16.94c.14.3.53.35.76.12l3.2-3.2c.25-.25.15-.68-.2-.76a5 5 0 0 0-1.02-.1H3.05a9 9 0 0 1 12.66-9.2c.2.09.44.05.59-.1l.76-.76ZM20.2 8.28a.52.52 0 0 1 .1-.58l.76-.76a.48.48 0 0 1 .77.11 11 11 0 0 1-4.5 14.57c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86a9.1 9.1 0 0 0-.75-4.72ZM10.1 17.9c.25-.25.65-.18.74.14a3.1 3.1 0 0 1-.62 2.84 2.85 2.85 0 0 1-3.55.74.16.16 0 0 1-.04-.25l3.48-3.48Z"
                    fill={active ? "var(--brand-500)" : "currentColor"}
                />
            </svg>
        );
    };
}

function FakeDeafenToggleButton(props: { nameplate?: any }) {
    const [active, setActive] = React.useState(faking);

    return (
        <Button
            tooltipText={active ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={makeHeadphonesIcon(active)}
            role="switch"
            aria-checked={active}
            plated={props?.nameplate != null}
            onClick={() => {
                if (active) {
                    disableFakeDeafen();
                    setActive(false);
                } else {
                    enableFakeDeafen();
                    setActive(true);
                }
            }}
        />
    );
}

export { FakeDeafenToggleButton };
export default definePlugin({
    name: "FakeDeafen",
    description:
        "Adds a button next to the mic/deafen button to toggle fake deafen (you still hear others).",
    authors: [
        { name: "MisleadingName", id: 892072557988151347n },
        { name: "Exotic", id: 287667540178501634n },
    ],

    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.FakeDeafenToggleButton(arguments[0]),",
            },
        },
    ],

    FakeDeafenToggleButton: ErrorBoundary.wrap(FakeDeafenToggleButton, {
        noop: true,
    }),

    start() {
        origWS = WebSocket.prototype.send;
        log("Ready");
    },

    stop() {
        WebSocket.prototype.send = origWS;
        faking = false;
        log("Disarmed");
    },
});
