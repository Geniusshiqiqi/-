const API_BASE = (() => {
  if (window.location.protocol === "file:") return "http://127.0.0.1:5174";
  return "";
})();

const Api = {
  url(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
  },

  async request(path, options = {}) {
    const response = await fetch(this.url(path), {
      mode: API_BASE ? "cors" : "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || "服务请求失败");
    }
    return result;
  },

  bootstrap() {
    return this.request("/api/bootstrap");
  },

  generatePlan(form) {
    return this.request("/api/plans/generate", {
      method: "POST",
      body: JSON.stringify(form),
    });
  },

  intakeDestination(payload) {
    return this.request("/api/destinations/intake", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  importApprovedSubmissions() {
    return this.request("/api/submissions/import-approved", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  savePlan(plan) {
    return this.request("/api/plans", {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
  },

  createBooking(payload) {
    return this.request("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  submitResource(payload) {
    return this.request("/api/resources", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  submitFeedback(payload) {
    return this.request("/api/feedback", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

const LocalPlanner = {
  createPlan(form) {
    const villages = this.rankVillages(form);
    const selectedVillages = this.selectRouteVillages(villages, form);
    const activities = this.buildActivities(selectedVillages, form);
    const days = this.groupByDay(activities, form.days, form.pace, selectedVillages);
    const transfers = this.buildTransfers(selectedVillages);
    const cost = this.estimateCost(days, form, transfers);
    const impact = this.estimateImpact(days, form, selectedVillages, cost);
    const risks = this.buildRisks(selectedVillages, form, cost, transfers);

    return {
      id: `local-${Date.now()}`,
      title: this.buildTitle(form, selectedVillages),
      summary: "当前为本地预览，点击生成后使用高德驾车路径和AI增强。",
      persona: this.findPersona(form.personaId),
      villages: selectedVillages,
      days,
      cost,
      impact,
      risks,
      weather: selectedVillages.map((village) => ({
        villageId: village.id,
        villageName: village.name,
        provider: "local-season",
        label: village.bestSeason,
        advice: "出发前请查询实时天气。",
      })),
      transfers,
      checklist: ["提前确认体验排期", "保留天气和交通缓冲", "尊重村民生活空间"],
      localEtiquette: ["拍摄人物前先征得同意", "不进入未开放院落", "不踩踏农田"],
      sources: (window.RuralData?.evidence || []).slice(0, 4),
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      form: { ...form },
      ai: { enabled: false, used: false, provider: "local-rules" },
    };
  },

  selectRouteVillages(rankedVillages, form) {
    const count = Math.min(Math.max(form.days, 2), 4);
    const pinnedIds = [
      form.targetVillageId,
      ...this.detectRequestedVillages(form).map((village) => village.id),
    ].filter(Boolean);
    const pinnedVillages = [...new Set(pinnedIds)]
      .map((id) => (window.RuralData?.villages || []).find((village) => village.id === id))
      .filter(Boolean)
      .slice(0, count)
      .map((village, index) => ({ ...village, score: 99 - index, explicitIntent: true }));
    if (pinnedVillages.length) {
      const candidates = this.dedupeVillages(rankedVillages, pinnedVillages).filter((village) => !pinnedVillages.some((target) => target.id === village.id));
      return this.completeRouteCluster(pinnedVillages, candidates, count, form);
    }
    const candidates = this.dedupeVillages(form.region === "all" ? rankedVillages : rankedVillages.filter((village) => village.province === form.region));
    if (!candidates.length) return rankedVillages.slice(0, count);
    if (form.region === "all") {
      const groups = this.groupByProvince(candidates);
      const targetSize = Math.min(count, 3);
      const viableGroups = groups.filter((group) => group.length >= targetSize);
      if (viableGroups.length) {
        const bestGroup = viableGroups
          .map((group) => ({
            group,
            clusterScore: this.provinceClusterScore(group, count),
          }))
          .sort((a, b) => b.clusterScore - a.clusterScore)[0].group;
        return this.completeRouteCluster(bestGroup.slice(0, 1), candidates, count, form);
      }
    }
    const anchor = candidates[0];
    const sameProvince = candidates.filter((village) => village.province === anchor.province);
    const pool = sameProvince.length >= count ? sameProvince : candidates;
    const shortlist = pool
      .map((village) => ({
        ...village,
        routeScore: (village.score || village.matchScore || 80) - this.distancePenalty(anchor, village, form),
      }))
      .sort((a, b) => b.routeScore - a.routeScore)
      .slice(0, Math.max(count * 2, 6));
    return this.completeRouteCluster([shortlist[0]], shortlist.slice(1), count, form);
  },

  groupByProvince(villages) {
    const groups = new Map();
    villages.forEach((village) => {
      const items = groups.get(village.province) || [];
      items.push(village);
      groups.set(village.province, items);
    });
    return [...groups.values()];
  },

  provinceClusterScore(group, count) {
    const top = group.slice(0, count);
    const score = top.reduce((sum, village) => sum + (village.score || village.matchScore || 80), 0);
    const compactness = top.length > 1 ? top.slice(1).reduce((sum, village) => sum + this.distanceKm(top[0], village), 0) / top.length : 0;
    return score + top.length * 18 - Math.min(26, compactness / 35);
  },

  completeRouteCluster(selected, candidates, count, form) {
    const picked = this.dedupeVillages(selected);
    const poolCandidates = this.dedupeVillages(candidates, picked);
    const maxMinutes = this.maxLegMinutes(form);
    while (picked.length < count) {
      const next = poolCandidates
        .filter((village) => !picked.some((item) => this.sameVillageIdentity(item, village)))
        .slice(0, 10)
        .map((village) => {
          const nearest = Math.min(...picked.map((item) => this.distanceKm(item, village)));
          const minutes = Math.round((nearest / 42) * 60 + 20);
          const sameProvinceBonus = picked.some((item) => item.province === village.province) ? 12 : 0;
          const sameCityBonus = picked.some((item) => item.city === village.city) ? 14 : 0;
          const overLimitPenalty = minutes > maxMinutes ? (minutes - maxMinutes) * 0.42 + 30 : 0;
          const compactPenalty = nearest > 450 ? 45 : nearest / (form.pace === "compact" ? 42 : 28);
          return {
            ...village,
            nearestMinutes: minutes,
            routeScore: (village.score || village.matchScore || 80) + sameProvinceBonus + sameCityBonus - compactPenalty - overLimitPenalty,
          };
        })
        .filter((item) => item.nearestMinutes <= maxMinutes || item.routeScore >= (picked[0].score || 80) - 18)
        .sort((a, b) => b.routeScore - a.routeScore)[0];
      if (!next) break;
      picked.push(next);
    }
    return this.orderRouteVillages(picked);
  },

  distancePenalty(anchor, village, form) {
    if (!anchor || anchor.id === village.id) return 0;
    if (anchor.province === village.province) return Math.min(8, this.distanceKm(anchor, village) / 55);
    const divisor = form.pace === "compact" ? 90 : 55;
    return Math.min(24, this.distanceKm(anchor, village) / divisor);
  },

  maxLegMinutes(form) {
    if (form.pace === "compact") return 90;
    if (form.pace === "slow") return 140;
    return 120;
  },

  orderRouteVillages(villages) {
    const unique = this.dedupeVillages(villages);
    if (unique.length <= 2) return unique;
    const remaining = [...unique].sort((a, b) => b.score - a.score);
    const ordered = [remaining.shift()];
    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      const nextIndex = remaining
        .map((village, index) => ({ index, distance: this.distanceKm(last, village), score: village.score || village.matchScore || 80 }))
        .sort((a, b) => a.distance - b.distance || b.score - a.score)[0].index;
      ordered.push(remaining.splice(nextIndex, 1)[0]);
    }
    return ordered;
  },

  dedupeVillages(villages, protectedVillages = []) {
    const result = [];
    const seen = new Set(protectedVillages.map((village) => this.villageIdentityKey(village)));
    villages.forEach((village) => {
      const key = this.villageIdentityKey(village);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(village);
    });
    return result;
  },

  sameVillageIdentity(a, b) {
    return this.villageIdentityKey(a) === this.villageIdentityKey(b);
  },

  villageIdentityKey(village = {}) {
    const name = this.normalizeIntentText(village.name || "").replace(/(古镇|油画村|千户苗寨|壮寨|侗寨|苗寨|羌寨|藏寨|古村|村|寨|镇)$/u, "");
    const province = this.normalizeIntentText(village.province || "");
    return `${province}:${name || this.normalizeIntentText(village.id || "")}`;
  },

  buildTransfers(villages) {
    return villages.slice(0, -1).map((village, index) => {
      const to = villages[index + 1];
      const distanceKm = Math.round(this.distanceKm(village, to) * 10) / 10;
      return {
        from: village.name,
        to: to.name,
        provider: "local-preview",
        distanceKm,
        minutes: Math.max(20, Math.round((distanceKm / 42) * 60 + 20)),
        note: "本地预览按坐标估算；点击生成后使用高德驾车路径校准。",
      };
    });
  },

  distanceKm(a, b) {
    const earth = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const hav = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return earth * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  },

  rankVillages(form) {
    return (window.RuralData?.villages || [])
      .map((village) => {
        const tagHits = form.tags.filter((tag) => village.tags.includes(tag)).length;
        const persona = this.findPersona(form.personaId);
        const personaHits = persona.preferences.filter((tag) => village.tags.includes(tag)).length;
        const regionBoost = form.region === "all" || village.province === form.region ? 7 : 0;
        const intentBoost = this.villageIntentScore(village, form) >= 80 ? 42 : 0;
        const noteBoost = this.notePreferenceScore(village, form.note);
        const score = village.matchScore * 0.45 + tagHits * 9 + personaHits * 7 + regionBoost + noteBoost + intentBoost + 12;
        return { ...village, score: Math.min(99, Math.round(score)) };
      })
      .sort((a, b) => b.score - a.score);
  },

  detectRequestedVillages(form) {
    return (window.RuralData?.villages || [])
      .map((village) => ({ village, intentScore: this.villageIntentScore(village, form) }))
      .filter((item) => item.intentScore >= 80)
      .sort((a, b) => b.intentScore - a.intentScore)
      .map((item) => item.village);
  },

  villageIntentScore(village, form = {}) {
    const text = this.normalizeIntentText([form.note, form.destination].filter(Boolean).join(" "));
    if (!text) return 0;
    const name = this.normalizeIntentText(village.name);
    if (name && text.includes(name)) return 100;
    const exactTerm = this.villageNameTerms(village)
      .map((term) => this.normalizeIntentText(term))
      .filter(Boolean)
      .find((term) => text.includes(term));
    if (!exactTerm) return 0;
    return exactTerm.length >= 4 ? 94 : 86;
  },

  villageNameTerms(village) {
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
      const normalized = this.normalizeIntentText(term);
      return normalized.length >= 2 && !["苗寨", "侗寨", "古镇", "古村", "千户", "乡村"].includes(normalized);
    });
  },

  notePreferenceScore(village, note = "") {
    const text = this.normalizeIntentText(note);
    if (!text) return 0;
    const tokens = this.intentTokens(text);
    const score = this.villagePreferenceTerms(village).reduce((sum, term) => {
      const value = this.normalizeIntentText(term);
      if (value.length < 2) return sum;
      if (text.includes(value)) return sum + (value.length >= 4 ? 5 : 3);
      if (tokens.some((token) => value.includes(token))) return sum + 2;
      return sum;
    }, 0);
    return Math.min(24, score);
  },

  villagePreferenceTerms(village) {
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
  },

  intentTokens(value) {
    const text = this.normalizeIntentText(value);
    const stopWords = new Set(["想去", "需要", "可以", "路线", "旅游", "文旅", "体验", "看看", "喜欢", "安排", "需求", "补充", "以及", "一个", "这个", "那个", "最好", "不要", "不想"]);
    const tokens = [];
    for (const size of [4, 3, 2]) {
      for (let index = 0; index <= text.length - size; index += 1) {
        const token = text.slice(index, index + size);
        if (!stopWords.has(token) && !/^[的是了和与或在有去看想要]+$/.test(token)) tokens.push(token);
      }
    }
    return [...new Set(tokens)];
  },

  normalizeIntentText(value) {
    return String(value || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
  },

  findPersona(id) {
    return (window.RuralData?.personas || []).find((item) => item.id === id) || window.RuralData.personas[0];
  },

  buildTitle(form, villages) {
    const persona = this.findPersona(form.personaId);
    return `${persona.name}${form.days}日乡村文旅路线：${villages.slice(0, 2).map((item) => item.name).join(" + ")}`;
  },

  buildActivities(villages, form) {
    const items = [];
    const usedSpotIds = new Set();
    villages.forEach((village, index) => {
      const primaryTag = form.tags.find((tag) => village.tags.includes(tag)) || village.tags[0];
      const introSpot = this.pickSpot(village, ["fieldwork", "heritage"], usedSpotIds);
      items.push(
        introSpot
          ? this.spotToActivity(introSpot, village, "09:30")
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
              value: `围绕${village.label}建立调研问题，记录资源、痛点和体验转化机会。`,
            }
      );
      const primarySpot = this.pickSpot(village, [primaryTag, ...form.tags], usedSpotIds);
      items.push(
        primarySpot
          ? this.spotToActivity(primarySpot, village, index % 2 === 0 ? "14:00" : "10:30")
          : {
              villageId: village.id,
              villageName: village.name,
              title: `${this.tagName(primaryTag)}深度体验`,
              time: index % 2 === 0 ? "14:00" : "10:30",
              duration: form.pace === "compact" ? "1.5小时" : "2.5小时",
              type: this.tagName(primaryTag),
              tags: [primaryTag],
              cost: primaryTag === "homestay" ? 280 : primaryTag === "craft" ? 120 : 90,
              bookingRequired: ["craft", "farming", "homestay"].includes(primaryTag),
              value: `结合${village.fallbackVisual}设计体验，不依赖海量风景图片。`,
            }
      );
    });
    return items;
  },

  tagName(id) {
    return (window.RuralData?.experienceTags || []).find((tag) => tag.id === id)?.name || id;
  },

  pickSpot(village, preferredTags = [], usedSpotIds = new Set()) {
    const spots = Array.isArray(village.spots) ? village.spots : [];
    const available = spots.filter((spot) => !usedSpotIds.has(spot.id));
    if (!available.length) return null;
    const selected = available
      .map((spot, index) => ({
        spot,
        score: preferredTags.reduce((score, tag) => score + ((spot.tags || []).includes(tag) ? 4 : 0), 0) + Math.max(0, 5 - index) * 0.1,
      }))
      .sort((a, b) => b.score - a.score)[0].spot;
    if (selected.id) usedSpotIds.add(selected.id);
    return selected;
  },

  spotToActivity(spot, village, time) {
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
      value: spot.desc || `围绕${village.label}设计体验，不依赖海量风景图片。`,
    };
  },

  groupByDay(activities, days, pace, villages = []) {
    const perDay = pace === "compact" ? 4 : pace === "slow" ? 2 : 3;
    const byVillage = new Map();
    const cursorByVillage = new Map();
    activities.forEach((activity) => {
      const items = byVillage.get(activity.villageId) || [];
      items.push(activity);
      byVillage.set(activity.villageId, items);
    });
    return Array.from({ length: days }, (_, index) => {
      const village = villages[Math.min(index, villages.length - 1)];
      const villageItems = village ? byVillage.get(village.id) || [] : [];
      const cursor = village ? cursorByVillage.get(village.id) || 0 : 0;
      const dayItems = villageItems.length ? villageItems.slice(cursor, cursor + perDay) : activities.slice(index * perDay, index * perDay + perDay);
      if (village) cursorByVillage.set(village.id, cursor + dayItems.length);
      const finalItems = dayItems.length ? dayItems : [{
        villageId: village?.id || activities[index % activities.length]?.villageId || "fallback",
        villageName: village?.name || activities[index % activities.length]?.villageName || "目的地",
        title: "自由调研与弹性补位",
        time: "10:00",
        duration: "半日",
        type: "弹性安排",
        tags: ["fieldwork"],
        cost: 40,
        bookingRequired: false,
        value: "预留给天气、交通和访谈对象变动，降低行程执行风险。",
      }];
      return {
        day: index + 1,
        title: index === 0 ? "进入村落：建立调研问题" : index === days - 1 ? "助农转化：形成可展示成果" : "深度体验：补齐住宿、餐食与交通",
        villageNames: [...new Set(finalItems.map((item) => item.villageName))],
        items: finalItems,
      };
    });
  },

  estimateCost(days, form, transfers = []) {
    const activity = days.flatMap((day) => day.items).reduce((sum, item) => sum + (item.cost || 0), 0);
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
      status: total <= form.budget ? "within" : total <= form.budget * 1.18 ? "near" : "over",
      gap: Math.round(total - form.budget),
    };
  },

  estimateImpact(days, form, villages, cost) {
    return {
      directIncome: Math.round(cost.total * 0.58 * Math.max(1, form.groupSize / 2)),
      household: Math.max(3, days.flatMap((day) => day.items).length),
      idleAssets: (window.RuralData?.resourceAssets || []).filter((asset) => villages.some((v) => v.id === asset.villageId)).length,
      localPurchase: Math.round(cost.total * 0.22),
      researchOutputs: Math.min(8, days.length + form.tags.length),
    };
  },

  buildRisks(villages, form, cost, transfers = []) {
    const risks = [];
    if (cost.status === "over") {
      risks.push({ level: "high", title: "预算超出", text: `当前估算比预算高${Math.abs(cost.gap)}元。` });
    }
    const longTransfer = transfers.find((item) => item.minutes > this.maxLegMinutes(form));
    if (longTransfer) {
      risks.push({ level: "high", title: "跨村车程过长", text: `${longTransfer.from}到${longTransfer.to}约${longTransfer.minutes}分钟，建议拆成单独目的地或改做深度停留。` });
    }
    risks.push({ level: "low", title: "数据边界", text: "本地预览按坐标估算，点击生成后使用高德路径校准交通。" });
    return risks;
  },
};
