/** POST /api/findings/:id/tasks — a reviewer adds their own clarification question. */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { AddClarificationSchema, addClarificationTask } from "@/server/services/findings";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const { question } = await body(AddClarificationSchema);
  const task = transact((tx) => addClarificationTask(tx, params.id, question, actor));
  return reply(201, { taskId: task.id, version: task.version });
});
