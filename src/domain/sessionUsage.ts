import { z } from "zod";
import type { Connection } from "./workspace";

const count = z.number().int().nonnegative();
export const modelUsageSchema = z.object({
  model: z.string(),
  type: z.string(),
  calls: count,
  characters: count,
  reportedCalls: count,
  input: count.optional(),
  output: count.optional(),
  total: count.optional(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type TokenUsage = {
  input?: number | null;
  output?: number | null;
  total?: number | null;
};

export class SessionUsage {
  private rows: ModelUsage[] = [];
  closed = false;
  onReport?: () => void;

  constructor(connections: Connection[]) {
    for (const connection of connections) this.row(connection);
  }

  private row(connection: Connection) {
    let row = this.rows.find(
      (r) => r.model === connection.model && r.type === connection.type,
    );
    if (!row) {
      row = {
        model: connection.model,
        type: connection.type,
        calls: 0,
        characters: 0,
        reportedCalls: 0,
      };
      this.rows.push(row);
    }
    return row;
  }

  // Count each submitted request once, including a retry or interrupted narration.
  submit(connection: Connection, characters = 0) {
    if (this.closed) throw new Error("本场演讲已结束");
    const row = this.row(connection);
    row.calls++;
    row.characters += characters;
    let reported = false;
    return (tokens?: TokenUsage | null) => {
      if (
        !tokens ||
        (tokens.input == null && tokens.output == null && tokens.total == null)
      )
        return;
      if (reported) return;
      reported = true;
      row.reportedCalls++;
      const total =
        tokens.total ??
        (tokens.input != null && tokens.output != null
          ? tokens.input + tokens.output
          : undefined);
      for (const [key, value] of [
        ["input", tokens.input],
        ["output", tokens.output],
        ["total", total],
      ] as const) {
        if (value != null) row[key] = (row[key] ?? 0) + value;
      }
      this.onReport?.();
    };
  }

  snapshot() {
    return this.rows.map((row) => ({ ...row }));
  }
}
