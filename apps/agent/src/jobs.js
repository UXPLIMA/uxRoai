const pendingJobs = new Map();
const JOB_TTL_MS = 5 * 60 * 1000;

export function createJob() {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  pendingJobs.set(id, { status: "processing", result: null, controller });
  return { id, signal: controller.signal };
}

export function finishJob(id, result) {
  const job = pendingJobs.get(id);
  if (job) job.controller = null;
  pendingJobs.set(id, { status: "done", result });
  setTimeout(() => pendingJobs.delete(id), JOB_TTL_MS);
}

export function failJob(id, error) {
  const job = pendingJobs.get(id);
  if (!job) return;
  // Don't overwrite "aborted" status from user stop
  if (job.status === "aborted") return;
  job.controller = null;
  pendingJobs.set(id, { status: "error", error: String(error?.message || error) });
  setTimeout(() => pendingJobs.delete(id), JOB_TTL_MS);
}

export function abortJob(id) {
  const job = pendingJobs.get(id);
  if (!job) return false;
  if (job.controller) {
    job.controller.abort();
    job.controller = null;
  }
  pendingJobs.set(id, { status: "aborted" });
  setTimeout(() => pendingJobs.delete(id), JOB_TTL_MS);
  return true;
}

export function getJob(id) {
  return pendingJobs.get(id) || null;
}

export function deleteJob(id) {
  pendingJobs.delete(id);
}
