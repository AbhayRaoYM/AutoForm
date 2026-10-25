/* Shared accessible mobile navigation. Safe to include on any page with .nav. */
document.addEventListener("DOMContentLoaded", () => {
  const isAuth = typeof isAuthenticated === "function" ? isAuthenticated() : Boolean(localStorage.getItem("access_token"));
  const inPagesSubdir = window.location.pathname.includes("/pages/");

  // Mount Admin Console navigation link only when logged in and within application pages
  if (isAuth && inPagesSubdir && typeof getUserRole === "function" && getUserRole() === "admin") {
    const navBar = document.querySelector(".topbar-inner > .nav");
    if (navBar && !navBar.querySelector('a[data-admin-link="true"]')) {
      const isCurrentlyAdmin = window.location.pathname.includes("/admin/");
      const adminHref = isCurrentlyAdmin ? "admin.html" : "../admin/admin.html";

      const adminLink = document.createElement("a");
      adminLink.href = adminHref;
      adminLink.textContent = "Admin";
      adminLink.dataset.adminLink = "true";
      if (isCurrentlyAdmin) {
        adminLink.classList.add("active");
        adminLink.setAttribute("aria-current", "page");
      }
      navBar.appendChild(adminLink);
    }

    const userMenu = document.getElementById("userMenu");
    if (userMenu && !userMenu.querySelector('a[data-admin-link="true"]')) {
      const isCurrentlyAdmin = window.location.pathname.includes("/admin/");
      const adminHref = isCurrentlyAdmin ? "admin.html" : "../admin/admin.html";

      const adminMenuLink = document.createElement("a");
      adminMenuLink.href = adminHref;
      adminMenuLink.textContent = "🛡️ Admin Console";
      adminMenuLink.dataset.adminLink = "true";
      userMenu.prepend(adminMenuLink);
    }
  }

  // Global bulletproof avatar menu dropdown controller
  const avatarButton = document.getElementById("avatarButton");
  const userMenu = document.getElementById("userMenu");
  if (avatarButton && userMenu && !avatarButton.dataset.menuAttached) {
    avatarButton.dataset.menuAttached = "true";
    avatarButton.setAttribute("aria-haspopup", "true");
    avatarButton.setAttribute("aria-expanded", "false");

    const openMenu = () => {
      userMenu.hidden = false;
      userMenu.classList.add("is-open");
      avatarButton.setAttribute("aria-expanded", "true");
    };

    const closeMenu = () => {
      userMenu.hidden = true;
      userMenu.classList.remove("is-open");
      avatarButton.setAttribute("aria-expanded", "false");
    };

    avatarButton.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isOpen = !userMenu.hidden && userMenu.classList.contains("is-open");
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    document.addEventListener("click", (e) => {
      if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== avatarButton && !avatarButton.contains(e.target)) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !userMenu.hidden) {
        closeMenu();
        avatarButton.focus();
      }
    });

    // Wire universal logout button if present inside userMenu
    const logoutBtn = userMenu.querySelector("#logoutButton, button[data-action='logout']");
    if (logoutBtn && !logoutBtn.dataset.boundLogout) {
      logoutBtn.dataset.boundLogout = "true";
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof logout === "function") {
          logout();
        } else {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          localStorage.removeItem("user_role");
          const inPages = window.location.pathname.includes("/pages/");
          window.location.href = inPages ? "../login/login.html" : "pages/login/login.html";
        }
      });
    }
  }

  // Record authenticated navigation visit event
  if (typeof isAuthenticated === "function" && isAuthenticated() && typeof apiRequest === "function") {
    const currentPath = window.location.pathname.toLowerCase();
    let pageName = null;
    if (currentPath.includes("dashboard")) pageName = "dashboard";
    else if (currentPath.includes("upload")) pageName = "documents";
    else if (currentPath.includes("autofill")) pageName = "autofill";
    else if (currentPath.includes("activity")) pageName = "activity";
    else if (currentPath.includes("admin")) pageName = "admin";

    if (pageName) {
      apiRequest("/api/auth/security/log-visit", {
        method: "POST",
        body: JSON.stringify({ page: pageName }),
      }).catch(() => {});
    }
  }

  const nav = document.querySelector(".topbar-inner > .nav");
  const headerInner = document.querySelector(".topbar-inner");
  if (!nav || !headerInner) return;

  if (!nav.id) nav.id = "primaryNavigation";
  if (!nav.hasAttribute("aria-label")) nav.setAttribute("aria-label", "Primary navigation");
  nav.querySelectorAll("a.active").forEach((link) => link.setAttribute("aria-current", "page"));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-toggle";
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open navigation menu");
  toggle.innerHTML = '<span class="nav-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span><span>Menu</span>';
  nav.before(toggle);

  const closeMenu = ({ returnFocus = false } = {}) => {
    nav.classList.remove("is-mobile-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
    if (returnFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    const opening = toggle.getAttribute("aria-expanded") !== "true";
    nav.classList.toggle("is-mobile-open", opening);
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.setAttribute("aria-label", opening ? "Close navigation menu" : "Open navigation menu");
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!headerInner.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-mobile-open")) {
      closeMenu({ returnFocus: true });
    }
  });

  const desktopQuery = window.matchMedia("(min-width: 821px)");
  const resetForViewport = () => {
    if (desktopQuery.matches) closeMenu();
  };
  if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", resetForViewport);
  else desktopQuery.addListener(resetForViewport);
});
