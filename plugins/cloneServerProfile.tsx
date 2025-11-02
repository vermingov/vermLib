/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";

import definePlugin from "@utils/types";

import type { User } from "@vencord/discord-types";

import {
    Menu as CtxMenu,
    React,
    RestAPI,
    Toasts,
    UserStore,
    showToast,
} from "@webpack/common";

type UserContextProps = {
    user?: User;
    guildId?: string;
    // channel?: Channel; // not required here
};

type GuildMemberProfile = {
    nick?: string | null;
    avatar?: string | null; // guild avatar hash
    banner?: string | null; // guild banner hash
};

type FetchedProfile = {
    user?: any;
    guild_member?: GuildMemberProfile;
};

function extFromHash(hash?: string | null) {
    if (!hash) return "png";
    return hash.startsWith("a_") ? "gif" : "png";
}

function guildAvatarCdnUrl(
    guildId: string,
    userId: string,
    avatarHash: string,
) {
    const ext = extFromHash(avatarHash);
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=4096`;
}

function guildBannerCdnUrl(
    guildId: string,
    userId: string,
    bannerHash: string,
) {
    const ext = extFromHash(bannerHash);
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/banners/${bannerHash}.${ext}?size=4096`;
}

async function fetchAsDataUri(url: string): Promise<string> {
    const res = await fetch(url, { credentials: "include" as any });
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result as string);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
    return dataUrl;
}

async function getTargetGuildProfile(targetUserId: string, guildId: string) {
    // This client API is used by Discord to render profiles in guild context.
    // Example: GET /users/{userId}/profile?guild_id={guildId}&with_mutual_guilds=false
    console.log("[CloneServerProfile] Fetching target profile", {
        targetUserId,
        guildId,
    });
    const res: any = await RestAPI.get?.({
        url: `/users/${targetUserId}/profile?guild_id=${guildId}&with_mutual_guilds=false`,
    });
    console.log("[CloneServerProfile] Fetched profile", {
        hasGuildMember: !!res?.guild_member,
    });
    return res as FetchedProfile;
}

async function setMyNick(guildId: string, nick: string | null | undefined) {
    // PATCH /guilds/{guildId}/members/@me
    await RestAPI.patch?.({
        url: `/guilds/${guildId}/members/@me`,
        body: { nick: nick ?? "" },
    });
}

async function setMyGuildProfileMedia(
    guildId: string,
    avatarDataUrl?: string | null,
    bannerDataUrl?: string | null,
) {
    // PATCH /users/@me/guilds/{guildId}/profile
    // Only send fields we intend to modify to avoid resetting unrelated values.
    const body: Record<string, unknown> = {};
    if (avatarDataUrl !== undefined) body.avatar = avatarDataUrl;
    if (bannerDataUrl !== undefined) body.banner = bannerDataUrl;

    if (Object.keys(body).length === 0) {
        console.log(
            "[CloneServerProfile] Nothing to update for guild profile media",
            { guildId },
        );
        return;
    } // nothing to change

    console.log("[CloneServerProfile] Setting nickname", { guildId, nick });
    await RestAPI.patch?.({
        url: `/users/@me/guilds/${guildId}/profile`,

        body,
    });
}

function getGuildIdFromLocation(): string | null {
    try {
        const parts = location.pathname.split("/");
        if (parts[1] === "channels" && parts[2] && parts[2] !== "@me") {
            return parts[2];
        }
    } catch {}
    return null;
}

const userContextPatch: NavContextMenuPatchCallback = (
    children,
    { user, guildId }: UserContextProps,
) => {
    const me = UserStore.getCurrentUser();
    const effectiveGuildId = guildId ?? getGuildIdFromLocation();
    const disabled = !user || !effectiveGuildId || (me && user?.id === me.id);
    console.log("[CloneServerProfile] Context", {
        targetUserId: user?.id,
        effectiveGuildId,
        disabled,
    });

    children.push(
        <CtxMenu.MenuSeparator />,
        <CtxMenu.MenuItem
            id="verm-clone-server-profile"
            label="Clone Server Profile"
            disabled={!!disabled}
            action={async () => {
                if (!user || !effectiveGuildId) {
                    showToast(
                        "No guild context available.",

                        Toasts.Type.FAILURE,
                    );

                    return;
                }

                if (me && user.id === me.id) return;

                showToast("Cloning server profile...", Toasts.Type.MESSAGE);
                console.log("[CloneServerProfile] Begin cloning", {
                    targetUserId: user.id,
                    username: user.username,
                    effectiveGuildId,
                });

                let clonedNick = false;
                let clonedAvatar = false;
                let clonedBanner = false;

                try {
                    // 1) Fetch target's server profile
                    const target = await getTargetGuildProfile(
                        user.id,
                        effectiveGuildId,
                    );
                    const gm = target?.guild_member;

                    const targetNick = gm?.nick ?? null;
                    const targetAvatarHash = gm?.avatar ?? null;
                    const targetBannerHash = gm?.banner ?? null;
                    console.log(
                        "[CloneServerProfile] Target guild profile values",
                        { targetNick, targetAvatarHash, targetBannerHash },
                    );

                    // 2) Attempt to clone nickname (best-effort)
                    if (targetNick != null) {
                        try {
                            console.log(
                                "[CloneServerProfile] Attempting to set nickname",
                                { effectiveGuildId, targetNick },
                            );
                            await setMyNick(effectiveGuildId, targetNick);
                            console.log("[CloneServerProfile] Nickname set");
                            clonedNick = true;
                        } catch (err) {
                            console.warn(
                                "[CloneServerProfile] Failed to set nickname",
                                { effectiveGuildId, targetNick, err },
                            );
                            // ignore, show granular result after
                        }
                    }

                    // 3) Attempt to clone server avatar/banner if present
                    let avatarDataUrl: string | null | undefined = undefined;
                    let bannerDataUrl: string | null | undefined = undefined;

                    // If target has a server avatar, fetch and convert to data URI
                    if (targetAvatarHash) {
                        try {
                            console.log(
                                "[CloneServerProfile] Building avatar CDN URL",
                                {
                                    effectiveGuildId,
                                    targetUserId: user.id,
                                    targetAvatarHash,
                                },
                            );
                            const url = guildAvatarCdnUrl(
                                effectiveGuildId,
                                user.id,
                                targetAvatarHash,
                            );
                            console.log(
                                "[CloneServerProfile] Fetching avatar CDN",
                                { url },
                            );
                            avatarDataUrl = await fetchAsDataUri(url);
                            console.log(
                                "[CloneServerProfile] Avatar fetched as data URI",
                            );
                        } catch (err) {
                            // failed to fetch avatar; skip
                            avatarDataUrl = undefined;
                            console.warn(
                                "[CloneServerProfile] Failed to fetch avatar CDN",
                                { url, err },
                            );
                        }
                    } else {
                        console.log(
                            "[CloneServerProfile] Target has no server avatar",
                        );
                        avatarDataUrl = undefined; // don't touch if they don't have one set
                    }

                    // If target has a server banner, fetch and convert to data URI
                    if (targetBannerHash) {
                        try {
                            console.log(
                                "[CloneServerProfile] Building banner CDN URL",
                                {
                                    effectiveGuildId,
                                    targetUserId: user.id,
                                    targetBannerHash,
                                },
                            );
                            const url = guildBannerCdnUrl(
                                effectiveGuildId,
                                user.id,
                                targetBannerHash,
                            );
                            console.log(
                                "[CloneServerProfile] Fetching banner CDN",
                                { url },
                            );
                            bannerDataUrl = await fetchAsDataUri(url);
                            console.log(
                                "[CloneServerProfile] Banner fetched as data URI",
                            );
                        } catch (err) {
                            // failed to fetch banner; skip
                            bannerDataUrl = undefined;
                            console.warn(
                                "[CloneServerProfile] Failed to fetch banner CDN",
                                { url, err },
                            );
                        }
                    } else {
                        console.log(
                            "[CloneServerProfile] Target has no server banner",
                        );
                        bannerDataUrl = undefined; // don't touch if they don't have one set
                    }

                    // Only attempt PATCH if we have something to set
                    if (
                        avatarDataUrl !== undefined ||
                        bannerDataUrl !== undefined
                    ) {
                        try {
                            console.log(
                                "[CloneServerProfile] Attempting to set guild profile media",
                                {
                                    effectiveGuildId,
                                    hasAvatar: avatarDataUrl != null,
                                    hasBanner: bannerDataUrl != null,
                                },
                            );
                            await setMyGuildProfileMedia(
                                effectiveGuildId,
                                avatarDataUrl,

                                bannerDataUrl,
                            );

                            clonedAvatar = avatarDataUrl != null;
                            clonedBanner = bannerDataUrl != null;
                            console.log(
                                "[CloneServerProfile] Guild profile media set (both)",
                                { clonedAvatar, clonedBanner },
                            );
                        } catch (err) {
                            console.warn(
                                "[CloneServerProfile] Failed to set both media, attempting partial",
                                { err },
                            );
                            // If setting both failed, try each individually so partial success is possible
                            if (avatarDataUrl !== undefined) {
                                try {
                                    console.log(
                                        "[CloneServerProfile] Attempting avatar-only guild media set",
                                    );
                                    await setMyGuildProfileMedia(
                                        effectiveGuildId,
                                        avatarDataUrl,
                                        undefined,
                                    );

                                    clonedAvatar = avatarDataUrl != null;
                                    console.log(
                                        "[CloneServerProfile] Avatar-only guild media set",
                                        { clonedAvatar },
                                    );
                                } catch {
                                    /* ignore */
                                }
                            }
                            if (bannerDataUrl !== undefined) {
                                try {
                                    console.log(
                                        "[CloneServerProfile] Attempting banner-only guild media set",
                                    );
                                    await setMyGuildProfileMedia(
                                        effectiveGuildId,
                                        undefined,
                                        bannerDataUrl,
                                    );

                                    clonedBanner = bannerDataUrl != null;
                                    console.log(
                                        "[CloneServerProfile] Banner-only guild media set",
                                        { clonedBanner },
                                    );
                                } catch {
                                    /* ignore */
                                }
                            }
                        }
                    }

                    // 4) Summarize result
                    const parts: string[] = [];
                    if (clonedNick) parts.push("nickname");
                    if (clonedAvatar) parts.push("server avatar");
                    if (clonedBanner) parts.push("server banner");
                    console.log("[CloneServerProfile] Clone summary parts", {
                        parts,
                    });

                    if (parts.length > 0) {
                        showToast(
                            `Cloned ${parts.join(", ")} from ${user.username}.`,
                            Toasts.Type.SUCCESS,
                        );
                    } else {
                        showToast(
                            "Nothing could be cloned (permissions or Nitro may be required).",
                            Toasts.Type.FAILURE,
                        );
                    }
                } catch (err) {
                    showToast(
                        "Failed to clone server profile.",
                        Toasts.Type.FAILURE,
                    );
                    console.error("[CloneServerProfile] Error:", err);
                }
            }}
        />,
    );
};

export default definePlugin({
    name: "CloneServerProfile",
    description:
        "Right-click a member to clone their server profile (nickname, server avatar, server banner) onto yours in the current guild.",
    authors: [{ name: "Vermin", id: 1287307742805229608n }],

    start() {
        // no-op
    },
    stop() {
        // no-op
    },

    contextMenus: {
        "user-context": userContextPatch,
    },
});
