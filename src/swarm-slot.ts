import { parseSwarmHeader } from "./swarm.js";

export type SwarmHandleResult = "claimed" | "callback" | "busy-ignored" | "not-swarm";

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
	private replyTo = "";
	private attempt = 1;

	handle(pi: SwarmPi, text: string): SwarmHandleResult {
		const parsed = parseSwarmHeader(text);
		if (!parsed) return "not-swarm";
		const { header, payload } = parsed;
		if (!this.taskId) {
			this.taskId = header.task_id;
			this.from = header.from;
			this.replyTo = header.reply_to;
			this.attempt = header.attempt;
			pi.sendUserMessage(
				`Onlyne swarm task ${header.task_id} (from ${header.from}):\n\n${payload}\n\nWork this task atomically. Child task callbacks arrive as followUp messages. Finish with onlyne_swarm_reply carrying the reply Markdown, or onlyne_mark_no_reply to end without output.`,
				{ deliverAs: "followUp" },
			);
			return "claimed";
		}
		if (header.reply_to === this.taskId || header.task_id === this.taskId) {
			pi.sendUserMessage(
				`Onlyne swarm callback for ${this.taskId} (from ${header.from}):\n\n${payload}`,
				{ deliverAs: "followUp" },
			);
			return "callback";
		}
		pi.sendUserMessage(
			`[onlyne-internal] swarm task ${header.task_id} ignored: session busy with ${this.taskId}.`,
			{ deliverAs: "followUp" },
		);
		return "busy-ignored";
	}

	task(): { taskId?: string; from: string; replyTo: string; attempt: number } {
		return { taskId: this.taskId, from: this.from, replyTo: this.replyTo, attempt: this.attempt };
	}

	taskIdOf(): string | undefined {
		return this.taskId;
	}

	clear(): void {
		this.taskId = undefined;
		this.from = ".";
		this.replyTo = "";
		this.attempt = 1;
	}
}

/** Test seam: fresh slot without touching module-global pi-onlyne state. */
export function __swarmSlotForTest(): {
	handle: (pi: SwarmPi, text: string) => SwarmHandleResult;
	taskId: () => string | undefined;
	clear: () => void;
} {
	const slot = new SwarmSlot();
	return {
		handle: (pi, text) => slot.handle(pi, text),
		taskId: () => slot.taskIdOf(),
		clear: () => slot.clear(),
	};
}
