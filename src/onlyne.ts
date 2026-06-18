import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import type { Workspace } from "./workspace.js";
export interface OnlyneRequest { id: string; op: string; channel_id?: string; conversation_id?: string; text?: string; limit?: number }
export interface SendTarget { channelId: string; conversationId: string }
export interface SendResult extends SendTarget { ok: boolean; error?: string }
export function request(socketPath: string, req: OnlyneRequest): Promise<any> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath); let data = "";
		socket.setEncoding("utf8"); socket.on("error", reject);
		socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
		socket.on("data", (chunk) => { data += chunk; const idx = data.indexOf("\n"); if (idx >= 0) { socket.end(); try { resolve(JSON.parse(data.slice(0, idx))); } catch (e) { reject(e); } } });
	});
}
export function subscribe(socketPath: string, onLine: (line: any) => void): Socket {
	const socket = createConnection(socketPath); let buf = ""; socket.setEncoding("utf8");
	socket.on("connect", () => socket.write('{"id":"sub","op":"subscribe_events"}\n'));
	socket.on("data", (chunk) => { buf += chunk; for (;;) { const idx = buf.indexOf("\n"); if (idx < 0) break; const raw = buf.slice(0, idx); buf = buf.slice(idx + 1); if (!raw.trim()) continue; try { onLine(JSON.parse(raw)); } catch { /* ignore */ } } });
	return socket;
}
export function spawnDaemon(ws: Workspace, onlyneBin = process.env.ONLYNE_BIN ?? "onlyne"): ChildProcess {
	const script = `
set -eu
parent="$1"
shift
"$@" &
child=$!
cleanup() { kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }
trap cleanup INT TERM HUP EXIT
while kill -0 "$parent" 2>/dev/null && kill -0 "$child" 2>/dev/null; do sleep 1; done
cleanup
`;
	return spawn("sh", ["-c", script, "onlyne-supervisor", String(process.pid), onlyneBin, "--workspace", ws.root, "run"], { cwd: ws.root, stdio: "ignore" });
}
export async function waitForSocket(socketPath: string, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs; let last: unknown;
	while (Date.now() < deadline) { try { await request(socketPath, { id: "ping", op: "ping" }); return; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 100)); }
	throw last instanceof Error ? last : new Error("onlyne socket not ready");
}
export async function connectOrSpawn(ws: Workspace): Promise<{ owner: "external" | "extension"; process?: ChildProcess }> {
	try { await request(ws.socketPath, { id: "ping", op: "ping" }); return { owner: "external" }; } catch { /* spawn */ }
	const process = spawnDaemon(ws); await waitForSocket(ws.socketPath); return { owner: "extension", process };
}
export function stopProcess(child?: ChildProcess) { if (!child || child.killed) return; child.kill("SIGTERM"); setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 1500).unref(); }
export async function sendWithRetry(socketPath: string, target: SendTarget, text: string, attempts: number): Promise<SendResult> {
	let error = "unknown error";
	for (let i = 0; i < Math.max(1, attempts); i++) {
		try { const res = await request(socketPath, { id: `send-${Date.now()}-${i}`, op: "send_message", channel_id: target.channelId, conversation_id: target.conversationId, text }); if (res.ok) return { ...target, ok: true }; error = res.error?.message ?? JSON.stringify(res.error ?? res); } catch (e) { error = e instanceof Error ? e.message : String(e); }
	}
	return { ...target, ok: false, error };
}
export async function broadcast(socketPath: string, targets: SendTarget[], text: string, attempts: number, concurrency: number): Promise<SendResult[]> {
	const out: SendResult[] = []; let next = 0;
	async function worker() { for (;;) { const i = next++; if (i >= targets.length) return; out[i] = await sendWithRetry(socketPath, targets[i]!, text, attempts); } }
	await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, targets.length)) }, worker)); return out;
}
