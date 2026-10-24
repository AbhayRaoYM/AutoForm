// frontend/js/api.js

const API_BASE_URL = String(window.MEDFORM_API_BASE_URL || "").replace(/\/$/, "");
let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshed(token) {
    refreshSubscribers.forEach((cb) => cb(token));
    refreshSubscribers = [];
}

function addRefreshSubscriber(cb) {
    refreshSubscribers.push(cb);
}

function showSecurityToast(message, isError = false) {
    let container = document.getElementById("securityToastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "securityToastContainer";
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.cssText = `
        pointer-events: auto;
        padding: 12px 18px;
        border-radius: 10px;
        background: ${isError ? "#1e293b" : "#0f172a"};
        color: #ffffff;
        font-family: "Inter", sans-serif;
        font-size: 11px;
        font-weight: 500;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
        border-left: 4px solid ${isError ? "#ef4444" : "#10b981"};
        opacity: 0;
        transform: translateY(-8px);
        transition: all 0.25s ease;
        max-width: 320px;
        line-height: 1.45;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-8px)";
        setTimeout(() => toast.remove(), 250);
    }, 4500);
}

async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem("access_token");

    const headers = {
        ...(options.headers || {}),
    };

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    // Handle 401 Unauthorized with automatic token refresh (except for auth endpoints)
    if (response.status === 401 && !endpoint.includes("/api/auth/login") && !endpoint.includes("/api/auth/refresh")) {
        const isSuperseded = (data && typeof data === "object" && (data.detail?.error === "SESSION_SUPERSEDED" || data.error === "SESSION_SUPERSEDED"));
        const refreshToken = localStorage.getItem("refresh_token");

        if (refreshToken && !isSuperseded) {
            if (!isRefreshing) {
                isRefreshing = true;

                try {
                    const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ refresh_token: refreshToken }),
                    });

                    if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        if (refreshData.access_token) {
                            localStorage.setItem("access_token", refreshData.access_token);
                            if (refreshData.refresh_token) {
                                localStorage.setItem("refresh_token", refreshData.refresh_token);
                            }
                            onRefreshed(refreshData.access_token);
                            isRefreshing = false;

                            // Retry original request
                            headers["Authorization"] = `Bearer ${refreshData.access_token}`;
                            const retryRes = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
                            const retryType = retryRes.headers.get("content-type") || "";
                            return retryType.includes("application/json") ? await retryRes.json() : await retryRes.text();
                        }
                    }
                } catch (refreshErr) {
                    console.warn("Silent token refresh failed:", refreshErr);
                } finally {
                    isRefreshing = false;
                }
            } else {
                // If refresh is already in progress, wait and retry
                return new Promise((resolve, reject) => {
                    addRefreshSubscriber((newToken) => {
                        headers["Authorization"] = `Bearer ${newToken}`;
                        fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers })
                            .then((res) => res.json())
                            .then(resolve)
                            .catch(reject);
                    });
                });
            }
        }

        // Refresh failed, no refresh token, or session superseded by another login
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        if (window.location.pathname.includes("/pages/") && !window.location.pathname.includes("/login/")) {
            const noticeMsg = isSuperseded
                ? "You have been signed out because this account was logged in on another device or platform."
                : "Your session has expired. Please sign in again.";
            showSecurityToast(noticeMsg, true);
            setTimeout(() => {
                window.location.href = "../login/login.html";
            }, 1800);
        }
    }

    if (!response.ok) {
        if (response.status === 429) {
            showSecurityToast("Rate limit reached. Please wait a moment before trying again.", true);
        }

        let message = "Something went wrong.";
        let errorDetail = data?.detail || data;

        if (typeof data === "object" && data?.detail) {
            if (typeof data.detail === "string") {
                message = data.detail;
            } else if (typeof data.detail === "object" && data.detail.message) {
                message = data.detail.message;
            }
        } else if (typeof data === "string" && data.trim()) {
            message = data;
        }

        const customError = new Error(message);
        customError.status = response.status;
        customError.data = data;
        customError.detail = errorDetail;
        throw customError;
    }

    return data;
}
