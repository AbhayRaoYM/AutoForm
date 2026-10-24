
document.addEventListener("DOMContentLoaded", async () => {
    requireAuthentication();

    if (!isAuthenticated()) return;

    const welcomeUser = document.getElementById("welcomeUser");
    const greeting = document.getElementById("greeting");
    const avatarButton = document.getElementById("avatarButton");
    const profileAvatar = document.getElementById("profileAvatar");
    const userMenu = document.getElementById("userMenu");
    const logoutButton = document.getElementById("logoutButton");

    const profileName = document.getElementById("profileName");
    const profilePhone = document.getElementById("profilePhone");
    const profileEmail = document.getElementById("profileEmail");
    const profileDob = document.getElementById("profileDob");
    const profileAddress = document.getElementById("profileAddress");

    const documentCount = document.getElementById("documentCount");
    const profileFieldCount = document.getElementById("profileFieldCount");
    const formsFilledCount = document.getElementById("formsFilledCount");

    // User menu handled globally by navigation.js
    if (logoutButton) {
        logoutButton.addEventListener("click", () => logout());
    }

    // Default values until real data is loaded
    documentCount.textContent = "—";
    profileFieldCount.textContent = "—";
    formsFilledCount.textContent = "—";

    function displayValue(value) {
        return value !== null && value !== undefined &&
            String(value).trim() !== ""
            ? String(value)
            : "—";
    }

    function setUserIdentity(name) {
        const displayName = String(name || "").trim();
        const initial = displayName ? displayName.charAt(0).toUpperCase() : "U";

        welcomeUser.textContent = displayName
            ? `Welcome, ${displayName}`
            : "Welcome";

        greeting.textContent = displayName
            ? `Welcome back, ${displayName}`
            : "Welcome back";

        avatarButton.textContent = initial;
        profileAvatar.textContent = initial;

        profileName.textContent = displayName || "Your identity profile";
    }

    // Load the authenticated user's profile
    try {
        const profile = await apiRequest("/api/profile/");

        const name = profile.name ||
            [profile.first_name, profile.middle_name, profile.last_name]
                .filter(Boolean)
                .join(" ");

        setUserIdentity(name);

        profilePhone.textContent = displayValue(profile.phone);
        profileEmail.textContent = displayValue(profile.email);
        profileDob.textContent = displayValue(profile.dob);
        profileAddress.textContent = displayValue(profile.address);

        // Count populated user-facing profile fields.
        const excludedFields = new Set(["id", "user_id"]);

        const populatedFields = Object.entries(profile).filter(
            ([key, value]) =>
                !excludedFields.has(key) &&
                value !== null &&
                value !== undefined &&
                String(value).trim() !== ""
        );

        profileFieldCount.textContent = populatedFields.length;

    } catch (error) {
        if (error.message === "Failed to fetch") {
            profileName.textContent = "Unable to connect to server";
        } else {
            profileName.textContent = "No profile information available";
        }

        setUserIdentity("");
        profilePhone.textContent = "—";
        profileEmail.textContent = "—";
        profileDob.textContent = "—";
        profileAddress.textContent = "—";
        profileFieldCount.textContent = "0";

        console.error("Dashboard profile loading failed:", error);
    }

    // Existing navigation behavior
    const navigationRoutes = {
        fill: "../autofill/autofill.html",
        upload: "../upload/upload.html",
        documents: "../upload/upload.html",
        profile: "../profile/profile.html"
    };

    document.querySelectorAll("[data-action]").forEach((element) => {
        element.addEventListener("click", () => {
            const destination = navigationRoutes[element.dataset.action];

            if (destination) {
                window.location.href = destination;
            }
        });
    });
});
