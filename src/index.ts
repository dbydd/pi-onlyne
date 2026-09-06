import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { broadcast, connectDaemon, consumeEvent, loopback, markConsumed, sendWithRetry, shutdownDaemon, stopProcess, subscribe, swarmReady } from "./onlyne.js";
import type { SendTarget } from "./onlyne.js";
import { inboundModeFor, loadConfig, saveConfig } from "./config.js";
import { findWorkspace, type Workspace } from "./workspace.js";
import { envTaskId, parseSwarmHeader, readSwarmEnabled, terminalHandle } from "./swarm.js";
import { SwarmSlot } from "./swarm-slot.js";
const swarmSlot = new SwarmSlot();
const slotTaskId = () => swarmSlot.task().taskId;

interface Inbound { channelId: string; conversationId: string; messageId?: string; text: string; replied: boolean; noReply: boolean; reminders: number; fallbackText?: string }
/** Swarm task slot: one session carries exactly one task; callbacks arrive via followUp. */
interface SwarmTask { taskId: string; from: string; replyTo: string; attempt: number; pendingReplies: number }

interface State {
	cwd: string; workspace: Workspace | null; watching: boolean; owner: "external" | "extension" | "stopped";
	child?: any; socket?: any; reconnectTimer?: ReturnType<typeof setTimeout>; reminderTimer?: ReturnType<typeof setTimeout>;
	currentInbound?: Inbound; lastValidOutput?: string;
	/** Swarm mode: bound to this workspace .onlyne/config.toml [swarm] enabled. */
	swarm: boolean;
	/** Active swarm task (single atomic slot). */
	swarmTask?: SwarmTask;
	/** Pending child callbacks while suspended (counted, followUp re-injects). */
	swarmPending: number;
}
const state: State = { cwd: process.cwd(), workspace: null, watching: false, owner: "stopped", swarm: false, swarmPending: 0 };
const textResult = (text: string, details?: unknown) => ({ content: [{ type: "text" as const, text }], details });
const currentConfig = () => loadConfig(state.cwd);
function refreshSwarmFlag() { state.swarm = state.workspace ? readSwarmEnabled(state.workspace.onlyneDir) : false; }
function inboundText(data: any) { const msg = data?.data?.data ?? data?.data ?? data; const channelId = msg.channel_id ?? msg.channelId; const conversationId = msg.conversation_id ?? msg.conversationId; const messageId = msg.message_id ?? msg.messageId; const text = msg.text ?? msg.content ?? msg.body; return channelId && conversationId && typeof text === "string" ? { channelId, conversationId, messageId, text } : null; }
function consumeIfNotified(inbound: { messageId?: string }) { if (state.workspace && inbound.messageId) void markConsumed(state.workspace.socketPath, inbound.messageId).catch(() => {}); }
function clearReminder() { if (state.reminderTimer) clearTimeout(state.reminderTimer); state.reminderTimer = undefined; }
function needsReply(inbound = state.currentInbound) { return !!inbound && !inbound.replied && !inbound.noReply && !!state.workspace; }
function scheduleReminder(pi: ExtensionAPI, delayMs = 30_000) {
	clearReminder();
	const inbound = state.currentInbound;
	if (!inbound || !needsReply(inbound)) return;
	state.reminderTimer = setTimeout(() => {
		state.reminderTimer = undefined;
		if (!needsReply(inbound) || state.currentInbound !== inbound) return;
		const cfg = currentConfig();
		if (cfg.outbound.defaultReplyMode === "explicit-only") return;
		if (cfg.outbound.defaultReplyMode === "guarded-explicit" && inbound.reminders < cfg.outbound.guardedExplicit.reminders) {
			if (inbound.reminders === 0) inbound.fallbackText = state.lastValidOutput;
			inbound.reminders++;
			pi.sendUserMessage(`Onlyne reminder ${inbound.reminders}/${cfg.outbound.guardedExplicit.reminders}: reply to ${inbound.channelId}/${inbound.conversationId} with onlyne_reply, or call onlyne_mark_no_reply.`, { deliverAs: "followUp" });
			return;
		}
		void reply(inbound.fallbackText || state.lastValidOutput || cfg.outbound.guardedExplicit.noOutputFallbackText).catch(() => {});
	}, delayMs);
}
function scheduleReconnect(pi: ExtensionAPI) {
	if (state.reconnectTimer || !state.watching || !state.workspace) return;
	state.reconnectTimer = setTimeout(async () => {
		state.reconnectTimer = undefined;
		if (!state.watching) return;
		try { await startWatch(pi); }
		catch { scheduleReconnect(pi); }
	}, 1000);
}

/** Swarm-mode inbound path: single atomic task slot + followUp callbacks. */
function handleSwarmInbound(pi: ExtensionAPI, text: string, eventSeq?: number) {
	const parsed = parseSwarmHeader(text);
	if (!parsed) return false;
	if (state.socket && eventSeq !== undefined) void consumeEvent(state.socket, eventSeq).catch(() => {});
	// Slot transitions live in SwarmSlot (unit-tested); here we only mirror
	// the outcome into session state (pending counter + task record).
	const before = slotTaskId();
	const outcome = swarmSlot.handle(pi, text);
	const after = slotTaskId();
	if (outcome === "claimed") {
		const cur = swarmSlot.task();
		state.swarmTask = { taskId: cur.taskId!, from: cur.from, replyTo: cur.replyTo, attempt: cur.attempt, pendingReplies: 0 };
		state.swarmPending = 0;
	} else if (outcome === "callback" && before !== undefined && before === after) {
		state.swarmPending = Math.max(0, state.swarmPending - 1);
	}
	return true;
}

async function startWatch(pi: ExtensionAPI) {
	state.workspace = findWorkspace(state.cwd); if (!state.workspace) throw new Error("current workspace has no .onlyne configuration");
	refreshSwarmFlag();
	if (state.reconnectTimer) clearTimeout(state.reconnectTimer); state.reconnectTimer = undefined;
	state.socket?.destroy(); state.socket = undefined;
	const conn = await connectDaemon(state.workspace); state.owner = conn.owner; state.child = conn.process;
	if (state.swarm) {
		// Swarm mode: the scheduler owns in/out. Subscribe without auto-handling generic
		// traffic; only swarm headers enter the session, via the followUp task queue.
		// Report readiness so the scheduler can match a pending task (fork+exec: any
		// clean ready session on this workspace path may take it).
		const ws = state.workspace;
		const socket = subscribe(ws.socketPath, (line) => {
			if (!line?.event) return;
			if (line.type !== "inbound_message") return;
			const inbound = inboundText(line);
			if (!inbound || inbound.channelId !== "loopback") return;
			handleSwarmInbound(pi, inbound.text, line.event_seq);
		}, () => { if (state.socket === socket) scheduleReconnect(pi); });
		state.socket = socket; state.watching = true;
		const task = envTaskId();
		try { await swarmReady(ws.socketPath, ws.root, terminalHandle()); } catch { /* scheduler may read env fallback */ }
		return `swarm watching ${ws.root} (${state.owner})${task ? ` task=${task}` : ""}`;
	}
	const socket = subscribe(state.workspace.socketPath, (line) => { if (!line?.event || line.type !== "inbound_message") return; const inbound = inboundText(line); if (!inbound) return; const mode = inboundModeFor(currentConfig(), inbound.channelId, inbound.conversationId); if (mode === "muted") return; if (inbound.channelId === "loopback") { if (mode === "auto-handle") pi.sendUserMessage(`Onlyne loopback activation${inbound.conversationId ? ` (${inbound.conversationId})` : ""}:\n\n${inbound.text}`, { deliverAs: "followUp" }); consumeIfNotified(inbound); return; } if (inbound.text.trim() === "/handshake") { consumeIfNotified(inbound); return; } clearReminder(); state.currentInbound = { ...inbound, replied: false, noReply: false, reminders: 0 }; if (mode === "auto-handle") { pi.sendUserMessage(`Onlyne inbound message from ${inbound.channelId}/${inbound.conversationId}:\n\n${inbound.text}\n\nReply with onlyne_reply, or call onlyne_mark_no_reply if no reply is needed.`, { deliverAs: "followUp" }); consumeIfNotified(inbound); } }, () => { if (state.socket === socket) scheduleReconnect(pi); });
	state.socket = socket; state.watching = true; return `watching ${state.workspace.root} (${state.owner})`;
}
function stopWatch() { if (state.reconnectTimer) clearTimeout(state.reconnectTimer); state.reconnectTimer = undefined; clearReminder(); state.socket?.destroy(); state.socket = undefined; stopProcess(state.child); state.child = undefined; state.watching = false; state.owner = "stopped"; state.swarmTask = undefined; state.swarmPending = 0; swarmSlot.clear(); return "watch stopped"; }
async function startDaemon() { state.workspace = findWorkspace(state.cwd); if (!state.workspace) throw new Error("current workspace has no .onlyne configuration"); refreshSwarmFlag(); const conn = await connectDaemon(state.workspace, true); state.owner = conn.owner; state.child = conn.process; return `daemon ${state.owner === "extension" ? "started" : "already running"} for ${state.workspace.root}`; }
async function stopDaemon() { if (!state.workspace) state.workspace = findWorkspace(state.cwd); if (!state.workspace) throw new Error("current workspace has no .onlyne configuration"); clearReminder(); state.socket?.destroy(); state.socket = undefined; await shutdownDaemon(state.workspace, state.child); state.child = undefined; state.watching = false; state.owner = "stopped"; return `daemon stopped for ${state.workspace.root}`; }
async function restartDaemon() { await stopDaemon().catch(() => {}); return startDaemon(); }
async function reply(text: string) { if (!state.workspace) throw new Error("onlyne workspace not found"); const inbound = state.currentInbound; if (!inbound) throw new Error("no active inbound message"); const res = await sendWithRetry(state.workspace.socketPath, { channelId: inbound.channelId }, text, currentConfig().outbound.retry.attempts); if (res.ok) { inbound.replied = true; clearReminder(); } return res; }
/** Swarm reply: writes the out message carrying the task header (success signal), ends the task slot. */
async function swarmReply(text: string, rawText = false) {
	if (!state.workspace) throw new Error("onlyne workspace not found");
	const task = state.swarmTask;
	if (!task) throw new Error("no active swarm task");
	const { renderSwarmHeader } = await import("./swarm.js");
	const wire = renderSwarmHeader({ task_id: task.taskId, from: ".", reply_to: task.replyTo, attempt: task.attempt }, "", text);
	const res = await sendWithRetry(state.workspace.socketPath, { channelId: "loopback" }, wire, currentConfig().outbound.retry.attempts, rawText);
	if (res.ok) { state.swarmTask = undefined; state.swarmPending = 0; swarmSlot.clear(); }
	return { ...res, taskId: task.taskId };
}

export default function onlyne(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => { const resumeWatch = state.watching; if (state.owner === "extension") await stopDaemon().catch(() => {}); else stopWatch(); state.cwd = ctx.cwd; state.workspace = findWorkspace(ctx.cwd); state.currentInbound = undefined; state.lastValidOutput = undefined; state.swarmTask = undefined; state.swarmPending = 0; swarmSlot.clear(); refreshSwarmFlag(); ctx.ui.setStatus("onlyne", state.workspace ? (state.swarm ? "onlyne: swarm" : "onlyne: ready") : "onlyne: no .onlyne"); if ((currentConfig().watch.autoStart || resumeWatch) && state.workspace) { try { ctx.ui.notify(await startWatch(pi), "info"); } catch (e) { ctx.ui.notify(String(e), "warning"); } } });
	pi.on("session_shutdown", async () => { if (state.owner === "extension") await stopDaemon().catch(() => {}); else stopWatch(); });
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => stopWatch());
	pi.on("message_end", async (event) => { const text = typeof (event as any).content === "string" ? (event as any).content.trim() : ""; if (text && !text.startsWith("{") && !text.startsWith("[onlyne-internal]")) state.lastValidOutput = text; });
	pi.on("agent_start", async () => clearReminder());
	pi.on("agent_end", async () => scheduleReminder(pi));
	pi.registerCommand("onlyne", {
		description: "Onlyne watch/status/config commands",
		getArgumentCompletions: (prefix: string) => {
			const commands = ["status", "watch on", "watch off", "daemon start", "daemon stop", "daemon restart", "config auto-start", "swarm on", "swarm off", "swarm status"];
			const p = prefix.trimStart();
			const filtered = commands.filter((c) => c.startsWith(p));
			return filtered.length ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (argLine: string, ctx: any) => {
			const [cmd, sub] = argLine.trim().split(/\s+/);
			try {
				if (cmd === "watch" && sub === "on") ctx.ui.notify(await startWatch(pi), "info");
				else if (cmd === "watch" && sub === "off") ctx.ui.notify(stopWatch(), "info");
				else if (cmd === "daemon" && sub === "start") ctx.ui.notify(await startDaemon(), "info");
				else if (cmd === "daemon" && sub === "stop") ctx.ui.notify(await stopDaemon(), "info");
				else if (cmd === "daemon" && sub === "restart") ctx.ui.notify(await restartDaemon(), "info");
				else if (cmd === "status") ctx.ui.notify(`onlyne ${state.watching ? "watching" : "stopped"}; owner=${state.owner}; swarm=${state.swarm ? "on" : "off"}; workspace=${state.workspace?.root ?? "none"}`, "info");
				else if (cmd === "swarm" && sub === "status") ctx.ui.notify(`swarm=${state.swarm ? "on" : "off"}; task=${state.swarmTask?.taskId ?? "none"}; pending=${state.swarmPending}`, "info");
				else if (cmd === "swarm" && (sub === "on" || sub === "off")) { ctx.ui.notify(await setSwarm(pi, sub === "on"), "info"); }
				else if (cmd === "config" && sub === "auto-start") { const cfg = currentConfig(); cfg.watch.autoStart = !cfg.watch.autoStart; saveConfig(state.cwd, cfg); ctx.ui.notify(`autoStart=${cfg.watch.autoStart}`, "info"); }
				else ctx.ui.notify("usage: /onlyne status | watch on|off | daemon start|stop|restart | swarm on|off|status | config auto-start", "info");
			} catch (e) { ctx.ui.notify(e instanceof Error ? e.message : String(e), "error"); }
		},
	});
	pi.registerTool(defineTool({ name: "onlyne_daemon_start", label: "Onlyne daemon start", description: "Start or connect to the current workspace-local Onlyne daemon managed by pi-onlyne.", parameters: Type.Object({}), executionMode: "parallel", async execute() { const res = await startDaemon(); return textResult(res, { owner: state.owner, workspace: state.workspace?.root }); } }));
	pi.registerTool(defineTool({ name: "onlyne_daemon_stop", label: "Onlyne daemon stop", description: "Stop the current workspace-local Onlyne daemon when pi-onlyne manages it, without shelling out to pkill/nohup.", parameters: Type.Object({}), executionMode: "parallel", async execute() { const res = await stopDaemon(); return textResult(res, { owner: state.owner, workspace: state.workspace?.root }); } }));
	pi.registerTool(defineTool({ name: "onlyne_daemon_restart", label: "Onlyne daemon restart", description: "Restart the current workspace-local Onlyne daemon through pi-onlyne lifecycle management.", parameters: Type.Object({}), executionMode: "parallel", async execute() { const res = await restartDaemon(); return textResult(res, { owner: state.owner, workspace: state.workspace?.root }); } }));
	pi.registerTool(defineTool({ name: "onlyne_reply", label: "Onlyne reply", description: "Reply with plain text to the current Onlyne inbound message.", parameters: Type.Object({ text: Type.String() }), executionMode: "parallel", async execute(_id, params) { return textResult(JSON.stringify(await reply(params.text))); } }));
	pi.registerTool(defineTool({ name: "onlyne_swarm_reply", label: "Onlyne swarm reply", description: "Swarm mode: write the task out message carrying the task header (the success signal) and end the task slot. Use for the active swarm task only.", parameters: Type.Object({ text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { return textResult(JSON.stringify(await swarmReply(params.text, params.rawText ?? false))); } }));
	pi.registerTool(defineTool({ name: "onlyne_send", label: "Onlyne send", description: "Send Markdown to the channel's configured Onlyne conversation. Set rawText=true only for literal plain text.", parameters: Type.Object({ channelId: Type.String(), text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { if (!state.workspace) throw new Error("onlyne workspace not found"); const res = await sendWithRetry(state.workspace.socketPath, params, params.text, currentConfig().outbound.retry.attempts, params.rawText ?? false); return textResult(JSON.stringify(res), res); } }));
	pi.registerTool(defineTool({ name: "onlyne_broadcast", label: "Onlyne broadcast", description: "Send Markdown to many configured Onlyne channels concurrently. Set rawText=true only for literal plain text.", parameters: Type.Object({ targets: Type.Array(Type.Object({ channelId: Type.String() })), text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { if (!state.workspace) throw new Error("onlyne workspace not found"); const cfg = currentConfig(); const results = await broadcast(state.workspace.socketPath, params.targets as SendTarget[], params.text, cfg.outbound.retry.attempts, cfg.outbound.retry.concurrency, params.rawText ?? false); return textResult(JSON.stringify({ ok: results.every((r) => r.ok), results }), results); } }));
	pi.registerTool(defineTool({ name: "onlyne_loopback", label: "Onlyne loopback", description: "Inject a local loopback activation message so scripts can wake the current Pi session. Set rawText=false for Markdown. FIFO alternative: write to .onlyne/channels/loopback/in.", parameters: Type.Object({ text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { if (!state.workspace) throw new Error("onlyne workspace not found"); const res = await loopback(state.workspace.socketPath, params.text, params.rawText ?? true); return textResult(JSON.stringify(res), res); } }));
	pi.registerTool(defineTool({ name: "onlyne_mark_no_reply", label: "Onlyne no reply", description: "Mark the current Onlyne inbound message as intentionally not replied.", parameters: Type.Object({ reason: Type.Optional(Type.String()) }), executionMode: "parallel", async execute(_id, params) { if (state.currentInbound) { state.currentInbound.noReply = true; clearReminder(); } if (state.swarmTask) { state.swarmTask = undefined; state.swarmPending = 0; swarmSlot.clear(); } return textResult("marked no reply", params); } }));
}

/** Toggle swarm mode: persists to .onlyne/config.toml [swarm] enabled, restarts watch. */
async function setSwarm(pi: ExtensionAPI, enabled: boolean) {
	if (!state.workspace) throw new Error("onlyne workspace not found");
	const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
	const { join } = await import("node:path");
	const cfgPath = join(state.workspace.onlyneDir, "config.toml");
	let text = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : "";
	if (text.includes("[swarm]")) {
		const lines = text.split("\n");
		let inSwarm = false;
		text = lines.map((line) => {
			const t = line.trim();
			if (t.startsWith("[")) { inSwarm = t === "[swarm]"; return line; }
			if (inSwarm && t.startsWith("enabled")) return `enabled = ${enabled}`;
			return line;
		}).join("\n");
	} else {
		if (text && !text.endsWith("\n")) text += "\n";
		text += `\n[swarm]\nenabled = ${enabled}\n`;
	}
	writeFileSync(cfgPath, text);
	refreshSwarmFlag();
	if (state.watching) { stopWatch(); return `${enabled ? "swarm on; " : "swarm off; "}${await startWatch(pi)}`; }
	return `swarm ${enabled ? "on" : "off"} (watch not running)`;
}
