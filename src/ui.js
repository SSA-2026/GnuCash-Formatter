// Utility functions (copied from utils.js since ui.js is now a regular script)
function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i ? 1 : 0) + " " + sizes[i];
}

function toast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'toast';
    toast.style.display = 'block';
    
    if (type === 'good') toast.style.color = 'var(--good)';
    else if (type === 'warn') toast.style.color = 'var(--warn)';
    else if (type === 'bad') toast.style.color = 'var(--bad)';
    else toast.style.color = 'var(--fg)';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// STATE will be provided by main.js - this ensures we use the same STATE object
// --- Alpine.js Integration ---

// Define the data function globally so Alpine can find it
window.app = function() {
        return {
            // State
            folderName: null,
            inputFiles: [],
            outputFiles: [],
            selectedInputs: new Set(),
            selectedOutputs: new Set(),
            activeTab: 'inputs',
            isConverting: false,
            progress: 0,
            progressText: '',
            showProgress: false,
            
            // Config Modal
            showConfigModal: false,
            config: {},
            detectedBanners: [], // { name, path, url }

            // Conversion Options
            conversionOptions: {
                overwrite: true,
                keepHtml: false,
                debug: false
            },
            
            showConvertOptions: false,
            
            // Edit Modal
            showEditModal: false,
            editingFileId: null,
            editingData: null,
            
            // Preview Modal
            showPreviewModal: false,
            previewTitle: '',
            previewUrl: null, // For PDF blobs
            
            // IBAN Modal
            showIbanModal: false,
            ibanInput: '',

            // Theme
            theme: localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),

            // Computed
            get inputCount() { return this.inputFiles.length; },
            get outputCount() { return this.outputFiles.length; },
            get hasFolder() { return !!this.folderName; },
            get statusText() {
                if (!this.folderName) return "No folder selected";
                let text = `${this.folderName} — ${this.inputCount} input, ${this.outputCount} output`;
                // Check if config is loaded (simplified check)
                if (window.STATE && window.STATE.config && window.STATE.ibanConfig) text += " — Config loaded";
                else text += " — No config found";
                return text;
            },
            get statusColor() {
                if (!this.folderName) return "var(--muted)";
                if (window.STATE && window.STATE.config && window.STATE.ibanConfig) return "var(--good)";
                return "var(--warn)";
            },

            init() {
                // Expose this store to the global scope so non-Alpine code can update it
                window.AlpineStore = this;
                
                // Load initial state if available
                this.refreshState();
                
                // Apply theme
                this.applyTheme();
            },

            refreshState() {
                if (window.STATE && window.STATE.projectFolder) {
                    this.folderName = window.STATE.projectFolder.name;
                    this.inputFiles = [...window.STATE.inputFiles];
                    this.outputFiles = [...window.STATE.outputFiles];
                } else {
                    this.folderName = null;
                    this.inputFiles = [];
                    this.outputFiles = [];
                }
                this.selectedInputs = new Set(window.STATE ? window.STATE.selectedInputs : new Set());
                this.selectedOutputs = new Set(window.STATE ? window.STATE.selectedOutputs : new Set());
            },

            // Actions
            toggleInput(id) {
                if (this.selectedInputs.has(id)) {
                    this.selectedInputs.delete(id);
                    if (window.STATE) window.STATE.selectedInputs.delete(id);
                } else {
                    this.selectedInputs.add(id);
                    if (window.STATE) window.STATE.selectedInputs.add(id);
                }
                // Force reactivity for Set
                this.selectedInputs = new Set(this.selectedInputs);
            },

            toggleOutput(id) {
                if (this.selectedOutputs.has(id)) {
                    this.selectedOutputs.delete(id);
                    if (window.STATE) window.STATE.selectedOutputs.delete(id);
                } else {
                    this.selectedOutputs.add(id);
                    if (window.STATE) window.STATE.selectedOutputs.add(id);
                }
                this.selectedOutputs = new Set(this.selectedOutputs);
            },

            toggleAllInputs() {
                if (this.selectedInputs.size === this.inputFiles.length) {
                    this.selectedInputs.clear();
                    if (window.STATE) window.STATE.selectedInputs.clear();
                } else {
                    this.inputFiles.forEach(f => {
                        this.selectedInputs.add(f.id);
                        if (window.STATE) window.STATE.selectedInputs.add(f.id);
                    });
                }
                this.selectedInputs = new Set(this.selectedInputs);
            },

            toggleAllOutputs() {
                if (this.selectedOutputs.size === this.outputFiles.length) {
                    this.selectedOutputs.clear();
                    if (window.STATE) window.STATE.selectedOutputs.clear();
                } else {
                    this.outputFiles.forEach(f => {
                        this.selectedOutputs.add(f.id);
                        if (window.STATE) window.STATE.selectedOutputs.add(f.id);
                    });
                }
                this.selectedOutputs = new Set(this.selectedOutputs);
            },

            formatBytes(bytes) {
                return formatBytes(bytes);
            },
            
            // Modal Helpers
            openConfig() {
                // Deep copy config to avoid direct mutation until save
                this.config = JSON.parse(JSON.stringify(window.STATE ? window.STATE.config || {} : {}));
                this.ibanInput = (window.STATE && window.STATE.ibanConfig) ? window.STATE.ibanConfig.iban : "";
                this.showConfigModal = true;
            },
            
            closeConfig() {
                this.showConfigModal = false;
            },
            
            saveConfig() {
                // Update global state
                if (window.STATE) {
                    window.STATE.config = this.config;
                    window.STATE.ibanConfig = { iban: this.ibanInput };
                }
                
                // Trigger save logic (needs to be exposed from main.js or storage.js)
                // For now, we'll dispatch a custom event that main.js listens to
                window.dispatchEvent(new CustomEvent('config-saved'));
                this.closeConfig();
            },

            // Edit Modal Actions
            openEdit(fileId, data) {
                this.editingFileId = fileId;
                this.editingData = JSON.parse(JSON.stringify(data));
                this.showEditModal = true;
            },

            closeEdit() {
                this.showEditModal = false;
                this.editingFileId = null;
                this.editingData = null;
            },

            saveEdit() {
                window.dispatchEvent(new CustomEvent('edit-saved', {
                    detail: {
                        id: this.editingFileId,
                        data: this.editingData
                    }
                }));
                this.closeEdit();
            },

            resetEdit() {
                 if (confirm("Discard all manual changes and re-parse the original file?")) {
                    window.dispatchEvent(new CustomEvent('edit-reset', {
                        detail: { id: this.editingFileId }
                    }));
                    // The main process will re-open the modal with fresh data if needed
                    // or we just close it and let the user re-open
                    this.closeEdit();
                 }
            },

            addEditItem() {
                if (!this.editingData.items) this.editingData.items = [];
                this.editingData.items.push({
                    date: "",
                    description: "New Item",
                    quantity: "1",
                    unit_price: "0.00",
                    total: "0.00"
                });
            },
            
            removeEditItem(index) {
                this.editingData.items.splice(index, 1);
            },

            // Preview Modal Actions
            openPreview(title) {
                this.previewTitle = title;
                this.showPreviewModal = true;
            },

            closePreview() {
                this.showPreviewModal = false;
                // Cleanup is handled by main.js listener or we can do it here if we move iframe logic
                const frame = document.getElementById("preview-frame");
                if (frame && frame.dataset.url) {
                    URL.revokeObjectURL(frame.dataset.url);
                    frame.dataset.url = '';
                }
                if (frame) frame.src = 'about:blank';
            },

            // IBAN Modal Actions
            openIban(currentIban) {
                this.ibanInput = currentIban || "";
                this.showIbanModal = true;
            },

            closeIban() {
                this.showIbanModal = false;
            },

            saveIban() {
                if (!this.ibanInput || !this.ibanInput.trim()) {
                    toast("Please enter an IBAN", "warn");
                    return;
                }
                window.dispatchEvent(new CustomEvent('iban-saved', {
                    detail: { iban: this.ibanInput }
                }));
                this.closeIban();
            },

            // Theme Actions
            toggleTheme() {
                this.theme = this.theme === 'dark' ? 'light' : 'dark';
                localStorage.setItem('theme', this.theme);
                this.applyTheme();
            },
            
            applyTheme() {
                if (this.theme === 'dark') {
                    document.documentElement.classList.add('dark');
                    document.documentElement.classList.remove('light');
                } else {
                    document.documentElement.classList.add('light');
                    document.documentElement.classList.remove('dark');
                }
            },

        };
};

// Initialize function that will be called from main.js
window.initAlpine = function() {
    // Alpine.js will automatically find the window.app function
    // This function can be used for any additional initialization if needed
    console.log('Alpine store initialized');
};

// --- Legacy Bridge ---
// These functions maintain compatibility with main.js while we transition

window.updateFolderStatus = function() {
    if (window.AlpineStore) window.AlpineStore.refreshState();
};

window.renderInputs = function(callbacks) {
    if (window.AlpineStore) window.AlpineStore.refreshState();
    // Store callbacks globally or on the store if needed for button clicks
    window._uiCallbacks = { ...window._uiCallbacks, ...callbacks };
};

window.renderOutputs = function(callbacks) {
    if (window.AlpineStore) window.AlpineStore.refreshState();
    window._uiCallbacks = { ...window._uiCallbacks, ...callbacks };
};

window.showProgress = function(show = true) {
    if (window.AlpineStore) window.AlpineStore.showProgress = show;
};

window.updateProgress = function(percent, text) {
    if (window.AlpineStore) {
        window.AlpineStore.progress = percent;
        window.AlpineStore.progressText = text;
    }
};

window.renderConfigModal = function() {
    if (window.AlpineStore) window.AlpineStore.openConfig();
};

window.openEditModal = function(fileId, data) {
    if (window.AlpineStore) {
        window.AlpineStore.openEdit(fileId, data);
    }
};

window.openPreviewModal = function(title) {
    if (window.AlpineStore) {
        window.AlpineStore.openPreview(title);
    }
};

window.openIbanModal = function(currentIban) {
    if (window.AlpineStore) {
        window.AlpineStore.openIban(currentIban);
    }
};