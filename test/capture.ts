// Captures what console.log / console.error print while fn runs (the redirect_stdout / redirect_stderr of the Python tests).
export function capture<T>(fn: () => T): { result: T; stdout: string; stderr: string } {
  const log = console.log, error = console.error;
  let stdout = "", stderr = "";
  console.log = (...a: unknown[]) => { stdout += a.join(" ") + "\n"; };
  console.error = (...a: unknown[]) => { stderr += a.join(" ") + "\n"; };
  try {
    const result = fn();
    return { result, stdout, stderr };
  } finally {
    console.log = log;
    console.error = error;
  }
}
