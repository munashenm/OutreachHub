const pageUrl = "https://www.incredible.co.za/lenovo-usb-c-65w-ac-adapter";
const response = await fetch(pageUrl, {
  headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
  signal: AbortSignal.timeout(20_000),
});
console.log(`status=${response.status}`);
if (!response.ok) {
  console.log("The retailer blocked or rejected the live page. This check is separate from the regression suite.");
}
