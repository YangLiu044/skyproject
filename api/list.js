// api/list.js —— 列出对象+元数据+CID（Node.js Serverless）
// 关键：动态 CORS + 禁止缓存，避免 Failed to fetch
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";

export const config = { api: { bodyParser: false } };

function setCORS(req, res) {
  const origin = req.headers.origin || "*";
  const reqHeaders = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin"); // 让 CDN 不同 Origin 单独缓存
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", reqHeaders || "content-type,accept");
  // 禁止缓存，避免下次取到不带 CORS 的副本
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const accessKeyId = process.env.FOUR_S3_KEY;
    const secretAccessKey = process.env.FOUR_S3_SECRET;
    const endpoint = process.env.FOUR_S3_ENDPOINT || "https://endpoint.4everland.co";
    const bucket = process.env.FOUR_BUCKET;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      return res.status(500).json({ error: "S3 credentials or FOUR_BUCKET not set" });
    }

    const s3 = new S3Client({
      region: "4everland",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });

    const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
    const token = req.query.token;

    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: limit,
      ContinuationToken: token || undefined,
    }));

    const items = await Promise.all(
      (listed.Contents || [])
        .sort((a,b) => (b.LastModified?.getTime()||0) - (a.LastModified?.getTime()||0))
        .map(async (obj) => {
          try {
            const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: obj.Key }));
            const meta = h.Metadata || {};
            const cid = meta["ipfs-hash"] || meta["ipfs_hash"] || meta["ipfs"] || null;
            return {
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified,
              cid,
              name: meta.name || "",
              location: meta.location || "",
              thoughts: meta.thoughts || "",
              uploaded_at: meta.uploaded_at || null,
              gateway: cid ? `https://ipfs.4everland.io/ipfs/${cid}` : null
            };
          } catch (e) {
            return { key: obj.Key, error: String(e.message || e) };
          }
        })
    );

    return res.status(200).json({
      items,
      nextToken: listed.IsTruncated ? listed.NextContinuationToken : null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
