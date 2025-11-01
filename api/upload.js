// api/upload.js  —— Vercel Node.js Serverless
// 功能：解析 multipart/form-data → 上传到 4EVERLAND S3 → 读取 ipfs-hash(CID) → 返回 JSON
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import busboy from "busboy";

export const config = { api: { bodyParser: false } }; // 我们自己解析 multipart

// 统一 CORS 头，避免浏览器 "Failed to fetch"
const setCORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
};

// 解析 multipart/form-data，拿到字段与文件
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
  setCORS(res);

  // 预检
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 读取凭证与配置
    const accessKeyId = process.env.FOUR_S3_KEY;
    const secretAccessKey = process.env.FOUR_S3_SECRET;
    const endpoint = process.env.FOUR_S3_ENDPOINT || "https://endpoint.4everland.co";
    const bucket = process.env.FOUR_BUCKET;

    if (!accessKeyId || !secretAccessKey || !bucket) {
      return res.status(500).json({ error: "S3 credentials or FOUR_BUCKET not set" });
    }

    // 解析表单
    const { fields, fileChunk, fileName, mime } = await parseForm(req);
    if (!fileChunk) return res.status(400).json({ error: "file is required (multipart/form-data)" });

    // 可选：限制图片大小（防止函数超限）
    const MAX = 10 * 1024 * 1024; // 10MB
    if (fileChunk.length > MAX) {
      return res.status(413).json({ error: `File too large (${(fileChunk.length/1024/1024).toFixed(2)} MB). Try < 10 MB.` });
    }

    // 初始化 S3 客户端（4EVERLAND 兼容端点）
    const s3 = new S3Client({
      region: "4everland",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });

    // 生成唯一对象 key
    const key = `${Date.now()}_${(fileName || "sky.jpg").replace(/\s+/g, "_")}`;

    // 上传对象，并把提交信息写入自定义元数据（小写键名更稳）
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

    // 读取对象元数据，拿到 IPFS CID（Bucket 需开启 IPFS 同步）
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const meta = head.Metadata || {};
    const cid = meta["ipfs-hash"] || meta["ipfs_hash"] || meta["ipfs"] || null;

    return res.status(200).json({
      ok: true,
      key,
      cid,                                        // IPFS CID（若 Bucket 的 IPFS 同步已开启）
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
