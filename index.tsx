/*
 * Vencord, a Discord client mod
 * vermLib: Plugin hub to manage multiple small utilities as sub-plugins.
 * Revamped: Modern dashboard settings with sections, animations, and a single dashboard component.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

// Sub-plugins
import FakeDeafen from "./plugins/fakeDeafen";
import FollowUser from "./plugins/followUser";
import GoXLRCensorIndicator from "./plugins/goxlrCensorIndicator";
import HideMicErrorNotice from "./plugins/hideMicErrorNotice";
import RawMic from "./plugins/rawMic";
import VCReturn from "./plugins/vcReturn";

type SubKey =
    | "fakeDeafen"
    | "followUser"
    | "goxlr"
    | "hideMicErrorNotice"
    | "rawMic"
    | "vcReturn"
    | "selectiveServerLeaver";

type SubPlugin = {
    name?: string;
    start?: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
    // Optional sub-structures used by some plugins
    settings?: any;
    flux?: Record<string, (payload: any) => void>;
    contextMenus?: Record<string, (...args: any[]) => any>;
    // For FakeDeafen UI
    FakeDeafenToggleButton?: (props?: any) => React.ReactElement | null;
};

const subs: Record<SubKey, SubPlugin> = {
    fakeDeafen: FakeDeafen as unknown as SubPlugin,
    followUser: FollowUser as unknown as SubPlugin,
    goxlr: GoXLRCensorIndicator as unknown as SubPlugin,
    hideMicErrorNotice: HideMicErrorNotice as unknown as SubPlugin,
    rawMic: RawMic as unknown as SubPlugin,
    vcReturn: VCReturn as unknown as SubPlugin,
    selectiveServerLeaver: (require("./plugins/selectiveServerLeaver") as any)
        .default as SubPlugin,
};

const started: Record<SubKey, boolean> = {
    fakeDeafen: false,
    followUser: false,
    goxlr: false,
    hideMicErrorNotice: false,
    rawMic: false,
    vcReturn: false,
    selectiveServerLeaver: false,
};

function safeStart(key: SubKey) {
    if (started[key]) return;
    try {
        subs[key]?.start?.();
        started[key] = true;
    } catch {
        // swallow to avoid crashing hub
    }
}

function safeStop(key: SubKey) {
    if (!started[key]) return;
    try {
        subs[key]?.stop?.();
    } catch {
        // swallow to avoid crashing hub
    } finally {
        started[key] = false;
    }
}

// Private settings blueprint (not shown as raw toggles in the settings list)
type PrivateState = {
    enableFakeDeafen: boolean;
    enableFollowUser: boolean;
    followUser_disconnectFollow: boolean;
    followUser_enableDebugLogs: boolean;
    enableGoXLRCensorIndicator: boolean;
    enableHideMicErrorNotice: boolean;
    enableRawMic: boolean;
    enableVCReturn: boolean;
    enableSelectiveServerLeaver: boolean;
    enableNeverPausePreviews: boolean;
};

const DEFAULTS: PrivateState = {
    enableFakeDeafen: false,
    enableFollowUser: false,
    followUser_disconnectFollow: false,
    followUser_enableDebugLogs: false,
    enableGoXLRCensorIndicator: false,
    enableHideMicErrorNotice: false,
    enableRawMic: false,
    enableVCReturn: false,
    enableSelectiveServerLeaver: false,
    enableNeverPausePreviews: false,
};

// Dashboard component (the only visible setting entry)
function Dashboard() {
    // Inject dashboard styles once
    React.useEffect(() => {
        const id = "vermLib-dashboard-styles";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
#vermLibDashboard {
    --vl-bg: color-mix(in oklab, var(--background-tertiary) 100%, black 0%);
    --vl-card: color-mix(in oklab, var(--background-secondary) 90%, black 10%);
    --vl-accent: var(--brand-experiment);
    --vl-ok: #57F287;
    --vl-warn: #FEE75C;
    --vl-bad: #ED4245;
    --vl-fg: var(--header-primary);
    --vl-fg-dim: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: vl-fade-in .35s ease-out;
}
@keyframes vl-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
}
#vermLibDashboard .vl-hero {
    position: relative;
    padding: 18px 16px;
    border-radius: 12px;
    overflow: hidden;
    background: linear-gradient(120deg, color-mix(in oklab, var(--vl-card) 70%, var(--vl-accent) 30%), var(--vl-card));
}
#vermLibDashboard .vl-hero::after {
    content: "";
    position: absolute; inset: -40% -10% auto auto;
    width: 65%; height: 220%;
    background: radial-gradient(ellipse at center, color-mix(in oklab, var(--vl-accent) 40%, transparent 60%) 0%, transparent 60%);
    filter: blur(28px);
    transform: rotate(8deg);
    animation: vl-aurora 9s ease-in-out infinite alternate;
}
@keyframes vl-aurora {
    0% { transform: rotate(8deg) translateX(0); opacity: .65; }
    100% { transform: rotate(2deg) translateX(-6%); opacity: .9; }
}
#vermLibDashboard .vl-hero h2 {
    display: flex; align-items: center; gap: 10px;
    font-weight: 700;
    color: var(--vl-fg);
    margin: 0 0 6px 0;
}
#vermLibDashboard .vl-hero p {
    margin: 0; color: var(--vl-fg-dim);
}
#vermLibDashboard .vl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
}
#vermLibDashboard .vl-card {
    background: var(--vl-card);
    border-radius: 12px;
    padding: 14px;
    position: relative;
    overflow: hidden;
    transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    box-shadow: 0 0 0 1px rgba(255,255,255,.03) inset, 0 2px 10px rgba(0,0,0,.2);
}
#vermLibDashboard .vl-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 18px rgba(0,0,0,.28);
}
#vermLibDashboard .vl-card h3 {
    margin: 0 0 6px 0; font-weight: 600; color: var(--vl-fg);
}
#vermLibDashboard .vl-desc {
    font-size: 12.75px; color: var(--vl-fg-dim);
    line-height: 1.35; margin-bottom: 10px;
}
#vermLibDashboard .vl-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
#vermLibDashboard .vl-left {
    display: flex; align-items: center; gap: 8px;
}
#vermLibDashboard .vl-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vl-bad);
    box-shadow: 0 0 0 1px rgba(0,0,0,.45) inset, 0 0 10px rgba(0,0,0,.2);
    transition: background .2s ease, transform .2s ease;
}
#vermLibDashboard .vl-dot.on { background: var(--vl-ok); }
#vermLibDashboard .vl-tag {
    font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
    background: color-mix(in oklab, var(--vl-accent) 25%, transparent 75%);
    color: var(--vl-fg);
}
#vermLibDashboard .vl-switch {
    --w: 48px; --h: 24px;
    width: var(--w); height: var(--h);
    background: var(--background-modifier-accent);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 999px; position: relative; cursor: pointer;
    transition: background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
#vermLibDashboard .vl-switch.on {
    background: var(--brand-500);
    border-color: var(--brand-560, var(--brand-500));
    box-shadow: 0 0 0 2px rgba(255,255,255,.06) inset, 0 0 8px var(--brand-500, #5865F2);
}
#vermLibDashboard .vl-knob {
    position: absolute; top: 2px; left: 2px;
    width: calc(var(--h) - 4px); height: calc(var(--h) - 4px);
    background: #ffffff;
    border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.35) inset;
    transform: translateX(0);
    transition: transform .2s ease, background .2s ease, box-shadow .2s ease;
    z-index: 1;
    will-change: transform;
}
#vermLibDashboard .vl-switch.on .vl-knob {
    transform: translateX(calc(var(--w) - var(--h)));
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0,0,0,.45), 0 0 0 1px var(--brand-600, #4752C4) inset, 0 0 6px var(--brand-500, #5865F2);
}
#vermLibDashboard .vl-select {
    width: 100%;
    background: var(--vl-bg);
    color: var(--vl-fg);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 8px;
    padding: 8px 10px;
    outline: none;
}

#vermLibDashboard .vl-section-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--header-primary);
    letter-spacing: .2px;
    margin: 2px 2px 6px 2px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

#vermLibDashboard .vl-section-title::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--brand-500);
    box-shadow: 0 0 10px var(--brand-500);
}

#vermLibDashboard .vl-divider {
    height: 1px;
    background: rgba(255,255,255,.10);
    border-radius: 999px;
    margin: 4px 0 10px 0;
    box-shadow: none;
}
#vermLibDashboard .vl-note {
    font-size: 12px; color: var(--vl-fg-dim); margin-top: 8px;
}
`;
        document.head.appendChild(style);
        return () => {
            style.remove();
        };
    }, []);

    // Initialize from persisted settings.store with defaults
    const sInit = (settings.store as any) ?? {};
    const [state, setState] = React.useState<PrivateState>({
        ...DEFAULTS,
        enableFakeDeafen: sInit.enableFakeDeafen ?? DEFAULTS.enableFakeDeafen,
        enableFollowUser: sInit.enableFollowUser ?? DEFAULTS.enableFollowUser,
        followUser_disconnectFollow:
            sInit.followUser_disconnectFollow ??
            DEFAULTS.followUser_disconnectFollow,
        followUser_enableDebugLogs:
            sInit.followUser_enableDebugLogs ??
            DEFAULTS.followUser_enableDebugLogs,
        enableGoXLRCensorIndicator:
            sInit.enableGoXLRCensorIndicator ??
            DEFAULTS.enableGoXLRCensorIndicator,
        enableHideMicErrorNotice:
            sInit.enableHideMicErrorNotice ?? DEFAULTS.enableHideMicErrorNotice,
        enableRawMic: sInit.enableRawMic ?? DEFAULTS.enableRawMic,
        enableVCReturn: sInit.enableVCReturn ?? DEFAULTS.enableVCReturn,
        enableSelectiveServerLeaver:
            sInit.enableSelectiveServerLeaver ??
            DEFAULTS.enableSelectiveServerLeaver,
        enableNeverPausePreviews:
            sInit.enableNeverPausePreviews ?? DEFAULTS.enableNeverPausePreviews,
    });

    // Helpers to apply side effects
    const update = <K extends keyof PrivateState>(
        key: K,
        value: PrivateState[K],
    ) => {
        setState((s) => ({ ...s, [key]: value }));
        // Persist in settings.store
        (settings.store as any)[key] = value;

        // Side-effects
        switch (key) {
            case "enableFakeDeafen":
                value ? safeStart("fakeDeafen") : safeStop("fakeDeafen");
                break;
            case "enableFollowUser":
                value ? safeStart("followUser") : safeStop("followUser");
                break;
            case "followUser_disconnectFollow":
                try {
                    if (subs.followUser?.updateSettings) {
                        subs.followUser.updateSettings({
                            disconnectFollow: value as boolean,
                        });
                    }
                } catch {}
                break;
            case "followUser_enableDebugLogs":
                try {
                    if (subs.followUser?.updateSettings) {
                        subs.followUser.updateSettings({
                            enableDebugLogs: value as boolean,
                        });
                    }
                } catch {}
                break;
            case "enableGoXLRCensorIndicator":
                value ? safeStart("goxlr") : safeStop("goxlr");
                break;
            case "enableHideMicErrorNotice":
                value
                    ? safeStart("hideMicErrorNotice")
                    : safeStop("hideMicErrorNotice");
                break;
            case "enableRawMic":
                value ? safeStart("rawMic") : safeStop("rawMic");
                break;
            case "enableVCReturn":
                value ? safeStart("vcReturn") : safeStop("vcReturn");
                break;
            case "enableSelectiveServerLeaver":
                value
                    ? safeStart("selectiveServerLeaver")
                    : safeStop("selectiveServerLeaver");
                break;
            case "enableNeverPausePreviews":
                try {
                    if (
                        window.confirm(
                            "Never Pause Previews requires a restart to take effect. Restart now?",
                        )
                    )
                        location.reload();
                } catch {}
                break;
        }
    };

    // Keep sub-plugin mirrored settings in sync when the component first mounts
    React.useEffect(() => {
        try {
            if (subs.followUser?.updateSettings) {
                subs.followUser.updateSettings({
                    disconnectFollow: state.followUser_disconnectFollow,
                    enableDebugLogs: state.followUser_enableDebugLogs,
                    preloadDelay: 300,
                });
            }
        } catch {}
    }, []);

    // Sync dashboard UI from persisted settings.store on mount
    React.useEffect(() => {
        const s = (settings.store as any) || {};
        setState((prev) => ({
            ...prev,
            enableFakeDeafen: s.enableFakeDeafen ?? prev.enableFakeDeafen,
            enableFollowUser: s.enableFollowUser ?? prev.enableFollowUser,
            followUser_disconnectFollow:
                s.followUser_disconnectFollow ??
                prev.followUser_disconnectFollow,
            followUser_enableDebugLogs:
                s.followUser_enableDebugLogs ?? prev.followUser_enableDebugLogs,
            enableGoXLRCensorIndicator:
                s.enableGoXLRCensorIndicator ?? prev.enableGoXLRCensorIndicator,
            enableHideMicErrorNotice:
                s.enableHideMicErrorNotice ?? prev.enableHideMicErrorNotice,
            enableRawMic: s.enableRawMic ?? prev.enableRawMic,
            enableVCReturn: s.enableVCReturn ?? prev.enableVCReturn,
            enableSelectiveServerLeaver:
                s.enableSelectiveServerLeaver ??
                prev.enableSelectiveServerLeaver,
            enableNeverPausePreviews:
                s.enableNeverPausePreviews ?? prev.enableNeverPausePreviews,
        }));
    }, []);

    // Persist dashboard state into settings.store whenever toggles change
    React.useEffect(() => {
        const s = settings.store as any;
        if (!s) return;
        s.enableFakeDeafen = state.enableFakeDeafen;
        s.enableFollowUser = state.enableFollowUser;
        s.followUser_disconnectFollow = state.followUser_disconnectFollow;
        s.followUser_enableDebugLogs = state.followUser_enableDebugLogs;
        s.enableGoXLRCensorIndicator = state.enableGoXLRCensorIndicator;
        s.enableHideMicErrorNotice = state.enableHideMicErrorNotice;
        s.enableRawMic = state.enableRawMic;
        s.enableVCReturn = state.enableVCReturn;
        s.enableSelectiveServerLeaver = state.enableSelectiveServerLeaver;
        s.enableNeverPausePreviews = state.enableNeverPausePreviews;
    }, [
        state.enableFakeDeafen,
        state.enableFollowUser,
        state.followUser_disconnectFollow,
        state.followUser_enableDebugLogs,
        state.enableGoXLRCensorIndicator,
        state.enableHideMicErrorNotice,
        state.enableRawMic,
        state.enableVCReturn,
        state.enableSelectiveServerLeaver,
        state.enableNeverPausePreviews,
    ]);

    const Card = (props: {
        title: string;
        description?: string;
        enabled?: boolean;
        right?: React.ReactNode;
        tag?: string;
        children?: React.ReactNode;
    }) => (
        <div className="vl-card">
            <div className="vl-row" style={{ marginBottom: 8 }}>
                <div className="vl-left">
                    <div className={`vl-dot ${props.enabled ? "on" : ""}`} />
                    <h3>{props.title}</h3>
                    {props.tag ? (
                        <span className="vl-tag">{props.tag}</span>
                    ) : null}
                </div>
                {props.right}
            </div>
            {props.description ? (
                <div className="vl-desc">{props.description}</div>
            ) : null}
            {props.children}
        </div>
    );

    const Switch = (props: {
        checked: boolean;
        onChange: (v: boolean) => void;
        ariaLabel?: string;
    }) => (
        <div
            role="switch"
            aria-checked={props.checked}
            aria-label={props.ariaLabel}
            className={`vl-switch ${props.checked ? "on" : ""}`}
            onClick={() => props.onChange(!props.checked)}
        >
            <div className="vl-knob" />
        </div>
    );

    return (
        <div id="vermLibDashboard">
            <div className="vl-hero">
                <h2>
                    <span
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: "var(--vl-accent)",
                            display: "inline-block",
                            boxShadow: "0 0 18px var(--vl-accent)",
                        }}
                    />
                    vermLib Dashboard
                </h2>
                <p>Manage all Verm's plugins in one place.</p>
            </div>

            <div className="vl-section-title">Voice</div>
            <div className="vl-divider" role="separator" />
            <div className="vl-grid" aria-label="Voice">
                <Card
                    title="Fake Deafen"
                    description="Allows you to appear deafened to others, while still being able to hear and talk."
                    enabled={state.enableFakeDeafen}
                    right={
                        <Switch
                            checked={state.enableFakeDeafen}
                            onChange={(v) => update("enableFakeDeafen", v)}
                            ariaLabel="Enable Fake Deafen"
                        />
                    }
                    tag="Voice"
                />
                <Card
                    title="Raw Mic"
                    description="Force raw WebRTC mic: disable echoCancellation, noiseSuppression, autoGainControl on VC join."
                    enabled={state.enableRawMic}
                    right={
                        <Switch
                            checked={state.enableRawMic}
                            onChange={(v) => update("enableRawMic", v)}
                            ariaLabel="Enable Raw Mic"
                        />
                    }
                    tag="Voice"
                />
                <Card
                    title="GoXLR Mic Color"
                    description="Show live green (Bleep) / red (Cough) indicator on the mic button via GoXLR Utility."
                    enabled={state.enableGoXLRCensorIndicator}
                    right={
                        <Switch
                            checked={state.enableGoXLRCensorIndicator}
                            onChange={(v) =>
                                update("enableGoXLRCensorIndicator", v)
                            }
                            ariaLabel="Enable GoXLR Indicator"
                        />
                    }
                    tag="Voice"
                >
                    <div className="vl-note">
                        Linux Only Using GoXLR-Utility
                    </div>
                </Card>
            </div>

            <div className="vl-section-title">Quality of Life</div>
            <div className="vl-divider" role="separator" />
            <div className="vl-grid" aria-label="Quality of Life">
                <Card
                    title="Hide Mic Error Notice"
                    description="Hides Discord's mic input warning banner (Error 3002) automatically."
                    enabled={state.enableHideMicErrorNotice}
                    right={
                        <Switch
                            checked={state.enableHideMicErrorNotice}
                            onChange={(v) =>
                                update("enableHideMicErrorNotice", v)
                            }
                            ariaLabel="Enable Hide Mic Error Notice"
                        />
                    }
                    tag="QoL"
                />
                <Card
                    title="VC Return"
                    description="Auto-clicks Discord's Reconnect button on startup to rejoin the last voice channel."
                    enabled={state.enableVCReturn}
                    right={
                        <Switch
                            checked={state.enableVCReturn}
                            onChange={(v) => update("enableVCReturn", v)}
                            ariaLabel="Enable VC Return"
                        />
                    }
                    tag="QoL"
                />
                <Card
                    title="Selective Server Leaver"
                    description="Adds a button under Discover to leave multiple servers at once."
                    enabled={state.enableSelectiveServerLeaver}
                    right={
                        <Switch
                            checked={state.enableSelectiveServerLeaver}
                            onChange={(v) =>
                                update("enableSelectiveServerLeaver", v)
                            }
                            ariaLabel="Enable Selective Server Leaver"
                        />
                    }
                    tag="QoL"
                />
                <Card
                    title="Never Pause Previews"
                    description="Prevents in-call/PiP previews (screenshare, streams, etc.) from pausing when Discord loses focus."
                    enabled={state.enableNeverPausePreviews}
                    right={
                        <Switch
                            checked={state.enableNeverPausePreviews}
                            onChange={(v) =>
                                update("enableNeverPausePreviews", v)
                            }
                            ariaLabel="Enable Never Pause Previews"
                        />
                    }
                    tag="QoL"
                />
            </div>

            <div className="vl-section-title">Social &amp; Identity</div>
            <div className="vl-divider" role="separator" />
            <div className="vl-grid" aria-label="Social &amp; Identity">
                <Card
                    title="Follow User"
                    description="Right-click a user to follow their voice channel; optionally disconnect when they leave."
                    enabled={state.enableFollowUser}
                    right={
                        <Switch
                            checked={state.enableFollowUser}
                            onChange={(v) => update("enableFollowUser", v)}
                            ariaLabel="Enable Follow User"
                        />
                    }
                    tag="Social"
                >
                    <div className="vl-row" style={{ marginTop: 8 }}>
                        <div className="vl-left" style={{ gap: 6 }}>
                            <div
                                style={{
                                    fontSize: 12.75,
                                    color: "var(--vl-fg)",
                                }}
                            >
                                Disconnect when target leaves
                            </div>
                        </div>
                        <Switch
                            checked={state.followUser_disconnectFollow}
                            onChange={(v) =>
                                update("followUser_disconnectFollow", v)
                            }
                            ariaLabel="Follow User: Disconnect When Target Leaves"
                        />
                    </div>
                    <div className="vl-row" style={{ marginTop: 8 }}>
                        <div className="vl-left" style={{ gap: 6 }}>
                            <div
                                style={{
                                    fontSize: 12.75,
                                    color: "var(--vl-fg)",
                                }}
                            >
                                Enable debug logs
                            </div>
                        </div>
                        <Switch
                            checked={state.followUser_enableDebugLogs}
                            onChange={(v) =>
                                update("followUser_enableDebugLogs", v)
                            }
                            ariaLabel="Follow User: Enable Debug Logs"
                        />
                    </div>
                </Card>
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(Dashboard, { noop: true }),
    },
});

// Render proxy for FakeDeafen button injected via patch
function FDButton(props: any) {
    const s = (settings.store as any) ?? {};
    if (!s.enableFakeDeafen) return null;
    const Comp = subs.fakeDeafen?.FakeDeafenToggleButton;
    if (typeof Comp === "function") {
        return Comp(props);
    }
    return null;
}

export default definePlugin({
    name: "vermLib",
    description: "Only the best of the best.",
    authors: [{ name: "Vermin", id: 1287307742805229608n }],

    settings,

    // Inject the FakeDeafen button next to mic/deafen; the button itself will be hidden if disabled.
    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                // This matches the action bar buttons container and injects our toggle component
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.FDButton(arguments[0]),",
            },
        },
        // Never Pause Previews: keep streamer previews running and always focused
        {
            find: "streamerPaused()",
            predicate: () => settings.store.enableNeverPausePreviews,
            replacement: {
                match: /streamerPaused\(\)\{/,
                replace: "$&return false;",
            },
        },
        {
            find: "StreamTile",
            predicate: () => settings.store.enableNeverPausePreviews,
            replacement: {
                match: /\i\.\i\.isFocused\(\)/,
                replace: "true",
            },
        },
    ],

    // Expose the wrapped button so patches can call $self.FDButton(...)
    FDButton: ErrorBoundary.wrap(FDButton, { noop: true }),

    // Aggregate context menus from enabled sub-plugins
    contextMenus: {
        "user-context"(children: any[], args: any) {
            const s = (settings.store as any) ?? {};
            if (s.enableFollowUser) {
                try {
                    subs.followUser?.contextMenus?.["user-context"]?.(
                        children,
                        args,
                    );
                } catch {
                    // ignore
                }
            }
        },
    },

    // Aggregate flux handlers and forward to enabled sub-plugins
    flux: {
        VOICE_STATE_UPDATES(payload: any) {
            const s = (settings.store as any) ?? {};
            try {
                if (s.enableFollowUser) {
                    subs.followUser?.flux?.VOICE_STATE_UPDATES?.call(
                        subs.followUser,
                        payload,
                    );
                }
            } catch {}
            try {
                if (s.enableVCReturn) {
                    subs.vcReturn?.flux?.VOICE_STATE_UPDATES?.call(
                        subs.vcReturn,
                        payload,
                    );
                }
            } catch {}
        },
    },

    start() {
        // Initialize settings.store with defaults if missing
        const s = (settings.store as any) ?? {};
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (!(k in s)) (s as any)[k] = v;
        }
        const S: PrivateState = s as PrivateState;

        // Mirror sub-plugin internal settings
        try {
            if (subs.followUser?.updateSettings) {
                subs.followUser.updateSettings({
                    disconnectFollow: S.followUser_disconnectFollow,
                    enableDebugLogs: S.followUser_enableDebugLogs,
                    preloadDelay: 300,
                });
            }
        } catch {}

        // Start enabled sub-plugins
        if (S.enableFakeDeafen) safeStart("fakeDeafen");
        if (S.enableFollowUser) safeStart("followUser");
        if (S.enableGoXLRCensorIndicator) safeStart("goxlr");
        if (S.enableHideMicErrorNotice) safeStart("hideMicErrorNotice");
        if (S.enableRawMic) safeStart("rawMic");
        if (S.enableVCReturn) safeStart("vcReturn");
        if (S.enableSelectiveServerLeaver) safeStart("selectiveServerLeaver");
    },

    stop() {
        // Stop all sub-plugins
        (Object.keys(started) as SubKey[]).forEach((k) => {
            if (started[k]) safeStop(k);
        });
    },
});
