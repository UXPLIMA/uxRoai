let lastCallUsage = null;

export function getLastCallUsage() {
  return lastCallUsage;
}

export function recordUsage(inputTokens, outputTokens) {
  lastCallUsage = {
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    totalTokens: (inputTokens || 0) + (outputTokens || 0),
    timestamp: new Date().toISOString(),
  };
}

export function buildUsageResult(inputTokens, outputTokens) {
  const usage = {
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    totalTokens: (inputTokens || 0) + (outputTokens || 0),
    timestamp: new Date().toISOString(),
  };
  lastCallUsage = usage;
  return usage;
}
