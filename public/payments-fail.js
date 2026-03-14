const failMessage = document.querySelector("#fail-message");
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const message = params.get("message");

if (code || message) {
  failMessage.textContent = `결제 실패: ${code || "UNKNOWN"} ${message || ""}`.trim();
}
