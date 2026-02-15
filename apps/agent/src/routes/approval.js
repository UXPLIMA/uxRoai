import { readJsonBody, sendJson } from "../utils.js";
import {
  submitPlanForApproval,
  setPlanDecision,
  awaitPlanDecision,
} from "../task-queue.js";

export async function handle(req, res, pathname) {
  const submitPlanMatch = pathname.match(/^\/v1\/studio\/tasks\/([^/]+)\/submit-plan$/);
  if (req.method === "POST" && submitPlanMatch) {
    const taskId = decodeURIComponent(submitPlanMatch[1]);
    const body = await readJsonBody(req);
    const plan = body?.plan;
    if (!plan || typeof plan !== "object") {
      sendJson(res, 400, { ok: false, error: "Plan object required" });
      return true;
    }
    const task = submitPlanForApproval(taskId, plan);
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found or not running" });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const approveMatch = pathname.match(/^\/v1\/studio\/tasks\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const taskId = decodeURIComponent(approveMatch[1]);
    const body = await readJsonBody(req);
    const approved = body?.approved !== false;
    const editedPlan = body?.editedPlan || null;
    const task = setPlanDecision(taskId, approved, editedPlan);
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found or no pending plan" });
      return true;
    }
    sendJson(res, 200, { ok: true, task });
    return true;
  }

  const awaitApprovalMatch = pathname.match(/^\/v1\/studio\/tasks\/([^/]+)\/await-approval$/);
  if (req.method === "POST" && awaitApprovalMatch) {
    const taskId = decodeURIComponent(awaitApprovalMatch[1]);
    const body = await readJsonBody(req);
    const timeout = Math.min(Math.max(Number(body?.timeoutSeconds) || 30, 1), 60) * 1000;
    const decision = await awaitPlanDecision(taskId, timeout);
    sendJson(res, 200, { ok: true, decision });
    return true;
  }

  return false;
}
