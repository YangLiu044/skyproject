// api/upload.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = new FormData();
    const blob = Buffer.from(await req.arrayBuffer());
    form.append("file", new Blob([blob]), "upload.jpg");

    const upload = await fetch("https://api.4everland.dev/storage/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.FOUR_API_KEY,
      },
      body: form,
    });

    const data = await upload.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
