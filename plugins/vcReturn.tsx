/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Note: vermLib hub is now in index.tsx to support JSX dashboard UI.
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    AuthenticationStore,
    ChannelStore,
    SelectedChannelStore,
    showToast,
    Toasts,
} from "@webpack/common";

const STORAGE_KEY = "vcReturn:lastVoiceChannelId";

// Discord voice channel types
const CHANNEL_TYPE_GUILD_VOICE = 2;
const CHANNEL_TYPE_GUILD_STAGE_VOICE = 13;

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(channelId: string): void;
};

function isVoiceLikeChannel(id: string | undefined | null) {
    if (!id) return false;
    const ch = ChannelStore.getChannel?.(id);
    if (!ch) return false;
    return (
        ch.type === CHANNEL_TYPE_GUILD_VOICE ||
        ch.type === CHANNEL_TYPE_GUILD_STAGE_VOICE
    );
}

function saveLastChannel(id: string | undefined | null) {
    if (!id) return;
    if (!isVoiceLikeChannel(id)) return;
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* noop */
    }
}

function clearLastChannel() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* noop */
    }
}

function getLastChannel(): string | null {
    try {
        const id = localStorage.getItem(STORAGE_KEY);
        return id && isVoiceLikeChannel(id) ? id : null;
    } catch {
        return null;
    }
}

async function reconnectIfNeeded() {
    try {
        // If already in a voice channel, do nothing
        const current = SelectedChannelStore.getVoiceChannelId?.();
        if (current && isVoiceLikeChannel(current)) {
            // Keep latest as current
            saveLastChannel(current);
            return;
        }

        const last = getLastChannel();
        if (!last) return;

        // Delay a bit to give stores time to populate on cold start
        // Try a few times in case the channel isn't available yet
        const delays = [500, 1000, 1500];
        for (let i = 0; i < delays.length; i++) {
            await new Promise((r) => setTimeout(r, delays[i]));

            // Abort if user joined somewhere meanwhile
            const now = SelectedChannelStore.getVoiceChannelId?.();
            if (now && isVoiceLikeChannel(now)) return;

            if (isVoiceLikeChannel(last)) {
                try {
                    VoiceActions.selectVoiceChannel(last);
                    showToast(
                        "Reconnected to your previous voice channel",
                        Toasts.Type.SUCCESS,
                    );
                    return;
                } catch {
                    // Keep trying with next delay
                }
            }
        }
    } catch {
        // swallow
    }
}

export default definePlugin({
    name: "VCReturn",
    description:
        "Auto-clicks Discord's Reconnect button on startup to rejoin the last voice channel.",
    authors: [{ name: "yourbuddy", id: 0n }],

    // Track last known voice channel for the current user and store/clear appropriately
    flux: {
        VOICE_STATE_UPDATES({
            voiceStates,
        }: {
            voiceStates: Array<{
                userId: string;
                channelId?: string | null;
                oldChannelId?: string | null;
            }>;
        }) {
            try {
                const me = AuthenticationStore.getId?.();
                if (!me || !Array.isArray(voiceStates)) return;

                for (const vs of voiceStates) {
                    if (vs.userId !== me) continue;

                    // If we moved or joined a voice channel, save it
                    if (vs.channelId) {
                        saveLastChannel(vs.channelId);
                    }

                    // If we left voice (channelId is null/undefined), clear stored channel
                    // so we won't auto-join next time
                    if (!vs.channelId && (vs.oldChannelId ?? null) != null) {
                        clearLastChannel();
                    }
                }
            } catch {
                // swallow
            }
        },
    },

    async start() {
        setTimeout(() => {
            try {
                const btn = document.querySelector("button.button__6e2b9");
                if (btn instanceof HTMLButtonElement) {
                    btn.click();
                } else {
                    // Try again after another second if not found
                    setTimeout(() => {
                        try {
                            const btn2 = document.querySelector(
                                "button.button__6e2b9",
                            );
                            if (btn2 instanceof HTMLButtonElement) {
                                btn2.click();
                            }
                        } catch {}
                    }, 1000);
                }
            } catch {}
        }, 1000);
    },

    stop() {
        // Nothing to clean up
    },
});
