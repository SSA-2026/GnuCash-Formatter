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
                debug: false,
                // PDF Quality Options
                pdfQuality: 1.0,
                pdfScale: 3.0,
                pdfFormat: 'jpeg',
                pdfCompress: true
            },
            
            showOptions: false,
            showConvertOptions: false,
            currentPreset: 'default', // Track current preset
            
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
                
                // Set default preset
                this.applyPdfPreset('default');
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

            // PDF Quality Presets
            applyPdfPreset(preset) {
                switch(preset) {
                    case 'high':
                        this.conversionOptions.pdfQuality = 1.0;
                        this.conversionOptions.pdfScale = 4.0;
                        this.conversionOptions.pdfFormat = 'png';
                        this.conversionOptions.pdfCompress = true;
                        break;
                    case 'default':
                        this.conversionOptions.pdfQuality = 1.0;
                        this.conversionOptions.pdfScale = 3.0;
                        this.conversionOptions.pdfFormat = 'jpeg';
                        this.conversionOptions.pdfCompress = true;
                        break;
                    case 'low':
                        this.conversionOptions.pdfQuality = 0.7;
                        this.conversionOptions.pdfScale = 2.0;
                        this.conversionOptions.pdfFormat = 'jpeg';
                        this.conversionOptions.pdfCompress = true;
                        break;
                }
                this.currentPreset = preset;
            },

            // Check if a preset is currently active
            isCurrentPreset(preset) {
                return this.currentPreset === preset;
            },

            // Update preset when manual changes are made
            updateCurrentPreset() {
                const { pdfQuality, pdfScale, pdfFormat, pdfCompress } = this.conversionOptions;
                
                if (pdfQuality === 1.0 && pdfScale === 4.0 && pdfFormat === 'png' && pdfCompress === true) {
                    this.currentPreset = 'high';
                } else if (pdfQuality === 1.0 && pdfScale === 3.0 && pdfFormat === 'jpeg' && pdfCompress === true) {
                    this.currentPreset = 'default';
                } else if (pdfQuality === 0.7 && pdfScale === 2.0 && pdfFormat === 'jpeg' && pdfCompress === true) {
                    this.currentPreset = 'low';
                } else {
                    this.currentPreset = null; // Custom settings
                }
            },

            // Accurate file size estimation based on ACTUAL PDF generation process
            getEstimatedSize() {
                // Use the exact same defaults as pdf.js
                const quality = this.conversionOptions.pdfQuality || 0.8;
                const scale = this.conversionOptions.pdfScale || 1.5;
                const format = this.conversionOptions.pdfFormat || 'jpeg';
                const compress = this.conversionOptions.pdfCompress !== false;
                
                // Get config and input data
                const config = window.STATE?.config || {};
                const inputFiles = window.STATE?.inputFiles || [];
                
                // Simulate the exact canvas creation process from pdf.js
                const canvasWidth = 1006; // Fixed width from pdf.js line 41
                const estimatedContentHeight = this.estimateActualContentHeight(inputFiles, config);
                const scaledWidth = canvasWidth * scale;
                const scaledHeight = estimatedContentHeight * scale;
                const totalPixels = scaledWidth * scaledHeight;
                
                // Calculate image data size using REAL html2canvas compression behavior
                const imageSizeKB = this.calculateRealImageSize(totalPixels, format, quality, compress);
                
                // Calculate PDF structure overhead based on jsPDF behavior
                const pdfOverheadKB = this.calculateRealPdfOverhead(format, compress);
                
                // Total estimated size in KB
                let totalSizeKB = imageSizeKB + pdfOverheadKB;
                
                // Apply multi-page factor using the same logic as pdf.js
                const imgHeight = (scaledHeight * 210) / scaledWidth; // Same calculation as line 129 in pdf.js
                const pageHeight = 295; // A4 height in mm from line 128
                const pageCount = Math.ceil(imgHeight / pageHeight);
                
                if (pageCount > 1) {
                    // Each additional page adds the full image size again (pdf.js reuses the same image)
                    totalSizeKB = imageSizeKB + (pdfOverheadKB * pageCount);
                }
                
                // Format the result
                if (totalSizeKB < 1024) {
                    return `${Math.round(totalSizeKB)} KB`;
                } else {
                    return `${(totalSizeKB / 1024).toFixed(1)} MB`;
                }
            },

            // Estimate actual content height based on real HTML rendering
            estimateActualContentHeight(inputFiles, config) {
                let baseHeight = 200; // Base HTML structure height
                
                // Banner height (real banner images are typically 100-200px tall)
                if (config.banner_path) {
                    baseHeight += 150;
                }
                
                // Invoice header and details
                baseHeight += 120;
                
                // Client and company info sections
                baseHeight += 100;
                
                // Items table - calculate based on actual content
                let totalItems = 0;
                inputFiles.forEach(file => {
                    if (file.parsedData && file.parsedData.items) {
                        totalItems += file.parsedData.items.length;
                    }
                });
                
                if (totalItems === 0 && inputFiles.length > 0) {
                    totalItems = inputFiles.length * 3; // Conservative estimate
                }
                
                // Table header + rows (each row ~30px in rendered HTML)
                const tableHeight = 40 + (totalItems * 30);
                baseHeight += tableHeight;
                
                // Summary section
                baseHeight += 80;
                
                // Notes and payment info
                const notesLines = this.countNotesLines(config);
                baseHeight += Math.max(80, notesLines * 18);
                
                // Margins and padding (real HTML has more spacing)
                baseHeight += 80;
                
                return Math.min(baseHeight, 2000); // Reasonable maximum
            },

            // Calculate REAL image size based on actual html2canvas behavior
            calculateRealImageSize(totalPixels, format, quality, compress) {
                let actualQuality = quality;
                
                // Apply the EXACT same quality reduction as pdf.js line 158
                if (compress && format === 'jpeg') {
                    actualQuality = Math.max(0.2, quality * 0.5);
                }
                
                // Real-world compression ratios based on actual html2canvas output
                let bytesPerPixel;
                if (format === 'jpeg') {
                    // Real JPEG compression from html2canvas
                    bytesPerPixel = 0.05 * actualQuality + 0.02; // Base + quality factor
                } else { // PNG
                    // PNG compression is much less efficient - 3x larger than previously estimated
                    bytesPerPixel = 3.6; // Updated from 1.2 to 3.6 based on real testing
                }
                
                // Calculate raw image data size
                let imageSizeKB = (totalPixels * bytesPerPixel) / 1024;
                
                // Account for image optimization in onclone function (pdf.js lines 114-123)
                // Large images are resized to max 1600px width
                if (totalPixels > (1600 * 1200)) { // Assuming max height
                    imageSizeKB *= 0.7; // 30% reduction from image resizing
                }
                
                return imageSizeKB;
            },

            // Calculate REAL PDF overhead based on jsPDF behavior
            calculateRealPdfOverhead(format, compress) {
                let overheadKB = 25; // Base jsPDF overhead
                
                // Format-specific overhead
                if (format === 'png') {
                    overheadKB += 15; // PNG images add more overhead
                } else {
                    overheadKB += 8; // JPEG images
                }
                
                // Compression adds minimal overhead in jsPDF
                if (compress) {
                    overheadKB += 2;
                }
                
                // PDF metadata and structure
                overheadKB += 5;
                
                return overheadKB;
            },

            // Count lines in notes section
            countNotesLines(config) {
                let lines = 0;
                
                // Bank info lines
                if (window.STATE?.ibanConfig?.iban) lines += 1;
                if (config.bank?.bic) lines += 1;
                if (config.bank?.btw_number) lines += 1;
                
                // Payment request lines
                if (config.payment_request) {
                    lines += config.payment_request.split('\n').length;
                } else {
                    lines += 4; // Default payment request
                }
                
                // Closing lines
                lines += 4; // "With kind regards," etc.
                if (config.treasurer?.name) lines += 1;
                if (config.treasurer?.title) lines += 1;
                if (config.treasurer?.email) lines += 1;
                
                return lines;
            },

            // Get detailed breakdown of size estimation
            getSizeEstimateDetails() {
                const config = window.STATE?.config || {};
                const inputFiles = window.STATE?.inputFiles || [];
                
                // Use the exact same defaults as pdf.js
                const quality = this.conversionOptions.pdfQuality || 0.8;
                const scale = this.conversionOptions.pdfScale || 1.5;
                const format = this.conversionOptions.pdfFormat || 'jpeg';
                const compress = this.conversionOptions.pdfCompress !== false;
                
                let details = [];
                
                // Calculate actual canvas dimensions
                const canvasWidth = 1006;
                const estimatedContentHeight = this.estimateActualContentHeight(inputFiles, config);
                const scaledWidth = Math.round(canvasWidth * scale);
                const scaledHeight = Math.round(estimatedContentHeight * scale);
                const totalPixels = (scaledWidth * scaledHeight) / 1000000; // In millions
                
                details.push(`• Canvas: ${scaledWidth}×${scaledHeight}px (${totalPixels.toFixed(1)}MP)`);
                
                // Calculate image size details
                const imageSizeKB = this.calculateRealImageSize(scaledWidth * scaledHeight, format, quality, compress);
                details.push(`• Image data: ${Math.round(imageSizeKB)}KB`);
                
                // Format-specific compression info
                if (format === 'jpeg') {
                    let actualQuality = quality;
                    if (compress) {
                        actualQuality = Math.max(0.2, quality * 0.5);
                        details.push(`• JPEG: quality ${actualQuality.toFixed(2)} (50% reduction)`);
                    } else {
                        details.push(`• JPEG: quality ${quality.toFixed(2)} (no reduction)`);
                    }
                    const bytesPerPixel = 0.05 * actualQuality + 0.02;
                    details.push(`• Compression: ${bytesPerPixel.toFixed(3)} bytes/pixel`);
                } else {
                    details.push(`• PNG: lossless compression`);
                    details.push(`• Compression: 3.6 bytes/pixel (fixed)`);
                }
                
                // Banner analysis
                if (config.banner_path) {
                    details.push(`• Banner: included (+~${Math.round(150 * scale / 10)}KB)`);
                } else {
                    details.push('• No banner');
                }
                
                // Content analysis
                let totalItems = 0;
                inputFiles.forEach(file => {
                    if (file.parsedData && file.parsedData.items) {
                        totalItems += file.parsedData.items.length;
                    }
                });
                
                if (totalItems === 0 && inputFiles.length > 0) {
                    totalItems = inputFiles.length * 3;
                }
                
                details.push(`• ${totalItems} table rows`);
                
                // PDF overhead
                const pdfOverheadKB = this.calculateRealPdfOverhead(format, compress);
                details.push(`• PDF structure: ${Math.round(pdfOverheadKB)}KB`);
                
                // Multi-page analysis using same logic as pdf.js
                const imgHeight = (scaledHeight * 210) / scaledWidth;
                const pageHeight = 295;
                const pageCount = Math.ceil(imgHeight / pageHeight);
                
                if (pageCount > 1) {
                    details.push(`• Estimated pages: ${pageCount} (same image reused)`);
                } else {
                    details.push(`• Single page`);
                }
                
                // Image optimization info
                if (scaledWidth * scaledHeight > (1600 * 1200)) {
                    details.push(`• Large images will be optimized (-30%)`);
                }
                
                return details.join('\n');
            },
            // Watch for dropdown opening to refresh estimates
            openConvertOptions() {
                this.showConvertOptions = true;
                // Force a refresh of the estimated size
                this.$nextTick(() => {
                    // This will trigger reactivity updates
                    this.conversionOptions = { ...this.conversionOptions };
                });
            }
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