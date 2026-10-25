// frontend/pages/upload/upload.js

document.addEventListener("DOMContentLoaded", () => {
    if (window.MEDFORM_DEBUG === true) console.log("[MedForm] upload.js loaded");

    // Authentication
    if (typeof requireAuthentication === "function") {
        requireAuthentication();
    }

        // ---------------------------------------------------------
    // AVATAR AND ACCOUNT MENU
    // ---------------------------------------------------------

    const avatarButton = document.getElementById("avatarButton");
    const logoutButton = document.getElementById("logoutButton");

    if (avatarButton) {
        // Fetch the profile and set the avatar initial.
        async function loadAvatarInitial() {
            try {
                const response = await apiRequest("/api/profile/", {
                    method: "GET"
                });

                const profile =
                    response.profile || response.data || response;

                const name = String(profile.name || "").trim();

                avatarButton.textContent =
                    name.charAt(0).toUpperCase() || "U";
            } catch (error) {
                avatarButton.textContent = "U";
            }
        }

        loadAvatarInitial();
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            logout();
        });
    }

    const fileInput = document.getElementById("documentFile");
    const uploadArea = document.getElementById("uploadArea");
    const selectedFile = document.getElementById("selectedFile");
    const fileName = document.getElementById("fileName");
    const fileSize = document.getElementById("fileSize");
    const fileIcon = document.getElementById("fileIcon");
    const removeButton = document.getElementById("removeButton");

    const extractButton = document.getElementById("extractButton");
    const extractButtonText =
        document.getElementById("extractButtonText");
    const extractSpinner =
        document.getElementById("extractSpinner");

    const uploadState = document.getElementById("uploadState");
    const processingState =
        document.getElementById("processingState");
    const savedState = document.getElementById("savedState");
    const reviewState = document.getElementById("reviewState");
    const qualityDot = document.getElementById("qualityDot");
    const qualityLabel = document.getElementById("qualityLabel");
    const qualityReasons = document.getElementById("qualityReasons");
    const documentImageWrap = document.getElementById("documentImageWrap");
    const documentPreviewImage = document.getElementById("documentPreviewImage");
    const documentPreviewPdf = document.getElementById("documentPreviewPdf");
    const boundingBoxOverlay = document.getElementById("boundingBoxOverlay");
    const previewFallback = document.getElementById("previewFallback");
    const reviewFields = document.getElementById("reviewFields");
    const addReviewFieldButton = document.getElementById("addReviewFieldButton");
    const reviewEditNote = document.getElementById("reviewEditNote");
    const editDetailsButton = document.getElementById("editDetailsButton");
    const reuploadDocumentButton = document.getElementById("reuploadDocumentButton");
    const proceedConsentButton = document.getElementById("proceedConsentButton");
    const goBackEditButton = document.getElementById("goBackEditButton");

    const uploadError = document.getElementById("uploadError");

    const consentModal =
        document.getElementById("consentModal");
    const consentFields =
        document.getElementById("consentFields");
    const consentCheckbox =
        document.getElementById("consentCheckbox");
    const consentError =
        document.getElementById("consentError");

    const acceptConsentButton =
        document.getElementById("acceptConsentButton");
    const declineConsentButton =
        document.getElementById("declineConsentButton");

    const stepUpload =
        document.getElementById("stepUpload");
    const stepReview =
        document.getElementById("stepReview");
    const stepSaved =
        document.getElementById("stepSaved");
    const stepConsent = document.getElementById("stepConsent");

    const uploadAnotherButton =
        document.getElementById("uploadAnotherButton");

    let selectedFileObject = null;
    let extractedData = null;
    let isEditingReview = false;
    let previewObjectUrl = null;

    const MAX_SIZE = 10 * 1024 * 1024;
    const ALLOWED_EXTENSIONS = [
        "pdf",
        "jpg",
        "jpeg",
        "png"
    ];

    // ---------------------------------------------------------
    // BASIC VALIDATION
    // ---------------------------------------------------------

    function validateFile(file) {
        if (!file) {
            return "Please select a document.";
        }

        const extension = file.name
            .split(".")
            .pop()
            .toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
            return (
                "Only PDF, JPG, JPEG and PNG files are allowed."
            );
        }

        if (file.size > MAX_SIZE) {
            return "The document must be smaller than 10 MB.";
        }

        return null;
    }

    function showError(message) {
        uploadError.textContent = message || "";
        uploadError.hidden = !message;
    }

    function clearError() {
        showError("");
        consentError.textContent = "";
    }

    function formatSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }

        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ---------------------------------------------------------
    // STEPS
    // ---------------------------------------------------------

    function setStep(stage) {
        [stepUpload, stepReview, stepConsent, stepSaved].forEach((step) => {
            if (step) step.classList.remove("active", "complete");
        });

        if (stage === "upload") {
            stepUpload.classList.add("active");
        } else if (stage === "review") {
            stepUpload.classList.add("complete");
            stepReview.classList.add("active");
        } else if (stage === "consent") {
            stepUpload.classList.add("complete");
            stepReview.classList.add("complete");
            stepConsent.classList.add("active");
        } else if (stage === "saved") {
            stepUpload.classList.add("complete");
            stepReview.classList.add("complete");
            stepConsent.classList.add("complete");
            stepSaved.classList.add("active");
        }
    }

    // ---------------------------------------------------------
    // FILE SELECTION
    // ---------------------------------------------------------

    function selectFile(file) {
        clearError();

        const error = validateFile(file);

        if (error) {
            selectedFileObject = null;
            selectedFile.hidden = true;
            extractButton.disabled = true;
            showError(error);
            return;
        }

        selectedFileObject = file;

        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size);
        fileIcon.textContent =
            file.name.split(".").pop().toUpperCase();

        selectedFile.hidden = false;
        extractButton.disabled = false;

        if (window.MEDFORM_DEBUG === true) console.log(
            "[MedForm] file selected:",
            file.name
        );
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];

        if (file) {
            selectFile(file);
        }
    });

    removeButton.addEventListener("click", () => {
        fileInput.value = "";
        selectedFileObject = null;
        resetPendingExtraction();

        selectedFile.hidden = true;
        extractButton.disabled = true;

        clearError();
    });

    // ---------------------------------------------------------
    // DRAG & DROP
    // ---------------------------------------------------------

    uploadArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        uploadArea.classList.add("drag-over");
    });

    uploadArea.addEventListener("dragleave", () => {
        uploadArea.classList.remove("drag-over");
    });

    uploadArea.addEventListener("drop", (event) => {
        event.preventDefault();
        uploadArea.classList.remove("drag-over");

        const file = event.dataTransfer.files[0];

        if (file) {
            selectFile(file);
        }
    });

    // ---------------------------------------------------------
    // EXTRACT BUTTON
    // ---------------------------------------------------------

    extractButton.addEventListener(
        "click",
        async () => {
            if (window.MEDFORM_DEBUG === true) console.log(
                "[MedForm] Extract button clicked"
            );

            clearError();

            if (!selectedFileObject) {
                showError(
                    "Please select a document first."
                );
                return;
            }

            extractButton.disabled = true;
            extractButtonText.textContent =
                "Extracting...";
            extractSpinner.hidden = false;

            uploadState.hidden = true;
            processingState.hidden = false;

            setStep("upload");

            try {
                const formData = new FormData();

                formData.append(
                    "file",
                    selectedFileObject
                );

                if (window.MEDFORM_DEBUG === true) console.log(
                    "[MedForm] calling /api/documents/extract"
                );

                if (typeof apiRequest !== "function") {
                    throw new Error(
                        "apiRequest is not available. " +
                        "Check ../../js/api.js"
                    );
                }

                const response = await apiRequest(
                    "/api/documents/extract",
                    {
                        method: "POST",
                        body: formData
                    }
                );

                if (window.MEDFORM_DEBUG === true) console.log(
                    "[MedForm] extraction response received:",
                    response
                );

                /*
                 * IMPORTANT:
                 * Keep the original Gemini ExtractionResponse
                 * in browser memory.
                 *
                 * Nothing is saved here.
                 */
                extractedData = response;

                processingState.hidden = true;

                extractButtonText.textContent =
                    "Extract information";
                extractSpinner.hidden = true;

                renderReviewScreen();

            } catch (error) {
                console.error(
                    "[MedForm] extraction failed:",
                    error
                );

                processingState.hidden = true;
                reviewState.hidden = true;
                uploadState.hidden = false;

                extractButton.disabled = false;
                extractButtonText.textContent =
                    "Extract information";
                extractSpinner.hidden = true;

                showError(
                    error?.message ||
                    "Unable to extract information."
                );
            }
        }
    );

    // ---------------------------------------------------------
    // HELPERS FOR CONSENT DISPLAY
    // ---------------------------------------------------------

    function escapeHtml(value) {
        const element =
            document.createElement("div");

        element.textContent =
            String(value ?? "");

        return element.innerHTML;
    }

    function labelFor(key) {
        return String(key)
            .replace(/_/g, " ")
            .replace(
                /\b\w/g,
                (char) => char.toUpperCase()
            );
    }

    function formatDocumentType(value) {
        return String(value)
            .replace(/_/g, " ")
            .replace(
                /\b\w/g,
                (char) => char.toUpperCase()
            );
    }

    function getDisplayValue(fieldData) {
        if (
            fieldData &&
            typeof fieldData === "object" &&
            Object.prototype.hasOwnProperty.call(
                fieldData,
                "value"
            )
        ) {
            return fieldData.value;
        }

        return fieldData;
    }

    // ---------------------------------------------------------
    // PREVIEW & REVIEW (new stage; original extraction response retained)
    // ---------------------------------------------------------

    function getConfidenceReasons() {
        return Array.isArray(extractedData?.confidence_reason)
            ? extractedData.confidence_reason
            : [];
    }

    function renderQuality() {
        const reasons = getConfidenceReasons();
        const confidence = Number(extractedData?.overall_confidence ?? 0);

        let quality = "high";
        if (reasons.length > 0) {
            quality = confidence >= 0.90 ? "medium" : "low";
        }

        qualityDot.className = `quality-dot ${quality}`;

        const qualitySummary = document.querySelector(".quality-summary");
        if (qualitySummary) {
            qualitySummary.classList.remove("high", "medium", "low");
            qualitySummary.classList.add(quality);
        }

        qualityLabel.textContent = `${quality.charAt(0).toUpperCase()}${quality.slice(1)} extraction quality`;
        qualityReasons.innerHTML = "";
        qualityReasons.hidden = reasons.length === 0;

        if (reasons.length) {
            const list = document.createElement("ul");
            reasons.forEach((item) => {
                const li = document.createElement("li");
                const field = item?.field ? `${labelFor(item.field)}: ` : "";
                li.textContent = `${field}${item?.reason || "This field may need review."}`;
                list.appendChild(li);
            });
            qualityReasons.appendChild(list);
        }
    }

    function drawBoundingBoxes() {
        boundingBoxOverlay.innerHTML = "";
        const reasons = getConfidenceReasons();
        reasons.forEach((item) => {
            const box = item?.bounding_box;
            if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return;

            // Gemini's example uses normalized coordinates (0 to 1).
            const values = [box.x, box.y, box.width, box.height];
            if (values.some((value) => value < 0 || value > 1)) return;

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", String(box.x * 1000));
            rect.setAttribute("y", String(box.y * 1000));
            rect.setAttribute("width", String(box.width * 1000));
            rect.setAttribute("height", String(box.height * 1000));
            rect.setAttribute("rx", "3");
            rect.setAttribute("aria-label", `${labelFor(item.field || "Field")} needs review`);
            boundingBoxOverlay.appendChild(rect);
        });
    }

    function renderDocumentPreview() {
        documentPreviewImage.hidden = true;
        documentPreviewPdf.hidden = true;
        documentImageWrap.hidden = true;
        previewFallback.hidden = true;
        boundingBoxOverlay.innerHTML = "";

        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
        if (!selectedFileObject) {
            previewFallback.hidden = false;
            return;
        }

        previewObjectUrl = URL.createObjectURL(selectedFileObject);
        const extension = selectedFileObject.name.split(".").pop().toLowerCase();
        if (extension === "pdf") {
            documentPreviewPdf.src = previewObjectUrl;
            documentPreviewPdf.hidden = false;
            return;
        }

        if (["jpg", "jpeg", "png"].includes(extension)) {
            documentImageWrap.hidden = false;
            documentPreviewImage.onload = () => {
                documentPreviewImage.hidden = false;
                drawBoundingBoxes();
            };
            documentPreviewImage.onerror = () => {
                documentImageWrap.hidden = true;
                previewFallback.hidden = false;
            };
            documentPreviewImage.src = previewObjectUrl;
            return;
        }

        previewFallback.hidden = false;
    }

    // function renderReviewFields() {
    //     reviewFields.innerHTML = "";
    //     const fields = extractedData?.extracted_fields || {};
    //     Object.entries(fields).forEach(([key, fieldData]) => {
    //         const wrapper = document.createElement("div");


    //         // wrapper.className = "review-field";
    //         const flaggedFields = getConfidenceReasons().map(
    //             item => String(item.field || "").trim().toLowerCase()
    //         );

    //         wrapper.className = flaggedFields.includes(key.toLowerCase())
    //             ? "review-field low-confidence"
    //             : "review-field";

    //         const label = document.createElement("label");
    //         label.htmlFor = `review-field-${key}`;
    //         label.textContent = labelFor(key);
    //         const input = document.createElement("input");
    //         input.type = "text";
    //         input.id = `review-field-${key}`;
    //         input.dataset.fieldKey = key;
    //         input.value = getDisplayValue(fieldData) ?? "";
    //         input.disabled = !isEditingReview;
    //         input.autocomplete = "off";
    //         input.setAttribute("aria-label", labelFor(key));
    //         wrapper.append(label, input);
    //         reviewFields.appendChild(wrapper);
    //     });
    //     addReviewFieldButton.hidden = !isEditingReview;
    //     reviewEditNote.hidden = !isEditingReview;
    //     editDetailsButton.textContent = isEditingReview ? "Finish editing" : "Edit details manually";
    // }
    
    function renderReviewFields() {
        reviewFields.innerHTML = "";
        const fields = extractedData?.extracted_fields || {};

        Object.entries(fields).forEach(([key, fieldData]) => {
            const wrapper = document.createElement("div");

            const flaggedFields = getConfidenceReasons().map(
                item => String(item.field || "").trim().toLowerCase()
            );

            wrapper.className = flaggedFields.includes(key.toLowerCase())
                ? "review-field low-confidence"
                : "review-field";

            // Header containing the field label and remove button.
            const header = document.createElement("div");
            header.className = "review-field-header";

            const label = document.createElement("label");
            label.htmlFor = `review-field-${key}`;
            label.textContent = labelFor(key);

            // Remove button: visible only while manually editing.
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "remove-review-field";
            removeButton.textContent = "\u00d7";
            removeButton.title = `Remove ${labelFor(key)}`;
            removeButton.setAttribute(
                "aria-label",
                `Remove ${labelFor(key)}`
            );

            removeButton.addEventListener("click", () => {
                const confirmed = window.confirm(
                    `Remove "${labelFor(key)}" from the extracted details?`
                );

                if (!confirmed) return;

                // Remove this field from the in-memory extraction data.
                delete extractedData.extracted_fields[key];

                // Remove confidence warnings associated with this field.
                if (Array.isArray(extractedData.confidence_reason)) {
                    extractedData.confidence_reason =
                        extractedData.confidence_reason.filter(
                            item =>
                                String(item.field || "").trim().toLowerCase() !==
                                key.toLowerCase()
                        );
                }

                renderReviewFields();
                renderQuality();
            });

            header.appendChild(label);

            if (isEditingReview) {
                header.appendChild(removeButton);
            }

            const input = document.createElement("input");
            input.type = "text";
            input.id = `review-field-${key}`;
            input.dataset.fieldKey = key;
            input.value = getDisplayValue(fieldData) ?? "";
            input.disabled = !isEditingReview;
            input.autocomplete = "off";
            input.setAttribute("aria-label", labelFor(key));

            wrapper.append(header, input);
            reviewFields.appendChild(wrapper);
        });

        addReviewFieldButton.hidden = !isEditingReview;
        reviewEditNote.hidden = !isEditingReview;

        editDetailsButton.textContent = isEditingReview
            ? "Finish editing"
            : "Edit details manually";
    }


    function renderReviewScreen() {
        uploadState.hidden = true;
        processingState.hidden = true;
        savedState.hidden = true;
        reviewState.hidden = false;
        isEditingReview = false;
        renderQuality();
        renderDocumentPreview();
        renderReviewFields();
        setStep("review");
    }

    function applyReviewEdits() {
        if (!extractedData || !extractedData.extracted_fields) {
            if (extractedData) extractedData.extracted_fields = {};
            else return;
        }
        reviewFields.querySelectorAll("input[data-field-key]").forEach((input) => {
            const key = input.dataset.fieldKey;
            const existing = extractedData.extracted_fields[key];
            if (existing && typeof existing === "object" && Object.prototype.hasOwnProperty.call(existing, "value")) {
                existing.value = input.value.trim();
            } else {
                extractedData.extracted_fields[key] = {
                    value: input.value.trim(),
                    confidence: 0
                };
            }
        });
    }

    function resetPendingExtraction() {
        extractedData = null;
        isEditingReview = false;
        reviewState.hidden = true;
        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
        documentPreviewImage.removeAttribute("src");
        documentPreviewPdf.removeAttribute("src");
        boundingBoxOverlay.innerHTML = "";
    }

    editDetailsButton.addEventListener("click", () => {
        if (isEditingReview) applyReviewEdits();
        isEditingReview = !isEditingReview;
        renderReviewFields();
    });

    addReviewFieldButton.addEventListener("click", () => {
        if (!isEditingReview) return;
        const name = window.prompt("Enter the field name (for example, middle_name):");
        if (!name) return;
        const key = name.trim().toLowerCase().replace(/\s+/g, "_");
        if (!key || Object.prototype.hasOwnProperty.call(extractedData.extracted_fields || {}, key)) {
            window.alert("Please enter a new, non-empty field name.");
            return;
        }
        if (!extractedData.extracted_fields) extractedData.extracted_fields = {};
        extractedData.extracted_fields[key] = { value: "", confidence: 0 };
        renderReviewFields();
        const newInput = reviewFields.querySelector(`[data-field-key="${key}"]`);
        if (newInput) newInput.focus();
    });

    proceedConsentButton.addEventListener("click", () => {
        applyReviewEdits();
        openConsentModal();
    });

    reuploadDocumentButton.addEventListener("click", () => {
        resetPendingExtraction();
        fileInput.value = "";
        selectedFileObject = null;
        selectedFile.hidden = true;
        extractButton.disabled = true;
        extractButtonText.textContent = "Extract information";
        extractSpinner.hidden = true;
        uploadState.hidden = false;
        processingState.hidden = true;
        savedState.hidden = true;
        clearError();
        setStep("upload");
    });

    goBackEditButton.addEventListener("click", () => {
        closeConsentModal();
        reviewState.hidden = false;
        isEditingReview = true;
        renderReviewFields();
        setStep("review");
    });

    // ---------------------------------------------------------
    // CONSENT MODAL
    // ---------------------------------------------------------

    function openConsentModal() {
        if (window.MEDFORM_DEBUG === true) console.log(
            "[MedForm] OPENING CONSENT MODAL"
        );

        consentFields.innerHTML = "";
        consentError.textContent = "";

        consentCheckbox.checked = false;
        acceptConsentButton.disabled = true;

        if (
            !extractedData ||
            typeof extractedData !== "object"
        ) {
            consentFields.innerHTML = `
                <div class="consent-empty">
                    No extracted information is available.
                </div>
            `;

            setStep("consent");

            consentModal.hidden = false;
            document.body.classList.add(
                "modal-open"
            );

            return;
        }

        /*
         * Real Gemini response:
         *
         * {
         *   status: "success",
         *   document_type: "aadhaar",
         *   overall_confidence: 0.92,
         *   extracted_fields: {
         *      full_name: {
         *          value: "...",
         *          confidence: 0.98
         *      }
         *   }
         * }
         */

        const documentType =
            extractedData.document_type;

        if (documentType) {
            const row =
                document.createElement("div");

            row.className = "consent-field";

            row.innerHTML = `
                <label>Document Type</label>
                <span>
                    ${escapeHtml(
                        formatDocumentType(
                            documentType
                        )
                    )}
                </span>
            `;

            consentFields.appendChild(row);
        }

        const fields =
            extractedData.extracted_fields || {};

        const entries =
            Object.entries(fields).filter(
                ([, fieldData]) => {
                    const value =
                        getDisplayValue(fieldData);

                    return (
                        value !== null &&
                        value !== undefined &&
                        value !== ""
                    );
                }
            );

        if (entries.length === 0) {
            const empty =
                document.createElement("div");

            empty.className = "consent-empty";
            empty.textContent =
                "No readable identity information was extracted.";

            consentFields.appendChild(empty);
        } else {
            entries.forEach(
                ([key, fieldData]) => {
                    const value =
                        getDisplayValue(fieldData);

                    const row =
                        document.createElement("div");

                    row.className =
                        "consent-field";

                    row.innerHTML = `
                        <label>
                            ${escapeHtml(
                                labelFor(key)
                            )}
                        </label>

                        <span>
                            ${escapeHtml(value)}
                        </span>
                    `;

                    consentFields.appendChild(row);
                }
            );
        }

        setStep("consent");

        /*
         * Show modal only after extraction succeeded.
         */
        consentModal.hidden = false;

        document.body.classList.add(
            "modal-open"
        );

        if (window.MEDFORM_DEBUG === true) console.log(
            "[MedForm] consentModal.hidden =",
            consentModal.hidden
        );
    }

    function closeConsentModal() {
        consentModal.hidden = true;

        document.body.classList.remove(
            "modal-open"
        );
    }

    consentCheckbox.addEventListener(
        "change",
        () => {
            acceptConsentButton.disabled =
                !consentCheckbox.checked;
        }
    );

    // ---------------------------------------------------------
    // DECLINE
    // ---------------------------------------------------------

    declineConsentButton.addEventListener(
        "click",
        () => {
            if (window.MEDFORM_DEBUG === true) console.log(
                "[MedForm] user declined consent"
            );

            /*
             * Discard extracted information from memory.
             * No request is made to the backend.
             */
            resetPendingExtraction();

            closeConsentModal();

            uploadState.hidden = false;
            processingState.hidden = true;
            reviewState.hidden = true;
            savedState.hidden = true;

            extractButton.disabled =
                !selectedFileObject;

            extractButtonText.textContent =
                "Extract information";

            extractSpinner.hidden = true;

            setStep("upload");
        }
    );

    // ---------------------------------------------------------
    // ACCEPT / SAVE
    // ---------------------------------------------------------

    acceptConsentButton.addEventListener(
        "click",
        async () => {
            if (!consentCheckbox.checked) {
                return;
            }

            if (!extractedData) {
                consentError.textContent =
                    "No extracted information is available. Please upload again.";
                return;
            }

            acceptConsentButton.disabled = true;
            declineConsentButton.disabled = true;

            acceptConsentButton.textContent =
                "Saving...";

            consentError.textContent = "";

            try {
                if (window.MEDFORM_DEBUG === true) console.log(
                    "[MedForm] sending POST /api/documents/consent"
                );

                /*
                 * Send the ORIGINAL Gemini extraction
                 * response. The backend converts it into
                 * the persistence format.
                 */
                const result = await apiRequest(
                    "/api/documents/consent",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            consent_given: true,
                            extraction: extractedData
                        })
                    }
                );

                if (window.MEDFORM_DEBUG === true) console.log(
                    "[MedForm] consent save response:",
                    result
                );

                resetPendingExtraction();

                closeConsentModal();

                uploadState.hidden = true;
                processingState.hidden = true;
                reviewState.hidden = true;
                savedState.hidden = false;

                setStep("saved");

            } catch (error) {
                console.error(
                    "[MedForm] consent save failed:",
                    error
                );

                consentError.textContent =
                    error?.message ||
                    "Unable to save the approved information.";

                acceptConsentButton.disabled = false;
                declineConsentButton.disabled = false;

                acceptConsentButton.textContent =
                    "Consent & update profile";
            }
        }
    );

    // ---------------------------------------------------------
    // CLICK OUTSIDE MODAL = DECLINE
    // ---------------------------------------------------------

    consentModal.addEventListener(
        "click",
        (event) => {
            if (
                event.target === consentModal
            ) {
                resetPendingExtraction();

                closeConsentModal();

                uploadState.hidden = false;
                processingState.hidden = true;
                reviewState.hidden = true;

                extractButton.disabled =
                    !selectedFileObject;

                extractButtonText.textContent =
                    "Extract information";

                extractSpinner.hidden = true;

                setStep("upload");
            }
        }
    );

    // ---------------------------------------------------------
    // UPLOAD ANOTHER
    // ---------------------------------------------------------

    uploadAnotherButton.addEventListener(
        "click",
        () => {
            fileInput.value = "";

            selectedFileObject = null;
            resetPendingExtraction();

            selectedFile.hidden = true;

            extractButton.disabled = true;

            extractButtonText.textContent =
                "Extract information";

            extractSpinner.hidden = true;

            savedState.hidden = true;
            processingState.hidden = true;
            reviewState.hidden = true;
            uploadState.hidden = false;

            setStep("upload");
            clearError();
        }
    );

    // ---------------------------------------------------------
    // INITIAL STATE
    // ---------------------------------------------------------

    uploadState.hidden = false;
    processingState.hidden = true;
    savedState.hidden = true;
    reviewState.hidden = true;
    consentModal.hidden = true;

    if (window.MEDFORM_DEBUG === true) console.log(
        "[MedForm] upload page initialized"
    );
});