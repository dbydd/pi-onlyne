import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { broadcast, connectOrSpawn, sendWithRetry, stopProcess, subscribe } from "./onlyne.js";
import type { SendTarget } from "./onlyne.js";
import { inboundModeFor, loadConfig, saveConfig } from "./config.js";
import { findWorkspace, type Workspace } from "./workspace.js";

interface State { cwd: string; workspace: Workspace | null; watching: boolean; owner: "external" | "extension" | "stopped"; child?: any; socket?: any; currentInbound?: { channelId: string; conversationId: string; text: string; replied: boolean; noReply: boolean; reminders: number; fallbackText?: string }; lastValidOutput?: string }
const state: State = { cwd: process.cwd(), workspace: null, watching: false, owner: "stopped" };
const textResult = (text: string, details?: unknown) => ({ content: [{ type: "text" as const, text }], details });
const currentConfig = () => loadConfig(state.cwd);
function inboundText(data: any) { const msg = data?.data?.data ?? data?.data ?? data; const channelId = msg.channel_id ?? msg.channelId; const conversationId = msg.conversation_id ?? msg.conversationId; const text = msg.text ?? msg.content ?? msg.body; return channelId && conversationId && typeof text === "string" ? { channelId, conversationId, text } : null; }
async function startWatch(pi: ExtensionAPI) { state.workspace = findWorkspace(state.cwd); if (!state.workspace) throw new Error("current workspace has no .onlyne configuration"); const conn = await connectOrSpawn(state.workspace); state.owner = conn.owner; state.child = conn.process; state.socket = subscribe(state.workspace.socketPath, (line) => { if (!line?.event || line.type !== "inbound_message") return; const inbound = inboundText(line); if (!inbound) return; const mode = inboundModeFor(currentConfig(), inbound.channelId, inbound.conversationId); if (mode === "muted") return; state.currentInbound = { ...inbound, replied: false, noReply: false, reminders: 0 }; if (mode === "auto-handle") pi.sendUserMessage(`Onlyne inbound message from ${inbound.channelId}/${inbound.conversationId}:\n\n${inbound.text}\n\nReply with onlyne_reply, or call onlyne_mark_no_reply if no reply is needed.`, { deliverAs: "followUp" }); }); state.watching = true; return `watching ${state.workspace.root} (${state.owner})`; }
function stopWatch() { state.socket?.destroy(); state.socket = undefined; if (state.owner === "extension") stopProcess(state.child); state.child = undefined; state.watching = false; state.owner = "stopped"; return "watch stopped"; }
async function reply(text: string) { if (!state.workspace) throw new Error("onlyne workspace not found"); const inbound = state.currentInbound; if (!inbound) throw new Error("no active inbound message"); const res = await sendWithRetry(state.workspace.socketPath, { channelId: inbound.channelId, conversationId: inbound.conversationId }, text, currentConfig().outbound.retry.attempts); if (res.ok) inbound.replied = true; return res; }

export default function onlyne(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => { state.cwd = ctx.cwd; state.workspace = findWorkspace(ctx.cwd); ctx.ui.setStatus("onlyne", state.workspace ? "onlyne: ready" : "onlyne: no .onlyne"); if (currentConfig().watch.autoStart && state.workspace) { try { ctx.ui.notify(await startWatch(pi), "info"); } catch (e) { ctx.ui.notify(String(e), "warning"); } } });
	pi.on("session_shutdown", async () => { stopWatch(); });
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => stopWatch());
	pi.on("message_end", async (event) => { const text = typeof (event as any).content === "string" ? (event as any).content.trim() : ""; if (text && !text.startsWith("{") && !text.startsWith("[onlyne-internal]")) state.lastValidOutput = text; });
	pi.on("turn_end", async () => {
		const inbound = state.currentInbound;
		if (!inbound || inbound.replied || inbound.noReply || !state.workspace) return;
		const cfg = currentConfig();
		if (cfg.outbound.defaultReplyMode === "explicit-only") return;
		if (cfg.outbound.defaultReplyMode === "guarded-explicit" && inbound.reminders < cfg.outbound.guardedExplicit.reminders) {
			if (inbound.reminders === 0) inbound.fallbackText = state.lastValidOutput;
			inbound.reminders++;
			pi.sendUserMessage(`Onlyne reminder ${inbound.reminders}/${cfg.outbound.guardedExplicit.reminders}: reply to ${inbound.channelId}/${inbound.conversationId} with onlyne_reply, or call onlyne_mark_no_reply.`, { deliverAs: "followUp" });
			return;
		}
		await reply(inbound.fallbackText || state.lastValidOutput || cfg.outbound.guardedExplicit.noOutputFallbackText);
	});
	pi.registerCommand("onlyne", { description: "Onlyne watch/status/config commands", handler: async (argLine: string, ctx: any) => { const [cmd, sub] = argLine.trim().split(/\s+/); try { if (cmd === "watch" && sub === "on") ctx.ui.notify(await startWatch(pi), "info"); else if (cmd === "watch" && sub === "off") ctx.ui.notify(stopWatch(), "info"); else if (cmd === "status") ctx.ui.notify(`onlyne ${state.watching ? "watching" : "stopped"}; owner=${state.owner}; workspace=${state.workspace?.root ?? "none"}`, "info"); else if (cmd === "config" && sub === "auto-start") { const cfg = currentConfig(); cfg.watch.autoStart = !cfg.watch.autoStart; saveConfig(state.cwd, cfg); ctx.ui.notify(`autoStart=${cfg.watch.autoStart}`, "info"); } else ctx.ui.notify("usage: /onlyne status | watch on|off | config auto-start", "info"); } catch (e) { ctx.ui.notify(e instanceof Error ? e.message : String(e), "error"); } } });
	pi.registerTool(defineTool({ name: "onlyne_reply", label: "Onlyne reply", description: "Reply with plain text to the current Onlyne inbound message.", parameters: Type.Object({ text: Type.String() }), executionMode: "parallel", async execute(_id, params) { return textResult(JSON.stringify(await reply(params.text))); } }));
	pi.registerTool(defineTool({ name: "onlyne_send", label: "Onlyne send", description: "Send Markdown to one Onlyne channel conversation. Set rawText=true only for literal plain text.", parameters: Type.Object({ channelId: Type.String(), conversationId: Type.String(), text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { if (!state.workspace) throw new Error("onlyne workspace not found"); const res = await sendWithRetry(state.workspace.socketPath, params, params.text, currentConfig().outbound.retry.attempts, params.rawText ?? false); return textResult(JSON.stringify(res), res); } }));
	pi.registerTool(defineTool({ name: "onlyne_broadcast", label: "Onlyne broadcast", description: "Send Markdown to many Onlyne channel conversations concurrently. Set rawText=true only for literal plain text.", parameters: Type.Object({ targets: Type.Array(Type.Object({ channelId: Type.String(), conversationId: Type.String() })), text: Type.String(), rawText: Type.Optional(Type.Boolean()) }), executionMode: "parallel", async execute(_id, params) { if (!state.workspace) throw new Error("onlyne workspace not found"); const cfg = currentConfig(); const results = await broadcast(state.workspace.socketPath, params.targets as SendTarget[], params.text, cfg.outbound.retry.attempts, cfg.outbound.retry.concurrency, params.rawText ?? false); return textResult(JSON.stringify({ ok: results.every((r) => r.ok), results }), results); } }));
	pi.registerTool(defineTool({ name: "onlyne_mark_no_reply", label: "Onlyne no reply", description: "Mark the current Onlyne inbound message as intentionally not replied.", parameters: Type.Object({ reason: Type.Optional(Type.String()) }), executionMode: "parallel", async execute(_id, params) { if (state.currentInbound) state.currentInbound.noReply = true; return textResult("marked no reply", params); } }));
}
