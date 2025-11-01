// api/upload.js  —— Node.js Serverless 函数（Vercel 自动识别）
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import busboy from "busboy";

export const config = { api: { bodyParser: false } }; // 我们自己解析 multipart

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    const fields = {};
    let fileChunk = null, fileName = "sky.jpg", mime = "application/octet-stream";

    bb.on("file", (_, stream, info) => {
      fileName = info.filename || fileName;
      mime = info.mimeType || mime;
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
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
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
      return res.status(500).json({ error: "S3 credentials or bucket not set" });
    }

    const { fileChunk, fileName, mime } = await parseForm(req);
    if (!fileChunk) return res.status(400).json({ error: "file is required" });

    const s3 = new S3Client({
      region: "4everland",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });

    const key = `${Date.now()}_${fileName}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileChunk,
      ContentType: mime,
    }));

    // 读取对象元数据，拿 IPFS CID
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const ipfsHash = head.Metadata?.["ipfs-hash"] || head.Metadata?.["ipfs_hash"] || head.Metadata?.ipfs || null;

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      ok: true,
      key,
      cid: ipfsHash || null,                  // ✅ 这就是 IPFS CID（如果元数据已写入）
      gateway: ipfsHash ? `https://ipfs.4everland.io/ipfs/${ipfsHash}` : null
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
