// frontend/pages/admin/admin.js

document.addEventListener("DOMContentLoaded", async () => {
    // RBAC Protection: ensure user is authenticated and has admin role
    if (typeof requireAdmin === "function") {
        if (!requireAdmin()) return;
    } else if (typeof requireAuthentication === "function") {
        if (!requireAuthentication()) return;
    }

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton && typeof logout === "function") {
        logoutButton.addEventListener("click", () => logout());
    }

    function formatSystemTimeIST(dateString) {
        if (!dateString) return "—";
        try {
            let str = String(dateString).trim();
            if (!str.endsWith("Z") && !str.includes("+") && !/[0-9]-[0-9]{2}:[0-9]{2}$/.test(str)) {
                str += "Z";
            }
            const date = new Date(str);
            if (isNaN(date.getTime())) return String(dateString);

            return date.toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            });
        } catch {
            return String(dateString);
        }
    }

    // Toast notification helper
    const toast = document.getElementById("adminToast");
    let toastTimeout = null;

    function showToast(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        toast.style.background = isError ? "var(--danger)" : "var(--navy)";
        toast.hidden = false;

        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.hidden = true;
        }, 4000);
    }

    // Load Metrics
    async function loadStats() {
        try {
            const stats = await apiRequest("/api/admin/stats");
            document.getElementById("statTotalUsers").textContent = stats.total_users ?? 0;
            document.getElementById("statAdminRatio").textContent = `${stats.admin_users ?? 0} Admins · ${stats.patient_users ?? 0} Users`;
            document.getElementById("statPatients").textContent = stats.patient_users ?? 0;
            document.getElementById("statLockedUsers").textContent = stats.locked_users ?? 0;
            document.getElementById("statLockedSub").textContent = `${stats.locked_users ?? 0} active lockout${stats.locked_users === 1 ? "" : "s"}`;
            document.getElementById("statAuditEvents").textContent = stats.total_audit_events ?? 0;
            document.getElementById("statFailedLogins").textContent = `${stats.failed_logins ?? 0} failed login attempts`;
        } catch (err) {
            console.error("Failed to load admin stats:", err);
            showToast("Failed to load metrics", true);
        }
    }

    // Load Users
    async function loadUsers() {
        const tbody = document.getElementById("usersTableBody");
        if (!tbody) return;

        try {
            const users = await apiRequest("/api/admin/users?limit=50");
            if (!users || users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">No users found.</td></tr>`;
                return;
            }

            tbody.innerHTML = users.map((u) => {
                const roleClass = u.role === "admin" ? "role-admin" : "role-patient";
                const isLocked = u.is_locked;
                const statusPill = isLocked
                    ? `<span class="status-pill status-locked">🔒 Locked</span>`
                    : `<span class="status-pill status-active">✓ Active</span>`;

                const lockoutText = isLocked && u.remaining_lockout_seconds > 0
                    ? `${Math.ceil(u.remaining_lockout_seconds / 60)} min remaining`
                    : "—";

                const createdAtStr = formatSystemTimeIST(u.created_at);

                const unlockBtn = (isLocked || u.failed_login_attempts > 0)
                    ? `<button class="btn-sm-action btn-sm-unlock" data-action="unlock" data-user-id="${u.id}">Unlock</button>`
                    : "";

                return `
                    <tr data-user-id="${u.id}">
                        <td><span class="code-snippet">${u.id}</span></td>
                        <td>
                            <select class="role-select" data-action="role" data-user-id="${u.id}">
                                <option value="patient" ${u.role === "patient" || u.role === "user" ? "selected" : ""}>User</option>
                                <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
                            </select>
                        </td>
                        <td>${statusPill}</td>
                        <td>${u.failed_login_attempts}</td>
                        <td>${lockoutText}</td>
                        <td>${createdAtStr}</td>
                        <td>
                            <div class="action-group">
                                ${unlockBtn}
                            </div>
                        </td>
                    </tr>
                `;
            }).join("");

            // Attach user action event handlers
            tbody.querySelectorAll("button[data-action='unlock']").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const userId = btn.dataset.userId;
                    btn.disabled = true;
                    btn.textContent = "Unlocking...";
                    try {
                        await apiRequest(`/api/admin/users/${userId}/unlock`, { method: "POST" });
                        showToast(`User account ${userId} unlocked successfully`);
                        await Promise.all([loadStats(), loadUsers(), loadAuditLogs()]);
                    } catch (err) {
                        console.error("Unlock failed:", err);
                        showToast(err.message || "Failed to unlock user", true);
                        btn.disabled = false;
                        btn.textContent = "Unlock";
                    }
                });
            });

            tbody.querySelectorAll("select[data-action='role']").forEach((select) => {
                select.addEventListener("change", async () => {
                    const userId = select.dataset.userId;
                    const newRole = select.value;
                    const oldRole = newRole === "admin" ? "patient" : "admin";

                    try {
                        await apiRequest(`/api/admin/users/${userId}/role`, {
                            method: "POST",
                            body: JSON.stringify({ role: newRole }),
                        });
                        showToast(`Role updated to '${newRole}' for user ${userId}`);
                        await Promise.all([loadStats(), loadUsers(), loadAuditLogs()]);
                    } catch (err) {
                        console.error("Role update failed:", err);
                        showToast(err.message || "Failed to update role", true);
                        select.value = oldRole;
                    }
                });
            });

        } catch (err) {
            console.error("Failed to load users:", err);
            tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color: var(--danger)">Error loading users: ${err.message}</td></tr>`;
        }
    }

    // Load Audit Logs
    async function loadAuditLogs() {
        const tbody = document.getElementById("auditTableBody");
        if (!tbody) return;

        try {
            const logs = await apiRequest("/api/admin/audit-logs?limit=50");
            if (!logs || logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">No audit log records found.</td></tr>`;
                return;
            }

            tbody.innerHTML = logs.map((log) => {
                const isSuccess = log.status === "SUCCESS";
                const statusTag = isSuccess
                    ? `<span class="status-tag tag-success">SUCCESS</span>`
                    : `<span class="status-tag tag-failure">${log.status}</span>`;

                let timeStr = "—";
                if (log.timestamp) {
                    try {
                        let str = String(log.timestamp).trim();
                        if (!str.endsWith("Z") && !str.includes("+") && !/[0-9]-[0-9]{2}:[0-9]{2}$/.test(str)) {
                            str += "Z";
                        }
                        timeStr = new Date(str).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: true,
                        });
                    } catch {
                        timeStr = String(log.timestamp);
                    }
                }

                // Sanitize internal AI model/engine keys before displaying in UI
                let detailsObj = log.details && typeof log.details === "object" ? { ...log.details } : {};
                delete detailsObj.engine;
                delete detailsObj.model;
                delete detailsObj.gemini_model;
                delete detailsObj.ai_service;

                if (detailsObj.role && String(detailsObj.role).toLowerCase() === "patient") {
                    detailsObj.role = "user";
                }
                if (detailsObj.new_role && String(detailsObj.new_role).toLowerCase() === "patient") {
                    detailsObj.new_role = "user";
                }
                if (detailsObj.old_role && String(detailsObj.old_role).toLowerCase() === "patient") {
                    detailsObj.old_role = "user";
                }

                const detailsJson = Object.keys(detailsObj).length > 0
                    ? JSON.stringify(detailsObj)
                    : "—";

                return `
                    <tr>
                        <td>${timeStr}</td>
                        <td><span class="action-chip">${log.action}</span></td>
                        <td>${statusTag}</td>
                        <td><span class="code-snippet">${log.user_id}</span></td>
                        <td><span class="code-snippet">${log.ip_address}</span></td>
                        <td><span class="code-snippet" title="${detailsJson}">${detailsJson.length > 50 ? detailsJson.slice(0, 50) + "..." : detailsJson}</span></td>
                    </tr>
                `;
            }).join("");

        } catch (err) {
            console.error("Failed to load audit logs:", err);
            tbody.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color: var(--danger)">Error loading audit logs: ${err.message}</td></tr>`;
        }
    }

    // Refresh button event listeners
    const refreshUsersBtn = document.getElementById("refreshUsersBtn");
    if (refreshUsersBtn) {
        refreshUsersBtn.addEventListener("click", () => {
            loadUsers();
            loadStats();
        });
    }

    const refreshAuditBtn = document.getElementById("refreshAuditBtn");
    if (refreshAuditBtn) {
        refreshAuditBtn.addEventListener("click", () => {
            loadAuditLogs();
            loadStats();
        });
    }

    // Initial page data load
    await Promise.all([loadStats(), loadUsers(), loadAuditLogs()]);
});
