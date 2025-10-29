/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import {
    Alerts,
    Button,
    FluxDispatcher,
    Forms,
    GuildStore,
    Parser,
    React,
    RestAPI,
    Toasts,
    UserStore,
} from "@webpack/common";

type GuildLite = {
    id: string;
    name: string;
    icon?: string | null | undefined;
    ownerId: string;
};

function getGuildIconURL(g: GuildLite, size = 64) {
    if (!g.icon) return null;
    return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "png"}?size=${size}`;
}

async function leaveGuild(guildId: string) {
    // This calls the same endpoint the client uses to leave a guild
    // DELETE /users/@me/guilds/:guild_id
    return RestAPI.del({
        url: `/users/@me/guilds/${guildId}`,
    });
}

function SelectiveLeaveModal(props: { modalProps: any }) {
    const { onClose } = props.modalProps;
    const meId = UserStore.getCurrentUser()?.id;

    // Fixed modal width so the window size doesn't change between tabs
    // Keeps a consistent width while remaining responsive to viewport size
    const FIXED_MODAL_WIDTH = "min(840px, calc(100vw - 64px))";

    // Data
    const allGuilds = React.useMemo(() => {
        const map = GuildStore.getGuilds?.() ?? {};
        const list: GuildLite[] = Object.values(map as Record<string, any>).map(
            (g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                ownerId: g.ownerId,
            }),
        );
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }, []);
    const ownedGuilds = React.useMemo(
        () => allGuilds.filter((g) => g.ownerId === meId),
        [allGuilds, meId],
    );
    const joinedGuilds = React.useMemo(
        () => allGuilds.filter((g) => g.ownerId !== meId),
        [allGuilds, meId],
    );

    // UI State
    const [activeTab, setActiveTab] = React.useState<"joined" | "owned">(
        "joined",
    );
    const [query, setQuery] = React.useState("");
    const [selectedJoined, setSelectedJoined] = React.useState<Set<string>>(
        new Set(),
    );
    const [selectedOwned, setSelectedOwned] = React.useState<Set<string>>(
        new Set(),
    );
    const [working, setWorking] = React.useState(false);

    // Filtered lists
    const filteredOwned = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return ownedGuilds;
        return ownedGuilds.filter(
            (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
        );
    }, [ownedGuilds, query]);
    const filteredJoined = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return joinedGuilds;
        return joinedGuilds.filter(
            (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
        );
    }, [joinedGuilds, query]);

    // Current context
    const currentList = activeTab === "joined" ? filteredJoined : filteredOwned;
    const currentSelected =
        activeTab === "joined" ? selectedJoined : selectedOwned;

    // Selection helpers
    const setCurrentSelected = (next: Set<string>) => {
        if (activeTab === "joined") setSelectedJoined(next);
        else setSelectedOwned(next);
    };

    const toggleSel = (id: string) => {
        setCurrentSelected((prev) => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };

    const selectAllVisible = () => {
        const s = new Set(currentSelected);
        for (const g of currentList) s.add(g.id);
        setCurrentSelected(s);
    };

    const deselectAll = () => setCurrentSelected(new Set());

    // Inject styles for modern look (glow, animations, spacing)
    React.useEffect(() => {
        const id = "vermLib-ssl-styles";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
.ssl-root { animation: ssl-fade-in .25s ease-out; }
@keyframes ssl-fade-in { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }

/* Top toolbar spacing and interactive feedback */
.ssl-toolbar { padding: 6px 4px; }
.ssl-toolbar button { box-shadow: 0 0 0 0 rgba(88,101,242,.0); transition: box-shadow .2s ease, transform .08s ease; }
.ssl-toolbar button:hover { box-shadow: 0 0 12px rgba(88,101,242,.35); }
.ssl-toolbar button:active { transform: translateY(1px) scale(.99); }

/* Tabs equal width */
.ssl-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.ssl-tab { width: 100%; justify-content: center; }

/* Search input focus glow */
.ssl-search input { box-shadow: 0 0 0 0 rgba(0,0,0,0); transition: box-shadow .2s ease, border-color .2s ease; color: var(--header-primary); -webkit-text-fill-color: var(--header-primary); caret-color: var(--header-primary); box-sizing: border-box; max-width: 100%; }
.ssl-search input::placeholder { color: var(--text-muted); opacity: 1; }
.ssl-search input:focus { box-shadow: 0 0 0 2px var(--brand-500, #5865F2) inset; border-color: var(--brand-560, var(--brand-500)); }

/* List surface, hover animation, and hidden scrollbars */
.ssl-list {
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.03) inset;
  scrollbar-width: none; /* Firefox */
}
.ssl-list::-webkit-scrollbar { display: none; } /* WebKit */
.ssl-list label { transition: transform .12s ease, background .12s ease, box-shadow .12s ease; }
.ssl-list label:hover { transform: translateY(-1px); background: var(--background-modifier-hover); box-shadow: 0 2px 12px rgba(0,0,0,.2); }
        `;
        document.head.appendChild(style);
        return () => {
            style.remove();
        };
    }, []);

    // no-op (replaced by filteredOwned/filteredJoined/currentList)

    const selectedJoinedIds = React.useMemo(
        () =>
            [...selectedJoined].filter((id) =>
                joinedGuilds.some((g) => g.id === id),
            ),
        [selectedJoined, joinedGuilds],
    );
    const selectedOwnedIds = React.useMemo(
        () =>
            [...selectedOwned].filter((id) =>
                ownedGuilds.some((g) => g.id === id),
            ),
        [selectedOwned, ownedGuilds],
    );

    // Delete guild (owner only). Support optional 2FA via X-Discord-MFA-Code
    async function deleteGuildOnce(guildId: string, mfaCode?: string) {
        return RestAPI.del({
            url: `/guilds/${guildId}`,
            headers: mfaCode
                ? ({ "X-Discord-MFA-Code": mfaCode } as any)
                : undefined,
        } as any);
    }

    async function massDeleteOwned() {
        if (!selectedOwnedIds.length) return;

        // triple confirm
        const confirms = [
            {
                title: "Delete owned servers?",
                body: `You are about to delete ${selectedOwnedIds.length} server${selectedOwnedIds.length === 1 ? "" : "s"}. This action is permanent.`,
            },
            {
                title: "Are you absolutely sure?",
                body: "This will permanently delete all selected servers and cannot be undone.",
            },
            {
                title: "Final confirmation",
                body: "Type your 2FA code if enabled in the next prompt. Proceed?",
            },
        ];
        for (const c of confirms) {
            let ok = false;
            await new Promise<void>((resolve) => {
                Alerts.show({
                    title: c.title,
                    body: Parser.parse(c.body),
                    confirmText: "Continue",
                    cancelText: "Cancel",
                    onConfirm: () => {
                        ok = true;
                        resolve();
                    },
                    onCancel: () => resolve(),
                });
            });
            if (!ok) return;
        }

        let mfaCode: string | undefined;
        // Simple prompt for 2FA code; users without 2FA can leave blank
        try {
            const code = window
                .prompt("Enter your 2FA code (leave empty if not enabled):")
                ?.trim();
            if (code) mfaCode = code;
        } catch {
            /* ignore */
        }

        setWorking(true);
        let ok = 0,
            fail = 0;

        for (const gid of selectedOwnedIds) {
            try {
                await deleteGuildOnce(gid, mfaCode);
                ok++;
                FluxDispatcher.dispatch({
                    type: "GUILD_DELETE",
                    guild: { id: gid },
                });
            } catch {
                // retry after 1s
                try {
                    await new Promise((r) => setTimeout(r, 1000));
                    await deleteGuildOnce(gid, mfaCode);
                    ok++;
                    FluxDispatcher.dispatch({
                        type: "GUILD_DELETE",
                        guild: { id: gid },
                    });
                } catch {
                    fail++;
                }
            }
            // pace 300ms
            await new Promise((r) => setTimeout(r, 300));
        }

        setWorking(false);
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Deleted ${ok} server${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully deleted ${ok} server${ok === 1 ? "" : "s"}.`,
        });
        onClose?.();
    }

    async function massLeaveJoined() {
        if (!selectedJoinedIds.length) return;

        let confirmed = false;
        await new Promise<void>((resolve) => {
            Alerts.show({
                title: "Leave selected servers?",
                body: Parser.parse(
                    `You are about to leave ${selectedJoinedIds.length} server${selectedJoinedIds.length === 1 ? "" : "s"}.`,
                ),
                confirmText: `Leave ${selectedJoinedIds.length}`,
                cancelText: "Cancel",
                onConfirm: () => {
                    confirmed = true;
                    resolve();
                },
                onCancel: () => resolve(),
            });
        });
        if (!confirmed) return;

        setWorking(true);
        let ok = 0,
            fail = 0;

        for (const gid of selectedJoinedIds) {
            try {
                await leaveGuild(gid);
                ok++;
                FluxDispatcher.dispatch({
                    type: "GUILD_DELETE",
                    guild: { id: gid },
                });
            } catch {
                try {
                    await new Promise((r) => setTimeout(r, 1000));
                    await leaveGuild(gid);
                    ok++;
                    FluxDispatcher.dispatch({
                        type: "GUILD_DELETE",
                        guild: { id: gid },
                    });
                } catch {
                    fail++;
                }
            }
            await new Promise((r) => setTimeout(r, 300));
        }

        setWorking(false);
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Left ${ok} server${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully left ${ok} server${ok === 1 ? "" : "s"}.`,
        });
        onClose?.();
    }

    return (
        <ModalRoot
            {...props.modalProps}
            size={ModalSize.LARGE}
            style={{ width: FIXED_MODAL_WIDTH }}
        >
            <ModalHeader>
                <Forms.FormTitle
                    tag="h2"
                    style={{ margin: 0, color: "var(--header-primary)" }}
                >
                    Selective Server Leaver
                </Forms.FormTitle>
            </ModalHeader>

            <ModalContent className="ssl-content">
                <div
                    className="ssl-root"
                    style={{ width: "100%", maxWidth: FIXED_MODAL_WIDTH }}
                >
                    {/* Tabs */}
                    <div className="ssl-tabs">
                        <Button
                            className="ssl-tab"
                            size={Button.Sizes.SMALL}
                            color={
                                activeTab === "joined"
                                    ? Button.Colors.BRAND
                                    : Button.Colors.PRIMARY
                            }
                            onClick={() => setActiveTab("joined")}
                        >
                            Joined Servers
                        </Button>
                        <Button
                            className="ssl-tab"
                            size={Button.Sizes.SMALL}
                            color={
                                activeTab === "owned"
                                    ? Button.Colors.BRAND
                                    : Button.Colors.PRIMARY
                            }
                            onClick={() => setActiveTab("owned")}
                        >
                            Owned Servers
                        </Button>
                    </div>

                    <div
                        className="ssl-toolbar"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "initial",
                            marginBottom: 8,
                            gap: 8,
                        }}
                    >
                        <Forms.FormText
                            style={{
                                color: "var(--header-primary)",
                                margin: 0,
                            }}
                        >
                            {activeTab === "joined"
                                ? `Selected: ${selectedJoinedIds.length}`
                                : `Selected: ${selectedOwnedIds.length}`}
                        </Forms.FormText>
                        <div
                            style={{
                                display: "flex",
                                gap: 16,
                                marginLeft: "auto",
                            }}
                        >
                            <Button
                                size={Button.Sizes.MEDIUM}
                                onClick={selectAllVisible}
                                disabled={working || currentList.length === 0}
                            >
                                Select visible
                            </Button>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                onClick={deselectAll}
                                disabled={working || currentSelected.size === 0}
                            >
                                Clear
                            </Button>
                        </div>
                    </div>

                    <div
                        className="ssl-search"
                        style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            background: "var(--background-secondary)",
                            paddingBottom: 8,
                        }}
                    >
                        <input
                            aria-label="Search servers"
                            placeholder="Search by server name or ID..."
                            value={query}
                            onChange={(e) => setQuery(e.currentTarget.value)}
                            style={{
                                width: "100%",
                                maxWidth: "100%",
                                boxSizing: "border-box",
                                background: "var(--background-tertiary)",
                                color: "var(--header-primary)",
                                WebkitTextFillColor: "var(--header-primary)",
                                caretColor: "var(--header-primary)",
                                border: "1px solid var(--background-modifier-accent)",
                                borderRadius: 8,
                                outline: "none",
                                padding: "8px 10px",
                            }}
                        />
                    </div>

                    <div
                        role="list"
                        className="ssl-list"
                        style={{
                            marginTop: 8,
                            display: "grid",
                            gridTemplateColumns: "minmax(220px, 1fr)",
                            gap: 8,
                            height: 420,
                            overflowY: "auto",
                            overflowX: "hidden",
                            border: "1px solid var(--background-modifier-accent)",
                            borderRadius: 12,
                            padding: 8,
                            background: "var(--background-secondary)",
                        }}
                    >
                        {currentList.map((g) => {
                            const isOwner = g.ownerId === meId;
                            const isSelected = currentSelected.has(g.id);
                            const icon = getGuildIconURL(g, 64);
                            return (
                                <label
                                    key={g.id}
                                    role="listitem"
                                    tabIndex={0}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: 8,
                                        borderRadius: 8,
                                        width: "100%",
                                        background: isSelected
                                            ? "var(--background-modifier-selected)"
                                            : "transparent",
                                        cursor: "pointer",
                                        border: "1px solid var(--background-modifier-accent)",
                                    }}
                                    onClick={(e) => {
                                        // prevent label click from toggling if owner

                                        // don't toggle when clicking on a link inside
                                        if (
                                            (e.target as HTMLElement).closest(
                                                "a",
                                            )
                                        )
                                            return;
                                        toggleSel(g.id);
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === " " ||
                                            e.key === "Enter"
                                        ) {
                                            e.preventDefault();
                                            toggleSel(g.id);
                                        }
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 8,
                                            overflow: "hidden",
                                            flex: "0 0 auto",
                                            background:
                                                "var(--background-tertiary)",
                                        }}
                                    >
                                        {icon ? (
                                            <img
                                                src={icon}
                                                alt=""
                                                width={32}
                                                height={32}
                                            />
                                        ) : (
                                            <div
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    display: "grid",
                                                    placeItems: "center",
                                                    fontSize: 12,
                                                    color: "var(--text-muted)",
                                                }}
                                            >
                                                {g.name
                                                    .slice(0, 2)
                                                    .toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            minWidth: 0,
                                        }}
                                    >
                                        <div
                                            style={{
                                                color: "var(--header-primary)",
                                                textOverflow: "ellipsis",
                                                overflow: "hidden",
                                                whiteSpace: "nowrap",
                                                maxWidth: "100%",
                                            }}
                                        >
                                            {g.name}
                                        </div>
                                        <Forms.FormText
                                            style={{
                                                fontSize: 12,
                                                color: "var(--text-muted)",
                                            }}
                                        >
                                            {g.id}
                                            {isOwner ? " • Owner" : ""}
                                        </Forms.FormText>
                                    </div>
                                </label>
                            );
                        })}
                        {!currentList.length && (
                            <div
                                style={{
                                    padding: 12,
                                    textAlign: "center",
                                    color: "var(--text-muted)",
                                }}
                            >
                                No servers match your search.
                            </div>
                        )}
                    </div>

                    <Divider className="marginTop8 marginBottom8" />
                    <Forms.FormText style={{ color: "var(--text-danger)" }}>
                        Warning: Leaving servers is permanent. You will lose
                        access until re-invited.
                    </Forms.FormText>
                </div>
            </ModalContent>

            <ModalFooter>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        maxWidth: FIXED_MODAL_WIDTH,
                        gap: 12,
                    }}
                >
                    <Button
                        look={Button.Looks.LINK}
                        color={Button.Colors.PRIMARY}
                        onClick={onClose}
                        disabled={working}
                    >
                        Cancel
                    </Button>
                    <div style={{ flex: 1 }} />
                    {activeTab === "joined" ? (
                        <Button
                            color={Button.Colors.RED}
                            disabled={!selectedJoinedIds.length || working}
                            onClick={massLeaveJoined}
                        >
                            {working
                                ? "Leaving..."
                                : `Leave selected (${selectedJoinedIds.length})`}
                        </Button>
                    ) : (
                        <Button
                            color={Button.Colors.RED}
                            disabled={!selectedOwnedIds.length || working}
                            onClick={massDeleteOwned}
                        >
                            {working
                                ? "Deleting..."
                                : `Delete selected (${selectedOwnedIds.length})`}
                        </Button>
                    )}
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

// Simple DOM injector that builds a list item styled like the Quests entry
function createNavButton(onClick: () => void) {
    // Probe the Quests item to copy classNames for consistent styling
    const questsAnchor = document.querySelector<HTMLElement>(
        'a[href="/quest-home"]',
    );
    const questsItem = questsAnchor?.closest("li") as HTMLLIElement | null;
    const questsWrapper = questsItem?.parentElement as HTMLElement | null;

    // Helper to safely read classNames from the Quests item
    const getClass = (selector: string) =>
        questsItem?.querySelector<HTMLElement>(selector)?.className || "";

    // Wrapper cloned from Quests wrapper so spacing/shine match
    const wrapper = document.createElement("div");
    wrapper.id = "vermLib-selective-server-leaver-entry";
    wrapper.className = questsWrapper?.className || "wrapper_ebee1d";
    const wrapperStyle = questsWrapper?.getAttribute("style");
    if (wrapperStyle) wrapper.setAttribute("style", wrapperStyle);

    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    li.className = questsItem?.className || "channel__972a0 container_e45859";

    const interactive = document.createElement("div");
    interactive.className =
        getClass('div[class*="interactive"]') ||
        "interactive_bf202d interactive__972a0 linkButton__972a0";
    li.appendChild(interactive);

    // Use a div with the same "link" class and button semantics
    const linkLike = document.createElement("div");
    linkLike.className = getClass('a[class*="link_"]') || "link__972a0";
    linkLike.setAttribute("role", "button");
    linkLike.setAttribute("tabindex", "0");
    interactive.appendChild(linkLike);

    const layout = document.createElement("div");
    layout.className =
        getClass('div[class*="layout_"]') +
        " " +
        (getClass('div[class*="avatarWithText_"]') || "avatarWithText__972a0");
    linkLike.appendChild(layout);

    const avatar = document.createElement("div");
    avatar.className = getClass('div[class*="avatar_"]') || "avatar__20a53";
    layout.appendChild(avatar);

    // Icon that matches sizing/styling via the same class the Quests icon uses
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute(
        "class",
        questsItem?.querySelector("svg")?.getAttribute("class") ||
            "linkButtonIcon__972a0",
    );
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("role", "img");
    icon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("fill", "none");
    icon.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // "Leave/Log out" style arrow path, styled by currentColor
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
        "d",
        "M10 3a1 1 0 1 1 2 0v7h4l-5 5-5-5h4V3Zm9 6a1 1 0 0 1 1 1v8.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5V16a1 1 0 1 1 2 0v2.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V10a1 1 0 0 1 1-1Z",
    );
    icon.appendChild(path);
    avatar.appendChild(icon);

    const content = document.createElement("div");
    content.className = getClass('div[class*="content_"]') || "content__20a53";
    layout.appendChild(content);

    const nameAndDecorators = document.createElement("div");
    nameAndDecorators.className =
        getClass('div[class*="nameAndDecorators_"]') ||
        "nameAndDecorators__20a53";
    content.appendChild(nameAndDecorators);

    const name = document.createElement("div");
    name.className = getClass('div[class*="name_"]') || "name__20a53";

    name.textContent = "Leave servers";
    nameAndDecorators.appendChild(name);

    // Interactions
    const activate = () => onClick();
    linkLike.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activate();
    });
    linkLike.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            activate();
        }
    });

    wrapper.appendChild(li);
    return wrapper;
}

function findGuildsNavList(): HTMLElement | null {
    // Try to find the main guilds list container
    // Discord uses data-list-id="guildsnav" in the main guilds list
    const list = document.querySelector<HTMLElement>(
        '[data-list-id="guildsnav"]',
    );
    if (list) {
        // The list container is usually a scroller; append at the end to be under Discover
        return list;
    }

    // Fallback: common nav container labels
    const nav = document.querySelector<HTMLElement>(
        'nav[aria-label="Servers"]',
    );
    return nav ?? null;
}

let mountedNode: HTMLElement | null = null;
let mo: MutationObserver | null = null;
let hb: number | null = null;
const REINJECT_EVENTS = [
    "CHANNEL_SELECT",
    "SIDEBAR_VIEW_GUILD",
    "GUILD_CREATE",
    "GUILD_DELETE",
    "CONNECTION_OPEN",
    "WINDOW_FOCUS",
] as const;

const reinjectHandler = () => ensureInjected();

function subscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            // @ts-expect-error: Flux types are broad, event names are strings
            FluxDispatcher.subscribe(ev, reinjectHandler);
        }
    } catch {}
}

function unsubscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            // @ts-expect-error: Flux types are broad, event names are strings
            FluxDispatcher.unsubscribe(ev, reinjectHandler);
        }
    } catch {}
}

function ensureInjected() {
    // Prefer inserting under the Quests list item in the private channels sidebar
    const questsAnchor = document.querySelector<HTMLElement>(
        'a[href="/quest-home"]',
    );
    const questsItem = questsAnchor?.closest("li") as HTMLLIElement | null;
    const questsWrapper = questsItem?.parentElement as HTMLElement | null;
    const parent =
        (questsWrapper?.parentElement as HTMLElement | null) ??
        findGuildsNavList();
    if (!parent) return;

    // Remove any existing entry so we can re-insert after current Quests slot
    document.getElementById("vermLib-selective-server-leaver-entry")?.remove();

    const node = createNavButton(() => {
        openModal((mProps) => <SelectiveLeaveModal modalProps={mProps} />);
    });

    if (questsWrapper) {
        // Always insert right after the current Quests wrapper
        questsWrapper.insertAdjacentElement("afterend", node);
    } else if (parent) {
        // Fallback: append under the guilds list
        parent.appendChild(node);
    }
    mountedNode = node;
}

function cleanupInjected() {
    mountedNode?.remove();
    mountedNode = null;
}

function startObserve() {
    // Observe layout changes and re-insert if Discord rerenders the guilds list
    mo = new MutationObserver(() => {
        // If our button was removed but the nav exists, re-inject
        if (!document.getElementById("vermLib-selective-server-leaver-entry")) {
            ensureInjected();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });
}

function stopObserve() {
    mo?.disconnect();
    mo = null;
}

export default {
    name: "SelectiveServerLeaver",

    start() {
        // Immediately try to inject once
        ensureInjected();
        // Observe rerenders to persist the button
        startObserve();
        // Reinjection on common navigation/route events
        subscribeReinjection();
        // Heartbeat reinjection to survive route changes/rerenders
        hb = window.setInterval(() => ensureInjected(), 1000);
    },

    stop() {
        if (hb) {
            clearInterval(hb);
            hb = null;
        }
        unsubscribeReinjection();
        stopObserve();
        cleanupInjected();
    },
} as const;
