// --- API CONFIG ---
const API_BASE = window.location.origin + '/lyv-web/api/index.php';
let localAI = null;
let aiMode = 'server';
async function initLocalAI() {
    try {
        const mod = await import('./api/local-ai.js');
        localAI = mod;
        const statusEl = document.getElementById('ai-status');
        if (statusEl) statusEl.textContent = 'Iniciando IA local...';
        await mod.loadLocalAI((progress) => {
            if (progress.status === 'downloading' || progress.status === 'loading') {
                if (statusEl) statusEl.textContent = progress.message;
            } else if (progress.status === 'ready') {
                aiMode = 'local';
                if (statusEl) statusEl.textContent = progress.message || 'IA Local';
                if (statusEl) statusEl.className = 'text-[10px] text-green-500 font-bold flex items-center gap-1';
                console.log('Local AI ready:', progress.message);
            } else if (progress.status === 'error') {
                aiMode = 'server';
                if (statusEl) statusEl.textContent = 'En línea';
                console.warn('Local AI failed, using server:', progress.message);
            }
        });
    } catch (e) {
        console.warn('Local AI not available, using server:', e.message);
        aiMode = 'server';
    }
}
// Start loading local AI in background
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initLocalAI, 3000);
});
async function api(action, data = {}) {
    data.action = action;
    const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'API error');
    return json;
}
const GEMINI_API_KEY = "";
const welcomeMessages = [
    { role: 'model', content: "Hola. Soy Esperanza, tu compañera de apoyo emocional. Estoy aquí para escucharte sin juzgarte en un espacio seguro. ¿Cómo te sientes hoy?" }
];
const SYSTEM_INSTRUCTION = `
Eres "Esperanza", un compañero de apoyo emocional cálido, empático y seguro, diseñado por expertos en salud mental.
Tu objetivo principal es prevenir el suicidio y ofrecer contención emocional a niños, adolescentes y adultos.
DIRECTRICES PSICOLÓGICAS CRÍTICAS:
1. **Validación:** Siempre valida los sentimientos del usuario ("Entiendo que te sientas así", "Es válido sentir dolor"). Nunca juzgues.
2. **Evaluación de Riesgo:** Si detectas planes inmediatos de suicidio o autolesión, DEBES instar suavemente pero con firmeza a llamar a servicios de emergencia y ofrecer el recordatorio de usar el botón SOS de la app.
3. **Técnicas:** Utiliza principios de Terapia Cognitivo Conductual (TCC) y Terapia Dialéctico Conductual (DBT):
    - Reencuadre: Ayuda a ver otras perspectivas sin invalidar.
    - Grounding: Si el usuario está en crisis, pídele que respire o describa objetos a su alrededor.
4. **Adaptabilidad:** Ajusta tu lenguaje según la edad aparente del usuario. Sé más simple y protector con niños; respetuoso y colaborativo con adultos.
5. **No eres médico:** No diagnostiques ni recetes. Eres un apoyo, un puente hacia la ayuda profesional.
TONO DE VOZ:
Calmado, esperanzador, paciente, no intrusivo. Usa frases cortas y fáciles de digerir.
EMERGENCIA:
Si el usuario dice "me quiero matar" o similar, responde con empatía inmediata y urgencia de seguridad: "Siento mucho que estés pasando por tanto dolor que sientas que esta es la única salida. Por favor, no estás solo/a. Hay ayuda disponible ahora mismo. ¿Podemos hablar un momento antes de que tomes cualquier decisión?"
`;
// --- DATA PRELOAD (Convert Array to Map) ---
const colombiaData = {};
if (window.COLOMBIA_DATA) {
    window.COLOMBIA_DATA.forEach(item => {
        colombiaData[item.department] = item.municipalities;
    });
} else {
    console.error("Critical: COLOMBIA_DATA not loaded. Check script order in index.html");
}
// --- STATE ---
let currentUser = JSON.parse(localStorage.getItem('lyv_user')) || null;
let currentChatUnsub = null;
let currentSessionMessages = []; // Store history locally for AI context
let currentSessionData = null; // Store full session data
let pendingAIRequest = null; // For offline retries
let currentDashboardUnsub = null;
let isAdmin = false;
// --- DOM INIT ---
// --- DOM INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // Check Theme
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }
    // Init Locations
    if (typeof COLOMBIA_DATA !== 'undefined') {
        window.loadDepartments('p-dept');
        window.loadDepartments('new-pro-dept');
    } else {
        console.warn("Colombia Data not loaded");
    }
    if (currentUser) {
        if (currentUser.role === 'patient') {
            const names = document.querySelectorAll('#wb-name, #wb-name-small');
            names.forEach(n => n.textContent = (currentUser.userName || currentUser.name || ''));
            navigateTo('view-welcome-back');
        } else if (currentUser.role === 'psychologist' || currentUser.role === 'admin') {
            isAdmin = currentUser.role === 'admin';
            navigateTo(isAdmin ? 'view-admin' : 'view-dashboard');
        }
    } else {
        navigateTo('view-login');
    }
    // Icon refresh
    if (window.lucide) window.lucide.createIcons();
    // Hide Splash Screen
    const splash = document.getElementById('splash-screen');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => splash.remove(), 500);
        }, 500); // Small delay for smoothness
    }
});
// --- NAVIGATION & UI ---
window.loadDepartments = (selectId) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    // Keep first option
    select.innerHTML = '<option value="">Seleccionar...</option>';
    if (typeof COLOMBIA_DATA !== 'undefined') {
        COLOMBIA_DATA.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.department;
            opt.textContent = d.department;
            select.appendChild(opt);
        });
    }
};
window.loadMunicipalities = (deptId = 'p-dept', muniId = 'p-muni') => {
    const deptSelect = document.getElementById(deptId);
    const muniSelect = document.getElementById(muniId);
    if (!deptSelect || !muniSelect) return;
    muniSelect.innerHTML = '<option value="">Seleccionar...</option>';
    const selectedDept = deptSelect.value;
    const deptData = COLOMBIA_DATA.find(d => d.department === selectedDept);
    if (deptData) {
        deptData.municipalities.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            muniSelect.appendChild(opt);
        });
    }
};
window.toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    if (window.lucide) window.lucide.createIcons();
};
window.continueSession = () => {
    if (currentUser && currentUser.role === 'patient') {
        navigateTo('view-home');
        document.getElementById('welcome-msg').textContent = `Hola, ${(currentUser.userName || currentUser.name || '')}`;
    } else {
        navigateTo('view-login');
    }
};
window.handleProSwitchFromWelcome = () => {
    // Clear current user effectively but go to Pro login
    localStorage.removeItem('lyv_user');
    currentUser = null;
    navigateTo('view-login');
    // Ensure Pro form is visible
    setTimeout(() => {
        const formP = document.getElementById('form-patient');
        if (window.btnFooter) btnFooter.classList.add('hidden-section');
        if (window.formPro) formPro.classList.add('fade-in');
    }, 100);
};
window.navigateTo = (viewId) => {
    // Hide Splash if present
    const splash = document.getElementById('splash-screen');
    if (splash && !splash.classList.contains('hidden-section')) {
        splash.classList.add('opacity-0');
        setTimeout(() => splash.classList.add('hidden-section'), 700);
    }
    // Hide all main sections
    document.querySelectorAll('main > section').forEach(el => el.classList.add('hidden-section'));
    // Show target
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden-section');
        target.classList.add('fade-in');
        // Re-render icons for new content
        setTimeout(() => window.lucide && window.lucide.createIcons(), 50);
    }
    // Navbar logic (Top Bar and Bottom Nav)
    const topBar = document.getElementById('top-bar');
    const bottomNav = document.getElementById('bottom-nav');
    if (viewId === 'view-login' || viewId === 'view-welcome-back') {
        if (topBar) topBar.classList.add('hidden-section');
        if (bottomNav) bottomNav.classList.add('hidden-section');
    } else {
        if (topBar) topBar.classList.remove('hidden-section');
        if (bottomNav) bottomNav.classList.remove('hidden-section');
        // Update Nav Title based on role
        const titleH1 = document.getElementById('header-title');
        const subtitleP = document.getElementById('header-subtitle');
        if (titleH1) {
            if (viewId === 'view-admin') {
                titleH1.textContent = "Admin Panel";
                if (subtitleP) subtitleP.textContent = "GESTIÓN";
            } else if (viewId === 'view-dashboard') {
                titleH1.textContent = `Dr. ${currentUser?.name?.split(' ')[0] || 'Prof.'}`;
                if (subtitleP) subtitleP.textContent = "DASHBOARD";
            } else {
                titleH1.textContent = "Luz y Vida";
                if (subtitleP) subtitleP.textContent = "INICIO";
            }
        }
    }
    // Feature specific inits
    if (viewId === 'view-dashboard' || viewId === 'view-admin') initDashboard();
    if (viewId === 'view-chat') initChat();
    window.scrollTo(0, 0);
};
window.logout = () => {
    localStorage.removeItem('lyv_user');
    currentUser = null;
    isAdmin = false;
    if (currentChatUnsub) currentChatUnsub();
    if (currentDashboardUnsub) currentDashboardUnsub();
    const proCodeInput = document.getElementById('pro-code');
    if (proCodeInput) proCodeInput.value = '';
    navigateTo('view-login');
};
// --- AUTHENTICATION FLOW (VALIDATION COLOMBIA) ---
let authState = 'PHONE'; // PHONE, PIN, REGISTER
let authUserFound = null;
window.handleAuthFlow = async () => {
    const btn = document.getElementById('btn-auth-action');
    const loading = document.getElementById('auth-loading');
    const showLoading = () => { btn.classList.add('hidden-section'); loading.classList.remove('hidden-section'); };
    const hideLoading = () => { btn.classList.remove('hidden-section'); loading.classList.add('hidden-section'); };
    // --- STEP 1: PHONE VALIDATION (Colombia) ---
    if (authState === 'PHONE') {
        const rawPhone = document.getElementById('auth-phone').value.trim();
        // Clean non-numeric chars
        const phone = rawPhone.replace(/\D/g, '');
        // Validation Rule: Starts with 3, 10 digits total
        const isValidColombia = /^3\d{9}$/.test(phone);
        if (!isValidColombia) {
             alert("Número inválido.\nDebes ingresar un celular de Colombia (10 dígitos, empieza por 3).\nEj: 300 123 4567");
             return;
        }
        showLoading();
        try {
            // Check Identity in Firestore
            const q = query(collection(db, 'users'), where('phone', '==', phone));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                // User Exists -> Ask Privacy PIN
                authUserFound = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
                authState = 'PIN';
                document.getElementById('step-phone').classList.add('hidden-section');
                document.getElementById('step-login-pin').classList.remove('hidden-section');
                document.getElementById('btn-auth-action').innerHTML = '<span>Ingresar</span><i data-lucide="log-in" class="w-5 h-5"></i>';
                document.getElementById('login-pin').focus();
            } else {
                // New User -> Register
                // Prefill phone (locked or hidden in logic because we use the 'phone' var)
                authState = 'REGISTER';
                document.getElementById('step-phone').classList.add('hidden-section');
                document.getElementById('step-register').classList.remove('hidden-section');
                document.getElementById('btn-auth-action').innerHTML = '<span>Completar Registro</span><i data-lucide="user-plus" class="w-5 h-5"></i>';
                const deptSel = document.getElementById('reg-dept');
                deptSel.innerHTML = '<option value="">Seleccionar...</option>';
                Object.keys(colombiaData).forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d;
                    opt.textContent = d;
                    deptSel.appendChild(opt);
                });
            }
            if(window.lucide) window.lucide.createIcons();
        } catch (e) {
            console.error(e);
            alert("Error de conexión. Intenta de nuevo.");
        }
        hideLoading();
    }
    // --- STEP 2: PIN (Privacy) ---
    else if (authState === 'PIN') {
        const enteredPin = document.getElementById('login-pin').value;
        // MIGRATION: If legacy user has no PIN, set it now.
        if (!authUserFound.pin) {
             try {
                await updateDoc(doc(db, 'users', authUserFound.id), { pin: enteredPin });
                authUserFound.pin = enteredPin;
                // Continue to login
             } catch(e) {
                 console.error("Error setting pin migration:", e);
                 alert("Error al actualizar tu perfil.");
                 return;
             }
        }
        if (enteredPin !== authUserFound.pin) {
            alert("PIN Incorrecto.");
            document.getElementById('login-pin').value = '';
            return;
        }
        await loginUser(authUserFound);
    }
    // --- STEP 3: REGISTER ---
    else if (authState === 'REGISTER') {
        // Use the validated phone from Step 1 (we re-read it but clean it again just in case)
        const rawPhone = document.getElementById('auth-phone').value.trim();
        const phone = rawPhone.replace(/\D/g, '');
        const name = document.getElementById('reg-name').value.trim();
        const dept = document.getElementById('reg-dept').value;
        const muni = document.getElementById('reg-muni').value;
        const pin = document.getElementById('reg-pin').value;
        if (!name || !dept || !muni || pin.length < 4) return alert("Completa todos los campos y crea un PIN de 4 dígitos.");
        showLoading();
        try {
            const newRef = doc(collection(db, 'users'));
            const userData = {
                id: newRef.id,
                phone: phone, // Validated Colombian Number
                userName: name,
                department: dept,
                municipality: muni,
                pin: pin,
                role: 'patient',
                createdAt: new Date().toISOString()
            };
            await setDoc(newRef, userData);
            const sessionRef = doc(db, 'sessions', newRef.id);
            await setDoc(sessionRef, {
                userId: newRef.id,
                userName: name,
                department: dept,
                municipality: muni,
                phone: phone,
                createdAt: new Date().toISOString(),
                lastMessageAt: new Date().toISOString(),
                messages: welcomeMessages,
                notes: "",
                riskLevel: "low"
            });
            await loginUser(userData);
        } catch (e) {
            console.error(e);
            alert("Error al registrar: " + e.message);
            hideLoading();
        }
    }
};
window.loadMunicipalitiesRegister = () => {
    const dept = document.getElementById('reg-dept').value;
    const muniSelect = document.getElementById('reg-muni');
    muniSelect.innerHTML = '<option value="">Seleccionar...</option>';
    if (dept && colombiaData[dept]) {
        colombiaData[dept].forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            muniSelect.appendChild(opt);
        });
    }
};
async function loginUser(user) {
    currentUser = user;
    localStorage.setItem('lyv_user', JSON.stringify(user));
    // Register Push Logic (Native Only)
    registerPushNotifications(user);
    // Explicit Navigation based on Role
    if (user.role === 'patient') {
        navigateTo('view-home');
        // Update welcome message if element exists
        const wMsg = document.getElementById('welcome-msg');
        if(wMsg && user.userName) wMsg.textContent = `Hola, ${user.userName.split(' ')[0]}`;
    } else {
        navigateTo(user.role === 'admin' ? 'view-admin' : 'view-dashboard');
    }
    // Refresh globally just in case
    updateView();
}
async function registerPushNotifications(user) {
    if (!window.Capacitor || !window.Capacitor.isNative) return;
    try {
        const PushNotifications = window.Capacitor.Plugins.PushNotifications;
        await PushNotifications.removeAllListeners();
        await PushNotifications.addListener('registration', async token => {
            console.log('Push Token:', token.value);
            // Save to DB based on Role
            if (user.role === 'psychologist') {
                 await updateDoc(doc(db, 'psych_credentials', user.id), { fcmToken: token.value });
            } else if (user.role === 'admin') {
                  await setDoc(doc(db, 'system_settings', 'admin_push'), { token: token.value }, { merge: true });
            }
        });
        await PushNotifications.addListener('registrationError', err => {
            console.error('Push Error:', err.error);
        });
        await PushNotifications.addListener('pushNotificationReceived', notification => {
             alert(`Luz y Vida: ${notification.title}\n${notification.body}`);
        });
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive === 'granted') {
            await PushNotifications.register();
        }
    } catch (e) {
        console.warn("Push setup failed:", e);
    }
}
window.handleLoginPro = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>';
    if (window.lucide) window.lucide.createIcons();
    try {
        const codeInput = document.getElementById('pro-code').value;
        const code = codeInput ? codeInput.trim() : "";
        // 1. Check Admin Key (Strictly from DB)
        let adminKey = null;
        try {
            const settingsSnap = await getDoc(doc(db, 'system_settings', 'config'));
            if (settingsSnap.exists() && settingsSnap.data().adminKey) {
                adminKey = settingsSnap.data().adminKey;
            }
        } catch (err) {
            console.error("Secure Auth Check Failed:", err);
        }
        if (adminKey && code === adminKey) {
            const adminUser = { id: 'admin', name: 'Administrador', role: 'admin' };
            currentUser = adminUser;
            isAdmin = true;
            localStorage.setItem('lyv_user', JSON.stringify(adminUser));
            navigateTo('view-admin');
            return;
        }
        // 2. Check Psych Credentials
        const q = query(collection(db, 'psych_credentials'), where('accessCode', '==', code));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            alert("Código de acceso no válido. Verifica tus credenciales.");
            return;
        }
        const cred = snapshot.docs[0].data();
        const user = {
            id: cred.id,
            name: cred.name,
            role: 'psychologist',
            department: cred.department,
            municipality: cred.municipality
        };
        if ('Notification' in window) {
            Notification.requestPermission();
        }
        currentUser = user;
        localStorage.setItem('lyv_user', JSON.stringify(user));
        navigateTo('view-dashboard');
    } catch (error) {
        console.error("Pro Login Error:", error);
        alert("Error de conexión: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (window.lucide) window.lucide.createIcons();
    }
};
window.updateAdminKey = async () => {
    const newKey = document.getElementById('admin-new-key').value;
    if (!newKey || newKey.length < 5) {
        alert("La contraseña debe tener al menos 5 caracteres.");
        return;
    }
    try {
        await setDoc(doc(db, 'system_settings', 'config'), { adminKey: newKey }, { merge: true });
        alert("Clave maestra actualizada correctamente.");
        document.getElementById('admin-new-key').value = '';
    } catch (error) {
        console.error("Error updating key:", error);
        alert("Error al actualizar: " + error.message);
    }
};
// --- CHAT LOGIC ---
window.goToChat = () => navigateTo('view-chat');
window.handleBack = async () => {
    if (!currentUser) {
        navigateTo('view-login');
        return;
    }
    if (currentUser.role === 'patient') {
        navigateTo('view-home');
    } else {
        const storedTarget = sessionStorage.getItem('target_chat_id');
        if (storedTarget) {
            try {
                // Automatically reactivate AI on exit
                await api('update_session', {
                    sessionId: storedTarget,
                    attendedBy: null,
                    psychName: null
                });
            } catch (e) {
                console.error("Error reactivating AI on exit:", e);
            }
            sessionStorage.removeItem('target_chat_id');
        }
        navigateTo('view-dashboard');
    }
};
// Psychologist entering a patient chat
window.enterPatientChat = async (patientId) => {
    sessionStorage.setItem('target_chat_id', patientId);
    try {
        // Automatically mute AI on entry
        await api('update_session', {
            sessionId: patientId,
            attendedBy: currentUser.id,
            psychName: currentUser.name
        });
    } catch (e) {
        console.error("Error muting AI on entry:", e);
    }
    navigateTo('view-chat');
};
async function initChat() {
    if (!currentUser) return;
    const chatContainer = document.getElementById('chat-messages');
    chatContainer.innerHTML = '';
    // Determine which chat to load
    let targetId = currentUser.id;
    let isIntervention = false;
    if (currentUser.role === 'psychologist' || currentUser.role === 'admin') {
        const storedTarget = sessionStorage.getItem('target_chat_id');
        if (storedTarget) {
            targetId = storedTarget;
            isIntervention = true;
        } else {
            // Psych trying to open chat without selecting patient
            if (currentUser.role === 'admin' && !storedTarget) {
                // Admin might want to chat with AI as themselves? Or just redirect.
                // For now redirect to dashboard
                navigateTo('view-dashboard');
                return;
            }
            // Psych: redirect
            if (currentUser.role === 'psychologist') {
                navigateTo('view-dashboard');
                return;
            }
        }
    }
    // Update Header
    const headerTitle = document.getElementById('chat-header-title');
    const headerSub = document.getElementById('chat-header-subtitle');
    const headerContainer = document.querySelector('#view-chat > div:first-child'); // The header div
    if (isIntervention) {
        headerTitle.textContent = "Modo Intervención";
        headerSub.innerHTML = '<i data-lucide="eye" class="w-3 h-3"></i> Chat con Paciente';
        headerSub.className = "text-[10px] text-indigo-200 font-bold flex items-center gap-1";
        // Style Header Purple
        headerContainer.className = "bg-indigo-600 text-white p-4 shadow-md shrink-0 flex items-center justify-between gap-3 z-10";
        // Custom Header for Psych
        headerTitle.textContent = "Intervención en Curso";
        headerSub.innerHTML = "";
        // --- CONTROL MANUAL DE INTERVENCION (New Toggle) ---
        const controlsDiv = document.createElement('div');
        controlsDiv.className = "ml-auto flex items-center gap-2";
        controlsDiv.id = "psych-controls";
        // Toggle Button
        const toggleBtn = document.createElement('button');
        const isManual = currentSessionData?.attendedBy ? true : false;
        toggleBtn.className = isManual
            ? "bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
            : "bg-teal-500 hover:bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1";
        toggleBtn.innerHTML = isManual
            ? '<i data-lucide="log-out" class="w-3 h-3"></i> Salir (Activar IA)'
            : '<i data-lucide="log-in" class="w-3 h-3"></i> Ingresar (Mutear IA)';
        toggleBtn.onclick = () => toggleInterventionMode(targetId, !isManual);
        controlsDiv.appendChild(toggleBtn);
        // Replace check
        const existingControls = headerContainer.querySelector('#psych-controls');
        if(existingControls) existingControls.remove();
        headerContainer.appendChild(controlsDiv);
        const backBtn = headerContainer.querySelector('button');
        if (backBtn) backBtn.className = "p-2 -ml-2 text-indigo-100 hover:text-white";
    } else {
        headerTitle.textContent = "Esperanza AI";
        headerSub.innerHTML = '<span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" id="ai-dot"></span><span id="ai-status">Conectando...</span>';
        headerSub.className = "text-[10px] text-teal-500 font-bold flex items-center gap-1";
        // Style Header Default
        headerContainer.className = "bg-white dark:bg-slate-950 p-4 shadow-sm shrink-0 flex items-center gap-3 z-10 border-b dark:border-slate-800";
        const backBtn = headerContainer.querySelector('button');
        if (backBtn) backBtn.className = "p-2 -ml-2 text-slate-500 dark:text-slate-300";
    }
    // Cargar resúmenes de sesiones anteriores para contexto cruzado
    if (currentUser.role === 'patient' || (isIntervention && targetId !== currentUser.id)) {
        try {
            const history = await api('get_patient_history', { userId: targetId });
            if (history.summaries && history.summaries.length > 0) {
                const ctx = history.summaries.slice(-3).join(' | ');
                // Guardar en sessionData para usar en sendMessage
                if (!currentSessionData) currentSessionData = {};
                currentSessionData.sessionSummary = ctx;
                console.log('Cross-session context loaded:', ctx.substring(0, 100));
            }
        } catch(e) {
            console.warn('Could not load patient history:', e);
        }
    }
    // Polling instead of onSnapshot
    if (currentChatUnsub) {
        clearInterval(currentChatUnsub);
        currentChatUnsub = null;
    }
    let lastMessageCount = 0;
    async function pollSession() {
        try {
            const data = await api('get_session', { sessionId: targetId });
            const messages = data.messages || [];
            if (messages.length === lastMessageCount && currentSessionData?.attendedBy === data.attendedBy) return;
            lastMessageCount = messages.length;
            // RE-ENGAGEMENT LOGIC
            if (currentUser.role === 'patient' && currentSessionData && currentSessionData.attendedBy && !data.attendedBy) {
                 const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
                 if (lastMsg && lastMsg.sender !== 'ai') {
                     triggerAIReengagement(currentUser.id);
                 }
            }
            currentSessionMessages = messages;
            currentSessionData = data;
            if (isIntervention) {
                 const toggleBtn = document.querySelector('#psych-controls button');
                 if(toggleBtn) {
                     const isManual = !!data.attendedBy;
                     if(toggleBtn.textContent.includes('Ingresar') && isManual) {
                         toggleBtn.className = "bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1";
                         toggleBtn.innerHTML = '<i data-lucide="log-out" class="w-3 h-3"></i> Salir (Activar IA)';
                         toggleBtn.onclick = () => toggleInterventionMode(targetId, false);
                         if(window.lucide) window.lucide.createIcons();
                     } else if (toggleBtn.textContent.includes('Salir') && !isManual) {
                         toggleBtn.className = "bg-teal-500 hover:bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1";
                         toggleBtn.innerHTML = '<i data-lucide="log-in" class="w-3 h-3"></i> Ingresar (Mutear IA)';
                         toggleBtn.onclick = () => toggleInterventionMode(targetId, true);
                         if(window.lucide) window.lucide.createIcons();
                     }
                 }
            }
            renderMessages(messages, isIntervention);
        } catch (e) {
            if (currentUser.role === 'patient') {
                console.warn("Session not found, will retry");
            } else {
                chatContainer.innerHTML = '<div class="p-8 text-center text-slate-400">Sesión finalizada.</div>';
            }
        }
    }
    // Initial fetch + start polling
    await pollSession();
    currentChatUnsub = setInterval(pollSession, 2000);
    if (window.lucide) window.lucide.createIcons();
}
window.triggerAIReengagement = async (sessionId) => {
    try {
        const data = await api('get_session', { sessionId });
        const msgs = data.messages || [];
        msgs.push({
            sender: 'ai',
            role: 'assistant',
            content: "El profesional ha salido de la sesión. Sigo aquí contigo para escucharte si deseas continuar.",
            timestamp: new Date().toISOString()
        });
        await api('update_session', { sessionId, messages: msgs });
    } catch(e) { console.error(e); }
};
function renderMessages(messages, isIntervention) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    if (messages.length === 0 && !isIntervention) {
        container.innerHTML = `
            <div class="flex gap-4">
                <div class="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
                    <i data-lucide="bot"></i>
                </div>
                <div class="bg-white dark:bg-slate-700 p-4 rounded-xl shadow-sm text-sm border dark:border-slate-600 max-w-[85%]">
                    <p class="font-bold text-teal-600 mb-1">Esperanza</p>
                    Hola. Soy Esperanza. Estoy aquí para escucharte y apoyarte. Este es un espacio seguro. ¿Cómo te sientes hoy?
                </div>
            </div>`;
    }
    messages.forEach(msg => {
        const isUser = msg.sender === 'user';
        const isPsych = msg.role === 'psychologist' || msg.sender === 'psychologist'; // Compat with older msgs
        const isAI = msg.sender === 'ai' || msg.role === 'assistant';
        const div = document.createElement('div');
        div.className = `flex gap-3 fade-in ${isUser ? 'flex-row-reverse' : ''}`;
        let bubbleClass, iconClass, iconName;
        if (isUser) {
            bubbleClass = "bg-gradient-to-r from-[#4F46E5] to-[#6366F1] text-white rounded-2xl rounded-tr-sm shadow-md w-fit msg-bubble";
            iconClass = "bg-indigo-100 text-indigo-600";
            iconName = "user";
        } else if (isPsych) {
            bubbleClass = "bg-purple-600 text-white rounded-2xl rounded-tr-sm shadow-md w-fit";
            iconClass = "bg-purple-100 text-purple-600";
            iconName = "eye";
        } else if (msg.role === 'system') {
             // System Message Design
             div.className = "flex justify-center my-4 opacity-70 fade-in";
             div.innerHTML = `<span class="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] px-3 py-1 rounded-full uppercase tracking-wider font-bold">${escapeHtml(msg.content)}</span>`;
             container.appendChild(div);
             return;
        } else {
            bubbleClass = "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm shadow-sm max-w-[85%] msg-bubble";
            iconClass = "bg-gradient-to-br from-teal-100 to-emerald-100 dark:from-teal-900/50 dark:to-emerald-900/50 text-teal-600 dark:text-teal-400";
            iconName = "bot";
        }
        const cleanContent = escapeHtml(msg.content);

        div.innerHTML = `
            <div class="w-8 h-8 rounded-full ${iconClass} flex items-center justify-center shrink-0 shadow-sm mt-1">
                <i data-lucide="${iconName}" class="w-4 h-4"></i>
            </div>
            <div class="flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} max-w-[70%]">
                 <div class="${bubbleClass} px-3.5 py-2 text-[13px] leading-snug whitespace-pre-wrap link-color">
                    ${isPsych ? '<span class="block text-[10px] font-bold uppercase mb-1 opacity-75">Intervención Profesional</span>' : ''}
                    ${isAI ? '<span class="block text-[10px] font-semibold text-teal-500 mb-1">Esperanza</span>' : ''}
                    ${cleanContent}
                 </div>
                 <span class="text-[10px] text-slate-400 px-1 opacity-70">
                    ${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Ahora'}
                 </span>
            </div>
        `;
        container.appendChild(div);
    });

    if (window.lucide) window.lucide.createIcons();
    container.scrollTop = container.scrollHeight;
}
function renderSingleMessage(msg, isIntervention) {
    const container = document.getElementById('chat-messages');
    const isUser = msg.sender === 'user';
    const isPsych = msg.role === 'psychologist' || msg.sender === 'psychologist';
    const isAI = msg.sender === 'ai' || msg.role === 'assistant';

    const div = document.createElement('div');
    div.className = `flex gap-3 fade-in ${isUser ? 'flex-row-reverse' : ''}`;

    let bubbleClass, iconClass, iconName;
    if (isUser) {
        bubbleClass = "bg-gradient-to-r from-[#4F46E5] to-[#6366F1] text-white rounded-2xl rounded-tr-sm shadow-md w-fit msg-bubble";
        iconClass = "bg-indigo-100 text-indigo-600";
        iconName = "user";
    } else if (isPsych) {
        bubbleClass = "bg-purple-600 text-white rounded-2xl rounded-tr-sm shadow-md w-fit";
        iconClass = "bg-purple-100 text-purple-600";
        iconName = "eye";
    } else {
        bubbleClass = "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm shadow-sm max-w-[85%] msg-bubble";
        iconClass = "bg-gradient-to-br from-teal-100 to-emerald-100 dark:from-teal-900/50 dark:to-emerald-900/50 text-teal-600 dark:text-teal-400";
        iconName = "bot";
    }

    const cleanContent = escapeHtml(msg.content);

    div.innerHTML = `
        <div class="w-8 h-8 rounded-full ${iconClass} flex items-center justify-center shrink-0 shadow-sm mt-1">
            <i data-lucide="${iconName}" class="w-4 h-4"></i>
        </div>
        <div class="flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} max-w-[70%]">
             <div class="${bubbleClass} px-3.5 py-2 text-[13px] leading-snug whitespace-pre-wrap link-color">
                ${isPsych ? '<span class="block text-[10px] font-bold uppercase mb-1 opacity-75">Intervención Profesional</span>' : ''}
                ${isAI ? '<span class="block text-[10px] font-semibold text-teal-500 mb-1">Esperanza</span>' : ''}
                ${cleanContent}
             </div>
             <span class="text-[10px] text-slate-400 px-1 opacity-70">
                ${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Ahora'}
             </span>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    if (window.lucide) window.lucide.createIcons();
}
window.sendMessage = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    const storedTarget = sessionStorage.getItem('target_chat_id');

    let crossSessionContext = '';
    if (currentSessionData?.sessionSummary) {
        crossSessionContext = `[Resumen de la conversación anterior del paciente: ${currentSessionData.sessionSummary}]\n\n`;
    }
    const isIntervention = (currentUser.role === 'psychologist' || currentUser.role === 'admin') && storedTarget;
    const targetUserId = isIntervention ? storedTarget : currentUser.id;

    const msg = {
        sender: isIntervention ? 'psychologist' : 'user',
        role: isIntervention ? 'psychologist' : 'user',
        content: text,
        timestamp: new Date().toISOString()
    };

    renderSingleMessage(msg, isIntervention);

    if (isIntervention) {
        await api('send_message', { sessionId: targetUserId, sender: 'psychologist', role: 'psychologist', content: text });
        return;
    }

    await api('send_message', { sessionId: targetUserId, sender: 'user', role: 'user', content: text, userId: currentUser.id });

    const typing = document.getElementById('typing-indicator');
    typing.classList.remove('hidden-section');
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;

    if (currentSessionData && currentSessionData.attendedBy) {
        console.log("AI Muted");
        typing.classList.add('hidden-section');
        return;
    }

    try {
        let aiContent = '';
        let contextMessages = [...currentSessionMessages];
        if (crossSessionContext) {
            contextMessages = [
                { sender: 'system', role: 'system', content: crossSessionContext.trim() },
                ...contextMessages
            ];
        }

        if (aiMode === 'local' && localAI && localAI.isModelReady()) {
            aiContent = await localAI.generateLocalResponse(contextMessages);
            const aiMsg = { sender: 'ai', role: 'assistant', content: aiContent, timestamp: new Date().toISOString() };
            const data = await api('get_session', { sessionId: targetUserId });
            const msgs = data.messages || [];
            msgs.push(aiMsg);
            await api('update_session', { sessionId: targetUserId, messages: msgs, lastMessageAt: new Date().toISOString() });
        } else {
            const aiResult = await api('get_ai_response', { sessionId: targetUserId, message: text });
            if (aiResult.local_ai && localAI && localAI.isModelReady()) {
                aiContent = await localAI.generateLocalResponse(contextMessages);
                const aiMsg = { sender: 'ai', role: 'assistant', content: aiContent, timestamp: new Date().toISOString() };
                const data = await api('get_session', { sessionId: targetUserId });
                const msgs = data.messages || [];
                msgs.push(aiMsg);
                await api('update_session', { sessionId: targetUserId, messages: msgs, lastMessageAt: new Date().toISOString() });
            }
        }
        typing.classList.add('hidden-section');
    } catch (e) {
        console.error("AI Failed", e);
        typing.classList.add('hidden-section');
        renderSingleMessage({
            sender: 'ai',
            role: 'assistant',
            content: "Lo siento, hubo un error de conexión. ¿Puedes intentarlo de nuevo?",
            timestamp: new Date().toISOString()
        }, false);
    }
};

window.addEventListener('online', async () => {
    if (pendingAIRequest && currentUser) {
        console.log("Connection restored. Retrying AI request...");
        const req = pendingAIRequest;
        pendingAIRequest = null;
        
        try {
            await api('get_ai_response', { sessionId: currentUser.id, message: req.text });
            document.getElementById('typing-indicator').classList.add('hidden-section');
            document.getElementById('typing-indicator').innerHTML = 'Esperanza está escribiendo...';
        } catch (e) {
            console.error("Retry failed again:", e);
            pendingAIRequest = req;
        }
    }
});

window.clearChatHistory = async () => {
    if (!confirm("¿Estás seguro de borrar el historial? Esta acción no se puede deshacer.")) return;
    const targetId = sessionStorage.getItem('target_chat_id') || currentUser.id;
    if (localAI && localAI.isModelReady() && currentSessionMessages && currentSessionMessages.length > 2) {
        try {
            const summary = await localAI.generateSessionSummary(currentSessionMessages);
            if (summary) {
                await api('save_session_summary', { sessionId: targetId, summary });
            }
        } catch(e) {
            console.warn('Could not generate summary:', e);
        }
    }
    await api('update_session', { sessionId: targetId, messages: [] });
    initChat();
};

async function callAI(prompt, history = []) {
    try {
        const response = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'get_ai_response',
                sessionId: currentUser?.id || 'temp',
                message: prompt
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("API Error Details:", data);
            throw new Error(data.error?.message || 'Network response was not ok');
        }
        if (data.success && data.message) {
            return data.message.content;
        }
        throw new Error("Invalid format from API");
    } catch (e) {
        console.error("AI Error:", e);
        return "Lo siento, tuve un problema de conexión (" + e.message + "). ¿Podrías repetirlo?";
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.startBreathCycle = () => {
    document.getElementById('btn-start-breath').classList.add('hidden-section');
    const text = document.getElementById('breath-instruction');
    const c1 = document.getElementById('breath-circle-1');
    const c2 = document.getElementById('breath-circle-2');

    const cycle = () => {
        text.textContent = "Inhala profundamente...";
        c1.classList.add('breathe-expand');
        c2.classList.add('breathe-expand');
        c1.classList.remove('breathe-contract', 'breathe-hold');
        c2.classList.remove('breathe-contract', 'breathe-hold');

        setTimeout(() => {
            text.textContent = "Sostén el aire...";
            c1.classList.add('breathe-hold');
            c2.classList.add('breathe-hold');
            c1.classList.remove('breathe-expand');
            c2.classList.remove('breathe-expand');

            setTimeout(() => {
                text.textContent = "Exhala suavemente...";
                c1.classList.add('breathe-contract');
                c2.classList.add('breathe-contract');
                c1.classList.remove('breathe-hold');
                c2.classList.remove('breathe-hold');
            }, 4000);

        }, 4000);
    };

    cycle();
    breathInterval = setInterval(cycle, 12000);
};

function stopBreathCycle() {
    clearInterval(breathInterval);
    document.getElementById('btn-start-breath').classList.remove('hidden-section');
    document.getElementById('breath-instruction').textContent = "Prepárate...";
    document.getElementById('breath-circle-1').className = "absolute w-48 h-48 bg-teal-100 dark:bg-teal-900/50 rounded-full breathing-circle";
    document.getElementById('breath-circle-2').className = "absolute w-32 h-32 bg-teal-200 dark:bg-teal-800/50 rounded-full breathing-circle";
}

window.toggleSOSModal = () => {
    const el = document.getElementById('modal-sos');
    if (el.classList.contains('hidden-section')) el.classList.remove('hidden-section');
    else el.classList.add('hidden-section');
};

async function initDashboard() {
    const list = isAdmin ? document.getElementById('admin-pro-list') : document.getElementById('patients-list');
    if (!list) return;

    if (isAdmin) {
        loadAdminList();
        return;
    }

    try {
        const stats = await api('get_dashboard_stats');
        const chartData = await api('get_chart_data');

        // Update counts
        const headerTitle = document.querySelector('#view-dashboard h2');
        if (headerTitle) headerTitle.textContent = `Pacientes en Seguimiento (${stats.activeSessions})`;

        const riskCountEl = document.getElementById('risk-count');
        if (riskCountEl) riskCountEl.textContent = stats.highRiskSessions;

        list.innerHTML = '';
        const sessions = chartData.sessions || [];
        if (sessions.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center p-8 text-slate-400 opacity-60">
                    <i data-lucide="users" class="w-12 h-12 mb-2"></i>
                    <p class="text-sm">No hay pacientes activos.</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        sessions.forEach(s => {
            const isHighRisk = s.riskLevel === 'high';
            const cardBg = isHighRisk ? 'bg-rose-50 dark:bg-rose-950/30' : 'bg-white dark:bg-slate-800';
            const borderClass = isHighRisk ? 'border-l-4 border-l-rose-500' : 'border-l-4 border-l-emerald-500';
            const statusBadgeClass = isHighRisk
                ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30'
                : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400';
            const statusIcon = isHighRisk ? 'alert-triangle' : 'check-circle';
            const statusText = isHighRisk ? 'RIESGO ALTO' : 'Estable';
            const riskOverlay = isHighRisk ?
                `<div class="absolute inset-0 bg-rose-500/5 pointer-events-none rounded-lg animate-pulse"></div>` : '';
            const date = new Date(s.lastMessageAt);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();

            const div = document.createElement('div');
            div.className = `relative ${cardBg} rounded-xl shadow-sm p-5 ${borderClass} hover:shadow-md transition-all group mb-4 overflow-hidden`;
            div.innerHTML = `
                ${riskOverlay}
                <div class="flex items-start gap-4 relative z-10" onclick="enterPatientChat('${s.id}')">
                    <div class="w-12 h-12 rounded-full ${isHighRisk ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'} flex items-center justify-center font-bold text-lg shrink-0 uppercase ring-2 ${isHighRisk ? 'ring-rose-500/20' : 'ring-slate-500/10'}">
                        ${s.userName.slice(0, 2)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between mb-1">
                            <span class="font-bold text-sm text-slate-800 dark:text-white uppercase truncate">${s.userName}</span>
                            <span class="text-[10px] text-slate-400">${dateStr} ${timeStr}</span>
                        </div>
                        <p class="text-xs text-slate-500 dark:text-slate-400 truncate mb-2">
                            ${s.messages && s.messages.length > 0 ? escapeHtml(s.messages[s.messages.length - 1].content) : 'Sin mensajes'}
                        </p>
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-bold ${statusBadgeClass} px-2 py-0.5 rounded-full flex items-center gap-1">
                                <i data-lucide="${statusIcon}" class="w-3 h-3"></i> ${statusText}
                            </span>
                            ${s.attendedBy ? `<span class="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">Atendido por ${s.psychName || 'Profesional'}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            list.appendChild(div);
        });
        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.error("Error loading patient list:", e);
    }
}

window.refreshDashboard = initDashboard;

async function loadAdminList() {
    const list = document.getElementById('admin-pro-list');
    if (!list) return;
    try {
        const pros = await api('list_pros');
        list.innerHTML = '';
        if (pros.length === 0) {
            list.innerHTML = '<div class="p-4 text-center text-slate-400">No hay profesionales registrados.</div>';
            return;
        }
        pros.forEach(p => {
            const div = document.createElement('div');
            div.className = "p-3 border rounded-xl flex justify-between items-center bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 mb-2";
            div.innerHTML = `
                <div class="flex-1">
                    <h4 class="font-bold text-sm text-slate-800 dark:text-white uppercase">${p.name}</h4>
                    <p class="text-xs text-slate-500 mb-1">${p.department} - ${p.municipality}</p>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-mono bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 font-bold tracking-wider">${p.accessCode}</span>
                        <button onclick="copyToClipboard('${p.accessCode}')" class="text-slate-400 hover:text-teal-500 transition-colors p-1" title="Copiar Código">
                            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
                <button onclick="deleteProfessional('${p.id}')" class="text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/20 p-2 rounded-lg ml-2" title="Eliminar Profesional">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            `;
            list.appendChild(div);
        });
        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.error("Error loading admin list:", e);
    }
}

window.createProfessional = async (e) => {
    e.preventDefault();
    const name = document.getElementById('pro-new-name').value.trim();
    const dept = document.getElementById('new-pro-dept').value;
    const muni = document.getElementById('new-pro-muni').value;
    if (!name || !dept || !muni) return alert("Completa todos los campos.");

    try {
        const res = await api('create_pro', { name, department: dept, municipality: muni });
        if (res.success) {
            alert(`Profesional creado con éxito.\nCódigo de acceso: ${res.accessCode}`);
            document.getElementById('pro-new-name').value = '';
            document.getElementById('new-pro-dept').value = '';
            document.getElementById('new-pro-muni').value = '';
            loadAdminList();
        }
    } catch (e) {
        alert("Error al crear profesional: " + e.message);
    }
};

window.deleteProfessional = async (id) => {
    if (!confirm("¿Eliminar acceso de este profesional?")) return;
    try {
        await api('delete_pro', { id });
        loadAdminList();
    } catch (e) {
        alert("Error al eliminar: " + e.message);
    }
};

window.resolveCase = async (id, name) => {
    if (!confirm(`¿Estás seguro de finalizar el caso de ${name}?\n\nEsta acción:\n1. Eliminará todo el historial de chat.\n2. Cerrará el acceso del paciente.\n3. Archivará el caso permanentemente.`)) return;
    try {
        await api('resolve_case', { id });
        alert("✅ Caso finalizado correctamente.");
        refreshDashboard();
    } catch (e) {
        console.error(e);
        alert("Error al finalizar el caso: " + e.message);
    }
};

window.deleteSession = async (id) => {
    if (!confirm("¿Eliminar permanentemente todos los datos de este paciente?")) return;
    try {
        await api('delete_session', { id });
        refreshDashboard();
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.handleWipeDB = async () => {
    if (!confirm("⚠️ PELIGRO EXTREMO ⚠️\n\n¿Estás seguro de ELIMINAR TODA la base de datos?\nEsto borrará pacientes, chats y profesionales.")) return;
    if (!confirm("Esta es tu última advertencia. ¿Proceder?")) return;
    try {
        await api('wipe_db');
        alert("Base de datos limpia.");
        logout();
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.toggleInterventionMode = async (patientId, start) => {
    try {
        await api('update_session', { 
            sessionId: patientId, 
            attendedBy: start ? currentUser.id : null,
            psychName: start ? currentUser.name : null
        });
        initChat();
    } catch (e) {
        console.error("Error setting intervention mode:", e);
    }
};

window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        alert("Código copiado al portapapeles.");
    }).catch(err => {
        console.error("Could not copy text: ", err);
    });
};

function showRiskNotification(patientName) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification("⚠️ ALERTA DE RIESGO", {
            body: `El paciente ${patientName} ha sido marcado con RIESGO ALTO.`,
            icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png'
        });
    }

    const toast = document.createElement('div');
    toast.className = "fixed top-4 left-1/2 transform -translate-x-1/2 bg-rose-600 text-white px-6 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-3 fade-in";
    toast.innerHTML = `
        <i data-lucide="alert-triangle" class="w-6 h-6"></i>
        <div>
            <p class="font-bold">¡Atención Requerida!</p>
            <p class="text-xs opacity-90">${patientName} está en riesgo alto.</p>
        </div>
    `;
    document.body.appendChild(toast);

    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.log("Audio autoplay prevented"));
    } catch (e) { }

    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

async function notifyProfessionals(msgText) {
    try {
        const config = await api('get_config');
        if (!config.twilio_configured) return;
        
        await api('notify', {
            message: msgText
        });
    } catch (e) {
        console.warn('Push notify err:', e);
    }
}

async function generateAdminReport() {
    if (!isAdmin) return;
    try {
        const stats = await api('get_dashboard_stats');
        const chartData = await api('get_chart_data');
        
        renderChartsInDashboard(chartData.riskStats, chartData.deptStats, chartData.sessions);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Header
        doc.setFillColor(13, 148, 136); // Teal 600
        doc.rect(0, 0, 210, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.text("Luz y Vida - Reporte de Eficacia", 105, 13, { align: 'center' });

        // General Stats
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 30);
        doc.text(`Total Usuarios: ${stats.totalUsers}`, 14, 40);
        doc.text(`Sesiones Activas: ${stats.activeSessions}`, 14, 50);
        doc.text(`Mensajes Procesados: ${stats.totalMessages}`, 14, 60);

        // Add Charts Images
        const riskCanvas = document.getElementById('chart-risk');
        if (riskCanvas) {
             const riskImg = riskCanvas.toDataURL('image/png');
             doc.addImage(riskImg, 'PNG', 15, 70, 80, 80);
             doc.text("Distribución de Riesgo", 55, 155, { align: 'center' });
        }

        const deptCanvas = document.getElementById('chart-dept');
        if (deptCanvas) {
             const deptImg = deptCanvas.toDataURL('image/png');
             doc.addImage(deptImg, 'PNG', 110, 70, 80, 80);
             doc.text("Departamentos Activos", 150, 155, { align: 'center' });
        }

        // Detailed Table
        const tableData = chartData.sessions.map(s => [
            s.userName,
            s.department,
            s.riskLevel ? s.riskLevel.toUpperCase() : 'N/A',
            new Date(s.lastMessageAt).toLocaleDateString(),
            s.messages ? s.messages.length : 0
        ]);

        doc.autoTable({
            startY: 170,
            head: [['Paciente', 'Depto', 'Riesgo', 'Último Msg', 'Msgs']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [13, 148, 136] }
        });

        doc.save('reporte_luzyvida.pdf');
    } catch (e) {
        alert("Error al generar reporte: " + e.message);
    }
}

function renderChartsInDashboard(riskStats, deptStats, sessions) {
    const container = document.getElementById('admin-charts-container');
    if (!container) {
        const list = document.getElementById('admin-pro-list');
        const wrappingDiv = document.createElement('div');
        wrappingDiv.className = "mb-8 grid grid-cols-1 md:grid-cols-2 gap-6";
        wrappingDiv.id = "admin-charts-container";
        wrappingDiv.innerHTML = `
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl shadow border dark:border-slate-700">
                <h4 class="font-bold mb-4 text-center">Niveles de Riesgo</h4>
                <canvas id="chart-risk"></canvas>
            </div>
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl shadow border dark:border-slate-700">
                <h4 class="font-bold mb-4 text-center">Actividad por Depto</h4>
                <canvas id="chart-dept"></canvas>
            </div>
            <div class="md:col-span-2 flex justify-end">
                 <button onclick="generateAdminReport()" class="bg-teal-600 text-white px-4 py-2 rounded-lg shadow hover:bg-teal-700 flex items-center gap-2">
                    <i data-lucide="download"></i> Descargar Reporte PDF
                 </button>
            </div>
        `;
        list.parentElement.insertBefore(wrappingDiv, list);
        if (window.lucide) window.lucide.createIcons();
    }

    new Chart(document.getElementById('chart-risk'), {
        type: 'doughnut',
        data: {
            labels: ['Bajo', 'Medio', 'Alto'],
            datasets: [{
                data: [riskStats.low || 0, riskStats.medium || 0, riskStats.high || 0],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444']
            }]
        }
    });

    new Chart(document.getElementById('chart-dept'), {
        type: 'bar',
        data: {
            labels: Object.keys(deptStats).slice(0, 5),
            datasets: [{
                label: 'Pacientes',
                data: Object.values(deptStats).slice(0, 5),
                backgroundColor: '#6366f1'
            }]
        }
    });
}
