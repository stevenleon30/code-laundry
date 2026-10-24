export async function postMessage(channel: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: "Bearer __SECRET_SLACK__",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
}
