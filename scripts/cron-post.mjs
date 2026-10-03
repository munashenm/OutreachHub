function hasFailure(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasFailure);
  if (typeof value.error === "string" && value.error) return true;
  if (typeof value.failed === "number" && value.failed > 0 && value.requeued !== true) return true;
  return Object.values(value).some(hasFailure);
}

export async function postCron(pathname, options = {}) {
  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  const secret = process.env.CRON_SECRET ?? "";

  if (!appUrl || !secret) {
    return { ok: false, status: 0, body: null, message: "APP_URL and CRON_SECRET are required." };
  }

  const url = `${appUrl}${pathname}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    console.log(JSON.stringify({ status: response.status, body: body ?? text.slice(0, 4000) }));
    const ok = response.status >= 200 && response.status < 300 && Boolean(body) && typeof body === "object" && !hasFailure(body);
    return { ok, status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron request failed.";
    console.error(message);
    return { ok: false, status: 0, body: null, message };
  }
}

export async function runCron(pathname) {
  const result = await postCron(pathname);
  if (!result.ok) process.exit(1);
  process.exit(0);
}
