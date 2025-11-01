export const config = { runtime: "edge" };

// Simple CORS headers so your static site can call this endpoint from anywhere
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  try {
    const apiKey = process.env.FOUR_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "FOUR_API_KEY is not set" }), {
        status: 500,
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // Expecting multipart/form-data from the browser:
    // fields: file (required), name/location/thoughts (optional metadata)
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return new Response(JSON.stringify({ error: "file is required" }), {
        status: 400,
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // Forward only the file to 4EVERLAND upload API
    const upstream = new FormData();
    // Keep original file name if possible
    upstream.append("file", file, file.name || "upload.jpg");

    const uploadResp = await fetch("https://api.4everland.dev/storage/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey },
      body: upstream,
    });

    const text = await uploadResp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return new Response(JSON.stringify(data), {
      status: uploadResp.status,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
}
