// frontend/pages/profile/profile.js

document.addEventListener("DOMContentLoaded", () => {
    requireAuthentication();

    // Avatar and user menu handled globally by navigation.js
    const avatarButton = document.getElementById("avatarButton");
    const logoutButton = document.getElementById("logoutButton");

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            logout();
        });
    }

    const loadingState = document.getElementById("loadingState");
    const profileView = document.getElementById("profileView");
    const profileEditor = document.getElementById("profileEditor");
    const profileForm = document.getElementById("profileForm");
    const emptyState = document.getElementById("emptyState");
    const dangerCard = document.getElementById("dangerCard");
    const pageMessage = document.getElementById("pageMessage");
    const securityShortcutCard = document.getElementById("securityShortcutCard");

    const saveButton = document.getElementById("saveButton");
    const saveButtonText = document.getElementById("saveButtonText");
    const saveSpinner = document.getElementById("saveSpinner");
    const cancelButton = document.getElementById("cancelButton");
    const saveStatus = document.getElementById("saveStatus");
    const deleteProfileButton = document.getElementById("deleteProfileButton");

    const deleteModal = document.getElementById("deleteModal");
    const deleteModalTitle = document.getElementById("deleteModalTitle");
    const deleteModalMessage = document.getElementById("deleteModalMessage");
    const modalCancelButton = document.getElementById("modalCancelButton");
    const modalConfirmButton = document.getElementById("modalConfirmButton");

    let currentProfile = null;
    let deleteTarget = null;
    const unmaskedFields = new Set();

    const FIELD_DEFINITIONS = [
        {
            section: "Personal information",
            eyebrow: "PERSONAL DETAILS",
            fields: [
                { key: "name", label: "Full name", type: "text", wide: true, required: true },
                { key: "first_name", label: "First name", type: "text" },
                { key: "middle_name", label: "Middle name", type: "text" },
                { key: "last_name", label: "Last name", type: "text" },
                { key: "dob", label: "Date of birth", type: "text" },
                {
                    key: "gender",
                    label: "Gender",
                    type: "select",
                    options: [
                        ["", "Not specified"],
                        ["MALE", "Male"],
                        ["FEMALE", "Female"],
                        ["OTHER", "Other"],
                    ],
                },
                { key: "year_of_birth", label: "Year of birth", type: "text" },
                { key: "blood_group", label: "Blood group", type: "text" },
                { key: "nationality", label: "Nationality", type: "text" },
                { key: "guardian_name", label: "Guardian / relative name", type: "text" },
                { key: "place_of_birth", label: "Place of birth", type: "text", wide: true },
            ],
        },
        {
            section: "Address",
            eyebrow: "ADDRESS",
            fields: [
                { key: "address", label: "Complete address", type: "textarea", wide: true },
                { key: "house_number", label: "House number", type: "text" },
                { key: "street", label: "Street", type: "text" },
                { key: "locality", label: "Locality", type: "text" },
                { key: "city", label: "City", type: "text" },
                { key: "state", label: "State", type: "text" },
                { key: "pincode", label: "Pincode", type: "text" },
            ],
        },
        {
            section: "Contact",
            eyebrow: "CONTACT",
            fields: [
                { key: "phone", label: "Phone number", type: "text", sensitive: true },
                { key: "email", label: "Email ID", type: "email" },
            ],
        },
        {
            section: "Government identifiers",
            eyebrow: "IDENTIFIERS",
            sensitive: true,
            fields: [
                { key: "aadhaar_number", label: "Aadhaar number", type: "text", sensitive: true },
                { key: "pan_number", label: "PAN number", type: "text", sensitive: true },
                { key: "voter_id", label: "Voter ID / EPIC number", type: "text", sensitive: true },
                { key: "passport_number", label: "Passport number", type: "text", sensitive: true },
                { key: "driving_licence_number", label: "Driving licence number", type: "text", sensitive: true },
                { key: "birth_registration_number", label: "Birth registration number", type: "text" },
            ],
        },
        {
            section: "Health insurance",
            eyebrow: "INSURANCE",
            sensitive: true,
            fields: [
                { key: "health_insurance", label: "Health insurance member / policy ID", type: "text", sensitive: true },
                { key: "insurance_details", label: "Insurance details", type: "textarea", wide: true },
            ],
        },
    ];

    const FIELD_MAP = new Map();

    FIELD_DEFINITIONS.forEach((section) => {
        section.fields.forEach((field) => {
            FIELD_MAP.set(field.key, {
                ...field,
                section: section.section,
                eyebrow: section.eyebrow,
                sensitive: Boolean(field.sensitive || section.sensitive),
            });
        });
    });

    function setPageError(message = "") {
        pageMessage.textContent = message;
    }

    function clearStatus() {
        setPageError("");
        saveStatus.textContent = "";
    }

    function hasValue(value) {
        return value !== null &&
            value !== undefined &&
            String(value).trim() !== "";
    }

    function escapeHtml(value) {
        const element = document.createElement("div");
        element.textContent = String(value ?? "");
        return element.innerHTML;
    }

    function formatLabel(value) {
        return String(value)
            .replace(/_/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function getCurrentValue(key) {
        return currentProfile?.[key] ?? "";
    }

    function updateAvatar(name) {
        const initial = String(name || "").trim().charAt(0).toUpperCase() || "U";
        if (avatarButton) {
            avatarButton.textContent = initial;
        }
    }

    function showViewMode() {
        profileEditor.hidden = true;
        profileView.hidden = false;
        dangerCard.hidden = false;
        if (securityShortcutCard) securityShortcutCard.hidden = false;
        renderProfile();
    }

    function renderProfile() {
        profileView.innerHTML = "";
        let visibleSectionCount = 0;

        FIELD_DEFINITIONS.forEach((section) => {
            const visibleFields = section.fields.filter((field) =>
                hasValue(currentProfile?.[field.key])
            );

            if (visibleFields.length === 0) {
                return;
            }

            visibleSectionCount += 1;

            const card = document.createElement("section");
            card.className = "profile-card";

            const heading = document.createElement("div");
            heading.className = "card-heading";

            const headingText = document.createElement("div");
            headingText.innerHTML = `
                <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
                <h2>${escapeHtml(section.section)}</h2>
            `;

            heading.appendChild(headingText);

            if (section.sensitive) {
                const badge = document.createElement("span");
                badge.className = "sensitive-label";
                badge.textContent = "🛡️ Encrypted at rest";
                heading.appendChild(badge);
            }

            card.appendChild(heading);

            const grid = document.createElement("div");
            grid.className = "detail-grid";

            visibleFields.forEach((field) => {
                const item = document.createElement("div");
                item.className = "detail-item" + (field.wide ? " wide" : "");

                const label = document.createElement("div");
                label.className = "detail-label";

                const deleteButton =
                    field.key === "name"
                        ? null
                        : createDeleteButton(field.key);

                label.textContent = field.label;

                const isSensitive = field.sensitive || section.sensitive;
                if (isSensitive) {
                    const badge = document.createElement("span");
                    badge.className = "sensitive-label";
                    badge.textContent = "Masked";
                    label.appendChild(badge);
                }

                if (deleteButton) {
                    label.appendChild(deleteButton);
                }

                const valueContainer = document.createElement("div");
                valueContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px;";

                const valueEl = document.createElement("div");
                valueEl.className = "detail-value";

                const rawVal = String(currentProfile[field.key] ?? "");
                const maskedVal = String(currentProfile[`${field.key}_masked`] || rawVal);

                const isCurrentlyUnmasked = unmaskedFields.has(field.key);
                valueEl.textContent = (isSensitive && !isCurrentlyUnmasked && maskedVal) ? maskedVal : rawVal;

                valueContainer.appendChild(valueEl);

                if (isSensitive && maskedVal && maskedVal !== rawVal) {
                    const toggleBtn = document.createElement("button");
                    toggleBtn.type = "button";
                    toggleBtn.style.cssText = "padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; font-size: 8px; font-weight: 600; color: var(--accent); cursor: pointer;";
                    toggleBtn.textContent = isCurrentlyUnmasked ? "Hide" : "Show";
                    toggleBtn.addEventListener("click", () => {
                        if (unmaskedFields.has(field.key)) {
                            unmaskedFields.delete(field.key);
                        } else {
                            unmaskedFields.add(field.key);
                        }
                        renderProfile();
                    });
                    valueContainer.appendChild(toggleBtn);
                }

                item.appendChild(label);
                item.appendChild(valueContainer);
                grid.appendChild(item);
            });

            card.appendChild(grid);
            profileView.appendChild(card);
        });

        if (visibleSectionCount === 0) {
            const card = document.createElement("section");
            card.className = "profile-card";
            card.innerHTML = `
                <div class="card-heading">
                    <div>
                        <p class="eyebrow">PROFILE</p>
                        <h2>No saved information</h2>
                    </div>
                </div>
                <div class="detail-grid">
                    <div class="detail-item wide">
                        <div class="detail-value">
                            Your profile exists, but it currently contains no displayable information.
                        </div>
                    </div>
                </div>
            `;
            profileView.appendChild(card);
        }

        const actions = document.createElement("div");
        actions.className = "view-actions";
        actions.innerHTML = `
            <button class="primary-button" id="editProfileButton" type="button">
                Edit profile
            </button>
        `;

        actions.querySelector("#editProfileButton").addEventListener("click", enterEditMode);
        profileView.appendChild(actions);
    }


    function createDeleteButton(fieldKey) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "delete-field-button";
        button.textContent = "Delete";
        button.dataset.field = fieldKey;

        button.addEventListener("click", () => {
            const definition = FIELD_MAP.get(fieldKey);
            openDeleteModal({
                type: "field",
                field: fieldKey,
                title: `Delete ${definition?.label || formatLabel(fieldKey)}?`,
                message:
                    `This will permanently remove ${definition?.label || "this information"} from your identity profile.`,
            });
        });

        return button;
    }

    function buildEditor() {
        profileForm.innerHTML = "";

        FIELD_DEFINITIONS.forEach((section) => {
            const card = document.createElement("section");
            card.className = "edit-card";

            const heading = document.createElement("div");
            heading.className = "card-heading";
            heading.innerHTML = `
                <div>
                    <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
                    <h2>${escapeHtml(section.section)}</h2>
                </div>
            `;

            card.appendChild(heading);

            const grid = document.createElement("div");
            grid.className = "field-grid";

            section.fields.forEach((field) => {
                const wrapper = document.createElement("div");
                wrapper.className = "field" + (field.wide ? " field-wide" : "");

                const label = document.createElement("label");
                label.htmlFor = `profile-${field.key}`;
                label.textContent = field.label;

                if (field.required) {
                    const required = document.createElement("span");
                    required.textContent = " *";
                    label.appendChild(required);
                }

                wrapper.appendChild(label);

                let control;
                if (field.type === "textarea") {
                    control = document.createElement("textarea");
                    control.rows = 3;
                } else if (field.type === "select") {
                    control = document.createElement("select");
                    field.options.forEach(([value, text]) => {
                        const option = document.createElement("option");
                        option.value = value;
                        option.textContent = text;
                        control.appendChild(option);
                    });
                } else {
                    control = document.createElement("input");
                    control.type = field.type || "text";
                }

                control.id = `profile-${field.key}`;
                control.name = field.key;
                control.value = getCurrentValue(field.key);

                if (field.key === "name") {
                    control.required = true;
                }

                if (field.sensitive || field.key === "phone") {
                    control.autocomplete = "off";
                }

                wrapper.appendChild(control);

                const help = document.createElement("div");
                help.className = "field-help";
                help.textContent = field.key === "name" ? "Full name is required by the profile schema." : "Leave blank to remove this value.";
                wrapper.appendChild(help);

                grid.appendChild(wrapper);
            });

            card.appendChild(grid);
            profileForm.appendChild(card);
        });
    }

    function enterEditMode() {
        clearStatus();
        buildEditor();

        profileView.hidden = true;
        profileEditor.hidden = false;
        dangerCard.hidden = true;
        if (securityShortcutCard) securityShortcutCard.hidden = true;

        window.scrollTo({
            top: profileEditor.offsetTop - 25,
            behavior: "smooth",
        });
    }

    function collectChangedFields() {
        const data = {};

        FIELD_DEFINITIONS.forEach((section) => {
            section.fields.forEach((field) => {
                const control = document.getElementById(`profile-${field.key}`);
                if (!control) return;

                const newValue = control.value.trim();
                const oldValue = String(currentProfile?.[field.key] ?? "").trim();

                if (newValue !== oldValue) {
                    data[field.key] = newValue;
                }
            });
        });

        return data;
    }

    function setSaving(saving) {
        saveButton.disabled = saving;
        cancelButton.disabled = saving;
        saveButtonText.textContent = saving ? "Saving..." : "Save changes";
        saveSpinner.hidden = !saving;
    }

    async function loadProfile() {
        clearStatus();

        loadingState.hidden = false;
        profileView.hidden = true;
        profileEditor.hidden = true;
        dangerCard.hidden = true;
        emptyState.hidden = true;
        if (securityShortcutCard) securityShortcutCard.hidden = true;

        try {
            const profile = await apiRequest("/api/profile/", {
                method: "GET",
            });

            currentProfile = { ...profile };
            updateAvatar(currentProfile.name);

            loadingState.hidden = true;
            showViewMode();
        } catch (error) {
            loadingState.hidden = true;
            const message = error?.message || "";

            if (message.toLowerCase().includes("profile not found")) {
                emptyState.hidden = false;
                return;
            }

            setPageError(message || "Unable to load your profile.");
            emptyState.hidden = false;
        }
    }

    profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus();

        const changedFields = collectChangedFields();
        if (Object.keys(changedFields).length === 0) {
            saveStatus.textContent = "No changes to save.";
            return;
        }

        if (
            Object.prototype.hasOwnProperty.call(changedFields, "name") &&
            !changedFields.name &&
            !String(currentProfile?.name ?? "").trim()
        ) {
            setPageError("Full name is required.");
            return;
        }

        setSaving(true);

        try {
            const updated = await apiRequest("/api/profile/", {
                method: "PUT",
                body: JSON.stringify(changedFields),
            });

            currentProfile = { ...updated };
            saveStatus.textContent = "Changes saved successfully.";
            showViewMode();

            window.scrollTo({
                top: 0,
                behavior: "smooth",
            });
        } catch (error) {
            setPageError(error?.message || "Unable to save your profile.");
        } finally {
            setSaving(false);
        }
    });

    cancelButton.addEventListener("click", () => {
        showViewMode();
        saveStatus.textContent = "Changes discarded.";
    });

    function openDeleteModal(target) {
        deleteTarget = target;
        deleteModalTitle.textContent = target.title;
        deleteModalMessage.textContent = target.message;
        modalConfirmButton.textContent = "Delete";
        modalConfirmButton.disabled = false;
        deleteModal.hidden = false;
        document.body.classList.add("modal-open");
    }

    function closeDeleteModal() {
        deleteTarget = null;
        deleteModal.hidden = true;
        document.body.classList.remove("modal-open");
    }

    modalCancelButton.addEventListener("click", closeDeleteModal);

    deleteModal.addEventListener("click", (event) => {
        if (event.target === deleteModal) {
            closeDeleteModal();
        }
    });

    modalConfirmButton.addEventListener("click", async () => {
        if (!deleteTarget) return;

        modalConfirmButton.disabled = true;
        modalConfirmButton.textContent = "Deleting...";

        try {
            let response;
            if (deleteTarget.type === "field") {
                response = await apiRequest(
                    `/api/profile/${encodeURIComponent(deleteTarget.field)}`,
                    { method: "DELETE" }
                );
                currentProfile = { ...response };
                closeDeleteModal();
                showViewMode();
                setPageError("");
            } else if (deleteTarget.type === "profile") {
                await apiRequest("/api/profile/", { method: "DELETE" });
                currentProfile = null;
                closeDeleteModal();
                dangerCard.hidden = true;
                profileView.hidden = true;
                if (securityShortcutCard) securityShortcutCard.hidden = true;
                emptyState.hidden = false;
                setPageError("");
            }
        } catch (error) {
            closeDeleteModal();
            setPageError(error?.message || "Unable to complete deletion.");
        }
    });

    if (deleteProfileButton) {
        deleteProfileButton.addEventListener("click", () => {
            openDeleteModal({
                type: "profile",
                title: "Delete entire profile?",
                message: "This will permanently remove your entire encrypted profile and all associated field tokens. This cannot be undone.",
            });
        });
    }

    loadProfile();
});
