const http = require("http");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number(process.env.PORT || 5184);
const adminToken = process.env.ADMIN_TOKEN || process.env.SUBMISSION_ADMIN_TOKEN || "local-review";
const dataDir = path.join(root, "data");
const uploadDir = path.join(root, "uploads");
const dbPath = path.join(dataDir, "submissions.sqlite");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new DatabaseSync(dbPath);
initDatabase();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { message: "服务暂时不可用", detail: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`乡村文旅申报入口已启动：http://127.0.0.1:${port}/`);
  console.log(`数据库位置：${dbPath}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/stats") {
    sendJson(res, 200, submissionStats());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/submissions") {
    if (!requireAdmin(req, res)) return;
    const items = listSubmissions();
    sendJson(res, 200, { total: items.length, items });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const { fields, files } = await readMultipart(req);
    const item = createSubmission(fields, files);
    sendJson(res, 201, item);
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/submissions\/[^/]+\/status$/)) {
    if (!requireAdmin(req, res)) return;
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const body = await readJson(req);
    const item = updateSubmissionStatus(id, body.status);
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export/approved") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, buildApprovedExport());
    return;
  }

  sendJson(res, 404, { message: "API 不存在" });
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      village_name TEXT NOT NULL,
      province TEXT NOT NULL,
      city TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function createSubmission(fields, files) {
  const now = new Date().toISOString();
  const tags = arrayValue(fields.tags).filter(Boolean).slice(0, 12);
  const villageName = requiredText(fields.villageName, "村镇名称", 60);
  const province = requiredText(fields.province, "省份", 30);
  const city = requiredText(fields.city, "市县", 60);
  const id = `sub-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const photos = savePhotos(files.photos || [], id);
  const item = {
    id,
    status: "pending",
    villageName,
    province,
    city,
    address: cleanText(fields.address, 120),
    lng: parseCoordinate(fields.lng),
    lat: parseCoordinate(fields.lat),
    tags,
    summary: requiredText(fields.summary, "一句话特色", 180),
    highlights: lines(fields.highlights, 12),
    experiences: lines(fields.experiences, 12),
    products: lines(fields.products, 12),
    audience: cleanText(fields.audience, 80),
    stayNights: clamp(Number(fields.stayNights) || 0, 0, 9),
    capacity: ["低", "中", "高"].includes(fields.capacity) ? fields.capacity : "中",
    transportNode: cleanText(fields.transportNode, 120),
    facilities: lines(fields.facilities, 12),
    painPoints: lines(fields.painPoints, 8),
    contactName: requiredText(fields.contactName, "联系人", 60),
    contactPhone: requiredText(fields.contactPhone, "联系方式", 80),
    permission: fields.permission === "on" || fields.permission === "true",
    photos,
    createdAt: now,
    updatedAt: now,
  };

  if (!item.permission) throw new Error("请确认资料展示授权");

  db.prepare(
    "INSERT INTO submissions (id, village_name, province, city, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(item.id, item.villageName, item.province, item.city, item.status, JSON.stringify(item), now, now);
  return item;
}

function listSubmissions() {
  return db.prepare("SELECT data FROM submissions ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data));
}

function submissionStats() {
  const items = listSubmissions();
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    approved: items.filter((item) => item.status === "approved" || item.status === "imported").length,
  };
}

function requireAdmin(req, res) {
  const provided = String(req.headers["x-admin-token"] || "");
  if (provided && provided === adminToken) return true;
  sendJson(res, 401, { message: "需要本地审核口令" });
  return false;
}

function updateSubmissionStatus(id, status) {
  if (!["pending", "approved", "rejected", "imported"].includes(status)) throw new Error("状态无效");
  const row = db.prepare("SELECT data FROM submissions WHERE id = ?").get(id);
  if (!row) throw new Error("申报记录不存在");
  const item = JSON.parse(row.data);
  item.status = status;
  item.updatedAt = new Date().toISOString();
  db.prepare("UPDATE submissions SET status = ?, data = ?, updated_at = ? WHERE id = ?").run(status, JSON.stringify(item), item.updatedAt, id);
  return item;
}

function buildApprovedExport() {
  const approved = listSubmissions().filter((item) => item.status === "approved" || item.status === "imported");
  return {
    exportedAt: new Date().toISOString(),
    source: "乡村文旅资源入库申报副站",
    villages: approved.map(toVillageRecord),
    resources: approved.flatMap(toResourceRecords),
  };
}

function toVillageRecord(item) {
  const baseId = `user-${slugify(`${item.province}-${item.city}-${item.villageName}`)}`;
  return {
    id: baseId,
    name: item.villageName,
    province: item.province,
    city: item.city,
    address: item.address,
    label: item.summary,
    cover: item.photos?.[0]?.url || "",
    fallbackVisual: [item.summary, ...item.highlights, ...item.products].filter(Boolean).slice(0, 6).join("、"),
    lat: item.lat,
    lng: item.lng,
    transportNode: item.transportNode,
    bestSeason: "待补充",
    matchScore: 82,
    capacity: item.capacity,
    stayNights: item.stayNights,
    tags: item.tags,
    highlights: item.highlights,
    painPoints: item.painPoints.length ? item.painPoints : ["申报数据需后续实地核验"],
    resources: item.facilities,
    products: item.products,
    sourceType: "村镇自荐申报 / 待平台审核核验",
    spots: item.experiences.slice(0, 8).map((text, index) => ({
      id: `${baseId}-spot-${index + 1}`,
      name: text.split(/[\/｜|]/)[0].trim().slice(0, 40) || `体验项目${index + 1}`,
      type: "申报体验",
      duration: "待确认",
      price: 0,
      bookingRequired: true,
      tags: item.tags.slice(0, 3),
      bestTime: "出发前确认",
      desc: text,
    })),
    submissionId: item.id,
  };
}

function toResourceRecords(item) {
  const villageId = `user-${slugify(`${item.province}-${item.city}-${item.villageName}`)}`;
  const resources = [
    ...item.facilities.map((title) => ({ type: "接待配套", title, fit: ["homestay", "food", "resource"] })),
    ...item.products.map((title) => ({ type: "特产助农", title, fit: ["commerce", "food"] })),
  ].slice(0, 10);
  return resources.map((resource, index) => ({
    id: `${villageId}-resource-${index + 1}`,
    villageId,
    type: resource.type,
    title: resource.title,
    owner: item.contactName,
    currentState: "村镇自荐申报，待平台核验",
    fit: resource.fit,
    estimateIncome: 1200 + index * 180,
    risk: "开放时间、接待主体、价格和图片授权需二次确认",
    action: "可作为路线生成素材，审核后进入主站资源匹配。",
    submissionId: item.id,
  }));
}

function savePhotos(files, submissionId) {
  return files.slice(0, 8).map((file, index) => {
    const ext = safeImageExt(file.filename, file.contentType);
    const filename = `${submissionId}-${index + 1}${ext}`;
    const target = path.join(uploadDir, filename);
    fs.writeFileSync(target, file.data);
    return {
      url: `./uploads/${filename}`,
      filename,
      originalName: cleanText(file.filename, 120),
      size: file.data.length,
      contentType: file.contentType,
    };
  });
}

function safeImageExt(filename, contentType) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}

function serveStatic(pathname, res) {
  const routePath = pathname === "/admin" ? "/admin.html" : pathname;
  const safePath = decodeURIComponent(routePath === "/" ? "/index.html" : routePath);
  const filePath = path.normalize(path.join(root, safePath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"] || "";
    const boundary = type.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || type.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) {
      reject(new Error("表单格式错误"));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error("上传内容超过 25MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(parseMultipart(Buffer.concat(chunks), boundary));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  const marker = Buffer.from(`--${boundary}`);
  let cursor = buffer.indexOf(marker);
  while (cursor !== -1) {
    cursor += marker.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const header = buffer.slice(cursor, headerEnd).toString("utf8");
    const next = buffer.indexOf(marker, headerEnd + 4);
    if (next === -1) break;
    let data = buffer.slice(headerEnd + 4, next);
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) data = data.slice(0, -2);
    const name = header.match(/name="([^"]+)"/)?.[1];
    const filename = header.match(/filename="([^"]*)"/)?.[1];
    const contentType = header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    if (name && filename) {
      if (data.length && contentType.startsWith("image/")) {
        const bucket = files[name] || [];
        bucket.push({ filename, contentType, data });
        files[name] = bucket;
      }
    } else if (name) {
      const value = data.toString("utf8");
      if (fields[name] !== undefined) {
        fields[name] = Array.isArray(fields[name]) ? [...fields[name], value] : [fields[name], value];
      } else {
        fields[name] = value;
      }
    }
    cursor = next;
  }
  return { fields, files };
}

function requiredText(value, label, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function cleanText(value, maxLength = 200) {
  return String(Array.isArray(value) ? value[0] : value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function lines(value, maxItems) {
  return String(Array.isArray(value) ? value.join("\n") : value || "")
    .split(/\r?\n|；|;/)
    .map((item) => cleanText(item, 180))
    .filter(Boolean)
    .slice(0, maxItems);
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function parseCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "rural";
}
