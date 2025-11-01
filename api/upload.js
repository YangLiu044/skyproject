// api/upload.js —— Vercel Node.js Serverless
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import busboy from "busboy";

export const config = { api: { bodyParser: false } };

// 统一设置 CORS
function setCORS(req, res) {
  const reqOrigin = req.headers.origin || "*";
  const reqHeaders = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Origin", reqOrigin);
  res.setHeader("Vary", "Origin"); // 让 CDN 根据 Origin 变化
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  // 动态回显预检里要求的 Header，兜底再加常见的
  res.setHeader("Access-Control-Allow-Headers", reqHeaders || "content-type,accept");
  // 如需返回自定义响应头可暴露：
  // res.setHeader("Access-Control-Expose-Headers", "content-type");
}

// 解析 multipart/form-data
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    const fields = {};
    let fileChunk = null, fileName = "sky.jpg", mime = "application/octet-stream";
    bb.on("file", (_name, stream, info) => {
      fileName = info?.filename || fileName;
      mime = info?.mimeType || mime;
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => (fileChunk = Buffer.concat(chunks)));
    });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("close", () => resolve({ fields, fileChunk, fileName, mime }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === "OPTIONS") {
    // 预检直接放行
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const accessKeyId = process.env.FOUR_S3_KEY;
    const secretAccessKey = process.env.FOUR_S3_SECRET;
    const endpoint = process.env.FOUR_S3_ENDPOINT || "https://endpoint.4everland.co";
    const bucket = process.env.FOUR_BUCKET;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      return res.status(500).json({ error: "S3 credentials or FOUR_BUCKET not set" });
    }

    const { fields, fileChunk, fileName, mime } = await parseForm(req);
    if (!fileChunk) return res.status(400).json({ error: "file is required (multipart/form-data)" });

    const MAX = 10 * 1024 * 1024; // 10MB
    if (fileChunk.length > MAX) {
      return res.status(413).json({ error: `File too large (${(fileChunk.length/1024/1024).toFixed(2)} MB). Try < 10 MB.` });
    }

    const s3 = new S3Client({
      region: "4everland",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });

    const key = `${Date.now()}_${(fileName || "sky.jpg").replace(/\s+/g, "_")}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileChunk,
      ContentType: mime || "application/octet-stream",
      Metadata: {
        name: (fields.name || "").toString(),
        location: (fields.location || "").toString(),
        thoughts: (fields.thoughts || "").toString(),
        uploaded_at: new Date().toISOString(),
      },
    }));

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const meta = head.Metadata || {};
    const cid = meta["ipfs-hash"] || meta["ipfs_hash"] || meta["ipfs"] || null;

    return res.status(200).json({
      ok: true,
      key,
      cid,
      name: meta.name || fields.name || "",
      location: meta.location || fields.location || "",
      thoughts: meta.thoughts || fields.thoughts || "",
      gateway: cid ? `https://ipfs.4everland.io/ipfs/${cid}` : null,
      size: head.ContentLength ?? null,
      lastModified: head.LastModified ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
