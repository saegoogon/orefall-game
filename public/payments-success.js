const successMessage = document.querySelector("#success-message");

async function confirmPayment() {
  const params = new URLSearchParams(window.location.search);
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount") || 0);

  if (!paymentKey || !orderId || !amount) {
    successMessage.textContent = "승인에 필요한 정보가 부족합니다.";
    return;
  }

  try {
    const sessionResponse = await fetch("/api/session", {
      method: "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    const sessionPayload = await sessionResponse.json();
    if (!sessionResponse.ok) {
      throw new Error(sessionPayload.error || "세션 확인에 실패했습니다.");
    }

    const response = await fetch("/api/store/toss/confirm", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": sessionPayload.csrfToken,
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "승인에 실패했습니다.");
    }

    successMessage.textContent = "결제가 승인되었습니다. 잠시 후 메인 화면으로 이동합니다.";
    setTimeout(() => {
      window.location.href = "/";
    }, 1500);
  } catch (error) {
    successMessage.textContent = error.message;
  }
}

confirmPayment();
