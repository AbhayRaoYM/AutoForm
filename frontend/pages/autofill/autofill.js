const fileInput = document.getElementById("fileInput");
const chooseButton = document.getElementById("chooseButton");
const dropZone = document.getElementById("dropZone");
const selectedFile = document.getElementById("selectedFile");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const fileIcon = document.getElementById("fileIcon");
const removeButton = document.getElementById("removeButton");
const startButton = document.getElementById("startButton");

const uploadView = document.getElementById("uploadView");
const processingView = document.getElementById("processingView");

const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const processingStatus = document.getElementById("processingStatus");

const stepUpload = document.getElementById("stepUpload");
const stepProcess = document.getElementById("stepProcess");
const stepResult = document.getElementById("stepResult");

const processItems = [
  document.getElementById("process1"),
  document.getElementById("process2"),
  document.getElementById("process3"),
  document.getElementById("process4")
];

const toast = document.getElementById("toast");

let selectedForm = null;
let isProcessing = false;
let processingTimers = [];

// const API_BASE_URL = "http://localhost:8000";
const RESULT_DB_NAME = "medform_autofill";
const RESULT_STORE_NAME = "results";
const RESULT_KEY = "latest";

const allowedTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg"
];

const allowedExtensions = ["pdf", "png", "jpg", "jpeg"];
const maxFileSize = 10 * 1024 * 1024;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(filename) {
  return filename.includes(".")
    ? filename.split(".").pop().toLowerCase()
    : "";
}

function setFile(file) {
  if (!file || isProcessing) {
    return;
  }

  const extension = getExtension(file.name);

  if (
    !allowedTypes.includes(file.type) &&
    !allowedExtensions.includes(extension)
  ) {
    showToast("Please choose a PDF, JPG, JPEG or PNG file.");
    return;
  }

  if (file.size <= 0) {
    showToast("The selected file is empty.");
    return;
  }

  if (file.size > maxFileSize) {
    showToast("The selected file is larger than 10 MB.");
    return;
  }

  selectedForm = file;

  fileName.textContent = file.name;
  fileSize.textContent = formatSize(file.size);
  fileIcon.textContent = extension === "pdf" ? "PDF" : "IMG";

  selectedFile.hidden = false;
  startButton.disabled = false;
}

function removeFile() {
  if (isProcessing) {
    return;
  }

  selectedForm = null;
  selectedFile.hidden = true;
  startButton.disabled = true;
  fileInput.value = "";
}

chooseButton.addEventListener("click", () => {
  if (!isProcessing) {
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    setFile(fileInput.files[0]);
  }

  fileInput.value = "";
});

removeButton.addEventListener("click", removeFile);

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    if (isProcessing) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (event) => {
  if (isProcessing) {
    return;
  }

  const file = event.dataTransfer.files[0];

  if (file) {
    setFile(file);
  }
});

function updateSteps(stage) {
  stepUpload.classList.remove("active", "complete");
  stepProcess.classList.remove("active", "complete");
  stepResult.classList.remove("active", "complete");

  if (stage === "upload") {
    stepUpload.classList.add("active");
  } else if (stage === "process") {
    stepUpload.classList.add("complete");
    stepProcess.classList.add("active");
  } else if (stage === "result") {
    stepUpload.classList.add("complete");
    stepProcess.classList.add("complete");
    stepResult.classList.add("active");
  }
}

function clearProcessingTimers() {
  processingTimers.forEach((timer) => clearTimeout(timer));
  processingTimers = [];
}

function setProcessingStage(index, status, progress) {
  processItems.forEach((item, itemIndex) => {
    item.classList.toggle("done", itemIndex < index);
  });

  processingStatus.textContent = status;
  progressBar.style.width = `${progress}%`;
  progressPercent.textContent = `${progress}%`;
}

function showProcessing() {
  uploadView.hidden = true;
  processingView.hidden = false;

  isProcessing = true;
  startButton.disabled = true;

  updateSteps("process");

  processItems.forEach((item) => item.classList.remove("done"));

  setProcessingStage(0, "Reading document...", 12);

  processingTimers.push(
    setTimeout(() => {
      setProcessingStage(1, "Detecting form fields...", 35);
    }, 900)
  );

  processingTimers.push(
    setTimeout(() => {
      setProcessingStage(2, "Matching profile information...", 65);
    }, 1800)
  );

  processingTimers.push(
    setTimeout(() => {
      setProcessingStage(3, "Generating completed form...", 88);
    }, 2700)
  );
}

function resetProcessingUI() {
  clearProcessingTimers();

  processItems.forEach((item) => item.classList.remove("done"));

  processingStatus.textContent = "Reading document...";
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
}

function getAuthHeaders() {
  const token = localStorage.getItem("access_token");

  if (!token) {
    throw new Error("Your session has expired. Please log in again.");
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

async function parseErrorResponse(response) {
  const contentType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      const data = await response.json();

      if (typeof data.detail === "string") {
        return data.detail;
      }

      if (Array.isArray(data.detail)) {
        return data.detail
          .map((item) => item.msg || "Invalid request.")
          .join(", ");
      }

      if (typeof data.message === "string") {
        return data.message;
      }
    } catch (_) {
      // Fall through to generic message.
    }
  } else {
    try {
      const text = await response.text();

      if (text.trim()) {
        return text;
      }
    } catch (_) {
      // Fall through to generic message.
    }
  }

  if (response.status === 401) {
    return "Your session has expired. Please log in again.";
  }

  if (response.status === 404) {
    return "The autofill endpoint was not found. Check that FastAPI is running.";
  }

  if (response.status >= 500) {
    return "The server could not complete the autofill operation.";
  }

  return `Autofill failed (${response.status}).`;
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

async function saveResult(blob, originalName, reviewItems = []) {
  const db = await openResultDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      RESULT_STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(RESULT_STORE_NAME);

    store.put(
      {
        blob,
        originalName,
        reviewItems,
        createdAt: Date.now()
      },
      RESULT_KEY
    );

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ||
          new Error("Unable to store the completed form.")
      );
    };
  });
}

async function startProcessing() {
  if (!selectedForm || isProcessing) {
    if (!selectedForm) {
      showToast("Please select a form first.");
    }
    return;
  }

  showProcessing();

  try {
    const tokenHeaders = getAuthHeaders();

    const formData = new FormData();
    formData.append("form", selectedForm, selectedForm.name);

    if (window.MEDFORM_DEBUG === true) console.log("[MedForm] calling /api/forms/fill");

    const response = await fetch(`${API_BASE_URL}/api/forms/fill`, {
      method: "POST",
      headers: tokenHeaders,
      body: formData
    });

    if (window.MEDFORM_DEBUG === true) console.log("[MedForm] /api/forms/fill response:", response.status);

    if (!response.ok) {
      const message = await parseErrorResponse(response);
      throw new Error(message);
    }

    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();

    if (!contentType.includes("application/json")) {
      throw new Error(
        "The server returned an unexpected response. Please restart the updated backend."
      );
    }

    const data = await response.json();

    if (!data.file_base64 || !data.media_type) {
      throw new Error("The server did not return the completed form file.");
    }

    const binaryString = atob(data.file_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: data.media_type });

    if (blob.size === 0) {
      throw new Error("The server returned an empty completed form.");
    }

    await saveResult(blob, selectedForm.name, data.review_items || []);

    clearProcessingTimers();

    processItems.forEach((item) => item.classList.add("done"));
    processingStatus.textContent = "Completed";
    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";

    // updateSteps("result");

    // setTimeout(() => {
    //   window.location.href = "../result/result.html";
    // }, 350);
    window.location.href = "../result/result.html";
  } catch (error) {
    clearProcessingTimers();

    isProcessing = false;
    uploadView.hidden = false;
    processingView.hidden = true;
    startButton.disabled = !selectedForm;

    resetProcessingUI();

    console.error("[MedForm] Autofill request failed:", error);

    showToast(
      error instanceof Error
        ? error.message
        : "Unable to autofill the form."
    );
  }
}

startButton.addEventListener("click", startProcessing);

if (typeof requireAuthentication === "function") {
  requireAuthentication();
  // ---------------------------------------------------------
// AVATAR AND ACCOUNT MENU
// ---------------------------------------------------------

const avatarButton = document.getElementById("avatarButton");
const logoutButton = document.getElementById("logoutButton");

if (avatarButton) {
    async function loadAvatarInitial() {
    avatarButton.textContent = "U";

    try {
        const response = await apiRequest("/api/profile/", {
            method: "GET"
        });

        if (window.MEDFORM_DEBUG === true) console.log("[Avatar] Profile API response:", response);

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
        } else {
            console.warn("[Avatar] No name found in profile response.");
        }
    } catch (error) {
        console.error("[Avatar] Failed to load profile:", error);
    }
}

    loadAvatarInitial();
}

if (logoutButton) {
    logoutButton.addEventListener("click", () => {
        logout();
    });
}
}

uploadView.hidden = false;
processingView.hidden = true;
isProcessing = false;
startButton.disabled = true;

updateSteps("upload");
