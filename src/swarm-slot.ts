import { parseSwarmHeader } from "./swarm.js";

export type SwarmHandleResult = "claimed" | "not-swarm";

export interface SwarmSlotMessage {
	text: string;
	deliverAs: "followUp";
}

export interface SwarmPi {
	sendUserMessage: (text: string, opts: { deliverAs: "followUp" }) => void;
}

/**
 * Single atomic task slot for swarm mode, extracted for unit testing.
 * index.ts delegates its state transitions here; the only coupling is the
 * followUp injection callback.
 */
export class SwarmSlot {
	private taskId?: string;
	private from = ".";
	private transfer = "";
	private attempt = 1;
	private sentChildIds: string[] = [];

	handle(pi: SwarmPi, text: string): SwarmHandleResult {
		const parsed = parseSwarmHeader(text);
		if (!parsed) return "not-swarm";
		const { header, payload } = parsed;
		if (!this.taskId) {
			this.taskId = header.task_id;
			this.from = header.from;
			this.transfer = header.transfer_send_to;
			this.attempt = header.attempt;
			this.sentChildIds = [];
			pi.sendUserMessage(
				`Onlyne swarm task ${header.task_id} (from ${header.from}):\n\n${payload}\n\nThis session carries this one task only. Restore context from files, work, spawn continuations with swarm_send when another unit must continue, then exit with swarm_complete. Downstream results travel through files and the ledger; nothing waits here.`,
				{ deliverAs: "followUp" },
			);
			return "claimed";
		}
		return "not-swarm";
	}

	task(): { taskId?: string; from: string; transferSendTo: string; attempt: number; sentChildIds: string[] } {
		return { taskId: this.taskId, from: this.from, transferSendTo: this.transfer, attempt: this.attempt, sentChildIds: [...this.sentChildIds] };
	}

	noteSpawned(childId: string): void {
		this.sentChildIds.push(childId);
	}

	taskIdOf(): string | undefined {
		return this.taskId;
	}

	clear(): void {
		this.taskId = undefined;
		this.from = ".";
		this.transfer = "";
		this.attempt = 1;
		this.sentChildIds = [];
	}
}

/** Test seam: fresh slot without touching module-global pi-onlyne state. */
export function __swarmSlotForTest(): {
	handle: (pi: SwarmPi, text: string) => SwarmHandleResult;
	task: () => { taskId?: string; from: string; transferSendTo: string; attempt: number; sentChildIds: string[] };
	taskId: () => string | undefined;
	noteSpawned: (childId: string) => void;
	clear: () => void;
} {
	const slot = new SwarmSlot();
	return {
		handle: (pi, text) => slot.handle(pi, text),
		task: () => slot.task(),
		taskId: () => slot.taskIdOf(),
		noteSpawned: (childId) => slot.noteSpawned(childId),
		clear: () => slot.clear(),
	};
}
