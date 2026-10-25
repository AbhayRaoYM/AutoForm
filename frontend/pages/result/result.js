if (typeof requireAuthentication === "function") {
  requireAuthentication();
}
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

const previewButton = document.getElementById("previewButton");
const reviewButton = document.getElementById("reviewButton");
const downloadButton = document.getElementById("downloadButton");
const againButton = document.getElementById("againButton");
const toast = document.getElementById("toast");

const RESULT_DB_NAME = "medform_autofill";
const RESULT_STORE_NAME = "results";
const RESULT_KEY = "latest";

let resultUrl = null;
let resultRecord = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function openResultDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESULT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RESULT_STORE_NAME)) {
        db.createObjectStore(RESULT_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Unable to open result storage."));
  });
}

async function getResult() {
  const db = await openResultDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      RESULT_STORE_NAME,
      "readonly"
    );

    const store = transaction.objectStore(RESULT_STORE_NAME);
    const request = store.get(RESULT_KEY);

    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };

    request.onerror = () => {
      db.close();
      reject(
        request.error ||
          new Error("Unable to retrieve the completed form.")
      );
    };
  });
}

async function deleteResult() {
  const db = await openResultDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      RESULT_STORE_NAME,
      "readwrite"
    );

    transaction.objectStore(RESULT_STORE_NAME).delete(RESULT_KEY);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function isPdfRecord(record) {
  const mimeType = (record?.blob?.type || "").toLowerCase();
  const fileName = (record?.originalName || "").toLowerCase();
  return mimeType.includes("application/pdf") || fileName.endsWith(".pdf");
}

function buildDownloadName(originalName) {
  const safeOriginalName = originalName || "form";
  const baseName = safeOriginalName.replace(/\.[^/.]+$/, "");
  const extension = isPdfRecord(resultRecord) ? "pdf" : "png";
  return `Completed_${baseName}.${extension}`;
}


const reviewModal = document.getElementById("reviewModal");
const reviewGroups = document.getElementById("reviewGroups");
const manualReviewSection = document.getElementById("manualReviewSection");
const reviewCardHeading = document.getElementById("reviewCardHeading");
const reviewCardMessage = document.getElementById("reviewCardMessage");
const reviewStatusIcon = document.getElementById("reviewStatusIcon");
const reviewCount = document.getElementById("reviewCount");
const openReviewModalButton = document.getElementById("openReviewModalButton");
const closeReviewModalButton = document.getElementById("closeReviewModalButton");
const doneReviewButton = document.getElementById("doneReviewButton");

function openReviewModal() {
  if (!reviewModal) return;
  reviewModal.hidden = false;
  document.body.classList.add("review-modal-open");
  closeReviewModalButton?.focus();
}

function closeReviewModal() {
  if (!reviewModal) return;
  reviewModal.hidden = true;
  document.body.classList.remove("review-modal-open");
  openReviewModalButton?.focus();
}


function renderReviewItems(items) {
    if (!reviewGroups) return;

    reviewGroups.replaceChildren();

   const count = items.length;

    manualReviewSection.hidden = false;

    // Keep the old count badge hidden at all times.
    if (reviewCount) {
        reviewCount.textContent = String(count);
        reviewCount.hidden = true;
    }

    // Use only one visible badge.
    if (count === 0) {
    manualReviewSection.classList.remove("has-review-issues");

    reviewCardHeading.textContent = "Review before downloading";
    reviewCardMessage.textContent =
        "Please review your completed form and verify that all information is correct before downloading.";

    reviewStatusIcon.textContent = "!";

    return;
} else {
        manualReviewSection.classList.add("has-review-issues");
        reviewCardHeading.textContent = "Review required";
        reviewCardMessage.textContent =
            "Some fields may need your attention. Review them before downloading.";
        reviewStatusIcon.textContent = String(count);
    }

    manualReviewSection.classList.add("has-review-issues");

    reviewCardHeading.textContent = "Review required";
    reviewCardMessage.textContent =
        "Some fields may need your attention. Review them before downloading.";
    reviewStatusIcon.textContent = String(count);

    const groupDefinitions = {
        type_mismatch: {
            title: "Profile information exists, but the field type is incompatible",
            description: "These fields were left blank to avoid placing data in an unsuitable field."
        },
        ambiguous: {
            title: "Ambiguous field labels",
            description: "These labels could refer to different identity fields, so the system did not guess."
        },
        unmatched: {
            title: "Possible matches need verification",
            description: "The system found profile information that may correspond to these fields, but the match was not confident enough."
        }
    };

    const groups = new Map();

    items.forEach((item) => {
        const kind = groupDefinitions[item.kind] ? item.kind : "unmatched";

        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(item);
    });

    groups.forEach((groupItems, kind) => {
        const definition = groupDefinitions[kind];
        const section = document.createElement("section");
        section.className = `review-group review-group-${kind}`;

        const heading = document.createElement("h3");
        heading.textContent = `${definition.title} (${groupItems.length})`;
        section.appendChild(heading);

        const list = document.createElement("ul");

        groupItems.forEach((item) => {
            const listItem = document.createElement("li");
            listItem.appendChild(
                document.createTextNode(item.label || "Unlabelled field")
            );

            if (item.page) {
                const page = document.createElement("span");
                page.className = "review-field-page";
                page.textContent = ` — Page ${item.page}`;
                listItem.appendChild(page);
            }

            list.appendChild(listItem);
        });

        section.appendChild(list);

        const explanation = document.createElement("p");
        explanation.className = "review-empty";
        explanation.textContent = definition.description;
        explanation.style.padding = "0 13px 12px";
        explanation.style.margin = "0";
        section.appendChild(explanation);

        reviewGroups.appendChild(section);
    });
    openReviewModal();
}


function displayResult(record) {
  if (!record || !(record.blob instanceof Blob)) {
    return false;
  }

  // Revoke a previous object URL if the viewer is refreshed in the same page.
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
  }

  // resultRecord = record;
  // renderReviewItems(Array.isArray(record.reviewItems) ? record.reviewItems : []);
  resultRecord = record;

// console.log("Result record:", record);
// console.log("Review items:", record.reviewItems);

renderReviewItems(
    Array.isArray(record.reviewItems) ? record.reviewItems : []
);
  const isPdf = isPdfRecord(record);
  // Some producers store a PDF Blob without its MIME type. Normalize it for the browser.
  const displayBlob = isPdf && record.blob.type !== "application/pdf"
    ? new Blob([record.blob], { type: "application/pdf" })
    : record.blob;
  resultUrl = URL.createObjectURL(displayBlob);

  const viewer = document.getElementById("resultViewer");
  if (!viewer) {
    console.error("Completed form viewer container was not found.");
    return false;
  }

  // Always clear the previous viewer so an old image/iframe cannot remain visible.
  viewer.replaceChildren();

  if (isPdf) {
    const iframe = document.createElement("iframe");
    iframe.className = "generated-pdf";
    iframe.title = "Completed form PDF preview";
    iframe.src = resultUrl;
    iframe.setAttribute("loading", "eager");
    viewer.appendChild(iframe);
  } else if (record.blob.type.startsWith("image/")) {
    const previewImage = document.createElement("img");
    previewImage.className = "generated-form";
    previewImage.alt = `Completed ${record.originalName || "form"}`;
    previewImage.src = resultUrl;
    viewer.appendChild(previewImage);
  } else {
    const message = document.createElement("p");
    message.className = "preview-message";
    message.textContent = "Preview is not available for this file type. You can still download the completed document.";
    viewer.appendChild(message);
  }

  const resultFileName = document.getElementById("resultFileName");
  if (resultFileName) {
    resultFileName.textContent = buildDownloadName(record.originalName);
  }

  return true;
}

async function initializePage() {
  try {
    const record = await getResult();

    if (!displayResult(record)) {
      showToast(
        "No completed form was found. Please start autofill again."
      );

      setTimeout(() => {
        window.location.href = "../autofill/autofill.html";
      }, 1200);

      return;
    }
  } catch (error) {
    console.error("Unable to load autofill result:", error);

    showToast(
      "Unable to load the completed form. Please try again."
    );

    setTimeout(() => {
      window.location.href = "../autofill/autofill.html";
    }, 1200);
  }
}

previewButton.addEventListener("click", () => {
  if (!resultUrl) {
    showToast("The completed form is not available.");
    return;
  }

  window.open(resultUrl, "_blank", "noopener,noreferrer");
});

// reviewButton.addEventListener("click", () => {
//   if (resultRecord && Array.isArray(resultRecord.reviewItems) && resultRecord.reviewItems.length > 0) {
//     openReviewModal();
//   } else {
//     showToast("Please review the completed form carefully before submitting it.");
//   }
// });

reviewButton.addEventListener("click", () => {
    if (resultRecord?.reviewItems?.length > 0) {
        openReviewModal();
    } else {
        showToast(
            "No specific fields require review. Please verify the completed form in the preview."
        );
    }
});

// openReviewModalButton?.addEventListener("click", openReviewModal);
closeReviewModalButton?.addEventListener("click", closeReviewModal);
doneReviewButton?.addEventListener("click", closeReviewModal);

reviewModal?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.hasAttribute("data-close-review-modal")) {
    closeReviewModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && reviewModal && !reviewModal.hidden) {
    closeReviewModal();
  }
});

downloadButton.addEventListener("click", () => {
  if (!resultUrl || !resultRecord) {
    showToast("The completed form is not available.");
    return;
  }

  const link = document.createElement("a");

  link.href = resultUrl;
  link.download = buildDownloadName(
    resultRecord.originalName
  );

  document.body.appendChild(link);
  link.click();
  link.remove();
});

againButton.addEventListener("click", async () => {
  try {
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }

    await deleteResult();
  } catch (error) {
    console.error("Unable to clear previous result:", error);
  }

  window.location.href = "../autofill/autofill.html";
});

window.addEventListener("beforeunload", () => {
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
  }
});

initializePage();
