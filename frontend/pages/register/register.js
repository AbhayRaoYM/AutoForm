// frontend/pages/register/register.js

const passwordRegex =
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;

function getMissingPasswordRequirements(pwd) {
    const missing = [];
    if (pwd.length < 8) missing.push("8+ characters");
    if (!/[A-Z]/.test(pwd)) missing.push("1 uppercase letter");
    if (!/\d/.test(pwd)) missing.push("1 number");
    if (!/[!@#$%^&*]/.test(pwd)) missing.push("1 symbol (!@#$%^&*)");

    if (missing.length === 0) return null;
    return `Needs: ${missing.join(", ")}.`;
}

document.addEventListener("DOMContentLoaded", () => {
    redirectIfAuthenticated();

    const form = document.getElementById("registerForm");

    const phoneInput = document.getElementById("phone");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput =
        document.getElementById("confirmPassword");
    const consentInput = document.getElementById("consent");

    const phoneError = document.getElementById("phoneError");
    const passwordError =
        document.getElementById("passwordError");
    const confirmPasswordError =
        document.getElementById("confirmPasswordError");
    const consentError =
        document.getElementById("consentError");
    const formError =
        document.getElementById("formError");

    const registerButton =
        document.getElementById("registerButton");

    const registerButtonText =
        document.getElementById("registerButtonText");

    const registerSpinner =
        document.getElementById("registerSpinner");

    const showPasswordButton =
        document.getElementById("showPassword");

    function clearErrors() {
        phoneError.textContent = "";
        passwordError.textContent = "";
        confirmPasswordError.textContent = "";
        consentError.textContent = "";
        formError.textContent = "";

        [
            phoneInput,
            passwordInput,
            confirmPasswordInput
        ].forEach((input) => {
            input.classList.remove("invalid");
        });
    }

    function validate() {
        let valid = true;

        const phone = phoneInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword =
            confirmPasswordInput.value;

        if (!phone) {
            phoneError.textContent =
                "Phone number is required.";

            phoneInput.classList.add("invalid");
            valid = false;
        }

        if (!password) {
            passwordError.textContent =
                "Password is required.";

            passwordInput.classList.add("invalid");
            valid = false;
        } else {
            const missingMsg = getMissingPasswordRequirements(password);
            if (missingMsg) {
                passwordError.textContent = missingMsg;
                passwordInput.classList.add("invalid");
                valid = false;
            }
        }

        if (
            password &&
            confirmPassword &&
            password !== confirmPassword
        ) {
            confirmPasswordError.textContent =
                "Passwords do not match.";

            confirmPasswordInput.classList.add("invalid");
            valid = false;
        }

        if (!confirmPassword) {
            confirmPasswordError.textContent =
                "Please confirm your password.";

            confirmPasswordInput.classList.add("invalid");
            valid = false;
        }

        if (!consentInput.checked) {
            consentError.textContent =
                "Please accept the consent statement to continue.";

            valid = false;
        }

        return valid;
    }

    function setLoading(loading) {
        registerButton.disabled = loading;

        registerButtonText.textContent =
            loading ? "Creating account..." : "Create account";

        registerSpinner.hidden = !loading;
    }

    showPasswordButton.addEventListener("click", () => {
        const isPassword =
            passwordInput.type === "password";

        passwordInput.type =
            isPassword ? "text" : "password";

        showPasswordButton.textContent =
            isPassword ? "Hide" : "Show";
    });

    [
        phoneInput,
        passwordInput,
        confirmPasswordInput
    ].forEach((input) => {
        input.addEventListener("input", clearErrors);
    });

    consentInput.addEventListener("change", clearErrors);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        clearErrors();

        if (!validate()) {
            return;
        }

        setLoading(true);

        try {
            await apiRequest("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    phone: phoneInput.value.trim(),
                    password: passwordInput.value,
                    consent_given: consentInput.checked
                })
            });

            /*
             * Registration does not return an access token.
             * The backend currently returns the newly-created user_id
             * and a success message.
             *
             * Therefore, send the user to login after registration.
             */
            window.location.href =
                "../login/login.html?registered=true";

        } catch (error) {
            formError.textContent =
                error.message || "Unable to create account.";

        } finally {
            setLoading(false);
        }
    });
});
