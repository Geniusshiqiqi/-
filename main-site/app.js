const State = {
  view: "planner",
  ready: false,
  generating: false,
  intaking: false,
  syncingSubmissions: false,
  data: {
    meta: window.RuralData?.meta || {},
    personas: window.RuralData?.personas || [],
    experienceTags: window.RuralData?.experienceTags || [],
    villages: window.RuralData?.villages || [],
    resources: window.RuralData?.resourceAssets || [],
    evidence: window.RuralData?.evidence || [],
    marketStats: window.RuralData?.marketStats || [],
    plans: [],
    bookings: [],
    runtime: {},
  },
  form: {
    personaId: "student",
    days: 3,
    budget: 980,
    pace: "balanced",
    region: "all",
    tags: ["fieldwork", "craft", "heritage"],
    departure: "",
    startDate: "",
    groupSize: 2,
    note: "",
  },
  currentPlan: null,
  villageFilter: "all",
  villageQuery: "",
  resourceFilter: "all",
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  bindGlobalNav();
  renderShellLoading();

  try {
    const bootstrap = await Api.bootstrap();
    State.data = bootstrap;
    window.RuralData = {
      ...window.RuralData,
      ...bootstrap,
      resourceAssets: bootstrap.resources,
    };
    State.currentPlan = LocalPlanner.createPlan(State.form);
  } catch (error) {
    State.currentPlan = LocalPlanner.createPlan(State.form);
    toast(`后端暂不可用，已进入本地模式：${error.message}`);
  } finally {
    State.ready = true;
    updateSubmissionPortalLink();
    render();
  }
}

function updateSubmissionPortalLink() {
  const link = document.querySelector("#submissionPortalLink");
  if (!link) return;
  link.href = State.data.runtime?.submissionPortalUrl || "http://127.0.0.1:5184/";
}

function bindGlobalNav() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      State.view = button.dataset.view;
      render();
    });
  });
}

function renderShellLoading() {
  document.querySelector("#app").innerHTML = `
    <section class="loading-state">
      <div class="loading-mark"></div>
      <h1>正在连接乡村文旅数据服务</h1>
      <p>加载村镇库、资源库、天气与AI规划能力。</p>
    </section>
  `;
}

function render(options = {}) {
  const shouldScroll = options.scroll !== false;
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === State.view);
  });

  const app = document.querySelector("#app");
  if (!State.ready) {
    renderShellLoading();
    return;
  }

  if (State.view === "planner") app.innerHTML = renderPlanner();
  if (State.view === "villages") app.innerHTML = renderVillages();
  if (State.view === "resources") app.innerHTML = renderResources();
  if (State.view === "bookings") app.innerHTML = renderBookings();
  if (State.view === "evidence") app.innerHTML = renderEvidence();

  bindView();
  refreshIcons();
  scheduleMapRender();
  restoreFocus(options.focus);
  if (shouldScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function restoreFocus(focusOptions) {
  if (!focusOptions?.selector) return;
  const element = document.querySelector(focusOptions.selector);
  if (!element) return;
  element.focus({ preventScroll: true });
  if (typeof element.setSelectionRange === "function") {
    const position = Math.min(Number(focusOptions.cursor ?? element.value.length), element.value.length);
    element.setSelectionRange(position, position);
  }
}

function scheduleMapRender() {
  const renderCurrentMap = () => {
    if (State.view === "planner") renderPlanMap();
    if (State.view === "villages") renderVillageMap();
  };
  requestAnimationFrame(renderCurrentMap);
  window.setTimeout(renderCurrentMap, 80);
}

function bindView() {
  if (State.view === "planner") bindPlanner();
  if (State.view === "villages") bindVillages();
  if (State.view === "resources") bindResources();
  if (State.view === "bookings") bindBookings();
  if (State.view === "evidence") bindEvidence();
}

function renderPlanner() {
  const plan = State.currentPlan || LocalPlanner.createPlan(State.form);
  const villages = plan.villages.map((item) => item.name).join("、");
  const heroMetrics = planHeroMetrics(plan);
  return `
    <section class="planner-grid">
      <aside class="control-panel">
        <div class="panel-head">
          <span class="section-kicker">学生可落地版</span>
          <h1>乡村文旅智能规划台</h1>
          <p>用AI、天气、路线估算和本地数据库，把乡村体验变成可保存、可复用、可继续调研的路线。</p>
          ${renderRuntimeStatus()}
        </div>
        <div class="action-bar">
          <button class="secondary-action full" id="openDestinationIntake" ${State.intaking ? "disabled" : ""}>
            <i data-lucide="message-square-plus"></i>
            <span>AI采集新目的地</span>
          </button>
          <button class="primary-action" id="generatePlan" ${State.generating ? "disabled" : ""}>
            <i data-lucide="${State.generating ? "loader-circle" : "sparkles"}"></i>
            <span>${State.generating ? "正在生成..." : "生成可执行路线"}</span>
          </button>
          <small>AI会结合天气、路线、预算和乡村资源重新生成方案。</small>
        </div>
        ${renderPersonaPicker()}
        ${renderTripControls()}
        ${renderTagPicker(State.form.tags)}
      </aside>

      <section class="result-stage">
        <div class="visual-band">
          <img ${imageAttrs(plan.villages[0]?.cover || State.data.villages[0]?.cover, `${plan.villages[0]?.name || "乡村"}图像`)} loading="eager">
          <div class="visual-overlay">
            <span>${escapeHtml(plan.persona?.name || "智能路线")}</span>
            <strong>${escapeHtml(villages || "等待生成")}</strong>
            <small>${escapeHtml(plan.summary || plan.title)}</small>
            <div class="hero-metrics">
              ${heroMetrics.map((item) => `
                <div>
                  <i data-lucide="${escapeAttr(item.icon)}"></i>
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.value)}</strong>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
        ${renderPlanSummary(plan)}
        ${renderRouteHealth(plan)}
        ${renderMapAndLiveInfo(plan)}
        ${renderDayTimeline(plan)}
      </section>

      <aside class="insight-rail">
        ${renderBudgetBox(plan)}
        ${renderImpactBox(plan)}
        ${renderChecklistBox(plan)}
        ${renderRiskBox(plan)}
        ${renderSavedPlans()}
      </aside>
    </section>
  `;
}

function renderRuntimeStatus() {
  const runtime = State.data.runtime || {};
  return `
    <div class="runtime-row">
      <span><i data-lucide="database"></i>${escapeHtml(runtime.database || "本地数据")}</span>
      <span><i data-lucide="cloud-sun"></i>${escapeHtml(runtime.weatherProvider || "天气估算")}</span>
      <span><i data-lucide="navigation"></i>${escapeHtml(runtime.routeProvider || "路线估算")}</span>
      <span><i data-lucide="bot"></i>${runtime.aiEnabled ? "AI已接入" : "本地规则"}</span>
    </div>
  `;
}

function planHeroMetrics(plan) {
  const longTransfer = getLongTransfer(plan);
  const spotCount = plan.days.flatMap((day) => day.items || []).filter((item) => item.spotId).length;
  return [
    { icon: "calendar", label: "周期", value: `${plan.form.days}天` },
    { icon: "wallet-cards", label: "人均估算", value: `¥${plan.cost.total}` },
    { icon: "map-pinned", label: "点位", value: `${spotCount}个` },
    { icon: longTransfer ? "shield-alert" : "check-circle-2", label: "交通", value: longTransfer ? "需拆分" : "可执行" },
  ];
}

function getLongTransfer(plan) {
  const maxMinutes = plan.form?.pace === "compact" ? 90 : plan.form?.pace === "slow" ? 140 : 120;
  return (plan.transfers || []).find((item) => Number(item.minutes) > maxMinutes);
}

function renderRouteHealth(plan) {
  const longTransfer = getLongTransfer(plan);
  const overBudget = plan.cost.status === "over";
  const risks = [
    longTransfer ? {
      icon: "route",
      level: "high",
      title: "跨村车程偏长",
      text: `${longTransfer.from}到${longTransfer.to}约${longTransfer.minutes}分钟，建议拆成两条路线或延长停留。`,
    } : null,
    overBudget ? {
      icon: "wallet-cards",
      level: "medium",
      title: "预算需要复核",
      text: `当前估算比预算高${Math.abs(plan.cost.gap)}元，可减少跨村移动或改为村内深度体验。`,
    } : null,
  ].filter(Boolean);

  if (!risks.length) {
    return `
      <section class="route-health good">
        <i data-lucide="check-circle-2"></i>
        <div>
          <strong>路线状态良好</strong>
          <span>预算、点位和交通节奏处于可执行区间，出发前仍建议二次确认开放时间。</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="route-health warn">
      ${risks.map((risk) => `
        <div class="route-health-item ${escapeAttr(risk.level)}">
          <i data-lucide="${escapeAttr(risk.icon)}"></i>
          <div>
            <strong>${escapeHtml(risk.title)}</strong>
            <span>${escapeHtml(risk.text)}</span>
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function renderPersonaPicker() {
  const buttons = State.data.personas
    .map((persona) => {
      const active = State.form.personaId === persona.id ? " active" : "";
      return `
        <button class="persona-btn${active}" data-persona="${escapeAttr(persona.id)}">
          <i data-lucide="${escapeAttr(persona.icon)}"></i>
          <span>${escapeHtml(persona.name)}</span>
          <small>${escapeHtml(persona.description)}</small>
        </button>
      `;
    })
    .join("");
  return `
    <div class="control-block">
      <div class="block-title">出行人群</div>
      <div class="persona-grid">${buttons}</div>
    </div>
  `;
}

function renderTripControls() {
  const regions = ["all", ...new Set(State.data.villages.map((item) => item.province))];
  return `
    <div class="control-block">
      <div class="block-title">基础条件</div>
      <div class="field-row">
        <label>
          <span>天数</span>
          <input id="daysInput" type="number" min="1" max="7" value="${State.form.days}">
        </label>
        <label>
          <span>人均预算</span>
          <input id="budgetInput" type="number" min="300" max="8000" step="20" value="${State.form.budget}">
        </label>
      </div>
      <label class="range-field">
        <span>预算刻度</span>
        <input id="budgetRange" type="range" min="300" max="8000" step="20" value="${State.form.budget}">
      </label>
      <div class="field-row">
        <label>
          <span>路线节奏</span>
          <select id="paceSelect">
            <option value="balanced"${State.form.pace === "balanced" ? " selected" : ""}>均衡</option>
            <option value="slow"${State.form.pace === "slow" ? " selected" : ""}>慢游</option>
            <option value="compact"${State.form.pace === "compact" ? " selected" : ""}>紧凑</option>
          </select>
        </label>
        <label>
          <span>优先省份</span>
          <select id="regionSelect">
            ${regions.map((region) => `<option value="${escapeAttr(region)}"${State.form.region === region ? " selected" : ""}>${region === "all" ? "不限" : escapeHtml(region)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>
          <span>出发地</span>
          <input id="departureInput" type="text" placeholder="如：上海 / 成都" value="${escapeAttr(State.form.departure)}">
        </label>
        <label>
          <span>人数</span>
          <input id="groupSizeInput" type="number" min="1" max="80" value="${State.form.groupSize}">
        </label>
      </div>
      <label>
        <span>出行日期</span>
        <input id="startDateInput" type="date" value="${escapeAttr(State.form.startDate)}">
      </label>
      <label>
        <span>补充需求</span>
        <textarea id="noteInput" rows="3" placeholder="如：想去泉州蟳埔村看簪花、老人同行、想避开爬山、需要可写实践报告的调研点">${escapeHtml(State.form.note)}</textarea>
      </label>
    </div>
  `;
}

function renderTagPicker(activeTags) {
  const tags = State.data.experienceTags
    .map((tag) => {
      const active = activeTags.includes(tag.id) ? " active" : "";
      return `
        <button class="tag-btn${active}" data-tag="${escapeAttr(tag.id)}" style="--tag-color:${escapeAttr(tag.color)}">
          <i data-lucide="${escapeAttr(tag.icon)}"></i>
          <span>${escapeHtml(tag.name)}</span>
        </button>
      `;
    })
    .join("");
  return `
    <div class="control-block">
      <div class="block-title">体验偏好</div>
      <div class="tag-grid">${tags}</div>
    </div>
  `;
}

function renderPlanSummary(plan) {
  const score = Math.round(avg(plan.villages.map((item) => item.score || item.matchScore || 80)));
  const aiLabel = plan.ai?.used ? "AI增强" : "本地规则";
  const spotCount = plan.days.flatMap((day) => day.items || []).filter((item) => item.spotId).length;
  return `
    <section class="summary-strip">
      <div>
        <span>推荐强度</span>
        <strong>${score}分</strong>
      </div>
      <div>
        <span>路线天数</span>
        <strong>${plan.form.days}天</strong>
      </div>
      <div>
        <span>预算估算</span>
        <strong>¥${plan.cost.total}</strong>
      </div>
      <div>
        <span>文旅点位</span>
        <strong>${spotCount}个</strong>
      </div>
      <div>
        <span>生成方式</span>
        <strong>${aiLabel}</strong>
      </div>
      <button class="secondary-action" id="savePlan">
        <i data-lucide="save"></i>
        <span>保存</span>
      </button>
      <button class="secondary-action" id="openBooking">
        <i data-lucide="clipboard-plus"></i>
        <span>记录需求</span>
      </button>
    </section>
  `;
}

function renderMapAndLiveInfo(plan) {
  return `
    <section class="live-grid">
      <div class="map-card">
        <div class="card-title">
          <i data-lucide="map-pinned"></i>
          <h2>高德路线地图</h2>
        </div>
        <div id="planMap" class="map-surface"></div>
      </div>
      <div class="live-card">
        <div class="card-title">
          <i data-lucide="cloud-sun"></i>
          <h2>天气与交通</h2>
        </div>
        <div class="weather-list">
          ${(plan.weather || []).map(renderWeatherItem).join("")}
        </div>
        <div class="transfer-list">
          ${(plan.transfers || []).length ? plan.transfers.map(renderTransferItem).join("") : `<p class="empty-note">单村或暂无跨村交通估算。</p>`}
        </div>
      </div>
    </section>
  `;
}

function renderWeatherItem(item) {
  return `
    <div class="weather-item">
      <strong>${escapeHtml(item.villageName)}</strong>
      <span>${item.temperature == null ? escapeHtml(item.label) : `${escapeHtml(item.label)} · ${item.temperature}℃ · 风速${item.windSpeed || 0}km/h`}</span>
      <small>${escapeHtml(item.advice || "")}</small>
    </div>
  `;
}

function renderTransferItem(item) {
  return `
    <div class="transfer-item">
      <strong>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</strong>
      <span>${item.distanceKm}km · 约${item.minutes}分钟 · ${escapeHtml(item.provider)}</span>
      <small>${escapeHtml(item.note || "")}</small>
    </div>
  `;
}

function renderDayTimeline(plan) {
  return `
    <section class="timeline-wrap">
      <div class="section-title">
        <span class="section-kicker">可执行日程</span>
        <h2>${escapeHtml(plan.title)}</h2>
        <p>${escapeHtml(plan.summary || "")}</p>
      </div>
      <div class="timeline">
        ${plan.days.map((day) => renderDay(day)).join("")}
      </div>
    </section>
  `;
}

function renderDay(day) {
  return `
    <article class="day-panel">
      <div class="day-index">D${day.day}</div>
      <div class="day-body">
        <div class="day-heading">
          <h3>${escapeHtml(day.title)}</h3>
          <span>${escapeHtml((day.villageNames || []).join(" / "))}</span>
        </div>
        ${day.aiNote ? `<p class="ai-note">${escapeHtml(day.aiNote)}</p>` : ""}
        <div class="activity-list">
          ${day.items.map((item) => renderActivity(item)).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderActivity(item) {
  const tagPills = (item.tags || []).map((id) => {
    const tag = State.data.experienceTags.find((entry) => entry.id === id);
    return `<span>${escapeHtml(tag?.name || id)}</span>`;
  }).join("");
  const bestTime = item.bestTime ? `<span>建议 ${escapeHtml(item.bestTime)}</span>` : "";
  return `
    <div class="activity-item">
      <time>${escapeHtml(item.time)}</time>
      <div>
        <h4>${escapeHtml(item.title)}${item.bookingRequired ? `<em>需提前确认</em>` : ""}</h4>
        <p>${escapeHtml(item.value)}</p>
        <div class="activity-meta">
          <span>${escapeHtml(item.duration)}</span>
          <span>¥${item.cost}</span>
          ${bestTime}
          ${tagPills}
        </div>
      </div>
    </div>
  `;
}

function renderBudgetBox(plan) {
  const statusText = { within: "预算内", near: "接近上限", over: "需优化" }[plan.cost.status] || "估算";
  return `
    <section class="rail-card">
      <div class="card-title"><i data-lucide="wallet-cards"></i><h2>预算拆分</h2></div>
      <div class="budget-total ${escapeAttr(plan.cost.status)}">
        <span>${statusText}</span>
        <strong>¥${plan.cost.total}</strong>
      </div>
      ${renderMeter("体验", plan.cost.activity, plan.cost.total)}
      ${renderMeter("住宿", plan.cost.stay, plan.cost.total)}
      ${renderMeter("交通", plan.cost.transport, plan.cost.total)}
      ${renderMeter("餐食", plan.cost.food, plan.cost.total)}
    </section>
  `;
}

function renderMeter(label, value, total) {
  const width = total ? Math.max(4, Math.round((value / total) * 100)) : 0;
  return `
    <div class="meter-row">
      <div><span>${label}</span><strong>¥${value}</strong></div>
      <div class="meter"><span style="width:${width}%"></span></div>
    </div>
  `;
}

function renderImpactBox(plan) {
  return `
    <section class="rail-card">
      <div class="card-title"><i data-lucide="sprout"></i><h2>助农测算</h2></div>
      <div class="impact-grid">
        <div><span>村民直接收入</span><strong>¥${plan.impact.directIncome}</strong></div>
        <div><span>带动农户</span><strong>${plan.impact.household}户</strong></div>
        <div><span>本地采购</span><strong>¥${plan.impact.localPurchase}</strong></div>
        <div><span>研学成果</span><strong>${plan.impact.researchOutputs}项</strong></div>
      </div>
    </section>
  `;
}

function renderChecklistBox(plan) {
  return `
    <section class="rail-card">
      <div class="card-title"><i data-lucide="list-checks"></i><h2>出行清单</h2></div>
      <ul class="check-list">${(plan.checklist || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <div class="card-title etiquette-title"><i data-lucide="hand-heart"></i><h2>乡村礼仪</h2></div>
      <ul class="check-list">${(plan.localEtiquette || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderRiskBox(plan) {
  return `
    <section class="rail-card">
      <div class="card-title"><i data-lucide="shield-alert"></i><h2>路线风控</h2></div>
      <div class="risk-list">
        ${(plan.risks || []).map((risk) => `
          <div class="risk-item ${escapeAttr(risk.level)}">
            <strong>${escapeHtml(risk.title)}</strong>
            <span>${escapeHtml(risk.text)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSavedPlans() {
  return `
    <section class="rail-card">
      <div class="card-title"><i data-lucide="folder-check"></i><h2>已保存方案</h2></div>
      <div class="saved-list">
        ${State.data.plans.length ? State.data.plans.slice(0, 4).map((plan) => `
          <button class="saved-plan" data-load-plan="${escapeAttr(plan.id)}">
            <strong>${escapeHtml(plan.title)}</strong>
            <span>${escapeHtml(plan.generatedAt || plan.createdAt || "")} · ¥${plan.cost?.total || "?"}</span>
          </button>
        `).join("") : `<p class="empty-note">暂无保存方案</p>`}
      </div>
    </section>
  `;
}

function bindPlanner() {
  document.querySelectorAll("[data-persona]").forEach((button) => {
    button.addEventListener("click", async () => {
      const persona = State.data.personas.find((item) => item.id === button.dataset.persona);
      State.form.personaId = persona.id;
      State.form.days = persona.days;
      State.form.budget = persona.budget;
      State.form.pace = persona.pace;
      State.form.tags = [...persona.preferences];
      State.form.targetVillageId = "";
      State.currentPlan = LocalPlanner.createPlan(State.form);
      render({ scroll: false });
    });
  });

  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      State.form.tags = toggleArrayItem(State.form.tags, button.dataset.tag);
      if (!State.form.tags.length) State.form.tags = ["fieldwork"];
      State.form.targetVillageId = "";
      State.currentPlan = LocalPlanner.createPlan(State.form);
      render({ scroll: false });
    });
  });

  bindFormControls();

  document.querySelector("#openDestinationIntake")?.addEventListener("click", openDestinationIntakeModal);
  document.querySelector("#generatePlan")?.addEventListener("click", async () => {
    await regeneratePlan();
  });
  document.querySelector("#savePlan")?.addEventListener("click", saveCurrentPlan);
  document.querySelector("#openBooking")?.addEventListener("click", () => openBookingModal(State.currentPlan));
  document.querySelectorAll("[data-load-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = State.data.plans.find((item) => item.id === button.dataset.loadPlan);
      if (plan) {
        State.currentPlan = plan;
        State.form = { ...plan.form };
        render();
      }
    });
  });
}

function bindFormControls() {
  const setAndPreview = (event) => {
    if (["paceSelect", "regionSelect", "noteInput"].includes(event?.target?.id)) {
      State.form.targetVillageId = "";
    }
    syncFormFromControls();
    State.currentPlan = LocalPlanner.createPlan(State.form);
    render({ scroll: false });
  };

  ["#daysInput", "#budgetInput", "#paceSelect", "#regionSelect", "#departureInput", "#groupSizeInput", "#startDateInput", "#noteInput"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", setAndPreview);
  });
  const noteInput = document.querySelector("#noteInput");
  noteInput?.addEventListener("compositionstart", () => {
    noteInput.dataset.composing = "true";
  });
  noteInput?.addEventListener("compositionend", () => {
    noteInput.dataset.composing = "";
    State.form.note = noteInput.value || "";
    State.form.targetVillageId = "";
  });
  noteInput?.addEventListener("input", () => {
    State.form.note = noteInput.value || "";
    if (noteInput.dataset.composing !== "true") State.form.targetVillageId = "";
  });
  const budgetRange = document.querySelector("#budgetRange");
  const budgetInput = document.querySelector("#budgetInput");
  budgetRange?.addEventListener("input", () => {
    State.form.budget = Number(budgetRange.value);
    if (budgetInput) budgetInput.value = State.form.budget;
  });
  budgetRange?.addEventListener("change", setAndPreview);
}

function syncFormFromControls() {
  State.form.days = clamp(Number(document.querySelector("#daysInput")?.value) || 3, 1, 7);
  State.form.budget = clamp(Number(document.querySelector("#budgetInput")?.value) || 980, 300, 8000);
  State.form.pace = document.querySelector("#paceSelect")?.value || "balanced";
  State.form.region = document.querySelector("#regionSelect")?.value || "all";
  State.form.departure = document.querySelector("#departureInput")?.value || "";
  State.form.groupSize = clamp(Number(document.querySelector("#groupSizeInput")?.value) || 2, 1, 80);
  State.form.startDate = document.querySelector("#startDateInput")?.value || "";
  State.form.note = document.querySelector("#noteInput")?.value || State.form.note || "";
}

async function regeneratePlan() {
  syncFormFromControls();
  State.generating = true;
  render();
  try {
    const noteIntake = await maybeIntakeDestinationFromNote();
    if (!noteIntake) {
      State.currentPlan = await safeGeneratePlan(State.form, false);
      toast(State.currentPlan.ai?.used ? "AI增强路线已生成" : "路线已生成，当前使用本地兜底");
    }
  } catch (error) {
    State.currentPlan = LocalPlanner.createPlan(State.form);
    toast(`生成失败，已使用本地规则：${error.message}`);
  } finally {
    State.generating = false;
    render();
  }
}

async function safeGeneratePlan(form, silent) {
  try {
    return await Api.generatePlan(form);
  } catch (error) {
    if (!silent) throw error;
    return LocalPlanner.createPlan(form);
  }
}

async function maybeIntakeDestinationFromNote() {
  if (State.form.targetVillageId) return false;
  if (LocalPlanner.detectRequestedVillages?.(State.form)?.length) return false;
  const destination = extractDestinationFromNote(State.form.note);
  if (!destination) return false;

  const result = await Api.intakeDestination({
    destination,
    province: State.form.region !== "all" ? State.form.region : "",
    city: "",
    personaId: State.form.personaId,
    tags: State.form.tags,
    days: State.form.days,
    budget: State.form.budget,
    pace: State.form.pace,
    departure: State.form.departure,
    startDate: State.form.startDate,
    groupSize: State.form.groupSize,
    note: State.form.note,
  });
  await applyDestinationIntakeResult(result);
  toast(`${result.village.name}已生成待核验资料，并用于本次路线`);
  return true;
}

function extractDestinationFromNote(note = "") {
  const raw = String(note || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const patterns = [
    /(?:目的地|想去|要去|去到|前往|到)([^，。,.；;、\n]+?)(?=(?:看|体验|做|吃|住|玩|拍|研学|调研|路线|旅游|文旅|预算|老人|亲子|同学|朋友|$))/u,
    /^([^，。,.；;、\n]{2,18})(?=(?:看|体验|做|吃|住|玩|拍|研学|调研|路线|旅游|文旅|$))/u,
  ];
  for (const pattern of patterns) {
    const candidate = cleanupDestinationCandidate(compact.match(pattern)?.[1]);
    if (looksLikeDestination(candidate) || looksLikeLoosePlace(candidate)) return candidate;
  }
  const direct = cleanupDestinationCandidate(compact);
  return (looksLikeDestination(direct) || looksLikeLoosePlace(direct)) && direct.length <= 18 ? direct : "";
}

function cleanupDestinationCandidate(value = "") {
  return String(value || "")
    .replace(/^(一下|一个|这个|那个|当地|附近|周边|中国|国内)/, "")
    .replace(/(的需求|需求|路线|攻略|旅游|文旅|行程|方案|预算|花费|怎么玩).*$/u, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9·-]/g, "")
    .slice(0, 24);
}

function looksLikeDestination(value = "") {
  const text = String(value || "");
  if (text.length < 2) return false;
  if (/(老人|亲子|预算|避开|不要|需要|同行|便宜|舒适|研学报告|实践报告|非遗手作|农事体验|爬山|少走路)/.test(text)) return false;
  if (/(村|寨|镇|古城|古镇|景区|县|市|乡|岛|沟|湾|庄|园|谷|埔|坞|侗寨|苗寨|羌寨|藏寨)/u.test(text)) return true;
  return /(山|湖)$/u.test(text) && text.length <= 8;
}

function looksLikeLoosePlace(value = "") {
  const text = String(value || "");
  const blocked = new Set(["贵州", "云南", "安徽", "四川", "浙江", "北京", "湖南", "江西", "广西", "广东", "山西", "非遗", "手作", "农事", "研学", "调研", "亲子", "老人", "民宿", "预算", "路线", "文旅", "旅游"]);
  if (!/^[\u4e00-\u9fa5]{2,8}$/.test(text) || blocked.has(text)) return false;
  if (/(体验|需求|同行|报告|便宜|舒适|避开|不要|需要|最好|手作|农事|民宿|预算|路线|旅游)$/.test(text)) return false;
  return true;
}

async function saveCurrentPlan() {
  try {
    const result = await Api.savePlan(State.currentPlan);
    const bootstrap = await Api.bootstrap();
    State.data.plans = bootstrap.plans;
    toast(`已保存到本地数据库：${result.title}`);
    render();
  } catch (error) {
    toast(`保存失败：${error.message}`);
  }
}

function renderVillages() {
  const provinces = ["all", ...new Set(State.data.villages.map((item) => item.province))];
  const filtered = getFilteredVillages();
  const provinceCount = new Set(State.data.villages.map((item) => item.province)).size;
  const spotCount = filtered.reduce((sum, village) => sum + (village.spots || []).length, 0);
  return `
    <section class="view-stack">
      <div class="view-head">
        <div>
          <span class="section-kicker">重点村镇库</span>
          <h1>可查询、可定位、可接入路线的村镇资料库</h1>
          <p>村镇数据来自本地SQLite，支持按省份、关键词、体验标签筛选；后续可继续批量导入官方名录。</p>
        </div>
        <div class="toolbar">
          <a class="secondary-action compact" href="${escapeAttr(State.data.runtime?.submissionPortalUrl || "http://127.0.0.1:5184/")}" target="_blank" rel="noopener">
            <i data-lucide="file-plus-2"></i><span>村镇自荐入口</span>
          </a>
          <button class="secondary-action compact" id="syncApprovedSubmissions" ${State.syncingSubmissions ? "disabled" : ""}>
            <i data-lucide="${State.syncingSubmissions ? "loader-circle" : "database-zap"}"></i><span>${State.syncingSubmissions ? "同步中" : "同步申报入库"}</span>
          </button>
          <button class="primary-action compact" id="openVillageIntake"><i data-lucide="message-square-plus"></i><span>AI采集目的地</span></button>
          <label class="compact-select">
            <span>省份</span>
            <select id="villageProvince">${provinces.map((province) => `<option value="${escapeAttr(province)}"${State.villageFilter === province ? " selected" : ""}>${province === "all" ? "全部" : escapeHtml(province)}</option>`).join("")}</select>
          </label>
          <label class="compact-select">
            <span>搜索</span>
            <input id="villageSearch" type="text" autocomplete="off" placeholder="村名 / 标签 / 亮点" value="${escapeAttr(State.villageQuery)}">
          </label>
        </div>
      </div>
      <section class="view-metrics">
        <div><span>当前结果</span><strong>${filtered.length}</strong><small>个村镇</small></div>
        <div><span>覆盖省份</span><strong>${provinceCount}</strong><small>个</small></div>
        <div><span>可用点位</span><strong>${spotCount}</strong><small>个</small></div>
        <div><span>申报闭环</span><strong>${State.data.runtime?.submissionPortalUrl ? "已接入" : "待接入"}</strong><small>副站数据</small></div>
      </section>
      <section class="village-map-section">
        <div id="villageMap" class="map-surface large"></div>
      </section>
      <div class="village-grid">
        ${filtered.length ? filtered.map((village) => renderVillageCard(village)).join("") : renderEmptyState("map-search", "没有找到匹配村镇", "换一个关键词或切回全部省份，再继续筛选。")}
      </div>
    </section>
  `;
}

function getFilteredVillages() {
  const q = State.villageQuery.trim().toLowerCase();
  return State.data.villages.filter((village) => {
    const provinceOk = State.villageFilter === "all" || village.province === State.villageFilter;
    const spotText = (village.spots || []).flatMap((spot) => [spot.name, spot.type, spot.desc, ...(spot.tags || [])]);
    const textOk = !q || [village.name, village.province, village.city, village.address, village.transportNode, village.label, ...(village.tags || []), ...(village.highlights || []), ...spotText].join(" ").toLowerCase().includes(q);
    return provinceOk && textOk;
  });
}

function renderVillageCard(village) {
  const tags = (village.tags || []).map((id) => State.data.experienceTags.find((tag) => tag.id === id)?.name || id).slice(0, 4).map((name) => `<span>${escapeHtml(name)}</span>`).join("");
  const spots = village.spots || [];
  const spotPreview = spots.slice(0, 3).map((spot) => `<span>${escapeHtml(spot.name)}</span>`).join("");
  return `
    <article class="village-card">
      <img ${imageAttrs(village.cover, village.name)} loading="lazy">
      <div class="village-content">
        <div class="village-topline">
          <span>${escapeHtml(village.province)} · ${escapeHtml(village.city)}</span>
          <strong>${village.matchScore}</strong>
        </div>
        <h2>${escapeHtml(village.name)}</h2>
        <p>${escapeHtml(village.label)}</p>
        <div class="address-line"><i data-lucide="map-pin"></i><span>${escapeHtml(village.address || `${village.province}${village.city}${village.name}`)}</span></div>
        <div class="pill-row">${tags}</div>
        <div class="spot-preview">
          <strong>${spots.length}个文旅点位</strong>
          <div>${spotPreview}</div>
        </div>
        <dl class="mini-facts">
          <div><dt>最佳季节</dt><dd>${escapeHtml(village.bestSeason)}</dd></div>
          <div><dt>交通</dt><dd>${escapeHtml(village.transportNode || "出发前用高德复核")}</dd></div>
          <div><dt>资源</dt><dd>${escapeHtml((village.resources || []).slice(0, 3).join("、"))}</dd></div>
        </dl>
        <div class="button-row">
          <button class="secondary-action full" data-village-detail="${escapeAttr(village.id)}"><i data-lucide="panel-top-open"></i><span>画像</span></button>
          <button class="secondary-action full" data-plan-village="${escapeAttr(village.id)}"><i data-lucide="route"></i><span>用它规划</span></button>
        </div>
      </div>
    </article>
  `;
}

function bindVillages() {
  document.querySelector("#openVillageIntake")?.addEventListener("click", openDestinationIntakeModal);
  document.querySelector("#syncApprovedSubmissions")?.addEventListener("click", syncApprovedSubmissions);
  document.querySelector("#villageProvince")?.addEventListener("change", (event) => {
    State.villageFilter = event.target.value;
    render();
  });
  const villageSearch = document.querySelector("#villageSearch");
  const runVillageSearch = debounce(() => {
    const cursor = villageSearch?.selectionStart ?? villageSearch?.value?.length ?? 0;
    State.villageQuery = villageSearch?.value || "";
    render({ scroll: false, focus: { selector: "#villageSearch", cursor } });
  }, 300);
  villageSearch?.addEventListener("compositionstart", () => {
    villageSearch.dataset.composing = "true";
  });
  villageSearch?.addEventListener("compositionend", () => {
    villageSearch.dataset.composing = "";
    runVillageSearch();
  });
  villageSearch?.addEventListener("input", () => {
    if (villageSearch.dataset.composing === "true") return;
    runVillageSearch();
  });
  document.querySelectorAll("[data-village-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const village = State.data.villages.find((item) => item.id === button.dataset.villageDetail);
      openVillageModal(village);
    });
  });
  document.querySelectorAll("[data-plan-village]").forEach((button) => {
    button.addEventListener("click", async () => {
      const village = State.data.villages.find((item) => item.id === button.dataset.planVillage);
      State.form.region = village.province;
      State.form.tags = [...new Set([...(village.tags || []).slice(0, 3), "fieldwork"])];
      State.form.targetVillageId = village.id;
      State.view = "planner";
      await regeneratePlan();
    });
  });
}

async function syncApprovedSubmissions() {
  State.syncingSubmissions = true;
  render({ scroll: false });
  try {
    const result = await Api.importApprovedSubmissions();
    const bootstrap = await Api.bootstrap();
    State.data = bootstrap;
    window.RuralData = {
      ...window.RuralData,
      ...bootstrap,
      resourceAssets: bootstrap.resources,
    };
    updateSubmissionPortalLink();
    State.currentPlan = LocalPlanner.createPlan(State.form);
    toast(result.message || "申报数据已同步入库");
  } catch (error) {
    toast(`同步失败：${error.message}`);
  } finally {
    State.syncingSubmissions = false;
    render({ scroll: false });
  }
}

function openVillageModal(village) {
  const html = `
    <div class="modal-card">
      <button class="icon-button modal-close" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button>
      <img class="modal-image" ${imageAttrs(village.cover, village.name)} loading="lazy">
      <div class="modal-body">
        <span class="section-kicker">${escapeHtml(village.province)} · ${escapeHtml(village.city)}</span>
        <h2>${escapeHtml(village.name)}：${escapeHtml(village.label)}</h2>
        <p>${escapeHtml(village.fallbackVisual)}</p>
        <div class="location-panel">
          <div><i data-lucide="map-pin"></i><span>参考地址</span><strong>${escapeHtml(village.address || `${village.province}${village.city}${village.name}`)}</strong></div>
          <div><i data-lucide="bus"></i><span>交通节点</span><strong>${escapeHtml(village.transportNode || "正式出发前使用高德地图核验")}</strong></div>
          <div><i data-lucide="navigation"></i><span>高德坐标</span><strong>${escapeHtml(`${village.lng}, ${village.lat}`)}</strong></div>
        </div>
        ${village.coverSource ? `<div class="image-credit">景点图来源：${escapeHtml(village.coverSource)}</div>` : ""}
        <div class="modal-columns">
          ${renderListBlock("体验亮点", village.highlights)}
          ${renderListBlock("真实痛点", village.painPoints)}
          ${renderListBlock("可盘活资源", village.resources)}
          ${renderListBlock("助农产品", village.products)}
        </div>
        ${renderSpotList(village.spots || [])}
        <div class="source-note">${escapeHtml(village.sourceType)}</div>
      </div>
    </div>
  `;
  openModal(html);
}

function renderListBlock(title, items = []) {
  return `<div class="list-block"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function renderSpotList(spots = []) {
  if (!spots.length) return "";
  return `
    <section class="spot-list">
      <div class="spot-list-head">
        <h3>可接入行程的文旅点位</h3>
        <span>${spots.length}个</span>
      </div>
      <div class="spot-grid">
        ${spots.map((spot) => `
          <article class="spot-card">
            <div>
              <strong>${escapeHtml(spot.name)}</strong>
              <span>${escapeHtml(spot.type || "文旅体验")} · ${escapeHtml(spot.duration || "弹性")}</span>
            </div>
            <p>${escapeHtml(spot.desc || "")}</p>
            <footer>
              <span>¥${Number(spot.price) || 0}</span>
              <span>${spot.bookingRequired ? "需提前确认" : "现场确认"}</span>
              ${spot.bestTime ? `<span>${escapeHtml(spot.bestTime)}</span>` : ""}
            </footer>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderResources() {
  const resources = State.resourceFilter === "all" ? State.data.resources : State.data.resources.filter((item) => item.villageId === State.resourceFilter);
  const totalIncome = resources.reduce((sum, item) => sum + (Number(item.estimateIncome) || 0), 0);
  const activeVillage = State.resourceFilter === "all" ? null : State.data.villages.find((item) => item.id === State.resourceFilter);
  return `
    <section class="view-stack">
      <div class="view-head">
        <div>
          <span class="section-kicker">资源匹配</span>
          <h1>把闲置院落、田块和工坊接进行程</h1>
          <p>把可盘活的乡村资源整理成素材库，作为路线生成和后续调研的依据。</p>
        </div>
        <div class="toolbar">
          <div class="stat-chip"><span>资源月增收估算</span><strong>¥${totalIncome}</strong></div>
          <button class="primary-action compact" id="openResourceSubmit"><i data-lucide="plus"></i><span>补充资源</span></button>
        </div>
      </div>
      <section class="view-metrics">
        <div><span>筛选范围</span><strong>${escapeHtml(activeVillage?.name || "全部")}</strong><small>村镇资源</small></div>
        <div><span>资源条目</span><strong>${resources.length}</strong><small>条</small></div>
        <div><span>月增收估算</span><strong>¥${totalIncome}</strong><small>需核验</small></div>
        <div><span>匹配状态</span><strong>${resources.length ? "可规划" : "待补充"}</strong><small>路线素材</small></div>
      </section>
      <div class="resource-layout">
        <aside class="resource-filter">
          <label>
            <span>按村镇筛选</span>
            <select id="resourceVillageFilter">
              <option value="all"${State.resourceFilter === "all" ? " selected" : ""}>全部村镇</option>
              ${State.data.villages.map((village) => `<option value="${escapeAttr(village.id)}"${State.resourceFilter === village.id ? " selected" : ""}>${escapeHtml(village.name)}</option>`).join("")}
            </select>
          </label>
          <div class="filter-help">新增资源会进入本地数据库，适合作为作品演示、调研记录和路线匹配素材。</div>
        </aside>
        <div class="resource-list">${resources.length ? resources.map((asset) => renderResourceRow(asset)).join("") : renderEmptyState("package-plus", "当前筛选下暂无资源", "可以点击补充资源，或在村镇申报副站同步审核通过的数据。")}</div>
      </div>
    </section>
  `;
}

function renderResourceRow(asset) {
  const village = asset.village || State.data.villages.find((item) => item.id === asset.villageId) || {};
  const fit = (asset.fit || []).map((id) => State.data.experienceTags.find((tag) => tag.id === id)?.name || id).map((name) => `<span>${escapeHtml(name)}</span>`).join("");
  const scoreLabel = asset.status === "pending" ? "记" : asset.status === "ai-draft" ? "AI" : Math.min(99, 70 + (asset.fit || []).length * 6);
  return `
    <article class="resource-row">
      <div class="resource-score">${scoreLabel}</div>
      <div class="resource-main">
        <div class="resource-title"><span>${escapeHtml(asset.type)} · ${escapeHtml(village.name || "")}</span><h2>${escapeHtml(asset.title)}</h2></div>
        <p>${escapeHtml(asset.action)}</p>
        <div class="pill-row">${fit}</div>
      </div>
      <div class="resource-side">
        <span>${escapeHtml(asset.currentState)}</span>
        <strong>¥${asset.estimateIncome || 0}/月</strong>
        <small>${escapeHtml(asset.risk)}</small>
      </div>
    </article>
  `;
}

function bindResources() {
  document.querySelector("#resourceVillageFilter")?.addEventListener("change", (event) => {
    State.resourceFilter = event.target.value;
    render();
  });
  document.querySelector("#openResourceSubmit")?.addEventListener("click", openResourceModal);
}

function renderBookings() {
  return `
    <section class="view-stack">
      <div class="view-head">
        <div>
          <span class="section-kicker">需求记录</span>
          <h1>本地保存的出行意向</h1>
          <p>把用户的路线想法、预算和补充需求沉淀下来，方便作品演示和后续调研复用。</p>
        </div>
        <button class="primary-action compact" id="openEmptyBooking"><i data-lucide="clipboard-plus"></i><span>新建记录</span></button>
      </div>
      <section class="view-metrics">
        <div><span>需求记录</span><strong>${State.data.bookings.length}</strong><small>条</small></div>
        <div><span>当前路线</span><strong>${State.currentPlan?.form?.days || State.form.days}天</strong><small>可绑定</small></div>
        <div><span>默认人数</span><strong>${State.form.groupSize}</strong><small>人</small></div>
        <div><span>预算模板</span><strong>¥${State.form.budget}</strong><small>人均</small></div>
      </section>
      <div class="booking-list">
        ${State.data.bookings.length ? State.data.bookings.map(renderBookingRow).join("") : renderEmptyState("clipboard-plus", "暂无需求记录", "点击新建记录，把用户意向、预算和备注沉淀下来。")}
      </div>
    </section>
  `;
}

function renderBookingRow(item) {
  return `
    <article class="booking-row">
      <div>
        <span>${escapeHtml(item.travel_date)} · ${item.group_size}人</span>
        <h2>${escapeHtml(item.name)}</h2>
        <p>${escapeHtml(item.note || "无备注")}</p>
      </div>
      <strong>${escapeHtml(item.plan_id || "未绑定路线")}</strong>
      <small>${escapeHtml(item.created_at)}</small>
    </article>
  `;
}

function bindBookings() {
  document.querySelector("#openEmptyBooking")?.addEventListener("click", () => openBookingModal(State.currentPlan));
}

function renderEvidence() {
  return `
    <section class="view-stack">
      <div class="view-head">
        <div>
          <span class="section-kicker">数据依据</span>
          <h1>公开来源支撑，原型估算边界清晰</h1>
          <p>政策、市场、实时天气和路线估算均标注来源；村级经营数据在数据库中维护。</p>
        </div>
        <button class="secondary-action" id="openFeedback"><i data-lucide="message-square-plus"></i><span>提交反馈</span></button>
      </div>
      <section class="view-metrics">
        <div><span>公开依据</span><strong>${State.data.evidence.length}</strong><small>条</small></div>
        <div><span>市场指标</span><strong>${State.data.marketStats.length}</strong><small>组</small></div>
        <div><span>AI能力</span><strong>${State.data.runtime?.aiEnabled ? "已接入" : "本地"}</strong><small>规划增强</small></div>
        <div><span>数据库</span><strong>${escapeHtml(State.data.runtime?.database || "SQLite")}</strong><small>持久化</small></div>
      </section>
      <div class="market-grid">${State.data.marketStats.map(renderMarketStat).join("")}</div>
      <div class="evidence-table">${State.data.evidence.map(renderEvidenceRow).join("")}</div>
      <section class="boundary-panel">
        <div class="card-title"><i data-lucide="badge-check"></i><h2>生产边界</h2></div>
        <p>${escapeHtml(State.data.meta.note || "")}</p>
        <div class="api-box">
          <strong>API接入方式</strong>
          <span>AI：DeepSeek Chat Completions；天气：Open-Meteo；路线：${escapeHtml(State.data.runtime?.routeProvider || "高德 Web服务 + 本地兜底")}；地图：高德静态图代理；数据持久化：SQLite。</span>
        </div>
      </section>
    </section>
  `;
}

function renderEmptyState(icon, title, text) {
  return `
    <div class="empty-panel">
      <i data-lucide="${escapeAttr(icon)}"></i>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}

function renderMarketStat(stat) {
  return `<div class="market-card ${escapeAttr(stat.tone)}"><span>${escapeHtml(stat.label)}</span><strong>${stat.value}</strong><small>${escapeHtml(stat.unit)}</small></div>`;
}

function renderEvidenceRow(item) {
  return `
    <article class="evidence-row">
      <div><span>${escapeHtml(item.source)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.use)}</p></div>
      <strong>${escapeHtml(item.value)}</strong>
      <a href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>来源</span></a>
    </article>
  `;
}

function bindEvidence() {
  document.querySelector("#openFeedback")?.addEventListener("click", openFeedbackModal);
}

function openBookingModal(plan) {
  const defaultDate = State.form.startDate || "";
  openModal(`
    <div class="modal-card narrow">
      <button class="icon-button modal-close" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button>
      <div class="modal-body">
        <span class="section-kicker">需求记录</span>
        <h2>保存出行意向</h2>
        <form id="bookingForm" class="form-stack">
          <label><span>记录人</span><input name="name" required placeholder="你的姓名或称呼"></label>
          <label><span>联系方式（可选）</span><input name="contact" placeholder="可不填，仅本地保存"></label>
          <div class="field-row">
            <label><span>出行日期</span><input name="travelDate" type="date" required value="${escapeAttr(defaultDate)}"></label>
            <label><span>人数</span><input name="groupSize" type="number" min="1" max="200" value="${State.form.groupSize}"></label>
          </div>
          <label><span>备注</span><textarea name="note" rows="4" placeholder="如：想体验非遗工坊、需要亲子安全路线、用于研学报告">${escapeHtml(State.form.note)}</textarea></label>
          <button class="primary-action" type="submit"><i data-lucide="save"></i><span>保存记录</span></button>
        </form>
      </div>
    </div>
  `);
  document.querySelector("#bookingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await Api.createBooking({ ...data, plan });
      const bootstrap = await Api.bootstrap();
      State.data.bookings = bootstrap.bookings;
      closeModal();
      toast("需求记录已保存");
      if (State.view === "bookings") render();
    } catch (error) {
      toast(`提交失败：${error.message}`);
    }
  });
}

function openDestinationIntakeModal() {
  const personaOptions = State.data.personas
    .map((persona) => `<option value="${escapeAttr(persona.id)}"${State.form.personaId === persona.id ? " selected" : ""}>${escapeHtml(persona.name)}</option>`)
    .join("");
  const tagChecks = State.data.experienceTags
    .map((tag) => `
      <label class="tag-check">
        <input type="checkbox" name="tags" value="${escapeAttr(tag.id)}"${State.form.tags.includes(tag.id) ? " checked" : ""}>
        <span><i data-lucide="${escapeAttr(tag.icon)}"></i>${escapeHtml(tag.name)}</span>
      </label>
    `)
    .join("");

  openModal(`
    <div class="modal-card intake-modal">
      <button class="icon-button modal-close" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button>
      <div class="modal-body">
        <span class="section-kicker">AI目的地采集</span>
        <h2>告诉我你想去的乡村景点</h2>
        <p>系统会生成村镇画像、点位、资源建议和点对点路线，并写入村镇库与资源匹配。</p>
        <form id="destinationIntakeForm" class="form-stack">
          <div class="field-row">
            <label><span>乡村景点/村镇名称</span><input name="destination" required placeholder="如：松阳杨家堂村 / 某某古寨"></label>
            <label><span>省份</span><input name="province" placeholder="如：浙江"></label>
          </div>
          <div class="field-row">
            <label><span>城市/区县</span><input name="city" placeholder="如：丽水市松阳县"></label>
            <label><span>出行人群</span><select name="personaId">${personaOptions}</select></label>
          </div>
          <div class="field-row">
            <label><span>天数</span><input name="days" type="number" min="1" max="7" value="${State.form.days}"></label>
            <label><span>人均预算</span><input name="budget" type="number" min="300" max="8000" step="20" value="${State.form.budget}"></label>
          </div>
          <div class="field-row">
            <label><span>路线节奏</span><select name="pace">
              <option value="balanced"${State.form.pace === "balanced" ? " selected" : ""}>均衡</option>
              <option value="slow"${State.form.pace === "slow" ? " selected" : ""}>慢游</option>
              <option value="compact"${State.form.pace === "compact" ? " selected" : ""}>紧凑</option>
            </select></label>
            <label><span>人数</span><input name="groupSize" type="number" min="1" max="80" value="${State.form.groupSize}"></label>
          </div>
          <div class="field-row">
            <label><span>出发地</span><input name="departure" placeholder="如：上海 / 成都" value="${escapeAttr(State.form.departure)}"></label>
            <label><span>出行日期</span><input name="startDate" type="date" value="${escapeAttr(State.form.startDate)}"></label>
          </div>
          <div>
            <span class="field-label">体验偏好</span>
            <div class="tag-check-grid">${tagChecks}</div>
          </div>
          <label><span>补充需求</span><textarea name="note" rows="4" placeholder="如：亲子、不爬山、想做非遗手作、需要可写进研学报告">${escapeHtml(State.form.note)}</textarea></label>
          <div class="modal-hint">生成内容会标记为待核验数据，后续可在村镇库、资源匹配和预算拆分中继续使用。</div>
          <button class="primary-action" type="submit"><i data-lucide="sparkles"></i><span>生成并入库</span></button>
        </form>
      </div>
    </div>
  `);

  document.querySelector("#destinationIntakeForm")?.addEventListener("submit", submitDestinationIntake);
}

async function submitDestinationIntake(event) {
  event.preventDefault();
  const formEl = event.currentTarget;
  const submitButton = formEl.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(formEl));
  const tags = [...formEl.querySelectorAll("input[name='tags']:checked")].map((input) => input.value);
  const payload = {
    ...data,
    tags,
    days: Number(data.days) || State.form.days,
    budget: Number(data.budget) || State.form.budget,
    groupSize: Number(data.groupSize) || State.form.groupSize,
  };

  State.intaking = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = `<i data-lucide="loader-circle"></i><span>正在生成...</span>`;
    refreshIcons();
  }

  try {
    const result = await Api.intakeDestination(payload);
    await applyDestinationIntakeResult(result);
    State.intaking = false;
    closeModal();
    toast(`${result.village.name}已入库，路线已生成`);
    render();
  } catch (error) {
    toast(`采集失败：${error.message}`);
  } finally {
    State.intaking = false;
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.innerHTML = `<i data-lucide="sparkles"></i><span>生成并入库</span>`;
      refreshIcons();
    }
  }
}

async function applyDestinationIntakeResult(result) {
  const bootstrap = await Api.bootstrap();
  State.data = bootstrap;
  window.RuralData = {
    ...window.RuralData,
    ...bootstrap,
    resourceAssets: bootstrap.resources,
  };
  updateSubmissionPortalLink();
  State.currentPlan = result.plan;
  State.form = {
    ...result.plan.form,
    targetVillageId: result.village.id,
    region: result.village.province,
    tags: result.village.tags || result.plan.form.tags,
  };
  State.villageFilter = result.village.province;
  State.villageQuery = result.village.name;
  State.resourceFilter = result.village.id;
  State.view = "planner";
}

function openResourceModal() {
  openModal(`
    <div class="modal-card narrow">
      <button class="icon-button modal-close" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button>
      <div class="modal-body">
        <span class="section-kicker">资源补充</span>
        <h2>补充可盘活资源</h2>
        <form id="resourceForm" class="form-stack">
          <label><span>所属村镇</span><select name="villageId">${State.data.villages.map((v) => `<option value="${escapeAttr(v.id)}">${escapeHtml(v.name)}</option>`).join("")}</select></label>
          <div class="field-row">
            <label><span>资源类型</span><input name="type" required placeholder="闲置院落 / 工坊 / 田块"></label>
            <label><span>资源名称</span><input name="title" required placeholder="如：竹编工坊周中空档"></label>
          </div>
          <label><span>资源主体（可选）</span><input name="owner" placeholder="村集体 / 民宿经营户 / 调研记录"></label>
          <label><span>联系方式（可选）</span><input name="contact" placeholder="可不填，仅本地保存"></label>
          <label><span>当前状态</span><input name="currentState" placeholder="如：周中空置、季节性开放"></label>
          <label><span>路线接入建议</span><textarea name="action" rows="4" placeholder="说明适合接入什么路线、有什么限制"></textarea></label>
          <button class="primary-action" type="submit"><i data-lucide="save"></i><span>保存资源</span></button>
        </form>
      </div>
    </div>
  `);
  document.querySelector("#resourceForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await Api.submitResource({ ...data, fit: State.form.tags, estimateIncome: 0, risk: "学生项目记录，需后续核验" });
      const bootstrap = await Api.bootstrap();
      State.data.resources = bootstrap.resources;
      closeModal();
      toast("资源记录已保存");
      render();
    } catch (error) {
      toast(`提交失败：${error.message}`);
    }
  });
}

function openFeedbackModal() {
  openModal(`
    <div class="modal-card narrow">
      <button class="icon-button modal-close" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button>
      <div class="modal-body">
        <span class="section-kicker">产品反馈</span>
        <h2>帮助改进网站</h2>
        <form id="feedbackForm" class="form-stack">
          <label><span>类型</span><select name="type"><option value="bug">问题</option><option value="data">数据补充</option><option value="feature">功能建议</option></select></label>
          <label><span>内容</span><textarea name="content" required rows="5" placeholder="请描述你遇到的问题或建议"></textarea></label>
          <label><span>联系方式（可选）</span><input name="contact" placeholder="手机号或邮箱"></label>
          <button class="primary-action" type="submit"><i data-lucide="send"></i><span>提交反馈</span></button>
        </form>
      </div>
    </div>
  `);
  document.querySelector("#feedbackForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await Api.submitFeedback(Object.fromEntries(new FormData(event.currentTarget)));
      closeModal();
      toast("反馈已保存");
    } catch (error) {
      toast(`提交失败：${error.message}`);
    }
  });
}

function openModal(html) {
  const root = document.querySelector("#modalRoot");
  root.innerHTML = `<div class="modal-backdrop">${html}</div>`;
  document.body.classList.add("modal-open");
  root.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);
  root.querySelector(".modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) closeModal();
  });
  refreshIcons();
}

function closeModal() {
  document.querySelector("#modalRoot").innerHTML = "";
  document.body.classList.remove("modal-open");
}

function renderPlanMap() {
  const el = document.querySelector("#planMap");
  if (!el || !State.currentPlan?.villages?.length) return;
  renderAmapStaticMap(el, State.currentPlan.villages, {
    alt: "高德静态路线地图",
    providerText: "高德地图 Web服务 · 路线按驾车时间校准",
    path: true,
    size: "760*360",
  });
}

function renderVillageMap() {
  const el = document.querySelector("#villageMap");
  if (!el) return;
  renderAmapStaticMap(el, getFilteredVillages(), {
    alt: "高德静态村镇库地图",
    providerText: "高德地图 Web服务 · 村镇库定位（静态图显示前10个定位点）",
    path: false,
    size: "1000*420",
    location: "110.5,32.5",
    zoom: "4",
    markerLimit: 10,
  });
}

function renderAmapStaticMap(el, villages, options = {}) {
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const markers = villages
    .slice(0, options.markerLimit || 10)
    .map((village, index) => `mid,0x3f6f57,${labels[index]}:${village.lng},${village.lat}`)
    .join("|");
  const paths = options.path !== false && villages.length > 1
    ? `4,0x3f6f57,0.9,,:${villages.map((village) => `${village.lng},${village.lat}`).join(";")}`
    : "";
  const params = new URLSearchParams({
    markers,
    size: options.size || "760*360",
  });
  if (paths) params.set("paths", paths);
  if (options.location) params.set("location", options.location);
  if (options.zoom) params.set("zoom", options.zoom);
  const mapUrl = Api.url(`/api/map/static?${params.toString()}`);
  el.innerHTML = `
    <img class="amap-static" src="${escapeAttr(mapUrl)}" alt="${escapeAttr(options.alt || "高德静态地图")}">
    <div class="map-provider">${escapeHtml(options.providerText || "高德地图 Web服务")}</div>
  `;
  el.querySelector(".amap-static")?.addEventListener("error", () => {
    if (options.path === false && !options.retried && villages.length > 5) {
      renderAmapStaticMap(el, villages, {
        ...options,
        markerLimit: 5,
        providerText: String(options.providerText || "高德地图 Web服务").replace(/前\d+个定位点/, "前5个定位点"),
        retried: true,
      });
      return;
    }
    el.innerHTML = `<div class="map-fallback">高德静态地图暂时没有返回图片；距离、时间和路线仍会按高德 Web 服务参与计算。</div>`;
  });
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2200);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
}

function toggleArrayItem(items, value) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function imageAttrs(src, alt) {
  const fallback = State.data.villages.find((village) => village.cover && village.cover.startsWith("./assets/"))?.cover || "./assets/village-covers/xijiang.png";
  const source = src || fallback;
  return `src="${escapeAttr(source)}" alt="${escapeAttr(alt || "乡村文旅图片")}" onerror="this.onerror=null;this.src='${escapeAttr(fallback)}';"`;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("；");
  if (typeof value === "object") {
    const direct = value.note || value.text || value.summary || value.content || value.advice || value.description;
    if (direct) return displayText(direct);
    return Object.values(value).map(displayText).filter(Boolean).join("；");
  }
  return "";
}

function escapeHtml(value) {
  return displayText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
