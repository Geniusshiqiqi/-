const Tags = [
  { id: "farming", name: "农事体验" },
  { id: "craft", name: "非遗手作" },
  { id: "heritage", name: "古村民俗" },
  { id: "food", name: "乡土风味" },
  { id: "nature", name: "山野生态" },
  { id: "homestay", name: "民宿旅居" },
  { id: "fieldwork", name: "研学调研" },
  { id: "commerce", name: "特产助农" },
  { id: "resource", name: "资源盘活" },
];

const State = {
  submissions: [],
  adminToken: localStorage.getItem("ruralAdminToken") || "",
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  renderTags();
  bindForm();
  bindAdmin();
  if (document.querySelector("#adminList")) {
    loadStats();
    renderAdminPrompt();
    if (State.adminToken) loadSubmissions();
  } else {
    loadStats();
  }
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
}

function renderTags() {
  const grid = document.querySelector("#tagGrid");
  if (!grid) return;
  grid.innerHTML = Tags.map((tag) => `
    <label class="tag-option">
      <input type="checkbox" name="tags" value="${escapeAttr(tag.id)}">
      <span>${escapeHtml(tag.name)}</span>
    </label>
  `).join("");
}

function bindForm() {
  const form = document.querySelector("#submissionForm");
  const photoInput = document.querySelector("#photoInput");
  if (!form || !photoInput) return;
  photoInput.addEventListener("change", renderPhotoPreview);
  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      document.querySelector("#photoPreview").innerHTML = "";
      toast("表单已清空");
    }, 0);
  });
  form.addEventListener("submit", submitForm);
}

function bindAdmin() {
  const tokenInput = document.querySelector("#adminToken");
  if (tokenInput) {
    tokenInput.value = State.adminToken;
    tokenInput.addEventListener("input", () => {
      State.adminToken = tokenInput.value.trim();
      localStorage.setItem("ruralAdminToken", State.adminToken);
    });
    tokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadSubmissions();
    });
  }
  document.querySelector("#refreshAdmin")?.addEventListener("click", loadSubmissions);
  document.querySelector("#exportApproved")?.addEventListener("click", exportApproved);
}

function renderPhotoPreview() {
  const files = [...document.querySelector("#photoInput").files].slice(0, 8);
  const preview = document.querySelector("#photoPreview");
  preview.innerHTML = "";
  for (const file of files) {
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    preview.appendChild(img);
  }
  if (document.querySelector("#photoInput").files.length > 8) {
    toast("最多保存前 8 张图片");
  }
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.querySelector("span").textContent = "提交中";
  try {
    const formData = new FormData(form);
    normalizeMultiline(formData, "highlights");
    normalizeMultiline(formData, "experiences");
    normalizeMultiline(formData, "products");
    normalizeMultiline(formData, "facilities");
    normalizeMultiline(formData, "painPoints");
    const response = await fetch("/api/submissions", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "提交失败");
    form.reset();
    document.querySelector("#photoPreview").innerHTML = "";
    toast("申报已进入待审核库");
    await loadStats();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "提交入库申报";
  }
}

function normalizeMultiline(formData, key) {
  const value = String(formData.get(key) || "");
  formData.set(key, value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).join("\n"));
}

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "统计加载失败");
    renderStats(result);
  } catch (error) {
    toast(error.message);
  }
}

async function loadSubmissions() {
  try {
    const response = await fetch("/api/submissions", {
      headers: adminHeaders(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "加载失败");
    State.submissions = result.items || [];
    renderStats(result);
    renderAdminList();
  } catch (error) {
    toast(error.message);
  }
}

function renderStats(result) {
  const total = result.total ?? State.submissions.length;
  const approved = result.approved ?? State.submissions.filter((item) => item.status === "approved" || item.status === "imported").length;
  const pending = result.pending ?? State.submissions.filter((item) => item.status === "pending").length;
  document.querySelector("#submissionCount").textContent = total;
  document.querySelector("#approvedCount").textContent = approved;
  const pendingNode = document.querySelector("#pendingCount");
  if (pendingNode) pendingNode.textContent = pending;
}

function renderAdminList() {
  const root = document.querySelector("#adminList");
  if (!root) return;
  if (!State.submissions.length) {
    root.innerHTML = `<div class="empty-state">暂无申报记录</div>`;
    return;
  }
  root.innerHTML = State.submissions.map((item) => renderSubmissionCard(item)).join("");
  root.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => updateStatus(button.dataset.id, button.dataset.status));
  });
}

function renderAdminPrompt() {
  const root = document.querySelector("#adminList");
  if (!root) return;
  root.innerHTML = `<div class="empty-state">请输入本地审核口令后点击刷新，公开申报页不会显示这里的审批功能。</div>`;
}

function renderSubmissionCard(item) {
  const statusText = { pending: "待审核", approved: "可入库", rejected: "已驳回", imported: "已导入" }[item.status] || item.status;
  const tags = (item.tags || []).map((tag) => Tags.find((itemTag) => itemTag.id === tag)?.name || tag);
  const createdAt = new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false });
  return `
    <article class="submission-card">
      <div>
        <div class="submission-meta">
          <span class="status-pill status-${escapeAttr(item.status)}">${escapeHtml(statusText)}</span>
          <span>${escapeHtml(item.province)} · ${escapeHtml(item.city)}</span>
          <span>${escapeHtml(createdAt)}</span>
        </div>
        <h2>${escapeHtml(item.villageName)}</h2>
        <p>${escapeHtml(item.summary)}</p>
        <div class="pill-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="compact-note">地址：${escapeHtml(item.address || `${item.province}${item.city}`)}；交通：${escapeHtml(item.transportNode || "未填")}</p>
        <p class="compact-note">联系人：${escapeHtml(item.contactName)} / ${escapeHtml(item.contactPhone)}</p>
        <p class="compact-note">图片：${item.photos?.length || 0} 张；建议停留：${escapeHtml(String(item.stayNights || 0))} 晚；接待能力：${escapeHtml(item.capacity)}</p>
      </div>
      <div class="card-actions">
        <button class="secondary-button" data-status="approved" data-id="${escapeAttr(item.id)}">通过</button>
        <button class="secondary-button" data-status="rejected" data-id="${escapeAttr(item.id)}">驳回</button>
        <button class="secondary-button" data-status="pending" data-id="${escapeAttr(item.id)}">待审</button>
      </div>
    </article>
  `;
}

async function updateStatus(id, status) {
  try {
    const response = await fetch(`/api/submissions/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ status }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "状态更新失败");
    toast("状态已更新");
    await loadSubmissions();
  } catch (error) {
    toast(error.message);
  }
}

async function exportApproved() {
  try {
    const response = await fetch("/api/export/approved", {
      headers: adminHeaders(),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "导出失败");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `approved-rural-villages-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("已导出可入库 JSON");
  } catch (error) {
    toast(error.message);
  }
}

function adminHeaders() {
  return { "x-admin-token": State.adminToken || "" };
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
