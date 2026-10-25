// frontend/pages/activity/activity.js

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireAuthentication === "function" && !requireAuthentication()) return;
    // Load the logged-in user's initial into the avatar.
const avatarButton = document.getElementById("avatarButton");

if (avatarButton) {
    async function loadAvatarInitial() {
        avatarButton.textContent = "U";

        try {
            const response = await apiRequest("/api/profile/", {
                method: "GET"
            });

            const profile =
                response?.profile ||
                response?.data?.profile ||
                response?.data ||
                response;

            const name = String(
                profile?.name ||
                profile?.full_name ||
                profile?.fullName ||
                ""
            ).trim();

            if (name) {
                avatarButton.textContent = name.charAt(0).toUpperCase();
            }
        } catch (error) {
            console.error("[Avatar] Failed to load profile:", error);
        }
    }

    loadAvatarInitial();
}

    // Avatar Menu dropdown & logout handled globally by navigation.js
    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton && typeof logout === "function") {
        logoutButton.addEventListener("click", () => logout());
    }

    const tbody = document.getElementById("activityTableBody");
    const refreshBtn = document.getElementById("refreshBtn");
    const eventFilter = document.getElementById("eventFilter");

    const statTotalEvents = document.getElementById("statTotalEvents");
    const statLastLogin = document.getElementById("statLastLogin");

    let allLogs = [];

    /**
     * Formats timestamp with UTC+5:30 (IST) offset accurately
     */
    function formatSystemTime(dateString) {
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

    /**
     * Converts raw action strings to user-friendly titles
     */
    function formatActionName(action) {
        const actionMap = {
            "LOGIN_SUCCESS": "Sign In Successful",
            "LOGIN_FAILED_PASSWORD": "Password Check Failed",
            "ACCOUNT_LOCKED": "Account Temporarily Locked",
            "LOGIN_BLOCKED_LOCKED": "Sign In Attempt Blocked",
            "LOGIN_BLOCKED_ACTIVE_SESSION": "Concurrent Sign-In Blocked",
            "LOGOUT": "User Signed Out",
            "SESSION_SUPERSEDED": "Session Invalidated (Signed In Elsewhere)",
            "USER_REGISTERED": "Account Registered",
            "DASHBOARD_VIEW": "Dashboard Visited",
            "DASHBOARD_ACCESSED": "Dashboard Visited",
            "DOCUMENTS_PAGE_VIEW": "Documents Page Visited",
            "DOCUMENTS_ACCESSED": "Documents Page Visited",
            "DOCUMENT_UPLOADED": "Document Uploaded",
            "DOCUMENT_EXTRACT": "Document Data Extracted",
            "DOCUMENT_EXTRACT_FAILED": "Document Extraction Failed",
            "DOCUMENT_CONSENT_PERSISTED": "Document Data Saved to Vault",
            "FORMS_PAGE_VIEW": "Forms Page Visited",
            "FORMS_ACCESSED": "Forms Page Visited",
            "FORM_AUTOFILL": "Form Autofill Processed",
            "FORM_AUTOFILL_COMPLETED": "Form Autofill Completed",
            "SECURITY_ACTIVITY_VIEW": "Activity Log Viewed",
            "PROFILE_VIEW": "Profile Vault Accessed",
            "PROFILE_ACCESSED": "Profile Vault Accessed",
            "PROFILE_UPDATE": "Profile Information Updated",
            "PROFILE_FIELD_DELETE": "Profile Field Removed",
            "PROFILE_FIELD_DELETED": "Profile Field Removed",
            "PROFILE_DELETE_ALL": "Profile Deleted",
            "PROFILE_DELETED": "Profile Deleted",
            "ADMIN_CONSOLE_VIEW": "Admin Console Visited",
            "ADMIN_ACCOUNT_UNLOCKED": "Account Unlocked by Admin",
            "ADMIN_ROLE_UPDATED": "User Role Updated",
        };

        const cleanKey = String(action || "").trim().toUpperCase();
        if (actionMap[cleanKey]) return actionMap[cleanKey];
        return cleanKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /**
     * Strictly sanitizes details before UI rendering to never reveal internal AI model/engine names
     */
    function formatDetailsForUI(details, action) {
        if (!details || typeof details !== "object" || Object.keys(details).length === 0) {
            return "—";
        }

        // Clone and sanitize internal technical model/engine keys
        const sanitized = { ...details };
        delete sanitized.engine;
        delete sanitized.model;
        delete sanitized.gemini_model;
        delete sanitized.ai_service;
        delete sanitized.textract_engine;

        // Display role: 'patient' as 'user' in UI
        if (sanitized.role && String(sanitized.role).toLowerCase() === "patient") {
            sanitized.role = "user";
        }
        if (sanitized.new_role && String(sanitized.new_role).toLowerCase() === "patient") {
            sanitized.new_role = "user";
        }
        if (sanitized.old_role && String(sanitized.old_role).toLowerCase() === "patient") {
            sanitized.old_role = "user";
        }

        const keys = Object.keys(sanitized);
        if (keys.length === 0) return "—";

        // Provide friendly summaries for common actions
        if (action === "DOCUMENT_EXTRACT" && sanitized.doc_type) {
            return `Document: ${sanitized.doc_type.toUpperCase()}${sanitized.filename_ext ? ` (${sanitized.filename_ext})` : ""}`;
        }
        if (action === "LOGIN_FAILED_PASSWORD" && sanitized.attempts_left !== undefined) {
            return `Remaining attempts before lockout: ${sanitized.attempts_left}`;
        }
        if (action === "PROFILE_UPDATE" && sanitized.updated_fields) {
            return `Updated fields: ${Array.isArray(sanitized.updated_fields) ? sanitized.updated_fields.join(", ") : sanitized.updated_fields}`;
        }
        if (action === "ACCOUNT_LOCKED" && sanitized.lockout_minutes) {
            return `Locked for ${sanitized.lockout_minutes} minutes due to multiple failed attempts`;
        }

        if (sanitized.page) {
            return `Page: ${String(sanitized.page).toUpperCase()}`;
        }

        return Object.entries(sanitized)
            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
            .join(" · ");
    }

    function renderTable() {
        if (!tbody) return;

        const filterValue = eventFilter ? eventFilter.value : "ALL";

        const filteredLogs = allLogs.filter((log) => {
            const action = log.action || "";
            if (filterValue === "ALL") return true;
            if (filterValue === "AUTH") return action.includes("LOGIN") || action.includes("LOGOUT") || action.includes("REGISTER") || action.includes("LOCKED");
            if (filterValue === "VIEW") return action.includes("VIEW") || action.includes("ACCESSED") || action.includes("VISITED");
            if (filterValue === "PROFILE") return action.includes("PROFILE");
            if (filterValue === "DOC") return action.includes("DOCUMENT") || action.includes("FORM");
            return true;
        });

        if (filteredLogs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="table-empty">
                        No activity records found matching this filter.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filteredLogs.map((log) => {
            const isSuccess = log.status === "SUCCESS";
            const statusClass = isSuccess ? "status-success" : "status-failure";
            const statusText = isSuccess ? "SUCCESS" : (log.status || "FAILED");

            const localTime = formatSystemTime(log.timestamp);
            const actionName = formatActionName(log.action);
            const detailsText = formatDetailsForUI(log.details, log.action);

            return `
                <tr>
                    <td class="time-cell">
                        ${localTime}
                    </td>
                    <td>
                        <span class="event-chip">${actionName}</span>
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </td>
                    <td>
                        <span class="ip-code">${log.ip_address || "—"}</span>
                    </td>
                    <td class="details-snippet">
                        ${detailsText}
                    </td>
                </tr>
            `;
        }).join("");
    }

    async function loadLogs() {
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="5" class="table-loading">Loading activity history...</td></tr>`;

        try {
            const response = await apiRequest("/api/auth/security/activity?limit=100", { method: "GET" });
            const logs = Array.isArray(response) ? response : (response?.logs || []);
            const totalCount = typeof response?.total === "number" ? response.total : logs.length;
            allLogs = logs;

            // Update stats
            if (statTotalEvents) {
                statTotalEvents.textContent = totalCount;
            }

            const lastLoginLog = allLogs.find((l) => l.action === "LOGIN_SUCCESS");
            if (statLastLogin) {
                if (lastLoginLog && lastLoginLog.timestamp) {
                    statLastLogin.textContent = formatSystemTime(lastLoginLog.timestamp);
                } else {
                    statLastLogin.textContent = "Current session";
                }
            }

            renderTable();

        } catch (err) {
            console.error("Failed to load activity logs:", err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="table-empty" style="color: var(--danger, #c62828);">
                        Unable to load activity logs: ${err.message || "Network error"}
                    </td>
                </tr>
            `;
        }
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => loadLogs());
    }

    if (eventFilter) {
        eventFilter.addEventListener("change", () => renderTable());
    }

    await loadLogs();
});
