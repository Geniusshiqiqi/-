const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const RuralData = require("./data.js");

loadEnv();

const root = __dirname;
const isVercel = Boolean(process.env.VERCEL);
const dataDir = isVercel ? path.join(os.tmpdir(), "rural-wenlv-main-data") : path.join(root, "data");
const dbPath = path.join(dataDir, "rural.sqlite");
const port = Number(process.env.PORT || 5174);
const submissionPortalUrl = process.env.SUBMISSION_PORTAL_URL || "http://127.0.0.1:5184/";
const submissionPortalDir = process.env.SUBMISSION_PORTAL_DIR || path.resolve(root, "..", "乡村文旅申报入口");
const submissionAdminToken = process.env.SUBMISSION_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "local-review";
const submittedCoverDir = isVercel ? path.join(os.tmpdir(), "rural-wenlv-submitted-covers") : path.join(root, "assets", "submitted-covers");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(submittedCoverDir, { recursive: true });

const db = new DatabaseSync(dbPath);
initDatabase();
seedDatabase();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, {
      message: "服务暂时不可用",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

if (isVercel) {
  server.listen(port, () => {
    console.log(`乡行共创已启动：Vercel Node server on ${port}`);
    console.log(`数据库位置：${dbPath}`);
  });
} else {
  server.listen(port, "127.0.0.1", () => {
    console.log(`乡行共创已启动：http://127.0.0.1:${port}/`);
    console.log(`数据库位置：${dbPath}`);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, buildBootstrap());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submissions/import-approved") {
    const result = await importApprovedSubmissions();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/villages") {
    const q = url.searchParams.get("q") || "";
    const province = url.searchParams.get("province") || "all";
    sendJson(res, 200, searchVillages(q, province));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/villages/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const village = getVillage(id);
    if (!village) {
      sendJson(res, 404, { message: "未找到村镇" });
      return;
    }
    sendJson(res, 200, village);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/plans/generate") {
    const payload = await readJson(req);
    const plan = await createPlan(payload);
    sendJson(res, 200, plan);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/destinations/intake") {
    const payload = await readJson(req);
    const result = await intakeDestination(payload);
    sendJson(res, 201, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/plans") {
    sendJson(res, 200, listPlans());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/plans") {
    const payload = await readJson(req);
    const saved = savePlan(payload.plan || payload);
    sendJson(res, 201, saved);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/plans/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    db.prepare("DELETE FROM plans WHERE id = ?").run(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const payload = await readJson(req);
    sendJson(res, 201, createBooking(payload));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    sendJson(res, 200, listBookings());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/resources") {
    const payload = await readJson(req);
    sendJson(res, 201, createResourceSubmission(payload));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/resources") {
    sendJson(res, 200, listResources(url.searchParams.get("villageId")));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const payload = await readJson(req);
    sendJson(res, 201, createFeedback(payload));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/weather") {
    const villageId = url.searchParams.get("villageId");
    const village = getVillage(villageId);
    if (!village) {
      sendJson(res, 404, { message: "未找到村镇" });
      return;
    }
    sendJson(res, 200, await getWeather(village));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/route") {
    const from = getVillage(url.searchParams.get("from"));
    const to = getVillage(url.searchParams.get("to"));
    if (!from || !to) {
      sendJson(res, 404, { message: "路线村镇不存在" });
      return;
    }
    sendJson(res, 200, await getRoute(from, to));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/map/static") {
    await sendStaticMap(res, url);
    return;
  }

  sendJson(res, 404, { message: "API 不存在" });
}

function buildBootstrap() {
  return {
    meta: RuralData.meta,
    personas: RuralData.personas,
    experienceTags: RuralData.experienceTags,
    villages: listVillages(),
    resources: listResources(),
    evidence: listEvidence(),
    marketStats: RuralData.marketStats,
    plans: listPlans(),
    bookings: listBookings(),
    runtime: {
      aiEnabled: Boolean(process.env.DEEPSEEK_API_KEY),
      weatherProvider: "Open-Meteo",
      routeProvider: process.env.AMAP_API_KEY ? "高德 Web服务 + 本地兜底" : "OSRM + 本地兜底",
      database: "SQLite",
      submissionPortalUrl,
    },
  };
}

async function createPlan(rawForm) {
  const form = normalizeForm(rawForm);
  const villages = await selectRouteVillages(rankVillages(form), form);
  const activities = buildActivities(villages, form);
  const days = groupByDay(activities, form.days, form.pace, villages);
  const transfers = await buildTransfers(villages);
  const cost = estimateCost(days, form, transfers);
  const impact = estimateImpact(days, form, villages, cost);
  const risks = buildRisks(villages, form, cost, transfers);
  const weather = await Promise.all(villages.slice(0, 3).map(getWeather));

  let plan = {
    id: `plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: buildTitle(form, villages),
    summary: "围绕村镇体验、研学记录和助农转化生成的可执行路线。",
    persona: findPersona(form.personaId),
    villages,
    days,
    cost,
    impact,
    risks,
    weather,
    transfers,
    checklist: defaultChecklist(form),
    localEtiquette: defaultEtiquette(),
    sources: listEvidence().slice(0, 4),
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    form,
    ai: { enabled: Boolean(process.env.DEEPSEEK_API_KEY), used: false, provider: "local-rules" },
  };

  const aiEnhancement = await generateAiEnhancement(plan);
  if (aiEnhancement) {
    plan = mergeAiPlan(plan, aiEnhancement);
  }

  return plan;
}

async function selectRouteVillages(rankedVillages, form) {
  const count = Math.min(Math.max(form.days, 2), 4);
  const pinnedVillages = resolvePinnedVillages(form, count);
  if (pinnedVillages.length) {
    const candidates = dedupeVillages(rankedVillages, pinnedVillages).filter((village) => !pinnedVillages.some((target) => target.id === village.id));
    return await completeRouteCluster(pinnedVillages, candidates, count, form);
  }
  const candidates = dedupeVillages(form.region === "all" ? rankedVillages : rankedVillages.filter((village) => village.province === form.region));
  if (!candidates.length) return rankedVillages.slice(0, count);
  if (form.region === "all") {
    const groups = groupByProvince(candidates);
    const targetSize = Math.min(count, 3);
    const viableGroups = groups.filter((group) => group.length >= targetSize);
    if (viableGroups.length) {
      const bestGroup = viableGroups
        .map((group) => ({
          group,
          clusterScore: provinceClusterScore(group, count),
        }))
        .sort((a, b) => b.clusterScore - a.clusterScore)[0].group;
      return await completeRouteCluster(bestGroup.slice(0, 1), candidates, count, form);
    }
  }

  const anchor = candidates[0];
  const sameProvince = candidates.filter((village) => village.province === anchor.province);
  const pool = sameProvince.length >= count ? sameProvince : candidates;
  const shortlist = pool
    .map((village) => ({
      ...village,
      routeScore: (village.score || village.matchScore || 80) - distancePenalty(anchor, village, form),
    }))
    .sort((a, b) => b.routeScore - a.routeScore)
    .slice(0, Math.max(count * 2, 6));
  return await completeRouteCluster([shortlist[0]], shortlist.slice(1), count, form);
}

function groupByProvince(villages) {
  const groups = new Map();
  for (const village of villages) {
    const items = groups.get(village.province) || [];
    items.push(village);
    groups.set(village.province, items);
  }
  return [...groups.values()];
}

function provinceClusterScore(group, count) {
  const top = group.slice(0, count);
  const score = top.reduce((sum, village) => sum + (village.score || village.matchScore || 80), 0);
  const compactness = top.length > 1 ? top.slice(1).reduce((sum, village) => sum + distanceKm(top[0], village), 0) / top.length : 0;
  return score + top.length * 18 - Math.min(26, compactness / 35);
}

async function completeRouteCluster(selected, candidates, count, form) {
  const picked = dedupeVillages(selected);
  const poolCandidates = dedupeVillages(candidates, picked);
  const maxMinutes = maxLegMinutes(form);
  while (picked.length < count) {
    const scored = await Promise.all(poolCandidates
      .filter((village) => !picked.some((item) => sameVillageIdentity(item, village)))
      .slice(0, 10)
      .map(async (village) => {
        const routes = await Promise.all(picked.map((item) => getRoute(item, village)));
        const nearestRoute = routes.sort((a, b) => a.minutes - b.minutes)[0];
        const nearest = nearestRoute?.distanceKm ?? Math.min(...picked.map((item) => distanceKm(item, village)));
        const minutes = nearestRoute?.minutes ?? Math.round((nearest / 45) * 60);
        const sameProvinceBonus = picked.some((item) => item.province === village.province) ? 12 : 0;
        const sameCityBonus = picked.some((item) => item.city === village.city) ? 14 : 0;
        const overLimitPenalty = minutes > maxMinutes ? (minutes - maxMinutes) * 0.42 + 30 : 0;
        const compactPenalty = nearest > 450 ? 45 : nearest / (form.pace === "compact" ? 42 : 28);
        return {
          ...village,
          nearestMinutes: minutes,
          routeScore: (village.score || village.matchScore || 80) + sameProvinceBonus + sameCityBonus - compactPenalty - overLimitPenalty,
        };
      }));
    const feasible = scored.filter((item) => item.nearestMinutes <= maxMinutes);
    const pool = feasible.length ? feasible : scored.filter((item) => item.routeScore >= (picked[0].score || 80) - 18);
    const next = pool.sort((a, b) => b.routeScore - a.routeScore)[0];
    if (!next) break;
    picked.push(next);
  }
  return orderRouteVillages(picked);
}

function distancePenalty(anchor, village, form) {
  if (!anchor || anchor.id === village.id) return 0;
  if (anchor.province === village.province) return Math.min(8, distanceKm(anchor, village) / 55);
  const divisor = form.pace === "compact" ? 90 : 55;
  return Math.min(24, distanceKm(anchor, village) / divisor);
}

function maxLegMinutes(form) {
  if (form.pace === "compact") return 90;
  if (form.pace === "slow") return 140;
  return 120;
}

function orderRouteVillages(villages) {
  const unique = dedupeVillages(villages);
  if (unique.length <= 2) return unique;
  const remaining = [...unique].sort((a, b) => b.score - a.score);
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const nextIndex = remaining
      .map((village, index) => ({ index, distance: distanceKm(last, village), score: village.score || village.matchScore || 80 }))
      .sort((a, b) => a.distance - b.distance || b.score - a.score)[0].index;
    ordered.push(remaining.splice(nextIndex, 1)[0]);
  }
  return ordered;
}

function dedupeVillages(villages, protectedVillages = []) {
  const result = [];
  const seen = new Set(protectedVillages.map(villageIdentityKey));
  for (const village of villages) {
    const key = villageIdentityKey(village);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(village);
  }
  return result;
}

function sameVillageIdentity(a, b) {
  return villageIdentityKey(a) === villageIdentityKey(b);
}

function villageIdentityKey(village = {}) {
  const name = normalizeIntentText(village.name || "").replace(/(古镇|油画村|千户苗寨|壮寨|侗寨|苗寨|羌寨|藏寨|古村|村|寨|镇)$/u, "");
  const province = normalizeIntentText(village.province || "");
  return `${province}:${name || normalizeIntentText(village.id || "")}`;
}

function normalizeForm(raw = {}) {
  const persona = findPersona(raw.personaId);
  const tags = Array.isArray(raw.tags) && raw.tags.length ? raw.tags : persona.preferences;
  return {
    personaId: persona.id,
    days: clamp(Number(raw.days) || persona.days, 1, 7),
    budget: clamp(Number(raw.budget) || persona.budget, 300, 8000),
    pace: ["slow", "balanced", "compact"].includes(raw.pace) ? raw.pace : persona.pace,
    region: raw.region || "all",
    tags: tags.filter((tag) => RuralData.experienceTags.some((item) => item.id === tag)).slice(0, 8),
    departure: String(raw.departure || "").slice(0, 40),
    startDate: String(raw.startDate || "").slice(0, 20),
    groupSize: clamp(Number(raw.groupSize) || 2, 1, 80),
    note: String(raw.note || "").slice(0, 300),
    targetVillageId: String(raw.targetVillageId || "").slice(0, 80),
  };
}

function rankVillages(form) {
  return listVillages()
    .map((village) => {
      const tagHits = form.tags.filter((tag) => village.tags.includes(tag)).length;
      const persona = findPersona(form.personaId);
      const personaHits = persona.preferences.filter((tag) => village.tags.includes(tag)).length;
      const budgetFit = budgetFitScore(village, form.budget);
      const paceFit = paceFitScore(village, form.pace);
      const regionBoost = form.region === "all" || village.province === form.region ? 7 : 0;
      const intentBoost = villageIntentScore(village, form) >= 80 ? 42 : 0;
      const noteBoost = notePreferenceScore(village, form.note);
      const score = village.matchScore * 0.45 + tagHits * 9 + personaHits * 7 + budgetFit + paceFit + regionBoost + intentBoost + noteBoost;
      return { ...village, score: Math.min(99, Math.round(score)) };
    })
    .sort((a, b) => b.score - a.score);
}

function resolvePinnedVillages(form, count) {
  const ids = [
    form.targetVillageId,
    ...detectRequestedVillages(form).map((village) => village.id),
  ].filter(Boolean);
  return [...new Set(ids)]
    .map(getVillage)
    .filter(Boolean)
    .slice(0, count)
    .map((village, index) => ({ ...village, score: 99 - index, explicitIntent: true }));
}

function detectRequestedVillages(form) {
  return listVillages()
    .map((village) => ({ village, intentScore: villageIntentScore(village, form) }))
    .filter((item) => item.intentScore >= 80)
    .sort((a, b) => b.intentScore - a.intentScore)
    .map((item) => item.village);
}

function villageIntentScore(village, form = {}) {
  const text = normalizeIntentText([form.note, form.destination].filter(Boolean).join(" "));
  if (!text) return 0;
  const name = normalizeIntentText(village.name);
  if (name && text.includes(name)) return 100;
  const exactTerm = villageNameTerms(village)
    .map(normalizeIntentText)
    .filter(Boolean)
    .find((term) => text.includes(term));
  if (!exactTerm) return 0;
  return exactTerm.length >= 4 ? 94 : 86;
}

function villageNameTerms(village) {
  const suffixPattern = /(古镇|油画村|千户苗寨|壮寨|侗寨|苗寨|羌寨|藏寨|古村|村|寨|镇)$/;
  const manual = {
    xijiang: ["西江千户苗寨", "西江苗寨", "雷山西江", "千户苗寨", "西江"],
    zhaoxing: ["肇兴侗寨", "黎平肇兴", "肇兴"],
    hongcun: ["宏村"],
    xidi: ["西递村", "西递"],
  };
  const values = [village.name, ...(manual[village.id] || [])];
  const stripped = String(village.name || "").replace(suffixPattern, "");
  if (stripped && stripped !== village.name) values.push(stripped);
  return [...new Set(values)].filter((term) => {
    const normalized = normalizeIntentText(term);
    return normalized.length >= 2 && !["苗寨", "侗寨", "古镇", "古村", "千户", "乡村"].includes(normalized);
  });
}

function notePreferenceScore(village, note = "") {
  const text = normalizeIntentText(note);
  if (!text) return 0;
  const tokens = intentTokens(text);
  const score = villagePreferenceTerms(village).reduce((sum, term) => {
    const value = normalizeIntentText(term);
    if (value.length < 2) return sum;
    if (text.includes(value)) return sum + (value.length >= 4 ? 5 : 3);
    if (tokens.some((token) => value.includes(token))) return sum + 2;
    return sum;
  }, 0);
  return Math.min(24, score);
}

function villagePreferenceTerms(village) {
  const manual = {
    xijiang: ["苗银", "银饰", "苗绣", "吊脚楼", "夜景", "酸汤鱼", "苗族", "观景台", "西江"],
    zhaoxing: ["侗族大歌", "侗歌", "鼓楼", "蓝染", "侗族", "长桌饭", "稻鱼鸭", "肇兴"],
    hongcun: ["月沼", "南湖", "徽州", "水系", "毛豆腐", "宏村"],
    xidi: ["牌坊", "胡文光", "徽派", "明清街巷", "西递"],
  };
  const values = [
    ...(manual[village.id] || []),
    village.name,
    village.label,
    village.fallbackVisual,
    ...(village.highlights || []),
    ...(village.resources || []),
    ...(village.products || []),
    ...(village.spots || []).flatMap((spot) => [spot.name, spot.type, spot.desc]),
  ];
  return values
    .flatMap((value) => String(value || "").split(/[、，,；;与和\s]+/))
    .filter(Boolean);
}

function intentTokens(value) {
  const text = normalizeIntentText(value);
  const stopWords = new Set(["想去", "需要", "可以", "路线", "旅游", "文旅", "体验", "看看", "喜欢", "安排", "需求", "补充", "以及", "一个", "这个", "那个", "最好", "不要", "不想"]);
  const tokens = [];
  for (const size of [4, 3, 2]) {
    for (let index = 0; index <= text.length - size; index += 1) {
      const token = text.slice(index, index + size);
      if (!stopWords.has(token) && !/^[的是了和与或在有去看想要]+$/.test(token)) tokens.push(token);
    }
  }
  return [...new Set(tokens)];
}

function normalizeIntentText(value) {
  return String(value || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

function budgetFitScore(village, budget) {
  if (budget < 900) return village.capacity === "低" ? 2 : 8;
  if (budget > 1800) return village.tags.includes("homestay") ? 10 : 6;
  return village.capacity === "中" ? 9 : 6;
}

function paceFitScore(village, pace) {
  if (pace === "slow") return village.tags.includes("homestay") || village.tags.includes("nature") ? 8 : 4;
  if (pace === "compact") return village.capacity === "高" ? 8 : 3;
  return 6;
}

function buildActivities(villages, form) {
  const tagName = (id) => RuralData.experienceTags.find((tag) => tag.id === id)?.name || id;
  const base = [];
  const usedSpotIds = new Set();

  villages.forEach((village, index) => {
    const introSpot = pickSpot(village, ["fieldwork", "heritage"], usedSpotIds);
    base.push(
      introSpot
        ? spotToActivity(introSpot, village, "09:30", "围绕真实点位建立调研问题，记录资源、游客痛点和可转化体验。")
        : {
            villageId: village.id,
            villageName: village.name,
            title: `${village.name}村落导览与议题认领`,
            time: "09:30",
            duration: "2小时",
            type: "田野调研",
            tags: ["fieldwork", "heritage"],
            cost: 60,
            bookingRequired: true,
            value: `围绕${village.label}建立调研问题，记录村落资源、游客痛点和可转化体验。`,
          }
    );

    const primaryTag = form.tags.find((tag) => village.tags.includes(tag)) || village.tags[0];
    const primarySpot = pickSpot(village, [primaryTag, ...form.tags], usedSpotIds);
    base.push(
      primarySpot
        ? spotToActivity(primarySpot, village, index % 2 === 0 ? "14:00" : "10:30", activityValue(primaryTag, village))
        : {
            villageId: village.id,
            villageName: village.name,
            title: `${tagName(primaryTag)}深度体验`,
            time: index % 2 === 0 ? "14:00" : "10:30",
            duration: form.pace === "compact" ? "1.5小时" : "2.5小时",
            type: tagName(primaryTag),
            tags: [primaryTag],
            cost: primaryTag === "homestay" ? 280 : primaryTag === "craft" ? 120 : 90,
            bookingRequired: ["craft", "farming", "homestay"].includes(primaryTag),
            value: activityValue(primaryTag, village),
          }
    );

    if (form.tags.includes("commerce") || form.tags.includes("resource") || index === villages.length - 1) {
      const commerceSpot = pickSpot(village, ["commerce", "resource", "food"], usedSpotIds);
      base.push(
        commerceSpot
          ? spotToActivity(commerceSpot, village, "16:30", `把${village.products.slice(0, 2).join("、")}接入行程结尾，设计从体验到购买的转化节点。`)
          : {
              villageId: village.id,
              villageName: village.name,
              title: "特产溯源与助农转化",
              time: "16:30",
              duration: "1小时",
              type: "助农展销",
              tags: ["commerce", "resource"],
              cost: 80,
              bookingRequired: false,
              value: `把${village.products.slice(0, 2).join("、")}接入行程结尾，设计从体验到购买的转化节点。`,
            }
      );
    }
  });

  if (form.pace === "slow") {
    const nightSpot = pickSpot(villages[0], ["homestay", "food", "heritage"], usedSpotIds);
    base.push({
      villageId: villages[0].id,
      villageName: villages[0].name,
      title: nightSpot?.name || "乡居夜谈与村民访谈",
      time: "19:30",
      duration: nightSpot?.duration || "1.5小时",
      type: nightSpot?.type || "慢游停留",
      tags: nightSpot?.tags || ["homestay", "fieldwork"],
      cost: Number(nightSpot?.price) || 50,
      bookingRequired: nightSpot?.bookingRequired ?? true,
      value: nightSpot?.desc || "把住宿从消费点变成内容点，补齐普通乡村网页很少呈现的夜间体验。",
      spotId: nightSpot?.id,
      bestTime: nightSpot?.bestTime,
    });
  }

  return base;
}

function pickSpot(village, preferredTags = [], usedSpotIds = new Set()) {
  const spots = Array.isArray(village.spots) ? village.spots : [];
  const available = spots.filter((spot) => !usedSpotIds.has(spot.id));
  if (!available.length) return null;
  const scored = available
    .map((spot, index) => {
      const tags = Array.isArray(spot.tags) ? spot.tags : [];
      const tagScore = preferredTags.reduce((score, tag) => score + (tags.includes(tag) ? 4 : 0), 0);
      const bookingScore = spot.bookingRequired ? 1 : 0;
      return { spot, score: tagScore + bookingScore + Math.max(0, 5 - index) * 0.1 };
    })
    .sort((a, b) => b.score - a.score);
  const selected = scored[0]?.spot || available[0];
  if (selected?.id) usedSpotIds.add(selected.id);
  return selected;
}

function spotToActivity(spot, village, time, fallbackValue) {
  return {
    villageId: village.id,
    villageName: village.name,
    spotId: spot.id,
    title: spot.name,
    time,
    duration: spot.duration || "1.5小时",
    type: spot.type || "文旅体验",
    tags: spot.tags || village.tags.slice(0, 2),
    cost: Number(spot.price) || 60,
    bookingRequired: Boolean(spot.bookingRequired),
    bestTime: spot.bestTime,
    value: spot.desc || fallbackValue || `围绕${village.label}设计可记录、可复盘的乡村体验。`,
  };
}

function activityValue(tag, village) {
  const map = {
    farming: `结合${village.fallbackVisual}做农事流程讲解，解决乡村景观素材少但体验内容可讲的问题。`,
    craft: `串联当地工坊和手作老师，形成可体验、可转化、可带走的非遗内容。`,
    heritage: `以村史、建筑和民俗为主线，不靠单纯风景图片堆砌。`,
    food: `用地方餐食和特产溯源拉长消费链路，带动村民经营主体。`,
    nature: `把徒步点位和安全提示纳入路线，而不是只展示山水照片。`,
    homestay: `将民宿余房与研学停留绑定，提高淡季和周中资源利用率。`,
    fieldwork: `沉淀访谈提纲、观察点和答辩可用的调研证据。`,
    commerce: `把特产从“卖货卡片”改成行程内的体验转化。`,
    resource: `识别闲置院落、田块、工坊空档等资源，做数字化匹配。`,
  };
  return map[tag] || `围绕${village.label}设计可记录、可复盘的乡村体验。`;
}

function groupByDay(activities, totalDays, pace, villages = []) {
  const perDay = pace === "compact" ? 4 : pace === "slow" ? 2 : 3;
  const days = [];
  const byVillage = new Map();
  const cursorByVillage = new Map();
  for (const activity of activities) {
    const items = byVillage.get(activity.villageId) || [];
    items.push(activity);
    byVillage.set(activity.villageId, items);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const village = villages[Math.min(day - 1, villages.length - 1)];
    const villageItems = village ? byVillage.get(village.id) || [] : [];
    const cursor = village ? cursorByVillage.get(village.id) || 0 : 0;
    const items = villageItems.length ? villageItems.slice(cursor, cursor + perDay) : activities.slice((day - 1) * perDay, (day - 1) * perDay + perDay);
    if (village) cursorByVillage.set(village.id, cursor + items.length);
    if (!items.length) {
      const fallbackVillage = village || villages[day % Math.max(1, villages.length)] || listVillages()[(day - 1) % listVillages().length];
      items.push({
        villageId: fallbackVillage.id,
        villageName: fallbackVillage.name,
        title: "自由调研与弹性补位",
        time: "10:00",
        duration: "半日",
        type: "弹性安排",
        tags: ["fieldwork"],
        cost: 40,
        bookingRequired: false,
        value: "预留给天气、交通和访谈对象变动，降低行程执行风险。",
      });
    }

    days.push({
      day,
      title: dayTitle(day, totalDays, items),
      villageNames: [...new Set(items.map((item) => item.villageName))],
      items,
    });
  }
  return days;
}

function dayTitle(day, totalDays, items) {
  if (day === 1) return "进入村落：建立调研问题";
  if (day === totalDays) return "助农转化：形成可展示成果";
  if (items.some((item) => item.tags.includes("farming"))) return "农事体验：从参与到记录";
  if (items.some((item) => item.tags.includes("craft"))) return "非遗工坊：从体验到文创";
  return "多点串联：补齐住宿、餐食与交通";
}

function estimateCost(days, form, transfers = []) {
  const activity = days.flatMap((day) => day.items).reduce((sum, item) => sum + item.cost, 0);
  const stay = Math.max(0, form.days - 1) * (form.budget > 1500 ? 360 : form.budget < 900 ? 160 : 240);
  const transferCost = transfers.reduce((sum, item) => sum + Math.max(0, item.distanceKm || 0) * 1.8, 0);
  const transport = Math.round((form.pace === "compact" ? 180 : 140) + transferCost);
  const food = form.days * (form.budget > 1500 ? 150 : 95);
  const total = activity + stay + transport + food;
  return {
    activity,
    stay,
    transport,
    food,
    total,
    perPerson: Math.round(total),
    status: total <= form.budget ? "within" : total <= form.budget * 1.18 ? "near" : "over",
    gap: Math.round(total - form.budget),
  };
}

function estimateImpact(days, form, villages, cost) {
  const items = days.flatMap((day) => day.items);
  const directIncome = Math.round(cost.total * 0.58 * Math.max(1, form.groupSize / 2));
  const household = Math.max(3, Math.round(items.length * 1.35));
  const idleAssets = listResources().filter((asset) => villages.some((village) => village.id === asset.villageId));
  return {
    directIncome,
    household,
    idleAssets: idleAssets.length,
    localPurchase: Math.round(cost.total * 0.22 * Math.max(1, form.groupSize / 2)),
    researchOutputs: Math.min(8, items.length + form.tags.length),
  };
}

function buildRisks(villages, form, cost, transfers = []) {
  const risks = [];
  if (cost.status === "over") {
    risks.push({
      level: "high",
      title: "预算超出",
      text: `当前估算比预算高${Math.abs(cost.gap)}元，建议减少跨村移动或替换为村内体验。`,
    });
  }
  if (villages.some((village) => village.capacity === "低")) {
    risks.push({
      level: "medium",
      title: "承载有限",
      text: "部分村落接待容量偏低，适合小队提前确认，不适合大团突然到访。",
    });
  }
  if (form.tags.includes("farming")) {
    risks.push({
      level: "medium",
      title: "农事季节性",
      text: "插秧、收割、采摘会随季节变化，正式出发前需二次确认农户排期。",
    });
  }
  if (form.pace === "compact") {
    risks.push({
      level: "low",
      title: "路线节奏偏紧",
      text: "紧凑路线适合快速体验，但真实出行建议保留访谈和交通缓冲。",
    });
  }
  const longTransfer = transfers.find((item) => item.minutes > maxLegMinutes(form));
  if (longTransfer) {
    risks.push({
      level: "high",
      title: "跨村车程过长",
      text: `${longTransfer.from}到${longTransfer.to}约${longTransfer.minutes}分钟，建议拆成单独目的地或改做深度停留。`,
    });
  }
  risks.push({
    level: "low",
    title: "数据边界",
    text: "预算和增收为估算值；正式出发前应二次确认交通、天气、经营主体排期和价格。",
  });
  return risks;
}

async function generateAiEnhancement(plan) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const compact = {
    form: plan.form,
    requestedVillages: plan.villages.filter((village) => village.explicitIntent).map((village) => village.name),
    villages: plan.villages.map((village) => ({
      name: village.name,
      province: village.province,
      label: village.label,
      tags: village.tags,
      highlights: village.highlights,
      painPoints: village.painPoints,
      products: village.products,
    })),
    days: plan.days.map((day) => ({
      day: day.day,
      title: day.title,
      items: day.items.map((item) => ({
        title: item.title,
        villageName: item.villageName,
        type: item.type,
        value: item.value,
      })),
    })),
    risks: plan.risks,
  };

  const prompt =
    "你是一个乡村文旅产品经理和旅行规划师。请基于输入路线生成可执行优化，只输出JSON，不要Markdown。字段：title, summary, checklist数组, localEtiquette数组, riskSuggestions数组, dayNotes对象(键为D1/D2)。要求不要编造具体库存、电话、真实价格；提醒用户提前确认开放时间和二次核验。不得新增、替换或改写路线村镇名称；如果requestedVillages不为空，title和summary必须保留这些村镇名。\n" +
    JSON.stringify(compact);

  try {
    const response = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你只输出严格JSON。你不会虚构真实商家联系方式、实时库存、实际订单状态。你会把不确定信息标为需二次确认。你必须尊重用户点名目的地，不能把输入村镇替换成相似村寨。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    }, 15000);

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function mergeAiPlan(plan, ai) {
  const merged = { ...plan };
  const requiredVillageNames = plan.villages.filter((village) => village.explicitIntent).map((village) => village.name);
  if (typeof ai.title === "string" && ai.title.trim() && !looksCorrupt(ai.title)) {
    const title = ai.title.trim().slice(0, 80);
    if (!requiredVillageNames.length || requiredVillageNames.every((name) => title.includes(name))) {
      merged.title = title;
    }
  }
  if (typeof ai.summary === "string" && ai.summary.trim()) {
    const summary = ai.summary.trim().slice(0, 260);
    if (!requiredVillageNames.length || requiredVillageNames.every((name) => summary.includes(name) || plan.summary.includes(name))) {
      merged.summary = summary;
    }
  }
  if (Array.isArray(ai.checklist)) merged.checklist = ai.checklist.map(cleanShort).filter(Boolean).slice(0, 8);
  if (Array.isArray(ai.localEtiquette)) {
    merged.localEtiquette = ai.localEtiquette.map(cleanShort).filter(Boolean).slice(0, 8);
  }
  if (Array.isArray(ai.riskSuggestions)) {
    const extraRisks = ai.riskSuggestions.map(cleanShort).filter(Boolean).slice(0, 4).map((text) => ({
      level: "medium",
      title: "AI优化建议",
      text,
    }));
    merged.risks = sortRisksBySeverity(dedupeRisks([...merged.risks, ...extraRisks])).slice(0, 8);
  }
  if (ai.dayNotes && typeof ai.dayNotes === "object") {
    merged.days = merged.days.map((day) => ({
      ...day,
      aiNote: cleanShort(ai.dayNotes[`D${day.day}`] || ai.dayNotes[String(day.day)] || ""),
    }));
  }
  merged.ai = { enabled: true, used: true, provider: "DeepSeek" };
  return merged;
}

function dedupeRisks(risks = []) {
  const seen = new Set();
  return risks.filter((risk) => {
    const text = normalizeIntentText(`${risk.title || ""}${risk.text || ""}`)
      .replace(/^ai优化建议/, "")
      .slice(0, 34);
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function sortRisksBySeverity(risks = []) {
  const order = { high: 0, medium: 1, low: 2 };
  return [...risks].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
}

function cleanShort(value) {
  return stringifyAiValue(value).replace(/\s+/g, " ").trim().slice(0, 180);
}

function stringifyAiValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyAiValue).filter(Boolean).join("；");
  if (typeof value === "object") {
    const direct = value.note || value.text || value.summary || value.content || value.advice || value.description;
    if (direct) return stringifyAiValue(direct);
    return Object.entries(value)
      .map(([, item]) => stringifyAiValue(item))
      .filter(Boolean)
      .join("；");
  }
  return "";
}

function looksCorrupt(value) {
  const text = String(value || "");
  if (!text.trim()) return true;
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks >= Math.max(4, text.length * 0.35);
}

function defaultChecklist(form) {
  const list = ["提前确认体验老师和民宿排期", "保留天气和交通缓冲", "携带适合乡村步行的鞋服"];
  if (form.tags.includes("farming")) list.push("农事体验前确认季节、工具和安全边界");
  if (form.tags.includes("fieldwork")) list.push("准备访谈提纲，并征得受访者同意");
  if (form.tags.includes("commerce")) list.push("购买特产前确认产地、价格和物流方式");
  return list;
}

function defaultEtiquette() {
  return ["尊重村民生活空间，不进入未开放院落", "拍摄人物前先征得同意", "不踩踏农田和梯田田埂", "垃圾随身带走或投入指定点"];
}

async function buildTransfers(villages) {
  const transfers = [];
  for (let i = 0; i < villages.length - 1; i += 1) {
    transfers.push(await getRoute(villages[i], villages[i + 1]));
  }
  return transfers;
}

async function getWeather(village) {
  const cached = getCache(`weather:${village.id}`, 1000 * 60 * 20);
  if (cached) return cached;

  const fallback = {
    villageId: village.id,
    villageName: village.name,
    provider: "local-season",
    label: village.bestSeason,
    temperature: null,
    windSpeed: null,
    weatherCode: null,
    advice: "出行前建议再次查询当地天气；农事和山野体验受天气影响较大。",
  };

  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${village.lat}&longitude=${village.lng}` +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&forecast_days=1&timezone=Asia%2FShanghai";
    const response = await fetchWithTimeout(url, {}, 8000);
    if (!response.ok) throw new Error("weather failed");
    const json = await response.json();
    const weather = {
      villageId: village.id,
      villageName: village.name,
      provider: "Open-Meteo",
      label: weatherCodeLabel(json.current?.weather_code),
      temperature: Math.round(json.current?.temperature_2m),
      windSpeed: Math.round(json.current?.wind_speed_10m || 0),
      weatherCode: json.current?.weather_code,
      advice: weatherAdvice(json.current?.weather_code),
      updatedAt: new Date().toISOString(),
    };
    setCache(`weather:${village.id}`, weather);
    return weather;
  } catch {
    return fallback;
  }
}

async function getRoute(from, to) {
  const routeProvider = process.env.AMAP_API_KEY ? "amap" : "osrm";
  const cacheKey = `route:${routeProvider}:${from.id}:${to.id}`;
  const cached = getCache(cacheKey, 1000 * 60 * 60 * 12);
  if (cached) return cached;

  const local = localRoute(from, to);
  const amapKey = process.env.AMAP_API_KEY;
  if (amapKey) {
    try {
      const amapRoute = await fetchAmapRoute(from, to, amapKey);
      if (amapRoute) {
        setCache(cacheKey, amapRoute);
        return amapRoute;
      }
    } catch {
      // Continue to OSRM and local fallback.
    }
  }

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      "?overview=false&alternatives=false&steps=false";
    const response = await fetchWithTimeout(url, {}, 10000);
    if (!response.ok) throw new Error("route failed");
    const json = await response.json();
    const route = json.routes?.[0];
    if (!route) throw new Error("empty route");
    const result = {
      from: from.name,
      to: to.name,
      provider: "OSRM",
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      minutes: Math.max(1, Math.round(route.duration / 60)),
      note: "公开路线服务估算，国内偏远道路可能不完整，出发前请用高德/百度二次确认。",
    };
    setCache(cacheKey, result);
    return result;
  } catch {
    setCache(cacheKey, local);
    return local;
  }
}

async function sendStaticMap(res, url) {
  const key = process.env.AMAP_API_KEY;
  if (!key) {
    sendJson(res, 503, { message: "未配置高德 Web 服务 Key" });
    return;
  }

  const markers = String(url.searchParams.get("markers") || "").slice(0, 2500);
  const paths = String(url.searchParams.get("paths") || "").slice(0, 2500);
  const size = String(url.searchParams.get("size") || "760*360").slice(0, 20);
  const location = String(url.searchParams.get("location") || "").slice(0, 40);
  const zoom = String(url.searchParams.get("zoom") || "").replace(/[^\d]/g, "").slice(0, 2);
  const amapUrl =
    "https://restapi.amap.com/v3/staticmap" +
    `?key=${encodeURIComponent(key)}` +
    `&size=${encodeURIComponent(size)}` +
    (markers ? `&markers=${encodeURIComponent(markers)}` : "") +
    (paths ? `&paths=${encodeURIComponent(paths)}` : "") +
    (location ? `&location=${encodeURIComponent(location)}` : "") +
    (zoom ? `&zoom=${encodeURIComponent(zoom)}` : "") +
    "&scale=2";

  try {
    const response = await fetchWithTimeout(amapUrl, {}, 10000);
    if (!response.ok) throw new Error("static map failed");
    const type = response.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) throw new Error("static map returned non-image");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(buffer);
  } catch (error) {
    sendJson(res, 502, { message: "高德静态地图暂时不可用", detail: error.message });
  }
}

async function fetchAmapRoute(from, to, key) {
  const origin = `${from.lng},${from.lat}`;
  const destination = `${to.lng},${to.lat}`;
  const url =
    "https://restapi.amap.com/v3/direction/driving" +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&key=${encodeURIComponent(key)}` +
    "&extensions=base";
  const response = await fetchWithTimeout(url, {}, 8000);
  if (!response.ok) return null;
  const json = await response.json();
  const path = json.route?.paths?.[0];
  if (json.status !== "1" || !path) return null;
  return {
    from: from.name,
    to: to.name,
    provider: "Amap",
    distanceKm: Math.round((Number(path.distance) / 1000) * 10) / 10,
    minutes: Math.max(1, Math.round(Number(path.duration) / 60)),
    note: "高德地图驾车路径估算；实际出行仍需以实时导航为准。",
  };
}

function localRoute(from, to) {
  const km = distanceKm(from, to);
  return {
    from: from.name,
    to: to.name,
    provider: "local-haversine",
    distanceKm: Math.round(km * 10) / 10,
    minutes: Math.max(20, Math.round((km / 45) * 60 + 20)),
    note: "按坐标直线距离估算；正式出行请接入高德/百度地图路径规划。",
  };
}

function distanceKm(a, b) {
  const earth = 6371;
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const lat1 = deg2rad(a.lat);
  const lat2 = deg2rad(b.lat);
  const hav =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return earth * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function deg2rad(value) {
  return value * (Math.PI / 180);
}

function weatherCodeLabel(code) {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "降雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "降雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "天气变化";
}

function weatherAdvice(code) {
  if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code)) {
    return "雨天会影响农事、山路和梯田观景，建议保留室内工坊备选。";
  }
  if ([45, 48].includes(code)) return "雾天能见度较低，山野徒步和观景点需谨慎安排。";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪天交通和步道风险升高，建议减少跨村移动。";
  return "天气条件基本可行，仍建议出发前复核当地预报。";
}

function findPersona(id) {
  return RuralData.personas.find((item) => item.id === id) || RuralData.personas[0];
}

function buildTitle(form, villages) {
  const persona = findPersona(form.personaId);
  const names = villages.slice(0, 2).map((item) => item.name).join(" + ");
  return `${persona.name}${form.days}日乡村文旅路线：${names}`;
}

function listVillages() {
  return db.prepare("SELECT data FROM villages ORDER BY province, name").all().map((row) => JSON.parse(row.data));
}

function getVillage(id) {
  if (!id) return null;
  const row = db.prepare("SELECT data FROM villages WHERE id = ?").get(id);
  return row ? JSON.parse(row.data) : null;
}

function searchVillages(q, province) {
  const keyword = q.trim().toLowerCase();
  return listVillages().filter((village) => {
    const inProvince = province === "all" || !province || village.province === province;
    const inText =
      !keyword ||
      [
        village.name,
        village.province,
        village.city,
        village.address,
        village.transportNode,
        village.label,
        ...(village.tags || []),
        ...(village.highlights || []),
        ...(village.spots || []).flatMap((spot) => [
          spot.name,
          spot.type,
          spot.desc,
          ...(Array.isArray(spot.tags) ? spot.tags : [spot.tags].filter(Boolean)),
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    return inProvince && inText;
  });
}

function listResources(villageId) {
  const rows = villageId
    ? db.prepare("SELECT data FROM resources WHERE village_id = ? ORDER BY type, title").all(villageId)
    : db.prepare("SELECT data FROM resources ORDER BY type, title").all();
  return rows.map((row) => {
    const resource = JSON.parse(row.data);
    return { ...resource, village: getVillage(resource.villageId) };
  });
}

function listEvidence() {
  return db.prepare("SELECT data FROM evidence ORDER BY id").all().map((row) => JSON.parse(row.data));
}

function listPlans() {
  return db.prepare("SELECT id, title, created_at, data FROM plans ORDER BY created_at DESC LIMIT 30").all().map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    ...JSON.parse(row.data),
  }));
}

function savePlan(plan) {
  if (!plan || !plan.id) throw new Error("方案数据无效");
  const title = String(plan.title || "未命名方案").slice(0, 100);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO plans (id, title, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data"
  ).run(plan.id, title, JSON.stringify(plan), now);
  return { ok: true, id: plan.id, title, createdAt: now };
}

function createBooking(payload) {
  const name = requiredText(payload.name, "记录人");
  const contact = String(payload.contact || "").trim().slice(0, 80);
  const travelDate = requiredText(payload.travelDate, "出行日期");
  const groupSize = clamp(Number(payload.groupSize) || 1, 1, 200);
  const plan = payload.plan || null;
  const id = `booking-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO bookings (id, name, contact, travel_date, group_size, note, plan_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    name,
    contact,
    travelDate,
    groupSize,
    String(payload.note || "").slice(0, 500),
    plan?.id || payload.planId || "",
    JSON.stringify({ ...payload, contact: contact ? maskContact(contact) : "" }),
    now
  );
  return { ok: true, id, createdAt: now, message: "需求记录已保存到本地数据库。" };
}

function listBookings() {
  return db
    .prepare("SELECT id, name, travel_date, group_size, note, plan_id, created_at FROM bookings ORDER BY created_at DESC LIMIT 30")
    .all();
}

function createResourceSubmission(payload) {
  const villageId = requiredText(payload.villageId, "村镇");
  if (!getVillage(villageId)) throw new Error("村镇不存在");
  const title = requiredText(payload.title, "资源名称");
  const contact = String(payload.contact || "").trim().slice(0, 80);
  const id = `resource-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const resource = {
    id,
    type: String(payload.type || "待核验资源").slice(0, 30),
    villageId,
    title,
    owner: String(payload.owner || "调研记录").slice(0, 40),
    currentState: String(payload.currentState || "待核验").slice(0, 60),
    fit: Array.isArray(payload.fit) ? payload.fit.slice(0, 5) : ["resource"],
    estimateIncome: Math.max(0, Number(payload.estimateIncome) || 0),
    risk: String(payload.risk || "学生项目记录，需后续核验").slice(0, 120),
    action: String(payload.action || "适合进入路线匹配，后续可补充真实开放时间和价格。").slice(0, 180),
    status: "pending",
    contact: contact ? maskContact(contact) : "",
    submittedAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO resources (id, village_id, type, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, villageId, resource.type, title, JSON.stringify(resource), resource.submittedAt);
  return { ok: true, id, message: "资源记录已保存，当前为学生项目模拟数据。", resource };
}

async function importApprovedSubmissions() {
  const exportUrl = new URL("/api/export/approved", submissionPortalUrl).toString();
  const response = await fetchWithTimeout(exportUrl, {
    headers: { "x-admin-token": submissionAdminToken },
  }, 12000);
  if (!response.ok) throw new Error("申报副站暂不可用，无法同步审核通过数据");
  const payload = await response.json();
  const villages = Array.isArray(payload.villages) ? payload.villages : [];
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  const now = new Date().toISOString();
  let importedVillages = 0;
  let importedResources = 0;
  const villageIdMap = new Map();
  const legacyVillageIds = [];

  const villageStmt = db.prepare(
    "INSERT INTO villages (id, province, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET province = excluded.province, name = excluded.name, data = excluded.data, updated_at = excluded.updated_at"
  );
  for (const rawVillage of villages) {
    const village = normalizeSubmittedVillage(rawVillage);
    const sourceId = cleanText(rawVillage.id || "", 100);
    if (sourceId) villageIdMap.set(sourceId, village.id);
    if (sourceId && sourceId !== village.id) legacyVillageIds.push(sourceId);
    villageStmt.run(village.id, village.province, village.name, JSON.stringify(village), now);
    importedVillages += 1;
  }
  for (const legacyId of legacyVillageIds) {
    db.prepare("DELETE FROM villages WHERE id = ?").run(legacyId);
    db.prepare("DELETE FROM resources WHERE village_id = ?").run(legacyId);
  }

  const resourceStmt = db.prepare(
    "INSERT INTO resources (id, village_id, type, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET village_id = excluded.village_id, type = excluded.type, title = excluded.title, data = excluded.data"
  );
  for (const rawResource of resources) {
    const resource = normalizeSubmittedResource(rawResource, villageIdMap);
    if (!resource.villageId) continue;
    resourceStmt.run(resource.id, resource.villageId, resource.type, resource.title, JSON.stringify(resource), now);
    importedResources += 1;
  }

  return {
    ok: true,
    source: exportUrl,
    importedVillages,
    importedResources,
    message: `已同步${importedVillages}个村镇、${importedResources}条资源。`,
  };
}

function normalizeSubmittedVillage(raw = {}) {
  const existing = findBaseVillage(raw.name, raw.province) || findExistingVillage(raw.name, raw.province);
  const id = cleanText(existing?.id || raw.id || `submitted-${slugify(raw.name || Date.now())}`, 80);
  const submittedCover = importSubmittedCover(raw.cover, id);
  const fallbackTags = normalizeTags(raw.tags).length ? normalizeTags(raw.tags) : existing?.tags || ["fieldwork", "resource"];
  return {
    ...(existing || {}),
    id,
    name: cleanText(existing?.name || raw.name || "待命名村镇", 40),
    province: cleanText(existing?.province || raw.province || "待核验", 20),
    city: cleanText(existing?.city || raw.city || "待核验", 50),
    address: cleanText(raw.address || existing?.address || `${raw.province || existing?.province || ""}${raw.city || existing?.city || ""}${raw.name || existing?.name || ""}`, 120),
    label: cleanText(existing?.label || raw.label || "村镇自荐入库资料", 60),
    cover: submittedCover || existing?.cover || RuralData.heroImage,
    fallbackVisual: cleanText(existing?.fallbackVisual || raw.fallbackVisual || raw.label || "村镇自荐资料，待补充图文素材", 160),
    lat: Number(raw.lat) || existing?.lat || 30.5,
    lng: Number(raw.lng) || existing?.lng || 114.3,
    transportNode: cleanText(raw.transportNode || existing?.transportNode || "正式出发前使用高德地图核验交通节点", 120),
    bestSeason: cleanText(raw.bestSeason || existing?.bestSeason || "待补充", 40),
    matchScore: clamp(Number(raw.matchScore) || existing?.matchScore || 82, 60, 98),
    capacity: ["低", "中", "高"].includes(raw.capacity) ? raw.capacity : existing?.capacity || "中",
    stayNights: clamp(Number(raw.stayNights) || existing?.stayNights || 1, 0, 5),
    tags: fallbackTags,
    highlights: mergeTextList(existing?.highlights, raw.highlights, 8, ["村镇自荐特色", "待平台审核补充"]),
    painPoints: mergeTextList(existing?.painPoints, raw.painPoints, 8, ["申报数据需平台二次核验"]),
    resources: mergeTextList(existing?.resources, raw.resources, 8, ["待核验接待资源"]),
    products: mergeTextList(existing?.products, raw.products, 8, ["待核验地方产品"]),
    sourceType: existing
      ? cleanText(`${existing.sourceType || "主站资料"} + 村镇自荐补充 / 待核验`, 100)
      : cleanText(raw.sourceType || "村镇自荐申报 / 主站同步入库", 80),
    spots: mergeSpots(existing?.spots, raw.spots, id, fallbackTags),
    submissionId: cleanText(raw.submissionId || "", 80),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSubmittedResource(raw = {}, villageIdMap = new Map()) {
  const sourceVillageId = cleanText(raw.villageId || "", 80);
  const villageId = villageIdMap.get(sourceVillageId) || sourceVillageId;
  const id = cleanText(raw.id || `submitted-resource-${villageId}-${slugify(raw.title || Date.now())}`, 100);
  return {
    id,
    villageId,
    type: cleanText(raw.type || "申报资源", 30),
    title: cleanText(raw.title || "待核验资源", 80),
    owner: cleanText(raw.owner || "村镇自荐", 40),
    currentState: cleanText(raw.currentState || "申报入库，待平台核验", 80),
    fit: normalizeTags(raw.fit).length ? normalizeTags(raw.fit) : ["resource"],
    estimateIncome: Math.max(0, Number(raw.estimateIncome) || 0),
    risk: cleanText(raw.risk || "需核验经营主体、价格、容量和开放时段", 140),
    action: cleanText(raw.action || "可作为路线生成素材，审核后进入资源匹配。", 200),
    status: "submitted-approved",
    submissionId: cleanText(raw.submissionId || "", 80),
    submittedAt: new Date().toISOString(),
  };
}

function importSubmittedCover(cover, villageId) {
  const value = String(cover || "").trim();
  if (!value || /^https?:\/\//i.test(value)) return value;
  const relative = value.replace(/^\.?[\\/]/, "");
  const source = path.normalize(path.join(submissionPortalDir, relative));
  const sourceLower = source.toLowerCase();
  const portalLower = path.normalize(submissionPortalDir).toLowerCase();
  if (!sourceLower.startsWith(portalLower) || !fs.existsSync(source)) return value;
  const ext = path.extname(source).toLowerCase() || ".jpg";
  const targetName = `${villageId}${ext}`.replace(/[^\u4e00-\u9fa5a-z0-9._-]/gi, "-");
  const target = path.join(submittedCoverDir, targetName);
  fs.copyFileSync(source, target);
  return `./assets/submitted-covers/${targetName}`;
}

async function intakeDestination(payload) {
  const destination = requiredText(payload.destination, "乡村景点");
  const provinceHint = String(payload.province || "").trim().slice(0, 20);
  const cityHint = String(payload.city || "").trim().slice(0, 40);
  const persona = findPersona(payload.personaId);
  const tags = normalizeTags(Array.isArray(payload.tags) && payload.tags.length ? payload.tags : persona.preferences);
  const form = normalizeForm({
    personaId: persona.id,
    days: payload.days || persona.days,
    budget: payload.budget || persona.budget,
    pace: payload.pace || persona.pace,
    region: provinceHint || "all",
    tags,
    departure: payload.departure,
    startDate: payload.startDate,
    groupSize: payload.groupSize,
    note: payload.note,
  });

  const rawAiDraft = await generateDestinationDraft({
    destination,
    province: provinceHint,
    city: cityHint,
    form,
    note: String(payload.note || "").slice(0, 300),
  });
  const aiDraft = validateDestinationDraft(rawAiDraft, { destination, province: provinceHint, city: cityHint });
  const draft = aiDraft || localDestinationDraft(destination, provinceHint, cityHint, form);
  const village = upsertIntakeVillage(draft.village, { destination, province: provinceHint, city: cityHint, form });
  const resources = upsertIntakeResources(village.id, draft.resources || [], form.tags);
  const plan = await createPlan({
    ...form,
    region: village.province,
    tags: village.tags,
    targetVillageId: village.id,
    note: `${destination}点对点路线。${form.note || ""}`.trim(),
  });

  return {
    ok: true,
    aiUsed: Boolean(aiDraft),
    message: aiDraft ? "AI已生成目的地画像并写入村镇库。" : "已使用本地规则生成待核验目的地画像。",
    village,
    resources,
    plan,
  };
}

function validateDestinationDraft(draft, context) {
  if (!draft || typeof draft !== "object" || !draft.village) return null;
  const village = draft.village;
  const destinationKey = normalizeIntentText(context.destination);
  const nameKey = normalizeIntentText(village.name);
  const invalidName = !nameKey || /待定|未知|示例|某|xx|\?\?/i.test(String(village.name || ""));
  const preservesIntent = destinationKey && (nameKey.includes(destinationKey) || destinationKey.includes(nameKey));
  const provinceOk = !context.province || !village.province || normalizeIntentText(village.province).includes(normalizeIntentText(context.province));
  if (invalidName || !preservesIntent || !provinceOk || hasPlaceholder(village.address) || hasPlaceholder(village.transportNode)) return null;
  return draft;
}

function hasPlaceholder(value) {
  return /(\?\?|XX|xx|待定|未知|某县|某乡|某村|某站)/i.test(String(value || ""));
}

async function generateDestinationDraft(input) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const tagOptions = RuralData.experienceTags.map((tag) => `${tag.id}:${tag.name}`).join("、");
  const prompt =
    "你是乡村文旅产品经理。请基于用户想去的乡村景点，生成可入库的乡村文旅数据，只输出严格JSON。不要编造电话、实时库存、官方认证；不确定信息写入painPoints或sourceType的待核验提示。JSON结构：{village:{name,province,city,address,transportNode,label,fallbackVisual,lat,lng,bestSeason,capacity,stayNights,tags,highlights,painPoints,resources,products,spots},resources:[{type,title,owner,currentState,fit,estimateIncome,risk,action}]}。address写到县/乡镇/村或景区入口层级即可；transportNode写最近高铁站/机场/县城接驳提示。lat/lng如不确定可按目的地公开常识给粗略坐标并在painPoints提示核验；spots为5个，每个含{name,type,duration,price,bookingRequired,tags,bestTime,desc}。tags/fit只能使用这些id：" +
    tagOptions +
    "。\n用户输入：" +
    JSON.stringify(input);

  try {
    const response = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "你只输出严格JSON。禁止编造真实联系方式、实时价格库存、官方认证。所有数据是待核验产品草案。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.45,
        response_format: { type: "json_object" },
      }),
    }, 20000);
    if (!response.ok) return null;
    const data = await response.json();
    return JSON.parse(data.choices?.[0]?.message?.content || "{}");
  } catch {
    return null;
  }
}

function upsertIntakeVillage(rawVillage = {}, context) {
  const now = new Date().toISOString();
  const existing = findExistingVillage(rawVillage.name || context.destination, context.province);
  const baseId = existing?.id || `ai-${slugify(`${context.province || rawVillage.province || "rural"}-${rawVillage.name || context.destination}`)}`;
  const village = {
    ...(existing || {}),
    id: baseId,
    name: cleanText(rawVillage.name || context.destination, 40),
    province: cleanText(rawVillage.province || context.province || "待核验", 20),
    city: cleanText(rawVillage.city || context.city || "待核验", 40),
    address: cleanText(hasPlaceholder(rawVillage.address) ? "" : rawVillage.address || existing?.address || `${rawVillage.province || context.province || ""}${rawVillage.city || context.city || ""}${rawVillage.name || context.destination}`, 120),
    label: cleanText(rawVillage.label || `${context.destination}点对点乡村文旅目的地`, 40),
    cover: existing?.cover || RuralData.heroImage,
    fallbackVisual: cleanText(rawVillage.fallbackVisual || `${context.destination}村落景观、地方饮食、手作体验和周边慢游`, 120),
    lat: Number(rawVillage.lat) || existing?.lat || 30.5,
    lng: Number(rawVillage.lng) || existing?.lng || 114.3,
    transportNode: cleanText(hasPlaceholder(rawVillage.transportNode) ? "" : rawVillage.transportNode || existing?.transportNode || "AI生成位置，正式出发前使用高德地图核验接驳方式", 120),
    bestSeason: cleanText(rawVillage.bestSeason || "全年可规划，正式出行前需核验季节活动", 40),
    matchScore: clamp(Number(rawVillage.matchScore) || existing?.matchScore || 86, 60, 98),
    capacity: ["低", "中", "高"].includes(rawVillage.capacity) ? rawVillage.capacity : existing?.capacity || "中",
    stayNights: clamp(Number(rawVillage.stayNights) || existing?.stayNights || Math.max(0, context.form.days - 1), 0, 5),
    tags: normalizeTags(rawVillage.tags).length ? normalizeTags(rawVillage.tags) : context.form.tags,
    highlights: cleanList(rawVillage.highlights, 5, ["点对点目的地导览", "地方餐食体验", "村民访谈与调研", "伴手礼转化"]),
    painPoints: cleanList(rawVillage.painPoints, 5, ["AI生成数据需后续调研核验", "开放时间、价格和接待主体需二次确认"]),
    resources: cleanList(rawVillage.resources, 5, ["导览员", "餐食点", "手作空间", "民宿或休息点"]),
    products: cleanList(rawVillage.products, 5, ["地方特产", "手作文创", "乡味餐食"]),
    sourceType: "AI采集生成 / 待调研核验",
    spots: normalizeSpots(rawVillage.spots, baseId, context.form.tags),
    updatedAt: now,
  };

  db.prepare(
    "INSERT INTO villages (id, province, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET province = excluded.province, name = excluded.name, data = excluded.data, updated_at = excluded.updated_at"
  ).run(village.id, village.province, village.name, JSON.stringify(village), now);
  return village;
}

function upsertIntakeResources(villageId, rawResources = [], fallbackTags = []) {
  const now = new Date().toISOString();
  const resources = (Array.isArray(rawResources) && rawResources.length ? rawResources : localResourceDrafts(villageId, fallbackTags))
    .slice(0, 4)
    .map((item, index) => ({
      id: `ai-resource-${villageId}-${slugify(item.title || item.type || String(index + 1))}`.slice(0, 90),
      type: cleanText(item.type || "AI待核验资源", 30),
      villageId,
      title: cleanText(item.title || `目的地资源${index + 1}`, 60),
      owner: cleanText(item.owner || "待调研核验", 40),
      currentState: cleanText(item.currentState || "AI生成，待核验", 60),
      fit: normalizeTags(item.fit).length ? normalizeTags(item.fit) : fallbackTags.slice(0, 4),
      estimateIncome: Math.max(0, Math.round(Number(item.estimateIncome) || 1200 + index * 300)),
      risk: cleanText(item.risk || "需核验经营主体、价格、容量和开放时段", 120),
      action: cleanText(item.action || "适合进入点对点路线，后续可补充真实开放时间、价格和容量。", 180),
      status: "ai-draft",
      submittedAt: now,
    }));

  const stmt = db.prepare(
    "INSERT INTO resources (id, village_id, type, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET village_id = excluded.village_id, type = excluded.type, title = excluded.title, data = excluded.data"
  );
  for (const resource of resources) {
    stmt.run(resource.id, villageId, resource.type, resource.title, JSON.stringify(resource), now);
  }
  return resources;
}

function findExistingVillage(name, province) {
  const target = normalizeIntentText(name);
  const targetProvince = normalizeIntentText(province);
  if (!target) return null;
  return listVillages().filter((village) => {
    const villageName = normalizeIntentText(village.name);
    const villageProvince = normalizeIntentText(village.province);
    const sameName = villageName === target || target.includes(villageName) || villageName.includes(target);
    const sameProvince = !targetProvince || villageProvince === targetProvince || targetProvince.includes(villageProvince) || villageProvince.includes(targetProvince);
    return sameName && sameProvince;
  }).sort((a, b) => villageMergePriority(a) - villageMergePriority(b))[0] || null;
}

function villageMergePriority(village) {
  if (!village?.id) return 9;
  if (String(village.id).startsWith("user-")) return 3;
  if (String(village.id).startsWith("ai-")) return 2;
  return 1;
}

function findBaseVillage(name, province) {
  const target = normalizeIntentText(name);
  const targetProvince = normalizeIntentText(province);
  if (!target) return null;
  return RuralData.villages.find((village) => {
    const villageName = normalizeIntentText(village.name);
    const villageProvince = normalizeIntentText(village.province);
    const sameName = villageName === target || target.includes(villageName) || villageName.includes(target);
    const sameProvince = !targetProvince || villageProvince === targetProvince || targetProvince.includes(villageProvince) || villageProvince.includes(targetProvince);
    return sameName && sameProvince;
  }) || null;
}

function mergeTextList(primary, secondary, limit, fallback = []) {
  const values = [...cleanList(primary, limit, []), ...cleanList(secondary, limit, [])];
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    const key = normalizeIntentText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
    if (merged.length >= limit) break;
  }
  return merged.length ? merged : fallback;
}

function mergeSpots(primary, secondary, villageId, fallbackTags = []) {
  const source = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])];
  const normalized = normalizeSpots(source, villageId, fallbackTags);
  const seen = new Set();
  const merged = [];
  for (const spot of normalized) {
    const key = normalizeIntentText(spot.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(spot);
    if (merged.length >= 8) break;
  }
  return merged;
}

function localDestinationDraft(destination, province, city, form) {
  return {
    village: {
      name: destination,
      province: province || "待核验",
      city: city || "待核验",
      address: localAddressHint(destination, province, city),
      transportNode: "待核验目的地：正式出发前请使用高德地图确认最近高铁站、机场或县城接驳方式",
      label: "AI待核验乡村文旅目的地",
      tags: form.tags,
      spots: normalizeSpots([], slugify(destination), form.tags),
    },
    resources: localResourceDrafts("", form.tags),
  };
}

function localResourceDrafts(villageId, tags) {
  return [
    { type: "导览资源", title: "目的地导览与访谈点", fit: ["fieldwork", "heritage"], estimateIncome: 1200 },
    { type: "体验资源", title: "地方手作或农事体验位", fit: tags, estimateIncome: 1600 },
    { type: "餐食资源", title: "乡味餐食与伴手礼转化点", fit: ["food", "commerce"], estimateIncome: 1800 },
  ];
}

function localAddressHint(destination, province, city) {
  const parts = [];
  if (province) parts.push(province.endsWith("省") || province.endsWith("市") || province.endsWith("自治区") ? province : `${province}省`);
  if (city) parts.push(city);
  parts.push(`${destination}（待核验具体村镇/景区入口）`);
  return parts.join("");
}

function normalizeSpots(rawSpots, villageId, fallbackTags = []) {
  const source = Array.isArray(rawSpots) && rawSpots.length ? rawSpots : [
    { name: "目的地村落导览", type: "村落导览", duration: "1.5小时", price: 60, bookingRequired: true, tags: ["heritage", "fieldwork"], bestTime: "09:30-11:00", desc: "围绕村落空间、地方故事和游客动线建立第一站认知。" },
    { name: "地方手作或农事体验", type: "在地体验", duration: "2小时", price: 108, bookingRequired: true, tags: fallbackTags, bestTime: "14:00-16:00", desc: "根据当地真实资源二次核验后接入小班体验。" },
    { name: "乡味餐食与特产转化", type: "乡土风味", duration: "1.5小时", price: 88, bookingRequired: true, tags: ["food", "commerce"], bestTime: "11:30-13:00", desc: "把餐食、伴手礼和地方产品接进行程结尾。" },
  ];
  return source.slice(0, 8).map((spot, index) => ({
    id: `${villageId}-spot-${index + 1}-${slugify(spot.name || "spot")}`.slice(0, 90),
    name: cleanText(spot.name || `文旅点位${index + 1}`, 50),
    type: cleanText(spot.type || "文旅体验", 30),
    duration: cleanText(spot.duration || "1.5小时", 20),
    price: Math.max(0, Math.round(Number(spot.price) || 60)),
    bookingRequired: spot.bookingRequired !== false,
    tags: normalizeTags(spot.tags).length ? normalizeTags(spot.tags) : fallbackTags.slice(0, 3),
    bestTime: cleanText(spot.bestTime || "需二次确认", 30),
    desc: cleanText(spot.desc || "AI生成的待核验体验点，需后续补充真实开放信息。", 140),
  }));
}

function normalizeTags(tags) {
  const byId = new Map(RuralData.experienceTags.map((tag) => [tag.id, tag.id]));
  const byName = new Map(RuralData.experienceTags.map((tag) => [tag.name, tag.id]));
  const raw = Array.isArray(tags) ? tags : String(tags || "").split(/[,\s、，]+/);
  return [...new Set(raw.map((tag) => byId.get(String(tag).trim()) || byName.get(String(tag).trim())).filter(Boolean))];
}

function cleanList(value, limit, fallback = []) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[;；、\n]/);
  const cleaned = items.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, limit);
  return cleaned.length ? cleaned : fallback;
}

function cleanText(value, max = 100) {
  return stringifyAiValue(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function slugify(value) {
  const ascii = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!ascii) return Math.random().toString(16).slice(2, 8);
  return encodeURIComponent(ascii).replace(/%/g, "").slice(0, 48).toLowerCase();
}

function createFeedback(payload) {
  const content = requiredText(payload.content, "反馈内容");
  const id = `feedback-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO feedback (id, type, content, contact, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      id,
      String(payload.type || "general").slice(0, 30),
      content,
      String(payload.contact || "").slice(0, 80),
      JSON.stringify(payload),
      now
    );
  return { ok: true, id, createdAt: now, message: "反馈已保存。" };
}

function getCache(key, ttlMs) {
  const row = db.prepare("SELECT value, updated_at FROM api_cache WHERE key = ?").get(key);
  if (!row) return null;
  if (Date.now() - Number(row.updated_at) > ttlMs) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function setCache(key, value) {
  db.prepare(
    "INSERT INTO api_cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), Date.now());
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      province TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      group_size INTEGER NOT NULL,
      note TEXT,
      plan_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      type TEXT,
      content TEXT NOT NULL,
      contact TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function seedDatabase() {
  const now = new Date().toISOString();
  const villageStmt = db.prepare(
    "INSERT INTO villages (id, province, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET province = excluded.province, name = excluded.name, data = excluded.data, updated_at = excluded.updated_at"
  );
  for (const village of RuralData.villages) {
    villageStmt.run(village.id, village.province, village.name, JSON.stringify(village), now);
  }

  const resourceStmt = db.prepare(
    "INSERT INTO resources (id, village_id, type, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET village_id = excluded.village_id, type = excluded.type, title = excluded.title, data = excluded.data"
  );
  for (const resource of RuralData.resourceAssets) {
    resourceStmt.run(resource.id, resource.villageId, resource.type, resource.title, JSON.stringify(resource), now);
  }

  const evidenceStmt = db.prepare("INSERT INTO evidence (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data");
  for (const item of RuralData.evidence) {
    evidenceStmt.run(item.id, JSON.stringify(item));
  }
}

function serveStatic(pathname, res) {
  const safePath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
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
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": filePath.includes(`${path.sep}vendor${path.sep}`) ? "public, max-age=604800" : "no-cache",
    });
    res.end(data);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text.slice(0, 200);
}

function maskContact(value) {
  const text = String(value || "");
  if (text.includes("@")) {
    const [name, domain] = text.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return text.replace(/(\d{3})\d{4}(\d+)/, "$1****$2");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
