import blessed from 'blessed';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { Wallet } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
    try {
        const errString = err.stack || err.message;
        if (errString.includes('Partially off-screen') || 
            errString.includes('mismatched dimensions') || 
            errString.includes('RangeError')) return;
        fs.appendFileSync('crash_log.txt', `${new Date().toISOString()} - CRASH: ${errString}\n`);
    } catch (e) {}
});

const CONFIG_FILE = path.join(__dirname, 'config.json');
const ENV_FILE = path.join(__dirname, '.env'); 
const PROXY_FILE = path.join(__dirname, 'proxy.txt');
const TEMPLATES_FILE = path.join(__dirname, 'templates.txt');
const API_BASE_URL = "https://app.humanoidnetwork.org/api";

const FALLBACK_MODELS = [
    "bert-base-uncased", "gpt2", "roberta-base", "distilbert-base-uncased", 
    "t5-small", "google/bert_uncased_L-2_H-128_A-2", "facebook/bart-large", 
    "microsoft/resnet-50", "openai/clip-vit-base-patch32"
];

const FALLBACK_DATASETS = [
    "glue", "squad", "imdb", "mnist", "cifar10", "fashion_mnist", 
    "common_voice", "wikitext", "xnli", "snli"
];

const ENDPOINTS = {
    NONCE: "/auth/nonce",
    AUTH: "/auth/authenticate",
    TASKS: "/tasks",
    TRAINING: "/training",
    PROGRESS: "/training/progress", 
    USER: "/user"
};

const CONFIG_DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Origin": "https://app.humanoidnetwork.org",
    "Referer": "https://app.humanoidnetwork.org/",
    "Content-Type": "application/json"
};

const RED_HAND_BANNER = `
{red-fg}
██████╗ ██████╗ ██████╗      ██╗  ██╗ █████╗ ███╗   ██╗██████╗ 
██╔══██╗██╔════╝██╔══██╗     ██║  ██║██╔══██╗████╗  ██║██╔══██╗
██████╔╝█████╗  ██║  ██║     ███████║███████║██╔██╗ ██║██║  ██║
██╔══██╗██╔══╝  ██║  ██║     ██╔══██║██╔══██║██║╚██╗██║██║  ██║
██║  ██║██████╗ ██████╔╝     ██║  ██║██║  ██║██║ ╚████║██████╔╝
╚═╝  ╚═╝╚═════╝ ╚═════╝      ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
{/red-fg}`;

let config = {
    maxConcurrent: 10,  
    cycleJitterMin: 2, 
    cycleJitterMax: 4, 
    taskDelayMin: 45,  
    taskDelayMax: 90,  
    retryDelayMin: 60,
    retryDelayMax: 120, 
    maxFailures: 10
};

let screen;
let bots = [];
let globalStats = { total: 0, active: 0, queued: 0, sleeping: 0, idle: 0, errors: 0, modelsTrained: 0, datasetsTrained: 0, tasksDone: 0 };
let proxies = [];
let isRunning = false; 
let GLOBAL_TEMPLATES = [];
let currentView = 'menu'; 
let menuPageIndex = 0;
let currentGroupIndex = 0;
let dashboardInterval = null; 
let activeMenuHandler = null; 
let resizeTimeout = null;

let wrapperBox, bannerBox, dashboardBox, statsBox, navBox, configForm, backBtn;


function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, "utf8");
            const loaded = JSON.parse(data);
            config = { ...config, ...loaded };
        } else { saveConfig(); }
    } catch (e) {}
}

function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {} }

function getShortAddress(address) { return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A"; }

function getRandomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }
function getRandomItem(arr) { if (!arr || arr.length === 0) return null; return arr[Math.floor(Math.random() * arr.length)]; }

async function fetchHuggingFaceItem(type) {
    const endpoint = type === 'model' ? 'models' : 'datasets';
    const api_url = `https://huggingface.co/api/${endpoint}?sort=downloads&direction=-1&limit=100`;

    try {
        const res = await callHumanoidAPI(api_url, "GET", null, {}, null);
        
        if (res.json && Array.isArray(res.json)) {
            const validItems = res.json.filter(item => !item.private && !item.gated && !item.disabled);
            
            if (validItems.length > 0) {
                const item = getRandomItem(validItems);
                
                const browserUrl = type === 'model' 
                    ? `https://huggingface.co/${item.id}`
                    : `https://huggingface.co/datasets/${item.id}`;

                return { name: item.id, url: browserUrl };
            }
        }
    } catch (e) {
        
    }

    const list = type === 'model' ? FALLBACK_MODELS : FALLBACK_DATASETS;
    const name = getRandomItem(list);
    
    const fallbackUrl = type === 'model'
        ? `https://huggingface.co/${name}`
        : `https://huggingface.co/datasets/${name}`;

    return { name: name, url: fallbackUrl };
}

function loadTemplates() {
    try {
        const filePath = path.join(__dirname, 'templates.txt');
        
        if (!fs.existsSync(filePath)) {
            console.log(chalk.red(`[ERROR] templates.txt not found at: ${filePath}`));
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l && l.length > 5);
        
        if (lines.length > 0) {
            console.log(chalk.green(`[SUCCESS] Loaded ${lines.length} custom templates.`));
            return lines;
        } else {
            console.log(chalk.yellow(`[WARN] templates.txt was found but empty.`));
            return [];
        }
    } catch (e) { 
        console.log(chalk.red(`[ERROR] Failed to read templates.txt: ${e.message}`));
        return []; 
    }
}

function generateDescription(name, type) {
    let template;

    if (GLOBAL_TEMPLATES && GLOBAL_TEMPLATES.length > 0) {
        template = getRandomItem(GLOBAL_TEMPLATES);
    } 
    
    if (!template) {
        const fallbacks = [
            "Optimized {name} for improved performance.",
            "Integrated {name} into the training pipeline.",
            "Analysing {name} for data consistency.",
            "Deployed {name} for model inference.",
            "Reviewing {name} structure for compatibility."
        ];
        template = getRandomItem(fallbacks);
    }

    const cleanName = name.includes('/') ? name.split('/').pop() : name;
    
    let desc = template
        .replace(/{name}/g, cleanName)
        .replace(/{action}/g, type === 'model' ? "Fine-tuned" : "Curated")
        .replace(/{category}/g, type === 'model' ? "inference model" : "training dataset");

    return desc;
}

const BROWSER_VERSIONS = [
    "chrome120", "chrome124", "chrome119", 
    "edge101", "edge99", "safari15_5"
];

function getRandomBrowser() {
    return BROWSER_VERSIONS[Math.floor(Math.random() * BROWSER_VERSIONS.length)];
}

function callCurlCffi(payload, proxy = null) {
    return new Promise((resolve) => {
        const script = path.join(__dirname, "connect.py");
        
        const impersonate = BROWSER_VERSIONS[Math.floor(Math.random() * BROWSER_VERSIONS.length)];
        
        const args = [
            JSON.stringify(payload), 
            proxy || "", 
            impersonate 
        ];
        
        execFile("python3", [script, ...args], { maxBuffer: 30 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                return resolve({ error: true, status_code: 0, text: stderr || err.message });
            }
            try {
                const parsed = JSON.parse(String(stdout).trim());
                parsed.status_code = parsed.status_code || parsed.status || 0;
                resolve(parsed);
            } catch (e) {
                resolve({ error: true, status_code: 0, text: String(stdout).slice(0, 100) });
            }
        });
    });
}

function callHumanoidAPI(url, method, payload, headers, proxy) {
    return new Promise((resolve) => {
        const script = path.join(__dirname, "api.py");
        const impersonate = getRandomBrowser(); 
        
        const args = [
            url,
            method,
            payload ? JSON.stringify(payload) : "null",
            JSON.stringify(headers || {}),
            proxy || "",
            impersonate 
        ];

        execFile("python3", [script, ...args], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                return resolve({ error: true, status_code: 403, text: stderr || err.message });
            }
            try {
                const parsed = JSON.parse(String(stdout).trim());
                parsed.status_code = parsed.status_code || parsed.status || 0;
                resolve(parsed);
            } catch (e) {
                resolve({ error: true, status_code: 0, text: String(stdout).slice(0, 100) });
            }
        });
    });
}


class HumanoidBot {
    constructor(privateKey, proxy = null, id) {
        this.id = id;
        this.proxy = proxy;
        
        try {
            this.wallet = new Wallet(privateKey.trim());
            this.address = this.wallet.address;
        } catch (e) {
            this.address = "Invalid Key";
            this.wallet = null;
        }

        this.status = 'Idle';
        this.nextAction = 'Waiting to Start';
        this.accessToken = null;
        this.points = "---";
        this.stats = { tasks: 0, models: 0, datasets: 0 };
        this.logs = [];
        this.dailyLimitReached = false;
        
        this.isActive = false;
        this.isRendered = false;
        this.lastActivity = Date.now();
        this.lastMidnightRun = 0;
        this.cycleJitter = 0;
        
        this.container = null;
        this.accountPane = null;
        this.logPane = null;
        
        this.proxyIP = "Local";
        this.proxyStatus = "None"; 
        if (this.proxy) {
            this.proxyStatus = "Active";
            try {
                const urlStr = this.proxy.url || this.proxy;
                const urlObj = new URL(urlStr.includes('://') ? urlStr : `http://${urlStr}`);
                this.proxyIP = urlObj.hostname; 
            } catch (e) { this.proxyIP = "Unknown"; }
        }
    }

    addLog(msg, type = 'info') {
        this.lastActivity = Date.now();
        const time = new Date().toLocaleTimeString('en-GB', {hour12: false});
        let coloredMsg = msg;
        if (type === 'success') coloredMsg = chalk.green(msg);
        else if (type === 'error') coloredMsg = chalk.redBright(msg);
        else if (type === 'warn') coloredMsg = chalk.yellow(msg);
        else if (type === 'debug') coloredMsg = chalk.blue(msg);
        
        this.logs.push(`${chalk.cyan(time)} ${coloredMsg}`);
        if (this.logs.length > 50) this.logs.shift();

        if (this.isRendered && this.logPane) {
            this.logPane.setContent(this.logs.join('\n'));
            this.logPane.setScrollPerc(100);
            try { screen.render(); } catch(e) {}
        }
    }

    refreshDisplay() {
        if (!this.isRendered || !this.accountPane) return;
        
        let statusColor = chalk.white;
        let shortStatus = this.status;
        if (this.status === 'Processing') { shortStatus = 'Process'; statusColor = chalk.greenBright; }
        else if (this.status === 'Waiting Cycle') { shortStatus = 'Wait'; statusColor = chalk.magenta; }
        else if (this.status.includes('Error')) { shortStatus = 'Error'; statusColor = chalk.red; }
        else if (this.status === 'Stopped') { shortStatus = 'Stop'; statusColor = chalk.yellow; }
        else if (this.status === 'Finished') { shortStatus = 'Done'; statusColor = chalk.green; }

        let safeNext = this.nextAction || "";
        if (safeNext.length > 18) safeNext = safeNext.substring(0, 16) + "..";
        
        let pColor = chalk.gray;
        if (this.proxyStatus === 'Active' || this.proxyStatus === 'Verified') pColor = chalk.green;
        else if (this.proxyStatus === 'Down') pColor = chalk.red;

        const content = 
            `{bold}Addr:{/bold} ${getShortAddress(this.address)}\n` +
            `{bold}Pnts:{/bold} ${chalk.yellowBright(this.points)}\n` + 
            `{bold}IP  :{/bold} ${this.proxyIP}\n` +
            `{bold}Prxy:{/bold} ${pColor(this.proxyStatus)}\n` +
            `{bold}Task:{/bold} ${this.stats.tasks}\n` +
            `{bold}Modl:{/bold} ${this.stats.models}/3\n` +
            `{bold}Data:{/bold} ${this.stats.datasets}/3\n` +
            `{bold}Sts :{/bold} ${statusColor(shortStatus)}\n` +
            `{bold}Next:{/bold} ${chalk.cyan(safeNext)}`;
            
        this.accountPane.setContent(content);
        try { screen.render(); } catch(e) {}
    }

    updateStatus(newStatus) {
        this.lastActivity = Date.now();
        this.status = newStatus;
        this.refreshDisplay();
        updateDashboard();
    }

    async smartSleep(min, max, reason="Wait") {
        if (!this.isActive) return;
        this.updateStatus('Waiting');
        
        let dMin = parseInt(min); if(isNaN(dMin)) dMin = 30;
        let duration = dMin;
        
        if (max) {
            let dMax = 0;
            if (typeof max === 'number') dMax = max;
            else if (typeof max === 'string') { reason = max; dMax = dMin; } 
            if (dMax > dMin) duration = Math.floor(Math.random() * (dMax - dMin + 1) + dMin);
        }

        const end = Date.now() + (duration * 1000);
        this.addLog(`Wait ${duration}s (${reason})...`, 'warn');
        
        while(Date.now() < end && this.isActive) {
            this.nextAction = `Wait: ${Math.ceil((end-Date.now())/1000)}s (${reason})`;
            this.refreshDisplay();
            await new Promise(r => setTimeout(r, 1000));
        }
        if(this.isActive) { this.nextAction = 'Resuming...'; this.updateStatus('Processing'); }
    }
    
    async fetchIpAddress() {
        if (!this.isActive) return;
        this.addLog("Checking Exit IP...", "info");
        
        try {
            const res = await callHumanoidAPI(
                "https://api.ipify.org?format=json", 
                "GET", 
                null, 
                {}, 
                this.proxy ? this.proxy.url : null
            );

            if (res.json && res.json.ip) {
                this.proxyIP = res.json.ip;
                this.proxyStatus = "Active"; 
            } else {
                this.proxyIP = "Check Failed";
            }
        } catch (e) {
            this.proxyIP = "Error";
        }
        this.refreshDisplay();
    }

    async login() {
        if (!this.wallet) { this.addLog("Invalid Private Key!", "error"); return false; }
        
        this.updateStatus("Authenticating");
        this.addLog("Getting Nonce...", "info");

        const nonceRes = await callHumanoidAPI(API_BASE_URL + ENDPOINTS.NONCE, "POST", { walletAddress: this.address }, CONFIG_DEFAULT_HEADERS, this.proxy ? this.proxy.url : null);
        
        if (!nonceRes.json || !nonceRes.json.nonce) {
            const raw = nonceRes.text || "Unknown";
            if(raw.includes("DOCTYPE html") || raw.includes("Cloudflare")) {
                this.addLog("Blocked by Cloudflare (HTML)", "error");
            } else {
                this.addLog(`Nonce Fail: ${raw.slice(0, 30)}`, "error");
            }
            if (this.proxy) this.proxyStatus = "Down";
            return false;
        }
        
        if(this.proxy) this.proxyStatus = "Active";
        const nonce = nonceRes.json.nonce;
        const timestamp = new Date().toISOString(); 
        
        this.addLog("Signing Message...", "info");

        const message = `Welcome to HAN Network!

By signing this message, you're verifying your wallet ownership and agreeing to join the Humanoid Autonomous Network.

Wallet address: ${this.address}
Nonce: ${nonce}
Timestamp: ${timestamp}

This signature will not trigger any blockchain transaction or cost any gas fees.`;

        let signature;
        try {
            signature = await this.wallet.signMessage(message);
        } catch (e) {
            this.addLog(`Signing Error: ${e.message}`, "error");
            return false;
        }

        const authPayload = {
            walletAddress: this.address,
            message: message,
            signature: signature
        };

        const authRes = await callCurlCffi(authPayload, this.proxy ? this.proxy.url : null);

        const body = authRes.json || {};
        const token = body.accessToken || body.token || (body.data && body.data.accessToken) || (body.data && body.data.token);

        if (token) {
            this.accessToken = token;
            this.addLog("Login Successful!", "success");
            return true;
        } else {
            this.addLog(`Auth Fail: ${authRes.status_code}`, "error");
            
            const debugMsg = authRes.text ? authRes.text.slice(0, 100) : "Empty Response";
            this.addLog(`Resp: ${debugMsg}`, "warn"); 
            
            return false;
        }
    }

    async getUserInfo() {
        if(!this.accessToken) return;
        const headers = { ...CONFIG_DEFAULT_HEADERS, "Authorization": `Bearer ${this.accessToken}` };
        const userRes = await callHumanoidAPI(API_BASE_URL + ENDPOINTS.USER, "GET", null, headers, this.proxy ? this.proxy.url : null);
        if(userRes.json && userRes.json.totalPoints !== undefined) {
            this.points = userRes.json.totalPoints;
            this.refreshDisplay();
        }
    }

    async solveTasks() {
        this.addLog("Scanning Tasks...", "info");
        const headers = { 
            ...CONFIG_DEFAULT_HEADERS, 
            "Authorization": `Bearer ${this.accessToken}`,
            "Content-Type": "application/json"
        };
        
        // 1. Fetch User Profile
        const userRes = await callHumanoidAPI(`${API_BASE_URL}${ENDPOINTS.USER}`, "GET", null, headers, this.proxy ? this.proxy.url : null);
        
        // --- FIX 1: CORRECT ID EXTRACTION (Stops the loop) ---
        const completedIds = new Set();
        const userData = userRes.json?.user || userRes.json || {};
        // We now look for 'taskCompletions' inside the user object
        const rawCompletions = userData.taskCompletions || [];
        
        if (Array.isArray(rawCompletions)) {
            rawCompletions.forEach(item => {
                // We extract the 'taskId' from inside the object
                if (item.taskId) completedIds.add(String(item.taskId));
            });
        }
        
        this.addLog(`User has completed ${completedIds.size} tasks.`, "debug");

        // 2. Fetch Available Tasks
        const listRes = await callHumanoidAPI(`${API_BASE_URL}${ENDPOINTS.TASKS}`, "GET", null, headers, this.proxy ? this.proxy.url : null);

        if (listRes.json && Array.isArray(listRes.json)) {
            
            // 3. Filter Tasks
            const pending = listRes.json.filter(t => {
                const tId = String(t.id); 
                
                // Check if ID is in our fixed 'completedIds' list
                if (completedIds.has(tId)) return false;
                if (t.completed === true || t.status === 'COMPLETED') return false;
                
                // Skip Manual Invites
                const title = (t.title || t.name || "").toUpperCase();
                if (title.includes("INVITE") || title.includes("REFER")) return false;

                return true; 
            });

            if (pending.length === 0) { 
                this.addLog("All tasks completed!", "success"); 
                return; 
            }

            this.addLog(`Found ${pending.length} new pending tasks.`, "info");

            for (const task of pending) {
                if (!this.isActive) break;
                
                this.nextAction = `Task: ${task.title || task.id}`;
                this.refreshDisplay();
                
                // Interaction Delay
                const isSocial = (task.type || "").toUpperCase().includes("SOCIAL");
                await this.smartSleep(isSocial ? 4 : 2, 6, "Action Delay"); 
                
                // Construct Payload
                let taskData = task.data || {};
                if (Object.keys(taskData).length === 0 && task.url) {
                    taskData = { url: task.url };
                }

                const payload = { 
                    taskId: String(task.id), 
                    data: taskData 
                };

                // Submit Task
                const res = await callHumanoidAPI(`${API_BASE_URL}${ENDPOINTS.TASKS}`, "POST", payload, headers, this.proxy ? this.proxy.url : null);

                // Check Success
                if (res.json && (res.json.completed === true || res.json.status === 'COMPLETED')) {
                    this.addLog(`Task ${task.id} Done`, 'success');
                    this.stats.tasks++; 
                    globalStats.tasksDone++;
                    completedIds.add(String(task.id));

                    // --- FIX 2: LIVE UPDATE ---
                    // Updates points immediately after this specific task is done
                    await this.getUserInfo(); 

                } else { 
                    const msg = res.json?.message || "Failed";
                    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("completed")) {
                         completedIds.add(String(task.id));
                         this.addLog(`Task ${task.id} verified complete.`, 'info');
                    } else {
                         this.addLog(`Task ${task.id} Fail: ${msg}`, 'warn'); 
                    }
                }
                
                // Wait for configured delay before starting the NEXT task
                await this.smartSleep(config.taskDelayMin, config.taskDelayMax, "Next Task");
            }
        }
    }

    async submitTraining(type) {
        if (this.dailyLimitReached) return;
        const headers = { ...CONFIG_DEFAULT_HEADERS, "Authorization": `Bearer ${this.accessToken}` };
        
        this.addLog(`Checking ${type} status...`, 'info');
        const progressRes = await callHumanoidAPI(API_BASE_URL + ENDPOINTS.PROGRESS, "GET", null, headers, this.proxy ? this.proxy.url : null);
        
        let completed = 0;
        let limit = 3; 
        
        if (progressRes.json && progressRes.json.daily) {
            const key = type === 'model' ? 'models' : 'datasets';
            const data = progressRes.json.daily[key];
            if (data) {
                completed = data.completed || 0;
                limit = data.limit || 3;
                
                if (type === 'model') this.stats.models = completed;
                else this.stats.datasets = completed;
                this.refreshDisplay(); 
            }
        }

        if (completed >= limit) {
            this.addLog(`${type}s already done (${completed}/${limit}).`, 'success');
            return; 
        }

        let needed = limit - completed; 
        this.addLog(`${type}s: ${completed}/${limit} Done. Running ${needed} more...`, 'info');

        let successCount = 0; 
        let failCount = 0;

        while (successCount < needed && this.isActive) {
            
            if (failCount >= config.maxFailures) {
                this.addLog(`High error rate for ${type}. Cooldown 1m...`, 'warn');
                await this.smartSleep(60, "Error Cooldown"); 
                failCount = 0; 
                continue;
            }

            this.addLog(`Fetching ${type} from HF...`, 'debug');
            const hfData = await fetchHuggingFaceItem(type);
            const description = generateDescription(hfData.name, type);
            
            const currentItemNum = completed + successCount + 1;
            this.nextAction = `${type} ${currentItemNum}/${limit}`;
            this.refreshDisplay();

            const payload = { 
                fileName: hfData.name, 
                fileUrl: hfData.url, 
                fileType: type, 
                description: description, 
                recaptchaToken: "" 
            };

            await this.smartSleep(4, 8, `Typing ${hfData.name.slice(0, 15)}...`);
            
            const res = await callHumanoidAPI(API_BASE_URL + ENDPOINTS.TRAINING, "POST", payload, headers, this.proxy ? this.proxy.url : null);
            const msg = res.json && res.json.message ? res.json.message.toLowerCase() : "";

            if (msg.includes("daily") || msg.includes("usage limit")) {
                this.addLog("Daily limit hit (API Check).", "warn");
                this.dailyLimitReached = true;
                return; 
            }

            if (res.status_code === 429 || msg.includes("busy")) {
                const waitTime = 60 + (this.id * 2);
                this.addLog(`Rate Limit. Wait ${waitTime}s...`, "warn");
                await this.smartSleep(waitTime, "Rate Limit");
                continue; 
            }

            if (res.json && (res.json.verified || res.json.success)) {
                successCount++; 
                failCount = 0; 
                
                if (res.json.points) {
                    const currentPoints = parseFloat(this.points) || 0;
                    this.points = (currentPoints + res.json.points).toFixed(2);
                }
                
                if(type === 'model') { this.stats.models++; globalStats.modelsTrained++; }
                else { this.stats.datasets++; globalStats.datasetsTrained++; }
                
                this.addLog(`${type} ${currentItemNum}/${limit} Success`, 'success');
            } else {
                failCount++;
                
                let detailedError = "Unknown";
                if (res.json && res.json.message) detailedError = res.json.message;
                else if (res.text) detailedError = `Status ${res.status_code}: ${res.text.slice(0, 50)}`;
                else detailedError = `Status ${res.status_code}`;

                this.addLog(`${type} Fail: ${detailedError}`, 'warn');
                
                await this.smartSleep(config.retryDelayMin, config.retryDelayMax, "Retry Wait");
            }
        }
    }

    async startWork() {
        if (!this.isActive) return;
        
        let isValidSession = false;
        if (this.accessToken) { 
             isValidSession = true;
        }

        if (!isValidSession) {
            while (this.isActive) {
                const loggedIn = await this.login();
                if (loggedIn) break; 
                await this.smartSleep(config.retryDelayMin, config.retryDelayMax, "Login Retry");
            }
        }

        if(!this.isActive) return; 

        await this.fetchIpAddress();

        try {
            this.updateStatus('Processing');
            this.stats = { tasks: 0, models: 0, datasets: 0 }; 
            
            if (!isValidSession) await this.getUserInfo();
            
            await this.smartSleep(5, 10, "Pre-Tasks");
            await this.solveTasks();

            this.addLog("Tasks Done. Bridge wait 10s...", "info");
            await this.smartSleep(10, "Logic Bridge");

            this.addLog("Starting Model Training...", "info");
            await this.submitTraining("model");

            await this.smartSleep(5, 10, "Switching Data");
            
            this.addLog("Starting Dataset Training...", "info");
            await this.submitTraining("dataset");

            const hasCompletedModels = this.stats.models >= 3;
            const hasCompletedDatasets = this.stats.datasets >= 3;

            if (hasCompletedModels && hasCompletedDatasets) {
                this.addLog("All daily goals met. Scheduling cycle.", 'success');
                this.lastMidnightRun = this.getNextMidnightUTC() - (24 * 60 * 60 * 1000); 
                this.scheduleNextCycle();
            } else {
                this.addLog("Goals incomplete. Retrying in 15m...", 'warn');
                await this.smartSleep(900, "Goal Retry");
                this.startWork(); 
            }
            
        } catch (error) {
            this.addLog(`Work Error: ${error.message || "Unknown"}`, 'error');
            await this.smartSleep(60, "Error Recovery"); 
            this.scheduleNextCycle(); 
        }
    }
    
    getNextMidnightUTC() {
        const now = new Date();
        const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
        return new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate() + 1, 0, 0, 0, 0)).getTime();
    }

    scheduleNextCycle() {
        this.updateStatus('Waiting Cycle');
        this.dailyLimitReached = false;
        
        this.accessToken = null; 

        const nextMidnight = this.getNextMidnightUTC();
        
        if (!this.cycleJitter) {
            const jitterMin = (config.cycleJitterMin || 2) * 60 * 60 * 1000; 
            const jitterMax = (config.cycleJitterMax || 4) * 60 * 60 * 1000;
            this.cycleJitter = Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin;
        }

        const nextRun = nextMidnight + this.cycleJitter;
        const now = Date.now();
        const todayMidnight = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0, 0)).getTime();
        
        if (now >= todayMidnight && (this.lastMidnightRun === 0 || this.lastMidnightRun < todayMidnight)) {
            this.addLog("Ready for today's run", 'info');
            this.updateStatus('Queued');
            this.cycleJitter = 0; 
            return;
        }
        
        this.runDynamicCountdown("Cycle", nextRun);
    }

    runDynamicCountdown(type, targetTimestamp = 0) {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        
        this.countdownInterval = setInterval(() => {
            if(!this.isActive) { clearInterval(this.countdownInterval); return; }

            const targetTime = type === "Cycle" ? targetTimestamp : Date.now() + 60000; 
            let remaining = targetTime - Date.now();
            
            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                this.cycleJitter = 0; 
                this.updateStatus('Queued');
            } else {
                const h = Math.floor(remaining / 3600000);
                const m = Math.floor((remaining % 3600000) / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                this.nextAction = `Next ${type}: ${h}h ${m}m ${s}s`;
                this.refreshDisplay();
            }
        }, 1000);
    }

    start() {
        if(this.isActive) return;
        this.isActive = true; 
        
        const now = Date.now();
        const todayMidnightUTC = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0, 0)).getTime();
        
        if (now >= todayMidnightUTC && (this.lastMidnightRun === 0 || this.lastMidnightRun < todayMidnightUTC)) {
            this.updateStatus('Queued');
            this.addLog('Added to queue', 'info');
        } else {
            this.updateStatus('Waiting Cycle');
            this.scheduleNextCycle();
        }
    }
    
    async startProcessing() {
        this.updateStatus('Processing');
        this.lastActivity = Date.now();
        
        try {
            const delay = Math.floor(Math.random() * 5000); 
            this.nextAction = `Start in ${delay/1000}s`;
            this.refreshDisplay();
            await new Promise(r => setTimeout(r, delay));
            await this.startWork();
        } catch (e) {
            this.addLog(`CRITICAL: ${e.message}`, 'error');
            this.scheduleNextCycle();
        } finally {
            if (this.status === 'Processing') {
                this.updateStatus('Waiting Cycle');
            }
        }
    }

    stop() {
        this.isActive = false;
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.updateStatus('Stopped');
        this.nextAction = 'Stopped by User';
        this.addLog('Process Stopped.', 'warn');
        this.refreshDisplay();
    }

    attachUI(screenObj, top, left, height, width) {
        this.isRendered = true;
        this.container = blessed.box({ parent: screenObj, top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%`, transparent: true });
        this.accountPane = blessed.box({ parent: this.container, top: 0, left: 0, width: '35%', height: '100%', label: ` Bot ${this.id} `, padding: { left: 1 }, tags: true, border: { type: 'line', fg: 'cyan' } });
        this.logPane = blessed.box({ parent: this.container, top: 0, left: '35%', width: '65%', height: '100%', label: ' Logs ', content: this.logs.join('\n'), tags: true, scrollable: true, alwaysScroll: true, wrap: true, padding: { left: 1 }, scrollbar: { ch: ' ', style: { bg: 'cyan' } }, border: { type: 'line', fg: 'white' } });
        this.logPane.setScrollPerc(100);
        this.refreshDisplay();
    }

    detachUI(screenObj) {
        this.isRendered = false;
        if (this.container) { screenObj.remove(this.container); this.container.destroy(); }
        this.container = null; this.accountPane = null; this.logPane = null;
    }
}

function manageQueue() {
    if (!isRunning) return;
    const now = Date.now();
    const STUCK_TIMEOUT = 300 * 1000; 
    
    bots.forEach(b => {
        if (b.isActive && (b.status === 'Processing' || b.status === 'Authenticating')) {
            if (b.lastActivity && (now - b.lastActivity > STUCK_TIMEOUT)) {
                b.addLog("Watchdog: Bot stuck! Resetting...", "error");
                b.updateStatus('Queued'); 
                b.isActive = true; 
            }
        }
    });

    const busyCount = bots.filter(b => b.status === 'Processing' || b.status === 'Authenticating').length;
    if (busyCount < config.maxConcurrent) {
        const nextBot = bots.find(b => b.status === 'Queued');
        if (nextBot) nextBot.startProcessing();
    }
    
    globalStats.active = busyCount;
    globalStats.queued = bots.filter(b => b.status === 'Queued').length;
    globalStats.sleeping = bots.filter(b => b.status === 'Waiting Cycle').length;
    globalStats.idle = bots.filter(b => b.status === 'Idle').length;
}

function cleanupUI() {
    if (wrapperBox) wrapperBox.destroy();
    if (configForm) configForm.destroy();
    if (backBtn) backBtn.destroy();
    wrapperBox = null; configForm = null; backBtn = null;
    bots.forEach(b => b.detachUI(screen));
    if (activeMenuHandler) { screen.removeListener('keypress', activeMenuHandler); activeMenuHandler = null; }
}

function updateDashboard() {
    if (!statsBox || statsBox.detached || screen.width < 50) return;
    if (currentView === 'menu') {
        if(isRunning) manageQueue();
        const sysStatus = isRunning ? chalk.green("RUNNING") : chalk.yellow("STOPPED");
        const content = screen.width < 80 
            ? ` {bold}System:{/bold} ${sysStatus}\n Accs:${globalStats.total} Act:${chalk.green(globalStats.active)} Q:${chalk.blue(globalStats.queued)} Wait:${chalk.yellow(globalStats.sleeping)}`
            : ` {bold}System:{/bold} ${sysStatus}   {bold}Accounts:{/bold} ${globalStats.total}   {bold}Active:{/bold} ${chalk.green(globalStats.active)}   {bold}Queued:{/bold} ${chalk.blue(globalStats.queued)}   {bold}Waiting:{/bold} ${chalk.yellow(globalStats.sleeping)}`;
        try { statsBox.setContent(content); screen.render(); } catch(e) {}
    }
}

function showMainMenu(doClear = true) {
    currentView = 'menu';
    if(doClear) cleanupUI();
    const isSmall = screen.width < 100;
    const mainWidth = screen.width > 110 ? 100 : '100%';
    wrapperBox = blessed.box({ parent: screen, top: 'center', left: 'center', width: mainWidth, height: isSmall ? '100%' : 34 });

    const bannerHeight = isSmall ? 0 : 12;
    if (!isSmall) {
        blessed.box({ parent: wrapperBox, top: 4, left: 'center', width: '100%', height: bannerHeight, content: `${RED_HAND_BANNER}\n{bold}{white-fg}HUMANOID NETWORK AUTOMATION{/white-fg}{/bold}`, tags: true, style: { bg: 'black' }, valign: 'middle', align: 'center' });
    }

    dashboardBox = blessed.box({ parent: wrapperBox, top: bannerHeight, left: 'center', width: '100%', height: isSmall ? '100%' : 19, border: { type: 'line', fg: 'cyan' }, label: isSmall ? ' {red-fg}RED HAND{/red-fg} ' : undefined, tags: true, style: { bg: 'black' } });
    statsBox = blessed.box({ parent: dashboardBox, top: 1, left: 'center', width: '90%', height: 3, tags: true, border: { type: 'line', fg: 'white' }, label: ' Status ' });
    
    const listBox = blessed.box({ parent: dashboardBox, top: 5, left: '5%', width: '45%', height: 'shrink', tags: true });
    navBox = blessed.box({ parent: dashboardBox, top: 5, left: '50%', width: '45%', height: 'shrink', tags: true });
    
    const updateNavContent = () => {
        if(!navBox) return;
        const startText = isRunning ? "{bold}{red-fg}[S] Stop{/red-fg}{/bold}" : "{bold}{green-fg}[S] Start{/green-fg}{/bold}";
        const totalGroups = Math.ceil(bots.length / 4) || 1;
        navBox.setContent(`${startText}\n{bold}[C]{/bold} Config\n{bold}[Q]{/bold} Quit\n\nPage ${menuPageIndex+1}/${totalGroups}\nArrows: Nav`);
    };
    updateNavContent();

    const totalGroups = Math.ceil(bots.length / 4);
    const startGroup = menuPageIndex * 5;
    const endGroup = Math.min(startGroup + 5, totalGroups);
    let listContent = "";
    for (let i = startGroup; i < endGroup; i++) listContent += `{bold}{cyan-fg}[${i - startGroup + 1}]{/cyan-fg}{/bold} Group ${i + 1}\n\n`;
    listBox.setContent(listContent || "No bots added.");

    updateDashboard(); screen.render();

    const menuHandler = (ch, key) => {
        if (currentView !== 'menu') return;
        if (key.name === 'c') showConfigMenu(true);
        else if (key.name === 'q') process.exit(0);
        else if (key.name === 's') {
            if (!isRunning) { isRunning = true; bots.forEach(b => b.start()); } 
            else { isRunning = false; bots.forEach(b => { if(b.status === 'Queued') b.updateStatus('Idle'); else b.stop(); }); }
            updateNavContent(); updateDashboard(); screen.render();
        }
        else if (/[1-5]/.test(ch)) {
            const selection = parseInt(ch) - 1;
            const absIndex = (menuPageIndex * 5) + selection;
            if (absIndex < totalGroups) showGroupDetails(absIndex, true);
        }
        else if (key.name === 'right' && menuPageIndex < Math.ceil(totalGroups / 5) - 1) { menuPageIndex++; showMainMenu(true); }
        else if (key.name === 'left' && menuPageIndex > 0) { menuPageIndex--; showMainMenu(true); }
    };
    activeMenuHandler = menuHandler; screen.on('keypress', menuHandler);
}

function showGroupDetails(groupIndex, doClear = true) {
    currentView = 'group';
    if(doClear) cleanupUI();
    currentGroupIndex = groupIndex;
    const startIdx = groupIndex * 4;
    const endIdx = Math.min((groupIndex + 1) * 4, bots.length);
    const subset = bots.slice(startIdx, endIdx);

    subset.forEach((bot, index) => {
        const row = Math.floor(index / 2) * 50; 
        const col = (index % 2) * 50;          
        bot.attachUI(screen, row, col, 50, 50);
    });

    backBtn = blessed.box({ bottom: 0, right: 0, width: 20, height: 3, content: '{center}{bold} [B] BACK {/bold}{/center}', tags: true, style: { bg: 'red', fg: 'white' }, border: { type: 'line', fg: 'white' } });
    screen.append(backBtn); screen.render();
    backBtn.on('click', () => showMainMenu(true));

    const groupHandler = (ch, key) => {
        if (currentView !== 'group') return;
        if (key.name === 'b' || key.name === 'escape') showMainMenu(true);
    };
    activeMenuHandler = groupHandler; screen.on('keypress', groupHandler);
}

function showConfigMenu(doClear = true) {
    currentView = 'config';
    if(doClear) cleanupUI();
    const isSmall = screen.width < 100;
    const boxWidth = isSmall ? '95%' : '25%'; 
    const boxHeight = 22; 

    const form = blessed.form({ parent: screen, keys: true, left: 'center', top: 'center', width: boxWidth, height: boxHeight, label: isSmall ? undefined : ' Configuration ', border: isSmall ? undefined : { type: 'line', fg: 'yellow' }, bg: 'black', padding: { top: 1, left: 1, right: 1, bottom: 1 } });
    
    blessed.text({ parent: form, top: 0, left: 1, content: 'Max Active Bots:' });
    const inputMaxCon = blessed.textbox({ parent: form, top: 1, left: 1, height: 1, width: 10, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.maxConcurrent) });

    blessed.text({ parent: form, top: 3, left: 1, content: 'Cycle Jitter (Min/Max hrs):' });
    const inJitMin = blessed.textbox({ parent: form, top: 4, left: 1, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.cycleJitterMin) });
    const inJitMax = blessed.textbox({ parent: form, top: 4, left: 13, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.cycleJitterMax) });

    blessed.text({ parent: form, top: 6, left: 1, content: 'Task Delay (Min/Max s):' });
    const inTaskMin = blessed.textbox({ parent: form, top: 7, left: 1, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.taskDelayMin) });
    const inTaskMax = blessed.textbox({ parent: form, top: 7, left: 13, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.taskDelayMax) });

    blessed.text({ parent: form, top: 9, left: 1, content: 'Retry Delay (Min/Max s):' });
    const inRetryMin = blessed.textbox({ parent: form, top: 10, left: 1, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.retryDelayMin) });
    const inRetryMax = blessed.textbox({ parent: form, top: 10, left: 13, width: 10, height: 1, keys: true, inputOnFocus: true, style:{bg:'blue'}, value: String(config.retryDelayMax || 120) });

    const saveBtn = blessed.button({ parent: form, bottom: 0, left: 1, width: isSmall ? 10 : 14, height: 3, content: ' SAVE ', align: 'center', valign: 'middle', style: { bg: 'green', fg: 'black', focus: { bg: 'white' } }, border: {type: 'line'} });
    const cancelBtn = blessed.button({ parent: form, bottom: 0, right: 1, width: isSmall ? 10 : 14, height: 3, content: ' CANCEL ', align: 'center', valign: 'middle', style: { bg: 'red', fg: 'white', focus: { bg: 'white', fg: 'black' } }, border: {type: 'line'} });

    const submit = () => {
        config.maxConcurrent = parseInt(inputMaxCon.value) || 10;
        config.cycleJitterMin = parseInt(inJitMin.value) || 2;
        config.cycleJitterMax = parseInt(inJitMax.value) || 4;
        config.taskDelayMin = parseInt(inTaskMin.value) || 45;
        config.taskDelayMax = parseInt(inTaskMax.value) || 90;
        config.retryDelayMin = parseInt(inRetryMin.value) || 60;
        config.retryDelayMax = parseInt(inRetryMax.value) || 120;
        saveConfig(); showMainMenu(true);
    };

    saveBtn.on('press', submit);
    cancelBtn.on('press', () => showMainMenu(true));
    
    inputMaxCon.key(['enter', 'tab'], () => inJitMin.focus());
    inJitMin.key(['enter', 'tab'], () => inJitMax.focus());
    inJitMax.key(['enter', 'tab'], () => inTaskMin.focus());
    inTaskMin.key(['enter', 'tab'], () => inTaskMax.focus());
    inTaskMax.key(['enter', 'tab'], () => inRetryMin.focus());
    inRetryMin.key(['enter', 'tab'], () => inRetryMax.focus());
    inRetryMax.key(['enter', 'tab'], () => saveBtn.focus());
    
    configForm = form; screen.append(form); screen.render();
}

async function main() {
    loadConfig();
    GLOBAL_TEMPLATES = loadTemplates();

    let keys = [];
    try { 
        const envContent = fs.readFileSync(ENV_FILE, 'utf8');
        
        keys = envContent.split('\n')
            .map(line => {
                const commentIndex = line.indexOf('#');
                if (commentIndex !== -1) {
                    line = line.substring(0, commentIndex);
                }
                return line.trim();
            })
            .filter(line => {
                const cleaned = line.replace(/^0x/, '');
                return line.length > 0 && 
                       !line.startsWith('#') && 
                       /^[0-9a-fA-F]{64}$/.test(cleaned);
            });
        
        if (keys.length === 0) {
            console.log(chalk.red("[ERROR] No valid private keys found in .env file!"));
            console.log(chalk.yellow("Please add your Ethereum private keys to .env (one per line)"));
            console.log(chalk.yellow("Example:"));
            console.log(chalk.yellow("0x4cbe58c50480..."));
            console.log(chalk.yellow("0x5da4ef2e19d..."));
            process.exit(1);
        }
        
        console.log(chalk.green(`[SUCCESS] Loaded ${keys.length} private keys from .env`));
    } catch(e) { 
        console.log(chalk.red("[ERROR] Failed to load .env file!"));
        console.log(chalk.yellow("Please copy .env.example to .env and add your private keys."));
        console.log(chalk.yellow("Error:", e.message));
        process.exit(1);
    }
    
    try { proxies = fs.readFileSync(PROXY_FILE, 'utf8').split('\n').map(a=>a.trim()).filter(a=>a); } catch(e) {}
    globalStats.total = keys.length;

    keys.forEach((key, i) => {
        const p = proxies.length ? { url: proxies[i%proxies.length], type: 'http'} : null;
        const bot = new HumanoidBot(key, p, i+1);
        bots.push(bot);
    });

    screen = blessed.screen({ smartCSR: true, title: 'HUMANOID NETWORK BOT' });
    screen.enableMouse(); 
    screen.on('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => { 
            if (currentView === 'menu') showMainMenu();
            else if (currentView === 'group') showGroupDetails(currentGroupIndex);
        }, 200);
    });

    dashboardInterval = setInterval(updateDashboard, 1000);
    showMainMenu(true);
}

main();