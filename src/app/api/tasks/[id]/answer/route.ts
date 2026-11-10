/** POST /api/tasks/:id/answer — clarification answer + field mapping; the monitors re-run. */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { AnswerTaskSchema, answerTask } from "@/server/services/findings";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(AnswerTaskSchema);
  return transact((tx) => answerTask(tx, params.id, input, actor));
});
