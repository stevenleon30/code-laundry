async function sendEmail(to: string): Promise<void> {
  await fetch("/api/email", { method: "POST", body: to });
}

export async function notifyAll(recipients: string[]): Promise<void> {
  recipients.forEach(async (r) => {
    await sendEmail(r);
  });
}
