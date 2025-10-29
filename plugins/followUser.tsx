/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelActionCreators,
    ChannelRouter,
    ChannelStore,
    FluxDispatcher,
    GuildChannelStore,
    GuildMemberStore,
    GuildStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    SelectedChannelStore,
    Toasts,
    UserStore,
} from "@webpack/common";

interface UserContextProps {
    user?: User;
    channel?: Channel;
    guildId?: string;
}

const ChannelActions = findByPropsLazy("selectVoiceChannel");

// Module-level settings that vermLib can control
export const settings = definePluginSettings({
    disconnectFollow: {
        type: OptionType.BOOLEAN,
        default: false,
        description:
            "When the followed user disconnects, also disconnect if you followed them into that VC",
    },
    preloadDelay: {
        type: OptionType.NUMBER,
        default: 300,
        description:
            "Delay in ms before attempting to join after preloading guild data",
    },
    enableDebugLogs: {
        type: OptionType.BOOLEAN,
        default: false,
        description:
            "Enable debug logging to console (helps troubleshoot joining issues)",
    },
});

// Direct settings variables controlled by vermLib
let disconnectFollow = false;
let preloadDelay = 300;
let enableDebugLogs = false;

let followedUserId: string | null = null;
let lastFollowedChannelId: string | null = null;
const preloadedGuilds = new Set<string>(); // Track which guilds we've already preloaded
let searchInterval: NodeJS.Timeout | null = null; // Interval for searching user in voice channels
let isSearching = false; // Track if we're currently searching

// Helper to safely get preload delay
function getPreloadDelay(): number {
    return preloadDelay;
}

// Debug logging helper
function debugLog(...args: any[]) {
    if (enableDebugLogs) {
        console.log("[FollowUser Debug]", ...args);
    }
}

function canViewChannel(channelId: string | null | undefined): boolean {
    if (!channelId) {
        debugLog("canViewChannel: No channelId provided");
        return false;
    }
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        debugLog(
            `canViewChannel: Channel ${channelId} not loaded yet, assuming viewable`,
        );
        return true; // Assume we can view if channel not loaded yet
    }
    try {
        // @ts-ignore - Channel has isPrivate on Discord types
        const isPrivate =
            typeof channel.isPrivate === "function"
                ? channel.isPrivate()
                : channel.isDM?.() || channel.isGroupDM?.();
        const canView = Boolean(
            isPrivate ||
                PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel),
        );
        debugLog(
            `canViewChannel: Channel ${channelId} (${channel.name || "DM"}), isPrivate=${isPrivate}, canView=${canView}`,
        );
        return canView;
    } catch (err) {
        debugLog(`canViewChannel: Error checking channel ${channelId}:`, err);
        return false;
    }
}

function canJoinChannel(channelId: string | null | undefined): boolean {
    if (!channelId) {
        debugLog("canJoinChannel: No channelId provided");
        return false;
    }
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        debugLog(`canJoinChannel: Channel ${channelId} not found in store`);
        return false;
    }
    try {
        // @ts-ignore - Channel has isPrivate on Discord types
        const isPrivate =
            typeof channel.isPrivate === "function"
                ? channel.isPrivate()
                : channel.isDM?.() || channel.isGroupDM?.();
        if (isPrivate) {
            debugLog(
                `canJoinChannel: Channel ${channelId} is private/DM, can join`,
            );
            return true;
        }
        const canView = PermissionStore.can(
            PermissionsBits.VIEW_CHANNEL,
            channel,
        );
        const canConnect = PermissionStore.can(
            PermissionsBits.CONNECT,
            channel,
        );
        debugLog(
            `canJoinChannel: Channel ${channelId} (${channel.name}), canView=${canView}, canConnect=${canConnect}, guildId=${channel.guild_id}`,
        );
        return Boolean(canView && canConnect);
    } catch (err) {
        debugLog(`canJoinChannel: Error checking channel ${channelId}:`, err);
        return false;
    }
}

async function preloadGuildData(channelId: string): Promise<void> {
    debugLog(`preloadGuildData: Starting preload for channel ${channelId}`);
    try {
        const channel = ChannelStore.getChannel(channelId);

        if (!channel) {
            debugLog(
                `preloadGuildData: Channel ${channelId} not in store, requesting summaries for all guilds`,
            );
            // Channel not loaded yet, request channel summaries for all guilds
            const guildIds =
                GuildStore.getGuildIds?.() ??
                Object.keys(GuildStore.getGuilds?.() ?? {});

            debugLog(
                `preloadGuildData: Found ${guildIds.length} guilds to request summaries for`,
            );
            for (const guildId of guildIds) {
                try {
                    FluxDispatcher.dispatch({
                        type: "REQUEST_CHANNEL_SUMMARIES",
                        guildId: guildId,
                    } as any);
                } catch (err) {
                    debugLog(
                        `preloadGuildData: Failed to request summaries for guild ${guildId}:`,
                        err,
                    );
                }
            }
            return;
        }

        const guildId = channel.guild_id;
        debugLog(
            `preloadGuildData: Channel found - name: ${channel.name || "DM"}, guildId: ${guildId || "none"}`,
        );

        if (guildId) {
            // Preload guild channel data using the same method as memberCount plugin
            try {
                const defaultChannel =
                    GuildChannelStore.getDefaultChannel?.(guildId);
                debugLog(
                    `preloadGuildData: Default channel for guild ${guildId}:`,
                    defaultChannel?.id,
                );

                if (defaultChannel?.id && ChannelActionCreators?.preload) {
                    debugLog(
                        `preloadGuildData: Calling ChannelActionCreators.preload(${guildId}, ${defaultChannel.id})`,
                    );
                    await ChannelActionCreators.preload(
                        guildId,
                        defaultChannel.id,
                    );
                    debugLog("preloadGuildData: Preload completed");
                } else {
                    debugLog(
                        `preloadGuildData: Cannot preload - defaultChannel=${!!defaultChannel}, preload=${!!ChannelActionCreators?.preload}`,
                    );
                }
            } catch (err) {
                debugLog("preloadGuildData: Error during preload:", err);
            }

            // Also request channel summaries to load voice state
            try {
                debugLog(
                    `preloadGuildData: Requesting channel summaries for guild ${guildId}`,
                );
                FluxDispatcher.dispatch({
                    type: "REQUEST_CHANNEL_SUMMARIES",
                    guildId: guildId,
                } as any);
            } catch (err) {
                debugLog("preloadGuildData: Error requesting summaries:", err);
            }
        }
    } catch (error) {
        debugLog("preloadGuildData: Fatal error:", error);
        console.error("[FollowUser] Failed to preload guild data:", error);
    }
}

function stopSearching() {
    debugLog("stopSearching: Stopping search for user in voice channels");
    if (searchInterval) {
        clearInterval(searchInterval);
        searchInterval = null;
    }
    isSearching = false;
}

function checkUserInVoiceChannel(userId: string): string | null {
    debugLog(
        `checkUserInVoiceChannel: Checking if user ${userId} is in a voice channel`,
    );
    const currentState =
        Vencord.Webpack.Common.VoiceStateStore.getVoiceStateForUser(userId);
    const currentChannelId = currentState?.channelId;

    if (currentChannelId) {
        debugLog(
            `checkUserInVoiceChannel: User found in channel ${currentChannelId}`,
        );
        return currentChannelId;
    }

    debugLog("checkUserInVoiceChannel: User not in any voice channel");
    return null;
}

function startSearching(userId: string, username: string) {
    debugLog(
        `startSearching: Starting to search for user ${username} (${userId})`,
    );

    // Stop any existing search
    stopSearching();

    // Show toast notification
    Toasts.show(
        Toasts.create(
            `Searching for ${username} in voice channels...`,
            Toasts.Type.MESSAGE,
            { duration: Infinity },
        ),
    );
    isSearching = true;

    // Check every 2 seconds
    searchInterval = setInterval(() => {
        if (!followedUserId || followedUserId !== userId) {
            debugLog("startSearching: User unfollowed, stopping search");
            stopSearching();
            return;
        }

        const channelId = checkUserInVoiceChannel(userId);
        if (channelId && channelId !== lastFollowedChannelId) {
            debugLog(
                `startSearching: Found user in channel ${channelId}, following`,
            );
            stopSearching();

            // Show success toast
            Toasts.show(
                Toasts.create(
                    `Successfully followed ${username}!`,
                    Toasts.Type.SUCCESS,
                    { duration: 2000 },
                ),
            );

            joinVoiceChannel(channelId);
        }
    }, 2000);
}

async function preloadMutualGuilds(userId: string): Promise<void> {
    debugLog(
        `preloadMutualGuilds: Starting preload for mutual guilds with user ${userId}`,
    );
    try {
        // Use REST API to get accurate mutual guilds list
        let mutualGuildIds: string[] = [];

        try {
            debugLog(
                `preloadMutualGuilds: Fetching mutual guilds via REST API for user ${userId}`,
            );
            const response = await RestAPI.get({
                url: `/users/${userId}/profile`,
                query: {
                    with_mutual_guilds: true,
                },
            });

            if (response.body?.mutual_guilds) {
                mutualGuildIds = response.body.mutual_guilds.map(
                    (g: any) => g.id,
                );
                debugLog(
                    `preloadMutualGuilds: REST API returned ${mutualGuildIds.length} mutual guilds`,
                );
            } else {
                debugLog(
                    "preloadMutualGuilds: No mutual_guilds in REST API response, falling back to local detection",
                );
            }
        } catch (err) {
            debugLog(
                "preloadMutualGuilds: REST API failed, falling back to local detection:",
                err,
            );
        }

        // Fallback: Use local detection if REST API fails
        if (mutualGuildIds.length === 0) {
            const allGuildIds =
                GuildStore.getGuildIds?.() ??
                Object.keys(GuildStore.getGuilds?.() ?? {});

            const { VoiceStateStore } = Vencord.Webpack.Common;

            for (const guildId of allGuildIds) {
                const guild = GuildStore.getGuild(guildId);
                if (!guild) continue;

                let isMutual = false;

                // Method 1: Check GuildMemberStore
                try {
                    const member = GuildMemberStore.getMember(guildId, userId);
                    if (member) {
                        isMutual = true;
                    }
                } catch {}

                // Method 2: Check if user has any voice state in this guild
                if (!isMutual) {
                    try {
                        const voiceStates =
                            VoiceStateStore.getVoiceStates(guildId);
                        if (voiceStates && voiceStates[userId]) {
                            isMutual = true;
                        }
                    } catch {}
                }

                if (isMutual) {
                    mutualGuildIds.push(guildId);
                }
            }

            debugLog(
                `preloadMutualGuilds: Local detection found ${mutualGuildIds.length} mutual guilds`,
            );
        }

        for (const guildId of mutualGuildIds) {
            // Skip if already preloaded
            if (preloadedGuilds.has(guildId)) {
                debugLog(
                    `preloadMutualGuilds: Skipping already preloaded guild ${guildId}`,
                );
                continue;
            }

            try {
                const defaultChannel =
                    GuildChannelStore.getDefaultChannel?.(guildId);

                if (defaultChannel?.id && ChannelActionCreators?.preload) {
                    debugLog(
                        `preloadMutualGuilds: Preloading guild ${guildId} via channel ${defaultChannel.id}`,
                    );
                    await ChannelActionCreators.preload(
                        guildId,
                        defaultChannel.id,
                    );

                    // Mark as preloaded
                    preloadedGuilds.add(guildId);

                    // Add 100ms delay between preloads to avoid rate limiting
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                // Request channel summaries
                FluxDispatcher.dispatch({
                    type: "REQUEST_CHANNEL_SUMMARIES",
                    guildId: guildId,
                } as any);
            } catch (err) {
                debugLog(
                    `preloadMutualGuilds: Error preloading guild ${guildId}:`,
                    err,
                );
            }
        }

        debugLog("preloadMutualGuilds: Completed preloading mutual guilds");
    } catch (error) {
        debugLog("preloadMutualGuilds: Fatal error:", error);
        console.error("[FollowUser] Failed to preload mutual guilds:", error);
    }
}

function joinVoiceChannel(channelId: string) {
    console.log(
        `[FollowUser] joinVoiceChannel called for ${channelId}, debug=${enableDebugLogs}`,
    );
    debugLog(`joinVoiceChannel: Attempting to join channel ${channelId}`);
    lastFollowedChannelId = channelId;

    // First, preload the guild data to ensure channel info is loaded
    preloadGuildData(channelId)
        .then(() => {
            debugLog(
                `joinVoiceChannel: Preload completed, waiting ${getPreloadDelay()}ms before navigation`,
            );
            // Small delay to let the preload complete
            setTimeout(() => {
                // Now try to navigate to the channel first
                if (canViewChannel(channelId)) {
                    try {
                        debugLog(
                            `joinVoiceChannel: Navigating to channel ${channelId}`,
                        );
                        ChannelRouter.transitionToChannel(channelId);
                    } catch (err) {
                        debugLog("joinVoiceChannel: Navigation error:", err);
                    }
                } else {
                    debugLog(
                        `joinVoiceChannel: Cannot view channel ${channelId}, skipping navigation`,
                    );
                }

                // Wait a bit more for navigation to complete, then join if we can
                setTimeout(() => {
                    if (canJoinChannel(channelId)) {
                        debugLog(
                            `joinVoiceChannel: Joining voice channel ${channelId}`,
                        );
                        ChannelActions.selectVoiceChannel(channelId);
                    } else {
                        debugLog(
                            `joinVoiceChannel: Cannot join channel ${channelId} - missing permissions or channel not loaded`,
                        );
                    }
                }, 100);
            }, getPreloadDelay());
        })
        .catch((err: any) => {
            debugLog(
                "joinVoiceChannel: Preload error, attempting fallback:",
                err,
            );
            console.error("[FollowUser] Error in joinVoiceChannel:", err);
            // Fallback: try to join anyway
            setTimeout(() => {
                if (canViewChannel(channelId)) {
                    try {
                        debugLog(
                            `joinVoiceChannel: [Fallback] Navigating to channel ${channelId}`,
                        );
                        ChannelRouter.transitionToChannel(channelId);
                    } catch (navErr) {
                        debugLog(
                            "joinVoiceChannel: [Fallback] Navigation error:",
                            navErr,
                        );
                    }
                }
                setTimeout(() => {
                    if (canJoinChannel(channelId)) {
                        debugLog(
                            `joinVoiceChannel: [Fallback] Joining voice channel ${channelId}`,
                        );
                        ChannelActions.selectVoiceChannel(channelId);
                    } else {
                        debugLog(
                            `joinVoiceChannel: [Fallback] Cannot join channel ${channelId}`,
                        );
                    }
                }, 100);
            }, getPreloadDelay());
        });
}

const userContextPatch: NavContextMenuPatchCallback = (
    children,
    { user }: UserContextProps,
) => {
    if (!user) return;
    if (user.id === UserStore.getCurrentUser().id) return;

    const [checked, setChecked] = React.useState(followedUserId === user.id);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="follow-user"
            label="Follow user"
            checked={checked}
            action={() => {
                if (followedUserId === user.id) {
                    followedUserId = null;
                    lastFollowedChannelId = null;
                    setChecked(false);
                    return;
                }
                followedUserId = user.id;
                lastFollowedChannelId = null;
                setChecked(true);

                console.log(
                    `[FollowUser] Following user ${user.username} (${user.id}), debug=${enableDebugLogs}`,
                );
                debugLog(
                    `User context: Following user ${user.username} (${user.id})`,
                );

                // Preload mutual guilds when starting to follow
                debugLog("User context: Preloading mutual guilds on follow");
                preloadMutualGuilds(user.id).catch((err) => {
                    debugLog(
                        "User context: Error preloading mutual guilds:",
                        err,
                    );
                });

                // Check if the user is already in a VC
                const state =
                    Vencord.Webpack.Common.VoiceStateStore.getVoiceStateForUser(
                        user.id,
                    );
                const chanId = state?.channelId;
                console.log(
                    `[FollowUser] User is in channel ${chanId || "none"}`,
                );
                debugLog(
                    `User context: User is in channel ${chanId || "none"}`,
                );

                if (chanId) {
                    // User is already in a channel, follow immediately
                    joinVoiceChannel(chanId);
                    Toasts.show(
                        Toasts.create(
                            `Successfully followed ${user.username}!`,
                            Toasts.Type.SUCCESS,
                            { duration: 2000 },
                        ),
                    );
                } else {
                    // User is not in a channel, start searching
                    startSearching(user.id, user.username);
                }
            }}
        />,
    );
};

export default definePlugin({
    name: "FollowUser",
    description:
        "Right-click a user to follow their voice channel; automatically preloads guild data for seamless joining.",
    authors: [{ name: "Vermin", id: 1287307742805229608n }],
    settings,
    // Export function for vermLib to update settings
    updateSettings(newSettings: {
        disconnectFollow?: boolean;
        preloadDelay?: number;
        enableDebugLogs?: boolean;
    }) {
        if (newSettings.disconnectFollow !== undefined)
            disconnectFollow = newSettings.disconnectFollow;
        if (newSettings.preloadDelay !== undefined)
            preloadDelay = newSettings.preloadDelay;
        if (newSettings.enableDebugLogs !== undefined)
            enableDebugLogs = newSettings.enableDebugLogs;
        console.log("[FollowUser] Settings updated:", {
            disconnectFollow,
            preloadDelay,
            enableDebugLogs,
        });
    },
    start() {
        followedUserId = null;
        lastFollowedChannelId = null;
        preloadedGuilds.clear(); // Clear preloaded guilds on start
        stopSearching(); // Stop any search on start
        console.log("[FollowUser] Plugin started");
    },
    stop() {
        followedUserId = null;
        lastFollowedChannelId = null;
        preloadedGuilds.clear(); // Clear preloaded guilds on stop
        stopSearching(); // Stop any search on stop
    },
    flux: {
        VOICE_STATE_UPDATES(payload: any) {
            if (!followedUserId) return;
            const updates = payload?.voiceStates ?? payload?.voice_states ?? [];
            if (!Array.isArray(updates)) return;

            for (const vs of updates) {
                const userId = vs?.userId ?? vs?.user_id;
                if (userId !== followedUserId) continue;

                const newChannelId: string | null | undefined = vs?.channelId;
                console.log(
                    `[FollowUser] VOICE_STATE_UPDATES: Followed user moved to ${newChannelId || "disconnected"}, debug=${enableDebugLogs}`,
                );
                debugLog(
                    `VOICE_STATE_UPDATES: Followed user moved to channel ${newChannelId || "disconnected"}`,
                );

                if (newChannelId) {
                    if (newChannelId !== lastFollowedChannelId) {
                        debugLog(
                            "VOICE_STATE_UPDATES: New channel detected, attempting to follow",
                        );

                        // Stop searching since we found them
                        stopSearching();

                        joinVoiceChannel(newChannelId);

                        // Get username for toast
                        const user = UserStore.getUser(followedUserId);
                        const username = user?.username || "user";
                        Toasts.show(
                            Toasts.create(
                                `Successfully followed ${username}!`,
                                Toasts.Type.SUCCESS,
                                { duration: 2000 },
                            ),
                        );
                    } else {
                        debugLog(
                            "VOICE_STATE_UPDATES: Already in/following channel " +
                                newChannelId,
                        );
                    }
                } else {
                    debugLog("VOICE_STATE_UPDATES: Followed user left VC");

                    // User left VC, start searching for them
                    const user = UserStore.getUser(followedUserId);
                    const username = user?.username || "user";
                    startSearching(followedUserId, username);

                    // Followed user left VC
                    if (!disconnectFollow) {
                        debugLog(
                            "VOICE_STATE_UPDATES: disconnectFollow is disabled, staying in channel",
                        );
                        return;
                    }
                    const myChanId = SelectedChannelStore.getVoiceChannelId?.();
                    debugLog(
                        `VOICE_STATE_UPDATES: My current channel: ${myChanId || "none"}, last followed: ${lastFollowedChannelId || "none"}`,
                    );
                    if (myChanId && myChanId === lastFollowedChannelId) {
                        debugLog(
                            `VOICE_STATE_UPDATES: Disconnecting from ${myChanId}`,
                        );
                        ChannelActions.selectVoiceChannel(null);
                        lastFollowedChannelId = null;
                    }
                }
            }
        },
    },
    contextMenus: {
        "user-context": userContextPatch,
    },
});
