interface SmsPayload {
  to: string;
  body: string;
}

export async function sendSms(payload: SmsPayload): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_PHONE;

  if (!sid || !token || !from) {
    console.warn("[SMS] Twilio credentials not configured. SMS not sent to", payload.to);
    return false;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: payload.to,
    From: from,
    Body: payload.body,
  }).toString();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[SMS] Twilio send failed:", res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[SMS] Send error:", err instanceof Error ? err.message : err);
    return false;
  }
}
