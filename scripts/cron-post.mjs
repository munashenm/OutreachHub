function hasFailure(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasFailure);
  if (typeof value.error === "string" && value.error) return true;
  if (typeof value.failed === "number" && value.failed > 0) return true;
  return Object.values(value).some(hasFailure);
}

export async function runCron(pathname) {
  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  const secret = process.env.CRON_SECRET ?? "";

  if (!appUrl || !secret) {
    console.error("APP_URL and CRON_SECRET are required.");
    process.exit(1);
  }

  const url = `${appUrl}${pathname}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
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
    if (response.status < 200 || response.status >= 300 || !body || typeof body !== "object") process.exit(1);
    if (hasFailure(body)) process.exit(1);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Cron request failed.");
    process.exit(1);
  }
}
