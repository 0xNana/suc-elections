export async function verifyHCaptchaToken(
  token: string,
  ip: string | null,
  input: { secret: string; siteKey: string }
) {
  const payload = {
    secret: input.secret,
    response: token,
    remoteip: ip ?? "",
    sitekey: input.siteKey
  };

  const params = new URLSearchParams(payload);
  const response = await fetch("https://api.hcaptcha.com/siteverify", {
    method: "POST",
    body: params
  });

  const json = (await response.json()) as {
    success?: boolean;
    "error-codes"?: string[];
  };

  return json.success ? [true, []] as const : [false, json["error-codes"] ?? []] as const;
}
